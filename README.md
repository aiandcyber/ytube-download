# ytube-download

YouTube → MP4 / MP3 **on this device** (Windows + Mac). No server YouTube download.

Product rules (Tools Feature List, 2026-11-07):

- Available from the **browser Tools site** as desktop installers — **not** as a mobile app product.
- Same Auth0 account as Tools, **or** an activation key from **Profile → Desktop YouTube activation key**.
- **First download free**; further downloads follow Free / Premium via Tools API (`youtube_download`).
- App start login is **optional**.
- Ship **signed** builds + **SHA-256** on the release page (anti-tamper is signing + server entitlement, not DRM).

## Free hosting (not GCP)

Do **not** put installers on paid GCP buckets if egress costs matter.

Prefer **GitHub Releases** (free for public binaries):

1. Create repo `aiandcyber/ytube-download` (or private + release assets).
2. Upload `ytube-download-windows.zip` / `ytube-download-macos.dmg` + `SHA256SUMS`.
3. Tools website links: `https://github.com/aiandcyber/ytube-download/releases`

Hugging Face file hosting is a backup if GitHub is unsuitable.

## Windows EXE

Needs Flutter for Windows + VS 2022 C++ workload. **Do not build from WSL.**

```
cd C:\path\to\ytube-download
flutter pub get
flutter run -d windows
flutter build windows
```

Release EXE: `build\windows\x64\runner\Release\ytube_download.exe`

## Mac

```
flutter create . --platforms=macos
flutter pub get
flutter run -d macos
flutter build macos
```

## Entitlement API

After the first local free download, the app calls:

`POST {API}/api/control/authorize` with JSON `{"tool_id":"youtube_download","commit":true}`

Headers: `Authorization: Bearer <Auth0>` and/or `X-Device-Key: <key from Profile>`.

Default API base: `https://api.tools.ai-forall.org`.
