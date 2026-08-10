import { Link } from 'react-router-dom'
import { ArrowUpRight, Sparkles } from 'lucide-react'
import type { GapResolveSuggestion } from '../types'

/**
 * Standalone notification rendered IN the library grid: same silhouette as a
 * tool card for uniformity, but it is not a tool — no project, no launch.
 * It replicates the suggestion ("X can now do what your AI assistant was
 * missing") and the whole card links to the Capability gaps page, where the
 * resolve/dismiss decision lives.
 */
export function SuggestionGridCard({
  suggestion,
}: {
  suggestion: GapResolveSuggestion
}) {
  return (
    <Link
      to="/gaps"
      className="tool-card"
      data-suggestion
      aria-label={`Tool suggestion: ${suggestion.toolName}. Review and decide.`}
    >
      <div className="tool-card-top">
        <span className="tool-icon suggestion-tile" aria-hidden>
          <Sparkles size={22} />
        </span>
        <span className="status-pill" data-status="suggestion">
          Tool suggestion
        </span>
      </div>
      <div>
        <h3 className="tool-name">{suggestion.toolName}</h3>
        <p className="tool-desc">
          Can now do something your AI assistant was missing —{' '}
          {suggestion.matched.join(', ')}.
        </p>
      </div>
      <div className="tool-card-footer">
        <div className="tool-meta" />
        <div className="tool-card-controls">
          <span className="btn btn-quiet btn-sm btn-icon" title="Review and decide">
            <ArrowUpRight size={13} aria-hidden />
          </span>
        </div>
      </div>
    </Link>
  )
}

/** List-view sibling: one row, same destination. */
export function SuggestionListRow({
  suggestion,
}: {
  suggestion: GapResolveSuggestion
}) {
  return (
    <tr className="tool-list-row">
      <td>
        <Link to="/gaps" className="tool-list-name">
          <span className="tool-icon tool-icon-sm suggestion-tile" aria-hidden>
            <Sparkles size={15} />
          </span>
          <span className="tool-list-name-text">{suggestion.toolName}</span>
        </Link>
      </td>
      <td>
        <span className="status-pill" data-status="suggestion">
          Tool suggestion
        </span>
      </td>
      <td className="tabular">—</td>
      <td>
        <div className="tool-meta">
          {suggestion.matched.map((capability) => (
            <span key={capability} className="tag-chip">
              {capability}
            </span>
          ))}
        </div>
      </td>
      <td className="tabular">—</td>
      <td className="tool-list-actions">
        <div className="tool-list-actions-row">
          <Link className="btn btn-primary btn-sm" to="/gaps">
            Review
          </Link>
        </div>
      </td>
    </tr>
  )
}
