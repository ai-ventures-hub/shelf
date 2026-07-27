import { WaitlistForm } from '@/components/WaitlistForm'
import { RECEIPT_FACTS, RECEIPT_FILES } from '@/lib/landing-content'

/** Beat 07 — local-first facts as a manifest, the waitlist CTA beside it. */
export function FinalCta() {
  return (
    <section id="access" className="section section--final" aria-labelledby="access-heading">
      <div className="section-inner final-grid">
        <div className="receipt">
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
        <div className="final-copy">
          <p className="eyebrow">Soft launch</p>
          <h2 id="access-heading" className="final-title">
            Stop losing the tools you build.
          </h2>
          <p className="section-lead">
            macOS Community is invite-only while we finish the public soft launch.
            Request access, take the tour, or read the source.
          </p>
          <WaitlistForm inputId="waitlist-email-final" className="waitlist-form" />
          <p className="final-links">
            <a href="#demo">Take the interactive tour →</a>
            <a href="https://github.com/ai-ventures-hub/shelf" rel="noopener noreferrer">
              View the source
            </a>
          </p>
        </div>
      </div>
    </section>
  )
}
