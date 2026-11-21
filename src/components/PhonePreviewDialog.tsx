import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { previewBlocker } from '../../shared/companion-preview-policy'
import { Modal } from './Modal'
import type { CompanionStatus, Tool } from '../types'

interface PhonePreviewDialogProps {
  open: boolean
  tool: Tool
  running: boolean
  onTogglePreview: () => Promise<void>
  onClose: () => void
}

/**
 * Quick "Open on Phone" QR sheet on a tool detail page.
 * Points a paired phone directly to the tool in Companion (with `?preview=1`
 * when remote preview is enabled) and lets the user toggle preview inline.
 */
export function PhonePreviewDialog({
  open,
  tool,
  running,
  onTogglePreview,
  onClose,
}: PhonePreviewDialogProps) {
  const [status, setStatus] = useState<CompanionStatus | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !window.shelf?.getCompanionStatus) return
    let cancelled = false
    window.shelf
      .getCompanionStatus()
      .then((next) => {
        if (!cancelled) setStatus(next)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    const off = window.shelf.onCompanionStatus(setStatus)
    return () => {
      cancelled = true
      off()
    }
  }, [open])

  const blocker = previewBlocker(tool)
  const deepLink =
    status?.running && status.url
      ? `${status.url}/#/tools/${encodeURIComponent(tool.id)}${tool.remotePreview ? '?preview=1' : ''}`
      : null

  useEffect(() => {
    if (!open || !deepLink) {
      setQr(null)
      return
    }
    let cancelled = false
    QRCode.toDataURL(deepLink, { margin: 1, width: 220, errorCorrectionLevel: 'M' })
      .then((data) => {
        if (!cancelled) setQr(data)
      })
      .catch(() => {
        if (!cancelled) setQr(null)
      })
    return () => {
      cancelled = true
    }
  }, [open, deepLink])

  async function toggle() {
    setBusy(true)
    setError(null)
    try {
      await onTogglePreview()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} busy={busy} onDismiss={onClose} aria-labelledby="phone-preview-title">
      <div className="name-prompt">
        <h2 id="phone-preview-title">Open {tool.name} on your phone</h2>
        {error ? (
          <p className="warning-card" role="alert">
            {error}
          </p>
        ) : null}
        {!status ? (
          <p className="muted">Checking Companion status…</p>
        ) : !status.running ? (
          <>
            <p className="muted">
              {status.enabled && status.error
                ? `Companion is not running: ${status.error}`
                : 'Turn on Companion in Settings to control and preview tools from a paired phone over Tailscale or your local network.'}
            </p>
            <div className="name-prompt-actions">
              <button type="button" className="btn btn-quiet" onClick={onClose}>
                Close
              </button>
              <Link className="btn btn-primary" to="/settings?section=companion" onClick={onClose}>
                Open Companion settings
              </Link>
            </div>
          </>
        ) : (
          <>
            {!blocker ? (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={Boolean(tool.remotePreview)}
                  disabled={busy}
                  onChange={() => void toggle()}
                />
                Allow remote preview from paired phones
              </label>
            ) : (
              <p className="muted">{blocker}</p>
            )}
            {qr && deepLink ? (
              <div className="phone-qr-wrap">
                <img
                  className="phone-qr-img"
                  src={qr}
                  width={220}
                  height={220}
                  alt={`QR code to open ${tool.name} in Shelf Companion`}
                />
                <p className="phone-qr-url mono">{deepLink}</p>
              </div>
            ) : null}
            <p className="muted">
              {tool.remotePreview
                ? running
                  ? 'Scan with a paired phone to open this tool and request a one-time preview link.'
                  : 'Scan with a paired phone to start this tool and open its preview.'
                : 'Scan with a paired phone to control this tool and read its logs.'}
            </p>
            {status.devices.length === 0 ? (
              <p className="warning-card" role="status">
                No phones are paired yet. Pair your phone once in Companion settings first.
              </p>
            ) : null}
            <div className="name-prompt-actions">
              <Link className="btn btn-quiet" to="/settings?section=companion" onClick={onClose}>
                Companion settings
              </Link>
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
