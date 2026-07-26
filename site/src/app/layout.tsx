import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Shelf — Local tools your agents can find',
  description:
    'A personal command center for the tools you build. Launch locally, share one library with your agents, and discover capabilities with honest readiness. macOS Community soft launch.',
  metadataBase: new URL('https://shelfmcp.com'),
  openGraph: {
    title: 'Shelf — Local tools your agents can find',
    description:
      'Organize and launch local tools—and let agents discover the right capability, or record an honest gap.',
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
