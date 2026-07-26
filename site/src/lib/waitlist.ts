'use server'

import { getSql } from './db'

export type WaitlistResult =
  | { ok: true; status: 'joined' }
  | { ok: true; status: 'already' }
  | { ok: false; status: 'invalid' | 'error'; message: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Validate and insert a waitlist signup.
 * Unique emails return "already" instead of an error so the UI can stay calm.
 */
export async function joinWaitlist(formData: FormData): Promise<WaitlistResult> {
  const raw = String(formData.get('email') ?? '').trim().toLowerCase()

  if (!raw || raw.length > 254 || !EMAIL_RE.test(raw)) {
    return {
      ok: false,
      status: 'invalid',
      message: 'Enter a valid email address.',
    }
  }

  try {
    const sql = getSql()
    const rows = await sql`
      INSERT INTO waitlist_signups (email, source)
      VALUES (${raw}, 'landing')
      ON CONFLICT (email) DO NOTHING
      RETURNING id
    `

    if (Array.isArray(rows) && rows.length > 0) {
      return { ok: true, status: 'joined' }
    }
    return { ok: true, status: 'already' }
  } catch (err) {
    console.error('waitlist insert failed', err instanceof Error ? err.message : err)
    return {
      ok: false,
      status: 'error',
      message: 'Could not save your request. Try again in a moment.',
    }
  }
}
