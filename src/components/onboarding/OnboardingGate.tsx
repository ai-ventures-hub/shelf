import { lazy, Suspense, type ReactNode } from 'react'
import { usePrefs } from '../../hooks/usePrefs'

// First launch only: the flow's code loads when it is actually needed.
const OnboardingFlow = lazy(() =>
  import('./OnboardingFlow').then((module) => ({ default: module.OnboardingFlow })),
)

/** Blocks the app with the onboarding flow until it has run once. */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const { prefs, loading, error, refresh } = usePrefs()
  // Browser dev (no preload bridge): the gate is off.
  if (typeof window !== 'undefined' && !window.shelf) return <>{children}</>
  if (loading) return <p role="status">Loading preferences…</p>
  if (error && !prefs.onboardingCompletedVersion) return <div className="empty-state"><div><p role="alert">{error}</p><button className="btn" onClick={() => void refresh()}>Retry preferences</button></div></div>
  if (!prefs.onboardingCompletedVersion) {
    return (
      <Suspense fallback={<p role="status">Loading welcome…</p>}>
        <OnboardingFlow />
      </Suspense>
    )
  }
  return <>{children}</>
}
