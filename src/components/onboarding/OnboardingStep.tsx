/**
 * Generic onboarding question screen — native radios/checkboxes hidden
 * inside styled label cards so keyboard semantics come for free.
 */
import { useEffect, useRef, type FormEvent } from 'react'
import type { ChoiceStep } from './steps'

interface OnboardingStepProps {
  step: ChoiceStep
  stepNumber: number
  totalSteps: number
  selected: string[]
  isLast: boolean
  onChange: (values: string[]) => void
  onNext: () => void
  onBack: () => void
  onSkip: () => void
}

export function OnboardingStep({
  step,
  stepNumber,
  totalSteps,
  selected,
  isLast,
  onChange,
  onNext,
  onBack,
  onSkip,
}: OnboardingStepProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [step.id])

  function toggle(option: string) {
    if (step.kind === 'single') {
      onChange([option])
      return
    }
    if (step.noneOption && option === step.noneOption) {
      onChange(selected.includes(option) ? [] : [option])
      return
    }
    const without = selected.filter((v) => v !== option && v !== step.noneOption)
    onChange(selected.includes(option) ? without : [...without, option])
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    onNext()
  }

  return (
    <form className="onboarding-step" onSubmit={submit}>
      <p className="onboarding-progress" aria-live="polite">
        <span className="onboarding-progress-label">{step.label}</span>
        Step {stepNumber} of {totalSteps}
      </p>
      <h2 ref={headingRef} tabIndex={-1}>
        {step.title}
      </h2>
      <div
        className="onboarding-options"
        role={step.kind === 'single' ? 'radiogroup' : 'group'}
        aria-label={step.title}
      >
        {step.options.map((option) => (
          <label key={option} className="onboarding-option">
            <input
              type={step.kind === 'single' ? 'radio' : 'checkbox'}
              name={step.id}
              value={option}
              checked={selected.includes(option)}
              onChange={() => toggle(option)}
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
      <div className="onboarding-actions">
        <button type="button" className="onboarding-back" onClick={onBack}>
          Back
        </button>
        <button type="button" className="onboarding-skip" onClick={onSkip}>
          Skip
        </button>
        <button type="submit" className="onboarding-continue" disabled={selected.length === 0}>
          {isLast ? 'Get Started' : 'Continue'}
        </button>
      </div>
    </form>
  )
}
