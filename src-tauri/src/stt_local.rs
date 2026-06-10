//! 本地语音转写:NVIDIA Parakeet TDT 0.6B V3(经 sherpa-onnx 离线推理)。
//! 与 stt.rs 的云端引擎不同——模型跑在本机、无需 key、无需联网(下载后)。
//!
//! 该模型不支持流式,只做批量:前端 AudioWorklet 采集整段 s16le PCM(base64 传入)
//! → 解码为 f32 →(必要时)线性重采样到 16k → OfflineRecognizer 一次出文本。
//!
//! 模型 ~640MB,不打包进应用,运行时按需从 HuggingFace 下载到
//! app_config_dir/models/parakeet-tdt-0.6b-v3/(与 sqlite/档案同目录)。
//! recognizer 懒加载并全局缓存(避免每次转写重载 640MB)。
use base64::Engine;
use futures_util::StreamExt;
use serde::Serialize;
use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::ipc::Channel;
use tauri::Manager;

const MODEL_DIR: &str = "models/parakeet-tdt-0.6b-v3";
/// sherpa-onnx 官方转好的 int8 ONNX,逐文件下载(免去 tar.bz2 解压依赖)。
const HF_BASE: &str =
    "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/main";
const MODEL_FILES: [&str; 4] = [
    "encoder.int8.onnx",
    "decoder.int8.onnx",
    "joiner.int8.onnx",
    "tokens.txt",
];
const TARGET_SAMPLE_RATE: i32 = 16_000;

fn model_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(MODEL_DIR))
}

fn files_present(dir: &Path) -> bool {
    MODEL_FILES.iter().all(|f| dir.join(f).is_file())
}

/// 四个模型文件是否齐全(前端据此决定 UI 状态 + 是否允许切到 Parakeet)。
#[tauri::command]
pub fn parakeet_model_status(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(files_present(&model_dir(&app)?))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    /// 当前正在下载的文件名。
    file: String,
    /// 正在下第几个 / 共几个文件。
    file_index: usize,
    file_count: usize,
    /// 当前文件已下字节 / 总字节(总字节未知时为 0)。
    received: u64,
    total: u64,
}

/// 逐个文件下载模型,进度经 Channel 实时推给前端。原子写:先写 .part 再 rename。
/// 已存在的文件跳过(支持断点续传式重试——整文件粒度)。
#[tauri::command]
pub async fn parakeet_download_model(
    app: tauri::AppHandle,
    on_progress: Channel<DownloadProgress>,
) -> Result<(), String> {
    let dir = model_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let client = reqwest::Client::new();

    for (idx, name) in MODEL_FILES.iter().enumerate() {
        let dest = dir.join(name);
        if dest.is_file() {
            continue;
        }
        let url = format!("{HF_BASE}/{name}");
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("下载 {name} 失败: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("下载 {name} HTTP {}", resp.status()));
        }
        let total = resp.content_length().unwrap_or(0);

        let tmp = dest.with_extension("part");
        // 网络是瓶颈;块写之间穿插在 await 点之间,同步 std::fs 足够。
        let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        let mut received: u64 = 0;
        let mut stream = resp.bytes_stream();
        // 节流进度上报:每 ~1MB 推一次,避免刷爆 IPC。
        let mut since_emit: u64 = 0;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("下载 {name} 中断: {e}"))?;
            std::io::Write::write_all(&mut file, &chunk).map_err(|e| e.to_string())?;
            received += chunk.len() as u64;
            since_emit += chunk.len() as u64;
            if since_emit >= 1_000_000 {
                since_emit = 0;
                let _ = on_progress.send(DownloadProgress {
                    file: name.to_string(),
                    file_index: idx + 1,
                    file_count: MODEL_FILES.len(),
                    received,
                    total,
                });
            }
        }
        std::io::Write::flush(&mut file).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        std::fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
        let _ = on_progress.send(DownloadProgress {
            file: name.to_string(),
            file_index: idx + 1,
            file_count: MODEL_FILES.len(),
            received: total.max(received),
            total,
        });
    }
    Ok(())
}

/// 懒加载的全局 recognizer。OfflineRecognizer 是 Send+Sync,Mutex 保证同一时刻只一段
/// 在解码(批量短句,串行足够)。模型路径固定,首次转写时构建一次后常驻。
static RECOGNIZER: OnceLock<Mutex<Option<OfflineRecognizer>>> = OnceLock::new();

fn build_recognizer(dir: &Path) -> Result<OfflineRecognizer, String> {
    let path = |f: &str| dir.join(f).to_string_lossy().into_owned();
    let mut config = OfflineRecognizerConfig::default();
    config.model_config.transducer.encoder = Some(path("encoder.int8.onnx"));
    config.model_config.transducer.decoder = Some(path("decoder.int8.onnx"));
    config.model_config.transducer.joiner = Some(path("joiner.int8.onnx"));
    config.model_config.tokens = Some(path("tokens.txt"));
    OfflineRecognizer::create(&config)
        .ok_or_else(|| "Parakeet 模型加载失败(文件损坏?可重新下载)".to_string())
}

/// 简单线性重采样到 16k。前端已尽量按 16k 采集;此处仅作兜底(WebKit 可能忽略
/// AudioContext 的 sampleRate 选项)。ASR 对线性插值的轻微失真不敏感。
fn resample_to_16k(samples: &[f32], from_rate: i32) -> Vec<f32> {
    if from_rate == TARGET_SAMPLE_RATE || samples.is_empty() {
        return samples.to_vec();
    }
    let ratio = TARGET_SAMPLE_RATE as f64 / from_rate as f64;
    let out_len = ((samples.len() as f64) * ratio).round() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src = i as f64 / ratio;
        let j = src.floor() as usize;
        let frac = (src - j as f64) as f32;
        let a = samples[j.min(samples.len() - 1)];
        let b = samples[(j + 1).min(samples.len() - 1)];
        out.push(a + (b - a) * frac);
    }
    out
}

#[tauri::command]
pub async fn stt_transcribe_parakeet(
    app: tauri::AppHandle,
    pcm_s16le_b64: String,
    sample_rate: i32,
) -> Result<String, String> {
    let dir = model_dir(&app)?;
    if !files_present(&dir) {
        return Err("Parakeet 模型尚未下载".to_string());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(pcm_s16le_b64)
        .map_err(|e| format!("invalid audio payload: {e}"))?;

    // 推理是 CPU 密集且 sherpa-onnx 调用是阻塞的,放到 blocking 线程。
    tokio::task::spawn_blocking(move || {
        // s16le 字节 → f32([-1, 1])
        let samples: Vec<f32> = bytes
            .chunks_exact(2)
            .map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0)
            .collect();
        let samples = resample_to_16k(&samples, sample_rate);

        let lock = RECOGNIZER.get_or_init(|| Mutex::new(None));
        let mut guard = lock.lock().map_err(|_| "recognizer 锁中毒".to_string())?;
        if guard.is_none() {
            *guard = Some(build_recognizer(&dir)?);
        }
        let recognizer = guard.as_ref().unwrap();

        let stream = recognizer.create_stream();
        stream.accept_waveform(TARGET_SAMPLE_RATE, &samples);
        recognizer.decode(&stream);
        let result = stream
            .get_result()
            .ok_or_else(|| "Parakeet 识别无结果".to_string())?;
        Ok(result.text.trim().to_string())
    })
    .await
    .map_err(|e| format!("Parakeet 任务失败: {e}"))?
}
