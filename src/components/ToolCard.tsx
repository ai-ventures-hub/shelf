import { ExternalLink, Play, Square, Star } from 'lucide-react'
import { memo } from 'react'
import { Link } from 'react-router-dom'
import { launchOriginLabel } from '../lib/launchOrigin'
import { formatRelativeTime } from '../lib/relativeTime'
import type { Tool, ToolHealth, ToolRuntimeState } from '../types'
import { StatusPill } from './StatusPill'
import { ToolIcon } from './ToolIcon'
import { ToolHealthWarning } from './ToolHealthWarning'

/** A card action awaiting its IPC result; its button shows as busy. */
export type CardAction = 'launch' | 'stop' | 'favorite' | 'open'

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

/** True when the last run exited by itself (a one-off script), not by Stop. */
export function endedOnItsOwn(state?: ToolRuntimeState): boolean {
  return state?.status === 'stopped' && state.exitCode !== undefined
}

/**
 * "Finished · exit 0 · 2m ago · View output" for scripts that ran to
 * completion, which otherwise look identical to a tool that was never run.
 */
function FinishedLine({
  tool,
  state,
  finishedAt,
  compact = false,
}: {
  tool: Tool
  state?: ToolRuntimeState
  finishedAt?: string
  compact?: boolean
}) {
  if (!endedOnItsOwn(state)) return null
  const parts = ['Finished']
  if (typeof state?.exitCode === 'number') parts.push(`exit ${state.exitCode}`)
  if (finishedAt) parts.push(formatRelativeTime(finishedAt))
  const summary = parts.join(' · ')
  const to = `/tools/${encodeURIComponent(tool.id)}/runs`
  // Compact tiles have one short line: the summary itself links to output.
  if (compact) {
    return (
      <Link className="run-finished-compact" to={to} title={`${summary}. View output`} aria-label={`${summary}. View output from ${tool.name}`}>
        {summary}
      </Link>
    )
  }
  return (
    <p className="run-finished" title={state?.message || summary}>
      <span>{summary}</span>
      <Link className="run-finished-link" to={to} aria-label={`View output from ${tool.name}`}>
        View output
      </Link>
    </p>
  )
}

interface ToolCardProps {
  tool: Tool
  state?: ToolRuntimeState
  health?: ToolHealth
  /** Simple mode: no port/time/tag chips — icon, name, status, controls. */
  hideChips?: boolean
  compact?: boolean
  /** When this window saw the last run end on its own. */
  finishedAt?: string
  pending?: CardAction | null
  /** Last failed card action, shown inline until the next action. */
  error?: string | null
  onLaunch?: (tool: Tool) => void
  onStop?: (tool: Tool) => void
  onOpenUrl?: (tool: Tool) => void
  onToggleFavorite?: (tool: Tool) => void
}

