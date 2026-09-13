import { useState } from 'react'
import { Modal } from '../Modal'
import type { Tool } from '../../types'

export function CatalogStarterDialog({ tools, onClose }: { tools: Tool[]; onClose: () => void }) {
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [draft, setDraft] = useState<{ content: string; warnings: string[] } | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open busy={busy} onDismiss={onClose} aria-labelledby="catalog-starter-title">
      <div className="name-prompt catalog-starter">
        <h2 id="catalog-starter-title">Create a team catalog</h2>
        {!draft ? (
          <>
            <p>
              Choose tools to share. Shelf generates the catalog file; you control the Git
              repository and who can read it.
            </p>
            <label className="field">
              <span className="field-label">Team name</span>
              <input
                autoFocus
                className="field-input"
                maxLength={80}
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <fieldset disabled={busy}>
              <legend>Include tools (optional)</legend>
              <div className="catalog-tool-options">
                {tools.map((tool) => (
                  <label key={tool.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(tool.id)}
                      onChange={(event) =>
                        setSelected((prev) =>
                          event.target.checked
                            ? [...prev, tool.id]
                            : prev.filter((id) => id !== tool.id),
                        )
                      }
                    />{' '}
                    {tool.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="muted">
              Only tools with a Git remote can be included. No source code, commands, or environment
              values go into this file.
            </p>
            <button
              className="btn btn-primary"
              disabled={busy || !name.trim()}
              onClick={() =>
                void run(async () =>
                  setDraft(await window.shelf.prepareCatalogStarter(name, selected)),
                )
              }
            >
              {busy ? 'Preparing…' : 'Preview catalog'}
            </button>
          </>
        ) : (
          <>
            <p>
              Validated catalog · {JSON.parse(draft.content).tools.length} tools. Review the exact
              file below.
            </p>
            {draft.warnings.map((warning) => (
              <p className="warning-card" key={warning}>
                {warning}
              </p>
            ))}
            <pre className="catalog-preview" tabIndex={0}>
              {draft.content}
            </pre>
            {savedPath ? (
              <>
                <p role="status">Saved to {savedPath}</p>
                <ol>
                  <li>Put this file at the root of a Git repository your team can read.</li>
                  <li>Commit and push it with your Git client or coding agent.</li>
                  <li>Paste the repository URL into “Open an existing team catalog.”</li>
                </ol>
                <button
                  className="btn"
                  onClick={() =>
                    void run(async () => {
                      await navigator.clipboard.writeText(
                        `Help me publish my Shelf team catalog from ${savedPath}. Review the file with me, put catalog.json at the root of a Git repository accessible to my team, then commit and push after I approve the destination. Return its clone URL so I can add it to Shelf. Do not include secrets or project source code.`,
                      )
                      setCopied(true)
                    })
                  }
                >
                  {copied ? 'Copied' : 'Copy agent instructions'}
                </button>
              </>
            ) : (
              <button
                autoFocus
                className="btn btn-primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await window.shelf.exportCatalogStarter(draft.content)
                    if (result.path) setSavedPath(result.path)
                  })
                }
              >
                Save catalog.json…
              </button>
            )}
            {!savedPath && (
              <button className="btn btn-quiet" disabled={busy} onClick={() => setDraft(null)}>
                Back to selection
              </button>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="name-prompt-actions">
          <button className="btn" disabled={busy} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}
