/**
 * Design Engine MCP surface (v1.0, read path) — the agent-facing half of
 * "build this using my branding". Read-only by design: profiles are created
 * and edited in the Shelf GUI; agents consume tokens + brief and apply them.
 *
 * Discovery is the tool description itself — every MCP client reads tool
 * descriptions, so the get tool's description is the contract that makes a
 * zero-context agent find the user's brand.
 */
import { z } from 'zod'
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { DesignProfileStore } from '../shared/design-profile-store'
import { buildDesignBrief, summarizeDesignProfile } from '../shared/design-brief'
import { resolveDesignProfile } from '../shared/design-resolve'
import { resolveDesignMd } from '../shared/design-md'
import type { LibraryStore } from '../shared/library-store'
import { maskSecrets } from '../shared/types'
import type { DesignMdResult } from '../shared/types'
import { errorResult, textResult } from './result'

interface DesignToolHost {
  server: McpServer
  store: LibraryStore
  profiles: DesignProfileStore
}

/** Register the read-only Design Engine MCP surface. */
export function registerDesignTools({ server, store, profiles }: DesignToolHost): void {
  server.registerTool(
    'shelf_list_design_profiles',
    {
      description:
        "List the user's design/brand profiles stored in Shelf — brand colors, typography, logo assets, voice — with a summary and the collections each is bound to. Read-only: profiles are created and edited in the Shelf app. Use shelf_get_design_profile to retrieve tokens and the full brand brief.",
    },
    async () => {
      const collections = store.listCollections()
      const list = profiles.list().map((profile) => ({
        id: profile.id,
        name: profile.name,
        isDefault: profile.isDefault,
        summary: summarizeDesignProfile(profile),
        boundCollections: collections
          .filter((collection) => collection.designProfileId === profile.id)
          .map((collection) => ({ id: collection.id, name: collection.name })),
      }))
      return textResult({ count: list.length, profiles: list })
    },
  )

  server.registerTool(
    'shelf_get_design_profile',
    {
      description:
        "The user's brand/design source of truth: colors, typography, logo assets, and voice/style direction. Call when asked to build 'with my branding', use the user's colors, or match their style. Zero arguments resolves the default profile; pass toolId or collectionId for scoped resolution. Returns design tokens (DTCG JSON) plus a paste-ready markdown brand brief. Read-only — profiles are edited in the Shelf app; for a project's own DESIGN.md use shelf_get_design_md.",
      inputSchema: {
        id: z.string().optional().describe('Explicit design profile id'),
        collectionId: z.string().optional().describe('Resolve via a Shelf collection binding'),
        toolId: z.string().optional().describe("Resolve via the tool's collection binding"),
      },
    },
    async ({ id, collectionId, toolId }) => {
      const allProfiles = profiles.list()
      const resolved = resolveDesignProfile(allProfiles, store.listCollections(), {
        id,
        collectionId,
        toolId,
      })
      if (!resolved.profile) {
        if (id) return errorResult(`Design profile not found: ${id}`)
        // Profiles-without-a-default is reachable (e.g. the default was
        // deleted) — telling the agent "none exist" there would be wrong.
        return errorResult(
          allProfiles.length > 0
            ? 'No default design profile is set. Call shelf_list_design_profiles and pass an explicit id or a collectionId.'
            : 'No design profiles exist yet. The user creates them in the Shelf app; there is nothing to apply.',
        )
      }
      // Composition rule: a tool-scoped request merges the project's own
      // DESIGN.md into the brief, and the project doc wins on conflict.
      let designMd: DesignMdResult | undefined
      if (toolId) {
        const tool = store.get(toolId)
        if (tool?.projectPath) {
          const found = resolveDesignMd(tool.projectPath, toolId)
          if (found.found) designMd = found
        }
      }
      const profile = resolved.profile
      return textResult({
        resolvedVia: resolved.via,
        resolvedCollectionId: resolved.collectionId,
        profile: { id: profile.id, name: profile.name, isDefault: profile.isDefault },
        tokens: profile.tokens,
        modes: profile.modes,
        assets: profile.assets,
        direction: maskSecrets(profile.direction),
        brief: buildDesignBrief(profile, { designMd }),
      })
    },
  )

  // Stable agent contract: shelf://design/profiles/{id}
  server.registerResource(
    'shelf-design-profile',
    new ResourceTemplate('shelf://design/profiles/{id}', { list: undefined }),
    {
      description: "Rendered markdown brand brief for one of the user's design profiles.",
      mimeType: 'text/markdown',
    },
    async (uri, variables) => {
      const id = String(variables.id || '')
      const profile = profiles.get(id)
      if (!profile) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify({ found: false, profileId: id }, null, 2),
            },
          ],
        }
      }
      return {
        contents: [
          { uri: uri.href, mimeType: 'text/markdown', text: buildDesignBrief(profile) },
        ],
      }
    },
  )
}
