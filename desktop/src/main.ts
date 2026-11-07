import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

type DownloadResult = { path: string; message: string };
type AuthInfo = { signed_in: boolean; email: string | null };
type SizeEstimate = { bytes: number; label: string; approximate: boolean };

const VIDEO_QUALITIES = [
  { id: "360", label: "360p" },
  { id: "480", label: "480p" },
  { id: "720", label: "720p" },
  { id: "1080", label: "1080p" },
  { id: "best", label: "Best available" },
];

const AUDIO_QUALITIES = [
  { id: "128", label: "128 kbps" },
  { id: "192", label: "192 kbps" },
  { id: "256", label: "256 kbps" },
  { id: "320", label: "320 kbps" },
];

let audioOnly = false;
let busy = false;
let estimateTimer: number | undefined;
let estimateSeq = 0;
const SAVE_KEY = "ytube-save-dir";

function setStatus(text: string, kind: "ok" | "err" | "" = "") {
  const el = document.querySelector("#status");
  if (!el) return;
  el.textContent = text;
  el.className = `status${kind ? ` ${kind}` : ""}`;
}

function setEstimate(text: string, kind: "ready" | "err" | "" = "") {
  const el = document.querySelector("#size-estimate");
  if (!el) return;
  el.textContent = text;
  el.className = `estimate${kind ? ` ${kind}` : ""}`;
}

function fillQuality() {
  const select = document.querySelector<HTMLSelectElement>("#quality");
  const label = document.querySelector("#quality-label");
  if (!select) return;
  const options = audioOnly ? AUDIO_QUALITIES : VIDEO_QUALITIES;
  const preferred = audioOnly ? "192" : "720";
  select.innerHTML = options
    .map((o) => `<option value="${o.id}"${o.id === preferred ? " selected" : ""}>${o.label}</option>`)
    .join("");
  if (label) label.textContent = audioOnly ? "Audio quality" : "Video quality";
}

function setBusy(next: boolean) {
  busy = next;
  const run = document.querySelector<HTMLButtonElement>("#run");
  const cancel = document.querySelector<HTMLButtonElement>("#cancel");
  if (run) {
    run.disabled = next;
    run.textContent = next ? "Downloading…" : "Download";
  }
  cancel?.classList.toggle("hidden", !next);
}

function renderAuth(info: AuthInfo) {
  const label = document.querySelector("#account-label");
  const btn = document.querySelector<HTMLButtonElement>("#auth-btn");
  if (label) {
    label.textContent = info.signed_in ? info.email || "Signed in" : "Not signed in";
  }
  if (btn) btn.textContent = info.signed_in ? "Sign out" : "Sign in";
}

async function refreshAuth() {
  try {
    renderAuth(await invoke<AuthInfo>("get_auth"));
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

async function pickFolder() {
  try {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string" && selected) {
      const input = document.querySelector<HTMLInputElement>("#save-dir");
      if (input) input.value = selected;
      localStorage.setItem(SAVE_KEY, selected);
    }
  } catch (err) {
    setStatus(String(err), "err");
  }
}

function scheduleEstimate() {
  window.clearTimeout(estimateTimer);
  estimateTimer = window.setTimeout(() => {
    void refreshEstimate();
  }, 550);
}

async function refreshEstimate() {
  const input = document.querySelector<HTMLInputElement>("#url");
  const quality = document.querySelector<HTMLSelectElement>("#quality");
  const url = (input?.value || "").trim();
  if (!url) {
    setEstimate("");
    return;
  }
  if (!url.includes("youtube.com") && !url.includes("youtu.be")) {
    setEstimate("Paste a valid YouTube link to estimate size.", "err");
    return;
  }

  const seq = ++estimateSeq;
  setEstimate("Estimating file size…");
  try {
    const result = await invoke<SizeEstimate>("estimate_download_size", {
      url,
      audioOnly,
      quality: quality?.value || (audioOnly ? "192" : "720"),
    });
    if (seq !== estimateSeq) return;
    setEstimate(`Estimated size: ${result.label}`, "ready");
  } catch (err) {
    if (seq !== estimateSeq) return;
    const msg = String(err);
    setEstimate(msg.split("\n")[0] || "Size estimate unavailable.", "err");
  }
}

async function runDownload() {
  if (busy) return;
  const input = document.querySelector<HTMLInputElement>("#url");
  const quality = document.querySelector<HTMLSelectElement>("#quality");
  const saveDir = document.querySelector<HTMLInputElement>("#save-dir");
  const url = (input?.value || "").trim();
  if (!url) {
    setStatus("Paste a YouTube link.", "err");
    return;
  }
  setBusy(true);
  setStatus("Downloading…");
  try {
    const result = await invoke<DownloadResult>("download_youtube", {
      url,
      audioOnly,
      quality: quality?.value || (audioOnly ? "192" : "720"),
      saveDir: saveDir?.value?.trim() || null,
    });
    setStatus(`${result.message}\n${result.path}`, "ok");
  } catch (err) {
    const msg = String(err);
    setStatus(msg, msg.toLowerCase().includes("cancel") ? "" : "err");
  } finally {
    setBusy(false);
  }
}

async function cancelDownload() {
  try {
    await invoke("cancel_download");
    setStatus("Cancelling…");
  } catch (err) {
    setStatus(String(err), "err");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const mp4 = document.querySelector("#mode-mp4");
  const mp3 = document.querySelector("#mode-mp3");
  const saved = localStorage.getItem(SAVE_KEY);
  const saveInput = document.querySelector<HTMLInputElement>("#save-dir");
  if (saved && saveInput) saveInput.value = saved;

  fillQuality();
  mp4?.addEventListener("click", () => {
    audioOnly = false;
    mp4.classList.add("on");
    mp3?.classList.remove("on");
    fillQuality();
    scheduleEstimate();
  });
  mp3?.addEventListener("click", () => {
    audioOnly = true;
    mp3.classList.add("on");
    mp4?.classList.remove("on");
    fillQuality();
    scheduleEstimate();
  });
  document.querySelector("#quality")?.addEventListener("change", () => scheduleEstimate());
  document.querySelector("#url")?.addEventListener("input", () => scheduleEstimate());
  document.querySelector("#run")?.addEventListener("click", () => void runDownload());
  document.querySelector("#cancel")?.addEventListener("click", () => void cancelDownload());
  document.querySelector("#pick-folder")?.addEventListener("click", () => void pickFolder());
  document.querySelector("#auth-btn")?.addEventListener("click", () => void toggleAuth());
  void refreshAuth();
});
