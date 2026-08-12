import { BrandSwitcher } from './BrandSwitcher'
import { DESIGN_POINTS } from '@/lib/landing-content'

/**
 * #design — the 1.0 Design Engine story. Copy stays server-rendered and
 * rides into the client BrandSwitcher as children (it owns the segmented
 * control + mock window). Shelf serves brand truth; agents do the styling —
 * the copy must never claim otherwise.
 */
export function DesignEngine() {
  return (
    <section id="design" className="section" data-well aria-labelledby="design-heading">
      <div className="section-inner be-grid">
        <BrandSwitcher>
          <p className="eyebrow" data-reveal>
            New in 1.0 · Design Engine
          </p>
          <h2 id="design-heading" className="sec-h2" data-reveal>
            Stop pasting your hex codes.
          </h2>
          <p className="sec-lead" data-reveal>
            Design profiles keep your colors, type, and voice in one local file.
            Any connected agent can ask for them — and build the next tool to
            match. Shelf serves the truth. The agent does the styling.
          </p>
          <ul className="be-points" data-reveal>
            {DESIGN_POINTS.map((point) => (
              <li key={point.title}>
                <strong>{point.title}</strong> {point.body}
              </li>
            ))}
          </ul>
          <p className="mcp-verbs be-verb" data-reveal>
            “build it with my branding” → shelf_get_design_profile
          </p>
        </BrandSwitcher>
      </div>
    </section>
  )
}
