import { startCollection, stopCollection } from '../../shared/collection-launch'
import { adoptCollection } from '../../shared/library-store'
import type { IpcContext } from './context'
import { handle } from './typed'

/** Collections: CRUD plus Start stack / Stop stack. */
export function registerCollectionsIpc(ctx: IpcContext): void {
  const { store, processes } = ctx

  handle('collections:list', () => store.listCollections())
  // Any GUI save adopts the collection: an agent draft becomes user-owned
  // and shelf_upsert_collection can no longer touch it.
  handle('collections:save', (_e, collection) =>
    store.saveCollection(adoptCollection(collection)),
  )
  handle('collections:delete', (_e, id) => {
    store.deleteCollection(id)
  })
  handle('collections:start', (_e, id, options) =>
    startCollection(id, { store, processes }, options),
  )
  handle('collections:stop', (_e, id) => stopCollection(id, { store, processes }))
}
