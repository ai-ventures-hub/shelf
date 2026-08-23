import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const alt =
  'Shelf. You build the tools. Shelf keeps them. Your tools and your brand, served locally to your agents.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/** Social share card — brand tile, headline, guarantees. Satori-flexbox JSX. */
export default async function Image() {
  const [archivoExtraBold, archivoMedium] = await Promise.all([
    readFile(join(process.cwd(), 'assets/og/Archivo-ExtraBold.ttf')),
    readFile(join(process.cwd(), 'assets/og/Archivo-Medium.ttf')),
  ])

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '68px 80px',
          backgroundColor: '#090d16',
          backgroundImage:
            'radial-gradient(circle at 18% -20%, rgba(73, 98, 193, 0.38), rgba(9, 13, 22, 0) 60%)',
          fontFamily: 'Archivo',
        }}
      >
        {/* Primary lockup — icon 1H (76), gap 0.42H (32), wordmark 0.78H (59). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
          <div
            style={{
              width: 76,
              height: 76,
              borderRadius: 17,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundImage: 'linear-gradient(145deg, #9aafff, #526fdd)',
            }}
          >
            <svg viewBox="0 0 100 100" width="76" height="76">
              <path fill="#081021" d="M20 18h60v18H40v14H20V18z" />
              <path fill="#081021" d="M20 82h60V50H58v14H20V82z" />
            </svg>
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 59,
              fontWeight: 800,
              letterSpacing: '-1.8px',
              color: '#f7f8fc',
            }}
          >
            Shelf
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 30 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              fontSize: 96,
              fontWeight: 800,
              lineHeight: 1.02,
              letterSpacing: '-4.5px',
              color: '#f7f8fc',
            }}
          >
            <div style={{ display: 'flex' }}>You build the tools.</div>
            <div style={{ display: 'flex' }}>Shelf keeps them.</div>
          </div>
          <div
            style={{
              display: 'flex',
              maxWidth: 860,
              fontSize: 31,
              fontWeight: 500,
              lineHeight: 1.4,
              color: '#99a3b8',
            }}
          >
            One local library for your tools, and one source of truth for
            your brand, served honestly to your agents.
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', gap: 14 }}>
            {['Local-first', 'MIT-licensed', 'No account'].map((label) => (
              <div
                key={label}
                style={{
                  display: 'flex',
                  padding: '10px 22px',
                  borderRadius: 999,
                  border: '1.5px solid rgba(153, 163, 184, 0.3)',
                  fontSize: 24,
                  fontWeight: 500,
                  color: '#99a3b8',
                }}
              >
                {label}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', fontSize: 28, fontWeight: 500, color: '#9badff' }}>
            shelfmcp.com
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Archivo', data: archivoExtraBold, style: 'normal', weight: 800 },
        { name: 'Archivo', data: archivoMedium, style: 'normal', weight: 500 },
      ],
    },
  )
}
