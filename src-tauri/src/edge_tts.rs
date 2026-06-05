//! 免费微软 Edge「朗读」TTS。Edge 的 read-aloud 是 WebSocket 服务(edge-tts 逆向出的协议),
//! 不是 HTTP——所以走独立命令,而不是 llm.rs 的 POST。
//!
//! 为什么必须在 Rust 而不是 webview 里连:服务用 `Origin` 头校验来源(必须是固定的
//! chrome-extension origin),浏览器禁止 JS 改写 WebSocket 的 Origin,从 webview 连会被拒。
//! Rust 侧可以自由设头,且与「网络走 Rust」的架构一致。
//!
//! 无需 API key。输出用 MP3(`audio-24khz-48kbitrate-mono-mp3`)——这是 edge-tts 唯一在用、
//! readaloud 端点确认接受的格式(RIFF/WAV 会被该端点拒绝、返回 0 音频)。前端播放按内容
//! 嗅探 MIME(playback.ts),mp3/wav 都能放。

use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use futures_util::{SinkExt, StreamExt};
use rand::{rngs::OsRng, RngCore};
use sha2::{Digest, Sha256};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;

// edge-tts 校验过的常量(constants.py)。SEC_MS_GEC_VERSION / UA 跟随近期 Edge 版本。
const WSS_URL: &str = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const TRUSTED_CLIENT_TOKEN: &str = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const SEC_MS_GEC_VERSION: &str = "1-143.0.3650.75";
const ORIGIN: &str = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";
// MP3 输出:edge-tts 在用、readaloud 端点确认接受的格式。
const OUTPUT_FORMAT: &str = "audio-24khz-48kbitrate-mono-mp3";

/// Sec-MS-GEC:Edge 的 DRM 令牌,缺了会 403。逐位复刻 edge-tts(含其 f64 运算),
/// 这样 hash 与服务端一致。ticks 取「当前 unix 秒 + 1601~1970 偏移」,向下取整到 5 分钟,
/// 再换成 100ns 单位(* 1e9/100 = 1e7),拼 trusted token 后 SHA-256 取大写 hex。
fn sec_ms_gec() -> String {
    let unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as f64;
    let mut ticks = unix + 11_644_473_600.0; // → Windows 纪元(1601)
    ticks -= ticks % 300.0; // 向下取整到 5 分钟
    ticks *= 1e7; // 100ns 单位(f64,与 Python 同样有损但确定)
    let to_hash = format!("{:.0}{}", ticks, TRUSTED_CLIENT_TOKEN);
    let digest = Sha256::digest(to_hash.as_bytes());
    let mut out = String::with_capacity(64);
    for b in digest {
        out.push_str(&format!("{:02X}", b));
    }
    out
}

/// 32 位十六进制(uuid4().hex 等价物),用于 ConnectionId / X-RequestId。
fn rand_hex() -> String {
    let mut b = [0u8; 16];
    OsRng.fill_bytes(&mut b);
    let mut s = String::with_capacity(32);
    for x in b {
        s.push_str(&format!("{:02x}", x));
    }
    s
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// JS `Date().toString()` 形态的时间戳;edge-tts 在 speech.config / ssml 头里带它。
/// 服务端不严格校验内容,但要存在。用 Hinnant civil-from-days 自算,免引日期库、且不写死过期值。
fn date_to_string() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let days = secs.div_euclid(86_400);
    let tod = secs.rem_euclid(86_400);
    let (h, mi, s) = (tod / 3600, (tod % 3600) / 60, tod % 60);

    let z = days + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let year = if m <= 2 { y + 1 } else { y };
    let wd = (days.rem_euclid(7) + 4) % 7; // 1970-01-01 = 周四(4)

    const WD: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const MO: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    format!(
        "{} {} {:02} {} {:02}:{:02}:{:02} GMT+0000 (Coordinated Universal Time)",
        WD[wd as usize],
        MO[(m - 1) as usize],
        d,
        year,
        h,
        mi,
        s
    )
}

fn speech_config_message(ts: &str) -> String {
    format!(
        "X-Timestamp:{ts}\r\n\
         Content-Type:application/json; charset=utf-8\r\n\
         Path:speech.config\r\n\r\n\
         {{\"context\":{{\"synthesis\":{{\"audio\":{{\"metadataoptions\":{{\
         \"sentenceBoundaryEnabled\":\"false\",\"wordBoundaryEnabled\":\"false\"}},\
         \"outputFormat\":\"{OUTPUT_FORMAT}\"}}}}}}}}"
    )
}

fn ssml(text: &str, voice: &str, rate: &str, pitch: &str) -> String {
    format!(
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>\
         <voice name='{}'><prosody pitch='{}' rate='{}' volume='+0%'>{}</prosody></voice></speak>",
        voice,
        pitch,
        rate,
        xml_escape(text)
    )
}

fn ssml_message(req_id: &str, ts: &str, ssml: &str) -> String {
    format!(
        "X-RequestId:{req_id}\r\n\
         Content-Type:application/ssml+xml\r\n\
         X-Timestamp:{ts}Z\r\n\
         Path:ssml\r\n\r\n\
         {ssml}"
    )
}

fn contains_subslice(haystack: &[u8], needle: &[u8]) -> bool {
    needle.len() <= haystack.len() && haystack.windows(needle.len()).any(|w| w == needle)
}

