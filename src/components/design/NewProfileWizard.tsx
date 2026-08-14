/**
 * New-profile wizard (Design Engine Phase 3c): name → source → preview →
 * create. A project-sourced profile is seeded ONLY with the extracted
 * tokens — the starter palette is reserved for deliberately blank profiles,
 * so imported brands never carry starter leftovers.
 */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ExtractionSummary, extractionTotal } from './ExtractionSummary'
import { ProjectSourceList } from './ProjectSourceList'
import { STARTER_TOKENS } from '../../lib/designTokens'
import type { DesignTokenGroup, ExtractedTokens } from '../../types'

export interface NewProfileInput {
  name: string
  tokens: DesignTokenGroup
  modes?: { light: DesignTokenGroup; dark: DesignTokenGroup }
  sourceNote?: string
}

interface NewProfileWizardProps {
  open: boolean
  onCancel: () => void
  onCreate: (input: NewProfileInput) => void | Promise<void>
}

type Step = 'name' | 'source' | 'preview'

export function NewProfileWizard({ open, onCancel, onCreate }: NewProfileWizardProps) {
  const [step, setStep] = useState<Step>('name')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sourcePath, setSourcePath] = useState<string | null>(null)
  const [result, setResult] = useState<ExtractedTokens | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      setStep('name')
      setName('')
      setBusy(false)
      setError(null)
      setSourcePath(null)
      setResult(null)
      return
    }
    const id = window.setTimeout(() => nameRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [open])

  if (!open) return null

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (!busy) onCancel()
    }
  }

  function nextFromName(e?: FormEvent) {
    e?.preventDefault()
    if (name.trim()) setStep('source')
  }

  async function createWith(input: NewProfileInput) {
    setBusy(true)
    setError(null)
    try {
      await onCreate(input)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function extractFrom(projectPath: string) {
    setBusy(true)
    setError(null)
    setResult(null)
    setSourcePath(projectPath)
    try {
      setResult(await window.shelf.extractDesignTokens(projectPath))
      setStep('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
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
        aria-labelledby="new-profile-title"
        onKeyDown={onKeyDown}
      >
        <h2 id="new-profile-title" className="name-prompt-title">
          New design profile
        </h2>

        {step === 'name' ? (
          <form onSubmit={nextFromName}>
            <label className="field">
              <span className="field-label">Profile name</span>
              <input
                ref={nameRef}
                className="field-input"
                value={name}
                placeholder="e.g. Acme Studio"
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="name-prompt-actions">
              <button type="button" className="btn btn-quiet" onClick={onCancel}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
                Next
              </button>
            </div>
          </form>
        ) : null}

        {step === 'source' ? (
          <>
            <p className="field-hint" style={{ margin: '0 0 .85rem' }}>
              Start “{name.trim()}” from a neutral starter palette, or seed it with
              the tokens a project already declares (CSS custom properties, Tailwind
              config — nothing is guessed).
            </p>
            <div className="import-tokens-sources">
              <button
                type="button"
                className="quick-open-row"
                style={{ width: '100%' }}
                disabled={busy}
                onClick={() => void createWith({ name: name.trim(), tokens: STARTER_TOKENS })}
              >
                <span className="quick-open-row-main">
                  <span className="quick-open-row-title">Blank</span>
                  <span className="quick-open-row-sub">
                    Starter palette you replace by hand
                  </span>
                </span>
              </button>
            </div>
            <p className="quick-open-group-label" style={{ margin: '.85rem 0 .35rem' }}>
              Or from a project
            </p>
            {busy ? (
              <p className="field-hint" style={{ margin: 0 }}>
                Scanning {sourcePath}…
              </p>
            ) : (
              <ProjectSourceList onPick={(path) => void extractFrom(path)} />
            )}
            {error ? (
              <div className="warning-card" role="alert" style={{ marginTop: '.5rem' }}>
                {error}
              </div>
            ) : null}
            <div className="name-prompt-actions">
              <button
                type="button"
                className="btn btn-quiet"
                disabled={busy}
                onClick={() => setStep('name')}
              >
                Back
              </button>
              <button type="button" className="btn btn-quiet" disabled={busy} onClick={onCancel}>
                Cancel
              </button>
            </div>
          </>
        ) : null}

        {step === 'preview' && result ? (
          <>
            <p className="field-hint" style={{ margin: '0 0 .85rem' }}>
              {sourcePath}
            </p>
            <ExtractionSummary result={result} />
            {total === 0 ? (
              <p className="field-hint" style={{ marginTop: '.6rem' }}>
                Nothing to seed from here — go back and pick another project, or
                start Blank instead.
              </p>
            ) : null}
            {error ? (
              <div className="warning-card" role="alert" style={{ marginTop: '.5rem' }}>
                {error}
              </div>
            ) : null}
            <div className="name-prompt-actions">
              <button
                type="button"
                className="btn btn-quiet"
                disabled={busy}
                onClick={() => {
                  setResult(null)
                  setSourcePath(null)
                  setError(null)
                  setStep('source')
                }}
              >
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || total === 0}
                onClick={() =>
                  void createWith({
                    name: name.trim(),
                    tokens: result.tokens,
                    modes: result.modes,
                    sourceNote: `Extracted from ${sourcePath}`,
                  })
                }
              >
                Create profile
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
