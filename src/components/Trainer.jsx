import React, { useEffect, useMemo, useState } from 'react'
import { Eye, RotateCcw, Repeat, Presentation, ListChecks } from 'lucide-react'
import RSVPDisplay from './RSVPDisplay'
import Recall from './Recall'
import { shuffle, normalize } from '../utils/shuffle'

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

  // Load data + progress
  useEffect(() => {
    if (!showStudied) return;
    const onKey = (e) => { if (e.key === 'Escape') setShowStudied(false) };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showStudied])

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

  // Ensure studiedIdxs exists
  useEffect(() => {
    if (!showStudied) return;
    const onKey = (e) => { if (e.key === 'Escape') setShowStudied(false) };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showStudied])

  useEffect(() => {
    if (progress && !Array.isArray(progress.studiedIdxs)) {
      saveProgress({ ...progress, studiedIdxs: [] })
    }
  }, [progress])

  // Initialize random selection on first run (if missing)
  useEffect(() => {
    if (!showStudied) return;
    const onKey = (e) => { if (e.key === 'Escape') setShowStudied(false) };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showStudied])

  useEffect(() => {
    if (!progress || words.length === 0) return
    if (!progress.selectedIdxs || !Array.isArray(progress.selectedIdxs) || progress.selectedIdxs.length === 0) {
      const count = Math.min(words.length, config.initialCount || 5)
      const idxs = Array.from({ length: words.length }, (_, i) => i)
      for (let i = idxs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[idxs[i], idxs[j]] = [idxs[j], idxs[i]]
      }
      const selected = idxs.slice(0, count)
      const p = { ...progress, selectedIdxs: selected, poolSize: selected.length }
      saveProgress(p)
    }
  }, [progress, words, config.initialCount])

  // Prepare presentation order when the ACTIVE POOL changes (not on UI toggles)
useEffect(() => {
    if (!showStudied) return;
    const onKey = (e) => { if (e.key === 'Escape') setShowStudied(false) };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showStudied])

  useEffect(() => {
  if (!progress || words.length === 0) return
  const currentPool = (progress.selectedIdxs && progress.selectedIdxs.length > 0)
    ? progress.selectedIdxs.map(i => words[i])
    : words.slice(0, progress.poolSize)
  setPresentationOrder(shuffle(currentPool))
  // NOTE: do NOT auto-switch mode here; avoid unintended jumps when toggling UI flags.
}, [words, progress?.poolSize, progress?.selectedIdxs])

  
const eyeMenuRef = React.useRef(null);
const eyeButtonRef = React.useRef(null);

useEffect(() => {
    if (!showStudied) return;
    const onKey = (e) => { if (e.key === 'Escape') setShowStudied(false) };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showStudied])

  useEffect(() => {
  function onKeyDown(e) {
    if (e.key === 'Escape') setShowEyeMenu(false);
  }
  function onMouseDown(e) {
    const menu = eyeMenuRef.current;
    const btn = eyeButtonRef.current;
    if (!menu) return;
    if (menu.contains(e.target) || (btn && btn.contains(e.target))) return;
    setShowEyeMenu(false);
  }
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('mousedown', onMouseDown);
  return () => {
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('mousedown', onMouseDown);
  };
}, []);
function saveProgress(p) {
    setProgress(p)
    localStorage.setItem(progressKey, JSON.stringify(p))
  }

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

    // Build sets of acceptable answers
    const targets = new Map()
    currentPool.forEach((w, idx) => {
      targets.set(normalize(w.word), idx)
      targets.set(normalize(w.reading), idx)
    })

    const answeredSet = new Set(lines.map(normalize).filter(Boolean))

    // Evaluate: all unique targets must be present (per word at least one of kanji/hiragana)
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
    if (pendingOutcome === 'pass') {

// Update studied list with current pool indices when pass
const currentPoolIdxs = (progress.selectedIdxs && progress.selectedIdxs.length > 0)
  ? [...progress.selectedIdxs]
  : Array.from({ length: progress.poolSize }, (_, i) => i)
const studiedSet = new Set(progress.studiedIdxs || [])
currentPoolIdxs.forEach(i => studiedSet.add(i))

      const currentSet = new Set(progress.selectedIdxs || [])
      const allIdx = Array.from({ length: words.length }, (_, i) => i)
      const remaining = allIdx.filter(i => !currentSet.has(i))
      for (let i = remaining.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[remaining[i], remaining[j]] = [remaining[j], remaining[i]]
      }
      const addCount = Math.min(config.increment || 1, remaining.length)
      const added = remaining.slice(0, addCount)
      const newSelected = [...currentSet, ...added]
      saveProgress({ ...progress, studiedIdxs: Array.from(studiedSet), selectedIdxs: newSelected, poolSize: newSelected.length, round: (progress.round || 1) + 1 })
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
        <div className="flex items-center gap-2 text-sm text-neutral-300">
          <span className="px-2 py-1 bg-neutral-800 rounded-lg border border-neutral-700 hidden sm:inline">Speed: {config.speedMs}ms</span>
          <button className="px-2 py-1 bg-neutral-800 rounded-lg border border-neutral-700 hover:bg-neutral-700 transition" onClick={() => setShowStudied(true)} title="View studied list" aria-label="View studied list">Studied: {(progress.studiedIdxs ? progress.studiedIdxs.length : (progress.selectedIdxs ? progress.selectedIdxs.length : progress.poolSize))}</button>
          <span className="px-2 py-1 bg-neutral-800 rounded-lg border border-neutral-700">Round: {progress.round || 1}</span>
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
      <div className="modal-body">
        {(progress.studiedIdxs && progress.studiedIdxs.length > 0) ? (
          <ul className="studied-list">
            {progress.studiedIdxs.map((i, k) => {
              const w = words[i]
              if (!w) return null
              return (
                <li key={k} className="studied-item">
                  <div className="studied-row-top">
                    <span className="word text-2xl">{w.word}</span>
                    <span className="reading">{w.reading}</span>
                  </div>
                  <div className="studied-row-bottom">
                    <span className="meaning">{w.meaning}</span>
                    <span className="pos">{w.pos}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="empty">No studied words yet.</div>
        )}
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
