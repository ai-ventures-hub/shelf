import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useLibrary } from '../hooks/useLibrary'
import { usePrefs } from '../hooks/usePrefs'
import { useUnsavedChanges } from '../hooks/useUnsavedChanges'
import type { RegisterProjectResult } from '../types'

export function AddProjectPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const { tools, refresh } = useLibrary()
  const { prefs } = usePrefs()
  const [projectPath, setProjectPath] = useState('')
  const [review, setReview] = useState<RegisterProjectResult | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [command, setCommand] = useState('')
  const [runSetup, setRunSetup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [inspecting, setInspecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const guard = useUnsavedChanges(Boolean(review), busy)
  const existing = review?.tool || tools.find((tool) => tool.projectPath === review?.suggestion?.projectPath)

  async function inspect(folder: string) {
    const ticket = ++generation.current
    setProjectPath(folder)
    setReview(null)
    setRunSetup(false)
    setError(null)
    setInspecting(true)
    try {
      const result = await window.shelf.registerProject(folder, { dryRun: true, autoLaunch: false })
      if (ticket !== generation.current) return
      if (!result.suggestion)
        throw new Error(result.issues[0]?.message || 'Could not inspect this folder.')
      setReview(result)
      setName(result.suggestion.name || '')
      setDescription(result.suggestion.description || '')
      setCommand(result.suggestion.launchCommand || '')
    } catch (err) {
      if (ticket === generation.current) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (ticket === generation.current) setInspecting(false)
    }
  }

  useEffect(() => {
    const folder = (location.state as { projectPath?: string } | null)?.projectPath
    if (folder) void inspect(folder)
    return () => {
      generation.current++
    }
  }, [location.key])

  async function chooseFolder() {
    try {
      const folder = await window.shelf.pickFolder()
      if (folder) await inspect(folder)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function save(autoLaunch: boolean) {
    if (!review || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.shelf.registerProject(projectPath, {
        autoLaunch,
        runSetup: autoLaunch && runSetup,
        setupSteps: review.setupNeeds,
        overrides: {
          name,
          description,
          launchCommand: command,
          capabilities: (search.get('capabilities') || '').split('\n').filter(Boolean),
        },
        toolDefaults: {
          iconLucide: prefs.defaultIconLucide,
          iconColor: prefs.defaultIconColor,
          iconBackground: prefs.defaultIconBackground,
        },
      })
      if (!result.tool)
        throw new Error(result.issues[0]?.message || 'The project could not be saved.')
      await refresh()
      guard.allowNavigation()
      navigate(`/tools/${result.tool.id}`, { state: { registration: result } })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {guard.prompt}
      <header className="page-header page-header-compact">
        <div className="page-header-copy">
          <p className="eyebrow">Add tool</p>
          <h1 className="page-title">Add a project</h1>
          <p>
            Start with a folder. Shelf detects how to run it. Review the command before anything is
            installed or started.
          </p>
        </div>
      </header>
      <section className="panel project-review">
        <button
          className="btn btn-primary"
          disabled={busy || inspecting}
          onClick={() => void chooseFolder()}
        >
          {inspecting
            ? 'Inspecting folder…'
            : projectPath
              ? 'Choose another folder'
              : 'Choose project folder'}
        </button>
        <p className="muted">You can also drop a project folder into Shelf.</p>
        {projectPath && (
          <p className="project-path">
            <code>{projectPath}</code>
          </p>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
            {projectPath && (
              <button
                className="btn"
                onClick={() => void inspect(projectPath)}
                disabled={busy || inspecting}
              >
                Retry inspection
              </button>
            )}
          </div>
        )}
        {review &&
          (existing ? (
            <div className="warning-card">
              <p>This folder is already registered as {existing.name}.</p>
              <button
                className="btn btn-primary"
                onClick={() => {
                  guard.allowNavigation()
                  navigate(`/tools/${existing.id}`)
                }}
              >
                Open existing tool
              </button>
            </div>
          ) : (
            <>
              <h2>How Shelf will run this project</h2>
              <label className="field">
                <span className="field-label">Name</span>
                <input
                  className="field-input"
                  value={name}
                  disabled={busy}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">What does it do?</span>
                <input
                  className="field-input"
                  value={description}
                  disabled={busy}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="A short description for you and your agents"
                />
              </label>
              <label className="field">
                <span className="field-label">Launch command</span>
                <input
                  className="field-input mono"
                  value={command}
                  disabled={busy}
                  onChange={(event) => setCommand(event.target.value)}
                  placeholder="Enter the command used to start this project"
                />
              </label>
              {!review.autoRunnable && (
                <p className="warning-card">
                  {review.autoRunReason} Confirm or enter the command above.
                </p>
              )}
              {review.suggestion?.url && (
                <p>
                  Opens at <code>{review.suggestion.url}</code>. Shelf will select a free port if
                  this one is busy.
                </p>
              )}
              {review.issues.map((issue) => (
                <p className="warning-card" key={issue.code}>
                  {issue.message}
                </p>
              ))}
              {review.setupNeeds.length > 0 && (
                <div className="setup-review">
                  <h3>Setup required</h3>
                  <p>
                    These commands may download dependencies and execute package installation
                    scripts in this folder.
                  </p>
                  {review.setupNeeds.map((step, index) => (
                    <pre key={index}>
                      <code>{step.command}</code>
                    </pre>
                  ))}
                  <label>
                    <input
                      type="checkbox"
                      checked={runSetup}
                      disabled={busy}
                      onChange={(event) => setRunSetup(event.target.checked)}
                    />{' '}
                    Run these setup commands when I choose Add and run
                  </label>
                </div>
              )}
              <div className="form-actions">
                <button
                  className="btn"
                  disabled={busy || !name.trim() || !command.trim()}
                  onClick={() => void save(false)}
                >
                  Add without running
                </button>
                <button
                  className="btn btn-primary"
                  disabled={
                    busy ||
                    !name.trim() ||
                    !command.trim() ||
                    (review.setupNeeds.length > 0 && !runSetup)
                  }
                  onClick={() => void save(true)}
                >
                  {busy ? 'Saving and preparing project…' : 'Add and run'}
                </button>
              </div>
              {busy && (
                <p role="status">
                  Setup can take a few minutes. Keep Shelf open until it finishes.
                </p>
              )}
            </>
          ))}
      </section>
      <p>
        <Link to={`/tools/new/manual${location.search}`}>Configure a tool manually</Link> — for
        commands without a project folder or advanced configuration.
      </p>
    </>
  )
}
