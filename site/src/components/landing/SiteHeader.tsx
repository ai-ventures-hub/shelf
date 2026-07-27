import Link from 'next/link'
import { GitHubMark } from '@/components/GitHubMark'
import { ShelfMark } from '@/components/ShelfMark'

/** Command-deck header — three anchors and the tertiary GitHub CTA. */
export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link className="header-brand" href="/">
          <span className="brand-tile">
            <ShelfMark className="brand-mark" />
          </span>
          <span className="brand-name">Shelf</span>
        </Link>
        <nav className="header-nav" aria-label="Page">
          <Link href="/#demo">Demo</Link>
          <Link href="/#capabilities">Capabilities</Link>
          <Link href="/#agents">Agents</Link>
          <Link href="/#app">App</Link>
          <a
            className="header-github"
            href="https://github.com/ai-ventures-hub/shelf"
            rel="noopener noreferrer"
          >
            <GitHubMark />
            GitHub
          </a>
          <Link className="header-download" href="/download">
            Download <span className="header-download-free">— It’s free</span>
          </Link>
        </nav>
      </div>
    </header>
  )
}
