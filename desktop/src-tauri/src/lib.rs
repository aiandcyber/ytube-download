mod auth;

use auth::{AuthInfo, AuthState};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use tauri::State;

struct AppAuth(Mutex<AuthState>);

#[derive(Serialize)]
struct DownloadResult {
    path: String,
    message: String,
}

fn app_bin_dir() -> Result<PathBuf, String> {
    let base = dirs::data_local_dir()
        .ok_or_else(|| "No local data directory".to_string())?
        .join("ytube-download");
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    Ok(base)
}

fn yt_dlp_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    }
}

fn yt_dlp_download_url() -> &'static str {
    if cfg!(target_os = "windows") {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    } else if cfg!(target_os = "macos") {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
    } else {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
    }
}

fn ensure_yt_dlp() -> Result<PathBuf, String> {
    if let Ok(p) = which::which("yt-dlp").or_else(|_| which::which("yt_dlp")) {
        return Ok(p);
    }
    let local = app_bin_dir()?.join(yt_dlp_name());
    if local.exists() {
        return Ok(local);
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    let bytes = client
        .get(yt_dlp_download_url())
        .send()
        .map_err(|e| format!("Could not download yt-dlp: {e}"))?
        .error_for_status()
        .map_err(|e| format!("yt-dlp download failed: {e}"))?
        .bytes()
        .map_err(|e| e.to_string())?;
    fs::write(&local, &bytes).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&local).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&local, perms).map_err(|e| e.to_string())?;
    }
    Ok(local)
}

fn downloads_dir() -> Result<PathBuf, String> {
    dirs::download_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Downloads")))
        .ok_or_else(|| "Could not resolve Downloads folder".to_string())
}

#[tauri::command]
fn get_auth(auth: State<'_, AppAuth>) -> Result<AuthInfo, String> {
    let g = auth.0.lock().map_err(|_| "Auth lock poisoned".to_string())?;
    Ok(auth::auth_status(&g))
}

#[tauri::command]
fn sign_in(auth: State<'_, AppAuth>) -> Result<AuthInfo, String> {
    auth::sign_in(&auth.0)
}

#[tauri::command]
fn sign_out(auth: State<'_, AppAuth>) -> Result<AuthInfo, String> {
    let mut g = auth.0.lock().map_err(|_| "Auth lock poisoned".to_string())?;
    auth::sign_out(&mut g);
    Ok(auth::auth_status(&g))
}

#[tauri::command]
fn download_youtube(url: String, audio_only: bool) -> Result<DownloadResult, String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("Paste a YouTube URL.".into());
    }
    if !url.contains("youtube.com") && !url.contains("youtu.be") {
        return Err("URL must be a YouTube link.".into());
    }

    let yt = ensure_yt_dlp()?;
    let out_dir = downloads_dir()?;
    fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

    let template = out_dir
        .join("%(title).80B [%(id)s].%(ext)s")
        .to_string_lossy()
        .to_string();

    let mut args: Vec<String> = vec![
        "--no-playlist".into(),
        "-o".into(),
        template,
        "--print".into(),
        "after_move:filepath".into(),
        "--newline".into(),
    ];

    if audio_only {
        args.extend([
            "-x".into(),
            "--audio-format".into(),
            "mp3".into(),
            "--audio-quality".into(),
            "0".into(),
        ]);
    } else {
        args.extend([
            "-f".into(),
            "bv*[height<=720]+ba/b[height<=720]/b".into(),
            "--merge-output-format".into(),
            "mp4".into(),
        ]);
    }
    args.push(url);

    let output = Command::new(&yt)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to start yt-dlp: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Download failed:\n{stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let path = stdout
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .last()
        .unwrap_or("")
        .to_string();

    if path.is_empty() {
        return Ok(DownloadResult {
            path: out_dir.to_string_lossy().to_string(),
            message: "Saved to your Downloads folder.".into(),
        });
    }

    Ok(DownloadResult {
        message: "Download complete.".into(),
        path,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppAuth(Mutex::new(AuthState::default())))
        .invoke_handler(tauri::generate_handler![
            download_youtube,
            get_auth,
            sign_in,
            sign_out
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
