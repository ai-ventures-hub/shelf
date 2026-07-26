import type { Dispatch, SetStateAction } from 'react'
import { ColorField } from './ColorField'
import { LucideIconPicker } from './LucideIconPicker'
import type { AgentAccess, AgentAccessKind, Tool, UiPrefs } from '../types'

/** Stroke chevron matching MCP Advanced / sidebar weight. */
function DisclosureChevron({ open }: { open: boolean }) {
  return (
    <svg
      className="form-advanced-chevron"
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {open ? <path d="M6 9l6 6 6-6" /> : <path d="M9 6l6 6-6 6" />}
    </svg>
  )
}

export interface ToolFormAdvancedProps {
  open: boolean
  onToggle: () => void
  form: Tool
  prefs: UiPrefs
  tagsText: string
  capabilitiesText: string
  envText: string
  setTagsText: (value: string) => void
  setCapabilitiesText: (value: string) => void
  setEnvText: (value: string) => void
  update: <K extends keyof Tool>(key: K, value: Tool[K]) => void
  setForm: Dispatch<SetStateAction<Tool>>
}

/** Collapsed power-user fields for Add/Edit tool. */
export function ToolFormAdvanced({
  open,
  onToggle,
  form,
  prefs,
  tagsText,
  capabilitiesText,
  envText,
  setTagsText,
  setCapabilitiesText,
  setEnvText,
  update,
  setForm,
}: ToolFormAdvancedProps) {
  function addAccess(kind: AgentAccessKind) {
    const access: AgentAccess = {
      id: crypto.randomUUID(),
      kind,
      entrypoint: '',
      transport: kind === 'mcp' ? 'stdio' : undefined,
      setupRequired: true,
    }
    setForm((prev) => ({ ...prev, agentAccess: [...prev.agentAccess, access] }))
  }

  function updateAccess(id: string, patch: Partial<AgentAccess>) {
    setForm((prev) => ({
      ...prev,
      agentAccess: prev.agentAccess.map((access) =>
        access.id === id ? { ...access, ...patch } : access,
      ),
    }))
  }

  function removeAccess(id: string) {
    setForm((prev) => ({
      ...prev,
      agentAccess: prev.agentAccess.filter((access) => access.id !== id),
    }))
  }

  return (
    <section className="form-advanced">
      <button
        type="button"
        className="form-advanced-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span>Advanced</span>
        <DisclosureChevron open={open} />
      </button>
      {open ? (
        <div className="form-advanced-body form-grid">
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

          <div className="field span-2">
            <label className="field-label" htmlFor="capabilities">
              Capabilities
            </label>
            <textarea
              id="capabilities"
              className="field-textarea"
              value={capabilitiesText}
              onChange={(event) => setCapabilitiesText(event.target.value)}
              placeholder={'batch optimize images\nconvert images to WebP\nresize image collections'}
            />
            <p className="field-hint">
              One task-oriented phrase per line. Agents use these to find the right tool.
            </p>
          </div>

          <fieldset className="field span-2 access-fieldset">
            <legend className="field-label">Agent access</legend>
            <p className="field-hint">
              Describe existing interfaces only. Shelf does not connect to or invoke them.
            </p>
            <div className="access-list">
              {form.agentAccess.map((access) => (
                <div className="access-editor" key={access.id}>
                  <div className="access-editor-head">
                    <select
                      className="field-input"
                      aria-label="Access method"
                      value={access.kind}
                      onChange={(event) => {
                        const kind = event.target.value as AgentAccessKind
                        updateAccess(access.id, {
                          kind,
                          transport: kind === 'mcp' ? access.transport || 'stdio' : undefined,
                        })
                      }}
                    >
                      <option value="cli">CLI</option>
                      <option value="mcp">MCP</option>
                      <option value="http-api">HTTP API</option>
                    </select>
                    {access.kind === 'mcp' ? (
                      <select
                        className="field-input"
                        aria-label="MCP transport"
                        value={access.transport || 'stdio'}
                        onChange={(event) =>
                          updateAccess(access.id, {
                            transport: event.target.value as AgentAccess['transport'],
                          })
                        }
                      >
                        <option value="stdio">stdio</option>
                        <option value="streamable-http">Streamable HTTP</option>
                      </select>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-quiet btn-sm"
                      onClick={() => removeAccess(access.id)}
                    >
                      Remove
                    </button>
                  </div>
                  <label className="field-label" htmlFor={`access-entrypoint-${access.id}`}>
                    {access.kind === 'http-api' || access.transport === 'streamable-http'
                      ? 'Endpoint'
                      : 'Command'}
                  </label>
                  <input
                    id={`access-entrypoint-${access.id}`}
                    className="field-input"
                    value={access.entrypoint}
                    onChange={(event) =>
                      updateAccess(access.id, { entrypoint: event.target.value })
                    }
                    placeholder={
                      access.kind === 'http-api' || access.transport === 'streamable-http'
                        ? 'http://127.0.0.1:4100/mcp'
                        : 'node ./mcp/server.js'
                    }
                    required
                  />
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={access.setupRequired}
                      onChange={(event) =>
                        updateAccess(access.id, { setupRequired: event.target.checked })
                      }
                    />
                    Setup is still required
                  </label>
                  <label className="field-label" htmlFor={`access-notes-${access.id}`}>
                    Access notes
                  </label>
                  <input
                    id={`access-notes-${access.id}`}
                    className="field-input"
                    value={access.notes || ''}
                    onChange={(event) => updateAccess(access.id, { notes: event.target.value })}
                    placeholder="Requirements or activation guidance; never include credentials"
                  />
                </div>
              ))}
            </div>
            <div className="action-row access-add-row">
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => addAccess('cli')}>
                Add CLI
              </button>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => addAccess('mcp')}>
                Add MCP
              </button>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => addAccess('http-api')}>
                Add HTTP API
              </button>
            </div>
          </fieldset>

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
              One KEY=value per line. Prefer project <code>.env.local</code> when it already
              exists. For Python venvs, launch with <code>.venv/bin/python app.py</code>.
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
        </div>
      ) : null}
    </section>
  )
}
