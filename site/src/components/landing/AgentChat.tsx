import { CHAT_BUBBLES } from '@/lib/landing-content'
import { MCP_CLIENTS } from '@/lib/landing-demos'

/** Chip order differs from the MCP-tab card order: Claude Code leads here. */
const CHIP_ORDER = ['claude-code', 'claude-desktop', 'cursor', 'codex'] as const

/** #agents — copy + client chips beside the chat vignette. */
export function AgentChat() {
  const chips = CHIP_ORDER.map(
    (id) => MCP_CLIENTS.find((client) => client.id === id)!,
  )
  return (
    <section id="agents" className="section" aria-labelledby="agents-heading">
      <div className="section-inner chat-grid">
        <div className="chat-copy">
          <p className="eyebrow">Connected, not configured</p>
          <h2 id="agents-heading" className="sec-h2">
            Claude asks. Your shelf answers.
          </h2>
          <p className="sec-lead">
            Connect Claude Code, Claude Desktop, Cursor, or Codex in one click.
            They see the same library you do — launch your tools, check what’s
            running, find the right one for a job.
          </p>
          <div className="chat-chips">
            {chips.map((client) => (
              <span key={client.id} className="chat-chip">
                <img src={client.logo} alt="" width={16} height={16} />
                {client.chip}
              </span>
            ))}
          </div>
        </div>
        <div className="chat-panel" data-reveal>
          {CHAT_BUBBLES.map((bubble, i) => (
            <div key={i} className="chat-bubble" data-role={bubble.role}>
              {bubble.parts.map((part, j) =>
                'tone' in part && part.tone ? (
                  <span key={j} data-tone={part.tone}>
                    {part.text}
                  </span>
                ) : (
                  <span key={j}>{part.text}</span>
                ),
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
