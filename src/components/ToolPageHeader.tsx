import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { toolSections } from '../../shared/ui-navigation'

export function ToolPageHeader({ id, name, description, runId, children }: {
  id: string; name: string; description?: string; runId?: string; children?: ReactNode
}) {
  const { pathname } = useLocation()
  return <>
    <header className="page-header tool-page-header">
      <div className="page-header-copy">
        <Link to="/" className="tool-breadcrumb">Library</Link>
        <h1 className="page-title">{name}</h1>
        {description && <p className="page-lede">{description}</p>}
      </div>
      {children && <div className="action-row tool-header-actions">{children}</div>}
    </header>
    <nav className="section-nav" aria-label="Tool sections">
      {toolSections(id, runId).map((item) => <Link key={item.path} to={item.to} aria-current={pathname === item.path ? 'page' : undefined}>{item.label}</Link>)}
    </nav>
  </>
}
