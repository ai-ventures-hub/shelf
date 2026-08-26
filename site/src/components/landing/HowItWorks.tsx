import { HOW_CARDS } from '@/lib/landing-content'
import { LandingVideo } from './LandingVideo'

/** #how — real drop-to-run footage framed by the promise and three steps. */
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
        <LandingVideo
          behavior="auto-once"
          caption="A real project folder goes onto Shelf and comes back as a running tool, with its launch command and port remembered."
          label="Shelf demo: dragging a project folder into the library and launching it"
          playLabel="Play the drop-to-run demo"
          poster="/media/shelf-drop-and-run-poster.webp"
          src="/media/shelf-drop-and-run.mp4"
          variant="how"
        />
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
