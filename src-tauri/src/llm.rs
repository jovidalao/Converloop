//! Generic LLM HTTP. This only sends requests and forwards responses; provider
//! formats are handled in TS ModelProvider implementations so agent-core remains
//! provider-agnostic.
use futures_util::StreamExt;
use std::collections::HashMap;
use std::sync::LazyLock;
use tauri::ipc::Channel;

// Process-wide shared Client: reuses connection pools/TLS sessions. Creating a
// Client per request would lose keep-alive. Only set a connect timeout, not a
// total timeout, because streaming LLM responses can run for minutes.
pub(crate) static HTTP: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()
        .expect("failed to build reqwest client")
});

fn build_request(
    url: &str,
    headers: &HashMap<String, String>,
    body: &serde_json::Value,
) -> reqwest::RequestBuilder {
    let mut req = HTTP.post(url).json(body);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    req
}

/// How many leading bytes of `buf` are safe to decode as UTF-8 right now.
/// An incomplete multi-byte sequence at the end is held back (the returned
/// length stops before it) so a character split across two network chunks —
/// common for CJK text — isn't turned into a replacement char. Genuinely
/// invalid bytes (never produced by an LLM stream, but possible) are passed
/// through for lossy decoding so the stream can never stall.
fn utf8_safe_prefix_len(buf: &[u8]) -> usize {
    match std::str::from_utf8(buf) {
        Ok(_) => buf.len(),
        // `error_len() == None` means the bytes are a valid prefix that was cut
        // mid-sequence: wait for the rest. Otherwise the bytes are truly invalid.
        Err(e) if e.error_len().is_none() => e.valid_up_to(),
        Err(_) => buf.len(),
    }
}

/// Non-streaming: return the full response body on success, or "HTTP <code>: <body>" on failure.
#[tauri::command]
pub async fn llm_request(
    url: String,
    headers: HashMap<String, String>,
    body: serde_json::Value,
) -> Result<String, String> {
    let resp = build_request(&url, &headers, &body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status.as_u16(), text));
    }
    Ok(text)
}

/// Streaming: forward raw response byte chunks to the frontend Channel; TS assembles SSE.
#[tauri::command]
pub async fn llm_stream(
    url: String,
    headers: HashMap<String, String>,
    body: serde_json::Value,
    on_chunk: Channel<String>,
) -> Result<(), String> {
    let resp = build_request(&url, &headers, &body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status.as_u16(), text));
    }
    let mut stream = resp.bytes_stream();
    // Carry an incomplete trailing UTF-8 sequence across chunk boundaries so a
    // multi-byte char (e.g. a CJK character) split by the network isn't decoded
    // into `�` on each side of the split.
    let mut carry: Vec<u8> = Vec::new();
    while let Some(item) = stream.next().await {
        let bytes = item.map_err(|e| e.to_string())?;
        carry.extend_from_slice(&bytes);
        let take = utf8_safe_prefix_len(&carry);
        if take == 0 {
            continue;
        }
        let text = String::from_utf8_lossy(&carry[..take]).into_owned();
        carry.drain(..take);
        on_chunk.send(text).map_err(|e| e.to_string())?;
    }
    // Flush any leftover bytes (a stream that ended mid-sequence is genuinely truncated).
    if !carry.is_empty() {
        on_chunk
            .send(String::from_utf8_lossy(&carry).into_owned())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::utf8_safe_prefix_len;

    #[test]
    fn whole_valid_string_is_emitted() {
        assert_eq!(utf8_safe_prefix_len("你好".as_bytes()), 6);
        assert_eq!(utf8_safe_prefix_len(b"data: hello"), 11);
    }

    #[test]
    fn incomplete_trailing_multibyte_is_held_back() {
        // "你好" is 6 bytes (3 each); cutting after 4 bytes splits the second char.
        let s = "你好".as_bytes();
        assert_eq!(utf8_safe_prefix_len(&s[..4]), 3); // emit "你", hold the partial "好"
    }

    #[test]
    fn single_char_split_byte_by_byte() {
        let s = "好".as_bytes(); // E5 A5 BD
        assert_eq!(utf8_safe_prefix_len(&s[..1]), 0); // lone lead byte: nothing safe yet
        assert_eq!(utf8_safe_prefix_len(&s[..2]), 0); // still incomplete
        assert_eq!(utf8_safe_prefix_len(s), 3); // complete
    }

    #[test]
    fn invalid_bytes_pass_through_and_do_not_stall() {
        // 0xFF is never valid UTF-8: emit it (lossy) rather than buffering forever.
        assert_eq!(utf8_safe_prefix_len(&[0xFF]), 1);
        assert_eq!(utf8_safe_prefix_len(&[0xE5, 0xFF]), 2);
    }
}
