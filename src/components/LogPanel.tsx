import { useEffect, useRef } from 'react'
import type { LogLine } from '../types'

export function LogPanel({ lines }: { lines: LogLine[] }) {
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [lines.length])

  return (
    <div className="log-panel" role="log" aria-live="polite" aria-relevant="additions">
      {lines.length === 0 ? (
        <p className="log-line" data-stream="system">
          No output yet. Launch the tool to stream logs here.
        </p>
      ) : (
        lines.map((line, index) => (
          <p key={`${line.at}-${index}`} className="log-line" data-stream={line.stream}>
            {line.text}
          </p>
        ))
      )}
      <div ref={endRef} />
    </div>
  )
}
