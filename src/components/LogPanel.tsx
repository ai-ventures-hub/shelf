import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { LogLine } from '../types'

/** Rows rendered at once; earlier output stays in memory behind a button. */
const RENDER_STEP = 500
/** Distance from the bottom that still counts as "at the bottom". */
const BOTTOM_SLACK = 24
type StreamFilter = 'all' | LogLine['stream']

// Lines without an id (rare system notes) get a stable per-object key, so a
// buffer that trims its head never shifts every row's key.
const fallbackKeys = new WeakMap<LogLine, string>()
let fallbackSeq = 0
function keyFor(line: LogLine): string {
  if (line.id) return line.id
  let key = fallbackKeys.get(line)
  if (!key) {
    key = `line-${++fallbackSeq}`
    fallbackKeys.set(line, key)
  }
  return key
}

const LogRow = memo(function LogRow({ line }: { line: LogLine }) {
  return (
    <p className="log-line" data-stream={line.stream}>
      {line.text}
    </p>
  )
})

export function LogPanel({
  lines,
  emptyMessage = 'No output is available for this run. Shelf retains logs for the five most recent runs; older tools may have no recorded output.',
}: {
  lines: LogLine[]
  emptyMessage?: string
}) {
  const panel = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)
  const [stream, setStream] = useState<StreamFilter>('all')
  const [query, setQuery] = useState('')
  const atBottom = useRef(true)
  const [renderCount, setRenderCount] = useState(RENDER_STEP)

  const stderrCount = useMemo(
    () => lines.reduce((count, line) => count + (line.stream === 'stderr' ? 1 : 0), 0),
    [lines],
  )
  const needle = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (stream === 'all' && !needle) return lines
    return lines.filter((line) => {
      if (stream !== 'all' && line.stream !== stream) return false
      if (needle && !line.text.toLowerCase().includes(needle)) return false
      return true
    })
  }, [lines, stream, needle])

  const hidden = Math.max(0, filtered.length - renderCount)
  const shown = hidden > 0 ? filtered.slice(hidden) : filtered
  const filtering = stream !== 'all' || Boolean(needle)

  // Follow only while the reader is already at the bottom; scrolling up to
  // read earlier output pauses it until they return.
  useLayoutEffect(() => {
    const el = panel.current
    if (follow && atBottom.current && el) el.scrollTop = el.scrollHeight
  }, [filtered, follow])

  // A new run (buffer emptied) starts from the default window again.
  useEffect(() => {
    if (lines.length === 0) setRenderCount(RENDER_STEP)
  }, [lines.length])

  return (
    <>
      <div className="log-toolbar">
        <div className="log-streams" role="group" aria-label="Filter log stream">
          {(['all', 'stderr', 'stdout', 'system'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className={`log-stream-chip${stream === kind ? ' is-active' : ''}`}
              aria-pressed={stream === kind}
              onClick={() => setStream(kind)}
            >
              {kind === 'all'
                ? 'All'
                : kind === 'stderr'
                  ? `stderr${stderrCount > 0 ? ` (${stderrCount})` : ''}`
                  : kind}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="field-input log-filter-input"
          placeholder="Filter output…"
          aria-label="Filter output"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <label className="log-follow">
          <input
            type="checkbox"
            checked={follow}
            onChange={(event) => {
              setFollow(event.target.checked)
              if (event.target.checked) atBottom.current = true
            }}
          />{' '}
          Follow new output
        </label>
      </div>
      <div
        ref={panel}
        className="log-panel"
        role="log"
        aria-label="Run output"
        aria-live="off"
        tabIndex={0}
        onScroll={(event) => {
          const el = event.currentTarget
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK
        }}
      >
        {lines.length === 0 ? (
          <p className="log-line" data-stream="system">
            {emptyMessage}
          </p>
        ) : filtered.length === 0 ? (
          <p className="log-line" data-stream="system">
            No matching output lines.
          </p>
        ) : (
          <>
            {hidden > 0 ? (
              <button
                type="button"
                className="btn btn-quiet btn-sm log-earlier"
                onClick={() => setRenderCount((count) => count + RENDER_STEP)}
              >
                Show earlier output ({hidden} {hidden === 1 ? 'line' : 'lines'})
              </button>
            ) : null}
            {shown.map((line) => (
              <LogRow key={keyFor(line)} line={line} />
            ))}
          </>
        )}
      </div>
      {filtering && lines.length > 0 ? (
        <p className="log-match-summary">
          Showing {filtered.length} of {lines.length} {lines.length === 1 ? 'line' : 'lines'}
        </p>
      ) : null}
    </>
  )
}

/** Last few lines of live or failed output, for the Overview. */
export function LogTail({ lines, count = 8 }: { lines: LogLine[]; count?: number }) {
  const tail = lines.slice(-count)
  if (tail.length === 0) return null
  return (
    <div className="log-panel log-tail" role="log" aria-label="Recent output" aria-live="off">
      {tail.map((line) => (
        <LogRow key={keyFor(line)} line={line} />
      ))}
    </div>
  )
}
