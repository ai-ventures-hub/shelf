import { ExternalLink, Play, Square, Star, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { launchOriginLabel } from '../lib/launchOrigin'
import { formatRelativeTime } from '../lib/relativeTime'
import type { Tool, ToolHealth, ToolRuntimeState } from '../types'
import { StatusPill } from './StatusPill'
import { ToolIcon } from './ToolIcon'

/**
 * Launchability warning (triage E). Readiness (agent setup) and launchability
 * are different facts — this chip only reports "Launch will not work right
 * now" blockers, and shows nothing when the tool is healthy or live.
 */
function HealthChip({ health, live }: { health?: ToolHealth; live: boolean }) {
  if (!health || health.launchable || live) return null
  const [first] = health.problems
  return (
    <span className="meta-chip health-chip" title={health.problems.join(' ')}>
      <TriangleAlert size={11} aria-hidden />
      {first.replace(/\s*—.*$/, '').replace(/\.$/, '')}
    </span>
  )
}

/**
 * "Who started this?" — shown in BOTH ui modes on live cards; provenance is
 * the Simple-mode payoff, unlike the developer-only port/tag chips.
 */
function OriginChip({ state }: { state?: ToolRuntimeState }) {
  const status = state?.status
  if (status !== 'running' && status !== 'starting') return null
  const label = launchOriginLabel(state?.startedBy, {
    externalUnknown: state?.origin === 'external',
  })
  if (!label) return null
  return (
    <span className="meta-chip origin-chip" title={`Started by ${label}`}>
      {label}
    </span>
  )
}

export function ToolCard({
  tool,
  state,
  health,
  hideChips = false,
  onLaunch,
  onStop,
  onOpenUrl,
  onToggleFavorite,
}: {
  tool: Tool
  state?: ToolRuntimeState
  health?: ToolHealth
  /** Simple mode: no port/time/tag chips — icon, name, status, controls. */
  hideChips?: boolean
  onLaunch?: () => void
  onStop?: () => void
  onOpenUrl?: () => void
  onToggleFavorite?: () => void
}) {
  const status = state?.status || 'stopped'
  const live = status === 'running' || status === 'starting' || status === 'stopping' || (status === 'error' && Boolean(state?.pid))
  const visibleTags = tool.tags.slice(0, 2)
  const extraTags = Math.max(0, tool.tags.length - visibleTags.length)
  const hasControls = Boolean(onLaunch || onStop)

  return (
    <article
      className="tool-card"
      data-status={status}
      aria-label={tool.name}
    >
      <div className="tool-card-top">
        <ToolIcon
          name={tool.name}
          iconPath={tool.iconPath}
          iconLucide={tool.iconLucide}
          iconColor={tool.iconColor}
          iconBackground={tool.iconBackground}
        />
        <StatusPill status={status} message={state?.message} />
      </div>
      <div>
        <h3 className="tool-name"><Link className="tool-card-link" to={`/tools/${tool.id}`} aria-label={`${tool.name}, ${status}`}>{tool.name}</Link></h3>
        <p className="tool-desc">
          {status === 'error' ? state?.message || 'Open this tool to review the last failure.' : tool.description || tool.capabilities[0] || 'Add a short description to explain what this tool does.'}
        </p>
      </div>
      <div className="tool-card-footer">
        <div className="tool-meta">
          <OriginChip state={state} />
          {/* Health matters in BOTH ui modes — a broken Launch is a
              Simple-mode problem too (the origin-chip precedent). */}
          <HealthChip health={health} live={live} />
          {!hideChips ? (
            <>
              {tool.port ? <span className="meta-chip">:{tool.port}</span> : null}
              <span className="meta-chip">{formatRelativeTime(tool.lastLaunchedAt, 'Never')}</span>
              {visibleTags.map((tag) => (
                <span key={tag} className="tag-chip">
                  {tag}
                </span>
              ))}
              {extraTags > 0 ? <span className="tag-chip">+{extraTags}</span> : null}
            </>
          ) : null}
        </div>
        {hasControls ? (
          <div className="tool-card-controls">
            {onToggleFavorite ? (
              <button
                type="button"
                className={`btn btn-quiet btn-sm btn-icon control-favorite${
                  tool.favorite ? ' is-active' : ''
                }`}
                title={tool.favorite ? 'Remove from favorites' : 'Add to favorites'}
                aria-label={
                  tool.favorite
                    ? `Remove ${tool.name} from favorites`
                    : `Add ${tool.name} to favorites`
                }
                aria-pressed={tool.favorite}
                onClick={onToggleFavorite}
              >
                <Star
                  size={13}
                  fill={tool.favorite ? 'currentColor' : 'none'}
                  aria-hidden
                />
              </button>
            ) : null}
            {live ? (
              <button
                type="button"
                className="btn btn-quiet btn-sm btn-icon control-stop"
                title="Stop"
                aria-label={`Stop ${tool.name}`}
                disabled={status === 'stopping'}
                onClick={onStop}
              >
                <Square size={13} aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-quiet btn-sm btn-icon control-launch"
                title="Launch"
                aria-label={`Launch ${tool.name}`}
                onClick={onLaunch}
              >
                {/* Triangles lean left; 1px nudge optically centers it. */}
                <Play size={13} aria-hidden style={{ marginLeft: 1 }} />
              </button>
            )}
            {tool.url && status === 'running' && onOpenUrl ? (
              <button
                type="button"
                className="btn btn-quiet btn-sm btn-icon control-open"
                title="Open in browser"
                aria-label={`Open ${tool.name} in browser`}
                onClick={onOpenUrl}
              >
                <ExternalLink size={13} aria-hidden />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  )
}

/** Dense row used by the library list view. */
export function ToolListRow({
  tool,
  state,
  health,
  onLaunch,
  onStop,
}: {
  tool: Tool
  state?: ToolRuntimeState
  health?: ToolHealth
  onLaunch?: () => void
  onStop?: () => void
}) {
  const status = state?.status || 'stopped'
  const canStop = status === 'running' || status === 'starting' || status === 'stopping' || (status === 'error' && Boolean(state?.pid))
  const visibleTags = tool.tags.slice(0, 2)
  const extraTags = Math.max(0, tool.tags.length - visibleTags.length)

  return (
    <tr className="tool-list-row" data-status={status}>
      <td>
        <Link to={`/tools/${tool.id}`} className="tool-list-name">
          <ToolIcon
            name={tool.name}
            iconPath={tool.iconPath}
            iconLucide={tool.iconLucide}
            iconColor={tool.iconColor}
            iconBackground={tool.iconBackground}
            className="tool-icon tool-icon-sm"
          />
          <span className="tool-list-name-text">
            {tool.favorite ? (
              <Star
                className="row-favorite"
                size={12}
                fill="currentColor"
                aria-label="Favorite"
              />
            ) : null}
            {tool.name}
          </span>
        </Link>
      </td>
      <td>
        <div className="tool-list-status">
          <StatusPill status={status} />
          <OriginChip state={state} />
          <HealthChip health={health} live={canStop} />
        </div>
      </td>
      <td className="tabular">{tool.port ? `:${tool.port}` : '—'}</td>
      <td>
        <div className="tool-meta">
          {visibleTags.map((tag) => (
            <span key={tag} className="tag-chip">
              {tag}
            </span>
          ))}
          {extraTags > 0 ? <span className="tag-chip">+{extraTags}</span> : null}
        </div>
      </td>
      <td className="tabular">{formatRelativeTime(tool.lastLaunchedAt, 'Never')}</td>
      {/* Inner flex row — never put display:flex on the <td> (breaks table layout). */}
      <td className="tool-list-actions">
        <div className="tool-list-actions-row">
          {canStop ? (
            <button type="button" className="btn btn-quiet btn-sm" aria-label={`Stop ${tool.name}`} disabled={status === 'stopping'} onClick={onStop}>
              Stop
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" aria-label={`Launch ${tool.name}`} onClick={onLaunch}>
              Launch
            </button>
          )}
          <Link className="btn btn-quiet btn-sm" to={`/tools/${tool.id}`}>
            Open
          </Link>
        </div>
      </td>
    </tr>
  )
}
