import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Copy, ExternalLink, FolderOpen, Play, SquareTerminal } from 'lucide-react'
import { useDesignProfiles } from '../hooks/useDesignProfiles'
import { useLibrary } from '../hooks/useLibrary'
import { useUnsavedChanges } from '../hooks/useUnsavedChanges'
import type { ToolStarterAgent, ToolStarterCreated, ToolStarterPrepared } from '../types'

const AGENT_LABELS: Record<Exclude<ToolStarterAgent, 'terminal'>, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
}

/**
 * Start a new tool from an idea. Shelf writes a small project that already
 * runs (with the design profile and a build brief), registers it, and hands
 * the folder to a coding agent. Nothing is installed or started here.
 */
export function StartToolPage() {
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const { refresh } = useLibrary()
  const { profiles } = useDesignProfiles()
  const [prepared, setPrepared] = useState<ToolStarterPrepared | null>(null)
  const [idea, setIdea] = useState(() => search.get('idea') || '')
  const [name, setName] = useState(() => search.get('name') || '')
  const [profileChoice, setProfileChoice] = useState('default')
  const [parentDir, setParentDir] = useState<string | null>(null)
  const [port, setPort] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<ToolStarterCreated | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const guard = useUnsavedChanges(!created && Boolean(idea.trim() || name.trim()), busy)
  const defaultProfile = profiles.find((profile) => profile.isDefault)

  useEffect(() => {
    let live = true
    window.shelf
      .prepareToolStarter()
      .then((next) => {
        if (!live) return
        setPrepared(next)
        if (next.port) setPort(String(next.port))
      })
      .catch((err) => live && setError(err instanceof Error ? err.message : String(err)))
    return () => {
      live = false
    }
  }, [])

  async function chooseFolder() {
    try {
      const folder = await window.shelf.chooseToolsFolder()
      if (folder) setParentDir(folder)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const portNumber = port.trim() ? Number(port) : undefined
      const result = await window.shelf.createToolFromIdea({
        name,
        idea,
        parentDir: parentDir || undefined,
        port: portNumber !== undefined && Number.isFinite(portNumber) ? portNumber : undefined,
        designProfileId: profileChoice === 'default' ? undefined : profileChoice === 'none' ? null : profileChoice,
      })
      setCreated(result)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function openAgent(agent: ToolStarterAgent) {
    if (!created) return
    setNotice(null)
    setError(null)
    try {
      const { prompt } = await window.shelf.openToolInAgent(created.tool.id, agent)
      if (agent === 'cursor') {
        await navigator.clipboard.writeText(prompt).catch(() => undefined)
        setNotice('Cursor is opening the project. The prompt is copied; paste it into Cursor’s agent.')
      } else if (agent === 'terminal') {
        setNotice('Terminal is opening in the project folder.')
      } else {
        setNotice(`${AGENT_LABELS[agent]} is starting in Terminal with the build brief.`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function copyPrompt() {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.prompt)
      setNotice('Prompt copied. Run your agent in the project folder and paste it.')
    } catch {
      setNotice(`Copy this prompt: ${created.prompt}`)
    }
  }

  async function launch() {
    if (!created) return
    setError(null)
    try {
      const state = await window.shelf.startTool(created.tool.id)
      if (state.status === 'error') throw new Error(state.message || 'The starter did not start.')
      setRunning(true)
      setNotice(`${created.tool.name} is running. Reload the page as your agent works to see changes.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (created) {
    const agents = prepared?.agents.filter((agent) => agent.installed) || []
    return (
      <>
        <header className="page-header page-header-compact">
          <div className="page-header-copy">
            <p className="eyebrow">New tool</p>
            <h1 className="page-title">{created.tool.name} is ready for your agent</h1>
            <p className="page-lede">
              The project runs already. Your agent reads AGENTS.md and builds the rest
              {created.profileName ? ` in your ${created.profileName} style` : ''}.
            </p>
          </div>
        </header>
        <section className="panel project-review starter-result" aria-labelledby="starter-next">
          <p className="starter-done">
            <CheckCircle2 size={18} aria-hidden />
            <span>Added to your library. The project is in <code>{created.folder}</code></span>
          </p>
          <h2 id="starter-next">Build it</h2>
          <div className="form-actions">
            {agents.map((agent, index) => (
              <button
                key={agent.id}
                className={index === 0 ? 'btn btn-primary' : 'btn'}
                onClick={() => void openAgent(agent.id)}
              >
                <SquareTerminal size={16} aria-hidden />
                {agent.id === 'cursor' ? 'Open in Cursor' : `Build with ${AGENT_LABELS[agent.id]}`}
              </button>
            ))}
            <button className={agents.length ? 'btn btn-quiet' : 'btn btn-primary'} onClick={() => void copyPrompt()}>
              <Copy size={16} aria-hidden /> Copy prompt
            </button>
          </div>
          <p className="field-hint">
            {agents.some((agent) => agent.id !== 'cursor')
              ? 'The agent opens in Terminal, inside the project, with this prompt: '
              : 'Give your agent this prompt from inside the project folder: '}
            <q>{created.prompt}</q>
          </p>
          <h2>Meanwhile</h2>
          <div className="form-actions">
            {running && created.tool.url ? (
              <button className="btn" onClick={() => void window.shelf.openUrl(created.tool.url!)}>
                <ExternalLink size={16} aria-hidden /> Open in browser
              </button>
            ) : (
              <button className="btn" onClick={() => void launch()}>
                <Play size={16} aria-hidden /> Launch the starter
              </button>
            )}
            {!agents.some((agent) => agent.id !== 'cursor') && (
              <button className="btn btn-quiet" onClick={() => void openAgent('terminal')}>
                <FolderOpen size={16} aria-hidden /> Open folder in Terminal
              </button>
            )}
            <button className="btn btn-quiet" onClick={() => navigate(`/tools/${created.tool.id}`)}>
              Go to the tool
            </button>
          </div>
          {notice && <p className="starter-notice" role="status">{notice}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <details className="starter-files">
            <summary>{created.files.length} files created</summary>
            <ul>
              {created.files.map((file) => (
                <li key={file}><code>{file}</code></li>
              ))}
            </ul>
          </details>
        </section>
      </>
    )
  }

  const root = parentDir || prepared?.toolsRoot || '~/Shelf Tools'
  return (
    <>
      {guard.prompt}
      <header className="page-header page-header-compact">
        <div className="page-header-copy">
          <p className="eyebrow">New tool</p>
          <h1 className="page-title">Start a new tool</h1>
          <p className="page-lede">
            Describe what you need. Shelf sets up a project that already runs, with your design
            profile and a build brief, and hands it to your coding agent.
          </p>
        </div>
      </header>
      <form className="panel project-review" onSubmit={(event) => void create(event)}>
        <label className="field">
          <span className="field-label">What should it do?</span>
          <textarea
            className="field-textarea"
            value={idea}
            disabled={busy}
            required
            maxLength={4000}
            rows={5}
            onChange={(event) => setIdea(event.target.value)}
            placeholder="Resize and compress client photos for websites, then export a zip for each client."
          />
          <span className="field-hint">Plain words are fine. This becomes the brief your agent builds from.</span>
        </label>
        <label className="field">
          <span className="field-label">Name</span>
          <input
            className="field-input"
            value={name}
            disabled={busy}
            required
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder="Photo Prepper"
          />
        </label>
        <label className="field">
          <span className="field-label">Design profile</span>
          <select
            className="field-input"
            value={profileChoice}
            disabled={busy}
            onChange={(event) => setProfileChoice(event.target.value)}
          >
            <option value="default">{defaultProfile ? `Default (${defaultProfile.name})` : 'Default profile'}</option>
            {profiles
              .filter((profile) => !profile.isDefault)
              .map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            <option value="none">None</option>
          </select>
          <span className="field-hint">Its colors and fonts go into the starter, and DESIGN.md carries the rest.</span>
        </label>
        <div className="field">
          <span className="field-label">Folder</span>
          <p className="project-path">
            <code>{`${root}/${name.trim() || 'Name'}`}</code>
          </p>
          <div className="form-actions">
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void chooseFolder()}>
              <FolderOpen size={16} aria-hidden /> Change folder
            </button>
          </div>
        </div>
        <label className="field starter-port">
          <span className="field-label">Port</span>
          <input
            className="field-input"
            value={port}
            disabled={busy}
            inputMode="numeric"
            pattern="[0-9]*"
            onChange={(event) => setPort(event.target.value.replace(/[^0-9]/g, ''))}
            placeholder="4400"
          />
          <span className="field-hint">Free now, and no other tool in your library uses it.</span>
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy || !idea.trim() || !name.trim()}>
            {busy ? 'Creating…' : 'Create tool'}
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            disabled={busy}
            onClick={() => {
              guard.allowNavigation()
              navigate('/tools/new')
            }}
          >
            Add an existing project instead
          </button>
        </div>
        <p className="field-hint">Shelf writes the files and adds the tool to your library. Nothing is installed or started.</p>
      </form>
    </>
  )
}
