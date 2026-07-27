import { AppShowcase } from '@/components/landing/AppShowcase'
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

/** Landing redesign — seven beats on the AI Ventures design language. */
export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main id="top">
        <HeroSection />
        <GraveyardLedger />
        <SmartImportScan />
        <HonestCards />
        <CapabilityAskAnswer />
        <SharedLibraryHub />
        <AppShowcase />
        <FinalCta />
      </main>
      <SiteFooter />
      <ScrollReveals />
    </>
  )
}
