/**
 * Collection detail reuses LibraryPage filtering, plus membership management
 * and stack actions (start/stop every member).
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Play, Square } from 'lucide-react'
import { LibraryPage } from './LibraryPage'
import { useLibrary } from '../hooks/useLibrary'
import { usePrefs } from '../hooks/usePrefs'
import type { CollectionActionResult, DesignProfile } from '../types'

function summarizeStackResult(
  result: CollectionActionResult,
  action: 'start' | 'stop',
): string {
  const counts = new Map<string, number>()
  for (const r of result.results) {
    counts.set(r.outcome, (counts.get(r.outcome) || 0) + 1)
  }
  const parts: string[] = []
  const add = (outcome: string, label: string) => {
    const n = counts.get(outcome)
    if (n) parts.push(`${n} ${label}`)
  }
  if (action === 'start') {
    add('started', 'started')
    add('already_running', 'already running')
    add('failed', 'failed')
  } else {
    add('stopped', 'stopped')
    add('skipped_external', 'left running (not started by Shelf)')
    add('not_running', 'not running')
    add('failed', 'failed to stop')
  }
  return parts.length ? parts.join(' · ') : 'Nothing to do.'
}

export function CollectionPage() {
  const { collectionId } = useParams()
  const navigate = useNavigate()
  const { tools, collections, states, refresh, saveCollection, deleteCollection } =
    useLibrary()
  const { prefs } = usePrefs()
  const collection = collections.find((c) => c.id === collectionId)
  const [editing, setEditing] = useState(false)
  const [stackBusy, setStackBusy] = useState<'start' | 'stop' | null>(null)
  const [stackSummary, setStackSummary] = useState<string | null>(null)
  const [designProfiles, setDesignProfiles] = useState<DesignProfile[]>([])

  useEffect(() => {
    // Optional context: absence of profiles (or the bridge) just hides the picker.
    const load = () => {
      window.shelf?.listDesignProfiles?.()
        .then(setDesignProfiles)
        .catch(() => setDesignProfiles([]))
    }
    load()
    // External writes (seed script, agents) should surface without a remount.
    const unsubscribe = window.shelf?.onExternalDataChange?.((filename) => {
      if (filename === 'design-profiles.json') load()
    })
    return () => unsubscribe?.()
  }, [])

  const members = useMemo(() => {
    if (!collection) return []
    return tools.filter((t) => collection.toolIds.includes(t.id))
  }, [tools, collection])

  const runningCount = members.filter((t) => {
    const status = states[t.id]?.status
    return status === 'running' || status === 'starting'
  }).length

  if (!collection || !collectionId) {
    return (
      <div className="empty-state">
        <div>
          <h2>Collection not found</h2>
          <Link className="btn btn-primary" to="/">
            Back to library
          </Link>
        </div>
      </div>
    )
  }

  async function toggleMember(toolId: string) {
    if (!collection) return
    const has = collection.toolIds.includes(toolId)
    await saveCollection({
      ...collection,
      toolIds: has
        ? collection.toolIds.filter((id) => id !== toolId)
        : [...collection.toolIds, toolId],
    })
  }

  async function runStackAction(action: 'start' | 'stop') {
    if (!collection) return
    setStackBusy(action)
    setStackSummary(null)
    try {
      const result =
        action === 'start'
          ? await window.shelf.startCollection(
              collection.id,
              // Same policy as single launches: simple mode heals busy ports.
              prefs.uiMode === 'simple' ? { onPortConflict: 'reassign' } : undefined,
            )
          : await window.shelf.stopCollection(collection.id)
      setStackSummary(summarizeStackResult(result, action))
    } catch (err) {
      setStackSummary(err instanceof Error ? err.message : String(err))
    } finally {
      setStackBusy(null)
      void refresh()
    }
  }

  return (
    <>
      <div className="collection-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={stackBusy !== null || members.length === 0 || runningCount === members.length}
          onClick={() => void runStackAction('start')}
        >
          <Play size={13} aria-hidden style={{ marginRight: 4 }} />
          {stackBusy === 'start' ? 'Starting stack…' : 'Start stack'}
        </button>
        {runningCount > 0 ? (
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            disabled={stackBusy !== null}
            onClick={() => void runStackAction('stop')}
          >
            <Square size={13} aria-hidden style={{ marginRight: 4 }} />
            {stackBusy === 'stop' ? 'Stopping stack…' : 'Stop stack'}
          </button>
        ) : null}
        {members.length > 0 ? (
          <span className="collection-running-count">
            {runningCount}/{members.length} running
          </span>
        ) : null}
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? 'Done' : 'Manage members'}
        </button>
        <button
          type="button"
          className="btn btn-danger btn-sm"
          onClick={() => {
            if (!window.confirm(`Delete collection “${collection.name}”? Tools stay in the library.`)) {
              return
            }
            void deleteCollection(collection.id).then(() => navigate('/'))
          }}
        >
          Delete collection
        </button>
      </div>
      {stackSummary ? <p className="collection-stack-summary">{stackSummary}</p> : null}

      {editing ? (
        <section className="panel" style={{ marginBottom: '1rem' }}>
          <div className="panel-header">
            <h2 className="panel-title">Members ({members.length})</h2>
          </div>
          <div className="panel-body stack">
            {designProfiles.length > 0 ? (
              <label className="field">
                <span className="field-label">Design profile</span>
                <select
                  className="field-input"
                  value={collection.designProfileId || ''}
                  onChange={(e) =>
                    void saveCollection({
                      ...collection,
                      designProfileId: e.target.value || undefined,
                    })
                  }
                >
                  <option value="">Default profile</option>
                  {designProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                      {profile.isDefault ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
                <span className="field-hint">
                  Agents building for tools in this collection use this brand profile.
                </span>
              </label>
            ) : null}
            {tools.map((tool) => {
              const checked = collection.toolIds.includes(tool.id)
              return (
                <label key={tool.id} className="filter-tag-row">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => void toggleMember(tool.id)}
                  />
                  <span>{tool.name}</span>
                </label>
              )
            })}
          </div>
        </section>
      ) : null}

      <LibraryPage mode="collection" />
    </>
  )
}
