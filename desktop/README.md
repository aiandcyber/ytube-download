# YouTube Download (Tauri)

Product UI + Rust backend for Windows and macOS.

```bash
npm install
npm run tauri dev    # needs Rust + platform WebView deps
npm run tauri build  # native installer for *this* OS only
```

CI builds both platforms from the repo root workflow `.github/workflows/tauri-release.yml`.
