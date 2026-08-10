/**
 * Design profile resolution (DESIGN-ENGINE.md precedence):
 * explicit id → tool's collection binding → collection binding → default.
 *
 * Pure functions over already-loaded arrays — callers own store access, so
 * smokes can exercise precedence without fixtures on disk.
 */
import type { CapabilityGap, Collection, DesignProfile } from './types'

export type DesignResolveVia = 'id' | 'tool-collection' | 'collection' | 'default' | 'none'

export interface DesignResolveResult {
  profile?: DesignProfile
  via: DesignResolveVia
  /** The collection whose binding won, when one did. */
  collectionId?: string
}

/** Deterministic order for "a tool is in several bound collections". */
function sortedBoundCollections(collections: Collection[]): Collection[] {
  return collections
    .filter((c) => c.designProfileId)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

export function resolveDesignProfile(
  profiles: DesignProfile[],
  collections: Collection[],
  opts: { id?: string; collectionId?: string; toolId?: string } = {},
): DesignResolveResult {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]))

  if (opts.id) {
    const profile = byId.get(opts.id)
    // Unknown explicit id is an error at the caller, never a silent fallback.
    return profile ? { profile, via: 'id' } : { via: 'none' }
  }

  if (opts.toolId) {
    for (const collection of sortedBoundCollections(collections)) {
      if (!collection.toolIds.includes(opts.toolId)) continue
      const profile = byId.get(collection.designProfileId as string)
      if (profile) return { profile, via: 'tool-collection', collectionId: collection.id }
    }
  }

  if (opts.collectionId) {
    const collection = collections.find((c) => c.id === opts.collectionId)
    const profile = collection?.designProfileId ? byId.get(collection.designProfileId) : undefined
    if (profile) return { profile, via: 'collection', collectionId: collection?.id }
  }

  const fallback = profiles.find((profile) => profile.isDefault)
  return fallback ? { profile: fallback, via: 'default' } : { via: 'none' }
}

/** Brand context for a gap brief: first related tool with a bound collection, else default. */
export function resolveProfileForGap(
  gap: CapabilityGap,
  collections: Collection[],
  profiles: DesignProfile[],
): DesignResolveResult {
  for (const toolId of gap.relatedToolIds) {
    const result = resolveDesignProfile(profiles, collections, { toolId })
    if (result.via === 'tool-collection') return result
  }
  return resolveDesignProfile(profiles, collections, {})
}
