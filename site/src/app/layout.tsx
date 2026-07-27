import type { Metadata, Viewport } from 'next'
import { Archivo, Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'

/* Variable fonts — no `weight` option so the AV token scale (620/720/850)
   renders true instead of snapping to static weights. */
const archivo = Archivo({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-archivo',
})

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
})

export const metadata: Metadata = {
  title: 'Shelf — You build the tools. Shelf keeps them.',
  description:
    'One local library for every script, server, and one-off you ship — and a capability catalog your agents can query honestly. No cloud. No account.',
  metadataBase: new URL('https://shelfmcp.com'),
  openGraph: {
    title: 'Shelf — You build the tools. Shelf keeps them.',
    description:
      'One local library for every script, server, and one-off you ship — and a capability catalog your agents can query honestly. No cloud. No account.',
    url: 'https://shelfmcp.com',
    siteName: 'Shelf',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
  },
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
  },
}

export const viewport: Viewport = {
  themeColor: '#090d16',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${archivo.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body>{children}</body>
    </html>
  )
}
