import {
  DEMO_AGENT_MESSAGES,
  DEMO_LIBRARY,
  IMAGE_PREPPER,
} from '@/lib/demo-states'

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'Running'
      ? 'success'
      : status === 'Ready' || status === 'Added'
        ? 'brand'
        : status === 'Starting'
          ? 'warning'
          : 'muted'
  return (
    <span className="demo-pill" data-tone={tone}>
      {status}
    </span>
  )
}

/**
 * Direction A — static dual-surface hero: Agent transcript + Shelf library.
 * Phase 1 freezes the “happy path” end state; Phase 2 animates between beats.
 */
export function DualDemo() {
  return (
    <div id="demo" className="dual-demo" aria-label="Shelf product demonstration">
      <p className="dual-demo-caption">
        Simulated — prepared states, not your local Mac.
      </p>
      <div className="dual-demo-grid">
        <section className="demo-surface" aria-labelledby="demo-agent-heading">
          <header className="demo-surface-head">
            <h3 id="demo-agent-heading">Agent</h3>
            <span className="demo-surface-meta">Cursor · MCP</span>
          </header>
          <ul className="demo-chat">
            {DEMO_AGENT_MESSAGES.map((msg, i) => (
              <li key={i} className="demo-chat-bubble" data-role={msg.role}>
                <span className="demo-chat-role">
                  {msg.role === 'user' ? 'You' : 'Agent'}
                </span>
                <p>{msg.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="demo-surface demo-surface--shelf" aria-labelledby="demo-shelf-heading">
          <header className="demo-surface-head">
            <h3 id="demo-shelf-heading">Shelf</h3>
            <span className="demo-surface-meta">Library · 3 tools</span>
          </header>
          <ul className="demo-tool-list">
            {DEMO_LIBRARY.map((tool) => (
              <li
                key={tool.id}
                className="demo-tool-card"
                data-featured={tool.id === IMAGE_PREPPER.id ? 'true' : undefined}
              >
                <div className="demo-tool-top">
                  <div className="demo-tool-icon" aria-hidden>
                    {tool.name.slice(0, 1)}
                  </div>
                  <div className="demo-tool-copy">
                    <strong>{tool.name}</strong>
                    <span className="demo-tool-cmd">{tool.command}</span>
                  </div>
                  <StatusPill status={tool.status} />
                </div>
                <div className="demo-tool-meta">
                  {tool.port > 0 ? <span>:{tool.port}</span> : <span>One-shot</span>}
                  <span>{tool.tags.join(' · ')}</span>
                </div>
                {tool.logLine ? (
                  <pre className="demo-tool-log">{tool.logLine}</pre>
                ) : null}
                {tool.id === IMAGE_PREPPER.id ? (
                  <div className="demo-tool-actions">
                    <span className="demo-btn demo-btn--primary">Launch</span>
                    <span className="demo-btn">Open URL</span>
                    <span className="demo-btn">Stop</span>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
