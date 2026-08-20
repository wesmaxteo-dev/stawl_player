import http from 'node:http'

const port = Number(process.env.BRIDGE_PORT || 5174)
let activeSource = null

const sendJson = (response, status, body) => {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  })
  response.end(JSON.stringify(body))
}

const readJson = (request) => new Promise((resolve, reject) => {
  let body = ''
  request.on('data', (chunk) => { body += chunk })
  request.on('end', () => {
    try { resolve(JSON.parse(body || '{}')) } catch (error) { reject(error) }
  })
  request.on('error', reject)
})

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return sendJson(response, 204, {})

  if (request.method === 'GET' && request.url === '/api/challenges') {
    return sendJson(response, 200, activeSource?.challenges || [])
  }

  if (request.method === 'GET' && request.url === '/api/player-feed') {
    return sendJson(response, 200, activeSource?.montage || [])
  }

  if (request.method === 'GET' && request.url === '/api/bridge-status') {
    return sendJson(response, 200, activeSource ? {
      sourceKey: activeSource.sourceKey,
      pageTitle: activeSource.pageTitle,
      sourceUrl: activeSource.sourceUrl,
      updatedAt: activeSource.updatedAt,
      assignmentPending: Boolean(activeSource.pendingAssignments?.length),
      applyResult: activeSource.applyResult || null,
      assignmentResults: activeSource.assignmentResults || [],
      assignmentTotal: activeSource.assignmentTotal || 0,
      progress: activeSource.progress || null,
    } : { sourceKey: null })
  }

  if (request.method === 'GET' && request.url.startsWith('/bridge/commands')) {
    const sourceKey = new URL(request.url, 'http://127.0.0.1').searchParams.get('sourceKey')
    const command = activeSource?.sourceKey === sourceKey ? activeSource.pendingAssignments?.shift() || null : null
    return sendJson(response, 200, command)
  }

  if (request.method === 'POST' && request.url === '/bridge/select') {
    try {
      const payload = await readJson(request)
      if (!payload.active) {
        if (activeSource?.sourceKey === payload.sourceKey) activeSource = null
        return sendJson(response, 200, { active: false })
      }
      activeSource = {
        sourceKey: payload.sourceKey,
        pageTitle: payload.pageTitle || 'Stawl encounter',
        sourceUrl: payload.sourceUrl || '',
        challenges: Array.isArray(payload.challenges) ? payload.challenges : [],
        montage: Array.isArray(payload.montage) ? payload.montage : [],
        progress: payload.progress || null,
        updatedAt: new Date().toISOString(),
        pendingAssignments: [],
        applyResult: null,
        assignmentResults: [],
        assignmentTotal: 0,
      }
      return sendJson(response, 200, { active: true, sourceKey: activeSource.sourceKey })
    } catch {
      return sendJson(response, 400, { error: 'Invalid bridge payload' })
    }
  }

  if (request.method === 'POST' && request.url === '/bridge/apply') {
    try {
      const payload = await readJson(request)
      if (activeSource?.sourceKey !== payload.sourceKey) return sendJson(response, 409, { error: 'No matching active Stawl tab' })
      const assignments = Array.isArray(payload.assignments)
        ? payload.assignments.filter((assignment) => assignment?.challengeTitle && typeof assignment.heroName === 'string')
        : payload.heroName && payload.challengeTitle
          ? [{ heroName: payload.heroName, challengeTitle: payload.challengeTitle }]
          : []
      const assists = Array.isArray(payload.assists) ? payload.assists.filter((assist) => assist?.helperName && assist?.challengeTitle).map((assist) => ({ helperName: assist.helperName, challengeTitle: assist.challengeTitle, round: Number(assist.round) || 1, assist: true })) : []
      activeSource.pendingAssignments = [...assignments, ...assists].map((assignment, index) => ({ ...assignment, commandId: `${Date.now()}-${index}` }))
      activeSource.assignmentResults = []
      activeSource.assignmentTotal = activeSource.pendingAssignments.length
      activeSource.applyResult = null
      return sendJson(response, 202, { queued: true })
    } catch {
      return sendJson(response, 400, { error: 'Invalid assignment' })
    }
  }

  if (request.method === 'POST' && request.url === '/bridge/apply-result') {
    try {
      const payload = await readJson(request)
      if (activeSource?.sourceKey !== payload.sourceKey) return sendJson(response, 409, { error: 'No matching active Stawl tab' })
      activeSource.applyResult = { ok: Boolean(payload.ok), message: payload.message || '', updatedAt: new Date().toISOString() }
      activeSource.assignmentResults.push({ commandId: payload.commandId || '', ok: Boolean(payload.ok), message: payload.message || '' })
      return sendJson(response, 200, activeSource.applyResult)
    } catch {
      return sendJson(response, 400, { error: 'Invalid assignment result' })
    }
  }

  if (request.method === 'POST' && request.url === '/bridge/publish') {
    try {
      const payload = await readJson(request)
      if (activeSource?.sourceKey !== payload.sourceKey) return sendJson(response, 409, { active: false })
      if (Array.isArray(payload.challenges)) activeSource.challenges = payload.challenges
      if (Array.isArray(payload.montage)) activeSource.montage = payload.montage
      if (payload.progress) activeSource.progress = payload.progress
      activeSource.updatedAt = new Date().toISOString()
      return sendJson(response, 200, { active: true })
    } catch {
      return sendJson(response, 400, { error: 'Invalid bridge payload' })
    }
  }

  sendJson(response, 404, { error: 'Not found' })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Stawl bridge listening at http://127.0.0.1:${port}`)
})
