mod auth;

use auth::{AuthInfo, AuthState};
use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::State;

struct AppAuth(Mutex<AuthState>);

struct DownloadCtl {
    child: Mutex<Option<Child>>,
    cancel: AtomicBool,
}

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
        .timeout(Duration::from_secs(180))
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

fn default_downloads_dir() -> Result<PathBuf, String> {
    dirs::download_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Downloads")))
        .ok_or_else(|| "Could not resolve Downloads folder".to_string())
}

fn video_format(quality: &str) -> String {
    match quality {
        "360" => "bv*[height<=360]+ba/b[height<=360]/b".into(),
        "480" => "bv*[height<=480]+ba/b[height<=480]/b".into(),
        "1080" => "bv*[height<=1080]+ba/b[height<=1080]/b".into(),
        "best" => "bv*+ba/b".into(),
        _ => "bv*[height<=720]+ba/b[height<=720]/b".into(),
    }
}

fn audio_quality_arg(quality: &str) -> &'static str {
    match quality {
        "128" => "5",
        "256" => "2",
        "320" => "0",
        _ => "3",
    }
}

fn audio_bitrate_kbps(quality: &str) -> u64 {
    match quality {
        "128" => 128,
        "256" => 256,
        "320" => 320,
        _ => 192,
    }
}

fn video_height_cap(quality: &str) -> Option<u64> {
    match quality {
        "360" => Some(360),
        "480" => Some(480),
        "1080" => Some(1080),
        "best" => None,
        _ => Some(720),
    }
}

fn format_bytes(n: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let v = n as f64;
    if v >= GB {
        format!("{:.2} GB", v / GB)
    } else if v >= MB {
        format!("{:.1} MB", v / MB)
    } else if v >= KB {
        format!("{:.0} KB", v / KB)
    } else {
        format!("{n} B")
    }
}

fn bytes_from_format(fmt: &serde_json::Value, duration: Option<f64>) -> Option<u64> {
    if let Some(n) = fmt.get("filesize").and_then(|v| v.as_u64()) {
        if n > 0 {
            return Some(n);
        }
    }
    if let Some(n) = fmt.get("filesize_approx").and_then(|v| v.as_u64()) {
        if n > 0 {
            return Some(n);
        }
    }
    let tbr = fmt
        .get("tbr")
        .and_then(|v| v.as_f64())
        .filter(|b| *b > 0.0)
        .or_else(|| fmt.get("abr").and_then(|v| v.as_f64()).filter(|b| *b > 0.0))
        .or_else(|| fmt.get("vbr").and_then(|v| v.as_f64()).filter(|b| *b > 0.0))?;
    let dur = duration.filter(|d| *d > 0.0)?;
    // tbr is kbps → bytes ≈ seconds * kbps * 1000 / 8
    Some((dur * tbr * 125.0).round() as u64)
}

fn pick_video_format<'a>(
    formats: &'a [serde_json::Value],
    max_height: Option<u64>,
) -> Option<&'a serde_json::Value> {
    let mut best: Option<(&serde_json::Value, u64, f64)> = None;
    for fmt in formats {
        let vcodec = fmt.get("vcodec").and_then(|v| v.as_str()).unwrap_or("none");
        if vcodec == "none" || vcodec == "images" {
            continue;
        }
        let ext = fmt.get("ext").and_then(|v| v.as_str()).unwrap_or("");
        if ext == "mhtml" {
            continue;
        }
        let height = fmt.get("height").and_then(|v| v.as_u64()).unwrap_or(0);
        if let Some(cap) = max_height {
            if height == 0 || height > cap {
                continue;
            }
        }
        let tbr = fmt.get("tbr").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let score_h = height;
        let better = match best {
            None => true,
            Some((_, bh, bt)) => score_h > bh || (score_h == bh && tbr > bt),
        };
        if better {
            best = Some((fmt, score_h, tbr));
        }
    }
    best.map(|(f, _, _)| f)
}

fn pick_audio_format<'a>(formats: &'a [serde_json::Value]) -> Option<&'a serde_json::Value> {
    let mut best: Option<(&serde_json::Value, f64)> = None;
    for fmt in formats {
        let acodec = fmt.get("acodec").and_then(|v| v.as_str()).unwrap_or("none");
        let vcodec = fmt.get("vcodec").and_then(|v| v.as_str()).unwrap_or("none");
        if acodec == "none" || vcodec != "none" {
            continue;
        }
        let abr = fmt
            .get("abr")
            .and_then(|v| v.as_f64())
            .or_else(|| fmt.get("tbr").and_then(|v| v.as_f64()))
            .unwrap_or(0.0);
        let better = match best {
            None => true,
            Some((_, b)) => abr > b,
        };
        if better {
            best = Some((fmt, abr));
        }
    }
    best.map(|(f, _)| f)
}

#[derive(Serialize)]
struct SizeEstimate {
    bytes: u64,
    label: String,
    approximate: bool,
}

