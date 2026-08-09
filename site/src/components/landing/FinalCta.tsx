import Link from 'next/link'

/** Final CTA — centered on the faint indigo top-gradient. */
export function FinalCta() {
  return (
    <section className="final-section" aria-labelledby="final-heading">
      <div className="section-inner final-inner">
        <h2 id="final-heading" className="sec-h2" data-reveal>
          Give your builds a place to live.
        </h2>
        <div className="final-cta-row" data-reveal>
          <Link className="btn-primary" href="/download">
            Download — It’s free
          </Link>
          <a
            className="btn-ghost"
            href="https://github.com/ai-ventures-hub/shelf"
            rel="noopener noreferrer"
          >
            View the source
          </a>
        </div>
        <p className="final-fine">
          macOS · MIT · local-first · your data stays on your Mac · no account,
          ever
        </p>
      </div>
    </section>
  )
}
