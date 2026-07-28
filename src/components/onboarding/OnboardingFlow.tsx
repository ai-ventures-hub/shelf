/**
 * One-time first-launch onboarding. Fully skippable — finishing (or skipping
 * through) marks prefs.onboardingCompletedVersion and sends the survey once
 * via the main process (see electron/onboarding-relay.ts). Never blocks on
 * the network and never shows a delivery error.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { usePrefs } from '../../hooks/usePrefs'
import type { OnboardingSubmissionInput } from '../../types'
import { ShelfMark } from '../ShelfMark'
import { OnboardingStep } from './OnboardingStep'
import { CHOICE_STEPS, TOTAL_STEPS, type ChoiceAnswerKey } from './steps'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Answers = Record<ChoiceAnswerKey, string[]>

const EMPTY_ANSWERS: Answers = {
  firstShelve: [],
  persona: [],
  heardFrom: [],
  agents: [],
}

export function OnboardingFlow() {
  const { updatePrefs } = usePrefs()
  const [stepIndex, setStepIndex] = useState(0)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState(false)
  const [answers, setAnswers] = useState<Answers>(EMPTY_ANSWERS)
  const [finishing, setFinishing] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (stepIndex === 0) headingRef.current?.focus()
  }, [stepIndex])

  async function finish(finalAnswers: Answers, skippedContact: boolean) {
    if (finishing) return
    setFinishing(true)
    const trimmedEmail = email.trim().toLowerCase()
    const input: OnboardingSubmissionInput = {
      name: skippedContact ? undefined : name.trim() || undefined,
      email: skippedContact ? undefined : trimmedEmail || undefined,
      answers: {
        firstShelve: finalAnswers.firstShelve[0],
        persona: finalAnswers.persona[0],
        heardFrom: finalAnswers.heardFrom[0],
        agents: finalAnswers.agents,
      },
      skippedContact: skippedContact || !trimmedEmail,
    }
    let version = 'unknown'
    try {
      const result = await window.shelf.submitOnboarding(input)
      version = result.appVersion
    } catch {
      // Delivery is best-effort; never trap the user in onboarding.
    }
    await updatePrefs({ onboardingCompletedVersion: version })
  }

  function advance(next: number, finalAnswers: Answers = answers) {
    if (next >= TOTAL_STEPS) {
      void finish(finalAnswers, false)
      return
    }
    setStepIndex(next)
  }

  function submitContact(e: FormEvent) {
    e.preventDefault()
    const trimmed = email.trim()
    if (trimmed && !EMAIL_RE.test(trimmed)) {
      setEmailError(true)
      return
    }
    setEmailError(false)
    advance(1)
  }

  const choiceStep = stepIndex > 0 ? CHOICE_STEPS[stepIndex - 1] : null

  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-label="Welcome to Shelf">
      <div className="onboarding-card">
        <ShelfMark className="onboarding-mark" />
        <p className="onboarding-trust">
          <svg
            className="onboarding-trust-lock"
            viewBox="0 0 16 16"
            aria-hidden
            focusable="false"
          >
            <rect x="3" y="7" width="10" height="7" rx="1.6" fill="currentColor" />
            <path
              d="M5.2 7V4.8a2.8 2.8 0 1 1 5.6 0V7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            />
          </svg>
          Local-first · No account required · Privacy respected
        </p>
        {stepIndex === 0 ? (
          <form className="onboarding-step" onSubmit={submitContact}>
            <p className="onboarding-progress" aria-live="polite">
              <span className="onboarding-progress-label">Welcome</span>
              Step 1 of {TOTAL_STEPS}
            </p>
            <h2 ref={headingRef} tabIndex={-1}>
              Welcome to Shelf
            </h2>
            <p className="onboarding-sub">
              Answer a few quick questions to personalize your experience. No account
              required. Only these responses are sent once to shelfmcp.com — everything
              else stays on your Mac.
            </p>
            <label className="onboarding-field">
              <span>Your name</span>
              <input
                type="text"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                placeholder="Optional"
              />
            </label>
            <label className="onboarding-field">
              <span>Email address</span>
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setEmailError(false)
                }}
                placeholder="Optional — release notes only, no spam"
                aria-invalid={emailError}
              />
            </label>
            {emailError ? (
              <p className="onboarding-error" role="alert">
                That email doesn’t look right — fix it or leave it empty.
              </p>
            ) : null}
            <div className="onboarding-actions">
              <button
                type="button"
                className="onboarding-skip"
                onClick={() => advance(1)}
              >
                Skip
              </button>
              <button type="submit" className="onboarding-continue">
                Continue
              </button>
            </div>
          </form>
        ) : choiceStep ? (
          <OnboardingStep
            step={choiceStep}
            stepNumber={stepIndex + 1}
            totalSteps={TOTAL_STEPS}
            selected={answers[choiceStep.answerKey]}
            isLast={stepIndex === TOTAL_STEPS - 1}
            onChange={(values) =>
              setAnswers((prev) => ({ ...prev, [choiceStep.answerKey]: values }))
            }
            onNext={() => advance(stepIndex + 1)}
            onBack={() => setStepIndex(stepIndex - 1)}
            onSkip={() => {
              const cleared = { ...answers, [choiceStep.answerKey]: [] }
              setAnswers(cleared)
              advance(stepIndex + 1, cleared)
            }}
          />
        ) : null}
      </div>
    </div>
  )
}

/** Blocks the app with the onboarding flow until it has run once. */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { prefs, loading } = usePrefs()
  // Browser dev (no preload bridge): the gate is off.
  if (typeof window !== 'undefined' && !window.shelf) return <>{children}</>
  if (loading) return null
  if (!prefs.onboardingCompletedVersion) return <OnboardingFlow />
  return <>{children}</>
}
