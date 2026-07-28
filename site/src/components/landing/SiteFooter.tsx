import Link from 'next/link'
import { GitHubMark } from '@/components/GitHubMark'
import { ShelfMark } from '@/components/ShelfMark'

/** Marketing footer — lockup, contact, and the short trust manifest. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="footer-brand-col">
          <Link className="footer-brand" href="/">
            <ShelfMark className="brand-mark brand-mark--sm" />
            <span className="footer-brand-name">Shelf</span>
          </Link>
          <p className="footer-tagline">
            Local tool library for macOS. Your tools, your Mac, your data.
          </p>
          <p className="footer-legal">MIT-licensed · © {new Date().getFullYear()} Shelf</p>
        </div>
        <nav className="footer-col" aria-label="Product">
          <p className="footer-col-title">Product</p>
          <Link href="/download">Download</Link>
          <Link href="/#app">The app</Link>
          <Link href="/#demo">Interactive demo</Link>
          <a
            className="link-with-mark"
            href="https://github.com/ai-ventures-hub/shelf"
            rel="noopener noreferrer"
          >
            <GitHubMark size={13} />
            GitHub
          </a>
        </nav>
        <div className="footer-col">
          <p className="footer-col-title">Contact</p>
          <a href="mailto:hello@shelfmcp.com">hello@shelfmcp.com</a>
          <a href="mailto:support@shelfmcp.com">support@shelfmcp.com</a>
          <a
            href="https://github.com/ai-ventures-hub/shelf/issues"
            rel="noopener noreferrer"
          >
            Report an issue
          </a>
        </div>
      </div>
    </footer>
  )
}
