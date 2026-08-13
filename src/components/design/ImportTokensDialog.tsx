/**
 * Phase 3 assist: pull the design tokens a project literally declares (CSS
 * custom properties, Tailwind config literals) into the profile draft.
 * Extraction is deterministic and read-only — nothing is guessed, and
 * nothing changes until Apply merges into the auto-saving draft.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useLibrary } from '../../hooks/useLibrary'
import type { ExtractedTokens } from '../../types'

interface ImportTokensDialogProps {
  open: boolean
  onCancel: () => void
  onApply: (extracted: ExtractedTokens) => void
}

export function ImportTokensDialog({ open, onCancel, onApply }: ImportTokensDialogProps) {
  const { tools } = useLibrary()
  const projects = tools.filter((tool) => tool.projectPath)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sourcePath, setSourcePath] = useState<string | null>(null)
  const [result, setResult] = useState<ExtractedTokens | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      setBusy(false)
      setError(null)
      setSourcePath(null)
      setResult(null)
      return
    }
    // Focus the dialog so Escape lands on it (no input to autofocus here).
    const id = window.setTimeout(() => dialogRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [open])

  if (!open) return null

  async function extractFrom(projectPath: string) {
    setBusy(true)
    setError(null)
    setResult(null)
    setSourcePath(projectPath)
    try {
      setResult(await window.shelf.extractDesignTokens(projectPath))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function browse() {
    const folder = await window.shelf.pickFolder()
    if (folder) await extractFrom(folder)
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (!busy) onCancel()
    }
  }

  const baseCount = result
    ? result.counts.color + result.counts.typography + result.counts.dimension
    : 0
  const overrideCount = result ? result.counts.light + result.counts.dark : 0
  const total = baseCount + overrideCount

  return (
    <div
      className="name-prompt-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel()
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="name-prompt import-tokens"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-tokens-title"
        onKeyDown={onKeyDown}
      >
        <h2 id="import-tokens-title" className="name-prompt-title">
          Import tokens from a project
        </h2>
        <p className="field-hint" style={{ margin: '0 0 .85rem' }}>
          Reads the tokens a project already declares — CSS custom properties and
          Tailwind config values. Nothing is guessed; component-scoped and computed
          values are left out.
        </p>

        {!result && !busy ? (
          <>
            {projects.length > 0 ? (
              <div className="import-tokens-sources" role="list">
                {projects.map((tool) => (
                  <button
                    key={tool.id}
                    type="button"
                    role="listitem"
                    className="quick-open-row"
                    onClick={() => void extractFrom(tool.projectPath!)}
                  >
                    <span className="quick-open-row-main">
                      <span className="quick-open-row-title">{tool.name}</span>
                      <span className="quick-open-row-sub">{tool.projectPath}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="field-hint" style={{ margin: 0 }}>
                No registered tools have a project folder — choose one below.
              </p>
            )}
            <div className="action-row" style={{ marginTop: '.75rem' }}>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => void browse()}>
                Choose folder…
              </button>
            </div>
          </>
        ) : null}

        {busy ? (
          <p className="field-hint" style={{ margin: 0 }}>
            Scanning {sourcePath}…
          </p>
        ) : null}

        {error ? (
          <div className="warning-card" role="alert" style={{ marginTop: '.5rem' }}>
            {error}
          </div>
        ) : null}

        {result ? (
          <div className="stack" style={{ gap: '.6rem' }}>
            <p style={{ margin: 0 }}>
              {total === 0 ? (
                <>No literal design tokens found in this project.</>
              ) : (
                <>
                  Found <strong>{result.counts.color}</strong> colors,{' '}
                  <strong>{result.counts.typography}</strong> typography and{' '}
                  <strong>{result.counts.dimension}</strong> dimension tokens
                  {overrideCount > 0 ? (
                    <>
                      {' '}
                      plus <strong>{overrideCount}</strong> light/dark overrides
                    </>
                  ) : null}
                  .
                </>
              )}
            </p>
            {result.sources.length > 0 ? (
              <ul className="import-tokens-files">
                {result.sources.map((source) => (
                  <li key={source.file}>
                    <code>{source.file}</code> — {source.declarations} declaration
                    {source.declarations === 1 ? '' : 's'}
                  </li>
                ))}
              </ul>
            ) : null}
            {result.skipped.length > 0 ? (
              <details>
                <summary className="field-hint" style={{ cursor: 'pointer' }}>
                  Not extracted ({result.skipped.length})
                </summary>
                <ul className="import-tokens-files">
                  {result.skipped.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            <div className="action-row" style={{ margin: 0 }}>
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                onClick={() => {
                  setResult(null)
                  setSourcePath(null)
                }}
              >
                Pick another project
              </button>
            </div>
          </div>
        ) : null}

        <div className="name-prompt-actions">
          <button type="button" className="btn btn-quiet" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !result || total === 0}
            onClick={() => result && onApply(result)}
          >
            {total > 0 ? `Add ${total} token${total === 1 ? '' : 's'}` : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  )
}
