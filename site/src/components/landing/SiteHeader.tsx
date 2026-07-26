import { ShelfMark } from '@/components/ShelfMark'

/** Quiet public-shell header. */
export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <a className="header-brand" href="#top">
          <ShelfMark className="brand-mark brand-mark--compact" />
          <span>Shelf</span>
        </a>
        <nav className="header-nav" aria-label="Page">
          <a href="#demo">Demo</a>
          <a href="#capabilities">Capabilities</a>
          <a href="#agents">Agents</a>
          <a href="#access">Request access</a>
        </nav>
      </div>
    </header>
  )
}
