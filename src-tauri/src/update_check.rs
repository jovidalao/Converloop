//! Checks GitHub Releases for a newer app version. This runs in Rust, not the
//! webview, because the CSP connect-src does not allow the frontend to reach
//! api.github.com directly.
use serde::{Deserialize, Serialize};

const REPO: &str = "jovidalao/Converloop";

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
    html_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    has_update: bool,
    latest_version: String,
    current_version: String,
    release_url: String,
}

/// Parses "x.y.z" (optional leading 'v') into a comparable tuple. An
/// unparseable segment reads as 0 so an unexpected tag format degrades to
/// "no update" instead of failing the whole check.
fn parse_version(raw: &str) -> (u32, u32, u32) {
    let trimmed = raw.strip_prefix('v').unwrap_or(raw);
    let mut parts = trimmed.split('.').map(|p| p.parse::<u32>().unwrap_or(0));
    (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    )
}

#[tauri::command]
pub async fn check_for_update() -> Result<UpdateCheckResult, String> {
    let url = format!("https://api.github.com/repos/{REPO}/releases/latest");
    let resp = crate::llm::HTTP
        .get(&url)
        .header("User-Agent", "Converloop")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status.as_u16(), text));
    }

    let release: GithubRelease = resp.json().await.map_err(|e| e.to_string())?;
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let latest_version = release
        .tag_name
        .strip_prefix('v')
        .unwrap_or(&release.tag_name)
        .to_string();
    let has_update = parse_version(&latest_version) > parse_version(&current_version);

    Ok(UpdateCheckResult {
        has_update,
        latest_version,
        current_version,
        release_url: release.html_url,
    })
}
