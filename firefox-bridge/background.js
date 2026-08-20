const stawlPattern = 'https://stawl.app/*'
const bridgeUrl = 'http://127.0.0.1:5174'

const findMontage = (value) => {
  if (Array.isArray(value) && value.some((entry) => entry?.hero?.name && typeof entry?.result === 'string')) return value
  if (!value || typeof value !== 'object') return null
  for (const child of Object.values(value)) {
    const montage = findMontage(child)
    if (montage) return montage
  }
  return null
}

browser.runtime.onMessage.addListener(async (message) => {
  if (message.type === 'bridge-get') {
    try {
      const response = await fetch(`${bridgeUrl}${message.path}`)
      return { ok: response.ok, command: response.ok ? await response.json() : null }
    } catch { return { ok: false, command: null } }
  }
  if (message.type !== 'bridge-request') return undefined
  try {
    const response = await fetch(`${bridgeUrl}${message.path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message.payload),
    })
    return { ok: response.ok }
  } catch {
    return { ok: false }
  }
})

browser.webRequest.onBeforeRequest.addListener(
  (request) => {
    const filter = browser.webRequest.filterResponseData(request.requestId)
    const chunks = []

    filter.ondata = (event) => {
      chunks.push(new Uint8Array(event.data))
      filter.write(event.data)
    }

    filter.onstop = async () => {
      filter.disconnect()
      const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
      const bytes = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      try {
        const payload = JSON.parse(new TextDecoder().decode(bytes))
        const montagePayload = findMontage(payload)
        if (montagePayload) {
          const montage = montagePayload.map((entry) => ({
            round: entry.round,
            description: entry.description || '',
            test: entry.test || '',
            skill: entry.skill || '',
            result: entry.result || 'undetermined',
            ordinal: entry.ordinal,
            hero: { name: entry.hero?.name || 'Unknown hero' },
            assist: Boolean(entry.assist),
          }))
          await browser.tabs.sendMessage(request.tabId, { type: 'montage-result', montage })
        }
      } catch {
        // Ignore non-JSON responses and leave the player feed unchanged.
      }
    }
  },
  { urls: [stawlPattern], types: ['xmlhttprequest'] },
  ['blocking']
)

browser.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return
  try { await browser.tabs.sendMessage(tab.id, { type: 'toggle-share' }) } catch { /* The active tab is not a Stawl page. */ }
})
