/**
 * Delivers the one-time first-launch survey to shelfmcp.com — the only
 * user-data network call Shelf makes (see docs/PRODUCT.md). Delivery is
 * silent and best-effort: failures queue the payload in prefs.json and
 * retry on the next launch; the user is never blocked or notified.
 */
import { app, net } from 'electron'
import type { PrefsStore } from '../shared/prefs-store'
import type { OnboardingSubmission, OnboardingSubmissionInput } from '../shared/types'

const ENDPOINT = 'https://shelfmcp.com/api/onboarding'
const TIMEOUT_MS = 8000

/**
 * Stamp and deliver a submission in the background.
 * Returns immediately so the renderer can finish onboarding offline.
 */
export function submitOnboarding(
  prefs: PrefsStore,
  input: OnboardingSubmissionInput,
): { appVersion: string } {
  const submission: OnboardingSubmission = {
    ...input,
    appVersion: app.getVersion(),
    platform: `${process.platform}-${process.arch}`,
    submittedAt: new Date().toISOString(),
  }
  void deliver(prefs, submission)
  return { appVersion: submission.appVersion }
}

/** Retry a submission that was captured while offline. */
export function flushPendingOnboarding(prefs: PrefsStore): void {
  const pending = prefs.get().pendingOnboardingSubmission
  if (!pending) return
  void deliver(prefs, pending)
}

async function deliver(prefs: PrefsStore, submission: OnboardingSubmission) {
  try {
    const response = await net.fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(submission),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (response.ok || (response.status >= 400 && response.status < 500)) {
      // Delivered — or rejected as malformed, which retrying cannot fix.
      prefs.update({ pendingOnboardingSubmission: undefined })
      return
    }
    queue(prefs, submission)
  } catch {
    queue(prefs, submission)
  }
}

function queue(prefs: PrefsStore, submission: OnboardingSubmission) {
  try {
    prefs.update({ pendingOnboardingSubmission: submission })
  } catch {
    // Losing one survey beats surfacing an error at first launch.
  }
}
