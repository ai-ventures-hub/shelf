'use client'

import { useState } from 'react'
import { ShelfMark } from '@/components/ShelfMark'
import {
  APP_TABS,
  BRAND_PRESETS,
  GAP_ROWS,
  IMPORT_FIELDS,
  LIB_CARDS,
  MCP_CLIENTS,
  SIDE_LIBRARY,
  type AppTabId,
} from '@/lib/landing-demos'

/** Sidebar LIBRARY row highlighted per tab; mcp/register light the SYSTEM row. */
const SIDE_ACTIVE: Partial<Record<AppTabId, string>> = {
  library: 'All tools',
  gaps: 'Capability gaps',
}

/**
 * #app — the four-tab window mock. Defaults to the MCP Connections tab
 * (the last pill, deliberately). Panels are keyed by tab so fadeUp replays.
 */
export function AppShowcase() {
  const [tab, setTab] = useState<AppTabId>('mcp')
  const sideActive = SIDE_ACTIVE[tab]
  const mcpActive = tab === 'mcp' || tab === 'register'

  return (
    <section id="app" className="section" aria-labelledby="app-heading">
      <div className="section-inner showcase-inner">
        <p className="eyebrow">The app</p>
        <h2 id="app-heading" className="sec-h2">
          This is Shelf.
        </h2>
        <p className="sec-lead">
          The real macOS app — the same library, gaps, and connections your
          agents see over MCP.
        </p>
        <div className="showcase-tabs" role="tablist" aria-label="App views">
          {APP_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className="showcase-tab"
              data-active={tab === t.id ? 'true' : 'false'}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="mock-window mock-window--app">
          <div className="showcase-titlebar">
            <span className="traffic" aria-hidden>
              <span />
              <span />
              <span />
            </span>
            <span className="showcase-titlebar-label">Shelf</span>
          </div>
          <div className="showcase-body">
            <div className="showcase-side" aria-hidden>
              <div className="showcase-side-brand">
                <ShelfMark className="brand-mark" />
                <span>
                  <strong>Shelf</strong>
                  <small>Local tools</small>
                </span>
              </div>
              <div className="showcase-side-label">LIBRARY</div>
              {SIDE_LIBRARY.map((row) => (
                <div
                  key={row.name}
                  className="showcase-side-row"
                  data-active={row.name === sideActive ? 'true' : 'false'}
                >
                  <span>{row.name}</span>
                  <span className="n">{row.n}</span>
                </div>
              ))}
              <div className="showcase-side-label">COLLECTIONS</div>
              <div className="showcase-side-row">
                <span>GWP Tools</span>
                <span className="n">3</span>
              </div>
              <div className="showcase-side-row">
                <span>Suds Tools</span>
                <span className="n">2</span>
              </div>
              <div className="showcase-side-row" data-quiet="true">
                <span>+ New collection</span>
              </div>
              <div className="showcase-side-label">DESIGN</div>
              <div
                className="showcase-side-row"
                data-active={tab === 'design' ? 'true' : 'false'}
              >
                <span>Profiles</span>
                <span className="n">3</span>
              </div>
              <div className="showcase-side-label">SYSTEM</div>
              <div
                className="showcase-side-row"
                data-active={mcpActive ? 'true' : 'false'}
              >
                <span>{tab === 'register' ? 'Add a tool' : 'MCP Connections'}</span>
              </div>
              <div className="showcase-side-row">
                <span>Settings</span>
              </div>
            </div>
            <div className="showcase-pane">
              {tab === 'mcp' && (
                <div className="showcase-panel" key="mcp">
                  <h3>MCP Connections</h3>
                  <p className="showcase-panel-sub">
                    One library, every agent — one-click config, your other
                    servers untouched.
                  </p>
                  <div className="mcp-diagram">
                    <div className="mcp-clients">
                      {MCP_CLIENTS.map((client) => (
                        <div className="mcp-client" key={client.id}>
                          <span className="logo-tile">
                            <img src={client.logo} alt="" width={20} height={20} />
                          </span>
                          <span className="mcp-client-id">
                            <span className="mcp-client-name">{client.name}</span>
                            <span className="mcp-client-status">Connected</span>
                          </span>
                          <span className="mcp-client-dot" />
                        </div>
                      ))}
                    </div>
                    <div className="mcp-lines" aria-hidden>
                      {MCP_CLIENTS.map((client, i) => (
                        <div className="mcp-line" key={client.id}>
                          <span
                            style={{ '--dot-delay': `${i * 0.7}s` } as React.CSSProperties}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="mcp-node">
                      <div className="mcp-node-head">
                        <ShelfMark className="brand-mark" />
                        <span>
                          <span className="mcp-node-name">The shelf</span>
                          <span className="mcp-node-sub">Local · 5 tools</span>
                        </span>
                      </div>
                      <div className="mcp-node-path">
                        ~/Library/Application Support/
                        <br />
                        Shelf/library.json
                      </div>
                    </div>
                  </div>
                  <p className="mcp-verbs">
                    list · register · launch · stop · logs · discover — the same
                    verbs your desktop app uses.
                  </p>
                </div>
              )}
              {tab === 'library' && (
                <div className="showcase-panel" key="library">
                  <h3>Library</h3>
                  <p className="showcase-panel-sub">
                    5 tools · 1 running — every tool on one calm home screen.
                  </p>
                  <div className="lib-grid">
                    {LIB_CARDS.map((card) => (
                      <div className="lib-card" key={card.name} data-edge={card.edge}>
                        <div className="lib-card-row">
                          <span className="lt" aria-hidden>
                            {card.letter}
                          </span>
                          <span className="lib-card-id">
                            <span className="lib-card-name">{card.name}</span>
                            <span className="lib-card-cmd">{card.cmd}</span>
                          </span>
                          <span className="pill" data-tone={card.tone}>
                            {card.pill}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {tab === 'gaps' && (
                <div className="showcase-panel" key="gaps">
                  <h3>Capability gaps</h3>
                  <p className="showcase-panel-sub">
                    When no tool can do a job, the unmet need is written down —
                    a plan, not a silent failure.
                  </p>
                  <div className="gap-rows">
                    {GAP_ROWS.map((row) => (
                      <div className="gap-row" key={row.task}>
                        <span>
                          <span className="gap-task">{row.task}</span>
                          <span className="gap-reason">{row.reason}</span>
                        </span>
                        <span className="pill" data-tone="warning" data-fill="">
                          {row.count}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {tab === 'design' && (
                <div className="showcase-panel" key="design">
                  <h3>Design profiles</h3>
                  <p className="showcase-panel-sub">
                    Your brand — colors, type, voice — served to every agent as
                    tokens and a paste-ready brief.
                  </p>
                  <div className="design-rows">
                    {BRAND_PRESETS.map((preset) => (
                      <div className="design-row" key={preset.id}>
                        <span className="design-row-swatches" aria-hidden>
                          {preset.swatches.slice(0, 4).map((hex) => (
                            <span key={hex} style={{ background: hex }} />
                          ))}
                        </span>
                        <span className="design-row-id">
                          <span className="design-row-name">{preset.name}</span>
                          <span className="design-row-font">{preset.fontLabel}</span>
                        </span>
                        <span
                          className="pill"
                          data-tone={preset.id === 'shelf' ? 'accent' : 'muted'}
                        >
                          {preset.id === 'shelf' ? 'Default' : 'From agent'}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mcp-verbs">
                    “build it with my branding” — resolved from the default
                    profile, no design context from you.
                  </p>
                </div>
              )}
              {tab === 'register' && (
                <div className="showcase-panel" key="register">
                  <h3>Add a tool</h3>
                  <p className="showcase-panel-sub">
                    Shelf looked at this folder and filled in the setup for you.
                  </p>
                  <dl className="reg-fields">
                    {IMPORT_FIELDS.map((field) => (
                      <div
                        className="reg-field"
                        key={field.label}
                        data-tone={field.tone === 'default' ? undefined : field.tone}
                      >
                        <dt>{field.label}</dt>
                        <dd data-mono={field.mono ? 'true' : undefined}>
                          {field.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <div className="reg-actions">
                    <span className="mock-btn mock-btn--primary mock-btn--tall">
                      Add to library
                    </span>
                    <span className="mock-btn mock-btn--tall">Edit details</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <p className="showcase-note">
          Every tool on one calm home screen — status and launch at a glance.
        </p>
      </div>
    </section>
  )
}
