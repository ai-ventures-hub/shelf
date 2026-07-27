import { IMPORT_FIELDS, IMPORT_STEPS } from '@/lib/landing-content'

/** Beat 03 — smart import: three steps beside the suggestion sheet. */
export function SmartImportScan() {
  return (
    <section id="import" className="section" aria-labelledby="import-heading">
      <div className="section-inner import-grid">
        <div className="import-copy">
          <div className="section-head">
            <p className="eyebrow">From folder to Shelf</p>
            <h2 id="import-heading">Point at the folder. Shelf remembers the ritual.</h2>
            <p className="section-lead">
              Smart import scans the project for scripts, ports, the package manager,
              and DESIGN.md — then proposes the whole registration. Accept what looks
              right.
            </p>
          </div>
          <ol className="import-steps">
            {IMPORT_STEPS.map((step) => (
              <li
                key={step.n}
                className="import-step"
                data-raised={step.raised ? 'true' : undefined}
              >
                <span className="import-step-n">{step.n}</span>
                <span className="import-step-copy">
                  <strong>{step.title}</strong>
                  <span>{step.sub}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div className="import-sheet">
          <div className="import-sheet-head">
            <span className="import-sheet-path">~/Projects/image-prepper</span>
            <span className="pill" data-tone="accent">
              Scanned
            </span>
          </div>
          <dl className="import-fields">
            {IMPORT_FIELDS.map((field) => (
              <div
                key={field.label}
                className="import-field"
                data-hi={field.hi ? 'true' : undefined}
              >
                <dt>{field.label}</dt>
                <dd data-mono={field.mono ? 'true' : undefined}>{field.value}</dd>
              </div>
            ))}
          </dl>
          <div className="import-sheet-actions" aria-hidden>
            <span className="mock-btn">Edit details</span>
            <span className="mock-btn mock-btn--primary">Add to library</span>
          </div>
        </div>
      </div>
    </section>
  )
}
