import { SHARE_POINTS, SHARE_SHEET_ROWS, TEAM_ROWS } from '@/lib/landing-content'

/**
 * #share — Tool Sharing (1.2) and Team Tools (1.4), one section because they
 * are one story: the same tool, sent to one coworker or standing in a list
 * the whole team reads. Copy left, a static consent-sheet mock right, four
 * safeguards below, then the team band. Fully server-rendered: both mocks are
 * pictures, not live controls. The claim that must never soften — secrets
 * never travel, nothing runs before the sheet, a catalog entry is a pointer
 * and never a command — is the whole section.
 */
export function ToolSharing() {
  return (
    <section id="share" className="section" data-well aria-labelledby="share-heading">
      <div className="section-inner share-inner">
        <div className="share-grid">
          <div className="share-copy">
            <p className="eyebrow" data-reveal>
              New in 1.2 · Tool Sharing
            </p>
            <h2 id="share-heading" className="sec-h2" data-reveal>
              Works on your Shelf. Two clicks to a coworker’s.
            </h2>
            <p className="sec-lead" data-reveal>
              The hard part of “works on my machine” was never the code. Your
              team already has GitHub. It’s the launch command, the port, the
              setup steps, and the keys. Shelf packs all of that
              into a <code>shelf.json</code> beside your project and hands over a
              link. Your coworker approves one sheet, and it’s running.
            </p>
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

        <ol className="share-points" aria-label="Tool sharing safeguards">
          {SHARE_POINTS.map((point, i) => (
            <li
              key={point.title}
              className="share-point"
              data-reveal
              style={{ '--reveal-order': i } as React.CSSProperties}
            >
              <span className="share-point-n" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3>{point.title}</h3>
              <p>{point.body}</p>
            </li>
          ))}
        </ol>

        <div className="team-band">
          <div className="team-band-copy">
            <p className="eyebrow" data-reveal>
              New in 1.4 · Team Tools
            </p>
            <h3 className="team-band-h" data-reveal>
              One coworker, or the whole team.
            </h3>
            <p className="team-band-lead" data-reveal>
              A link only reaches the person you remember to send it to. A team
              is a git repo holding a <code>catalog.json</code>, so point Shelf
              at it once and everything your teammates published is standing
              there, one Install away, through the same consent sheet. Anyone
              who can clone the repo is on the team: access is whatever your
              git host already says it is. Still no Shelf server, still no
              account.
            </p>
            <p className="mcp-verbs be-verb" data-reveal>
              Share with team → your entry, committed and pushed
            </p>
          </div>

          <div className="mock-window team-pane" data-reveal aria-hidden>
            <div className="team-pane-head">
              <span className="traffic traffic--sm">
                <span />
                <span />
                <span />
              </span>
              <span className="team-pane-title">Team Tools</span>
              <span className="team-pane-meta">GWP Tools · 6 tools</span>
            </div>
            <div className="team-pane-body">
              {TEAM_ROWS.map((row) => (
                <div className="team-pane-row" key={row.name}>
                  <span className="team-pane-id">
                    <span className="team-pane-name">{row.name}</span>
                    <span className="team-pane-detail">{row.detail}</span>
                  </span>
                  <span className="team-pane-state" data-tone={row.tone}>
                    {row.state}
                  </span>
                </div>
              ))}
              <p className="team-pane-foot">
                An entry carries a name and a repo. Never a command, never a key.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
