import { COLLECTION_POINTS, COLLECTION_ROWS } from '@/lib/landing-content'

/**
 * #collections — agent-built collections (1.3). Window left, copy right, with
 * four ownership safeguards below. Fully server-rendered: the collection page
 * is a picture of what the agent left behind, not a control. The claim that
 * must never soften — an agent drafts, one edit makes it yours, and the
 * collection grants an agent nothing it didn't already have.
 */
export function AgentCollections() {
  return (
    <section id="collections" className="section" aria-labelledby="collections-heading">
      <div className="section-inner coll-inner">
        <div className="coll-grid">
          <div className="coll-copy">
            <p className="eyebrow" data-reveal>
              Stacks
            </p>
            <h2 id="collections-heading" className="sec-h2" data-reveal>
              Ask for the stack. It’s on your shelf.
            </h2>
            <p className="sec-lead" data-reveal>
              Ask for a stack. It lands marked <strong>From agent</strong>.
              Start it together, or in order so each port is up first.
            </p>
            <p className="mcp-verbs be-verb" data-reveal>
              “group these into a shelf” → shelf_upsert_collection
            </p>
          </div>

          <div className="coll-window" data-reveal>
            <div className="coll-ask-row" aria-hidden>
              <span className="coll-ask-label">You, in the chat</span>
              <span className="coll-ask-chip">
                Make a Movie Studio shelf with the three tools I built last week
              </span>
            </div>
            <div className="mock-window coll-page" aria-hidden>
              <div className="coll-page-head">
                <span className="traffic traffic--sm">
                  <span />
                  <span />
                  <span />
                </span>
                <span className="coll-page-title">Movie Studio</span>
                <span className="pill" data-tone="accent">
                  From agent
                </span>
                <span className="mock-btn mock-btn--primary">Start in order</span>
              </div>
              <div className="coll-page-body">
                <p className="coll-page-kicker">3 tools</p>
                {COLLECTION_ROWS.map((row) => (
                  <div className="coll-row" key={row.name}>
                    <span className="lt">{row.letter}</span>
                    <span className="coll-row-text">
                      <span className="coll-row-name">{row.name}</span>
                      <span className="coll-row-line">{row.line}</span>
                    </span>
                  </div>
                ))}
                <p className="coll-page-foot">
                  Script Room answers, then Voice Bench starts.
                </p>
              </div>
            </div>
          </div>
        </div>

        <ol className="coll-points" aria-label="Agent-built collection safeguards">
          {COLLECTION_POINTS.map((point, i) => (
            <li
              key={point.title}
              className="coll-point"
              data-reveal
              style={{ '--reveal-order': i } as React.CSSProperties}
            >
              <span className="coll-point-n" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3>{point.title}</h3>
              <p>{point.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
