import type { Metadata } from 'next'
import { ArrowRight, FolderOpen, Rocket } from 'lucide-react'
import { AutoDownload } from '@/components/download/AutoDownload'
import { SiteFooter } from '@/components/landing/SiteFooter'
import { SiteHeader } from '@/components/landing/SiteHeader'
import { ShelfMark } from '@/components/ShelfMark'
import { DOWNLOAD_DMG_URL, DOWNLOAD_ZIP_URL, RELEASES_URL } from '@/lib/download'

export const metadata: Metadata = {
  title: 'Download Shelf for macOS',
  description:
    'Shelf is downloading. Open the DMG, drag Shelf into Applications, and launch. Free, signed and notarized, Apple Silicon.',
}

const STEPS = [
  {
    n: 'Step 1',
    title: 'Open',
    body: 'Open Shelf-arm64.dmg from your browser’s downloads.',
    visual: 'dmg',
  },
  {
    n: 'Step 2',
    title: 'Install',
    body: 'Drag Shelf into the Applications folder.',
    visual: 'drag',
  },
  {
    n: 'Step 3',
    title: 'Launch',
    body: 'Open Spotlight, type Shelf, and press return.',
    visual: 'launch',
  },
] as const

function StepVisual({ kind }: { kind: string }) {
  if (kind === 'dmg') {
    return (
      <div className="download-visual">
        <span className="download-dmg-chip">
          <ShelfMark className="brand-mark brand-mark--sm" />
          Shelf-arm64.dmg
        </span>
      </div>
    )
  }
  if (kind === 'drag') {
    return (
      <div className="download-visual" aria-hidden>
        <ShelfMark className="brand-mark" />
        <ArrowRight size={20} />
        <span className="download-folder">
          <FolderOpen size={22} />
          Applications
        </span>
      </div>
    )
  }
  return (
    <div className="download-visual" aria-hidden>
      <span className="download-spotlight">
        <Rocket size={15} />
        Shelf
      </span>
    </div>
  )
}

export default function DownloadPage() {
  return (
    <>
      <SiteHeader />
      <main className="download-main">
        <div className="download-head">
          <h1>
            Shelf is downloading.
            <br />
            Just a few steps left.
          </h1>
          <p>
            Your download starts automatically. If it didn’t,{' '}
            <a href={DOWNLOAD_DMG_URL}>download Shelf manually</a>.
          </p>
        </div>
        <ol className="download-steps">
          {STEPS.map((step) => (
            <li key={step.title} className="download-step">
              <p className="download-step-n">{step.n}</p>
              <h2>{step.title}</h2>
              <p className="download-step-body">{step.body}</p>
              <StepVisual kind={step.visual} />
            </li>
          ))}
        </ol>
        <p className="download-fine">
          Signed and notarized, so no security warnings. Requires an Apple
          Silicon Mac (M1 or later). Free, MIT-licensed, no account.
        </p>
        <p className="download-alt">
          Prefer an archive? <a href={DOWNLOAD_ZIP_URL}>Download the .zip</a> · or
          browse <a href={RELEASES_URL} rel="noopener noreferrer">all releases</a>.
        </p>
        <p className="download-alt">
          Stuck on a step?{' '}
          <a href="mailto:support@shelfmcp.com">support@shelfmcp.com</a>. A
          human reads it.
        </p>
      </main>
      <SiteFooter />
      <AutoDownload />
    </>
  )
}
