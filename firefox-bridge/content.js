(() => {
  const sourceKey = window.location.href
  let isSelected = false
  let latestMontage = []
  let publishTimer
  let commandTimer
  let heartbeatTimer
  let processingCommand = false
  // Stawl clears an assister's challenge input. Keep the explicit target from
  // the bridge command instead of guessing from the preceding contribution.
  const assistTargets = new Map()

  const slugify = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const extractProgress = () => {
    const text = document.body.innerText || ''
    const read = (label) => {
      const afterLabel = new RegExp(`${label}\\s*(?:[:—-]\\s*)?(\\d+)\\s*(?:/|of)\\s*(\\d+)`, 'i').exec(text)
      const beforeLabel = new RegExp(`(\\d+)\\s*(?:/|of)\\s*(\\d+)\\s*${label}`, 'i').exec(text)
      const explicitTarget = new RegExp(`${label}(?:\\s+(?:needed|required|target|to win))?\\s*[:—-]\\s*(\\d+)`, 'i').exec(text)
      const match = afterLabel || beforeLabel
      return match ? { current: Number(match[1]), target: Number(match[2]) } : explicitTarget ? { current: 0, target: Number(explicitTarget[1]) } : null
    }
    return { successes: read('success(?:es)?'), failures: read('failures?') }
  }

  const mergeMontage = (entries) => {
    const merged = new Map(latestMontage.map((entry) => [`${entry.round}:${entry.hero?.name}`, entry]))
    entries.forEach((entry) => merged.set(`${entry.round}:${entry.hero?.name}`, entry))
    latestMontage = Array.from(merged.values()).sort((left, right) => left.round - right.round || left.ordinal - right.ordinal)
    return latestMontage
  }

  const contributionRows = () => {
    const groups = Array.from(document.querySelectorAll('#contributions > li'))
    const roundHeadings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, [data-round]'))
      .map((element) => ({ element, round: Number(element.getAttribute('data-round') || element.textContent?.match(/\bround\s+(\d+)\b/i)?.[1]) }))
      .filter((heading) => Number.isInteger(heading.round) && heading.round > 0)
    const roundForRow = (row, fallback) => {
      const precedingHeadings = roundHeadings.filter(({ element }) => Boolean(element.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING))
      return precedingHeadings.at(-1)?.round || fallback
    }
    const groupedRows = groups.flatMap((group, index) => Array.from(group.querySelectorAll('li'))
      .filter((row) => row.querySelector('.font-bold'))
      .map((row) => ({ row, round: roundForRow(row, index + 1) })))
    if (groupedRows.length) return groupedRows
    return Array.from(document.querySelectorAll('#contributions > li li'))
      .filter((row) => row.querySelector('.font-bold'))
      .map((row) => ({ row, round: roundForRow(row, 1) }))
  }

  const extractChallenges = () => Array.from(document.querySelectorAll('h3')).map((heading) => {
    const card = heading.closest('[id="card"]') || heading.parentElement?.parentElement
    if (!card) return null
    const title = heading.textContent.trim()
    const description = card.querySelector('.prose')?.textContent.trim() || ''
    const lists = Array.from(card.querySelectorAll('ul')).map((list) => Array.from(list.querySelectorAll('li')).map((item) => item.textContent.trim()))
    return { id: slugify(title), title, description, characteristics: lists[0] || [], skills: lists[1] || [], category: 'Challenge' }
  }).filter((challenge, index, all) => challenge && challenge.title && !/^round\s+\d+/i.test(challenge.title) && all.findIndex((item) => item?.id === challenge.id) === index)

  const extractMontage = () => {
    const rows = contributionRows()
    const domMontage = rows.map(({ row, round }, index) => {
      const hero = row.querySelector('.font-bold')?.textContent.trim()
      const inputs = Array.from(row.querySelectorAll('input'))
      const resultValue = row.querySelector('select')?.value || 'undetermined'
      const result = resultValue.replace(/[-_ ]/g, '').toLowerCase()
      if (!hero || !result) return null
      const buttonText = row.querySelector('button')?.textContent.trim().toLowerCase() || ''
      const isAssist = buttonText === 'assist'
      const description = inputs[0]?.value || (isAssist ? assistTargets.get(`${round}:${hero}`) || '' : '')
      return { round, description, test: inputs[1]?.value || '', skill: inputs[2]?.value || '', result, ordinal: index + 1, hero: { name: hero }, assist: isAssist }
    }).filter(Boolean)
    return domMontage.length ? mergeMontage(domMontage) : latestMontage
  }

  const send = async (path, payload) => {
    try {
      const result = await browser.runtime.sendMessage({ type: 'bridge-request', path, payload })
      if (!result?.ok) updateStatus('Bridge offline')
    } catch {
      updateStatus('Bridge offline')
    }
  }

  const publish = () => {
    if (!isSelected) return
    window.clearTimeout(publishTimer)
    publishTimer = window.setTimeout(() => send('/bridge/publish', {
      sourceKey,
      pageTitle: document.querySelector('h1')?.textContent.trim() || document.title,
      sourceUrl: window.location.href,
      challenges: extractChallenges(),
      montage: extractMontage(),
      progress: extractProgress(),
    }), 250)
  }

  const updateStatus = (text) => {
    const status = document.querySelector('#stawl-player-bridge-status')
    if (status) status.textContent = text
  }

  const toggleShare = async () => {
    isSelected = !isSelected
    const button = document.querySelector('#stawl-player-bridge-toggle')
    if (button) button.textContent = isSelected ? 'Stop sharing' : 'Share this page'
    updateStatus(isSelected ? 'Sharing this page' : 'Not sharing')
    if (isSelected) {
      await send('/bridge/select', { sourceKey, active: true, pageTitle: document.title, sourceUrl: window.location.href, challenges: extractChallenges(), montage: extractMontage(), progress: extractProgress() })
    } else {
      await send('/bridge/select', { sourceKey, active: false })
    }
    if (isSelected) commandTimer = window.setInterval(pollCommands, 1500)
    if (isSelected) heartbeatTimer = window.setInterval(publish, 1500)
    else {
      window.clearInterval(commandTimer)
      window.clearInterval(heartbeatTimer)
    }
  }

  const applyAssignment = async ({ heroName, helperName, challengeTitle, commandId, assist, round = 1 }) => {
    if (assist) {
      const heading = Array.from(document.querySelectorAll('h3')).find((element) => element.textContent.trim() === challengeTitle)
      const card = heading?.closest('[id="card"]')
      const assignButton = card && Array.from(card.querySelectorAll('button')).find((element) => element.textContent.trim().toLowerCase() === 'assign')
      if (!assignButton) return send('/bridge/apply-result', { sourceKey, commandId, ok: false, message: `Could not find Assign for ${challengeTitle}` })
      assignButton.click()
      await new Promise((resolve) => window.setTimeout(resolve, 250))
      const dialog = document.querySelector('[role="dialog"], [aria-modal="true"], dialog')
      const pickerRoot = dialog || document.body
      const selects = Array.from(pickerRoot.querySelectorAll('select'))
      const heroSelect = selects.find((select) => Array.from(select.options).some((option) => option.text.trim() === helperName))
      if (heroSelect) {
        const option = Array.from(heroSelect.options).find((item) => item.text.trim() === helperName)
        heroSelect.value = option.value
        heroSelect.dispatchEvent(new Event('change', { bubbles: true }))
      } else {
        const helperOption = Array.from(pickerRoot.querySelectorAll('button, [role="option"], [role="menuitem"], label')).find((element) => element.textContent.trim() === helperName)
        if (!helperOption) return send('/bridge/apply-result', { sourceKey, commandId, ok: false, message: `Could not find helper ${helperName}` })
        helperOption.click()
      }
      const confirm = dialog && ['Save', 'Assign', 'Confirm'].map((text) => Array.from(dialog.querySelectorAll('button')).find((element) => element.textContent.trim().toLowerCase() === text.toLowerCase())).find(Boolean)
      if (confirm) confirm.click()
      const helperRow = contributionRows().find((item) => item.round === round && item.row.querySelector('.font-bold')?.textContent.trim() === helperName)?.row
      const helperChallenge = helperRow?.querySelector('input')
      if (helperChallenge) {
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        valueSetter?.call(helperChallenge, '')
        helperChallenge.dispatchEvent(new Event('input', { bubbles: true }))
        helperChallenge.dispatchEvent(new Event('change', { bubbles: true }))
      }
      await new Promise((resolve) => window.setTimeout(resolve, 900))
      let helperButton = helperRow?.querySelector('button')
      if (helperButton?.textContent.trim().toLowerCase() === 'attempt') {
        helperButton.click()
        await new Promise((resolve) => window.setTimeout(resolve, 700))
        helperButton = helperRow?.querySelector('button')
      }
      const isAssist = helperButton?.textContent.trim().toLowerCase() === 'assist'
      if (isAssist) assistTargets.set(`${round}:${helperName}`, challengeTitle)
      else assistTargets.delete(`${round}:${helperName}`)
      publish()
      return send('/bridge/apply-result', { sourceKey, commandId, ok: isAssist, message: isAssist ? `${helperName} assisting ${challengeTitle}` : `Stawl did not change ${helperName} to Assist` })
    }
    const heading = Array.from(document.querySelectorAll('h3')).find((element) => element.textContent.trim() === challengeTitle)
    const contributionRow = contributionRows().find((item) => item.round === round && item.row.querySelector('.font-bold')?.textContent.trim() === heroName)?.row
    const challengeInput = contributionRow?.querySelector('input')
    if (challengeInput) {
      assistTargets.delete(`${round}:${heroName}`)
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(challengeInput, challengeTitle)
      challengeInput.dispatchEvent(new Event('input', { bubbles: true }))
      challengeInput.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise((resolve) => window.setTimeout(resolve, 700))
      return send('/bridge/apply-result', { sourceKey, commandId, ok: true, message: `${heroName} assigned to ${challengeTitle}` })
    }
    const card = heading?.closest('[id="card"]')
    const assignButton = card && Array.from(card.querySelectorAll('button')).find((element) => element.textContent.trim().toLowerCase() === 'assign')
    if (!assignButton) return send('/bridge/apply-result', { sourceKey, ok: false, message: `Could not find Assign for ${challengeTitle}` })
    assignButton.click()
    await new Promise((resolve) => window.setTimeout(resolve, 250))
    const dialog = document.querySelector('[role="dialog"], [aria-modal="true"], dialog')
    const pickerRoot = dialog || document.body
    const selects = Array.from(pickerRoot.querySelectorAll('select'))
    const heroSelect = selects.find((select) => Array.from(select.options).some((option) => option.text.trim() === heroName))
    if (heroSelect && heroName) {
      const option = Array.from(heroSelect.options).find((item) => item.text.trim() === heroName)
      heroSelect.value = option.value
      heroSelect.dispatchEvent(new Event('change', { bubbles: true }))
    } else if (!heroName) {
      const clearOption = heroSelect && Array.from(heroSelect.options).find((option) => !option.value || /unassigned|none|no player/i.test(option.text))
      const clearButton = Array.from(pickerRoot.querySelectorAll('button, [role="option"], [role="menuitem"], label')).find((element) => /unassigned|none|no player/i.test(element.textContent.trim()))
      if (clearOption) {
        heroSelect.value = clearOption.value
        heroSelect.dispatchEvent(new Event('change', { bubbles: true }))
      } else if (clearButton) clearButton.click()
      else return send('/bridge/apply-result', { sourceKey, ok: false, message: `Could not clear assignment for ${challengeTitle}` })
    } else {
      const heroOption = Array.from(pickerRoot.querySelectorAll('button, [role="option"], [role="menuitem"], label')).find((element) => {
        const style = window.getComputedStyle(element)
        return style.display !== 'none' && style.visibility !== 'hidden' && element.textContent.trim() === heroName
      })
      if (!heroOption) return send('/bridge/apply-result', { sourceKey, ok: false, message: `Could not find player selector for ${heroName}` })
      heroOption.click()
    }
    if (!dialog) {
      await new Promise((resolve) => window.setTimeout(resolve, 1000))
      return send('/bridge/apply-result', { sourceKey, ok: true, message: `${heroName} assigned to ${challengeTitle}` })
    }
    const confirm = ['Save', 'Assign', 'Confirm'].map((text) => Array.from(dialog.querySelectorAll('button')).find((element) => element.textContent.trim().toLowerCase() === text.toLowerCase())).find(Boolean)
    if (!confirm) return send('/bridge/apply-result', { sourceKey, ok: false, message: 'Could not find confirmation button' })
    confirm.click()
    await new Promise((resolve) => window.setTimeout(resolve, 1000))
    return send('/bridge/apply-result', { sourceKey, ok: true, message: `${heroName} assigned to ${challengeTitle}` })
  }

  const pollCommands = async () => {
    if (!isSelected || processingCommand) return
    try {
      const result = await browser.runtime.sendMessage({ type: 'bridge-get', path: `/bridge/commands?sourceKey=${encodeURIComponent(sourceKey)}` })
      if (!result?.command) return
      processingCommand = true
      try { await applyAssignment(result.command) } finally { processingCommand = false }
    } catch { /* The local bridge may be offline. */ }
  }

  const createPanel = () => {
    if (document.querySelector('#stawl-player-bridge')) return
    const panel = document.createElement('aside')
    panel.id = 'stawl-player-bridge'
    panel.innerHTML = '<strong>Player bridge</strong><span id="stawl-player-bridge-status">Not sharing</span><button type="button" id="stawl-player-bridge-toggle">Share this page</button>'
    Object.assign(panel.style, { position: 'fixed', right: '18px', bottom: '18px', zIndex: '2147483647', width: '190px', padding: '13px', color: '#f5f0e7', background: '#1c201b', border: '1px solid #afb89a', boxShadow: '0 8px 24px rgba(0,0,0,.2)', font: '12px system-ui' })
    panel.querySelector('strong').style.display = 'block'
    panel.querySelector('strong').style.marginBottom = '6px'
    panel.querySelector('span').style.display = 'block'
    panel.querySelector('span').style.marginBottom = '10px'
    const button = panel.querySelector('button')
    Object.assign(button.style, { border: '1px solid #f07f63', padding: '7px 9px', color: '#f5f0e7', background: 'transparent', cursor: 'pointer' })
    button.addEventListener('click', toggleShare)
    document.body.appendChild(panel)
  }

  const boot = () => {
    if (!document.body.innerText.includes('Challenges')) return
    createPanel()
    new MutationObserver(publish).observe(document.body, { childList: true, subtree: true, characterData: true })
    document.querySelectorAll('#contributions input, #contributions select').forEach((control) => {
      control.addEventListener('input', publish)
      control.addEventListener('change', publish)
    })
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message.type === 'toggle-share') return toggleShare()
    if (message.type !== 'montage-result' || !Array.isArray(message.montage)) return
    mergeMontage(message.montage)
    publish()
  })

  boot()
})()
