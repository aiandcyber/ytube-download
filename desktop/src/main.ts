import { invoke } from "@tauri-apps/api/core";

type DownloadResult = { path: string; message: string };
type AuthInfo = { signed_in: boolean; email: string | null };

let audioOnly = false;

function setStatus(text: string, kind: "ok" | "err" | "" = "") {
  const el = document.querySelector("#status");
  if (!el) return;
  el.textContent = text;
  el.className = `status${kind ? ` ${kind}` : ""}`;
}

function renderAuth(info: AuthInfo) {
  const label = document.querySelector("#account-label");
  const btn = document.querySelector<HTMLButtonElement>("#auth-btn");
  if (label) {
    label.textContent = info.signed_in
      ? info.email || "Signed in"
      : "Not signed in";
  }
  if (btn) {
    btn.textContent = info.signed_in ? "Sign out" : "Sign in";
  }
}

async function refreshAuth() {
  try {
    const info = await invoke<AuthInfo>("get_auth");
    renderAuth(info);
  } catch {
    renderAuth({ signed_in: false, email: null });
  }
}

async function toggleAuth() {
  const btn = document.querySelector<HTMLButtonElement>("#auth-btn");
  if (btn) btn.disabled = true;
  setStatus("");
  try {
    const current = await invoke<AuthInfo>("get_auth");
    const info = current.signed_in
      ? await invoke<AuthInfo>("sign_out")
      : await invoke<AuthInfo>("sign_in");
    renderAuth(info);
    if (info.signed_in) setStatus("Signed in.", "ok");
  } catch (err) {
    setStatus(String(err), "err");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function runDownload() {
  const input = document.querySelector<HTMLInputElement>("#url");
  const btn = document.querySelector<HTMLButtonElement>("#run");
  const url = (input?.value || "").trim();
  if (!url) {
    setStatus("Paste a YouTube link.", "err");
    return;
  }
  if (btn) btn.disabled = true;
  setStatus("Preparing download…");
  try {
    const result = await invoke<DownloadResult>("download_youtube", {
      url,
      audioOnly,
    });
    setStatus(`${result.message}\n${result.path}`, "ok");
  } catch (err) {
    setStatus(String(err), "err");
  } finally {
    if (btn) btn.disabled = false;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const mp4 = document.querySelector("#mode-mp4");
  const mp3 = document.querySelector("#mode-mp3");
  mp4?.addEventListener("click", () => {
    audioOnly = false;
    mp4.classList.add("on");
    mp3?.classList.remove("on");
  });
  mp3?.addEventListener("click", () => {
    audioOnly = true;
    mp3.classList.add("on");
    mp4?.classList.remove("on");
  });
  document.querySelector("#run")?.addEventListener("click", () => void runDownload());
  document.querySelector("#auth-btn")?.addEventListener("click", () => void toggleAuth());
  void refreshAuth();
});
