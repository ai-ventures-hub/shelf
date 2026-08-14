import { getSql } from '@/lib/db'

/**
 * First-launch onboarding submissions from the Shelf desktop app.
 * Called once per install by the Electron main process (net.fetch — no
 * browser origin, so no CORS headers). The app treats 4xx as "drop the
 * payload" and network errors / 5xx as "queue and retry next launch".
 *
 * Abuse control: a Neon-backed per-IP throttle (in-memory counters are
 * useless on serverless). Fail-open — a broken throttle must never block
 * a legitimate one-per-install submission. A 429 is a 4xx, so a throttled
 * client drops its payload; the cap is generous enough that only bulk
 * spam ever sees it.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_BODY_BYTES = 10_240
const RATE_LIMIT_PER_HOUR = 5

async function hashClientIp(request: Request): Promise<string> {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** True when this IP is over the hourly cap. Errors report "not limited". */
async function isRateLimited(ipHash: string): Promise<boolean> {
  try {
    const sql = getSql()
    await sql`
      CREATE TABLE IF NOT EXISTS onboarding_throttle (
        ip_hash text NOT NULL,
        submitted_at timestamptz NOT NULL DEFAULT now()
      )
    `
    const rows = (await sql`
      SELECT count(*)::int AS n FROM onboarding_throttle
      WHERE ip_hash = ${ipHash} AND submitted_at > now() - interval '1 hour'
    `) as Array<{ n: number }>
    if ((rows[0]?.n ?? 0) >= RATE_LIMIT_PER_HOUR) return true
    await sql`INSERT INTO onboarding_throttle (ip_hash) VALUES (${ipHash})`
    // Opportunistic pruning keeps the table tiny without a scheduled job.
    await sql`DELETE FROM onboarding_throttle WHERE submitted_at < now() - interval '7 days'`
    return false
  } catch (error) {
    console.error('onboarding throttle unavailable', error)
    return false
  }
}

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > maxLength) return null
  return trimmed
}

export async function POST(request: Request) {
  // Reject oversized payloads from the declared length before buffering the
  // body at all (chunked requests without a length still hit the cap below).
  const declaredLength = Number(request.headers.get('content-length') || '0')
  if (!Number.isFinite(declaredLength) || declaredLength > MAX_BODY_BYTES) {
    return Response.json({ ok: false }, { status: 413 })
  }

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

  // Validation is cheap CPU; the throttle costs a DB round trip — check it
  // only for payloads that would otherwise be inserted.
  if (await isRateLimited(await hashClientIp(request))) {
    return Response.json({ ok: false }, { status: 429 })
  }

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
