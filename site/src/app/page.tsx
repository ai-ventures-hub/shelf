import { AgentChat } from '@/components/landing/AgentChat'
import { AppShowcase } from '@/components/landing/AppShowcase'
import { DevMode } from '@/components/landing/DevMode'
import { FinalCta } from '@/components/landing/FinalCta'
import { HeroScrollStage } from '@/components/landing/HeroScrollStage'
import { HonestCards } from '@/components/landing/HonestCards'
import { HowItWorks } from '@/components/landing/HowItWorks'
import { ScrollReveals } from '@/components/landing/ScrollReveals'
import { SiteFooter } from '@/components/landing/SiteFooter'
import { SiteHeader } from '@/components/landing/SiteHeader'

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

/** Landing v2 — the scroll-scrubbed hero leads, the story beats follow. */
export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SOFTWARE_JSON_LD) }}
      />
      <SiteHeader />
      <main id="top">
        <HeroScrollStage />
        <HowItWorks />
        <AppShowcase />
        <HonestCards />
        <AgentChat />
        <DevMode />
        <FinalCta />
      </main>
      <SiteFooter />
      <ScrollReveals />
    </>
  )
}
