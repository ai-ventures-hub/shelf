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

/** Structured data — free macOS developer app; richer search listings. */
const SOFTWARE_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Shelf',
  operatingSystem: 'macOS',
  applicationCategory: 'DeveloperApplication',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  license: 'https://opensource.org/licenses/MIT',
  url: 'https://shelfmcp.com',
  downloadUrl: 'https://shelfmcp.com/download',
  description:
    'A local tool library for macOS. Keep every script, server, and one-off you build, launch them in a click, and share them honestly with your AI agents over MCP. No cloud, no account.',
}

/** Landing — the animated app tour leads, the story beats follow. */
export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SOFTWARE_JSON_LD) }}
      />
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
