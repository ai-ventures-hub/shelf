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
    'A home for every tool you build. Launch them yourself—or let your AI agents handle it. macOS Community soft launch.',
  metadataBase: new URL('https://shelfmcp.com'),
  openGraph: {
    title: 'Shelf — The Local Tool Hub for AI Agents',
    description:
      'A home for every tool you build. Launch them yourself—or let your AI agents handle it.',
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
