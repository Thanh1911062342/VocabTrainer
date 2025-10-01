import React, { useEffect, useRef, useState, useCallback } from 'react'

export default function RSVPDisplay({ items, speedMs, showReading, showMeaning, onDone }) {
  const [idx, setIdx] = useState(0)
  const [paused, setPaused] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => { setIdx(0) }, [items])

  const clearTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }, [])

  const startTimer = useCallback(() => {
    if (!items || items.length === 0) return
    clearTimer()
    timerRef.current = setInterval(() => {
      setIdx(prev => {
        if (prev + 1 >= items.length) {
          clearTimer()
          setTimeout(() => onDone?.(), 250)
          return prev + 1
        }
        return prev + 1
      })
    }, Math.max(100, speedMs))
  }, [items, speedMs, onDone, clearTimer])

  useEffect(() => {
    if (paused) clearTimer(); else startTimer()
    return clearTimer
  }, [paused, startTimer, clearTimer])

  useEffect(() => {
    if (!paused) startTimer()
    return clearTimer
  }, [items, speedMs])

  const item = items?.[Math.min(idx, (items?.length || 1) - 1)]
  if (!item) return null

  const handleHoldStart = () => setPaused(true)
  const handleHoldEnd = () => setPaused(false)

  return (
    <div className="flex-1 flex flex-col items-center" style={{ paddingTop: 'var(--top-offset-vh)' }}>
      <div
        className="flex-1 w-full flex flex-col items-center justify-start px-4 text-center select-none"
        onMouseDown={handleHoldStart}
        onMouseUp={handleHoldEnd}
        onMouseLeave={handleHoldEnd}
        onTouchStart={handleHoldStart}
        onTouchEnd={handleHoldEnd}
      >
        {showReading && <div className="word-reading mb-2">{item.reading}</div>}
        <div className="word-main">{item.word}</div>
        {showMeaning && <div className="word-meaning mt-2">{item.meaning}</div>}
      </div>
      <div className="pb-6 text-neutral-400 text-xs">{`Showing ${Math.min(idx+1, items.length)} / ${items.length}`}</div>
      {paused && <div className="text-xs text-neutral-400 mb-2">Paused (hold to inspect, release to continue)</div>}
    </div>
  )
}
