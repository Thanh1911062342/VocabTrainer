import React, { useEffect, useState } from 'react'
import Setup from './components/Setup'
import Trainer from './components/Trainer'

const LS_CONFIG_KEY = 'rsvpConfig'
const LS_PROGRESS_KEY = 'rsvpProgress'

export default function App() {
  const [config, setConfig] = useState(null)
  const [booted, setBooted] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem(LS_CONFIG_KEY)
    if (saved) setConfig(JSON.parse(saved))
    setBooted(true)
  }, [])

  if (!booted) return null

  if (!config) {
    return <div className="app-shell p-4 sm:p-6">
      <Setup onSave={(cfg) => {
        localStorage.setItem(LS_CONFIG_KEY, JSON.stringify({ ...cfg, createdAt: Date.now() }))
        // Initialize progress
        localStorage.setItem(LS_PROGRESS_KEY, JSON.stringify({
          poolSize: cfg.initialCount,
          nextIndex: cfg.initialCount,
          showReading: true,
          showMeaning: true,
          round: 1,
        }))
        setConfig(cfg)
      }} />
    </div>
  }

  return (
    <div className="app-shell">
      <Trainer
        config={config}
        configKey={LS_CONFIG_KEY}
        progressKey={LS_PROGRESS_KEY}
        onReset={() => {
          localStorage.removeItem(LS_CONFIG_KEY)
          localStorage.removeItem(LS_PROGRESS_KEY)
          setConfig(null)
        }}
      />
    </div>
  )
}
