import { useMemo, useState } from 'react'
import {
  CLIENTS,
  SHELF_URL_EXAMPLES,
  type ClientId,
} from '../../lib/mcpClientGuides'

const ADVANCED_KEY = 'shelf.mcp.advancedOpen'

/** Stroke chevron matching sidebar NavIcon weight — unicode ▸/▾ is too faint. */
function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className="mcp-advanced-chevron"
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {open ? (
        <path d="M6 9l6 6 6-6" />
      ) : (
        <path d="M9 6l6 6-6 6" />
      )}
    </svg>
  )
}

export function McpAdvancedPanel({
  serverPath,
  configPaths,
}: {
  serverPath: string
  configPaths: { claude?: string; cursor?: string; codex?: string }
}) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(ADVANCED_KEY) === '1'
    } catch {
      return false
    }
  })
  const [guideId, setGuideId] = useState<ClientId>('claude')
  const [copied, setCopied] = useState<string | null>(null)

  const guide = useMemo(
    () => CLIENTS.find((c) => c.id === guideId) || CLIENTS[0],
    [guideId],
  )

  function toggle() {
    setOpen((prev) => {
      const next = !prev
      try {
        localStorage.setItem(ADVANCED_KEY, next ? '1' : '0')
      } catch {
        // ignore
      }
      return next
    })
  }

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
      window.setTimeout(() => setCopied(null), 1600)
    } catch {
      setCopied('failed')
    }
  }

  return (
    <section className="mcp-advanced">
      <button
        type="button"
        className="mcp-advanced-toggle"
        aria-expanded={open}
        onClick={toggle}
      >
        <span>Advanced</span>
        <ChevronIcon open={open} />
      </button>

      {open ? (
        <div className="mcp-advanced-body stack">
          <div>
            <h3 className="mcp-advanced-heading">MCP server endpoint</h3>
            <pre className="code-block">{serverPath}</pre>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => void copy('path', serverPath)}
            >
              {copied === 'path' ? 'Copied' : 'Copy path'}
            </button>
          </div>

          <div>
            <h3 className="mcp-advanced-heading">Config file locations</h3>
            <ul className="mcp-advanced-list">
              {configPaths.claude ? (
                <li>
                  <strong>Claude</strong> — <code>{configPaths.claude}</code>
                </li>
              ) : null}
              {configPaths.cursor ? (
                <li>
                  <strong>Cursor</strong> — <code>{configPaths.cursor}</code>
                </li>
              ) : null}
              {configPaths.codex ? (
                <li>
                  <strong>Codex</strong> — <code>{configPaths.codex}</code>
                </li>
              ) : null}
            </ul>
          </div>

          <div>
            <h3 className="mcp-advanced-heading">
              <code>shelf://</code> deep links
            </h3>
            <ul className="mcp-advanced-list">
              {SHELF_URL_EXAMPLES.map((row) => (
                <li key={row.url}>
                  <code>{row.url}</code>
                  <span className="shelf-url-hint"> — {row.hint}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() =>
                void copy(
                  'urls',
                  SHELF_URL_EXAMPLES.map((r) => r.url).join('\n'),
                )
              }
            >
              {copied === 'urls' ? 'Copied' : 'Copy examples'}
            </button>
          </div>

          <div>
            <h3 className="mcp-advanced-heading">Manual client setup</h3>
            <div className="mcp-advanced-guides">
              <div className="mcp-advanced-guide-tabs" role="tablist" aria-label="Clients">
                {CLIENTS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="tab"
                    aria-selected={guideId === c.id}
                    className={`mcp-guide-tab${guideId === c.id ? ' is-active' : ''}`}
                    onClick={() => setGuideId(c.id)}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
              <ol className="mcp-steps">
                {guide.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <div className="field-label">{guide.configLabel}</div>
              <pre className="code-block">{guide.config(serverPath)}</pre>
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                onClick={() => void copy('config', guide.config(serverPath))}
              >
                {copied === 'config' ? 'Copied' : 'Copy config'}
              </button>
            </div>
          </div>

          <div>
            <h3 className="mcp-advanced-heading">Available MCP tools</h3>
            <ul className="mcp-advanced-list">
              <li>
                <code>shelf_list_tools</code> — library overview + status
              </li>
              <li>
                <code>shelf_upsert_tool</code> / <code>shelf_launch_tool</code> — register &amp; run
              </li>
              <li>
                <code>shelf_get_status</code> / <code>shelf_get_logs</code> — inspect runs
              </li>
              <li>
                <code>shelf_list_receipts</code> — launch history
              </li>
              <li>
                <code>shelf_get_design_md</code> — project DESIGN.md bridge
              </li>
            </ul>
          </div>

          {copied === 'failed' ? (
            <div className="warning-card" role="alert">
              Clipboard copy failed. Select the text and copy manually.
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
