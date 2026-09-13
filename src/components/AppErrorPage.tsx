/** Recovery UI for a failed route or missing local JavaScript chunk. */
export function AppErrorPage() {
  return (
    <main className="empty-state">
      <div>
        <h1>Shelf couldn’t open this page</h1>
        <p>Reload the page to try again, or return to your library.</p>
        <div className="action-row">
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload page
          </button>
          <button
            className="btn"
            onClick={() => {
              window.location.hash = '/'
              window.location.reload()
            }}
          >
            Open library
          </button>
        </div>
      </div>
    </main>
  )
}
