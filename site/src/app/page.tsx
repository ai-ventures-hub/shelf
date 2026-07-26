import { HeroSection } from '@/components/landing/HeroSection'
import { NarrativeSections } from '@/components/landing/NarrativeSections'
import { SiteFooter } from '@/components/landing/SiteFooter'
import { SiteHeader } from '@/components/landing/SiteHeader'

/** Vision Phase 2 — interactive Capability Intelligence demo + narrative. */
export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main id="top" className="site-main site-main--vision">
        <HeroSection />
        <NarrativeSections />
      </main>
      <SiteFooter />
    </>
  )
}
