//! Local speech-to-text via sherpa-onnx offline inference, with two engines:
//!  - parakeet: NVIDIA Parakeet TDT 0.6B V3 (transducer). 25 European languages, no CJK.
//!  - qwen3: Qwen3-ASR 0.6B int8 (LLM decoding). 30+ languages including Chinese/Cantonese.
//!
//! Unlike the cloud engines in stt.rs, models run locally: no key and no network after download.
//!
//! Both models are batch-only: the frontend AudioWorklet captures the whole utterance
//! as s16le PCM (base64 input), this module decodes to f32, resamples to 16k if
//! needed, then runs one OfflineRecognizer pass.
//!
//! Models are not bundled. They are downloaded on demand from HuggingFace into
//! app_config_dir/models/<engine-dir>/, beside SQLite/profile data. Recognizers
//! are lazy-loaded and globally cached; only one engine stays resident at a time
//! because keeping both loaded exceeds 2GB.
use base64::Engine;
use futures_util::StreamExt;
use serde::Serialize;
use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::ipc::Channel;
use tauri::Manager;

/// Model source for one local engine: HF base URL plus per-file download list,
/// avoiding a tar.bz2 extraction dependency.
struct LocalModelSpec {
    /// Model directory under app_config_dir.
    dir: &'static str,
    hf_base: &'static str,
    files: &'static [&'static str],
}

const PARAKEET: LocalModelSpec = LocalModelSpec {
    dir: "models/parakeet-tdt-0.6b-v3",
    hf_base:
        "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/main",
    files: &[
        "encoder.int8.onnx",
        "decoder.int8.onnx",
        "joiner.int8.onnx",
        "tokens.txt",
    ],
};

const QWEN3: LocalModelSpec = LocalModelSpec {
    dir: "models/qwen3-asr-0.6b-int8",
    hf_base:
        "https://huggingface.co/csukuangfj2/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25/resolve/main",
    files: &[
        "conv_frontend.onnx",
        "encoder.int8.onnx",
        "decoder.int8.onnx",
        "tokenizer/merges.txt",
        "tokenizer/vocab.json",
        "tokenizer/tokenizer_config.json",
    ],
};

fn spec_for(engine: &str) -> Result<&'static LocalModelSpec, String> {
    match engine {
        "parakeet" => Ok(&PARAKEET),
        "qwen3" => Ok(&QWEN3),
        other => Err(format!("未知本地 STT 引擎: {other}")),
    }
}

const TARGET_SAMPLE_RATE: i32 = 16_000;

fn model_dir(app: &tauri::AppHandle, spec: &LocalModelSpec) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(spec.dir))
}

fn files_present(dir: &Path, spec: &LocalModelSpec) -> bool {
    spec.files.iter().all(|f| dir.join(f).is_file())
}

/// Whether model files are complete; the frontend uses this for UI state and activation gating.
#[tauri::command]
pub fn local_asr_model_status(app: tauri::AppHandle, engine: String) -> Result<bool, String> {
    let spec = spec_for(&engine)?;
    Ok(files_present(&model_dir(&app, spec)?, spec))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    /// File currently being downloaded.
    file: String,
    /// 1-based file index and total file count.
    file_index: usize,
    file_count: usize,
    /// Bytes received for this file, and total bytes when known (0 if unknown).
    received: u64,
    total: u64,
}

/// Download model files one by one, sending progress to the frontend over a Channel.
/// Writes are atomic (.part then rename). Existing files are skipped, which gives
/// whole-file resume behavior on retry.
#[tauri::command]
pub async fn local_asr_download_model(
    app: tauri::AppHandle,
    engine: String,
    on_progress: Channel<DownloadProgress>,
) -> Result<(), String> {
    let spec = spec_for(&engine)?;
    let dir = model_dir(&app, spec)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let client = reqwest::Client::new();

    for (idx, name) in spec.files.iter().enumerate() {
        let dest = dir.join(name);
        if dest.is_file() {
            continue;
        }
        // The file list may contain subdirectories, such as qwen3's tokenizer/.
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let url = format!("{}/{name}", spec.hf_base);
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
        // Network is the bottleneck; synchronous std::fs writes between await points are enough.
        let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        let mut received: u64 = 0;
        let mut stream = resp.bytes_stream();
        // Throttle progress events to about every 1MB to avoid flooding IPC.
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
                    file_count: spec.files.len(),
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
            file_count: spec.files.len(),
            received: total.max(received),
            total,
        });
    }
    Ok(())
}

