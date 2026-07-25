import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ColorField } from '../components/ColorField'
import { LucideIconPicker } from '../components/LucideIconPicker'
import { useLibrary } from '../hooks/useLibrary'
import { usePrefs } from '../hooks/usePrefs'
import type { ProjectImportSuggestion, Tool } from '../types'

function emptyTool(defaults?: {
  iconLucide?: string
  iconColor?: string
  iconBackground?: string
}): Tool {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    name: '',
    description: '',
    tags: [],
    favorite: false,
    launchCommand: '',
    iconLucide: defaults?.iconLucide,
    iconColor: defaults?.iconColor,
    iconBackground: defaults?.iconBackground,
    createdAt: now,
    updatedAt: now,
  }
}

function envToText(env?: Record<string, string>): string {
  if (!env) return ''
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
}

function textToEnv(text: string): Record<string, string> | undefined {
  // Join wrapped continuation lines (no `=`) onto the previous KEY=value entry.
  const entries: Array<[string, string]> = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd()
    if (!line.trim()) continue
    const idx = line.indexOf('=')
    const looksLikeKey = idx > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(line.slice(0, idx).trim())
    if (looksLikeKey) {
      entries.push([line.slice(0, idx).trim(), line.slice(idx + 1)])
      continue
    }
    if (entries.length > 0) {
      entries[entries.length - 1][1] += line.trim()
    }
  }

  if (entries.length === 0) return undefined
  return Object.fromEntries(entries)
}

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
  const isEdit = Boolean(id)

  // Sync when library loads an existing tool after mount (Electron IPC is async).
  useEffect(() => {
    if (!existing) return
    setForm(existing)
    setTagsText(existing.tags.join(', '))
    setEnvText(envToText(existing.env))
  }, [existing?.id, existing?.updatedAt])

  function update<K extends keyof Tool>(key: K, value: Tool[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
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
            Choose a project folder to auto-suggest launch command, port, and tags — then
            adjust anything before saving.
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
          <h2 className="panel-title">Tool record</h2>
        </div>
        <div className="panel-body">
          <div className="form-grid">
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
                Choosing a folder (or Suggest) scans for scripts, ports, package manager, and
                DESIGN.md.
              </p>
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
                Runs in a login zsh shell from the project folder. For Python projects with a
                virtualenv, prefer <code>.venv/bin/python app.py</code>. Interactive prompts and
                sudo are not supported.
              </p>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="stopCommand">
                Stop command (optional)
              </label>
              <input
                id="stopCommand"
                className="field-input"
                value={form.stopCommand || ''}
                onChange={(e) => update('stopCommand', e.target.value)}
                placeholder="docker compose down"
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="tags">
                Tags
              </label>
              <input
                id="tags"
                className="field-input"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                placeholder="Image Tools, Client Projects"
              />
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

            <div className="field span-2">
              <span className="field-label" id="icon-lucide-label">
                Icon
              </span>
              <LucideIconPicker
                value={form.iconLucide}
                iconColor={form.iconColor || prefs.defaultIconColor}
                iconBackground={form.iconBackground || prefs.defaultIconBackground}
                onChange={(name) => {
                  // Lucide marks take precedence over a custom file path.
                  setForm((prev) => ({
                    ...prev,
                    iconLucide: name,
                    iconPath: name ? undefined : prev.iconPath,
                    iconColor: prev.iconColor || prefs.defaultIconColor,
                    iconBackground: prev.iconBackground || prefs.defaultIconBackground,
                  }))
                }}
              />
            </div>

            <ColorField
              id="iconBackground"
              label="Background Color"
              value={form.iconBackground || prefs.defaultIconBackground}
              onChange={(hex) => update('iconBackground', hex)}
            />
            <ColorField
              id="iconColor"
              label="Icon Color"
              value={form.iconColor || prefs.defaultIconColor}
              onChange={(hex) => update('iconColor', hex)}
            />

            <div className="field span-2">
              <label className="field-label" htmlFor="icon">
                Custom image (optional)
              </label>
              <div className="path-row">
                <input
                  id="icon"
                  className="field-input"
                  value={form.iconPath || ''}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      iconPath: e.target.value,
                      // File icons replace Lucide when a path is chosen.
                      iconLucide: e.target.value.trim() ? undefined : prev.iconLucide,
                    }))
                  }
                  placeholder="Optional local image path"
                />
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => {
                    void window.shelf.pickIcon().then((path) => {
                      if (!path) return
                      setForm((prev) => ({
                        ...prev,
                        iconPath: path,
                        iconLucide: undefined,
                      }))
                    })
                  }}
                >
                  Choose…
                </button>
              </div>
              <p className="field-hint">
                Lucide icons are preferred when set. A custom image clears the Lucide selection.
              </p>
            </div>

            <div className="field span-2">
              <label className="field-label" htmlFor="env">
                Environment variables
              </label>
              <textarea
                id="env"
                className="field-textarea"
                value={envText}
                onChange={(e) => setEnvText(e.target.value)}
                placeholder={'NODE_ENV=development\nAPI_URL=http://localhost:3000'}
              />
              <p className="field-hint">
                One KEY=value per line, keep each value on a single line. If the project already
                loads <code>.env.local</code>, you can leave this empty.
              </p>
            </div>
            <div className="field span-2">
              <label className="field-label" htmlFor="notes">
                Notes / operating manual
              </label>
              <textarea
                id="notes"
                className="field-textarea"
                value={form.notes || ''}
                onChange={(e) => update('notes', e.target.value)}
                placeholder="Required inputs, common errors, last known working setup…"
              />
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
