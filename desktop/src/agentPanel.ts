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

/** Clear Agent direction — not one generic “unavailable” line. */
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

export function mountAgentPanel(opts: AgentPanelOptions): { refreshAuthHint: () => void } {
  const apiBase = (opts.toolsApiBase || DEFAULT_TOOLS_API).replace(/\/$/, '')
  let pack: LangPackState = initializeLangPacks()
  let busy = false
  let pendingLang: Lang | null = null

  const root = document.createElement('aside')
  root.className = 'agent-panel'
  root.innerHTML = `
    <div class="agent-panel-header">
      <span class="agent-panel-title">AI Agent</span>
      <div class="agent-lang-wrap">
        <button type="button" class="agent-lang-btn" id="agent-lang-btn" aria-haspopup="listbox"></button>
        <div class="agent-lang-menu" id="agent-lang-menu" role="listbox"></div>
      </div>
    </div>
    <div class="agent-messages" id="agent-messages"></div>
    <form class="agent-composer" id="agent-form">
      <input type="text" id="agent-input" placeholder="Ask about this app…" autocomplete="off" />
      <button type="submit" id="agent-send">Send</button>
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
  const inputEl = root.querySelector('#agent-input') as HTMLInputElement
  const sendBtn = root.querySelector('#agent-send') as HTMLButtonElement
  const formEl = root.querySelector('#agent-form') as HTMLFormElement
  const langBtn = root.querySelector('#agent-lang-btn') as HTMLButtonElement
  const langMenu = root.querySelector('#agent-lang-menu') as HTMLElement
  const modal = root.querySelector('#agent-lang-modal') as HTMLElement
  const modalBody = root.querySelector('#agent-lang-modal-body') as HTMLElement
  const langYes = root.querySelector('#agent-lang-yes') as HTMLButtonElement
  const langNo = root.querySelector('#agent-lang-no') as HTMLButtonElement

  function appendMsg(role: 'user' | 'assistant' | 'system', text: string): HTMLElement {
    const el = document.createElement('div')
    el.className = `agent-msg ${role}`
    el.textContent = text
    messagesEl.appendChild(el)
    messagesEl.scrollTop = messagesEl.scrollHeight
    return el
  }

  function renderLangMenu() {
    langBtn.textContent = langLabel(pack.lang)
    langMenu.innerHTML = ''
    for (const l of LANGS) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'agent-lang-item' + (l.id === pack.lang ? ' active' : '')
      btn.setAttribute('role', 'option')
      const ready = isReadyLang(pack.readyLangs, l.id)
      btn.innerHTML = `<span>${l.label}</span><span class="agent-lang-badge">${ready ? 'Ready' : 'Pack'}</span>`
      btn.addEventListener('click', () => {
        langMenu.classList.remove('open')
        void onPickLang(l.id)
      })
      langMenu.appendChild(btn)
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
    renderLangMenu()
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
    }
  })
  langNo.addEventListener('click', () => {
    pendingLang = null
    modal.classList.remove('open')
  })

  langBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    langMenu.classList.toggle('open')
  })
  document.addEventListener('click', () => langMenu.classList.remove('open'))

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
    sendBtn.disabled = true
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
        assistantEl.textContent = data.reply || data.message || data.text || JSON.stringify(data)
      }
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
      sendBtn.disabled = false
      inputEl.focus()
    }
  }

  formEl.addEventListener('submit', (e) => {
    e.preventDefault()
    void sendMessage(inputEl.value)
  })

  appendMsg(
    'system',
    `Language packs: ${regionLabel(pack.region)} · ready ${pack.readyLangs.map(langLabel).join(', ')}`,
  )
  renderLangMenu()

  return {
    refreshAuthHint() {
      /* reserved */
    },
  }
}
