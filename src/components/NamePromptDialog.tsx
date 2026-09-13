import { Modal } from './Modal'
/**
 * In-app name prompt — Electron does not support window.prompt (always null).
 */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'

interface NamePromptDialogProps {
  open: boolean
  title: string
  label?: string
  initialValue?: string
  confirmLabel?: string
  placeholder?: string
  onCancel: () => void
  onConfirm: (value: string) => void | Promise<void>
}

export function NamePromptDialog({
  open,
  title,
  label = 'Name',
  initialValue = '',
  confirmLabel = 'Create',
  placeholder,
  onCancel,
  onConfirm,
}: NamePromptDialogProps) {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setValue(initialValue)
    setBusy(false)
    // Focus after paint so the modal receives keyboard input.
    const id = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [open, initialValue])

  if (!open) return null

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    const trimmed = value.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      await onConfirm(trimmed)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (!busy) onCancel()
    }
  }

  return (
    <Modal open={open} onDismiss={onCancel} busy={busy} aria-labelledby="name-prompt-title"
      className="name-prompt-backdrop"
    >
      <form
        className="name-prompt"
        aria-labelledby="name-prompt-title"
        onSubmit={(e) => void submit(e)}
        onKeyDown={onKeyDown}
      >
        <h2 id="name-prompt-title" className="name-prompt-title">
          {title}
        </h2>
        <label className="field">
          <span className="field-label">{label}</span>
          <input
            ref={inputRef}
            className="field-input"
            value={value}
            placeholder={placeholder}
            disabled={busy}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        {error && <p role="alert" className="form-error">{error}</p>}
        <div className="name-prompt-actions">
          <button
            type="button"
            className="btn btn-quiet"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !value.trim()}
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  )
}
