//! 通用 LLM HTTP。只做"发请求 + 透传响应",不懂 provider 格式——
//! provider/SSE 解析全在 TS 侧的 ModelProvider 里(保持 agent-core provider 无关)。
use futures_util::StreamExt;
use std::collections::HashMap;
use std::sync::LazyLock;
use tauri::ipc::Channel;

// 进程级共享 Client:复用连接池/TLS 会话(每请求新建 Client 会丢掉 keep-alive)。
// 只设连接超时,不设总超时——LLM 流式响应可能持续数分钟。
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

/// 非流式:返回完整响应体文本(成功)或 "HTTP <code>: <body>"(失败)。
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

/// 流式:把响应字节流原样分块推给前端 Channel,前端自己拼 SSE。
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
    while let Some(item) = stream.next().await {
        let bytes = item.map_err(|e| e.to_string())?;
        on_chunk
            .send(String::from_utf8_lossy(&bytes).into_owned())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
