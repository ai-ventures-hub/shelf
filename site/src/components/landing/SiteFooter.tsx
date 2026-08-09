/** Single-row footer, plus the brand-mark attribution the 0.7.0 logos require. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <span>Shelf · macOS · MIT · © {new Date().getFullYear()}</span>
        <span>
          <a href="https://github.com/ai-ventures-hub/shelf" rel="noopener noreferrer">
            GitHub
          </a>{' '}
          · <a href="mailto:support@shelfmcp.com">support@shelfmcp.com</a>
        </span>
      </div>
      <p className="footer-attribution">
        Claude and Claude Code are trademarks of Anthropic; Cursor of Anysphere;
        Codex of OpenAI. Marks appear only to indicate compatibility.
      </p>
    </footer>
  )
}
