/**
 * Design Engine MCP surface (v1.0, read path) — the agent-facing half of
 * "build this using my branding". Read-only by design: profiles are created
 * and edited in the Shelf GUI; agents consume tokens + brief and apply them.
 *
 * Discovery is the tool description itself — every MCP client reads tool
 * descriptions, so the get tool's description is the contract that makes a
 * zero-context agent find the user's brand.
 */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { containsLikelySecret } from '../shared/capability-intelligence'
import {
  buildDesignBrief,
  flattenTokens,
  summarizeDesignProfile,
} from '../shared/design-brief'
import { resolveDesignMd } from '../shared/design-md'
import type { DesignProfileStore } from '../shared/design-profile-store'
import { resolveDesignProfile } from '../shared/design-resolve'
import type { LibraryStore } from '../shared/library-store'
import type { DesignMdResult, DesignTokenGroup } from '../shared/types'
import { maskSecrets } from '../shared/types'
import { LOCAL_WRITE, READ_ONLY, errorResult, textResult } from './result'

function isTokenGroup(value: unknown): value is DesignTokenGroup {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Agent-draft size caps (the GUI is uncapped — the user owns their own file).
const MAX_NAME_CHARS = 120
const MAX_DIRECTION_CHARS = 20_000
const MAX_SOURCE_NOTE_CHARS = 1_000
const MAX_TOKENS_JSON_BYTES = 128 * 1024

interface DesignToolHost {
  server: McpServer
  store: LibraryStore
  profiles: DesignProfileStore
}

/** Register design reads and guarded agent-draft operations. */
export function registerDesignTools({ server, store, profiles }: DesignToolHost): void {
  server.registerTool(
    'shelf_list_design_profiles',
    {
      description:
        "List the user's design/brand profiles (colors, typography, logo assets, voice) with a summary and the collections each is bound to.",
      annotations: READ_ONLY,
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
        "The user's brand source of truth (colors, type, logo assets, voice); call it to build with their branding. No arguments: the default profile; toolId/collectionId: that binding. format: brief (default, markdown with every token), tokens (DTCG JSON + assets), or full (both).",
      inputSchema: {
        id: z.string().optional().describe('Explicit design profile id'),
        collectionId: z.string().optional().describe('Resolve via a Shelf collection binding'),
        toolId: z.string().optional().describe("Resolve via the tool's collection binding"),
        format: z
          .enum(['brief', 'tokens', 'full'])
          .optional()
          .describe('brief (default), tokens, or full'),
      },
      annotations: READ_ONLY,
    },
    async ({ id, collectionId, toolId, format }) => {
      const allProfiles = profiles.list()
      const resolved = resolveDesignProfile(allProfiles, store.listCollections(), {
        id,
        collectionId,
        toolId,
      })
      if (!resolved.profile) {
        if (id) return errorResult(`Design profile not found: ${id}. Call shelf_list_design_profiles for ids.`)
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
      const mode = format ?? 'brief'
      // One copy of each fact by default: the brief already renders every
      // token value and the direction, so structured fields ride only on
      // format tokens/full.
      const structured = {
        tokens: profile.tokens,
        modes: profile.modes,
        assets: profile.assets,
      }
      return textResult({
        resolvedVia: resolved.via,
        resolvedCollectionId: resolved.collectionId,
        profile: { id: profile.id, name: profile.name, isDefault: profile.isDefault },
        format: mode,
        ...(mode === 'brief' ? {} : structured),
        ...(mode === 'full' ? { direction: maskSecrets(profile.direction) } : {}),
        ...(mode === 'tokens' ? {} : { brief: buildDesignBrief(profile, { designMd }) }),
      })
    },
  )

  server.registerTool(
    'shelf_upsert_design_profile',
    {
      description:
        'Save a brand you extracted (site, screenshot, style guide) as a draft profile the user reviews in Shelf. You can update only agent-created profiles and never set the default; the same name updates your draft. Put the source in sourceNote.',
      annotations: LOCAL_WRITE,
      inputSchema: {
        id: z.string().optional().describe('Update an agent-created profile by id'),
        name: z.string().min(1).describe('Profile name, e.g. the brand or site name'),
        tokens: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('DTCG token groups ({ color: { brand: { $value, $type } }, typography, dimension, … })'),
        modes: z
          .object({
            light: z.record(z.string(), z.unknown()).optional(),
            dark: z.record(z.string(), z.unknown()).optional(),
          })
          .optional()
          .describe('Per-mode token overrides'),
        direction: z
          .string()
          .optional()
          .describe("Markdown prose: personality, voice, do/don't rules"),
        sourceNote: z
          .string()
          .optional()
          .describe('Source URL or description'),
      },
    },
    async ({ id, name, tokens, modes, direction, sourceNote }) => {
      try {
        if (
          (tokens !== undefined && !isTokenGroup(tokens)) ||
          (modes !== undefined && !isTokenGroup(modes))
        ) {
          return errorResult('tokens and modes must be objects of DTCG token groups.')
        }
        // Size caps: profiles are brand summaries that flow into every brief,
        // not document storage. Generous for real brands, refuses runaways.
        if (name.length > MAX_NAME_CHARS) {
          return errorResult(`name exceeds ${MAX_NAME_CHARS} characters.`)
        }
        if (direction && direction.length > MAX_DIRECTION_CHARS) {
          return errorResult(
            `direction exceeds ${MAX_DIRECTION_CHARS.toLocaleString('en-US')} characters. Keep it a distilled brief — trim boilerplate and long excerpts.`,
          )
        }
        if (sourceNote && sourceNote.length > MAX_SOURCE_NOTE_CHARS) {
          return errorResult(`sourceNote exceeds ${MAX_SOURCE_NOTE_CHARS} characters. A URL or one-line description is enough.`)
        }
        const tokensBytes = Buffer.byteLength(JSON.stringify({ tokens, modes }), 'utf8')
        if (tokensBytes > MAX_TOKENS_JSON_BYTES) {
          return errorResult(
            `tokens + modes serialize to ${Math.ceil(tokensBytes / 1024)} KB (max ${MAX_TOKENS_JSON_BYTES / 1024} KB). Send the distilled token set, not a full extracted stylesheet.`,
          )
        }
        // Everything here reaches other agents through briefs — refuse
        // credential-looking content in ANY field outright rather than
        // relying on masking (name and token values included).
        const tokenValues = [
          ...(tokens ? flattenTokens(tokens as DesignTokenGroup) : []),
          ...(modes?.light ? flattenTokens(modes.light as DesignTokenGroup) : []),
          ...(modes?.dark ? flattenTokens(modes.dark as DesignTokenGroup) : []),
        ].map((token) => String(token.value))
        for (const text of [name, direction, sourceNote, ...tokenValues]) {
          if (text && containsLikelySecret(text)) {
            return errorResult(
              'Profile fields cannot contain credential-like values.',
            )
          }
        }

        // Ownership policy (agents own only what agents created; any GUI
        // edit transfers ownership) is enforced by the store INSIDE its
        // write lock — checking it here would race a concurrent GUI save.
        const { action, profile: saved } = profiles.upsertFromAgent({
          id,
          name,
          tokens: tokens as DesignTokenGroup | undefined,
          modes: modes as
            | { light?: DesignTokenGroup; dark?: DesignTokenGroup }
            | undefined,
          direction,
          sourceNote,
        })
        return textResult({
          action,
          profile: {
            id: saved.id,
            name: saved.name,
            isDefault: saved.isDefault,
            origin: saved.origin,
          },
          summary: summarizeDesignProfile(saved),
          note: saved.isDefault
            ? 'Saved as the only profile, so it is the default. The user reviews it in Shelf (Design section).'
            : 'Saved as a draft. The user reviews it in Shelf (Design section) and chooses "Make default" there — agents cannot.',
          next: 'Call shelf_get_design_profile with this id to read back the rendered brief.',
        })
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
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
              text: JSON.stringify({ found: false, profileId: id }),
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
