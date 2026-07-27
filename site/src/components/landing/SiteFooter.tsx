import { GitHubMark } from '@/components/GitHubMark'

/** Marketing footer. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <p>Shelf · macOS · Community soft launch · MIT</p>
        <p>
          <a
            className="link-with-mark"
            href="https://github.com/ai-ventures-hub/shelf"
            rel="noopener noreferrer"
          >
            <GitHubMark size={13} />
            GitHub
          </a>
          {' · '}
          <a href="https://shelfmcp.com">shelfmcp.com</a>
        </p>
      </div>
    </footer>
  )
}
