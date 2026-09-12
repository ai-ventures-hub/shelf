/** Renderer contracts come from the same definitions as the desktop services. */
export type * from '../shared/contracts'
export type { ShelfApi } from '../shared/desktop-api'
import type { ShelfApi } from '../shared/desktop-api'

declare global {
  interface Window { shelf: ShelfApi }
}
