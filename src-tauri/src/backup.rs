//! Learning-data backup export: the frontend assembles the JSON bundle; Rust writes
//! it to Downloads and asks the file manager to reveal it. Import uses a frontend
//! <input type="file"> because webviews can read selected files natively.
use std::fs;
use std::io::Write;
use tauri::Manager;

/// Write backup JSON to Downloads (falling back to app_config_dir) and return the path.
/// Best-effort reveal in Finder / Explorer; reveal failure is not an export failure.
#[tauri::command]
pub fn export_backup(
    app: tauri::AppHandle,
    content: String,
    file_name: String,
) -> Result<String, String> {
    // The frontend generates the fixed-template timestamped name; still strip path separators here.
    let safe_name: String = file_name
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':') { '-' } else { c })
        .collect();
    let dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().app_config_dir())
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(safe_name);

    // Same atomic write pattern as profile.rs: temp file + rename avoids half-written backups.
    let tmp = path.with_extension("json.tmp");
    {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;

    let _ = tauri_plugin_opener::reveal_item_in_dir(&path);
    Ok(path.to_string_lossy().into_owned())
}
