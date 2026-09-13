import { useEffect, useRef, useState } from 'react'
import type { LogLine } from '../types'

export function LogPanel({ lines }: { lines: LogLine[] }) {
  const panel = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)
  useEffect(() => {
    if (follow && panel.current) panel.current.scrollTop = panel.current.scrollHeight
  }, [lines, follow])
  return (
    <>
      <label className="log-follow">
        <input
          type="checkbox"
          checked={follow}
          onChange={(event) => setFollow(event.target.checked)}
        />{' '}
        Follow new output
      </label>
      <div
        ref={panel}
        className="log-panel"
        role="log"
        aria-label="Run output"
        aria-live="off"
        tabIndex={0}
      >
        {lines.length === 0 ? (
          <p className="log-line" data-stream="system">
            No output is available for this run. Shelf retains logs for the five most recent runs;
            older tools may have no recorded output.
          </p>
        ) : (
          lines.map((line, index) => (
            <p key={`${line.at}-${index}`} className="log-line" data-stream={line.stream}>
              {line.text}
            </p>
          ))
        )}
      </div>
    </>
  )
}
