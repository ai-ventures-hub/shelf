import { HONEST_CARDS } from '@/lib/landing-content'

/** Beat 04 — three tool cards that tell the truth twice. */
export function HonestCards() {
  return (
    <section id="launch" className="section" aria-labelledby="launch-heading">
      <div className="section-inner">
        <div className="section-head">
          <p className="eyebrow">Launch without the ritual</p>
          <h2 id="launch-heading">Every tool tells the truth twice.</h2>
          <p className="section-lead">
            Once about its process — Starting, Running, Stopped. Once about agent
            access — ready, needs setup, or manual only. Open the URL, watch live
            logs, stop when done.
          </p>
        </div>
        <ul className="honest-grid">
          {HONEST_CARDS.map((card) => (
            <li key={card.name} className="honest-card" data-edge={card.edge}>
              <div className="honest-card-top">
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
