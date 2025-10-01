import React, { useState } from 'react'
import { Play } from 'lucide-react'

export default function Setup({ onSave }) {
  const [initialCount, setInitialCount] = useState(5)
  const [speedMs, setSpeedMs] = useState(700)
  const [increment, setIncrement] = useState(1)

  return (
    <div className="flex flex-col gap-6 justify-center" style={{ paddingTop: '12vh' }}>
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold">Initial setup</h1>
        <p className="text-neutral-400 text-sm">Settings are locked during practice. To change them, use Reset.</p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <label className="label flex flex-col gap-2">
          Initial word count (1-20)
          <input className="field" type="number" min={1} max={20} value={initialCount}
                 onChange={e => setInitialCount(parseInt(e.target.value || '1'))} />
        </label>

        <label className="label flex flex-col gap-2">
          Transition speed (ms)
          <input className="field" type="number" min={150} step={50} value={speedMs}
                 onChange={e => setSpeedMs(parseInt(e.target.value || '150'))} />
        </label>

        <label className="label flex flex-col gap-2">
          Words to add on each pass
          <input className="field" type="number" min={1} max={50} value={increment}
                 onChange={e => setIncrement(parseInt(e.target.value || '1'))} />
        </label>
      </div>

      <div className="flex justify-center pt-2">
        <button
          className="icon-btn flex items-center gap-2"
          onClick={() => onSave({ initialCount: Math.max(1, initialCount), speedMs: Math.max(150, speedMs), increment: Math.max(1, increment) })}
          title="Start"
          aria-label="Start"
        >
          <Play />
          <span className="sr-only">Start</span>
        </button>
      </div>
    </div>
  )
}
