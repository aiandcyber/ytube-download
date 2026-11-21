import './agentPanel.css'
import {
  LANGS,
  type Lang,
  type LangPackState,
  downloadLanguagePack,
  initializeLangPacks,
  isReadyLang,
  langsToDrop,
  readyLangsAfterInstall,
  regionLabel,
  saveLangPackState,
} from './regionLanguages'

const DEFAULT_TOOLS_API = 'https://api.tools.ai-forall.org'

export type AgentPanelOptions = {
  mount: HTMLElement
  getAccessToken: () => Promise<string | null>
  toolsApiBase?: string
  /** Prefixed into the user message so the Tools agent knows which app. */
  productHint?: string
}

function langLabel(id: Lang): string {
  return LANGS.find((l) => l.id === id)?.label || id
}

function agentErrorFromHttp(status: number, detail: unknown): string {
  const reason =
    detail && typeof detail === 'object' && 'reason' in detail
      ? String((detail as { reason?: unknown }).reason || '').trim()
      : ''
  const text =
    typeof detail === 'string'
      ? detail.trim()
      : detail && typeof detail === 'object' && 'detail' in detail
        ? String((detail as { detail?: unknown }).detail || '').trim()
        : ''
  if (status === 401 || (status === 403 && reason !== 'tool_disabled')) {
    return 'Please sign in to use the Agent.'
  }
  if (status === 403 && reason === 'tool_disabled') {
    return 'The Agent is turned off right now. Please try again later.'
  }
  if (status === 402) {
    if (reason === 'daily_spend_cap') {
      return 'You reached the daily AI limit. Try again after 24 hours, or open Compare plans for more.'
    }
    if (reason === 'credits_exhausted' || reason === 'balance_exhausted') {
      return 'Your US$ balance is empty. Open Compare plans or top up to keep chatting.'
    }
    return 'Your free AI trial for chat is used up. Open Compare plans to subscribe or top up US$.'
  }
  if (status === 429) {
    return 'Too many Agent requests. Please wait a few minutes, then try again.'
  }
  if (status === 0 || status === 408) {
    return 'Could not reach the Agent. Check your connection and try again.'
  }
  if (status >= 500) {
    return 'The Agent had a technical problem. Please try again in a moment.'
  }
  if (text && text.length < 200 && !text.startsWith('{') && !text.includes('<')) return text
  return 'The Agent could not reply. Please try again.'
}

async function parseErrorDetail(res: Response): Promise<unknown> {
  const raw = await res.text().catch(() => '')
  if (!raw) return res.statusText
  try {
    const j = JSON.parse(raw) as { detail?: unknown }
    return j.detail ?? j
  } catch {
    return raw
  }
}

