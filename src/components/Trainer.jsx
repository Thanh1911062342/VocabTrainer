// src/components/Trainer.jsx
import React, { useEffect, useState } from 'react'
import { Eye, RotateCcw, Repeat, Presentation, ListChecks, Volume2, Square } from 'lucide-react'
import RSVPDisplay from './RSVPDisplay'
import Recall from './Recall'
import { shuffle, normalize } from '../utils/shuffle'
import { decodeBase91 } from '../utils/base91'

// Utils
function uniq(arr) { return Array.from(new Set(arr)) }
function fyShuffle(a) {
  const arr = a.slice()
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}
function sampleNoRep(pool, n, exclude = new Set()) {
  const src = pool.filter(i => !exclude.has(i))
  return fyShuffle(src).slice(0, Math.min(n, src.length))
}

export default function Trainer({ config, onReset, progressKey, configKey }) {
  const [words, setWords] = useState([])
  const [progress, setProgress] = useState(null)
  const [mode, setMode] = useState('present') // 'present' | 'recall' | 'result'
  const [presentationOrder, setPresentationOrder] = useState([])
  const [lastResult, setLastResult] = useState(null) // {pass, missing, extras}
  const [showModal, setShowModal] = useState(false)
  const [showEyeMenu, setShowEyeMenu] = useState(false)
  const [showStudied, setShowStudied] = useState(false)
  const [pendingOutcome, setPendingOutcome] = useState(null) // 'pass' | 'fail'
  const [loading, setLoading] = useState(true)

  // Audio state for Studied modal
  const [playingIdx, setPlayingIdx] = useState(null)
  const audioCacheRef = React.useRef(new Map())
  const currentAudioRef = React.useRef(null)

  // Load data + progress
  useEffect(() => {
    async function load() {
      setLoading(true)
      const res = await fetch(`${import.meta.env.BASE_URL}mock-be/words.json`)
      const data = await res.json()
      setWords(data)
      const saved = localStorage.getItem(progressKey)
      if (saved) setProgress(JSON.parse(saved))
      setLoading(false)
    }
    load()
  }, [progressKey])

  function saveProgress(p) {
    setProgress(p)
    localStorage.setItem(progressKey, JSON.stringify(p))
  }

  // Ensure default fields exist
  useEffect(() => {
    if (!progress || words.length === 0) return
    let needsSave = false
    const p = { ...progress }
    if (!Array.isArray(p.studiedIdxs)) { p.studiedIdxs = []; needsSave = true }
    if (!Array.isArray(p.selectedIdxs)) { p.selectedIdxs = []; needsSave = true }
    if (typeof p.poolSize !== 'number') { p.poolSize = Math.min(words.length, config.initialCount || 5); needsSave = true }
    if (!Array.isArray(p.groups)) { p.groups = []; needsSave = true }
    if (!Array.isArray(p.reservoir)) { p.reservoir = []; needsSave = true }
    if (!Array.isArray(p.newPool)) {
      const allIdx = Array.from({ length: words.length }, (_, i) => i)
      const studiedSet = new Set(p.studiedIdxs)
      p.newPool = allIdx.filter(i => !studiedSet.has(i))
      needsSave = true
    }
    if (!Array.isArray(p.currentSet)) { p.currentSet = []; needsSave = true }
    if (typeof p.chunkMode !== 'boolean') { p.chunkMode = false; needsSave = true }

    // Keep reservoir = studied - union(groups)
    const union = new Set([].concat(...p.groups))
    const correctedReserv = p.studiedIdxs.filter(i => !union.has(i))
    if (JSON.stringify(correctedReserv) !== JSON.stringify(p.reservoir)) {
      p.reservoir = correctedReserv
      needsSave = true
    }

    if (needsSave) saveProgress(p)
  }, [progress, words, config.initialCount])

  // Seed initial selection (legacy mode) when there is none
  useEffect(() => {
    if (!progress || words.length === 0) return
    if (progress.chunkMode) return
    if (!progress.selectedIdxs || progress.selectedIdxs.length === 0) {
      const count = Math.min(words.length, config.initialCount || 5)
      const idxs = Array.from({ length: words.length }, (_, i) => i)
      const selected = fyShuffle(idxs).slice(0, count)
      const p = { ...progress, selectedIdxs: selected, poolSize: selected.length }
      saveProgress(p)
    }
  }, [progress, words, config.initialCount])

  // Build presentation order whenever pool changes
  useEffect(() => {
    if (!progress || words.length === 0) return
    const currentPool = (progress.selectedIdxs && progress.selectedIdxs.length > 0)
      ? progress.selectedIdxs.map(i => words[i])
      : words.slice(0, progress.poolSize)
    setPresentationOrder(shuffle(currentPool))
  }, [words, progress?.poolSize, progress?.selectedIdxs])

  // Eye menu refs/handlers
  const eyeMenuRef = React.useRef(null);
  const eyeButtonRef = React.useRef(null);
  useEffect(() => {
    function onKeyDown(e) { if (e.key === 'Escape') setShowEyeMenu(false) }
    function onMouseDown(e) {
      const menu = eyeMenuRef.current, btn = eyeButtonRef.current
      if (!menu) return
      if (menu.contains(e.target) || (btn && btn.contains(e.target))) return
      setShowEyeMenu(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [])

  // Studied modal
  useEffect(() => {
    if (showStudied) {
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur()
      }
      document.body.style.overflow = 'hidden'
      const onKey = (e) => { if (e.key === 'Escape') setShowStudied(false) }
      document.addEventListener('keydown', onKey)
      return () => {
        document.body.style.overflow = ''
        document.removeEventListener('keydown', onKey)
      }
    } else {
      stopAudioAndCleanup()
    }
  }, [showStudied])

  // === Chunked recall helper ===
  function buildRecallSet(p) {
    // Always build exactly by rule: max 20 per round = 19 old + 1 new (if available),
    // where "old" = 60% from union(groups) and 40% from reservoir. If any source lacks,
    // top-up from the other.
    const N = 20
    const hasNew = (p.newPool && p.newPool.length > 0)
    const newCount = hasNew ? 1 : 0
    const base = N - newCount // 19
    let fromGroups = Math.floor(base * 0.6) // 11
    let fromReserv = base - fromGroups      // 8

    const union = uniq([].concat(...p.groups))
    const ex = new Set()
    let pickG = sampleNoRep(union, fromGroups, ex); pickG.forEach(i => ex.add(i))
    let pickR = sampleNoRep(p.reservoir, fromReserv, ex); pickR.forEach(i => ex.add(i))

    // top-up if shortage
    while (pickG.length + pickR.length < base) {
      const need = base - (pickG.length + pickR.length)
      const topR = sampleNoRep(p.reservoir, need, ex); topR.forEach(i => ex.add(i)); pickR = pickR.concat(topR)
      if (pickG.length + pickR.length >= base) break
      const topG = sampleNoRep(union, need - topR.length, ex); topG.forEach(i => ex.add(i)); pickG = pickG.concat(topG)
      if (pickG.length + pickR.length >= base) break
      break
    }

    let selected = uniq([...pickG, ...pickR])

    if (hasNew) {
      const nw = p.newPool.find(v => !ex.has(v))
      if (nw != null) selected.push(nw)
    }

    return selected.slice(0, N)
  }

  // If chunkMode is on and we don't have a batch, build one
  useEffect(() => {
    if (!progress || words.length === 0) return
    if (!progress.chunkMode) return
    if (!Array.isArray(progress.currentSet) || progress.currentSet.length === 0) {
      const batch = buildRecallSet(progress)
      if (batch && batch.length) {
        saveProgress({ ...progress, currentSet: batch, selectedIdxs: batch, poolSize: batch.length })
      }
    } else {
      // ensure selectedIdxs mirrors currentSet
      const a = progress.selectedIdxs || []
      const b = progress.currentSet || []
      const same = (a.length === b.length) && a.every((v, i) => v === b[i])
      if (!same) {
        saveProgress({ ...progress, selectedIdxs: b.slice(), poolSize: b.length })
      }
    }
  }, [progress?.chunkMode, progress?.currentSet, words])

  function handleReplay() {
    const currentPool = (progress.selectedIdxs && progress.selectedIdxs.length > 0)
      ? progress.selectedIdxs.map(i => words[i])
      : words.slice(0, progress.poolSize)
    setPresentationOrder(shuffle(currentPool))
    setMode('present')
  }

  function handleSubmitRecall(lines) {
    const currentPool = (progress.selectedIdxs && progress.selectedIdxs.length > 0)
      ? progress.selectedIdxs.map(i => words[i])
      : words.slice(0, progress.poolSize)

    const targets = new Map()
    currentPool.forEach((w, idx) => {
      targets.set(normalize(w.word), idx)
      targets.set(normalize(w.reading), idx)
    })

    const answeredSet = new Set(lines.map(normalize).filter(Boolean))

    const poolMust = new Set(currentPool.map(w => normalize(w.word)))
    const ok = [...poolMust].every(base => {
      const w = currentPool.find(x => normalize(x.word) === base)
      return answeredSet.has(normalize(w.word)) || answeredSet.has(normalize(w.reading))
    })

    const missing = currentPool
      .filter(w => {
        const wn = normalize(w.word), rn = normalize(w.reading)
        return !(answeredSet.has(wn) || answeredSet.has(rn))
      })
      .map(w => w.word)

    const extras = [...answeredSet].filter(ans => !targets.has(ans))

    setLastResult({ pass: ok, missing, extras })
    setPendingOutcome(ok ? 'pass' : 'fail')
    setMode('result')
    setShowModal(true)
  }

  // Audio helpers
  function sniffMime(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return 'audio/mpeg'
    if (bytes.length >= 2 && bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) return 'audio/mpeg'
    if (bytes.length >= 4 && bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return 'audio/ogg'
    if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45) return 'audio/wav'
    if (bytes.length >= 4 && bytes[0] === 0x66 && bytes[1] === 0x4C && bytes[2] === 0x61 && bytes[3] === 0x43) return 'audio/flac'
    if (bytes.length >= 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return 'audio/mp4'
    return 'audio/mpeg'
  }
  function stopAudioAndCleanup() {
    const a = currentAudioRef.current
    if (a) { try { a.pause() } catch {} ; currentAudioRef.current = null }
    if (playingIdx !== null) setPlayingIdx(null)
  }
  async function togglePlay(idx) {
    if (playingIdx === idx) { stopAudioAndCleanup(); return }
    stopAudioAndCleanup()
    const w = words[idx]
    if (!w || !w.speech) return
    let entry = audioCacheRef.current.get(idx)
    if (!entry) {
      const bytes = decodeBase91(w.speech)
      const mime = w.speechMime || sniffMime(bytes)
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
      entry = { url, mime }
      audioCacheRef.current.set(idx, entry)
    }
    const audio = new Audio(entry.url)
    currentAudioRef.current = audio
    setPlayingIdx(idx)
    audio.onended = () => { setPlayingIdx(null); currentAudioRef.current = null }
    audio.onerror = () => { setPlayingIdx(null); currentAudioRef.current = null }
    try { await audio.play() } catch (e) { setPlayingIdx(null); currentAudioRef.current = null }
  }
  useEffect(() => {
    return () => {
      stopAudioAndCleanup()
      for (const { url } of audioCacheRef.current.values()) { try { URL.revokeObjectURL(url) } catch {} }
      audioCacheRef.current.clear()
    }
  }, [])

  function applyOutcomeAndContinue() {
    if (!pendingOutcome) { setShowModal(false); return }

    const studiedBefore = progress.studiedIdxs || []
    const studiedSet = new Set(studiedBefore)
    const currentPoolIdxs = (progress.selectedIdxs && progress.selectedIdxs.length > 0)
      ? [...progress.selectedIdxs]
      : Array.from({ length: progress.poolSize }, (_, i) => i)

    if (pendingOutcome === 'pass') {
      // Mark all in current pool as studied
      currentPoolIdxs.forEach(i => studiedSet.add(i))

      if (progress.chunkMode) {
        // CHUNK MODE: current 20 becomes a new group
        const prevGroups = Array.isArray(progress.groups) ? progress.groups.slice() : []
        const newGroup = currentPoolIdxs.slice(0, 20)
        if (newGroup.length > 0) prevGroups.push(newGroup)

        const newStudied = Array.from(studiedSet)
        const allIdx = Array.from({ length: words.length }, (_, i) => i)
        // newPool = all - studied
        let newPool = Array.isArray(progress.newPool) ? progress.newPool.filter(i => !studiedSet.has(i)) : allIdx.filter(i => !studiedSet.has(i))
        // reservoir = studied - union(groups)
        const union = new Set([].concat(...prevGroups))
        const reservoir = newStudied.filter(i => !union.has(i))

        let p = {
          ...progress,
          chunkMode: true,
          studiedIdxs: newStudied,
          groups: prevGroups,
          reservoir,
          newPool,
          currentSet: [],
          selectedIdxs: [],
          poolSize: 0,
          round: (progress.round || 1) + 1
        }
        // Next batch
        const next = buildRecallSet(p)
        if (next && next.length) { p.currentSet = next; p.selectedIdxs = next; p.poolSize = next.length }
        saveProgress(p)
      } else {
        // LEGACY MODE (growing 1-by-1) — try to add 1 new; if exceeding 20, switch to chunk mode immediately
        const currentSet = new Set(progress.selectedIdxs || [])
        const allIdx = Array.from({ length: words.length }, (_, i) => i)
        const remaining = allIdx.filter(i => !currentSet.has(i))
        const addCount = Math.min(config.increment || 1, remaining.length)
        const added = fyShuffle(remaining).slice(0, addCount)
        const wouldSelected = [...currentSet, ...added]

        if (wouldSelected.length > 20) {
          // Switch to chunk mode now, build first chunk = 19 old + 1 new
          const newStudied = Array.from(studiedSet)
          // initialize chunk state
          const groups = [] // no group yet; this set will become group after next pass
          const union = new Set()
          const reservoir = newStudied.slice()
          // newPool = all - studied
          let newPool = allIdx.filter(i => !studiedSet.has(i))

          const N = 20
          const base = N - (newPool.length > 0 ? 1 : 0)
          const ex = new Set()
          let pick = sampleNoRep(reservoir, base, ex); pick.forEach(v => ex.add(v))
          if (pick.length < base && union.size > 0) {
            pick = pick.concat(sampleNoRep(Array.from(union), base - pick.length, ex))
            pick = uniq(pick)
          }
          if (newPool.length > 0) {
            const nw = newPool.find(v => !ex.has(v))
            if (nw != null) {
              pick.push(nw)
              newPool = newPool.filter(v => v !== nw)
            }
          }
          const firstChunk = pick.slice(0, N)
          saveProgress({
            ...progress,
            chunkMode: true,
            studiedIdxs: newStudied,
            groups,
            reservoir,
            newPool,
            currentSet: firstChunk,
            selectedIdxs: firstChunk,
            poolSize: firstChunk.length,
            round: (progress.round || 1) + 1
          })
        } else {
          // Stay legacy until we hit 21
          saveProgress({
            ...progress,
            studiedIdxs: Array.from(studiedSet),
            selectedIdxs: wouldSelected,
            poolSize: wouldSelected.length,
            round: (progress.round || 1) + 1
          })
        }
      }
    } else {
      // fail: keep pool, only advance round
      saveProgress({ ...progress, round: (progress.round || 1) + 1 })
    }

    setPendingOutcome(null)
    setShowModal(false)
    setMode('present')
  }

  if (loading || !progress) return null

  const uiPool = (progress.selectedIdxs && progress.selectedIdxs.length > 0)
    ? progress.selectedIdxs.map(i => words[i])
    : words.slice(0, progress.poolSize)

  return (
    <div className="flex-1 flex flex-col">
      {/* Modal for pass/fail */}
      {mode === 'result' && lastResult && showModal && (
        <div className="modal-overlay">
          <div className="modal-panel">
            <div className={`modal-title ${lastResult.pass ? 'text-emerald-400' : 'text-rose-400'}`}>
              {lastResult.pass ? 'Great job' : 'No worries, try again'}
            </div>
            {!lastResult.pass && lastResult.missing?.length > 0 && (
              <div className="text-sm text-neutral-300 mt-3">
                <div className="opacity-80 mb-1">Missing:</div>
                <div className="flex flex-wrap gap-2">
                  {lastResult.missing.map((w, i) => (
                    <span key={i} className="px-2 py-1 rounded-lg bg-neutral-800 border border-neutral-700">{w}</span>
                  ))}
                </div>
              </div>
            )}
            {lastResult.extras?.length > 0 && (
              <div className="text-sm text-neutral-300 mt-2">
                <div className="opacity-80 mb-1">Not in the list:</div>
                <div className="flex flex-wrap gap-2">
                  {lastResult.extras.map((w, i) => (
                    <span key={i} className="px-2 py-1 rounded-lg bg-neutral-800 border border-neutral-700">{w}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="modal-actions">
              {lastResult.pass ? (
                <button
                  className="icon-btn"
                  onClick={() => { applyOutcomeAndContinue(); }}
                  title="Continue"
                  aria-label="Continue"
                >
                  Continue
                </button>
              ) : (
                <button
                  className="icon-btn"
                  onClick={() => { applyOutcomeAndContinue(); }}
                  title="Retry"
                  aria-label="Retry"
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1.5 sm:gap-2 text-sm text-neutral-300">
          <button
            className="px-2 py-1 bg-neutral-800 rounded-lg border border-neutral-700 hover:bg-neutral-700 transition"
            onClick={() => {
              if (document.activeElement && typeof document.activeElement.blur === 'function') {
                document.activeElement.blur();
              }
              setShowStudied(true);
            }}
            title="View studied list"
            aria-label="View studied list"
          >
            Studied: {(progress.studiedIdxs ? progress.studiedIdxs.length : (progress.selectedIdxs ? progress.selectedIdxs.length : progress.poolSize))}
          </button>
          <span className="px-2 py-1 bg-neutral-800 rounded-lg border border-neutral-700">
            Speed: {config.speedMs}ms
          </span>
          <span className="px-2 py-1 bg-neutral-800 rounded-lg border border-neutral-700 block sm:inline">
            Round: {progress.round || 1}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* eye menu (reading/meaning) */}
          <div className="relative">
            <button
              ref={eyeButtonRef}
              className="icon-btn"
              onClick={() => setShowEyeMenu(v => !v)}
              aria-haspopup="menu"
              aria-expanded={showEyeMenu}
              title="Visibility options"
              aria-label="Visibility options"
            >
              <Eye />
            </button>

            {showEyeMenu && (
              <div
                ref={eyeMenuRef}
                role="menu"
                aria-label="Visibility options"
                className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-neutral-700 bg-neutral-900/95 backdrop-blur shadow-xl p-2 z-50"
              >
                <div className="px-2 py-1.5 text-sm text-neutral-400">Display</div>
                <label className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-neutral-800 cursor-pointer">
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={!progress.showReading}
                    onChange={(e) => {
                      const hide = e.target.checked
                      const p = { ...progress, showReading: !hide }
                      saveProgress(p)
                    }}
                  />
                  <span className="flex-1 text-sm">Hide reading</span>
                  <span className="badge-mini">あ</span>
                </label>
                <label className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-neutral-800 cursor-pointer">
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={!progress.showMeaning}
                    onChange={(e) => {
                      const hide = e.target.checked
                      const p = { ...progress, showMeaning: !hide }
                      saveProgress(p)
                    }}
                  />
                  <span className="flex-1 text-sm">Hide meaning</span>
                  <span className="badge-mini">訳</span>
                </label>
              </div>
            )}
          </div>

          {/* replay/present */}
          <button className="icon-btn" onClick={handleReplay} title="Replay presentation" aria-label="Replay">
            <Repeat />
          </button>
          {/* reset */}
          <button className="icon-btn" onClick={onReset} title="Reset" aria-label="Reset">
            <RotateCcw />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col px-4 pb-4">

        {showStudied && (
          <div className="modal-overlay" onClick={() => setShowStudied(false)} role="dialog" aria-modal="true" aria-label="Studied words">
            <div className="modal-box" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title">Studied Words</div>
                <button className="modal-close" onClick={() => setShowStudied(false)} aria-label="Close">✕</button>
              </div>
              <div className="modal-body max-h-[60vh] overflow-auto">
                {(progress.studiedIdxs && progress.studiedIdxs.length > 0) ? (
                  <ul className="studied-list space-y-3">
                    {progress.studiedIdxs.map((i, k) => {
                      const w = words[i]
                      if (!w) return null
                      const playable = !!w.speech
                      const isPlaying = playingIdx === i
                      return (
                        <li key={k} className="studied-item p-3 rounded-lg border border-neutral-700 bg-neutral-900">
                          <div className="studied-row-top flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className={`icon-btn ${!playable ? 'opacity-40 cursor-not-allowed' : ''}`}
                                aria-label={isPlaying ? 'Stop audio' : 'Play audio'}
                                title={isPlaying ? 'Stop' : 'Play'}
                                onClick={() => playable && togglePlay(i)}
                              >
                                {isPlaying ? <Square /> : <Volume2 />}
                              </button>
                              <span className="word font-medium text-lg">{w.word}</span>
                              <span className="reading text-neutral-400">{w.reading}</span>
                            </div>
                          </div>
                          <div className="studied-row-bottom text-xs text-neutral-300 mt-1 flex justify-between">
                            <span className="meaning">{w.meaning}</span>
                            <span className="pos text-neutral-500">{w.pos}</span>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <div className="empty text-sm text-neutral-400">No studied words yet.</div>
                )}
              </div>
              <div className="modal-actions">
                <button className="icon-btn" onClick={() => setShowStudied(false)}>Close</button>
              </div>
            </div>
          </div>
        )}

        {mode === 'present' && (
          <RSVPDisplay
            items={presentationOrder}
            speedMs={config.speedMs}
            showReading={progress.showReading}
            showMeaning={progress.showMeaning}
            onDone={() => setMode('recall')}
          />
        )}

        {mode === 'recall' && (
          <div className="flex-1 flex flex-col" style={{ paddingTop: 'var(--top-offset-vh)' }}>
            <div className="flex items-center justify-center gap-2 mb-3 text-neutral-300">
              <ListChecks />
              <span className="text-sm">Retype {uiPool.length} words (order doesn't matter)</span>
            </div>
            {/* No programmatic focus */}
            <Recall targets={uiPool} onSubmit={handleSubmitRecall} />
          </div>
        )}

        {mode === 'result' && lastResult && (
          <div className="flex-1 flex flex-col gap-4 items-center justify-start text-center" style={{ paddingTop: 'var(--top-offset-vh)' }}>
            <div className={`text-xl font-bold ${lastResult.pass ? 'text-emerald-400' : 'text-red-400'}`}>
              {lastResult.pass ? 'PASS 🎉' : 'Not all correct'}
            </div>
            {!lastResult.pass && (
              <div className="text-sm text-neutral-300 space-y-2">
                {lastResult.missing.length > 0 && (
                  <div>
                    <div className="mb-1 opacity-80">Missing:</div>
                    <div className="flex flex-wrap gap-2 justify-center">
                      {lastResult.missing.map((w, i) => (
                        <span key={i} className="px-2 py-1 rounded-lg bg-neutral-800 border border-neutral-700">{w}</span>
                      ))}
                    </div>
                  </div>
                )}
                {lastResult.extras.length > 0 && (
                  <div>
                    <div className="mb-1 opacity-80">Not in the list:</div>
                    <div className="flex flex-wrap gap-2 justify-center">
                      {lastResult.extras.map((w, i) => (
                        <span key={i} className="px-2 py-1 rounded-lg bg-neutral-800 border border-neutral-700">{w}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button className="icon-btn" onClick={handleReplay} title="Next round" aria-label="Next round">
                <Presentation />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
