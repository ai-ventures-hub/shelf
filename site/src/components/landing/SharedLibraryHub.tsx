import { HUB_CLIENTS, HUB_SHELF_ROWS } from '@/lib/landing-content'

/** Beat 06 — You ↔ the shelf ↔ every agent, as a hairline diagram. */
export function SharedLibraryHub() {
  return (
    <section id="agents" className="section" aria-labelledby="agents-heading">
      <div className="section-inner">
        <div className="section-head section-head--center">
          <p className="eyebrow">One library, shared over MCP</p>
          <h2 id="agents-heading">One library. Every agent. No second registry.</h2>
          <p className="section-lead">
            Your desktop app and your coding agents read and write the same local
            shelf — list, register, launch, stop, read logs, discover capabilities.
            Shelf writes each client’s MCP config in one click, preserving your other
            servers.
          </p>
        </div>
        <div className="hub">
          <div className="hub-node">
            <span className="hub-node-label">You</span>
            <strong>Shelf for macOS</strong>
            <p>
              Browse, launch, watch logs, stop. The App-Store-home-screen for your own
              tools.
            </p>
          </div>
          <div className="hub-link" aria-hidden>
            <span>reads / writes</span>
          </div>
          <div className="hub-shelf">
            <div className="hub-shelf-head">
              <strong>The shelf</strong>
              <span className="hub-shelf-badge">Local · 3 tools</span>
            </div>
            <ul className="hub-shelf-rows">
              {HUB_SHELF_ROWS.map((row) => (
                <li key={row.name}>
                  <span>{row.name}</span>
                  <span data-live={row.live ? 'true' : undefined}>{row.state}</span>
                </li>
              ))}
            </ul>
            <span className="hub-shelf-path">
              ~/Library/Application Support/Shelf/library.json
            </span>
          </div>
          <div className="hub-link" aria-hidden>
            <span>MCP</span>
          </div>
          <div className="hub-clients">
            <ul>
              {HUB_CLIENTS.map((client) => (
                <li key={client.name}>
                  <span className="hub-client-id">
                    <span className="hub-client-mono" aria-hidden>
                      {client.mono}
                    </span>
                    {client.name}
                  </span>
                  <span className="pill" data-tone="success">
                    Connected
                  </span>
                </li>
              ))}
            </ul>
            <span className="hub-clients-note">
              One-click config · your other MCP servers untouched
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
