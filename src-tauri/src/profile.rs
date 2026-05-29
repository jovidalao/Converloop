//! learner-profile.md 读写。原子写入(临时文件 + rename),避免对话 agent 读到半截。
//! 文件落在 app_config_dir,与 sqlite 同目录。
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::Manager;

const PROFILE_FILE: &str = "learner-profile.md";

fn profile_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(PROFILE_FILE))
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
