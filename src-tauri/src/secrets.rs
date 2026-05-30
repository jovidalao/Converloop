//! BYOK 密钥:应用自管的设备绑定加密存储(取代 OS keychain)。
//!
//! 无主密码 → 混淆级:加密密钥由【本地随机 keyfile】+【机器标识】派生(SHA-256),
//! 密文(XChaCha20-Poly1305)存 secrets.json,与 sqlite/档案同目录。
//! - 拷走 secrets.json 到别的机器解不开(机器标识不同)→ 设备绑定。
//! - 挡得住:误传 git / 同步盘、随手翻看明文。
//! - 挡不住:能读你磁盘(keyfile + 机器标识都在本机)的攻击者 —— 这是"免密码"的物理上限。
//!   要真加密需主密码,见 docs/architecture.md。
//!
//! Tauri 命令名沿用 set/get/delete_secret,前端无需改动。

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use rand::{rngs::OsRng, RngCore};
use sha2::{Digest, Sha256};
use tauri::Manager;

const KEY_FILE: &str = "secret.key"; // 32 字节随机,0600
const STORE_FILE: &str = "secrets.json"; // account -> base64(nonce[24] || ciphertext)
const NONCE_LEN: usize = 24;

fn config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// 写文件并(unix 下)收紧到 0600,避免同机其他用户读取。
fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut f = fs::File::create(path).map_err(|e| e.to_string())?;
    f.write_all(bytes).map_err(|e| e.to_string())?;
    f.sync_all().map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 读现有 keyfile;没有就生成 32 字节随机并写入。
fn load_or_create_keyfile(app: &tauri::AppHandle) -> Result<[u8; 32], String> {
    let path = config_dir(app)?.join(KEY_FILE);
    if let Ok(bytes) = fs::read(&path) {
        if bytes.len() == 32 {
            let mut k = [0u8; 32];
            k.copy_from_slice(&bytes);
            return Ok(k);
        }
    }
    let mut k = [0u8; 32];
    OsRng.fill_bytes(&mut k);
    write_private(&path, &k)?;
    Ok(k)
}

/// 派生 cipher:key = SHA-256(keyfile || machine_id || domain)。
/// machine_id 取不到时降级为空串(仍可用,只是少了设备绑定)。
fn cipher(app: &tauri::AppHandle) -> Result<XChaCha20Poly1305, String> {
    let keyfile = load_or_create_keyfile(app)?;
    let machine = machine_uid::get().unwrap_or_default();
    let mut h = Sha256::new();
    h.update(keyfile);
    h.update(machine.as_bytes());
    h.update(b"lang-agent-secrets-v1");
    let key = h.finalize();
    XChaCha20Poly1305::new_from_slice(&key).map_err(|e| e.to_string())
}

fn read_store(app: &tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    let path = config_dir(app)?.join(STORE_FILE);
    match fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(e) => Err(e.to_string()),
    }
}

fn write_store(app: &tauri::AppHandle, store: &HashMap<String, String>) -> Result<(), String> {
    let path = config_dir(app)?.join(STORE_FILE);
    let json = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    write_private(&path, json.as_bytes())
}

#[tauri::command]
pub fn set_secret(app: tauri::AppHandle, account: String, secret: String) -> Result<(), String> {
    let c = cipher(&app)?;
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = XNonce::from_slice(&nonce_bytes);
    let ct = c
        .encrypt(nonce, secret.as_bytes())
        .map_err(|e| e.to_string())?;

    let mut blob = nonce_bytes.to_vec();
    blob.extend_from_slice(&ct);

    let mut store = read_store(&app)?;
    store.insert(account, B64.encode(blob));
    write_store(&app, &store)
}

#[tauri::command]
pub fn get_secret(app: tauri::AppHandle, account: String) -> Result<Option<String>, String> {
    let store = read_store(&app)?;
    let Some(enc) = store.get(&account) else {
        return Ok(None);
    };
    let blob = B64.decode(enc).map_err(|e| e.to_string())?;
    if blob.len() <= NONCE_LEN {
        return Err("密文损坏(长度不足)".into());
    }
    let (nonce_bytes, ct) = blob.split_at(NONCE_LEN);
    let nonce = XNonce::from_slice(nonce_bytes);
    let pt = cipher(&app)?
        .decrypt(nonce, ct)
        .map_err(|_| "解密失败(keyfile 或机器标识已变)".to_string())?;
    String::from_utf8(pt).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_secret(app: tauri::AppHandle, account: String) -> Result<(), String> {
    let mut store = read_store(&app)?;
    if store.remove(&account).is_some() {
        write_store(&app, &store)?;
    }
    Ok(())
}
