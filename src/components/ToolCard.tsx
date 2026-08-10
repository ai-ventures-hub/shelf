import { ExternalLink, Play, Square, Star } from 'lucide-react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { launchOriginLabel } from '../lib/launchOrigin'
import type { Tool, ToolRuntimeState } from '../types'
import { StatusPill } from './StatusPill'
import { ToolIcon } from './ToolIcon'

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

function formatRelative(iso?: string): string {
  if (!iso) return 'Never'
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return 'Never'
  const mins = Math.round((Date.now() - then) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function ToolCard({
  tool,
  state,
  hideChips = false,
  onLaunch,
  onStop,
  onOpenUrl,
  onToggleFavorite,
}: {
  tool: Tool
  state?: ToolRuntimeState
  /** Simple mode: no port/time/tag chips — icon, name, status, controls. */
  hideChips?: boolean
  onLaunch?: () => void
  onStop?: () => void
  onOpenUrl?: () => void
  onToggleFavorite?: () => void
}) {
  const status = state?.status || 'stopped'
  const live = status === 'running' || status === 'starting'
  const visibleTags = tool.tags.slice(0, 2)
  const extraTags = Math.max(0, tool.tags.length - visibleTags.length)
  const hasControls = Boolean(onLaunch || onStop)

  // The whole card is a Link; controls must not trigger navigation.
  const control = (action?: () => void) => (e: ReactMouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    action?.()
  }

  return (
    <Link
      to={`/tools/${tool.id}`}
      className="tool-card"
      data-status={status}
      aria-label={`${tool.name}, ${status}`}
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
        <h3 className="tool-name">{tool.name}</h3>
        <p className="tool-desc">
          {tool.description || state?.message || 'No description yet.'}
        </p>
      </div>
      <div className="tool-card-footer">
        <div className="tool-meta">
          <OriginChip state={state} />
          {!hideChips ? (
            <>
              {tool.port ? <span className="meta-chip">:{tool.port}</span> : null}
              <span className="meta-chip">{formatRelative(tool.lastLaunchedAt)}</span>
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
                onClick={control(onToggleFavorite)}
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
                disabled={status === 'starting'}
                onClick={control(onStop)}
              >
                <Square size={13} aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-quiet btn-sm btn-icon control-launch"
                title="Launch"
                aria-label={`Launch ${tool.name}`}
                onClick={control(onLaunch)}
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
                onClick={control(onOpenUrl)}
              >
                <ExternalLink size={13} aria-hidden />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Link>
  )
}

/** Dense row used by the library list view. */
export function ToolListRow({
  tool,
  state,
  onLaunch,
  onStop,
}: {
  tool: Tool
  state?: ToolRuntimeState
  onLaunch?: () => void
  onStop?: () => void
}) {
  const status = state?.status || 'stopped'
  const canStop = status === 'running' || status === 'starting'
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
      <td className="tabular">{formatRelative(tool.lastLaunchedAt)}</td>
      {/* Inner flex row — never put display:flex on the <td> (breaks table layout). */}
      <td className="tool-list-actions">
        <div className="tool-list-actions-row">
          {canStop ? (
            <button type="button" className="btn btn-quiet btn-sm" onClick={onStop}>
              Stop
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" onClick={onLaunch}>
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
