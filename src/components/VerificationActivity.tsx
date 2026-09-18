import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

/** Keep commands visible when the user navigates away from their project. */
export function VerificationActivity() {
  const [items, setItems] = useState<{ toolId: string; name: string; status: string }[]>(
    [],
  )
  const [error, setError] = useState(false)
  useEffect(() => {
    let alive = true
    let generation = 0
    const load = async () => {
      const ticket = ++generation
      try {
        const value = await window.shelf.getVerificationActivity()
        if (alive && ticket === generation) {
          setItems(value)
          setError(false)
        }
      } catch {
        if (alive && ticket === generation) setError(true)
      }
    }
    void load()
    const off = window.shelf.onVerificationUpdate(() => void load())
    return () => {
      alive = false
      off()
    }
  }, [])
  return (
    <>
      {error && (
        <p className="warning-card" role="status">
          Verification activity is unavailable. Open the project’s verification page to
          check its commands.
        </p>
      )}
      {items.map((item) => (
        <p className="notice" role="status" key={item.toolId}>
          {item.status === 'cleanup_required'
            ? 'Verification needs attention'
            : 'Verification running'}
          : {item.name}.{' '}
          <Link to={`/tools/${item.toolId}/verify`}>View verification</Link>
        </p>
      ))}
    </>
  )
}
