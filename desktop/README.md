# YouTube Download (Tauri)

Product UI + Rust backend for Windows and macOS.

```bash
npm install
npm run tauri dev    # needs Rust + platform WebView deps
npm run tauri build  # native installer for *this* OS only
```

CI (repo root `.github/workflows/tauri-release.yml`) builds **Windows + macOS** on push to `main` / `workflow_dispatch`. No local Mac required; Mac artifacts are unsigned until Apple notarization is configured.
