# ytube-download

**Desktop app (Tauri)** — Download YouTube on Windows / Mac. Not a mobile product.

| Path | Role |
|---|---|
| `desktop/` | **Tauri app** (source of truth for the product) |
| Flutter folders (`lib/`, `android/`, …) | Legacy — ignore; will be removed |
| GitHub Actions → **Tauri desktop release** | Builds **Windows + macOS** installers |

## Your plan

1. Push this repo to your **personal GitHub** (can be public).
2. Actions builds installers → put EXE/DMG on Releases (personal first; move distribution account later).
3. Tools website download buttons point at those Release assets.

## EXE / Mac — do you need a Windows PC?

| Build | Where |
|---|---|
| Windows installer / EXE | **Windows PC** or **GitHub Actions `windows-latest`** (recommended). WSL cross-compile exists but is fragile — use Actions. |
| macOS app / DMG | **GitHub Actions `macos-latest`** (preferred; no local Mac). Cannot build from WSL/Windows. |
| Friendly download page | GitHub Pages `/docs` → https://aiandcyber.github.io/ytube-download/ (Windows/Mac buttons; auto-picks installer) |

**Recommended:** push → wait for Actions → download Release draft assets → double-click. No local Rust/Tauri required for testers.

## Develop (optional, on a machine with Rust + OS deps)

```bash
cd desktop
npm install
npm run tauri dev
```

Download uses **`yt-dlp` on PATH** (install separately for now; later we can bundle it).

### Auth0 callback on each user’s PC

Yes — use the **same** callback everywhere:

`http://127.0.0.1:54821/callback`

`127.0.0.1` is each user’s own computer. Auth0 redirects back to that machine after login. Register it once in the Auth0 application Allowed Callback URLs.

### Create Windows EXE + Mac app for GitHub

1. Push this repo to GitHub.
2. Open **Actions** → **Tauri desktop release** (runs on push to `main`, or click **Run workflow**).
3. When green, open the draft **Release** (or workflow artifacts) and download:
   - Windows: `.exe` / `.msi` / NSIS setup
   - macOS: `.dmg` / `.app` bundle
4. Attach those files to a GitHub Release for users (your personal repo first; move later).

Local alternative (this OS only): `cd desktop && npm run tauri build`

## Folder choice

App lives in **`desktop/`** inside this repo (not a separate repo). One public `ytube-download` repo for source + CI.
