import { BrandSwitcher } from './BrandSwitcher'

/**
 * #design — headline, one line, then the live profile switcher.
 * The window already shows swatches, type, and voice, so this column
 * does not restate them. Copy stays server-rendered and rides into the
 * client BrandSwitcher as children. Agents can read a profile. They
 * do not set the default.
 */
export function DesignEngine() {
  return (
    <section id="design" className="section" data-well aria-labelledby="design-heading">
      <div className="section-inner be-grid">
        <BrandSwitcher>
          <p className="eyebrow" data-reveal>
            Your brand, on the shelf
          </p>
          <h2 id="design-heading" className="sec-h2" data-reveal>
            Stop pasting your hex codes.
          </h2>
          <p className="sec-lead" data-reveal>
            One local file holds the colors, type, and voice. An agent can
            read it. You keep the default.
          </p>
        </BrandSwitcher>
      </div>
    </section>
  )
}
