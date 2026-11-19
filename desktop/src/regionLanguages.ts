/**
 * Region language packs (same rules as AI-forAll Tools browser).
 * EN default; HK = en+yue+zh; IN = EN + one geo/user; confirm before install.
 */

export type Lang = 'en' | 'yue' | 'zh' | 'ta' | 'hi' | 'ml' | 'kn' | 'te'
export type AppRegion = 'HK' | 'CN' | 'IN' | 'US' | 'OTHER'

export const LANGS: { id: Lang; label: string; short: string }[] = [
  { id: 'en', label: 'English', short: 'EN' },
  { id: 'yue', label: '粵語', short: '粵語' },
  { id: 'zh', label: '中文', short: '中文' },
  { id: 'ta', label: 'தமிழ்', short: 'TA' },
  { id: 'hi', label: 'हिन्दी', short: 'HI' },
  { id: 'ml', label: 'മലയാളം', short: 'ML' },
  { id: 'kn', label: 'ಕನ್ನಡ', short: 'KN' },
  { id: 'te', label: 'తెలుగు', short: 'TE' },
]

const STORAGE_REGION = 'tools-region'
const STORAGE_READY = 'tools-ready-langs'
const STORAGE_LANG = 'tools-lang'
const STORAGE_INIT = 'tools-lang-packs-initialized'

export type LangPackState = {
  region: AppRegion
  readyLangs: Lang[]
  lang: Lang
}

export function uniqueLangs(langs: Lang[]): Lang[] {
  const out: Lang[] = []
  for (const id of langs) {
    if (LANGS.some((l) => l.id === id) && !out.includes(id)) out.push(id)
  }
  if (!out.includes('en')) out.unshift('en')
  return out
}

export function isLang(id: string): id is Lang {
  return LANGS.some((l) => l.id === id)
}

function indiaCompanionFromDevice(deviceLang: Lang): Lang | null {
  if (deviceLang === 'en' || deviceLang === 'hi') return null
  if (deviceLang === 'ta' || deviceLang === 'te' || deviceLang === 'ml' || deviceLang === 'kn') {
    return deviceLang
  }
  return null
}

export function defaultReadyLangs(region: AppRegion, deviceLang: Lang): Lang[] {
  if (region === 'HK') return uniqueLangs(['en', 'yue', 'zh'])
  if (region === 'CN') return uniqueLangs(['en', 'zh'])
  if (region === 'IN') {
    const extra = indiaCompanionFromDevice(deviceLang)
    return extra ? uniqueLangs(['en', extra]) : ['en']
  }
  return ['en']
}

export function langFromLocale(locale: string): Lang {
  const code = (locale || 'en').toLowerCase().replace('_', '-')
  if (code.startsWith('yue') || code === 'zh-hk' || code.startsWith('zh-hk')) return 'yue'
  if (code.startsWith('zh')) return 'zh'
  if (code.startsWith('ta')) return 'ta'
  if (code.startsWith('hi')) return 'hi'
  if (code.startsWith('ml')) return 'ml'
  if (code.startsWith('kn')) return 'kn'
  if (code.startsWith('te')) return 'te'
  if (code.startsWith('en')) return 'en'
  const short = code.slice(0, 2)
  return isLang(short) ? short : 'en'
}

export function detectRegion(): AppRegion {
  const locale = (typeof navigator !== 'undefined' ? navigator.language : 'en').toLowerCase()
  const tz =
    typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone || '' : ''
  if (locale.includes('hk') || locale === 'zh-hk' || tz === 'Asia/Hong_Kong') return 'HK'
  if (
    locale.endsWith('-cn') ||
    locale === 'zh-cn' ||
    tz === 'Asia/Shanghai' ||
    tz === 'Asia/Chongqing' ||
    tz === 'Asia/Urumqi'
  ) {
    return 'CN'
  }
  if (
    locale.endsWith('-in') ||
    locale.startsWith('hi') ||
    locale.startsWith('ta') ||
    locale.startsWith('te') ||
    locale.startsWith('ml') ||
    locale.startsWith('kn') ||
    tz === 'Asia/Kolkata' ||
    tz === 'Asia/Calcutta'
  ) {
    return 'IN'
  }
  if (locale.endsWith('-us') || tz.startsWith('America/')) return 'US'
  return 'OTHER'
}

export function loadLangPackState(): LangPackState | null {
  try {
    if (localStorage.getItem(STORAGE_INIT) !== '1') return null
    const region = (localStorage.getItem(STORAGE_REGION) || 'OTHER') as AppRegion
    const readyRaw = localStorage.getItem(STORAGE_READY)
    let readyLangs: Lang[] = ['en']
    if (readyRaw) {
      const parsed = JSON.parse(readyRaw) as unknown
      const list = Array.isArray(parsed)
        ? parsed.filter((x): x is Lang => typeof x === 'string' && isLang(x))
        : []
      readyLangs = uniqueLangs(list.length ? list : ['en'])
    }
    const langRaw = localStorage.getItem(STORAGE_LANG) || 'en'
    const lang = isLang(langRaw) ? langRaw : 'en'
    return { region, readyLangs, lang: readyLangs.includes(lang) ? lang : 'en' }
  } catch {
    return null
  }
}

export function saveLangPackState(state: LangPackState): void {
  localStorage.setItem(STORAGE_REGION, state.region)
  localStorage.setItem(STORAGE_READY, JSON.stringify(uniqueLangs(state.readyLangs)))
  localStorage.setItem(STORAGE_LANG, state.lang)
  localStorage.setItem(STORAGE_INIT, '1')
}

export function initializeLangPacks(): LangPackState {
  const existing = loadLangPackState()
  if (existing) return existing
  const region = detectRegion()
  const deviceLang = langFromLocale(
    typeof navigator !== 'undefined' ? navigator.language : 'en',
  )
  const state: LangPackState = {
    region,
    readyLangs: defaultReadyLangs(region, deviceLang),
    lang: 'en',
  }
  saveLangPackState(state)
  return state
}

export function isReadyLang(readyLangs: Lang[], id: Lang): boolean {
  return readyLangs.includes(id)
}

export function readyLangsAfterInstall(
  region: AppRegion,
  _currentReady: Lang[],
  installing: Lang,
): Lang[] {
  if (installing === 'en') return uniqueLangs(['en'])
  if (region === 'HK' && (installing === 'yue' || installing === 'zh')) {
    return uniqueLangs(['en', 'yue', 'zh'])
  }
  if (region === 'HK') return uniqueLangs(['en', installing])
  if (region === 'CN' && installing === 'zh') return uniqueLangs(['en', 'zh'])
  return uniqueLangs(['en', installing])
}

export function langsToDrop(
  region: AppRegion,
  currentReady: Lang[],
  installing: Lang,
): Lang[] {
  const next = readyLangsAfterInstall(region, currentReady, installing)
  return currentReady.filter((id) => id !== 'en' && !next.includes(id))
}

export function regionLabel(region: AppRegion): string {
  switch (region) {
    case 'HK':
      return 'Hong Kong'
    case 'CN':
      return 'China'
    case 'IN':
      return 'India'
    case 'US':
      return 'USA'
    default:
      return 'Other'
  }
}

export async function downloadLanguagePack(lang: Lang): Promise<void> {
  await new Promise((r) => setTimeout(r, 400))
  try {
    localStorage.setItem(`tools-lang-pack:${lang}`, String(Date.now()))
  } catch {
    /* ignore */
  }
}
