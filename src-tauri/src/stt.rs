//! 语音转写(STT)。OpenAI 兼容引擎与 llm.rs 同理 HTTP 走 Rust 绕开 webview
//! CORS,音频由前端 MediaRecorder 采集后 base64 传入:
//! - `stt_transcribe`:OpenAI 兼容 /audio/transcriptions 的 multipart 一步上传。
//!   不固定 language 参数——母语/混说输入是核心链路,让端点自检。
//!
//! Soniox 走实时流式 WebSocket,直接在前端连(WS 无 CORS,CSP 已放行
//! wss://stt-rt.soniox.com),见 src/stt/realtime.ts,不经过这里。
use base64::Engine;
use serde::Deserialize;

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