/// Lazy global recognizer tagged with its engine. Switching engines drops the old
/// instance before loading the new one (Parakeet ~0.7GB + Qwen3 ~1.5GB, so they
/// cannot both stay resident). The Mutex also serializes decoding; batch snippets
/// are short, so that is enough.
static RECOGNIZER: OnceLock<Mutex<Option<(String, OfflineRecognizer)>>> = OnceLock::new();

fn build_recognizer(engine: &str, dir: &Path) -> Result<OfflineRecognizer, String> {
    let path = |f: &str| dir.join(f).to_string_lossy().into_owned();
    let mut config = OfflineRecognizerConfig::default();
    match engine {
        "qwen3" => {
            // LLM decoding engine: tokenizer points at the directory containing
            // vocab.json/merges.txt; feature_dim is 128 instead of transducer's default 80.
            config.feat_config.feature_dim = 128;
            config.model_config.qwen3_asr.conv_frontend = Some(path("conv_frontend.onnx"));
            config.model_config.qwen3_asr.encoder = Some(path("encoder.int8.onnx"));
            config.model_config.qwen3_asr.decoder = Some(path("decoder.int8.onnx"));
            config.model_config.qwen3_asr.tokenizer = Some(path("tokenizer"));
            // The 128-token default truncates longer recordings.
            config.model_config.qwen3_asr.max_new_tokens = 256;
        }
        _ => {
            config.model_config.transducer.encoder = Some(path("encoder.int8.onnx"));
            config.model_config.transducer.decoder = Some(path("decoder.int8.onnx"));
            config.model_config.transducer.joiner = Some(path("joiner.int8.onnx"));
            config.model_config.tokens = Some(path("tokens.txt"));
        }
    }
    OfflineRecognizer::create(&config)
        .ok_or_else(|| "本地模型加载失败(文件损坏?可重新下载)".to_string())
}

/// Simple linear resampling to 16k. The frontend already asks for 16k capture;
/// this is only a fallback for WebKit ignoring AudioContext.sampleRate. ASR is
/// not very sensitive to the slight distortion from linear interpolation.
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
pub async fn stt_transcribe_local(
    app: tauri::AppHandle,
    engine: String,
    pcm_s16le_b64: String,
    sample_rate: i32,
) -> Result<String, String> {
    let spec = spec_for(&engine)?;
    let dir = model_dir(&app, spec)?;
    if !files_present(&dir, spec) {
        return Err("本地模型尚未下载".to_string());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(pcm_s16le_b64)
        .map_err(|e| format!("invalid audio payload: {e}"))?;

    // Inference is CPU-heavy and sherpa-onnx is blocking, so run it on a blocking thread.
    tokio::task::spawn_blocking(move || {
        // s16le bytes -> f32([-1, 1])
        let samples: Vec<f32> = bytes
            .chunks_exact(2)
            .map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0)
            .collect();
        let samples = resample_to_16k(&samples, sample_rate);

        let lock = RECOGNIZER.get_or_init(|| Mutex::new(None));
        let mut guard = lock.lock().map_err(|_| "recognizer 锁中毒".to_string())?;
        if guard.as_ref().map(|(e, _)| e.as_str()) != Some(engine.as_str()) {
            *guard = None; // Release the old engine first to avoid two resident models.
            *guard = Some((engine.clone(), build_recognizer(&engine, &dir)?));
        }
        let recognizer = &guard.as_ref().unwrap().1;

        let stream = recognizer.create_stream();
        stream.accept_waveform(TARGET_SAMPLE_RATE, &samples);
        recognizer.decode(&stream);
        let result = stream
            .get_result()
            .ok_or_else(|| "本地引擎识别无结果".to_string())?;
        Ok(result.text.trim().to_string())
    })
    .await
    .map_err(|e| format!("本地转写任务失败: {e}"))?
}