type SpeechRec = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((ev: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

function speechLang(code: Lang): string {
  const map: Record<string, string> = {
    en: 'en-US',
    yue: 'zh-HK',
    zh: 'zh-CN',
    ta: 'ta-IN',
    hi: 'hi-IN',
    ml: 'ml-IN',
    kn: 'kn-IN',
    te: 'te-IN',
    bn: 'bn-IN',
  }
  return map[code] || 'en-US'
}

export function mountAgentPanel(opts: AgentPanelOptions): { refreshAuthHint: () => void } {
  const apiBase = (opts.toolsApiBase || DEFAULT_TOOLS_API).replace(/\/$/, '')
  let pack: LangPackState = initializeLangPacks()
  let busy = false
  let speaking = false
  let listening = false
  let speakReplies = true
  let pendingLang: Lang | null = null
  let recognition: SpeechRec | null = null
  let fileCount = 0
  let speechUtter: SpeechSynthesisUtterance | null = null

  const root = document.createElement('aside')
  root.className = 'agent-panel'
  root.innerHTML = `
    <div class="agent-panel-header">
      <div class="agent-title">
        <span class="agent-avatar" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <rect x="5" y="8" width="14" height="11" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.7" />
            <circle cx="9.2" cy="13" r="1.35" fill="currentColor" />
            <circle cx="14.8" cy="13" r="1.35" fill="currentColor" />
            <path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M10 16.2h4" />
            <path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M12 4.2v2.4M8.2 5.6l1.2 1.5M15.8 5.6l-1.2 1.5" />
          </svg>
        </span>
        <div class="agent-title-copy">
          <p class="agent-kicker">AI Agent <span class="agent-beta">Beta</span></p>
          <h2>Your AI assistant</h2>
        </div>
      </div>
      <div class="agent-header-actions">
        <label class="agent-speak">
          <span>Speak replies</span>
          <input type="checkbox" id="agent-speak" checked />
        </label>
        <label class="agent-lang-field">
          <span>Language</span>
          <select id="agent-lang-select" aria-label="Language"></select>
        </label>
      </div>
    </div>
    <div class="agent-messages" id="agent-messages">
      <div class="agent-msg empty-thread" id="agent-empty">Ask your AI assistant to help with this app…</div>
    </div>
    <form class="agent-composer" id="agent-form">
      <textarea id="agent-input" rows="2" placeholder="Ask your AI assistant to help with this app…" autocomplete="off"></textarea>
      <input class="agent-files-input" id="agent-files" type="file" multiple />
      <p class="agent-files-hint" id="agent-files-hint" hidden></p>
      <div class="agent-composer-actions">
        <button type="button" class="agent-icon-btn" id="agent-attach" aria-label="Files" title="Files">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button type="button" class="agent-icon-btn" id="agent-mic" aria-label="Voice" title="Voice">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z" />
            <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
        </button>
        <div class="agent-composer-spacer"></div>
        <button type="button" class="agent-stop-btn" id="agent-stop" hidden>Stop</button>
        <button type="submit" class="agent-send-btn" id="agent-send" aria-label="Send" title="Send" disabled>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 19V5M6 11l6-6 6 6" />
          </svg>
        </button>
      </div>
    </form>
    <div class="agent-modal-backdrop" id="agent-lang-modal" role="dialog" aria-modal="true">
      <div class="agent-modal">
        <h3>Download language pack?</h3>
        <p id="agent-lang-modal-body"></p>
        <div class="agent-modal-actions">
          <button type="button" id="agent-lang-no">No</button>
          <button type="button" class="primary" id="agent-lang-yes">Yes</button>
        </div>
      </div>
    </div>
  `
  opts.mount.appendChild(root)

  const messagesEl = root.querySelector('#agent-messages') as HTMLElement
  const emptyEl = root.querySelector('#agent-empty') as HTMLElement
  const inputEl = root.querySelector('#agent-input') as HTMLTextAreaElement
  const sendBtn = root.querySelector('#agent-send') as HTMLButtonElement
  const stopBtn = root.querySelector('#agent-stop') as HTMLButtonElement
  const formEl = root.querySelector('#agent-form') as HTMLFormElement
  const langSelect = root.querySelector('#agent-lang-select') as HTMLSelectElement
  const speakChk = root.querySelector('#agent-speak') as HTMLInputElement
  const modal = root.querySelector('#agent-lang-modal') as HTMLElement
  const modalBody = root.querySelector('#agent-lang-modal-body') as HTMLElement
  const langYes = root.querySelector('#agent-lang-yes') as HTMLButtonElement
  const langNo = root.querySelector('#agent-lang-no') as HTMLButtonElement
  const filesInput = root.querySelector('#agent-files') as HTMLInputElement
  const filesHint = root.querySelector('#agent-files-hint') as HTMLElement
  const attachBtn = root.querySelector('#agent-attach') as HTMLButtonElement
  const micBtn = root.querySelector('#agent-mic') as HTMLButtonElement

  function syncSendEnabled() {
    sendBtn.disabled = busy || !inputEl.value.trim()
  }

  function syncStopVisible() {
    const show = busy || speaking
    stopBtn.hidden = !show
    sendBtn.hidden = show
  }

  function stopSpeech() {
    speaking = false
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
    speechUtter = null
    syncStopVisible()
  }

  async function speakText(text: string) {
    if (!speakReplies || !text.trim()) return
    stopSpeech()
    speaking = true
    syncStopVisible()
    const token = await opts.getAccessToken()
    try {
      if (token) {
        const res = await fetch(`${apiBase}/api/tts`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg, audio/*, */*',
          },
          body: JSON.stringify({ text, language: pack.lang }),
        })
        if (res.ok) {
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          const audio = new Audio(url)
          audio.onended = () => {
            URL.revokeObjectURL(url)
            speaking = false
            syncStopVisible()
          }
          audio.onerror = () => {
            URL.revokeObjectURL(url)
            speaking = false
            syncStopVisible()
          }
          await audio.play()
          return
        }
      }
    } catch {
      /* fall through to browser TTS */
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      speechUtter = new SpeechSynthesisUtterance(text)
      speechUtter.lang = speechLang(pack.lang)
      speechUtter.onend = () => {
        speaking = false
        syncStopVisible()
      }
      speechUtter.onerror = () => {
        speaking = false
        syncStopVisible()
      }
      window.speechSynthesis.speak(speechUtter)
      return
    }
    speaking = false
    syncStopVisible()
  }

  function appendMsg(role: 'user' | 'assistant' | 'system', text: string): HTMLElement {
    emptyEl?.remove()
    const el = document.createElement('div')
    el.className = `agent-msg ${role}`
    el.textContent = text
    messagesEl.appendChild(el)
    messagesEl.scrollTop = messagesEl.scrollHeight
    return el
  }

  function renderLangSelect() {
    langSelect.innerHTML = ''
    for (const l of LANGS) {
      const opt = document.createElement('option')
      opt.value = l.id
      const ready = isReadyLang(pack.readyLangs, l.id)
      opt.textContent = ready ? l.label : `${l.label} (pack)`
      if (l.id === pack.lang) opt.selected = true
      langSelect.appendChild(opt)
    }
  }

  function openConfirm(next: Lang) {
    pendingLang = next
    const drops = langsToDrop(pack.region, pack.readyLangs, next)
    const dropNote =
      drops.length > 0
        ? ` This will replace ready pack(s): ${drops.map(langLabel).join(', ')}.`
        : ''
    modalBody.textContent =
      `Download the ${langLabel(next)} language pack for region ${regionLabel(pack.region)}?` +
      dropNote +
      ' English stays ready.'
    modal.classList.add('open')
  }

  async function applyLang(next: Lang, install: boolean) {
    if (install) {
      await downloadLanguagePack(next)
      pack = {
        ...pack,
        readyLangs: readyLangsAfterInstall(pack.region, pack.readyLangs, next),
        lang: next,
      }
    } else {
      pack = { ...pack, lang: next }
    }
    saveLangPackState(pack)
    renderLangSelect()
  }

  async function onPickLang(next: Lang) {
    if (next === pack.lang) return
    if (isReadyLang(pack.readyLangs, next)) {
      await applyLang(next, false)
      return
    }
    openConfirm(next)
  }

  langYes.addEventListener('click', async () => {
    const next = pendingLang
    pendingLang = null
    modal.classList.remove('open')
    if (!next) return
    langYes.disabled = true
    try {
      await applyLang(next, true)
    } finally {
      langYes.disabled = false
      renderLangSelect()
    }
  })
  langNo.addEventListener('click', () => {
    pendingLang = null
    modal.classList.remove('open')
    renderLangSelect()
  })

  langSelect.addEventListener('change', () => {
    const next = langSelect.value as Lang
    void onPickLang(next).then(() => {
      if (pendingLang) renderLangSelect()
    })
  })

  speakChk.addEventListener('change', () => {
    speakReplies = speakChk.checked
    if (!speakReplies) stopSpeech()
  })

  attachBtn.addEventListener('click', () => filesInput.click())
  filesInput.addEventListener('change', () => {
    fileCount = filesInput.files?.length || 0
    if (fileCount > 0) {
      filesHint.hidden = false
      filesHint.textContent = `${fileCount} file${fileCount === 1 ? '' : 's'} attached`
    } else {
      filesHint.hidden = true
      filesHint.textContent = ''
    }
  })

  stopBtn.addEventListener('click', () => {
    busy = false
    stopSpeech()
    if (recognition && listening) {
      try {
        recognition.stop()
      } catch {
        /* ignore */
      }
    }
    listening = false
    micBtn.classList.remove('listening')
    syncSendEnabled()
    syncStopVisible()
  })

  micBtn.addEventListener('click', () => {
    const SR =
      (window as unknown as { SpeechRecognition?: new () => SpeechRec }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition
    if (!SR) {
      appendMsg('system', 'Voice input is not supported in this window.')
      return
    }
    if (listening && recognition) {
      recognition.stop()
      return
    }
    recognition = new SR()
    recognition.lang = speechLang(pack.lang)
    recognition.continuous = false
    recognition.interimResults = false
    recognition.onresult = (ev) => {
      const transcript = ev.results?.[0]?.[0]?.transcript || ''
      if (transcript) {
        inputEl.value = (inputEl.value ? `${inputEl.value} ` : '') + transcript
        syncSendEnabled()
      }
    }
    recognition.onerror = () => {
      listening = false
      micBtn.classList.remove('listening')
    }
    recognition.onend = () => {
      listening = false
      micBtn.classList.remove('listening')
    }
    listening = true
    micBtn.classList.add('listening')
    recognition.start()
  })

  inputEl.addEventListener('input', syncSendEnabled)

  async function consumeSse(
    body: ReadableStream<Uint8Array>,
    onDelta: (text: string) => void,
  ): Promise<string> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let reply = ''
    const handleBlock = (part: string) => {
      const data = part
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('')
      if (!data) return
      let event: { type?: string; text?: string; detail?: string; reply?: string }
      try {
        event = JSON.parse(data)
      } catch {
        return
      }
      if (event.type === 'delta' && event.text) {
        reply += event.text
        onDelta(event.text)
      } else if (event.type === 'done' && event.reply && !reply) {
        reply = event.reply
        onDelta(event.reply)
      } else if (event.type === 'error') {
        throw new Error(agentErrorFromHttp(502, event.detail || event))
      }
    }
    const consume = (chunk: string, flush: boolean) => {
      buffer += chunk
      const parts = buffer.split('\n\n')
      if (flush) {
        buffer = ''
        for (const part of parts) handleBlock(part)
        return
      }
      buffer = parts.pop() || ''
      for (const part of parts) handleBlock(part)
    }
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        consume(decoder.decode(), true)
        break
      }
      consume(decoder.decode(value, { stream: true }), false)
    }
    return reply
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    const token = await opts.getAccessToken()
    if (!token) {
      appendMsg('system', 'Please sign in to use the Agent.')
      return
    }
    busy = true
    syncSendEnabled()
    syncStopVisible()
    appendMsg('user', trimmed)
    inputEl.value = ''
    const assistantEl = appendMsg('assistant', '…')
    let acc = ''

    const payload =
      opts.productHint != null && opts.productHint !== ''
        ? `[App context: ${opts.productHint}]\n\n${trimmed}`
        : trimmed

    try {
      const fd = new FormData()
      fd.append('message', payload)
      fd.append('language', pack.lang)
      fd.append('stream', '1')
      if (filesInput.files) {
        for (const file of Array.from(filesInput.files)) {
          fd.append('files', file)
        }
      }
      const res = await fetch(`${apiBase}/api/chat`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'text/event-stream',
        },
        body: fd,
      })
      if (!res.ok) {
        const detail = await parseErrorDetail(res)
        assistantEl.textContent = agentErrorFromHttp(res.status, detail)
        return
      }
      const ctype = res.headers.get('content-type') || ''
      if (ctype.includes('text/event-stream') && res.body) {
        assistantEl.textContent = ''
        assistantEl.classList.add('is-streaming')
        const reduceMotion =
          typeof window !== 'undefined' &&
          window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
        const queue: string[] = []
        let typing = false
        const delay = reduceMotion ? 0 : 38
        const pump = async () => {
          if (typing) return
          typing = true
          while (queue.length) {
            const next = queue.shift() as string
            assistantEl.textContent = (assistantEl.textContent || '') + next
            messagesEl.scrollTop = messagesEl.scrollHeight
            if (delay) await new Promise((r) => setTimeout(r, delay))
          }
          typing = false
          if (queue.length) void pump()
        }
        const tokenize = (chunk: string): string[] => {
          if (!chunk) return []
          if (reduceMotion) return [chunk]
          if (/\s/.test(chunk) || /[A-Za-z]/.test(chunk)) {
            return chunk.match(/\S+\s*|\s+/g) ?? [chunk]
          }
          return Array.from(chunk)
        }
        acc = await consumeSse(res.body, (piece) => {
          acc += piece
          queue.push(...tokenize(piece))
          void pump()
        })
        while (queue.length || typing) {
          await new Promise((r) => setTimeout(r, reduceMotion ? 0 : 16))
        }
        assistantEl.classList.remove('is-streaming')
        if (!acc) assistantEl.textContent = '(empty reply)'
      } else {
        const data = (await res.json()) as { reply?: string; message?: string; text?: string }
        acc = data.reply || data.message || data.text || JSON.stringify(data)
        assistantEl.textContent = acc
      }
      filesInput.value = ''
      fileCount = 0
      filesHint.hidden = true
      if (acc) void speakText(acc)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const lower = msg.toLowerCase()
      if (
        lower.includes('failed to fetch') ||
        lower.includes('networkerror') ||
        lower.includes('load failed')
      ) {
        assistantEl.textContent = 'Could not reach the Agent. Check your connection and try again.'
      } else if (lower.includes('assistant error') || lower.includes('type": "error"')) {
        assistantEl.textContent = 'The Agent had a technical problem. Please try again in a moment.'
      } else {
        assistantEl.textContent = msg.length < 220 ? msg : 'The Agent could not reply. Please try again.'
      }
    } finally {
      busy = false
      syncSendEnabled()
      syncStopVisible()
      inputEl.focus()
    }
  }

  formEl.addEventListener('submit', (e) => {
    e.preventDefault()
    void sendMessage(inputEl.value)
  })

  renderLangSelect()
  syncSendEnabled()
  syncStopVisible()

  return {
    refreshAuthHint() {
      /* reserved */
    },
  }
}
