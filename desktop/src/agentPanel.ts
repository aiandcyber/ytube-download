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
        throw new Error(event.detail || 'Assistant error')
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
      appendMsg('system', 'Sign in to use the AI agent.')
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
        const errText = await res.text().catch(() => res.statusText)
        assistantEl.textContent = `Error (${res.status}): ${errText.slice(0, 240)}`
        return
      }
      const ctype = res.headers.get('content-type') || ''
      if (ctype.includes('text/event-stream') && res.body) {
        assistantEl.textContent = ''
        acc = await consumeSse(res.body, (piece) => {
          acc += piece
          assistantEl.textContent = acc
          messagesEl.scrollTop = messagesEl.scrollHeight
        })
        if (!acc) assistantEl.textContent = '(empty reply)'
      } else {
        const data = (await res.json()) as { reply?: string; message?: string; text?: string }
        assistantEl.textContent = data.reply || data.message || data.text || JSON.stringify(data)
      }
    } catch (e) {
      assistantEl.textContent = e instanceof Error ? e.message : String(e)
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
