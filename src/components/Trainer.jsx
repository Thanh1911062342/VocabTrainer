// src/components/Trainer.jsx
// Robust small-pool + chunk gate. Fix empty screen by seeding immediately if poolSize>0 but selectedIdxs is empty.
// Also fix stopAudioAndCleanup, and re-run present effect when selectedIdxs/poolSize change.
import React, { useEffect, useState } from 'react'
import { Eye, RotateCcw, Repeat, Presentation, ListChecks, Volume2, Square } from 'lucide-react'
import RSVPDisplay from './RSVPDisplay'
import Recall from './Recall'
import { shuffle, normalize } from '../utils/shuffle'
import { decodeBase91 } from '../utils/base91'

const CHUNK_SIZE = 20

function uniq(arr) { const s = new Set(arr); return [...s] }
function sampleWithoutReplacement(pool, k, excludeSet) {
  const filtered = !excludeSet ? [...pool] : pool.filter(i => !excludeSet.has(i))
  if (k >= filtered.length) return [...filtered]
  const a = [...filtered]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, k)
}
function diff(a, bSet) { return a.filter(x => !bSet.has(x)) }
function unionMany(groups) { const s = new Set(); for (const g of groups) for (const i of g) s.add(i); return [...s] }

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

  // Audio state/cache for Studied modal
  const [playingIdx, setPlayingIdx] = useState(null)
  const audioCacheRef = React.useRef(new Map()) // idx -> { url, mime }
  const currentAudioRef = React.useRef(null)

  // Load data + progress
  useEffect(() => {
    async function load() {
      setLoading(true)
      const res = await fetch(`${import.meta.env.BASE_URL}mock-be/words.json`)
      const data = await res.json()
      setWords(data)
      const saved = localStorage.getItem(progressKey)
      let p = saved ? JSON.parse(saved) : {}
      // Backfill defaults
      if (!Array.isArray(p.studiedIdxs)) p.studiedIdxs = []
      if (!Array.isArray(p.groups)) p.groups = []                // chunk mode groups
      if (typeof p.nextNewPtr !== 'number') p.nextNewPtr = 0     // for chunk mode
      if (!('showReading' in p)) p.showReading = true
      if (!('showMeaning' in p)) p.showMeaning = true
      // Old-logic pool
      if (!Array.isArray(p.selectedIdxs)) p.selectedIdxs = []
      if (typeof p.poolSize !== 'number') p.poolSize = 0
      setProgress(p)
      setLoading(false)
    }
    load()
  }, [progressKey])

  function saveProgress(p) {
    setProgress(p)
    localStorage.setItem(progressKey, JSON.stringify(p))
  }

  // First-time init if neither selectedIdxs nor poolSize defined
  useEffect(() => {
    if (!progress || words.length === 0) return
    const hasSelection = progress.selectedIdxs && progress.selectedIdxs.length > 0
    const hasPool = (progress.poolSize || 0) > 0
    if (hasSelection || hasPool) return
    const count = Math.min(words.length, config.initialCount || 5)
    if (count > 0) {
      const idxs = Array.from({ length: words.length }, (_, i) => i)
      const selected = sampleWithoutReplacement(idxs, count)
      saveProgress({ ...progress, selectedIdxs: selected, poolSize: selected.length })
    }
  }, [progress, words, config.initialCount])

  // Helpers
  function getSmallPoolIdxs(p) {
    if (p.selectedIdxs && p.selectedIdxs.length > 0) return [...p.selectedIdxs]
    return []
  }
  function shouldUseChunks(p) {
    const size = (p.selectedIdxs && p.selectedIdxs.length > 0) ? p.selectedIdxs.length : (p.poolSize || 0)
    return size > CHUNK_SIZE // only when pool > 20
  }

  // Chunk mode picker
  function pickNextNew(p, excludeSet) {
    const total = words.length
    if (total === 0) return null
    for (let pass = 0; pass < 2; pass++) {
      for (let i = p.nextNewPtr; i < total; i++) {
        if (!p.studiedIdxs.includes(i) && !excludeSet.has(i)) {
          p.nextNewPtr = (i + 1) % total
          return i
        }
      }
      p.nextNewPtr = 0
    }
    return null
  }
  function buildRecallSetChunk(p) {
    if (!words.length) return []
    if (p.currentSet && p.currentSet.length) return p.currentSet

    const exclude = new Set()
    const unionGroups = unionMany(p.groups)
    const setInGroups = new Set(unionGroups)
    const reservoir = diff(p.studiedIdxs, setInGroups) // studied but not grouped

    const newIdx = pickNextNew(p, exclude)
    const newCount = (newIdx !== null) ? 1 : 0
    if (newCount === 1) exclude.add(newIdx)
    const base = Math.max(0, CHUNK_SIZE - newCount) // 19 if 1 new

    let fromGroups = Math.floor(base * 0.6) // 11
    let fromReserv = base - fromGroups      // 8

    const pickG = sampleWithoutReplacement(unionGroups, fromGroups, exclude)
    pickG.forEach(i => exclude.add(i))
    const pickR = sampleWithoutReplacement(reservoir, fromReserv, exclude)
    pickR.forEach(i => exclude.add(i))

    let selected = uniq([...pickG, ...pickR])

    // Top-up if lacking
    while (selected.length < base) {
      const moreR = sampleWithoutReplacement(reservoir, 1, new Set(selected))
      if (moreR.length) { selected.push(moreR[0]); continue }
      const moreG = sampleWithoutReplacement(unionGroups, 1, new Set(selected))
      if (moreG.length) { selected.push(moreG[0]); continue }
      break
    }
    while (selected.length < base) {
      const extraNew = pickNextNew(p, new Set([...selected, ...(newCount ? [newIdx] : [])]))
      if (extraNew === null) break
      selected.push(extraNew)
    }

    if (newCount === 1 && !selected.includes(newIdx)) selected.push(newIdx)
    selected = selected.slice(0, CHUNK_SIZE)

    p.currentSet = selected
    return selected
  }

  // Build presentation set whenever we enter 'present'
  useEffect(() => {
    if (!progress || !words.length) return
    if (mode !== 'present') return

    const p = { ...progress }
    const hasSelection = p.selectedIdxs && p.selectedIdxs.length > 0
    const hasPool = (p.poolSize || 0) > 0

    // If small-pool path but selection is empty while poolSize>0, seed immediately and retry on next render
    const usingChunks = shouldUseChunks(p)
    if (!usingChunks && !hasSelection && hasPool) {
      const population = Array.from({ length: words.length }, (_, i) => i)
      const picked = sampleWithoutReplacement(population, Math.min(p.poolSize, words.length))
      saveProgress({ ...p, selectedIdxs: picked })
      return
    }

    let items = []
    if (usingChunks) {
      const set = buildRecallSetChunk(p)
      if (JSON.stringify(p) !== JSON.stringify(progress)) saveProgress(p)
      items = set.map(i => words[i])
    } else {
      const idxs = getSmallPoolIdxs(p)
      items = idxs.map(i => words[i])
    }
    setPresentationOrder(shuffle(items))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, progress?.currentSet, progress?.selectedIdxs, progress?.poolSize, words])

  // Eye menu refs/handlers
  const eyeMenuRef = React.useRef(null);
  const eyeButtonRef = React.useRef(null);
  useEffect(() => {
    function onKeyDown(e) { if (e.key === 'Escape') setShowEyeMenu(false) }
    function onMouseDown(e) {
      const menu = eyeMenuRef.current; const btn = eyeButtonRef.current
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

  // Studied modal: avoid focus, cleanup
  useEffect(() => {
    if (showStudied) {
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
      document.body.style.overflow = 'hidden';
      const onKey = (e) => { if (e.key === 'Escape') setShowStudied(false); };
      document.addEventListener('keydown', onKey);
      return () => {
        document.body.style.overflow = '';
        document.removeEventListener('keydown', onKey);
      };
    } else {
      stopAudioAndCleanup()
    }
  }, [showStudied])

  function handleReplay() {
    setMode('present')
    const p = progress
    if (!p) return
    let items = []
    if (shouldUseChunks(p)) {
      const set = p.currentSet || []
      items = set.map(i => words[i])
    } else {
      const idxs = getSmallPoolIdxs(p)
      items = idxs.map(i => words[i])
    }
    setPresentationOrder(shuffle(items))
  }

  function handleSubmitRecall(lines) {
    const p = progress
    if (!p) return
    let currentPool = []

    if (shouldUseChunks(p)) {
      const set = p.currentSet || []
      currentPool = set.map(i => words[i])
    } else {
      const idxs = getSmallPoolIdxs(p)
      currentPool = idxs.map(i => words[i])
    }

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

  function applyOutcomeAndContinue() {
    if (!pendingOutcome) { setShowModal(false); return }
    const p = { ...progress }
    p.round = (p.round || 1) + 1

    if (shouldUseChunks(p)) {
      const set = p.currentSet || []
      if (pendingOutcome === 'pass') {
        if (set.length) p.groups = [...(p.groups || []), [...set]]
        const s = new Set(p.studiedIdxs || [])
        set.forEach(i => s.add(i))
        p.studiedIdxs = [...s]
        p.currentSet = null
      } else {
        // fail: keep currentSet
      }
    } else {
      // Old logic for small pool (≤20): grow selectedIdxs by config.increment on pass
      const idxs = getSmallPoolIdxs(p)
      if (pendingOutcome === 'pass') {
        // Mark studied
        const s = new Set(p.studiedIdxs || [])
        idxs.forEach(i => s.add(i))
        // Add new words to selection
        const currentSet = new Set(p.selectedIdxs || [])
        const allIdx = Array.from({ length: words.length }, (_, i) => i)
        const remaining = allIdx.filter(i => !currentSet.has(i))
        for (let i = remaining.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[remaining[i], remaining[j]] = [remaining[j], remaining[i]]
        }
        const addCount = Math.min(config.increment || 1, remaining.length)
        const added = remaining.slice(0, addCount)
        const newSelected = [...currentSet, ...added]
        p.selectedIdxs = newSelected
        p.poolSize = newSelected.length
        p.studiedIdxs = [...s]
      } else {
        // fail: keep same set
      }
    }

    setPendingOutcome(null)
    setShowModal(false)
    saveProgress(p)
    setMode('present')
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
    setPlayingIdx(null)
  }
  async function togglePlay(idx) {
    if (playingIdx === idx) { stopAudioAndCleanup(); return }
    stopAudioAndCleanup()
    const w = words[idx]; if (!w || !w.speech) return
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
    audio.onerror  = () => { setPlayingIdx(null); currentAudioRef.current = null }
    try { await audio.play() } catch (e) { setPlayingIdx(null); currentAudioRef.current = null; console.error('Audio play error', e) }
  }
  useEffect(() => {
    return () => {
      stopAudioAndCleanup()
      for (const { url } of audioCacheRef.current.values()) { try { URL.revokeObjectURL(url) } catch {} }
      audioCacheRef.current.clear()
    }
  }, [])

  if (loading || !progress) return null

  // UI pool for recall screen
  const usingChunks = shouldUseChunks(progress)
  const uiIdxs = usingChunks ? (progress.currentSet || []) : getSmallPoolIdxs(progress)
  const uiPool = uiIdxs.map(i => words[i])

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
              <button className="icon-btn" onClick={() => { applyOutcomeAndContinue(); }}>
                {lastResult.pass ? 'Continue' : 'Retry'}
              </button>
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
            Studied: {(progress.studiedIdxs ? progress.studiedIdxs.length : 0)}
          </button>
          <span className="px-2 py-1 bg-neutral-800 rounded-lg border border-neutral-700">
            Speed: {config.speedMs}ms
          </span>
          <span className="px-2 py-1 bg-neutral-800 rounded-lg border border-neutral-700 block sm:inline">
            Round: {progress.round || 1}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* eye menu */}
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
                    onChange={(e) => { const hide = e.target.checked; const p = { ...progress, showReading: !hide }; saveProgress(p) }}
                  />
                  <span className="flex-1 text-sm">Hide reading</span>
                  <span className="badge-mini">あ</span>
                </label>
                <label className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-neutral-800 cursor-pointer">
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={!progress.showMeaning}
                    onChange={(e) => { const hide = e.target.checked; const p = { ...progress, showMeaning: !hide }; saveProgress(p) }}
                  />
                  <span className="flex-1 text-sm">Hide meaning</span>
                  <span className="badge-mini">訳</span>
                </label>
              </div>
            )}
          </div>
          <button className="icon-btn" onClick={handleReplay} title="Replay presentation" aria-label="Replay">
            <Repeat />
          </button>
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
                      const w = words[i]; if (!w) return null
                      const playable = !!w.speech; const isPlaying = playingIdx === i
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
              <span className="text-sm">
                Retype {uiPool.length || CHUNK_SIZE} words (order doesn't matter)
              </span>
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
                {lastResult.extras && lastResult.extras.length > 0 && (
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