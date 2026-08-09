import { HONEST_CARDS } from '@/lib/landing-content'

/** Three tool cards that tell the truth twice — process and agent access. */
export function HonestCards() {
  return (
    <section className="section" data-well aria-labelledby="launch-heading">
      <div className="section-inner honest-head">
        <p className="eyebrow">Launch without the ritual</p>
        <h2 id="launch-heading" className="sec-h2">
          Every tool tells the truth twice.
        </h2>
        <p className="sec-lead">
          Once about its process — Starting, Running, Stopped. Once about agent
          access — ready, needs setup, or manual only. Open the URL, watch live
          logs, stop when done.
        </p>
        <ul className="honest-grid">
          {HONEST_CARDS.map((card, i) => (
            <li
              key={card.id}
              className="honest-card"
              data-edge={card.edge}
              data-reveal
              style={{ '--reveal-order': i } as React.CSSProperties}
            >
              <div className="honest-card-top">
                <span className="lt lt--md" aria-hidden>
                  {card.letter}
                </span>
                <strong>{card.name}</strong>
                <span className="pill" data-tone={card.statusTone}>
                  {card.status}
                </span>
              </div>
              <span className="honest-card-line">{card.line}</span>
              <p>{card.body}</p>
              <div className="honest-card-foot">
                <span
                  className="pill"
                  data-tone={card.readinessTone}
                  data-fill={card.readinessTone === 'neutral' ? undefined : ''}
                  title="Agent readiness — separate from process status"
                >
                  {card.readiness}
                </span>
                <span className="honest-card-action" aria-hidden>
                  {card.action}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
