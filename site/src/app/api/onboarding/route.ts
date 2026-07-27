import { getSql } from '@/lib/db'

/**
 * First-launch onboarding submissions from the Shelf desktop app.
 * Called once per install by the Electron main process (net.fetch — no
 * browser origin, so no CORS headers). The app treats 4xx as "drop the
 * payload" and network errors / 5xx as "queue and retry next launch".
 *
 * Rate limiting deliberately deferred: volume is one POST per install and
 * serverless in-memory counters are useless; revisit with a shared store
 * if abuse ever shows up.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_BODY_BYTES = 10_240

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > maxLength) return null
  return trimmed
}

export async function POST(request: Request) {
  let raw: string
  try {
    raw = await request.text()
  } catch {
    return Response.json({ ok: false }, { status: 400 })
  }
  if (raw.length === 0 || raw.length > MAX_BODY_BYTES) {
    return Response.json({ ok: false }, { status: 400 })
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return Response.json({ ok: false }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null) {
    return Response.json({ ok: false }, { status: 400 })
  }
  const input = body as Record<string, unknown>

  const name = cleanString(input.name, 120)
  const emailRaw = cleanString(input.email, 254)
  const email = emailRaw ? emailRaw.toLowerCase() : null
  if (email && !EMAIL_RE.test(email)) {
    return Response.json({ ok: false }, { status: 400 })
  }

  const answersIn =
    typeof input.answers === 'object' && input.answers !== null
      ? (input.answers as Record<string, unknown>)
      : {}
  const agents = Array.isArray(answersIn.agents)
    ? answersIn.agents
        .filter((a): a is string => typeof a === 'string')
        .map((a) => a.trim())
        .filter((a) => a.length > 0 && a.length <= 80)
        .slice(0, 10)
    : []
  // Rebuild a clean object — never insert raw client input.
  const answers = {
    firstShelve: cleanString(answersIn.firstShelve, 120),
    persona: cleanString(answersIn.persona, 120),
    heardFrom: cleanString(answersIn.heardFrom, 120),
    agents,
    skippedContact: input.skippedContact === true,
  }

  const appVersion = cleanString(input.appVersion, 40)
  const platform = cleanString(input.platform, 40)

  try {
    const sql = getSql()
    await sql`
      INSERT INTO onboarding_responses (name, email, app_version, platform, answers)
      VALUES (${name}, ${email}, ${appVersion}, ${platform}, ${JSON.stringify(answers)}::jsonb)
    `
    return Response.json({ ok: true })
  } catch (error) {
    console.error('onboarding insert failed', error)
    return Response.json({ ok: false }, { status: 500 })
  }
}
