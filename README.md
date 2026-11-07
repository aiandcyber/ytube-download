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
| macOS app / DMG | **Mac** or **GitHub Actions `macos-latest`**. Cannot build from WSL/Windows. |

**Recommended:** push → wait for Actions → download Release draft assets → double-click. No local Rust/Tauri required for testers.

## Develop (optional, on a machine with Rust + OS deps)

```bash
cd desktop
npm install
npm run tauri dev
```

Download uses **`yt-dlp` on PATH** (install separately for now; later we can bundle it).

Auth0 Sign-in / Free–Premium gates: next step (first download free, then same Auth0 as Tools).

## Folder choice

App lives in **`desktop/`** inside this repo (not a separate repo). One public `ytube-download` repo for source + CI.
