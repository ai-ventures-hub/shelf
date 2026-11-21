import { Check, Circle, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Tool, ToolRuntimeState } from '../types'

const DISMISSED_KEY = 'shelf.agentReadyChecklist.dismissed'

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

interface AgentReadyChecklistProps {
  tools: Tool[]
  states: Record<string, ToolRuntimeState>
  isDeveloper: boolean
}

/**
 * Compact first-run / early-library readiness checklist.
 * Checks once on mount whether any AI client is connected (no polling),
 * pairs with live library/launch state, and disappears automatically once
 * all 3 milestones are reached or the user dismisses it.
 */
export function AgentReadyChecklist({
  tools,
  states,
  isDeveloper,
}: AgentReadyChecklistProps) {
  const [dismissed, setDismissed] = useState<boolean>(readDismissed)
  const [agentConnected, setAgentConnected] = useState<boolean | null>(null)

  useEffect(() => {
    if (dismissed || tools.length > 3) return
    if (!window.shelf?.getClaudeDesktopStatus) {
      setAgentConnected(false)
      return
    }
    let active = true
    void Promise.allSettled([
      window.shelf.getClaudeDesktopStatus(),
      window.shelf.getClaudeCodeMcpStatus(),
      window.shelf.getCursorMcpStatus(),
      window.shelf.getCodexMcpStatus(),
    ]).then((results) => {
      if (!active) return
      const anyConnected = results.some(
        (res) => res.status === 'fulfilled' && Boolean(res.value?.connected),
      )
      setAgentConnected(anyConnected)
    })
    return () => {
      active = false
    }
  }, [dismissed, tools.length])

  // Stay quiet once dismissed or once the user has an established library.
  if (dismissed || tools.length > 3) return null

  const hasTool = tools.length > 0
  const hasRun = tools.some(
    (tool) => Boolean(tool.lastLaunchedAt) || states[tool.id]?.status === 'running',
  )
  const hasAgent = agentConnected === true

  const steps = [
    {
      id: 'tool',
      done: hasTool,
      label: 'Add or drop your first local tool',
      detail: 'Drop any project folder onto this window, or scaffold one from an idea.',
      to: '/tools/new',
      cta: 'Add tool',
    },
    {
      id: 'agent',
      done: hasAgent,
      label: isDeveloper ? 'Connect an MCP client' : 'Connect your AI assistant',
      detail: 'Let Claude, Cursor, or Codex discover and launch your local tools.',
      to: '/mcp',
      cta: 'Connect',
    },
    {
      id: 'run',
      done: hasRun,
      label: 'Launch a tool cleanly',
      detail: hasTool
        ? 'Start any tool below to verify its port and live logs.'
        : 'Once a tool is added, launch it from Shelf with one click.',
      to: hasTool ? `/tools/${encodeURIComponent(tools[0].id)}` : '/tools/start',
      cta: hasTool ? 'Open tool' : 'Start a new tool',
    },
  ]

  const completed = steps.filter((step) => step.done).length
  // Hide once all three steps are complete (wait until agent check resolves).
  if (agentConnected !== null && completed === steps.length) return null

  function dismiss() {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISSED_KEY, '1')
    } catch {
      /* storage disabled */
    }
  }

  return (
    <section className="ready-checklist" aria-label="Getting started checklist">
      <div className="ready-checklist-head">
        <div>
          <h2 className="ready-checklist-title">Get Shelf ready</h2>
          <p className="ready-checklist-sub">
            {completed} of {steps.length} complete
          </p>
        </div>
        <button
          type="button"
          className="btn btn-quiet btn-sm btn-icon"
          aria-label="Dismiss getting started checklist"
          title="Dismiss"
          onClick={dismiss}
        >
          <X size={15} aria-hidden />
        </button>
      </div>
      <div className="ready-progress" aria-hidden="true">
        <div
          className="ready-progress-fill"
          style={{ width: `${Math.round((completed / steps.length) * 100)}%` }}
        />
      </div>
      <ol className="ready-steps">
        {steps.map((step) => (
          <li key={step.id} className={`ready-step${step.done ? ' is-done' : ''}`}>
            <span className="ready-step-icon" aria-hidden="true">
              {step.done ? <Check size={14} /> : <Circle size={14} />}
            </span>
            <div className="ready-step-copy">
              <strong>{step.label}</strong>
              <span>{step.detail}</span>
            </div>
            {!step.done ? (
              <Link className="btn btn-quiet btn-sm" to={step.to}>
                {step.cta}
              </Link>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  )
}
