/**
 * Collection detail reuses LibraryPage filtering, plus membership management.
 */
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { LibraryPage } from './LibraryPage'
import { useLibrary } from '../hooks/useLibrary'

export function CollectionPage() {
  const { collectionId } = useParams()
  const navigate = useNavigate()
  const { tools, collections, saveCollection, deleteCollection } = useLibrary()
  const collection = collections.find((c) => c.id === collectionId)
  const [editing, setEditing] = useState(false)

  const members = useMemo(() => {
    if (!collection) return []
    return tools.filter((t) => collection.toolIds.includes(t.id))
  }, [tools, collection])

  if (!collection || !collectionId) {
    return (
      <div className="empty-state">
        <div>
          <h2>Collection not found</h2>
          <Link className="btn btn-primary" to="/">
            Back to library
          </Link>
        </div>
      </div>
    )
  }

  async function toggleMember(toolId: string) {
    if (!collection) return
    const has = collection.toolIds.includes(toolId)
    await saveCollection({
      ...collection,
      toolIds: has
        ? collection.toolIds.filter((id) => id !== toolId)
        : [...collection.toolIds, toolId],
    })
  }

  return (
    <>
      <div className="collection-actions">
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? 'Done' : 'Manage members'}
        </button>
        <button
          type="button"
          className="btn btn-danger btn-sm"
          onClick={() => {
            if (!window.confirm(`Delete collection “${collection.name}”? Tools stay in the library.`)) {
              return
            }
            void deleteCollection(collection.id).then(() => navigate('/'))
          }}
        >
          Delete collection
        </button>
      </div>

      {editing ? (
        <section className="panel" style={{ marginBottom: '1rem' }}>
          <div className="panel-header">
            <h2 className="panel-title">Members ({members.length})</h2>
          </div>
          <div className="panel-body stack">
            {tools.map((tool) => {
              const checked = collection.toolIds.includes(tool.id)
              return (
                <label key={tool.id} className="filter-tag-row">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => void toggleMember(tool.id)}
                  />
                  <span>{tool.name}</span>
                </label>
              )
            })}
          </div>
        </section>
      ) : null}

      <LibraryPage mode="collection" />
    </>
  )
}
