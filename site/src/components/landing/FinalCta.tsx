import Link from 'next/link'
import { GitHubMark } from '@/components/GitHubMark'
import { RECEIPT_FACTS, RECEIPT_FILES } from '@/lib/landing-content'

/** Beat 07 — local-first facts as a manifest, the download CTA beside it. */
export function FinalCta() {
  return (
    <section id="access" className="section section--final" aria-labelledby="access-heading">
      <div className="section-inner final-grid">
        <div className="receipt" data-reveal style={{ '--reveal-order': 1 } as React.CSSProperties}>
          <p className="receipt-title">Everything Shelf knows lives here</p>
          <p className="receipt-path">~/Library/Application Support/Shelf/</p>
          <ul className="receipt-list receipt-list--files">
            {RECEIPT_FILES.map((file) => (
              <li key={file.name}>
                <span>{file.name}</span> <span className="receipt-note">— {file.note}</span>
              </li>
            ))}
          </ul>
          <hr className="receipt-rule" />
          <ul className="receipt-list">
            {RECEIPT_FACTS.map((fact) => (
              <li key={fact.name}>
                <span>{fact.name}</span> <span className="receipt-note">— {fact.note}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="final-copy" data-reveal>
          <p className="eyebrow">Soft launch</p>
          <h2 id="access-heading" className="final-title">
            Stop losing the tools you build.
          </h2>
          <p className="section-lead">
            macOS Community is free — grab the DMG, drag it in, and shelve your
            first tool in a minute.
          </p>
          <div className="final-cta-row">
            <Link className="btn-primary" href="/download">
              Download — It’s free
            </Link>
            <span className="final-cta-note">Apple Silicon · no account required</span>
          </div>
          <p className="final-links">
            <a href="#demo">Take the interactive tour →</a>
            <a
              className="link-with-mark"
              href="https://github.com/ai-ventures-hub/shelf"
              rel="noopener noreferrer"
            >
              <GitHubMark size={14} />
              View the source
            </a>
          </p>
        </div>
      </div>
    </section>
  )
}
