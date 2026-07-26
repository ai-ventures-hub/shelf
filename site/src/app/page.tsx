import { ShelfMark } from '@/components/ShelfMark'
import { WaitlistForm } from '@/components/WaitlistForm'

/** Public soft-launch landing — waitlist first; MCP aha below the fold. */
export default function HomePage() {
  return (
    <>
      <header className="site-header">
        <div className="site-header-inner">
          <a className="header-brand" href="#top">
            <ShelfMark className="brand-mark brand-mark--compact" />
            <span>Shelf</span>
          </a>
          <nav className="header-nav" aria-label="Page">
            <a href="#library">Library</a>
            <a href="#agents">Agents</a>
            <a href="#local">Local-first</a>
          </nav>
        </div>
      </header>

      <main id="top" className="site-main">
        <section className="hero" aria-labelledby="hero-heading">
          <div className="hero-brand">
            <ShelfMark />
            <p className="hero-wordmark">Shelf</p>
          </div>
          <h1 id="hero-heading" className="hero-title">
            A home for every tool you build.
          </h1>
          <p className="hero-support">
            Launch them yourself—or let your AI agents handle it.
          </p>
          <WaitlistForm />
        </section>

        <section id="library" className="section" aria-labelledby="library-heading">
          <div className="section-inner">
            <p className="eyebrow">Local tool library</p>
            <h2 id="library-heading">Organize, launch, and watch every project from one place</h2>
            <p>
              Shelf keeps a calm library of the scripts, web apps, and utilities you build.
              Remembered launch commands, truthful process status, live logs, Quick Open
              (<kbd>⌘K</kbd>), and one-click open for URL, folder, editor, or Terminal.
            </p>
          </div>
        </section>

        <section id="agents" className="section" aria-labelledby="agents-heading">
          <div className="section-inner">
            <p className="eyebrow">MCP-powered local tool manager</p>
            <h2 id="agents-heading">The same library your agents can operate</h2>
            <p>
              Connect Claude Desktop, Cursor, or Codex once. Agents register tools, pick free
              ports, launch and stop processes, read logs, and pull project DESIGN.md—against
              the same library you see in the app.
            </p>
            <p>
              You stay in control of the Mac. Agents get a structured interface instead of a
              forgotten shell ritual.
            </p>
            <ul className="client-list" aria-label="Supported agent clients">
              <li>Claude Desktop</li>
              <li>Cursor</li>
              <li>Codex</li>
            </ul>
          </div>
        </section>

        <section id="local" className="section" aria-labelledby="local-heading">
          <div className="section-inner">
            <p className="eyebrow">Local-first</p>
            <h2 id="local-heading">No account. Your data stays on your Mac</h2>
            <p>
              Community Shelf does not require a cloud account. Library, preferences, and run
              receipts live under{' '}
              <code>~/Library/Application Support/Shelf/</code>. Commands are yours; Shelf
              does not run as root.
            </p>
          </div>
        </section>

        <section className="section" aria-labelledby="launch-heading">
          <div className="section-inner">
            <p className="eyebrow">Soft launch</p>
            <h2 id="launch-heading">macOS Community — invite only for now</h2>
            <p>
              Shelf Community is free and MIT-licensed. Early access is invite-only while we
              finish the public soft launch. Signed distribution comes later; invitees may
              receive an unsigned local build with a clear Gatekeeper path.
            </p>
            <div className="soft-note">
              Request access above. We will email when your invite is ready—no spam, no
              marketing drip.
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-footer-inner">
          <p>Shelf · macOS · Community soft launch · MIT</p>
          <p>
            <a href="https://github.com/ai-ventures-hub/shelf">GitHub</a>
            {' · '}
            <span>shelfmcp.com</span>
          </p>
        </div>
      </footer>
    </>
  )
}
