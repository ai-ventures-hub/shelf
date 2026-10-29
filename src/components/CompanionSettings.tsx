import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { useConfirm } from './feedback/ConfirmDialog'
import { notify } from './feedback/Toasts'
import { usePrefs } from '../hooks/usePrefs'
import { errorText } from '../lib/errorText'
import { formatRelativeTime } from '../lib/relativeTime'
import type { CompanionStatus } from '../types'

const TAILSCALE = 'tailscale'

/** Settings → Companion: the paired-phone server, its devices, and pairing. */
export function CompanionSettings() {
  const { prefs, updatePrefs } = usePrefs()
  const confirm = useConfirm()
  const [status, setStatus] = useState<CompanionStatus | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const [portDraft, setPortDraft] = useState(String(prefs.companionPort))
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.shelf.getCompanionStatus()
      .then((next) => { if (!cancelled) setStatus(next) })
      .catch((err: unknown) => notify(`Could not read Companion status. ${errorText(err)}`, { tone: 'error' }))
    const off = window.shelf.onCompanionStatus(setStatus)
    return () => { cancelled = true; off() }
  }, [])

  useEffect(() => {
    setPortDraft(String(prefs.companionPort))
  }, [prefs.companionPort])

  // The QR carries the one-time code; it exists only while a pairing is live.
  useEffect(() => {
    const url = status?.pairing?.url
    if (!url) { setQr(null); setSecondsLeft(null); return }
    let cancelled = false
    QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: 'M' })
      .then((data) => { if (!cancelled) setQr(data) })
      .catch(() => { if (!cancelled) setQr(null) })
    const expires = Date.parse(status!.pairing!.expiresAt)
    const tick = () => {
      const left = Math.max(0, Math.round((expires - Date.now()) / 1000))
      setSecondsLeft(left)
      if (left === 0) void window.shelf.getCompanionStatus().then(setStatus).catch(() => undefined)
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [status?.pairing?.url, status?.pairing?.expiresAt])

  async function run(action: () => Promise<CompanionStatus>, failure: string) {
    setBusy(true)
    try {
      setStatus(await action())
    } catch (err) {
      notify(`${failure} ${errorText(err)}`, { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function commitPort() {
    const next = Number(portDraft)
    if (!Number.isInteger(next) || next < 1024 || next > 65535) {
      notify('Choose a port between 1024 and 65535.', { tone: 'error' })
      setPortDraft(String(prefs.companionPort))
      return
    }
    if (next !== prefs.companionPort) await updatePrefs({ companionPort: next })
  }

  const interfaces = status?.interfaces ?? []
  const bindChoice = prefs.companionBindAddress || TAILSCALE
  const bindKnown = bindChoice === TAILSCALE || interfaces.some((item) => item.address === bindChoice)

  return (
    <div className="settings-group" aria-label="Companion settings">
      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Companion</h2>
          {status?.running ? <span className="muted mono" style={{ fontSize: '.8rem' }}>On · {status.url}</span> : null}
        </div>
        <div className="panel-body stack">
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            See, start, stop, and read the logs of your tools from your phone. Shelf serves a small
            web app on this Mac over your own network — <strong>Tailscale is the recommended way</strong> to
            reach it away from home. There is no Shelf relay and no account: a phone can only connect if
            your network can already reach this Mac and you paired it here.
          </p>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={prefs.companionEnabled}
              onChange={(e) => void updatePrefs({ companionEnabled: e.target.checked })}
            />
            Turn Companion on
          </label>
          {status?.enabled && status.error ? (
            <div className="warning-card" role="alert">
              <strong>Companion is not running.</strong> {status.error}
            </div>
          ) : null}
          <label className="field">
            <span className="field-label">Listen on</span>
            <select
              className="field-input"
              value={bindKnown ? bindChoice : ''}
              onChange={(e) => void updatePrefs({ companionBindAddress: e.target.value || TAILSCALE })}
            >
              <option value={TAILSCALE}>
                Tailscale{status?.tailscaleDetected ? ' (recommended)' : ' (not detected right now)'}
              </option>
              {interfaces.filter((item) => !item.tailscale).map((item) => (
                <option key={item.address} value={item.address}>
                  {item.name} · {item.address} (this network only)
                </option>
              ))}
              {!bindKnown ? <option value="">{bindChoice} (not on this Mac right now)</option> : null}
            </select>
            <p className="field-hint">
              Never loopback, never every interface. Tailscale gives the Mac a stable private address
              your phone can reach anywhere; a Wi-Fi address works only while both are on that network.
            </p>
          </label>
          <label className="field">
            <span className="field-label">Port</span>
            <input
              className="field-input"
              inputMode="numeric"
              value={portDraft}
              onChange={(e) => setPortDraft(e.target.value)}
              onBlur={() => void commitPort()}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void commitPort() } }}
              style={{ maxWidth: '10rem' }}
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={prefs.companionKeepAwake}
              onChange={(e) => void updatePrefs({ companionKeepAwake: e.target.checked })}
            />
            Stay awake while a phone is connected
            {status?.keepAwakeActive ? <span className="muted" style={{ marginLeft: '.5rem', fontSize: '.8rem' }}>· awake now</span> : null}
          </label>
          <p className="field-hint" style={{ margin: 0 }}>
            A sleeping Mac cannot be reached, even over Tailscale. This holds off app sleep while a paired
            phone has the Companion open, and lets go a minute after it closes.
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Paired devices</h2>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || !status?.running}
            onClick={() => void run(() => window.shelf.beginCompanionPairing(), 'Could not start pairing.')}
          >
            Pair a device
          </button>
        </div>
        <div className="panel-body stack">
          {!status?.running ? (
            <p style={{ margin: 0, color: 'var(--muted)' }}>Turn Companion on to pair a phone.</p>
          ) : null}
          {status?.pairing ? (
            <div className="companion-pairing">
              {qr ? <img src={qr} alt="Pairing QR code" width={240} height={240} /> : <div className="companion-qr-placeholder" />}
              <div className="stack" style={{ gap: '.5rem' }}>
                <strong>Scan with your phone’s camera.</strong>
                <p style={{ margin: 0, color: 'var(--muted)' }}>
                  Safari opens the Companion and pairs in one tap. Then use Share → <em>Add to Home Screen</em> so
                  it opens like an app.
                </p>
                <p style={{ margin: 0, color: 'var(--muted)' }}>
                  Or open <code className="mono">{status.url}</code> on the phone and type the code{' '}
                  <code className="mono">{status.pairing.url.split('#')[1]?.split('.')[0]}</code>.
                </p>
                <p className="field-hint" style={{ margin: 0 }}>
                  This code works once and expires in {secondsLeft ?? '…'} s.
                </p>
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() => void run(() => window.shelf.cancelCompanionPairing(), 'Could not cancel pairing.')}
                >
                  Cancel pairing
                </button>
              </div>
            </div>
          ) : null}
          {status && status.devices.length === 0 && !status.pairing ? (
            <p style={{ margin: 0, color: 'var(--muted)' }}>No phones are paired yet.</p>
          ) : null}
          {status && status.devices.length > 0 ? (
            <ul className="companion-devices">
              {status.devices.map((device) => (
                <li key={device.id}>
                  <input
                    className="field-input companion-device-name"
                    defaultValue={device.name}
                    aria-label="Device name"
                    onBlur={(e) => {
                      const next = e.target.value.trim()
                      if (next && next !== device.name) {
                        void run(() => window.shelf.renameCompanionDevice(device.id, next), 'Could not rename the device.')
                      }
                    }}
                  />
                  <span className="muted">
                    {device.lastSeenAt
                      ? `Seen ${formatRelativeTime(device.lastSeenAt)}${device.lastSeenFrom ? ` from ${device.lastSeenFrom}` : ''}`
                      : `Paired ${formatRelativeTime(device.pairedAt)}`}
                  </span>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={busy}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Revoke “${device.name}”?`,
                        message: 'That phone loses access on its next request. Pair it again any time.',
                        confirmLabel: 'Revoke',
                        cancelLabel: 'Keep',
                        danger: true,
                      })
                      if (ok) void run(() => window.shelf.revokeCompanionDevice(device.id), 'Could not revoke the device.')
                    }}
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {status && status.connectedClients > 0 ? (
            <p className="field-hint" style={{ margin: 0 }}>
              {status.connectedClients} {status.connectedClients === 1 ? 'phone is' : 'phones are'} connected right now.
            </p>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Trust on your phone</h2>
        </div>
        <div className="panel-body stack">
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            The Companion is served over HTTPS with a certificate this Mac made for itself. Safari warns
            the first time; the warning goes away once the phone trusts the certificate. Save it here,
            AirDrop it to the phone, install the profile, then turn on full trust under Settings → General →
            About → Certificate Trust Settings.
          </p>
          {status?.certFingerprint ? (
            <p className="field-hint" style={{ margin: 0 }}>
              SHA-256 fingerprint: <code className="mono">{status.certFingerprint}</code>
            </p>
          ) : null}
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              void window.shelf.exportCompanionCertificate().then((result) => {
                if (result.saved && result.path) notify(`Saved certificate to ${result.path}`, { tone: 'success' })
              }).catch((err: unknown) => notify(`Could not save the certificate. ${errorText(err)}`, { tone: 'error' }))
            }}
          >
            Save certificate…
          </button>
        </div>
      </section>
    </div>
  )
}