fn estimate_from_info(
    info: &serde_json::Value,
    audio_only: bool,
    quality: &str,
) -> Result<SizeEstimate, String> {
    let duration = info.get("duration").and_then(|v| v.as_f64());
    if audio_only {
        let dur = duration.ok_or_else(|| "Could not read video duration.".to_string())?;
        let kbps = audio_bitrate_kbps(quality);
        let bytes = (dur * kbps as f64 * 125.0).round() as u64;
        return Ok(SizeEstimate {
            bytes,
            label: format!("~{}", format_bytes(bytes)),
            approximate: true,
        });
    }

    let formats = info
        .get("formats")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "No format list from yt-dlp.".to_string())?;

    let max_h = video_height_cap(quality);
    let video = pick_video_format(formats, max_h)
        .ok_or_else(|| "No matching video format for that quality.".to_string())?;
    let audio = pick_audio_format(formats);

    let mut total = 0u64;
    let mut approx = false;
    let mut any = false;

    if let Some(n) = bytes_from_format(video, duration) {
        total += n;
        any = true;
        if video.get("filesize").and_then(|v| v.as_u64()).unwrap_or(0) == 0 {
            approx = true;
        }
    }
    if let Some(a) = audio {
        if let Some(n) = bytes_from_format(a, duration) {
            total += n;
            any = true;
            if a.get("filesize").and_then(|v| v.as_u64()).unwrap_or(0) == 0 {
                approx = true;
            }
        }
    } else if let Some(n) = bytes_from_format(video, duration) {
        // progressive (video+audio in one) already counted
        let _ = n;
    }

    if !any || total == 0 {
        return Err("Size not available for this quality.".into());
    }

    let label = if approx {
        format!("~{}", format_bytes(total))
    } else {
        format_bytes(total)
    };
    Ok(SizeEstimate {
        bytes: total,
        label,
        approximate: approx,
    })
}

#[tauri::command]
fn estimate_download_size(
    url: String,
    audio_only: bool,
    quality: String,
) -> Result<SizeEstimate, String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("Paste a YouTube URL.".into());
    }
    if !url.contains("youtube.com") && !url.contains("youtu.be") {
        return Err("URL must be a YouTube link.".into());
    }

    let yt = ensure_yt_dlp()?;
    let output = Command::new(&yt)
        .args([
            "--no-playlist",
            "--skip-download",
            "--no-warnings",
            "--no-color",
            "-J",
            &url,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to probe video: {e}"))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Could not read video info:\n{err}"));
    }

    let info: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Bad yt-dlp JSON: {e}"))?;
    estimate_from_info(&info, audio_only, quality.trim())
}

fn read_pipe(child: &mut Child) -> (String, String) {
    let mut stdout = String::new();
    let mut stderr = String::new();
    if let Some(mut out) = child.stdout.take() {
        let _ = out.read_to_string(&mut stdout);
    }
    if let Some(mut err) = child.stderr.take() {
        let _ = err.read_to_string(&mut stderr);
    }
    (stdout, stderr)
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
fn cancel_download(ctl: State<'_, DownloadCtl>) -> Result<(), String> {
    ctl.cancel.store(true, Ordering::SeqCst);
    if let Ok(mut guard) = ctl.child.lock() {
        if let Some(child) = guard.as_mut() {
            let _ = child.kill();
        }
    }
    Ok(())
}

#[tauri::command]
fn download_youtube(
    url: String,
    audio_only: bool,
    quality: String,
    save_dir: Option<String>,
    ctl: State<'_, DownloadCtl>,
) -> Result<DownloadResult, String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("Paste a YouTube URL.".into());
    }
    if !url.contains("youtube.com") && !url.contains("youtu.be") {
        return Err("URL must be a YouTube link.".into());
    }

    ctl.cancel.store(false, Ordering::SeqCst);

    let yt = ensure_yt_dlp()?;
    let out_dir = match save_dir.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(dir) => PathBuf::from(dir),
        None => default_downloads_dir()?,
    };
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
        "--no-color".into(),
    ];

    if audio_only {
        args.extend([
            "-x".into(),
            "--audio-format".into(),
            "mp3".into(),
            "--audio-quality".into(),
            audio_quality_arg(quality.trim()).into(),
        ]);
    } else {
        args.extend([
            "-f".into(),
            video_format(quality.trim()),
            "--merge-output-format".into(),
            "mp4".into(),
        ]);
    }
    args.push(url);

    let child = Command::new(&yt)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start yt-dlp: {e}"))?;

    {
        let mut guard = ctl
            .child
            .lock()
            .map_err(|_| "Download lock poisoned".to_string())?;
        *guard = Some(child);
    }

    loop {
        if ctl.cancel.load(Ordering::SeqCst) {
            if let Ok(mut guard) = ctl.child.lock() {
                if let Some(c) = guard.as_mut() {
                    let _ = c.kill();
                    let _ = c.wait();
                }
                *guard = None;
            }
            return Err("Download cancelled.".into());
        }

        {
            let mut guard = ctl
                .child
                .lock()
                .map_err(|_| "Download lock poisoned".to_string())?;
            let child = guard
                .as_mut()
                .ok_or_else(|| "Download process missing.".to_string())?;
            match child.try_wait() {
                Ok(Some(status)) => {
                    let (stdout, stderr) = read_pipe(child);
                    let _ = guard.take();
                    if ctl.cancel.load(Ordering::SeqCst) {
                        return Err("Download cancelled.".into());
                    }
                    if !status.success() {
                        return Err(format!("Download failed:\n{stderr}"));
                    }
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
                            message: "Saved.".into(),
                        });
                    }
                    return Ok(DownloadResult {
                        message: "Download complete.".into(),
                        path,
                    });
                }
                Ok(None) => {}
                Err(e) => {
                    let _ = guard.take();
                    return Err(format!("Download failed: {e}"));
                }
            }
        }

        thread::sleep(Duration::from_millis(200));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppAuth(Mutex::new(AuthState::default())))
        .manage(DownloadCtl {
            child: Mutex::new(None),
            cancel: AtomicBool::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            download_youtube,
            cancel_download,
            estimate_download_size,
            get_auth,
            sign_in,
            sign_out
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
