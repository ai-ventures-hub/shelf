/**
 * First-launch onboarding steps. Every answer is optional — each screen has
 * a Skip. Answers are POSTed once to shelfmcp.com; see docs/PRODUCT.md.
 */

export type ChoiceAnswerKey = 'firstShelve' | 'persona' | 'heardFrom' | 'agents'

export interface ChoiceStep {
  id: string
  kind: 'single' | 'multi'
  answerKey: ChoiceAnswerKey
  /** Short human header shown above the step counter ("About you"). */
  label: string
  title: string
  options: string[]
  /** Multi-select option that clears (and is cleared by) the others. */
  noneOption?: string
}

export const CHOICE_STEPS: ChoiceStep[] = [
  {
    id: 'first-shelve',
    kind: 'single',
    answerKey: 'firstShelve',
    label: 'Your workflow',
    title: 'How do you plan to use Shelf?',
    options: [
      'A dev server or web app',
      'A CLI script',
      'An automation or scheduled job',
      'An MCP tool',
      'Not sure yet',
    ],
  },
  {
    id: 'persona',
    kind: 'single',
    answerKey: 'persona',
    label: 'About you',
    title: 'Which best describes you?',
    options: [
      'AI-powered builder',
      'Indie developer / consultant',
      'Automation engineer',
      'Designer–developer',
      'Other',
    ],
  },
  {
    id: 'agents',
    kind: 'multi',
    answerKey: 'agents',
    label: 'Your agents',
    title: 'Which AI agents do you use?',
    options: [
      'Claude Desktop',
      'Claude Code',
      'Cursor',
      'Codex',
      'Other AI agent',
      'I’m just getting started',
    ],
    noneOption: 'I’m just getting started',
  },
  {
    id: 'heard-from',
    kind: 'single',
    answerKey: 'heardFrom',
    label: 'One last question',
    title: 'How did you hear about Shelf?',
    options: [
      'X (Twitter)',
      'GitHub',
      'Friend or colleague',
      'Web search',
      'Blog or newsletter',
      'Other',
    ],
  },
]

/** Contact screen + choice steps. */
export const TOTAL_STEPS = CHOICE_STEPS.length + 1
