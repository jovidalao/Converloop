//! Speech-to-text (STT). OpenAI-compatible engines send HTTP through Rust, like
//! llm.rs, to bypass webview CORS. The frontend records with MediaRecorder and
//! passes base64 audio here:
//! - `stt_transcribe`: one multipart upload to /audio/transcriptions.
//!   Do not pin a language; native/mixed-language input is core, so let the endpoint detect it.
//!
//! Soniox uses real-time WebSocket streaming directly from the frontend (no WS
//! CORS, CSP allows wss://stt-rt.soniox.com); see src/stt/realtime.ts.
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
        // Truncate error bodies so a whole HTML page does not flood the frontend error bar.
        let snippet: String = body.chars().take(300).collect();
        return Err(format!("STT HTTP {status}: {snippet}"));
    }

    let parsed: TranscriptionResponse =
        serde_json::from_str(&body).map_err(|e| format!("unexpected response: {e}"))?;
    Ok(parsed.text)
}
