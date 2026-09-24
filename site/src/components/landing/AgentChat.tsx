import Image from 'next/image'
import { MCP_CLIENTS } from '@/lib/landing-demos'
import { LandingVideo } from './LandingVideo'

/** Chip order differs from the MCP-tab card order: Claude Code leads here. */
const CHIP_ORDER = ['claude-code', 'claude-desktop', 'cursor', 'codex'] as const

/** #agents — copy + client chips beside a real agent-launch recording. */
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
            Your agent asks. Your shelf answers.
          </h2>
          <p className="sec-lead">
            Claude, Cursor, and Codex see the same library. They can launch
            what you already saved.
          </p>
          <div className="chat-chips">
            {chips.map((client) => (
              <span key={client.id} className="chat-chip">
                <Image src={client.logo} alt="" width={16} height={16} />
                {client.chip}
              </span>
            ))}
          </div>
        </div>
        <div data-reveal>
          <LandingVideo
            behavior="click"
            caption="Cursor asks Shelf to launch Image Polisher. Shelf starts it and returns the live URL."
            label="Shelf demo: Cursor asking Shelf to launch Image Polisher"
            playLabel="Watch an agent launch a tool"
            poster="/media/shelf-agent-launch-poster.webp"
            src="/media/shelf-agent-launch.mp4"
            variant="agent"
          />
        </div>
      </div>
    </section>
  )
}
