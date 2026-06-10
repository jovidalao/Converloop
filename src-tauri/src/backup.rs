//! 学习数据备份导出:前端汇总好 JSON bundle,这里负责落盘到「下载」目录并在
//! 文件管理器里高亮显示。导入走前端 <input type="file">(webview 原生支持读文件),
//! 不需要 Rust 侧参与。
use std::fs;
use std::io::Write;
use tauri::Manager;

/// 把备份 JSON 写到下载目录(拿不到下载目录时退回 app_config_dir),返回最终路径。
/// 写完尽力在 Finder / 资源管理器里高亮文件;高亮失败不算错误。
#[tauri::command]
pub fn export_backup(
    app: tauri::AppHandle,
    content: String,
    file_name: String,
) -> Result<String, String> {
    // 文件名由前端生成(固定模板 + 时间戳),这里再兜底过滤路径分隔符。
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

    // 与 profile.rs 同款原子写:临时文件 + rename,避免半截备份文件。
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
