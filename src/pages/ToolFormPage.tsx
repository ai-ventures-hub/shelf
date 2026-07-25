import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ToolFormAdvanced } from '../components/ToolFormAdvanced'
import { useLibrary } from '../hooks/useLibrary'
import { usePrefs } from '../hooks/usePrefs'
import {
  TOOL_FORM_ADVANCED_KEY,
  emptyTool,
  envToText,
  textToEnv,
  toolHasAdvancedContent,
} from '../lib/toolForm'
import type { ProjectImportSuggestion, Tool } from '../types'

export function ToolFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { tools, saveTool } = useLibrary()
  const { prefs } = usePrefs()
  const existing = tools.find((t) => t.id === id)

  const [form, setForm] = useState<Tool>(() =>
    existing ||
    emptyTool({
      iconLucide: prefs.defaultIconLucide,
      iconColor: prefs.defaultIconColor,
      iconBackground: prefs.defaultIconBackground,
    }),
  )
  const [tagsText, setTagsText] = useState(() => (existing?.tags || []).join(', '))
  const [envText, setEnvText] = useState(() => envToText(existing?.env))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<ProjectImportSuggestion | null>(null)
  const [inspecting, setInspecting] = useState(false)
  // Create starts collapsed; edit may auto-open when advanced fields have content.
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const isEdit = Boolean(id)

  // Sync when library loads an existing tool after mount (Electron IPC is async).
  useEffect(() => {
    if (!existing) return
    setForm(existing)
    setTagsText(existing.tags.join(', '))
    setEnvText(envToText(existing.env))
  }, [existing?.id, existing?.updatedAt])

  // Edit: open Advanced when power-user fields exist, but honor an explicit collapse ('0').
  useEffect(() => {
    if (!existing) return
    try {
      const stored = localStorage.getItem(TOOL_FORM_ADVANCED_KEY)
      if (stored === '0') {
        setAdvancedOpen(false)
        return
      }
      if (stored === '1' || toolHasAdvancedContent(existing, prefs)) {
        setAdvancedOpen(true)
        return
      }
      setAdvancedOpen(false)
    } catch {
      setAdvancedOpen(toolHasAdvancedContent(existing, prefs))
    }
  }, [existing?.id, existing?.updatedAt, prefs])

  function update<K extends keyof Tool>(key: K, value: Tool[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function toggleAdvanced() {
    setAdvancedOpen((prev) => {
      const next = !prev
      try {
        localStorage.setItem(TOOL_FORM_ADVANCED_KEY, next ? '1' : '0')
      } catch {
        // ignore quota / private mode
      }
      return next
    })
  }

  /**
   * Inspect a folder and surface suggestions.
   * On create, empty fields are filled immediately; a review card stays visible.
   */
  async function runSmartImport(projectPath: string, opts: { fillEmpty: boolean }) {
    if (!window.shelf?.inspectProject) return
    setInspecting(true)
    setError(null)
    try {
      const next = await window.shelf.inspectProject(projectPath)
      setSuggestion(next)
      if (opts.fillEmpty) applySuggestion(next, { onlyEmpty: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setInspecting(false)
    }
  }

  function applySuggestion(
    next: ProjectImportSuggestion,
    opts: { onlyEmpty: boolean },
  ) {
    setForm((prev) => {
      const fill = (current: string | undefined, value?: string) => {
        if (!value) return current
        if (!opts.onlyEmpty) return value
        return current?.trim() ? current : value
      }
      return {
        ...prev,
        projectPath: next.projectPath || prev.projectPath,
        name: fill(prev.name, next.name) || prev.name,
        description: fill(prev.description, next.description),
        launchCommand: fill(prev.launchCommand, next.launchCommand) || prev.launchCommand,
        url: fill(prev.url, next.url),
        port:
          opts.onlyEmpty && prev.port
            ? prev.port
            : next.port !== undefined
              ? next.port
              : prev.port,
        notes: fill(prev.notes, next.notesHint),
      }
    })

    setTagsText((prev) => {
      if (opts.onlyEmpty && prev.trim()) return prev
      if (!next.tags.length) return prev
      if (!opts.onlyEmpty) return next.tags.join(', ')
      // Merge suggested tags into any existing ones.
      const merged = new Set([
        ...prev.split(',').map((t) => t.trim()).filter(Boolean),
        ...next.tags,
      ])
      return Array.from(merged).join(', ')
    })
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (!form.name.trim()) {
      setError('Name is required.')
      return
    }
    if (!form.launchCommand.trim()) {
      setError('Launch command is required.')
      return
    }

    setSaving(true)
    try {
      const saved = await saveTool({
        ...form,
        name: form.name.trim(),
        launchCommand: form.launchCommand.trim(),
        tags: tagsText
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        env: textToEnv(envText),
        port: form.port && Number.isFinite(form.port) ? Number(form.port) : undefined,
      })
      navigate(`/tools/${saved.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <header className="page-header">
        <div className="page-header-copy">
          <p className="eyebrow">{isEdit ? 'Edit tool' : 'Add tool'}</p>
          <h1 className="page-title">{isEdit ? 'Update configuration' : 'Register a tool'}</h1>
          <p className="page-lede">
            {isEdit
              ? 'Adjust launch settings, then save.'
              : 'Choose a project folder, confirm the essentials, and save.'}
          </p>
        </div>
        <Link className="btn btn-quiet" to={isEdit ? `/tools/${form.id}` : '/'}>
          Cancel
        </Link>
      </header>

      {error ? (
        <div className="warning-card" role="alert" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      ) : null}

      {suggestion ? (
        <section className="suggest-card" aria-label="Smart import suggestions">
          <div className="suggest-card-head">
            <div>
              <strong>Smart import</strong>
              <span className={`suggest-confidence is-${suggestion.confidence}`}>
                {suggestion.confidence} confidence
              </span>
            </div>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => setSuggestion(null)}
            >
              Dismiss
            </button>
          </div>
          <ul className="suggest-signals">
            {suggestion.signals.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          {suggestion.designMd.found ? (
            <p className="suggest-note">DESIGN.md detected for agent/UI bridge.</p>
          ) : null}
          {suggestion.launchAlternatives.length > 0 ? (
            <div className="suggest-alts">
              <span className="field-label">Other scripts</span>
              <div className="suggest-alt-row">
                {suggestion.launchAlternatives.map((alt) => (
                  <button
                    key={alt.command}
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={() => update('launchCommand', alt.command)}
                  >
                    {alt.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="action-row" style={{ marginBottom: 0 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => applySuggestion(suggestion, { onlyEmpty: false })}
            >
              Apply all suggestions
            </button>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => applySuggestion(suggestion, { onlyEmpty: true })}
            >
              Fill empty fields only
            </button>
          </div>
        </section>
      ) : null}

      <form className="panel" onSubmit={onSubmit}>
        <div className="panel-header">
          <h2 className="panel-title">Essentials</h2>
        </div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="field span-2">
              <label className="field-label" htmlFor="projectPath">
                Project folder
              </label>
              <div className="path-row">
                <input
                  id="projectPath"
                  className="field-input"
                  value={form.projectPath || ''}
                  onChange={(e) => update('projectPath', e.target.value)}
                  placeholder="/Users/you/Projects/image-prepper"
                />
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={inspecting}
                  onClick={() => {
                    void window.shelf.pickFolder().then((picked) => {
                      if (!picked) return
                      update('projectPath', picked)
                      // New tools auto-fill; edits show the card without clobbering.
                      void runSmartImport(picked, { fillEmpty: !isEdit })
                    })
                  }}
                >
                  {inspecting ? 'Scanning…' : 'Choose…'}
                </button>
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={inspecting || !form.projectPath?.trim()}
                  onClick={() =>
                    void runSmartImport(form.projectPath!.trim(), {
                      fillEmpty: !isEdit,
                    })
                  }
                >
                  Suggest
                </button>
              </div>
              <p className="field-hint">
                Scans for scripts, ports, package manager, and DESIGN.md.
              </p>
            </div>

            <div className="field span-2">
              <label className="field-label" htmlFor="name">
                Name
              </label>
              <input
                id="name"
                className="field-input"
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="Image Prepper"
                required
              />
            </div>

            <div className="field span-2">
              <label className="field-label" htmlFor="description">
                Description
              </label>
              <textarea
                id="description"
                className="field-textarea"
                value={form.description || ''}
                onChange={(e) => update('description', e.target.value)}
                placeholder="What this tool does in one or two sentences."
              />
            </div>

            <div className="field span-2">
              <label className="field-label" htmlFor="launchCommand">
                Launch command
              </label>
              <input
                id="launchCommand"
                className="field-input"
                value={form.launchCommand}
                onChange={(e) => update('launchCommand', e.target.value)}
                placeholder="npm run dev"
                required
              />
              <p className="field-hint">
                Runs from the project folder in a login zsh shell. No interactive prompts or sudo.
              </p>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="url">
                Local URL
              </label>
              <input
                id="url"
                className="field-input"
                value={form.url || ''}
                onChange={(e) => update('url', e.target.value)}
                placeholder="http://localhost:5173"
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="port">
                Port
              </label>
              <input
                id="port"
                className="field-input"
                type="number"
                min={1}
                max={65535}
                value={form.port ?? ''}
                onChange={(e) =>
                  update('port', e.target.value ? Number(e.target.value) : undefined)
                }
                placeholder="5173"
              />
              <p className="field-hint">
                When set, status stays Starting until the port accepts connections.
              </p>
            </div>

            <label className="checkbox-row span-2">
              <input
                type="checkbox"
                checked={form.favorite}
                onChange={(e) => update('favorite', e.target.checked)}
              />
              Mark as favorite
            </label>
          </div>

          <ToolFormAdvanced
            open={advancedOpen}
            onToggle={toggleAdvanced}
            form={form}
            prefs={prefs}
            tagsText={tagsText}
            envText={envText}
            setTagsText={setTagsText}
            setEnvText={setEnvText}
            update={update}
            setForm={setForm}
          />

          <div className="action-row" style={{ marginTop: '1.25rem', marginBottom: 0 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add to library'}
            </button>
          </div>
        </div>
      </form>
    </>
  )
}
