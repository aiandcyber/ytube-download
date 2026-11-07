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

## Get a Windows EXE (no Flutter commands on your PC)

This environment cannot build a `.exe` (needs Windows + Visual Studio). Use **GitHub Actions** instead:

1. Push this repo to your **personal** GitHub.
2. Open **Actions** → workflow **Build Windows EXE** → wait until green.
3. Download the artifact **`ytube-download-windows`** (a zip).
4. Unzip → double-click **`ytube_download.exe`**.

That folder is what you later upload to the **distribution** GitHub account Releases for website users.

Auth0 callback (for Sign in after the free first download):

`http://127.0.0.1:54821/callback`

### Is an EXE ready right now?

**Not in this folder yet** — no Release binary has been built. After you push and the Action finishes, you will have a double-click EXE.

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
