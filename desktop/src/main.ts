import { invoke } from "@tauri-apps/api/core";

type DownloadResult = { path: string; message: string };

let audioOnly = false;

function setStatus(text: string, kind: "ok" | "err" | "" = "") {
  const el = document.querySelector("#status");
  if (!el) return;
  el.textContent = text;
  el.className = `status${kind ? ` ${kind}` : ""}`;
}

async function runDownload() {
  const input = document.querySelector<HTMLInputElement>("#url");
  const btn = document.querySelector<HTMLButtonElement>("#run");
  const url = (input?.value || "").trim();
  if (!url) {
    setStatus("Paste a YouTube URL.", "err");
    return;
  }
  if (btn) btn.disabled = true;
  setStatus("Downloading…");
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
});
