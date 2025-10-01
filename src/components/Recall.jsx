import React, { useEffect, useRef, useState, useMemo } from 'react'
import { normalize } from '../utils/shuffle'

export default function Recall({ targets, onSubmit }) {
  const [text, setText] = useState('')
  const taRef = useRef(null)

  useEffect(() => {
    setText('')
    setTimeout(() => taRef.current?.focus(), 50)
  }, [targets])

  const linesCount = useMemo(() => {
    return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean).length
  }, [text])

  function handleSubmit(e) {
    e.preventDefault()
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    onSubmit?.(lines)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 h-full">
      <div className="text-center text-sm text-neutral-300">Type one word per line (kanji or hiragana)</div>
      <textarea
        ref={taRef}
        className="field flex-1 font-mono min-h-[40vh]"
        placeholder={"word_1\nword_2\n..."}
        value={text}
        onChange={e => setText(e.target.value)}
      />
      <div className="text-xs text-neutral-400 self-center">Words entered: {linesCount}</div>
      <button className="icon-btn self-center" title="Submit" aria-label="Submit">✔</button>
    </form>
  )
}
