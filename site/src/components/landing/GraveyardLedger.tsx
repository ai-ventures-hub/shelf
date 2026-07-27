import { LEDGER_ROWS } from '@/lib/landing-content'

/** Beat 02 — the tool graveyard as a status ledger ending in the pitch. */
export function GraveyardLedger() {
  return (
    <section id="graveyard" className="section" aria-labelledby="graveyard-heading">
      <div className="section-inner">
        <div className="section-head">
          <p className="eyebrow">The tool graveyard</p>
          <h2 id="graveyard-heading">Where did your tools go?</h2>
          <p className="section-lead">
            Run the audit on last quarter’s side-builds. For most of us the honest
            answer is a column of gray.
          </p>
        </div>
        <div className="ledger">
          <div className="ledger-head" aria-hidden>
            <span>Tool</span>
            <span>Last seen</span>
            <span>Launch ritual</span>
            <span className="ledger-right">Status</span>
          </div>
          <ul className="ledger-rows">
            {LEDGER_ROWS.map((row) => (
              <li
                key={row.name}
                className="ledger-row"
                data-shelved={row.shelved ? 'true' : undefined}
              >
                <span className="ledger-name">{row.name}</span>
                <span className="ledger-seen">{row.seen}</span>
                <span className="ledger-ritual">{row.ritual}</span>
                <span className="pill ledger-status" data-tone={row.tone}>
                  {row.status}
                </span>
              </li>
            ))}
          </ul>
          <div className="ledger-cta">
            <span>On the shelf, a tool never reads Unknown again.</span>
            <a href="#access">Shelve your tools →</a>
          </div>
        </div>
      </div>
    </section>
  )
}
