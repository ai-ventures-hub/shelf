import {
  createContext,
  useCallback,
  useContext,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Modal } from '../Modal'

export interface ConfirmOptions {
  title: string
  message?: ReactNode
  /** A verb for what happens: "Remove", "Clear history", "Disconnect". */
  confirmLabel: string
  /** What staying put means: "Keep tool". Defaults to "Cancel". */
  cancelLabel?: string
  /** Destructive actions use danger styling on the confirm button. */
  danger?: boolean
}

export type Confirm = (options: ConfirmOptions) => Promise<boolean>

/** In-app confirmation built on the shared native-dialog Modal. */
export function ConfirmDialog({
  open,
  options,
  onResolve,
}: {
  open: boolean
  options: ConfirmOptions | null
  onResolve: (confirmed: boolean) => void
}) {
  const titleId = useId()
  const messageId = useId()
  if (!options) return null
  return (
    <Modal
      open={open}
      onDismiss={() => onResolve(false)}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={options.message ? messageId : undefined}
      className="name-prompt-backdrop"
    >
      <div className="name-prompt">
        <h2 id={titleId} className="name-prompt-title">
          {options.title}
        </h2>
        {options.message ? (
          <div id={messageId} className="confirm-dialog-message">
            {options.message}
          </div>
        ) : null}
        <div className="name-prompt-actions">
          {/* The safe choice takes initial focus. */}
          <button type="button" className="btn btn-quiet" autoFocus onClick={() => onResolve(false)}>
            {options.cancelLabel || 'Cancel'}
          </button>
          <button
            type="button"
            className={`btn ${options.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => onResolve(true)}
          >
            {options.confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}

const ConfirmContext = createContext<Confirm | null>(null)

/** Hosts one ConfirmDialog for the whole app. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback<Confirm>((options) => {
    // A second request supersedes an unanswered one; the first resolves "no".
    resolver.current?.(false)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
      setRequest(options)
    })
  }, [])

  const resolve = useCallback((value: boolean) => {
    const done = resolver.current
    resolver.current = null
    setRequest(null)
    done?.(value)
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog open={request !== null} options={request} onResolve={resolve} />
    </ConfirmContext.Provider>
  )
}

/** `const confirm = useConfirm(); if (!(await confirm({...}))) return` */
export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm must be used within ConfirmProvider')
  return confirm
}
