import Link from 'next/link'
import { ShelfMark } from '@/components/ShelfMark'

/** Sticky 70px header — the hero pin math depends on this height. */
export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link className="header-brand" href="/">
          <ShelfMark className="brand-mark" />
          <span className="brand-name">Shelf</span>
        </Link>
        <nav className="header-nav" aria-label="Page">
          <Link href="/#how">How it works</Link>
          <Link href="/#app">The app</Link>
          <Link href="/#agents">Your AI tools</Link>
          <Link href="/#dev">For developers</Link>
          <a href="https://github.com/ai-ventures-hub/shelf" rel="noopener noreferrer">
            GitHub
          </a>
          <Link className="btn-primary btn--nav" href="/download">
            Download <span className="header-download-free">— It’s free</span>
          </Link>
        </nav>
      </div>
    </header>
  )
}
