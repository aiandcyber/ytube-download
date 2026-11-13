function scoreWindows(name) {
  const n = String(name || '').toLowerCase()
  if (n.endsWith('.sig') || n.endsWith('.json') || n.includes('sha256')) return -1
  if (n.includes('setup') && n.endsWith('.exe')) return 100
  if (n.endsWith('.exe')) return 90
  if (n.endsWith('.msi')) return 80
  return -1
}

function scoreMac(name) {
  const n = String(name || '').toLowerCase()
  if (n.endsWith('.sig') || n.endsWith('.json') || n.includes('sha256')) return -1
  if (n.endsWith('.dmg') && (n.includes('aarch64') || n.includes('arm64'))) return 100
  if (n.endsWith('.dmg') && n.includes('universal')) return 95
  if (n.endsWith('.dmg')) return 90
  if (n.includes('app.tar.gz')) return 60
  return -1
}

function pickAsset(assets, os) {
  const score = os === 'windows' ? scoreWindows : scoreMac
  let best = null
  let bestScore = -1
  for (const asset of assets || []) {
    const s = score(asset.name)
    if (s > bestScore) {
      best = asset
      bestScore = s
    }
  }
  return bestScore >= 0 ? best : null
}

async function downloadOs(api, os) {
  const res = await fetch(api, { headers: { Accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error('unavailable')
  const data = await res.json()
  const asset = pickAsset(data.assets, os)
  if (!asset || !asset.browser_download_url) throw new Error('missing')
  const a = document.createElement('a')
  a.href = asset.browser_download_url
  a.rel = 'noopener'
  a.download = ''
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function bindDownload(cfg) {
  function wire(btnId, errId, os) {
    const btn = document.getElementById(btnId)
    const err = document.getElementById(errId)
    btn.addEventListener('click', async () => {
      err.textContent = ''
      btn.disabled = true
      const label = btn.textContent
      btn.textContent = 'Starting download…'
      try {
        await downloadOs(cfg.api, os)
      } catch (_) {
        err.textContent = 'Download is not ready yet. Please try again later.'
      } finally {
        btn.disabled = false
        btn.textContent = label
      }
    })
  }
  wire(cfg.winBtn, cfg.winErr, 'windows')
  wire(cfg.macBtn, cfg.macErr, 'mac')
}
