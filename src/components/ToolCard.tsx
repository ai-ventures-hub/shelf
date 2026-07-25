import { Link } from 'react-router-dom'
import type { Tool, ToolRuntimeState } from '../types'
import { StatusPill } from './StatusPill'
import { ToolIcon } from './ToolIcon'

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
}: {
  tool: Tool
  state?: ToolRuntimeState
}) {
  const status = state?.status || 'stopped'
  const visibleTags = tool.tags.slice(0, 2)
  const extraTags = Math.max(0, tool.tags.length - visibleTags.length)

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
        <h3 className="tool-name">
          {tool.favorite ? '★ ' : ''}
          {tool.name}
        </h3>
        <p className="tool-desc">
          {tool.description || state?.message || 'No description yet.'}
        </p>
      </div>
      <div className="tool-meta">
        {tool.port ? <span className="meta-chip">:{tool.port}</span> : null}
        <span className="meta-chip">{formatRelative(tool.lastLaunchedAt)}</span>
        {visibleTags.map((tag) => (
          <span key={tag} className="tag-chip">
            {tag}
          </span>
        ))}
        {extraTags > 0 ? <span className="tag-chip">+{extraTags}</span> : null}
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
          <span>
            {tool.favorite ? '★ ' : ''}
            {tool.name}
          </span>
        </Link>
      </td>
      <td>
        <StatusPill status={status} />
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