/// 从一条二进制帧里抽音频:前 2 字节大端 = 头长度;头里含 `Path:audio` 才是音频帧,
/// 负载是头之后的全部字节。
fn extract_audio(data: &[u8]) -> Option<&[u8]> {
    if data.len() < 2 {
        return None;
    }
    let hdr_len = u16::from_be_bytes([data[0], data[1]]) as usize;
    let start = 2 + hdr_len;
    if start > data.len() {
        return None;
    }
    if contains_subslice(&data[2..start], b"Path:audio") {
        Some(&data[start..])
    } else {
        None
    }
}

/// 合成整段语音并返回 base64(WAV)。一次性(TTS 本就一次合成整条回复),与 MiMo 路径同形。
#[tauri::command]
pub async fn edge_tts_synthesize(
    text: String,
    voice: String,
    rate: String,
    pitch: String,
) -> Result<String, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("没有可朗读的文本".into());
    }

    let url = format!(
        "{WSS_URL}&Sec-MS-GEC={}&Sec-MS-GEC-Version={SEC_MS_GEC_VERSION}&ConnectionId={}",
        sec_ms_gec(),
        rand_hex()
    );

    // into_client_request 已填好 Host / Upgrade / Sec-WebSocket-Key / Version;只补 Edge 要求的头。
    let mut request = url
        .into_client_request()
        .map_err(|e| format!("构造请求失败:{e}"))?;
    {
        let h = request.headers_mut();
        h.insert("Origin", HeaderValue::from_static(ORIGIN));
        h.insert("User-Agent", HeaderValue::from_static(USER_AGENT));
        h.insert("Pragma", HeaderValue::from_static("no-cache"));
        h.insert("Cache-Control", HeaderValue::from_static("no-cache"));
        h.insert("Accept-Language", HeaderValue::from_static("en-US,en;q=0.9"));
    }

    let (mut ws, _resp) = connect_async(request)
        .await
        .map_err(|e| format!("连接 Edge TTS 失败:{e}"))?;

    let ts = date_to_string();
    ws.send(Message::Text(speech_config_message(&ts).into()))
        .await
        .map_err(|e| format!("发送配置失败:{e}"))?;
    let ssml_doc = ssml(text, &voice, &rate, &pitch);
    ws.send(Message::Text(
        ssml_message(&rand_hex(), &ts, &ssml_doc).into(),
    ))
    .await
    .map_err(|e| format!("发送 SSML 失败:{e}"))?;

    let mut audio: Vec<u8> = Vec::new();
    // 收集服务端文本/关闭帧,音频为空时回报真实原因(格式被拒 / 语音名无效等)。
    let mut diagnostics: Vec<String> = Vec::new();
    while let Some(item) = ws.next().await {
        let msg = item.map_err(|e| format!("接收失败:{e}"))?;
        match msg {
            Message::Binary(data) => {
                if let Some(chunk) = extract_audio(&data) {
                    audio.extend_from_slice(chunk);
                }
            }
            Message::Text(t) => {
                // turn.start / response / audio.metadata 忽略;turn.end = 合成结束。
                let s = t.to_string();
                if s.contains("Path:turn.end") {
                    break;
                }
                diagnostics.push(s);
            }
            Message::Close(frame) => {
                if let Some(f) = frame {
                    diagnostics.push(format!(
                        "服务端关闭 code={} reason={}",
                        u16::from(f.code),
                        f.reason
                    ));
                }
                break;
            }
            _ => {}
        }
    }
    let _ = ws.close(None).await;

    if audio.is_empty() {
        let tail: String = diagnostics.join(" | ").chars().take(400).collect();
        let hint = if tail.is_empty() {
            "服务端无说明".to_string()
        } else {
            tail
        };
        return Err(format!("Edge TTS 未返回音频。{hint}"));
    }
    Ok(B64.encode(&audio))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sec_ms_gec_is_64_upper_hex() {
        let t = sec_ms_gec();
        assert_eq!(t.len(), 64);
        assert!(t.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_lowercase()));
    }

    #[test]
    fn xml_escape_escapes_specials() {
        assert_eq!(xml_escape("a & b < c"), "a &amp; b &lt; c");
        assert_eq!(xml_escape("\"x'y\""), "&quot;x&apos;y&quot;");
    }

    #[test]
    fn ssml_embeds_voice_and_escaped_text() {
        let s = ssml("Tom & Jerry", "en-US-EmmaMultilingualNeural", "+0%", "+0Hz");
        assert!(s.contains("name='en-US-EmmaMultilingualNeural'"));
        assert!(s.contains("rate='+0%'"));
        assert!(s.contains("Tom &amp; Jerry"));
    }

    #[test]
    fn extract_audio_pulls_payload_after_header() {
        let header = b"Content-Type:audio/x-wav\r\nX-StreamId:1\r\nPath:audio\r\n";
        let mut frame = (header.len() as u16).to_be_bytes().to_vec();
        frame.extend_from_slice(header);
        frame.extend_from_slice(b"WAVBYTES");
        assert_eq!(extract_audio(&frame), Some(&b"WAVBYTES"[..]));
    }

    #[test]
    fn extract_audio_ignores_non_audio_frames() {
        let header = b"Path:turn.start\r\n";
        let mut frame = (header.len() as u16).to_be_bytes().to_vec();
        frame.extend_from_slice(header);
        frame.extend_from_slice(b"junk");
        assert_eq!(extract_audio(&frame), None);
    }
}
