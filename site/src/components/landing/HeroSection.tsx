import { ShelfMark } from '@/components/ShelfMark'
import { WaitlistForm } from '@/components/WaitlistForm'
import { DualDemo } from './DualDemo'

/** Brand-first hero + waitlist + interactive dual-surface demo. */
export function HeroSection() {
  return (
    <section className="hero hero--vision" aria-labelledby="hero-heading">
      <div className="hero-intro">
        <div className="hero-brand">
          <ShelfMark />
          <p className="hero-eyebrow">Shelf</p>
        </div>
        <h1 id="hero-heading" className="hero-title">
          A personal command center for the tools you build.
        </h1>
        <p className="hero-support">
          One home for every local tool—and a capability catalog so your agents
          find the right one, honestly.
        </p>
        <div className="hero-cta-row">
          <a className="btn-quiet" href="#demo">
            See how it works
          </a>
          <a
            className="btn-quiet"
            href="https://github.com/ai-ventures-hub/shelf"
            rel="noopener noreferrer"
          >
            View on GitHub
          </a>
        </div>
        <WaitlistForm inputId="waitlist-email-hero" />
      </div>
      <DualDemo />
    </section>
  )
}
