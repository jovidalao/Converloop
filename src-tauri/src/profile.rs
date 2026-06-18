//! learner-profile.md read/write. Atomic writes (temp file + rename) prevent the
//! conversation agent from reading a partial file. The file lives in app_config_dir
//! beside SQLite.
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::Manager;

const PROFILE_FILE: &str = "learner-profile.md";
const BACKUP_FILE: &str = "learner-profile.bak.md";

fn profile_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(PROFILE_FILE))
}

fn backup_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(BACKUP_FILE))
}

#[tauri::command]
pub fn read_profile(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = profile_path(&app)?;
    match fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn write_profile(app: tauri::AppHandle, content: String) -> Result<(), String> {
    let path = profile_path(&app)?;
    let tmp = path.with_extension("md.tmp");
    {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Snapshot before AI refresh: copy the current profile to .bak. No-op if missing.
#[tauri::command]
pub fn snapshot_profile(app: tauri::AppHandle) -> Result<(), String> {
    let path = profile_path(&app)?;
    if !path.exists() {
        return Ok(());
    }
    let bak = backup_path(&app)?;
    fs::copy(&path, &bak).map_err(|e| e.to_string())?;
    Ok(())
}

/// Restore from .bak to undo the last AI refresh. Returns restored content, or None if missing.
#[tauri::command]
pub fn restore_profile(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let bak = backup_path(&app)?;
    let content = match fs::read_to_string(&bak) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let path = profile_path(&app)?;
    let tmp = path.with_extension("md.tmp");
    {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(Some(content))
}
