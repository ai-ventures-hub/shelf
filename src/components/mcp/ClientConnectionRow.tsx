import type { McpClientSnapshot } from '../../lib/mcpConnectionStatus'
import { OverflowMenu, type OverflowMenuItem } from '../OverflowMenu'

export interface ClientConnectionRowProps {
  client: McpClientSnapshot
  flash?: string | null
  onPrimary: () => void
  menuItems: OverflowMenuItem[]
}

/** Compact one-row client card: mark, status, one primary action, ⋯ menu. */
export function ClientConnectionRow({
  client,
  flash,
  onPrimary,
  menuItems,
}: ClientConnectionRowProps) {
  return (
    <article className="mcp-client-row" data-state={client.state}>
      <div className="mcp-client-mark" aria-hidden>
        {client.mark}
      </div>
      <div className="mcp-client-copy">
        <div className="mcp-client-title-row">
          <h3 className="mcp-client-name">{client.name}</h3>
          <span className="status-pill" data-tone={client.tone}>
            {client.badge}
          </span>
        </div>
        <p className="mcp-client-detail">{client.detail}</p>
        {flash ? (
          <p className="mcp-client-flash" role="status">
            {flash}
          </p>
        ) : null}
      </div>
      <div className="mcp-client-actions">
        {client.primaryLabel && client.primaryKind ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={client.state === 'connecting'}
            onClick={onPrimary}
          >
            {client.primaryLabel}
          </button>
        ) : null}
        <OverflowMenu items={menuItems} label={`${client.name} actions`} />
      </div>
    </article>
  )
}
