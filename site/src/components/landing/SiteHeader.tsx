import { ShelfMark } from '@/components/ShelfMark'

/** Command-deck header — three anchors and the tertiary GitHub CTA. */
export function SiteHeader() {
  return (
    <header className="site-header">
      <a className="header-brand" href="#top">
        <span className="brand-tile">
          <ShelfMark className="brand-mark" />
        </span>
        <span className="brand-name">Shelf</span>
      </a>
      <nav className="header-nav" aria-label="Page">
        <a href="#demo">Demo</a>
        <a href="#capabilities">Capabilities</a>
        <a href="#agents">Agents</a>
        <a
          className="header-github"
          href="https://github.com/ai-ventures-hub/shelf"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
      </nav>
    </header>
  )
}
