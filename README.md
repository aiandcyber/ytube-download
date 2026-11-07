# ytube-download

YouTube → MP4 / MP3 **on this device** (Windows + Mac). No server YouTube download.

## Repos (two places)

| What | Where |
|---|---|
| **Source code** (this project) | Your **personal** GitHub repo (sync/push from here) |
| **EXE / Mac zip + short README for users** | A **separate distribution** GitHub account/repo (when ready). Tools website download buttons point there. |

Do **not** host installers on GCP if egress cost matters. GitHub Releases on the distribution account is the free host.

## Auth (Auth0 only)

- Same Auth0 tenant/audience as Tools.
- **First download free** (Sign in optional at start).
- Later downloads require **Auth0 Sign in** in the app (no activation keys).

In Auth0 → Applications → Tools SPA (or a Native app), add Allowed Callback URL:

`http://127.0.0.1:54821/callback`

Also add Allowed Logout / Origins for `http://127.0.0.1:54821` if Auth0 asks.

## Test on your Windows laptop (local)

Needs **Flutter for Windows** + **Visual Studio 2022** “Desktop development with C++”. Build on Windows, not WSL.

```
# Copy or clone this folder onto Windows, then in PowerShell:
cd C:\path\to\ytube-download
flutter pub get
flutter run -d windows
```

Release EXE:

```
flutter build windows
# → build\windows\x64\runner\Release\ytube_download.exe
```

Against **local** Tools API (optional):

```
flutter run -d windows --dart-define=API_BASE=http://127.0.0.1:8000
```

(Requires entitlement.dart to read API_BASE — default is production `https://api.tools.ai-forall.org`.)

### Is it ready to test?

**Yes for download on Windows** after `flutter run -d windows` (first free download works without Sign in).

**Sign in / Free-Premium after first download** needs Auth0 callback URL added (above) and the Tools API reachable.

**Website “Download for Windows”** is **not** ready until you upload a Release zip on the distribution GitHub account.

## Mac

```
flutter create . --platforms=macos
flutter pub get
flutter run -d macos
flutter build macos
```

## Entitlement API

`POST {API}/api/control/authorize`  
Body: `{"tool_id":"youtube_download","action":"run","commit":true}`  
Headers: `Authorization: Bearer <Auth0 access token>` and `X-Device-Id: <stable device id>` for the free first download.
