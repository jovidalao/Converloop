//! 语音转写(STT)。两个引擎,与 llm.rs 同理 HTTP 走 Rust 绕开 webview CORS,
//! 音频由前端 MediaRecorder 采集后 base64 传入:
//! - `stt_transcribe`:OpenAI 兼容 /audio/transcriptions 的 multipart 一步上传。
//!   不固定 language 参数——母语/混说输入是核心链路,让端点自检。
//! - `stt_transcribe_soniox`:Soniox 异步 API 三步(上传文件 → 建转写任务 →
//!   轮询完成后取文本),语言提示由前端按母语+目标语传入。
use base64::Engine;
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
struct TranscriptionResponse {
    text: String,
}

#[tauri::command]
pub async fn stt_transcribe(
    base_url: String,
    api_key: String,
    model: String,
    audio_b64: String,
    mime: String,
    file_name: String,
) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(audio_b64)
        .map_err(|e| format!("invalid audio payload: {e}"))?;

    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(file_name)
        .mime_str(&mime)
        .map_err(|e| format!("invalid mime: {e}"))?;
    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", model)
        .text("response_format", "json");

    let url = format!(
        "{}/audio/transcriptions",
        base_url.trim_end_matches('/')
    );
    let resp = reqwest::Client::new()
        .post(&url)
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("read body failed: {e}"))?;
    if !status.is_success() {
        // 截断错误体,避免把整页 HTML 倒进前端错误条。
        let snippet: String = body.chars().take(300).collect();
        return Err(format!("STT HTTP {status}: {snippet}"));
    }

    let parsed: TranscriptionResponse =
        serde_json::from_str(&body).map_err(|e| format!("unexpected response: {e}"))?;
    Ok(parsed.text)
}

const SONIOX_BASE: &str = "https://api.soniox.com/v1";
/// 麦克风输入都是短句,正常几秒内完成;上限防住卡死的任务。
const SONIOX_POLL_INTERVAL_MS: u64 = 500;
const SONIOX_POLL_MAX: u32 = 240; // 500ms × 240 = 2 分钟

#[derive(Deserialize)]
struct SonioxId {
    id: String,
}

#[derive(Deserialize)]
struct SonioxStatus {
    status: String,
    #[serde(default)]
    error_message: Option<String>,
}

async fn soniox_error_body(resp: reqwest::Response, what: &str) -> String {
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    let snippet: String = body.chars().take(300).collect();
    format!("Soniox {what} HTTP {status}: {snippet}")
}

/// 用完即删:转写产物与音频不留在 Soniox 账户里(隐私 + 配额卫生)。删除失败忽略。
async fn soniox_cleanup(client: &reqwest::Client, api_key: &str, path: String) {
    let _ = client
        .delete(format!("{SONIOX_BASE}/{path}"))
        .bearer_auth(api_key)
        .send()
        .await;
}

#[tauri::command]
pub async fn stt_transcribe_soniox(
    api_key: String,
    model: String,
    audio_b64: String,
    mime: String,
    file_name: String,
    language_hints: Vec<String>,
) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(audio_b64)
        .map_err(|e| format!("invalid audio payload: {e}"))?;

    let client = reqwest::Client::new();

    // 1. 上传音频文件
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(file_name)
        .mime_str(&mime)
        .map_err(|e| format!("invalid mime: {e}"))?;
    let resp = client
        .post(format!("{SONIOX_BASE}/files"))
        .bearer_auth(&api_key)
        .multipart(reqwest::multipart::Form::new().part("file", part))
        .send()
        .await
        .map_err(|e| format!("Soniox upload failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(soniox_error_body(resp, "upload").await);
    }
    let file_id = resp
        .json::<SonioxId>()
        .await
        .map_err(|e| format!("Soniox upload: unexpected response: {e}"))?
        .id;

    // 2. 建转写任务。语言提示为空时退回自动语言识别。
    let mut body = json!({
        "file_id": file_id,
        "model": model,
        "enable_language_identification": true,
    });
    if !language_hints.is_empty() {
        body["language_hints"] = json!(language_hints);
    }
    let resp = client
        .post(format!("{SONIOX_BASE}/transcriptions"))
        .bearer_auth(&api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Soniox create failed: {e}"))?;
    if !resp.status().is_success() {
        let err = soniox_error_body(resp, "create").await;
        soniox_cleanup(&client, &api_key, format!("files/{file_id}")).await;
        return Err(err);
    }
    let tid = resp
        .json::<SonioxId>()
        .await
        .map_err(|e| format!("Soniox create: unexpected response: {e}"))?
        .id;

    // 3. 轮询直到 completed / error
    let mut last_err: Option<String> = None;
    for _ in 0..SONIOX_POLL_MAX {
        tokio::time::sleep(std::time::Duration::from_millis(
            SONIOX_POLL_INTERVAL_MS,
        ))
        .await;
        let resp = client
            .get(format!("{SONIOX_BASE}/transcriptions/{tid}"))
            .bearer_auth(&api_key)
            .send()
            .await
            .map_err(|e| format!("Soniox poll failed: {e}"))?;
        if !resp.status().is_success() {
            last_err = Some(soniox_error_body(resp, "poll").await);
            break;
        }
        let st = resp
            .json::<SonioxStatus>()
            .await
            .map_err(|e| format!("Soniox poll: unexpected response: {e}"))?;
        match st.status.as_str() {
            "completed" => {
                last_err = None;
                break;
            }
            "error" => {
                last_err = Some(format!(
                    "Soniox transcription error: {}",
                    st.error_message.unwrap_or_else(|| "unknown".into())
                ));
                break;
            }
            _ => {
                last_err = Some("Soniox transcription timed out".into());
            }
        }
    }
    if let Some(err) = last_err {
        soniox_cleanup(&client, &api_key, format!("transcriptions/{tid}")).await;
        soniox_cleanup(&client, &api_key, format!("files/{file_id}")).await;
        return Err(err);
    }

    // 4. 取文本
    let resp = client
        .get(format!("{SONIOX_BASE}/transcriptions/{tid}/transcript"))
        .bearer_auth(&api_key)
        .send()
        .await
        .map_err(|e| format!("Soniox transcript fetch failed: {e}"))?;
    let result = if resp.status().is_success() {
        resp.json::<TranscriptionResponse>()
            .await
            .map(|t| t.text)
            .map_err(|e| format!("Soniox transcript: unexpected response: {e}"))
    } else {
        Err(soniox_error_body(resp, "transcript").await)
    };

    soniox_cleanup(&client, &api_key, format!("transcriptions/{tid}")).await;
    soniox_cleanup(&client, &api_key, format!("files/{file_id}")).await;
    result
}
