import { SHARE_POINTS, SHARE_SHEET_ROWS } from '@/lib/landing-content'

/**
 * #share — Tool Sharing (1.2). Copy left, a static consent-sheet mock right,
 * mirroring #agents/#design. Fully server-rendered: the sheet is a picture,
 * not a live control. The claim that must never soften — secrets never
 * travel, nothing runs before the sheet — is the whole section.
 */
export function ToolSharing() {
  return (
    <section id="share" className="section" data-well aria-labelledby="share-heading">
      <div className="section-inner share-grid">
        <div className="share-copy">
          <p className="eyebrow" data-reveal>
            New in 1.2 · Tool Sharing
          </p>
          <h2 id="share-heading" className="sec-h2" data-reveal>
            Works on your Shelf. Two clicks to a coworker’s.
          </h2>
          <p className="sec-lead" data-reveal>
            The hard part of “works on my machine” was never the code — your team
            already has GitHub. It’s the launch command, the port, the setup
            steps, and which keys are needed. Shelf packs all of that into a
            <code> shelf.json</code> beside your project and hands over a link.
            Your coworker approves one sheet, and it’s running.
          </p>
          <ul className="be-points" data-reveal>
            {SHARE_POINTS.map((point) => (
              <li key={point.title}>
                <strong>{point.title}</strong> {point.body}
              </li>
            ))}
          </ul>
          <p className="mcp-verbs be-verb" data-reveal>
            “share this with my team” → shelf_export_tool
          </p>
        </div>

        <div className="share-window" data-reveal>
          <div className="share-link-row" aria-hidden>
            <span className="share-link-label">Pasted in Slack</span>
            <code className="share-link-chip">shelf://add?repo=…</code>
          </div>
          <div className="mock-window share-sheet" aria-hidden>
            <div className="share-sheet-head">
              <span className="traffic traffic--sm">
                <span />
                <span />
                <span />
              </span>
              <span className="share-sheet-title">Add “Image Prepper” to your Shelf?</span>
            </div>
            <div className="share-sheet-body">
              {SHARE_SHEET_ROWS.map((row) => (
                <div className="share-sheet-row" key={row.label} data-kind={row.kind}>
                  <span className="share-sheet-key">{row.label}</span>
                  {row.kind === 'env' ? (
                    <span className="share-sheet-input">{row.value}</span>
                  ) : (
                    <span className="share-sheet-val">{row.value}</span>
                  )}
                </div>
              ))}
              <div className="share-sheet-foot">
                <span className="share-sheet-note">Nothing runs until you approve.</span>
                <span className="mock-btn">Cancel</span>
                <span className="mock-btn mock-btn--primary">Add to my Shelf</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
