//! OAuth 回调:订阅登录(Claude Pro/Max、ChatGPT Codex)的浏览器授权码,
//! 重定向到 http://localhost:<port><path>。webview 起不了监听 socket,所以这里在
//! Rust 侧开一次性 loopback HTTP 服务,捕获 ?code=&state=,回一张「可关闭」页面后返回。
//!
//! 只用 std::net + spawn_blocking(不引入 tokio 直接依赖)。整个 OAuth 流程(PKCE、
//! 打开浏览器、token 交换/刷新)在 TS 侧;token 交换复用 llm_request 这条通用 POST。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::{Duration, Instant};

use serde::Serialize;

#[derive(Serialize)]
pub struct CallbackResult {
    pub code: String,
    pub state: String,
}

const SUCCESS_HTML: &str = "<!doctype html><meta charset=utf-8><title>登录完成</title>\
<body style=\"font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;\
justify-content:center;height:100vh;margin:0;background:#1c1c1e;color:#f2f2f7\">\
<div style=\"text-align:center\"><h2 style=\"font-weight:600\">✓ 登录完成</h2>\
<p style=\"opacity:.7\">已捕获授权码,可以关闭此页面回到 app。</p></div>";

/// detail 可能来自回调 query 的 error 参数(攻击者可经浏览器注入),插入 HTML 前转义。
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn error_html(detail: &str) -> String {
    let detail = html_escape(detail);
    format!(
        "<!doctype html><meta charset=utf-8><title>登录失败</title>\
<body style=\"font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;\
justify-content:center;height:100vh;margin:0;background:#1c1c1e;color:#f2f2f7\">\
<div style=\"text-align:center\"><h2 style=\"font-weight:600\">登录未完成</h2>\
<p style=\"opacity:.7\">{detail}</p></div>"
    )
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// 最小 URL 解码:%XX → 字节,+ → 空格。query 值里的 code/state 一般是 URL-safe,
/// 但做一遍解码更稳(state 含 padding、code 偶有特殊字符时不至于错位)。
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => match (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                (Some(h), Some(l)) => {
                    out.push((h << 4) | l);
                    i += 3;
                }
                _ => {
                    out.push(bytes[i]);
                    i += 1;
                }
            },
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn parse_query(query: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        map.insert(percent_decode(k), percent_decode(v));
    }
    map
}

/// 从请求行 "GET /callback?a=b HTTP/1.1" 取 (path, query)。
fn parse_target(line: &str) -> Option<(String, String)> {
    let mut parts = line.split_whitespace();
    let _method = parts.next()?;
    let target = parts.next()?;
    Some(match target.split_once('?') {
        Some((p, q)) => (p.to_string(), q.to_string()),
        None => (target.to_string(), String::new()),
    })
}

/// 读到第一条 CRLF 为止,返回请求行(浏览器回调只看第一行就够)。
fn read_request_line(stream: &mut TcpStream) -> Option<String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .ok();
    let mut buf = [0u8; 2048];
    let mut data = Vec::new();
    loop {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                data.extend_from_slice(&buf[..n]);
                if let Some(pos) = data.windows(2).position(|w| w == b"\r\n") {
                    return Some(String::from_utf8_lossy(&data[..pos]).into_owned());
                }
                if data.len() > 8192 {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    String::from_utf8_lossy(&data)
        .lines()
        .next()
        .map(str::to_string)
}

fn write_response(stream: &mut TcpStream, status: u16, body: &str) {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        _ => "Not Found",
    };
    let res = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\n\
Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.as_bytes().len()
    );
    let _ = stream.write_all(res.as_bytes());
    let _ = stream.flush();
}

/// 绑 127.0.0.1:port,非阻塞轮询 accept 直到拿到匹配 path 的回调或超时。
/// 非匹配路径(favicon 等)回 404 继续等;带 error 参数则返回 Err。
fn listen_once(port: u16, path: &str, timeout_secs: u64) -> Result<CallbackResult, String> {
    let addr = format!("127.0.0.1:{port}");
    let listener = std::net::TcpListener::bind(&addr)
        .map_err(|e| format!("无法绑定 OAuth 回调端口 {addr}(可能被占用):{e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);

    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream.set_nonblocking(false).ok();
                let Some((req_path, query)) =
                    read_request_line(&mut stream).as_deref().and_then(parse_target)
                else {
                    write_response(&mut stream, 400, &error_html("无法解析回调请求。"));
                    continue;
                };
                if req_path != path {
                    write_response(&mut stream, 404, "Not found");
                    continue;
                }
                let params = parse_query(&query);
                if let Some(err) = params.get("error") {
                    write_response(&mut stream, 400, &error_html(err));
                    return Err(format!("授权失败:{err}"));
                }
                match (params.get("code"), params.get("state")) {
                    (Some(code), Some(state)) => {
                        write_response(&mut stream, 200, SUCCESS_HTML);
                        return Ok(CallbackResult {
                            code: code.clone(),
                            state: state.clone(),
                        });
                    }
                    _ => {
                        write_response(&mut stream, 400, &error_html("回调缺少 code 或 state。"));
                        return Err("OAuth 回调缺少 code 或 state".into());
                    }
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err("等待 OAuth 回调超时(可重试登录)".into());
                }
                std::thread::sleep(Duration::from_millis(120));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

/// 一次性等待 OAuth 浏览器回调。前端在打开授权 URL 前先调用本命令开始监听,
/// 用户在浏览器登录后被重定向回 127.0.0.1:<port><path>,这里捕获 code/state 返回。
#[tauri::command]
pub async fn oauth_listen(
    port: u16,
    path: String,
    timeout_secs: u64,
) -> Result<CallbackResult, String> {
    tauri::async_runtime::spawn_blocking(move || listen_once(port, &path, timeout_secs))
        .await
        .map_err(|e| e.to_string())?
}

/// OAuth token endpoint 的 application/x-www-form-urlencoded POST。
/// OpenAI(auth.openai.com)要求表单编码,llm_request 那条是 JSON,故单列。
/// 成功返回响应体文本,失败 "HTTP <code>: <body>"(含错误体便于排查)。
#[tauri::command]
pub async fn oauth_token_post(
    url: String,
    form: std::collections::HashMap<String, String>,
) -> Result<String, String> {
    let resp = crate::llm::HTTP
        .post(&url)
        .form(&form)
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
