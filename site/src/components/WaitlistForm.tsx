'use client'

import { useState, useTransition } from 'react'
import { joinWaitlist, type WaitlistResult } from '@/lib/waitlist'

function statusCopy(result: WaitlistResult): { tone: string; text: string } {
  if (result.ok && result.status === 'joined') {
    return {
      tone: 'success',
      text: 'You are on the list. We will reach out when your invite is ready.',
    }
  }
  if (result.ok && result.status === 'already') {
    return {
      tone: 'warning',
      text: 'That email is already on the waitlist.',
    }
  }
  return {
    tone: 'danger',
    text: result.ok ? 'Something went wrong.' : result.message,
  }
}

/** Client waitlist form — request access for soft-launch invites. */
export function WaitlistForm() {
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<WaitlistResult | null>(null)

  return (
    <form
      className="waitlist-card"
      onSubmit={(event) => {
        event.preventDefault()
        const form = event.currentTarget
        const formData = new FormData(form)
        startTransition(async () => {
          const next = await joinWaitlist(formData)
          setResult(next)
          if (next.ok && next.status === 'joined') {
            form.reset()
          }
        })
      }}
    >
      <label className="waitlist-label" htmlFor="waitlist-email">
        Request access
      </label>
      <div className="waitlist-row">
        <input
          id="waitlist-email"
          className="waitlist-input"
          type="email"
          name="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          disabled={pending}
        />
        <button className="waitlist-submit" type="submit" disabled={pending}>
          {pending ? 'Sending…' : 'Request access'}
        </button>
      </div>
      <p className="waitlist-hint">
        Soft launch is invite-only. No account required once you have the app.
      </p>
      {result ? (
        <p className="waitlist-status" data-tone={statusCopy(result).tone} role="status">
          {statusCopy(result).text}
        </p>
      ) : null}
    </form>
  )
}
