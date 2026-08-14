/**
 * Phase 3 assist: pull the design tokens a project literally declares (CSS
 * custom properties, Tailwind config literals) into the profile draft.
 * Extraction is deterministic and read-only — nothing is guessed, and
 * nothing changes until Apply merges into the auto-saving draft. Additive
 * by design: resyncing a profile must not destroy hand-set tokens (fresh
 * project-seeded profiles come from the New profile wizard instead).
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ExtractionSummary, extractionTotal } from './ExtractionSummary'
import { ProjectSourceList } from './ProjectSourceList'
import type { ExtractedTokens } from '../../types'

interface ImportTokensDialogProps {
  open: boolean
  onCancel: () => void
  onApply: (extracted: ExtractedTokens) => void
}

export function ImportTokensDialog({ open, onCancel, onApply }: ImportTokensDialogProps) {
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

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (!busy) onCancel()
    }
  }

  const total = result ? extractionTotal(result) : 0

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
          values are left out. Imported values update matching tokens; everything
          else you have set stays.
        </p>

        {!result && !busy ? <ProjectSourceList onPick={(path) => void extractFrom(path)} /> : null}

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
            <ExtractionSummary result={result} />
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
