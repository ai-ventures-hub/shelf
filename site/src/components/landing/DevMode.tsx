import { ModeToggle } from './ModeToggle'

/**
 * #dev — Simple/Developer story. The copy stays server-rendered and rides
 * into the client ModeToggle as children (it owns the toggle + mock window).
 */
export function DevMode() {
  return (
    // Canvas since 1.0: #design took the well slot before it (alternation).
    <section id="dev" className="section" aria-labelledby="dev-heading">
      <div className="section-inner mode-grid">
        <ModeToggle>
          <p className="eyebrow">New in 0.7</p>
          <h2 id="dev-heading" className="sec-h2">
            Simple by default. Developer when you want it.
          </h2>
          <p className="sec-lead">
            One toggle. Simple hides MCP configs, capability panels, and launch
            flags behind plain language. Developer shows every wire. Same
            engine, same files. Nothing deleted, nothing dumbed down.
          </p>
        </ModeToggle>
      </div>
    </section>
  )
}
