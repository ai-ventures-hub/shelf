import Link from 'next/link'
import { HeroDemo } from './HeroDemo'

/** Beat 01 — command deck: editorial left, live agent↔Shelf demo right. */
export function HeroSection() {
  return (
    <section className="hero" aria-labelledby="hero-heading">
      <div className="hero-copy">
        <p className="eyebrow">Local tool library · macOS</p>
        <h1 id="hero-heading" className="hero-title">
          You <span className="hw-build">build</span> the{' '}
          <span className="hw-tools">tools</span>.
          <br />
          <span className="hw-shelf">Shelf</span>
          <br />
          keeps them.
        </h1>
        <p className="hero-support">
          One local library for every script, server, and one-off you ship — and a
          capability catalog your agents can query honestly. No cloud. No account.
        </p>
        <div className="hero-cta">
          <Link className="btn-primary" href="/download">
            Download — It’s free
          </Link>
          <a className="btn-ghost" href="#demo">
            See how it works
          </a>
        </div>
        <p className="hero-fine">
          Free · macOS (Apple Silicon) · MIT-licensed · your data stays on your Mac
        </p>
      </div>
      <HeroDemo />
    </section>
  )
}
