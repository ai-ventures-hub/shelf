import { useEffect, useRef, useState } from 'react'

export function DiagnosticReportDialog({ report, onClose, onCopied }: {
  report: string | null
  onClose: () => void
  onCopied: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog || report === null) return
    setError(null)
    dialog.showModal()
    return () => { dialog.close() }
  }, [report])

  return <dialog ref={ref} className="consent-sheet diagnostic-report" aria-labelledby="diagnostic-report-title" onCancel={onClose}>
    <h2 id="diagnostic-report-title" className="consent-title">Review your diagnostic report</h2>
    <p className="consent-lede">Shelf masks configured secret values and recognizable credentials. Review the text before sharing it with an agent.</p>
    <textarea className="field-input" aria-label="Diagnostic report" readOnly value={report || ''} rows={16} />
    {error && <p role="alert" className="warning-card">{error}</p>}
    <div className="consent-actions">
      <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
      <button type="button" className="btn btn-primary" onClick={async () => {
        try { await navigator.clipboard.writeText(report || ''); onCopied(); onClose() }
        catch { setError('Could not copy the report. Select and copy the text above.') }
      }}>Copy report</button>
    </div>
  </dialog>
}
