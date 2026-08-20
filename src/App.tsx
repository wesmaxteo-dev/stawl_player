import { useEffect, useState } from 'react'
import './App.css'

type MontageEntry = {
  round: number
  description: string
  test: string
  skill: string
  result: 'success' | 'failure' | 'undetermined' | 'tier1' | 'tier2' | 'tier3'
  ordinal: number
  hero: { name: string }
  assist: boolean
}
type Challenge = { id: string; title: string; category: string; description?: string; characteristics?: string[]; skills?: string[] }
type Update = { time: string; title: string; detail: string; tone: 'mint' | 'amber' | 'coral'; challengeTitle?: string; assist: boolean; round: number }
type PlayerSnapshot = { season: string; location: string; statusLabel: string; headline: string; summary: string; updatedAt: string; progress: number; updates: Update[] }
type Score = { current: number; target: number } | null
type ProgressTotals = { successes: Score; failures: Score }

type AssignmentPickerProps = { value: string; heroes: string[]; assignedHeroes: Set<string>; onChange: (heroName: string) => void; label: string }

function OutcomeTracker({ progress }: { progress: ProgressTotals }) {
  const successFill = progress.successes && progress.successes.target > 0 ? Math.min(100, Math.round((progress.successes.current / progress.successes.target) * 100)) : 0
  const failureFill = progress.failures && progress.failures.target > 0 ? Math.min(100, Math.round((progress.failures.current / progress.failures.target) * 100)) : 0
  return <section className="outcome-tracker" aria-label="Montage outcome progress">
    <div className="outcome-labels"><span>Successes</span><span>Failures</span></div>
    <div className="outcome-bar"><span className="outcome-fill success" style={{ width: `${successFill / 2}%` }} /><span className="outcome-fill failure" style={{ width: `${failureFill / 2}%` }} /><span className="outcome-center" /></div>
  </section>
}

function AssignmentPicker({ value, heroes, assignedHeroes, onChange, label }: AssignmentPickerProps) {
  const [open, setOpen] = useState(false)
  const options = heroes.filter((hero) => !assignedHeroes.has(hero) || hero === value)
  const choose = (hero: string) => { onChange(hero); setOpen(false) }

  return <div className="assignment-picker">
    <button className="assignment-trigger" type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)} onKeyDown={(event) => {
      if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); choose('') }
      if (event.key === 'Escape') setOpen(false)
    }}><span>{value || 'Unassigned'}</span><span aria-hidden="true">⌄</span></button>
    {open && <div className="assignment-menu" role="listbox">{options.map((hero) => <button type="button" role="option" aria-selected={hero === value} key={hero} onClick={() => choose(hero)}>{hero}</button>)}</div>}
  </div>
}

const montageData: MontageEntry[] = [
  { round: 1, description: 'Avoid Projectiles', test: 'Might', skill: 'Alchemy', result: 'undetermined', ordinal: 1, hero: { name: 'Olive Oalje' }, assist: false },
  { round: 1, description: '', test: '', skill: '', result: 'undetermined', ordinal: 2, hero: { name: 'Redge' }, assist: false },
  { round: 1, description: '', test: '', skill: '', result: 'undetermined', ordinal: 3, hero: { name: "Paula Ab'Ghoul" }, assist: false },
  { round: 1, description: '', test: '', skill: '', result: 'undetermined', ordinal: 4, hero: { name: 'Val Hallux' }, assist: false },
  { round: 1, description: '', test: '', skill: '', result: 'undetermined', ordinal: 5, hero: { name: 'Zhorva' }, assist: false },
]

const demoChallengeOptions: Challenge[] = [
  { id: 'avoid-projectiles', title: 'Avoid Projectiles', category: 'Physical' },
  { id: 'cross-the-mire', title: 'Cross the Mire', category: 'Traversal' },
  { id: 'hold-the-line', title: 'Hold the Line', category: 'Endurance' },
  { id: 'read-the-room', title: 'Read the Room', category: 'Social' },
]

function snapshotFromMontage(entries: MontageEntry[]): PlayerSnapshot {
  const firstEntry = entries[0]
  const montageContext = entries.find((entry) => entry.description || entry.test || entry.skill) || firstEntry
  const completedCount = entries.filter((entry) => entry.result !== 'undetermined').length
  return {
    season: `Round ${String(firstEntry.round).padStart(2, '0')} / Active montage`,
    location: `${entries.length} heroes in play`,
    statusLabel: 'Live montage',
    headline: montageContext.description || 'The montage is moving.',
    summary: `${montageContext.test || 'Current'} test · ${montageContext.skill || 'Active'} skill`,
    updatedAt: 'From current montage',
    progress: Math.round((completedCount / entries.length) * 100),
    updates: entries.map((entry) => ({
      time: `Hero ${String(entry.ordinal).padStart(2, '0')}`,
      title: entry.hero.name,
      detail: entry.result === 'undetermined' ? 'Waiting for a result' : entry.result.startsWith('tier') ? `Tier ${entry.result.slice(-1)}` : `Result: ${entry.result}`,
      tone: entry.result === 'success' ? 'mint' : entry.result === 'failure' ? 'coral' : 'amber',
      challengeTitle: entry.description,
      assist: entry.assist,
      round: entry.round,
    })),
  }
}

