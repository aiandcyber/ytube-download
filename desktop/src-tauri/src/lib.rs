use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;

#[derive(Serialize)]
struct DownloadResult {
    path: String,
    message: String,
}

fn downloads_dir() -> Result<PathBuf, String> {
    dirs::download_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Downloads")))
        .ok_or_else(|| "Could not resolve Downloads folder".to_string())
}

fn resolve_yt_dlp() -> Result<PathBuf, String> {
    which::which("yt-dlp").or_else(|_| which::which("yt_dlp")).map_err(|_| {
        "yt-dlp not found on PATH. Install yt-dlp (https://github.com/yt-dlp/yt-dlp) or add it next to the app.".to_string()
    })
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

    let yt = resolve_yt_dlp()?;
    let out_dir = downloads_dir()?;
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

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
            message: "Download finished (see your Downloads folder).".into(),
        });
    }

    Ok(DownloadResult {
        message: "Download finished.".into(),
        path,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![download_youtube])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
