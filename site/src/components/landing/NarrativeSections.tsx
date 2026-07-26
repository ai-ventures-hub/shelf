import type { ReactNode } from 'react'
import { WaitlistForm } from '@/components/WaitlistForm'
import {
  EXAMPLE_TOOLS,
  GRAVEYARD_ITEMS,
  IMPORT_SUGGESTIONS,
} from '@/lib/demo-states'

function SectionShell({
  id,
  eyebrow,
  title,
  children,
}: {
  id?: string
  eyebrow: string
  title: string
  children: ReactNode
}) {
  const headingId = id ? `${id}-heading` : undefined
  return (
    <section id={id} className="section" aria-labelledby={headingId}>
      <div className="section-inner section-inner--wide">
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={headingId}>{title}</h2>
        {children}
      </div>
    </section>
  )
}

/** Sections 2–10 from the landing vision narrative. */
export function NarrativeSections() {
  return (
    <>
      <SectionShell
        id="graveyard"
        eyebrow="The tool graveyard"
        title="Your tools should not disappear after you build them"
      >
        <p className="section-lead">
          AI-assisted builders ship more small utilities than ever—then lose them across folders,
          terminals, READMEs, and half-remembered ports.
        </p>
        <ul className="graveyard-grid" aria-label="Scattered tool rituals">
          {GRAVEYARD_ITEMS.map((item) => (
            <li key={item} className="graveyard-chip">
              {item}
            </li>
          ))}
        </ul>
        <p className="section-outro">
          Shelf gives those tools a permanent home—and lets your agents help maintain it.
        </p>
      </SectionShell>

      <SectionShell
        id="import"
        eyebrow="From folder to Shelf"
        title="Smart import remembers the ritual for you"
      >
        <p className="section-lead">
          Choose a project folder. Shelf suggests a name, launch command, port, tags, package
          manager, and DESIGN.md when it can. Accept what looks right—then the tool lives in your
          library.
        </p>
        <dl className="import-grid">
          {IMPORT_SUGGESTIONS.map((row) => (
            <div key={row.label} className="import-row">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </SectionShell>

      <SectionShell
        id="launch"
        eyebrow="Launch without the ritual"
        title="Starting, ready, running—with truthful status and logs"
      >
        <p className="section-lead">
          Shelf is not a bookmark manager. Port-backed tools report Running only when they are
          actually listening. Open the URL, watch live logs, then Stop or Restart when you are done.
        </p>
        <ol className="lifecycle-row" aria-label="Launch lifecycle">
          {['Starting', 'Ready', 'Running', 'Logs', 'Stop'].map((step) => (
            <li key={step}>
              <span className="lifecycle-step">{step}</span>
            </li>
          ))}
        </ol>
      </SectionShell>

      <SectionShell
        id="agents"
        eyebrow="One library shared with your agents"
        title="Your coding agent can see the tools you already have"
      >
        <p className="section-lead">
          The Shelf desktop app and connected agents use the same local library. Agents list tools,
          inspect projects, register new utilities, launch and stop processes, and read status or
          logs—without a separate registry.
        </p>
        <div className="share-model" aria-label="You, Shelf, and agents">
          <span className="share-node">You</span>
          <span className="share-edge" aria-hidden>
            ↔
          </span>
          <span className="share-node share-node--brand">Shelf library</span>
          <span className="share-edge" aria-hidden>
            ↔
          </span>
          <span className="share-node">Claude · Cursor · Codex</span>
        </div>
        <p className="section-outro">
          That access is provided through MCP—an open protocol for tool-using agents. Benefit first;
          acronym second.
        </p>
      </SectionShell>

      <SectionShell
        id="connect"
        eyebrow="Connect in one click"
        title="Claude Desktop, Cursor, and Codex"
      >
        <p className="section-lead">
          Shelf writes or updates the right MCP config while preserving your other servers. Advanced
          paths stay collapsed until you need them—same progressive disclosure as in the app.
        </p>
        <ul className="client-list">
          <li>Claude Desktop</li>
          <li>Cursor</li>
          <li>Codex</li>
        </ul>
      </SectionShell>

      <SectionShell
        id="examples"
        eyebrow="Built for real local tools"
        title="Personal utilities—not marketplace filler"
      >
        <p className="section-lead">
          Shelf feels like an App Store home screen for <em>your</em> tools: scripts, web apps,
          Docker stacks, and one-offs you actually use.
        </p>
        <ul className="example-grid">
          {EXAMPLE_TOOLS.map((tool) => (
            <li key={tool.name} className="example-card">
              <strong>{tool.name}</strong>
              <span>{tool.blurb}</span>
            </li>
          ))}
        </ul>
      </SectionShell>

      <SectionShell
        id="local"
        eyebrow="Local first"
        title="No account. Your data stays on your Mac"
      >
        <ul className="truth-list">
          <li>Community Shelf does not require a cloud account.</li>
          <li>Launch commands are authored by you—Shelf does not invent privileged access.</li>
          <li>
            Library, preferences, and run receipts live under{' '}
            <code>~/Library/Application Support/Shelf/</code>.
          </li>
          <li>Sensitive env values are masked in logs and MCP responses.</li>
          <li>Shelf does not require root.</li>
          <li>
            External <code>shelf://</code> launch, stop, and restart links ask for confirmation.
          </li>
          <li>
            Shelf runs local child processes, so it is not positioned as an App Store–sandboxed app.
          </li>
        </ul>
      </SectionShell>

      <SectionShell
        id="community"
        eyebrow="Community first"
        title="Free, open source, and complete without a subscription"
      >
        <p className="section-lead">
          Shelf Community is MIT-licensed and meant to remain a full product on its own. Profiles—a
          possible future add-on for reusable design profiles—will not paywall the core library or
          MCP tools.
        </p>
      </SectionShell>

      <section id="access" className="section section--final" aria-labelledby="final-heading">
        <div className="section-inner section-inner--wide">
          <p className="eyebrow">Soft launch</p>
          <h2 id="final-heading">Stop losing the tools you build.</h2>
          <p className="section-lead">
            macOS Community is invite-only while we finish the public soft launch. Request access,
            take another look at the demo, or read the source.
          </p>
          <div className="final-cta-grid">
            <WaitlistForm inputId="waitlist-email-final" />
            <div className="final-links">
              <a className="btn-primary" href="#demo">
                Take the interactive tour
              </a>
              <a
                className="btn-quiet"
                href="https://github.com/ai-ventures-hub/shelf"
                rel="noopener noreferrer"
              >
                View the source
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
