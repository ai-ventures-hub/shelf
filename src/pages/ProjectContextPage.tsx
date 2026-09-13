import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Modal } from '../components/Modal'
import { useLibrary } from '../hooks/useLibrary'
import { useReceipts } from '../hooks/useReceipts'
import { useUnsavedChanges } from '../hooks/useUnsavedChanges'
import {
  PROJECT_MEMORY_FIELDS,
  PROJECT_MEMORY_FIELD_LIMIT,
  emptyProjectMemory,
} from '../../shared/project-context-contracts'
import type { ProjectMemory, ProjectMemoryFields } from '../types'

function contextError(error: unknown, fallback: string): string {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
    : fallback
}

export function ProjectContextPage() {
  const { id } = useParams()
  // Reset all drafts and async state when navigating between tools on this route.
  return <ProjectContextEditor key={id} id={id || ''} />
}

function ProjectContextEditor({ id }: { id: string }) {
  const { tools, loading: libraryLoading } = useLibrary()
  const tool = tools.find((item) => item.id === id)
  const [search] = useSearchParams()
  const [saved, setSaved] = useState<ProjectMemory | null>(null)
  const [fields, setFields] = useState<ProjectMemoryFields>(emptyProjectMemory)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [reloadOpen, setReloadOpen] = useState(false)
  const [task, setTask] = useState('')
  const [copiedTask, setCopiedTask] = useState('')
  const [includeEnvironment, setIncludeEnvironment] = useState(true)
  const [includeDesign, setIncludeDesign] = useState(true)
  const [runId, setRunId] = useState(search.get('run') || '')
  const [includeLogs, setIncludeLogs] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const previewField = useRef<HTMLTextAreaElement>(null)
  const prepareButton = useRef<HTMLButtonElement>(null)
  const previewOpen = preview !== null
  useEffect(() => {
    if (previewOpen && previewField.current) {
      previewField.current.setSelectionRange(0, 0)
      previewField.current.scrollTop = 0
    }
  }, [previewOpen])
  function closePreview() {
    setPreview(null)
    requestAnimationFrame(() => prepareButton.current?.focus())
  }
  const [copyError, setCopyError] = useState<string | null>(null)
  const {
    receipts,
    error: receiptError,
    refresh: refreshReceipts,
  } = useReceipts({ toolId: id, limit: 25 })
  const dirty = PROJECT_MEMORY_FIELDS.some(
    ({ key }) => fields[key] !== (saved?.[key] || ''),
  )
  const guard = useUnsavedChanges(dirty || task !== copiedTask, busy)
  const latest = useRef({ dirty, busy })
  latest.current = { dirty, busy }
  const generation = useRef(0)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      generation.current++
    }
  }, [])
  const load = useCallback(async () => {
    const ticket = ++generation.current
    setBusy(true)
    setError(null)
    try {
      const memory = await window.shelf.getProjectMemory(id)
      if (!alive.current || ticket !== generation.current) return
      setSaved(memory)
      setFields(
        memory
          ? (Object.fromEntries(
              PROJECT_MEMORY_FIELDS.map(({ key }) => [key, memory[key]]),
            ) as ProjectMemoryFields)
          : emptyProjectMemory(),
      )
      setLoaded(true)
      setNotice(null)
    } catch (err) {
      if (alive.current && ticket === generation.current)
        setError(contextError(err, 'Could not load project memory.'))
    } finally {
      if (alive.current && ticket === generation.current) setBusy(false)
    }
  }, [id])
  useEffect(() => {
    void load()
  }, [load])
  useEffect(
    () =>
      window.shelf.onExternalDataChange((filename) => {
        if (filename !== 'project-memory.json') return
        // Never silently replace an editor's draft, including while a save is in flight.
        if (latest.current.dirty || latest.current.busy)
          setNotice(
            'Saved memory may have changed. Your draft is preserved; load the saved version to compare.',
          )
        else void load()
      }),
    [load],
  )

  async function save() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const memory = await window.shelf.saveProjectMemory({
        toolId: id,
        expectedRevision: saved?.revision || null,
        fields,
      })
      if (alive.current) {
        setSaved(memory)
        setNotice('Project memory saved. Connected agents can read it through Shelf.')
      }
    } catch (err) {
      if (alive.current)
        setError(contextError(err, 'Could not save. Your draft is still here.'))
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  async function prepare() {
    setBusy(true)
    setError(null)
    setCopyError(null)
    setNotice(null)
    try {
      const result = await window.shelf.prepareProjectHandoff(id, {
        task,
        includeEnvironment,
        includeDesign,
        runId: runId || undefined,
        includeLogs: Boolean(runId) && includeLogs,
      })
      if (alive.current) setPreview(result.markdown)
    } catch (err) {
      if (alive.current)
        setError(contextError(err, 'Could not prepare handoff. Try again.'))
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  if (libraryLoading) return <p role="status">Loading project…</p>
  if (!tool)
    return (
      <section className="panel">
        <div className="panel-body">
          <h1>Tool not found</h1>
          <Link to="/">Return to library</Link>
        </div>
      </section>
    )
  return (
    <>
      <header className="page-header">
        <div className="page-header-copy">
          <p className="eyebrow">{tool.name}</p>
          <h1 className="page-title">Project memory &amp; handoff</h1>
          <p className="page-lede">
            Keep useful context between sessions, then prepare a brief for your next
            agent.
          </p>
        </div>
        <Link className="btn btn-quiet" to={`/tools/${id}`}>
          Back to tool
        </Link>
      </header>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <section className="panel" aria-labelledby="memory-title">
        <div className="panel-header">
          <h2 className="panel-title" id="memory-title">
            Project memory
          </h2>
          <button
            className="btn btn-quiet btn-sm"
            disabled={busy}
            onClick={() => {
              if (dirty) setReloadOpen(true)
              else void load()
            }}
          >
            Load saved version
          </button>
        </div>
        <div className="panel-body stack">
          <p className="muted">
            Notes are stored locally in Shelf for this tool and are readable by connected
            agents. Keep credentials out. These notes are separate from repository files
            and are not included in shared tool bundles.
          </p>
          <p className="muted">
            {loaded
              ? saved
                ? `Last saved ${new Date(saved.updatedAt).toLocaleString()}. Review these notes when the project changes.`
                : 'No memory saved yet. Start with the purpose and next steps; fill in the rest as needed.'
              : busy
                ? 'Loading memory…'
                : 'Memory is unavailable. Load the saved version to retry.'}
          </p>
          <fieldset disabled={!loaded || busy} className="context-fields">
            {PROJECT_MEMORY_FIELDS.map((field) => (
              <label className="field" key={field.key}>
                <span className="field-label">{field.label}</span>
                <textarea
                  className="field-input"
                  rows={field.key === 'purpose' ? 2 : 3}
                  value={fields[field.key]}
                  maxLength={PROJECT_MEMORY_FIELD_LIMIT}
                  placeholder={field.hint}
                  aria-describedby={`memory-${field.key}-limit`}
                  onChange={(event) => {
                    setFields((current) => ({
                      ...current,
                      [field.key]: event.target.value,
                    }))
                    setNotice(null)
                  }}
                />
                <span className="field-hint" id={`memory-${field.key}-limit`}>
                  {fields[field.key].length.toLocaleString()} /{' '}
                  {PROJECT_MEMORY_FIELD_LIMIT.toLocaleString()} characters
                </span>
              </label>
            ))}
          </fieldset>
          <div className="action-row">
            <button
              className="btn btn-primary"
              disabled={!loaded || !dirty || busy}
              onClick={() => void save()}
            >
              {busy ? 'Working…' : 'Save memory'}
            </button>
            <button
              className="btn btn-quiet"
              disabled={
                !loaded || busy || !PROJECT_MEMORY_FIELDS.some(({ key }) => fields[key])
              }
              onClick={() => {
                setFields(emptyProjectMemory())
                setNotice(
                  'Fields cleared in your draft. Save memory to remove the saved text, or load the saved version to undo.',
                )
              }}
            >
              Clear fields
            </button>
            {dirty && (
              <span role="status" className="muted">
                Unsaved changes
              </span>
            )}
          </div>
        </div>
      </section>
      <section className="panel" aria-labelledby="handoff-title">
        <div className="panel-header">
          <h2 className="panel-title" id="handoff-title">
            Prepare agent handoff
          </h2>
        </div>
        <div className="panel-body stack">
          <p className="muted">
            Includes saved memory and current launch configuration. Choose additional
            context, review the text, then copy it into your agent. Nothing is sent
            automatically.
          </p>
          <label className="field">
            <span className="field-label">What should the agent work on?</span>
            <textarea
              className="field-input"
              rows={3}
              maxLength={4000}
              value={task}
              disabled={busy}
              onChange={(event) => setTask(event.target.value)}
              placeholder="For example: investigate the failed import and propose a fix."
            />
          </label>
          <label className="context-check">
            <input
              type="checkbox"
              checked={includeEnvironment}
              disabled={busy}
              onChange={(event) => setIncludeEnvironment(event.target.checked)}
            />{' '}
            Include fresh environment checks
          </label>
          <label className="context-check">
            <input
              type="checkbox"
              checked={includeDesign}
              disabled={busy}
              onChange={(event) => setIncludeDesign(event.target.checked)}
            />{' '}
            Include effective design direction
          </label>
          <label className="field">
            <span className="field-label">Run evidence</span>
            <select
              className="field-input"
              value={runId}
              disabled={busy}
              onChange={(event) => {
                setRunId(event.target.value)
                setIncludeLogs(false)
              }}
            >
              <option value="">Do not include a run</option>
              {runId && !receipts.some((receipt) => receipt.id === runId) && (
                <option value={runId}>Selected run unavailable; choose another</option>
              )}
              {receipts.map((receipt) => (
                <option key={receipt.id} value={receipt.id}>
                  {new Date(receipt.startedAt).toLocaleString()} · {receipt.outcome}
                </option>
              ))}
            </select>
          </label>
          {receiptError && (
            <p role="alert">
              {receiptError}{' '}
              <button className="btn btn-quiet" onClick={() => void refreshReceipts()}>
                Retry history
              </button>
            </p>
          )}
          <label className="context-check">
            <input
              type="checkbox"
              checked={includeLogs && Boolean(runId)}
              disabled={busy || !runId}
              onChange={(event) => setIncludeLogs(event.target.checked)}
            />{' '}
            Include the selected run's latest output, up to 100 lines
          </label>
          <p className="muted">
            Available to agents through <code>shelf_get_project_memory</code> and{' '}
            <code>shelf_prepare_handoff</code>. Agents can read memory; editing stays in
            Shelf.
          </p>
          {dirty && (
            <p className="muted">Save your memory changes before preparing a handoff.</p>
          )}
          <div>
            <button
              ref={prepareButton}
              className="btn btn-primary"
              disabled={
                !loaded ||
                dirty ||
                busy ||
                Boolean(runId && !receipts.some((receipt) => receipt.id === runId))
              }
              onClick={() => void prepare()}
            >
              {busy ? 'Working…' : 'Prepare handoff'}
            </button>
          </div>
        </div>
      </section>
      <Modal
        open={previewOpen}
        onDismiss={closePreview}
        className="name-prompt-backdrop consent-backdrop"
        aria-labelledby="handoff-preview-title"
      >
        <div className="consent-sheet context-handoff">
          <h2 id="handoff-preview-title" className="consent-title">
            Review your agent handoff
          </h2>
          <p className="consent-lede">
            Shelf masks known credentials. Review paths, notes, and output before sharing.
            You can edit this copy without changing saved memory.
          </p>
          <textarea
            ref={previewField}
            className="field-input"
            aria-label="Agent handoff"
            rows={18}
            value={preview || ''}
            onChange={(event) => setPreview(event.target.value)}
          />
          {copyError && (
            <p className="form-error" role="alert">
              {copyError}
            </p>
          )}
          <div className="consent-actions">
            <button className="btn btn-quiet" onClick={closePreview}>
              Close
            </button>
            <button
              className="btn btn-primary"
              disabled={!preview?.trim()}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(preview || '')
                  setCopiedTask(task)
                  closePreview()
                  setNotice(
                    'Handoff copied. Paste it into your agent to begin the next session.',
                  )
                } catch {
                  setCopyError(
                    'Could not copy. Select and copy the text above, or try again.',
                  )
                }
              }}
            >
              Copy handoff
            </button>
          </div>
        </div>
      </Modal>
      <Modal
        open={reloadOpen}
        onDismiss={() => setReloadOpen(false)}
        aria-labelledby="memory-reload-title"
      >
        <div className="name-prompt">
          <h2 id="memory-reload-title">Replace your draft?</h2>
          <p>
            Loading the saved version will discard the changes in these fields. Copy
            anything you want to keep first.
          </p>
          <div className="name-prompt-actions">
            <button className="btn" onClick={() => setReloadOpen(false)}>
              Keep editing
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                setReloadOpen(false)
                void load()
              }}
            >
              Load saved version
            </button>
          </div>
        </div>
      </Modal>
      {guard.prompt}
    </>
  )
}
