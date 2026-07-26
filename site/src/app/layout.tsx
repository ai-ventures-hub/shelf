import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Shelf — The Local Tool Hub for AI Agents',
  description:
    'A personal command center for the tools you build. Organize, launch, and share a local library with your AI agents. macOS Community soft launch.',
  metadataBase: new URL('https://shelfmcp.com'),
  openGraph: {
    title: 'Shelf — The Local Tool Hub for AI Agents',
    description:
      'A personal command center for the tools you build—and a library your AI agents can operate with you.',
    url: 'https://shelfmcp.com',
    siteName: 'Shelf',
    type: 'website',
  },
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  )
}
