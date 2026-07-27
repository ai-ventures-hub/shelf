/**
 * First-launch onboarding steps. Every answer is optional — each screen has
 * a Skip. Answers are POSTed once to shelfmcp.com; see docs/PRODUCT.md.
 */

export type ChoiceAnswerKey = 'firstShelve' | 'persona' | 'heardFrom' | 'agents'

export interface ChoiceStep {
  id: string
  kind: 'single' | 'multi'
  answerKey: ChoiceAnswerKey
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
    title: 'What will you shelve first?',
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
    title: 'What best describes you?',
    options: [
      'AI-assisted builder',
      'Indie developer or consultant',
      'Automation specialist',
      'Designer-developer hybrid',
      'Something else',
    ],
  },
  {
    id: 'agents',
    kind: 'multi',
    answerKey: 'agents',
    title: 'Which agents do you use?',
    options: ['Claude Desktop', 'Claude Code', 'Cursor', 'Codex', 'Another agent', 'None yet'],
    noneOption: 'None yet',
  },
  {
    id: 'heard-from',
    kind: 'single',
    answerKey: 'heardFrom',
    title: 'How did you hear about Shelf?',
    options: [
      'X / Twitter',
      'GitHub',
      'A friend or colleague',
      'Search',
      'Blog or newsletter',
      'Somewhere else',
    ],
  },
]

/** Contact screen + choice steps. */
export const TOTAL_STEPS = CHOICE_STEPS.length + 1