const demoSnapshot = snapshotFromMontage(montageData)

async function loadSnapshot(): Promise<PlayerSnapshot> {
  const response = await fetch('/api/player-feed')
  if (!response.ok) throw new Error('Player feed unavailable')
  const payload: PlayerSnapshot | MontageEntry[] = await response.json()
  if (Array.isArray(payload)) {
    if (!payload.length) throw new Error('No active montage')
    return snapshotFromMontage(payload)
  }
  return payload
}

function App() {
  const [snapshot, setSnapshot] = useState(demoSnapshot)
  const [challengeOptions, setChallengeOptions] = useState(demoChallengeOptions)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [feedState, setFeedState] = useState<'demo' | 'connected'>('demo')
  const [bridgeTitle, setBridgeTitle] = useState('Local board')
  const [sourceKey, setSourceKey] = useState<string | null>(null)
  const [applyState, setApplyState] = useState('')
  const [selectedRound, setSelectedRound] = useState(1)
  const [assignments, setAssignments] = useState<Record<number, Record<string, string>>>({})
  const [clearedChallenges, setClearedChallenges] = useState<Record<number, string[]>>({})
  const [assists, setAssists] = useState<Record<number, Record<string, string>>>({})
  const [progressTotals, setProgressTotals] = useState<ProgressTotals>({ successes: null, failures: null })
  const [isRevealed, setIsRevealed] = useState(false)
  const refreshFeed = async () => {
    setIsRefreshing(true)
    try { setSnapshot(await loadSnapshot()); setFeedState('connected') } catch { setFeedState('demo') } finally { setIsRefreshing(false) }
  }
  useEffect(() => {
    const syncBridge = async () => {
      try {
        const [challengeResponse, statusResponse] = await Promise.all([fetch('/api/challenges'), fetch('/api/bridge-status')])
        const liveChallenges: Challenge[] = await challengeResponse.json()
        const bridgeStatus: { pageTitle?: string; sourceKey?: string | null; applyResult?: { ok: boolean; message: string } | null; assignmentResults?: { ok: boolean; message: string }[]; assignmentTotal?: number; progress?: ProgressTotals } = await statusResponse.json()
        const challengeCards = liveChallenges.filter((challenge) => !/^round\s+\d+/i.test(challenge.title))
        if (challengeCards.length) setChallengeOptions(challengeCards)
        if (bridgeStatus.pageTitle) setBridgeTitle(bridgeStatus.pageTitle)
        setSourceKey(bridgeStatus.sourceKey || null)
        if (bridgeStatus.progress) setProgressTotals(bridgeStatus.progress)
        if (bridgeStatus.assignmentTotal) {
          const completed = bridgeStatus.assignmentResults?.length || 0
          const failed = bridgeStatus.assignmentResults?.filter((result) => !result.ok).length || 0
          setApplyState(`${completed}/${bridgeStatus.assignmentTotal} updates applied${failed ? ` · ${failed} failed` : ''}`)
        } else if (bridgeStatus.applyResult) setApplyState(bridgeStatus.applyResult.ok ? `Applied: ${bridgeStatus.applyResult.message}` : `Could not apply: ${bridgeStatus.applyResult.message}`)
        try { setSnapshot(await loadSnapshot()); setFeedState('connected') } catch { /* The bridge may have no active montage yet. */ }
      } catch { /* Preview mode remains available when the bridge is offline. */ }
    }
    syncBridge()
    const interval = window.setInterval(syncBridge, 2000)
    return () => window.clearInterval(interval)
  }, [])
  const applyToStawl = async () => {
    const roundAssignments = assignments[selectedRound] || {}
    const roundClearedChallenges = clearedChallenges[selectedRound] || []
    const roundAssists = assists[selectedRound] || {}
    const queuedAssignments = [
      ...Object.entries(roundAssignments).map(([challengeId, heroName]) => ({ heroName, challengeTitle: challengeOptions.find((challenge) => challenge.id === challengeId)?.title, round: selectedRound })),
      ...roundClearedChallenges.map((challengeId) => ({ heroName: '', challengeTitle: challengeOptions.find((challenge) => challenge.id === challengeId)?.title, round: selectedRound })),
    ].filter((assignment): assignment is { heroName: string; challengeTitle: string; round: number } => Boolean(assignment.challengeTitle))
    const queuedAssists = Object.entries(roundAssists).map(([challengeId, helperName]) => ({ helperName, challengeTitle: challengeOptions.find((challenge) => challenge.id === challengeId)?.title, round: selectedRound })).filter((assist): assist is { helperName: string; challengeTitle: string; round: number } => Boolean(assist.helperName && assist.challengeTitle))
    if (!sourceKey || (!queuedAssignments.length && !queuedAssists.length)) { setApplyState('Assign at least one player first'); return }
    setApplyState('Sending to Stawl...')
    try {
      const response = await fetch('/bridge/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceKey, assignments: queuedAssignments, assists: queuedAssists }) })
      const total = queuedAssignments.length + queuedAssists.length
      setApplyState(response.ok ? `${total} update${total === 1 ? '' : 's'} queued in Stawl` : 'Stawl tab is no longer active')
    } catch { setApplyState('Bridge offline') }
  }

  const assignmentFor = (challenge: Challenge) => {
    const roundAssignments = assignments[selectedRound] || {}
    if ((clearedChallenges[selectedRound] || []).includes(challenge.id)) return 'Unassigned'
    const localAssignment = roundAssignments[challenge.id]
    if (localAssignment) return localAssignment
    const liveAssignment = feedState === 'connected' ? snapshot.updates.find((update) => update.round === selectedRound && !update.assist && update.challengeTitle === challenge.title) : undefined
    return liveAssignment?.title || 'Unassigned'
  }

  const setChallengeAssignment = (challengeId: string, heroName: string) => {
    setAssignments((currentAssignments) => {
      const currentRound = currentAssignments[selectedRound] || {}
      const previousChallengeId = Object.entries(currentRound).find(([, player]) => player === heroName)?.[0]
      setClearedChallenges((current) => {
        const existing = current[selectedRound] || []
        const next = existing.filter((id) => id !== challengeId)
        const roundCleared = previousChallengeId && previousChallengeId !== challengeId ? [...next, previousChallengeId] : heroName ? next : existing.includes(challengeId) ? existing : [...existing, challengeId]
        return { ...current, [selectedRound]: roundCleared }
      })
      const nextRound = Object.fromEntries(Object.entries(currentRound).filter(([id, player]) => id !== challengeId && player !== heroName))
      if (heroName) nextRound[challengeId] = heroName
      return { ...currentAssignments, [selectedRound]: nextRound }
    })
  }
  const activeUpdates = snapshot.updates.filter((update) => update.round === selectedRound)
  const liveAssignedHeroes = new Set(activeUpdates.filter((update) => update.challengeTitle).map((update) => update.title))
  const assistedHeroes = new Set(Object.values(assists[selectedRound] || {}))
  const assignedHeroes = new Set([...(Object.values(assignments[selectedRound] || {})), ...liveAssignedHeroes, ...assistedHeroes])
  const helpersFor = (_challenge: Challenge) => new Set([...assignedHeroes, ...assistedHeroes])
  const assistFor = (challenge: Challenge) => activeUpdates.find((update) => update.assist && update.challengeTitle === challenge.title && update.detail.startsWith('Tier'))?.detail.match(/Tier \d/)?.[0] || ''
  const assistLabel = (challenge: Challenge) => ({ 'Tier 1': ' - Bane', 'Tier 2': ' - Edge', 'Tier 3': ' - Double Edge' }[assistFor(challenge)] || '')
  const setChallengeAssist = (challengeId: string, helperName: string) => setAssists((current) => {
    const currentRound = current[selectedRound] || {}
    return { ...current, [selectedRound]: helperName ? { ...currentRound, [challengeId]: helperName } : Object.fromEntries(Object.entries(currentRound).filter(([id]) => id !== challengeId)) }
  })

  const resultFor = (challenge: Challenge) => {
    const liveAssignment = activeUpdates.find((update) => !update.assist && update.challengeTitle === challenge.title)
    if (!liveAssignment) return 'Undetermined'
    if (liveAssignment.detail.includes('success')) return 'Success'
    if (liveAssignment.detail.includes('failure')) return 'Failure'
    return 'Undetermined'
  }

  const availableRounds = Array.from(new Set([1, ...snapshot.updates.map((update) => update.round)])).sort((a, b) => a - b)
  const roundHeroes = activeUpdates.map((update) => update.title).filter((hero, index, heroes) => hero && heroes.indexOf(hero) === index)
  const heroes = roundHeroes.length ? roundHeroes : montageData.map((entry) => entry.hero.name)
  const hasPendingChanges = Boolean(Object.keys(assignments[selectedRound] || {}).length || Object.keys(assists[selectedRound] || {}).length || (clearedChallenges[selectedRound] || []).length)
  const isAssignedInRound = (challenge: Challenge, round: number) => {
    if ((clearedChallenges[round] || []).includes(challenge.id)) return false
    if (assignments[round]?.[challenge.id]) return true
    return snapshot.updates.some((update) => update.round === round && !update.assist && update.challengeTitle === challenge.title)
  }
  const visibleChallenges = selectedRound === 2 ? challengeOptions.filter((challenge) => !isAssignedInRound(challenge, 1)) : challengeOptions
  const resolvedUpdates = snapshot.updates.filter((update) => !update.assist)
  const outcomeProgress: ProgressTotals = {
    successes: progressTotals.successes ? { current: resolvedUpdates.filter((update) => update.detail === 'Result: success').length, target: progressTotals.successes.target } : null,
    failures: progressTotals.failures ? { current: resolvedUpdates.filter((update) => update.detail === 'Result: failure').length, target: progressTotals.failures.target } : null,
  }

  return <main className="player-shell">
    <header className="topbar"><div className="montage-heading"><span className="montage-kicker">Montage test</span><strong>{bridgeTitle}</strong><nav className="round-tabs" aria-label="Montage rounds">{availableRounds.map((round) => <button type="button" key={round} className={round === selectedRound ? 'round-label selected' : 'round-label'} onClick={() => setSelectedRound(round)}>Round {round}</button>)}</nav></div><div className="topbar-meta"><span className={`sync-status compact ${feedState}`}><span className="sync-dot" />{feedState === 'connected' ? 'Live' : 'Waiting'}</span><button className="refresh-button" type="button" onClick={refreshFeed} disabled={isRefreshing}><span className={isRefreshing ? 'refresh-icon spinning' : 'refresh-icon'} aria-hidden="true">↻</span>{isRefreshing ? 'Checking' : 'Refresh'}</button></div></header>
    <OutcomeTracker progress={outcomeProgress} />
    <section className="assignment-toolbar" aria-label="Apply assignments to Stawl"><strong>{isRevealed ? 'Assigned challenge details revealed' : `Director's assignments · Round ${selectedRound}`}</strong><button className="apply-button" type="button" onClick={() => setIsRevealed((current) => !current)}>{isRevealed ? 'Hide details' : 'Reveal challenges'}</button><button className="apply-button" type="button" onClick={applyToStawl} disabled={!sourceKey || !hasPendingChanges}>Apply all to Stawl</button><span className="apply-status">{isRevealed ? 'Unassigned challenges remain available' : applyState || (sourceKey ? 'Ready' : 'Share a Stawl tab')}</span></section>
    <section className="challenge-grid" aria-labelledby="page-title">{visibleChallenges.map((challenge, index) => { const primary = assignmentFor(challenge); const canHelp = primary !== 'Unassigned' && resultFor(challenge) === 'Undetermined'; const showDetails = isRevealed && primary !== 'Unassigned'; return <article className="challenge-card" key={challenge.id}><div className="card-heading"><span className="challenge-number">{String(index + 1).padStart(2, '0')}</span></div><h2>{challenge.title}</h2>{showDetails ? <div className="challenge-description"><span className="stat-label">Challenge</span><p>{challenge.description || 'No description provided.'}</p></div> : <><div className="card-assignment"><span className="stat-label">Assignment</span><AssignmentPicker value={primary === 'Unassigned' ? '' : primary} heroes={heroes} assignedHeroes={assignedHeroes} onChange={(heroName) => setChallengeAssignment(challenge.id, heroName)} label={`Assignment for ${challenge.title}`} />{assistLabel(challenge) && <span className="assist-suffix">{assistLabel(challenge)}</span>}</div>{canHelp && <div className="card-assignment help-assignment"><span className="stat-label">Help</span><AssignmentPicker value={(assists[selectedRound] || {})[challenge.id] || ''} heroes={heroes} assignedHeroes={helpersFor(challenge)} onChange={(heroName) => setChallengeAssist(challenge.id, heroName)} label={`Help with ${challenge.title}`} /></div>}</>}<div className="card-stats"><div><span className="stat-label">Suggested characteristics</span><strong>{challenge.characteristics?.join(' · ') || 'Not specified'}</strong></div><div><span className="stat-label">Result</span><strong className={`result-${resultFor(challenge).toLowerCase()}`}>{resultFor(challenge)}</strong></div>{showDetails && <div><span className="stat-label">Suggested skills</span><strong>{challenge.skills?.join(' · ') || 'Not specified'}</strong></div>}</div></article>})}</section>
    <footer><span>Shared from Stawl</span><span className="footer-rule" /><span>Challenge status only</span></footer>
  </main>
}

export default App
