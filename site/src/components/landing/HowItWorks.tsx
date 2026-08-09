import { HOW_CARDS } from '@/lib/landing-content'
import { DropDemo } from './DropDemo'

/** #how — the drop-demo loop framed by the promise and the three steps. */
export function HowItWorks() {
  return (
    <section id="how" className="section" data-well aria-labelledby="how-heading">
      <div className="section-inner how-inner">
        <div className="how-head" data-reveal>
          <p className="eyebrow">How it works</p>
          <h2 id="how-heading" className="sec-h2">
            You built it with AI. Now it just runs.
          </h2>
          <p className="sec-lead">
            Drop the project folder onto Shelf. It figures out how the thing
            runs, installs what’s missing, starts it. No terminal. No config
            files. No <strong>“what’s a port?”</strong>
          </p>
        </div>
        <DropDemo />
        <div className="how-cards">
          {HOW_CARDS.map((card, i) => (
            <div
              key={card.n}
              className="how-card"
              data-reveal
              style={{ '--reveal-order': i } as React.CSSProperties}
            >
              <div className="how-card-n">{card.n}</div>
              <div className="how-card-title">{card.title}</div>
              <p>{card.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
