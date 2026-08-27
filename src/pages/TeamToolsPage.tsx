/**
 * Team Tools (1.4) — the catalogs this Mac subscribes to and what's in them.
 *
 * A catalog is a git repo holding one `catalog.json`. Shelf reads that file
 * and nothing else out of the repo. Every entry is a POINTER: Install hands
 * its repo to the same stage → consent sheet → confirm path a shelf:// link
 * uses, so the sheet stays the only thing that can authorize setup or launch.
 * Nothing on this page runs anything.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useLibrary } from '../hooks/useLibrary'
import { requestAddShared } from '../lib/sharingEvents'
import type { CatalogEntry, ShareFailure, TeamCatalog } from '../types'

function relativeTime(iso?: string): string {
  if (!iso) return 'never fetched'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'never fetched'
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function FailureCard({ failure }: { failure: ShareFailure }) {
  return (
    <div className="warning-card" role="alert">
      <p style={{ margin: 0 }}>{failure.message}</p>
      {failure.remedy ? (
        <p style={{ margin: '0.4rem 0 0', color: 'var(--muted)' }}>{failure.remedy}</p>
      ) : null}
      {failure.remedyCommand ? (
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          style={{ marginTop: '0.5rem' }}
          onClick={() => void navigator.clipboard.writeText(failure.remedyCommand as string)}
        >
          Copy {failure.remedyCommand}
        </button>
      ) : null}
    </div>
  )
}

function EntryRow({
  entry,
  installedId,
  onInstall,
}: {
  entry: CatalogEntry
  /** Library id when this repo is already on the shelf, else undefined. */
  installedId?: string
  onInstall: () => void
}) {
  return (
    <div className="team-entry">
      <div className="team-entry-main">
        <strong className="team-entry-name">{entry.name}</strong>
        {entry.description ? <p className="team-entry-desc">{entry.description}</p> : null}
        <p className="team-entry-repo" title={entry.repo}>
          {entry.repo}
        </p>
        {entry.capabilities.length > 0 ? (
          <div className="team-entry-caps">
            {entry.capabilities.slice(0, 4).map((cap) => (
              <span className="tag-chip" key={cap}>
                {cap}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="team-entry-action">
        {installedId ? (
          <>
            <span className="tag-chip">On your shelf</span>
            <Link className="btn btn-quiet btn-sm" to={`/tools/${installedId}`}>
              Open
            </Link>
          </>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" onClick={onInstall}>
            Install
          </button>
        )}
      </div>
    </div>
  )
}

export function TeamToolsPage() {
  const { tools } = useLibrary()
  const [catalogs, setCatalogs] = useState<TeamCatalog[]>([])
  const [loading, setLoading] = useState(true)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [failure, setFailure] = useState<ShareFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const list = await window.shelf.listTeamCatalogs()
    setCatalogs(list)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // A tool installed from a catalog carries the entry's repo as its source,
  // which is what lets an entry say "on your shelf" instead of offering a
  // second install of the same thing.
  const installedByRepo = new Map<string, string>()
  for (const tool of tools) {
    const repo = tool.source?.repo
    if (repo) installedByRepo.set(repo.toLowerCase().replace(/\.git$/, ''), tool.id)
  }
  const installedIdFor = (repo: string): string | undefined =>
    installedByRepo.get(repo.toLowerCase().replace(/\.git$/, ''))

  async function addCatalog(e: FormEvent) {
    e.preventDefault()
    const value = url.trim()
    if (!value) return
    setBusy('add')
    setFailure(null)
    setNotice(null)
    const result = await window.shelf.addTeamCatalog(value)
    setBusy(null)
    if (!result.ok) {
      setFailure(result)
      return
    }
    setUrl('')
    if (result.empty) {
      setNotice(
        `${result.catalog.name} has no catalog.json yet. Share a tool with the team to start it.`,
      )
    }
    await load()
  }

  async function refresh(catalog: TeamCatalog) {
    setBusy(catalog.id)
    setFailure(null)
    setNotice(null)
    const result = await window.shelf.refreshTeamCatalog(catalog.id)
    setBusy(null)
    if (!result.ok) setFailure(result)
    await load()
  }

  async function remove(catalog: TeamCatalog) {
    setBusy(catalog.id)
    await window.shelf.removeTeamCatalog(catalog.id)
    setBusy(null)
    setNotice(`Unsubscribed from ${catalog.name}. Tools you installed from it stay on your shelf.`)
    await load()
  }

  return (
    <>
      <header className="page-header">
        <div className="page-header-copy">
          <p className="eyebrow">Team</p>
          <h1 className="page-title">Team Tools</h1>
          <p className="page-lede">
            A team is a git repo your org already controls. Point Shelf at it once and every
            tool your teammates published is one Install away, through the same consent sheet
            as any other shared tool. No accounts, no Shelf server.
          </p>
        </div>
      </header>

      <form className="team-add" onSubmit={addCatalog}>
        <input
          type="text"
          className="input"
          value={url}
          placeholder="https://github.com/your-team/shelf-catalog"
          aria-label="Catalog repository URL"
          onChange={(e) => setUrl(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={busy === 'add' || !url.trim()}>
          {busy === 'add' ? 'Fetching…' : 'Add catalog'}
        </button>
      </form>

      {failure ? <FailureCard failure={failure} /> : null}
      {notice ? (
        <div className="share-status" role="status">
          {notice}
        </div>
      ) : null}

      {!loading && catalogs.length === 0 ? (
        <div className="empty-state">
          <div>
            <h2>No team catalogs yet</h2>
            <p>
              Create a repo your team can read, add a <code>catalog.json</code> to it, and paste
              the clone URL above. Anyone who can clone that repo is on the team, so access is
              whatever your git host already says it is.
            </p>
          </div>
        </div>
      ) : null}

      {catalogs.map((catalog) => (
        <section className="team-catalog" key={catalog.id}>
          <header className="team-catalog-head">
            <div>
              <h2 className="team-catalog-name">{catalog.name}</h2>
              <p className="team-catalog-meta">
                {catalog.entries.length} {catalog.entries.length === 1 ? 'tool' : 'tools'} ·
                fetched {relativeTime(catalog.lastFetchedAt)}
              </p>
            </div>
            <div className="team-catalog-actions">
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                disabled={busy === catalog.id}
                onClick={() => void refresh(catalog)}
              >
                {busy === catalog.id ? 'Refreshing…' : 'Refresh'}
              </button>
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                disabled={busy === catalog.id}
                onClick={() => void remove(catalog)}
              >
                Unsubscribe
              </button>
            </div>
          </header>

          {catalog.lastError ? (
            <div className="warning-card" role="alert">
              Last refresh failed: {catalog.lastError}
            </div>
          ) : null}
          {catalog.hasUnpushedEntry ? (
            <div className="warning-card" role="alert">
              An entry you shared with this team is committed here but hasn't reached the remote
              yet. Refresh keeps it; push it when git can reach the repo.
            </div>
          ) : null}
          {catalog.warnings?.map((warning) => (
            <div className="share-status" role="status" key={warning}>
              {warning}
            </div>
          ))}

          {catalog.entries.length === 0 ? (
            <p className="team-catalog-empty">
              Nothing published yet. Open a tool with a git remote and use Share with team.
            </p>
          ) : (
            <div className="team-entries">
              {catalog.entries.map((entry) => (
                <EntryRow
                  key={entry.repo}
                  entry={entry}
                  installedId={installedIdFor(entry.repo)}
                  onInstall={() => requestAddShared({ repo: entry.repo, autoFetch: true })}
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </>
  )
}
