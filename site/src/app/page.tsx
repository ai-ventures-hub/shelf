import { AppTour } from '@/components/landing/AppTour'
import { CapabilityAskAnswer } from '@/components/landing/CapabilityAskAnswer'
import { FinalCta } from '@/components/landing/FinalCta'
import { GraveyardLedger } from '@/components/landing/GraveyardLedger'
import { HeroSection } from '@/components/landing/HeroSection'
import { HonestCards } from '@/components/landing/HonestCards'
import { ScrollReveals } from '@/components/landing/ScrollReveals'
import { SharedLibraryHub } from '@/components/landing/SharedLibraryHub'
import { SiteFooter } from '@/components/landing/SiteFooter'
import { SiteHeader } from '@/components/landing/SiteHeader'
import { SmartImportScan } from '@/components/landing/SmartImportScan'

/** Landing — the animated app tour leads, the story beats follow. */
export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main id="top">
        <HeroSection />
        <AppTour />
        <GraveyardLedger />
        <SmartImportScan />
        <HonestCards />
        <CapabilityAskAnswer />
        <SharedLibraryHub />
        <FinalCta />
      </main>
      <SiteFooter />
      <ScrollReveals />
    </>
  )
}
