# YouTube Download (Tauri)

Product UI + Rust backend for Windows and macOS.

```bash
npm install
npm run tauri dev    # needs Rust + platform WebView deps
npm run tauri build  # native installer for *this* OS only
```

Repo workflow `.github/workflows/tauri-release.yml` builds Windows + macOS on push to `main` (or manual run). User download page: https://aiandcyber.github.io/ytube-download/