function ToolCardView({
  tool,
  state,
  health,
  hideChips = false,
  compact = false,
  finishedAt,
  pending = null,
  error = null,
  onLaunch,
  onStop,
  onOpenUrl,
  onToggleFavorite,
}: ToolCardProps) {
  const status = state?.status || 'stopped'
  const live = status === 'running' || status === 'starting' || status === 'stopping' || (status === 'error' && Boolean(state?.pid))
  const visibleTags = tool.tags.slice(0, 2)
  const extraTags = Math.max(0, tool.tags.length - visibleTags.length)
  const hasControls = Boolean(onLaunch || onStop)
  const finished = endedOnItsOwn(state)

  const title = <h3 className="tool-name"><Link className="tool-card-link" to={`/tools/${tool.id}`} title={tool.name} aria-label={`${tool.name}, ${status}`}>{tool.name}</Link></h3>

  return (
    <article
      className={`tool-card${compact ? ' tool-card-compact' : ''}`}
      data-status={status}
      aria-label={tool.name}
      aria-busy={pending ? true : undefined}
    >
      <div className="tool-card-top">
        <ToolIcon
          name={tool.name}
          iconPath={tool.iconPath}
          iconLucide={tool.iconLucide}
          iconColor={tool.iconColor}
          iconBackground={tool.iconBackground}
        />
        {compact ? title : <StatusPill status={status} message={state?.message} />}
      </div>
      {!compact && <div>
        {title}
        {finished ? (
          <FinishedLine tool={tool} state={state} finishedAt={finishedAt} />
        ) : (
          <p className="tool-desc">
            {status === 'error' ? state?.message || 'Open this tool to review the last failure.' : tool.description || tool.capabilities[0] || 'Add a short description to explain what this tool does.'}
          </p>
        )}
      </div>}
      <div className="tool-card-notice">
        <ToolHealthWarning health={health} live={live} toolName={tool.name} iconOnly={compact} />
      </div>
      {error ? (
        <p className="tool-card-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="tool-card-footer">
        <div className="tool-meta">
          {compact && <StatusPill status={status} message={state?.message} />}
          {compact && finished ? <FinishedLine tool={tool} state={state} finishedAt={finishedAt} compact /> : null}
          <OriginChip state={state} />
          {!hideChips && !compact ? (
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
                disabled={pending === 'favorite'}
                onClick={() => onToggleFavorite(tool)}
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
                title={pending === 'stop' ? 'Stopping…' : 'Stop'}
                aria-label={`Stop ${tool.name}`}
                disabled={status === 'stopping' || pending === 'stop' || pending === 'launch'}
                onClick={() => onStop?.(tool)}
              >
                <Square size={13} aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-quiet btn-sm btn-icon control-launch"
                title={pending === 'launch' ? 'Launching…' : 'Launch'}
                aria-label={`Launch ${tool.name}`}
                disabled={pending === 'launch' || pending === 'stop'}
                onClick={() => onLaunch?.(tool)}
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
                disabled={pending === 'open'}
                onClick={() => onOpenUrl(tool)}
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

function sameHealth(a?: ToolHealth, b?: ToolHealth): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.launchable === b.launchable && a.problems.join('\n') === b.problems.join('\n')
}

/**
 * Library refreshes replace every tool and health object even when nothing
 * changed; compare by content so only the affected card re-renders.
 */
export const ToolCard = memo(ToolCardView, (prev, next) =>
  (prev.tool === next.tool || JSON.stringify(prev.tool) === JSON.stringify(next.tool)) &&
  prev.state === next.state &&
  sameHealth(prev.health, next.health) &&
  prev.hideChips === next.hideChips &&
  prev.compact === next.compact &&
  prev.finishedAt === next.finishedAt &&
  prev.pending === next.pending &&
  prev.error === next.error &&
  prev.onLaunch === next.onLaunch &&
  prev.onStop === next.onStop &&
  prev.onOpenUrl === next.onOpenUrl &&
  prev.onToggleFavorite === next.onToggleFavorite,
)

/** Dense row used by the library list view. */
export function ToolListRow({
  tool,
  state,
  health,
  pending = null,
  error = null,
  onLaunch,
  onStop,
}: {
  tool: Tool
  state?: ToolRuntimeState
  health?: ToolHealth
  pending?: CardAction | null
  error?: string | null
  onLaunch?: (tool: Tool) => void
  onStop?: (tool: Tool) => void
}) {
  const status = state?.status || 'stopped'
  const canStop = status === 'running' || status === 'starting' || status === 'stopping' || (status === 'error' && Boolean(state?.pid))
  const visibleTags = tool.tags.slice(0, 2)
  const extraTags = Math.max(0, tool.tags.length - visibleTags.length)

  return (
    <tr data-status={status} aria-busy={pending ? true : undefined}>
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
          <ToolHealthWarning health={health} live={canStop} toolName={tool.name} />
        </div>
        {error ? <p className="tool-card-error" role="alert">{error}</p> : null}
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
      <td className="tabular">
        {endedOnItsOwn(state) && typeof state?.exitCode === 'number' ? (
          <Link to={`/tools/${encodeURIComponent(tool.id)}/runs`} title="View output">
            Finished · exit {state.exitCode}
          </Link>
        ) : (
          formatRelativeTime(tool.lastLaunchedAt, 'Never')
        )}
      </td>
      {/* Inner flex row — never put display:flex on the <td> (breaks table layout). */}
      <td className="tool-list-actions">
        <div className="tool-list-actions-row">
          {canStop ? (
            <button type="button" className="btn btn-quiet btn-sm" aria-label={`Stop ${tool.name}`} disabled={status === 'stopping' || pending !== null} onClick={() => onStop?.(tool)}>
              {pending === 'stop' ? 'Stopping…' : 'Stop'}
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" aria-label={`Launch ${tool.name}`} disabled={pending !== null} onClick={() => onLaunch?.(tool)}>
              {pending === 'launch' ? 'Launching…' : 'Launch'}
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
