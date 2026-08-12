/**
 * Paste-ready brand brief for a design profile — the markdown half of
 * shelf_get_design_profile and the shelf://design/profiles/{id} resource.
 * Same composable-sections philosophy as gap-brief.ts: named sections,
 * heading level by position, deterministic output.
 *
 * Free-text fields (direction, a project's DESIGN.md) pass through
 * maskSecrets before reaching agents; tokens and asset paths are structured.
 */
import { maskSecrets } from './types'
import type { DesignMdResult, DesignProfile, DesignToken, DesignTokenGroup } from './types'
import { isDesignToken } from './types'
import type { GapBriefSection } from './gap-brief'

export interface DesignBriefSection {
  id: string
  title: string
  body: string
}

export interface FlatToken {
  path: string
  value: string | number
  type?: string
}

/** Depth-first flatten of a DTCG group into dot-path leaves. */
export function flattenTokens(group: DesignTokenGroup, prefix = ''): FlatToken[] {
  const out: FlatToken[] = []
  for (const [key, node] of Object.entries(group)) {
    // Hand-edited files can hold nulls/primitives where groups belong — skip,
    // never throw (agents read these through briefs).
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue
    const tokenPath = prefix ? `${prefix}.${key}` : key
    if (isDesignToken(node)) {
      out.push({ path: tokenPath, value: (node as DesignToken).$value, type: node.$type })
    } else {
      out.push(...flattenTokens(node as DesignTokenGroup, tokenPath))
    }
  }
  return out
}

function tokensInGroup(profile: DesignProfile, group: string): FlatToken[] {
  const node = profile.tokens[group]
  if (!node || isDesignToken(node)) return []
  return flattenTokens(node as DesignTokenGroup, group)
}

function overrideFor(modeGroup: DesignTokenGroup, tokenPath: string): string | number | undefined {
  const flat = flattenTokens(modeGroup)
  return flat.find((token) => token.path === tokenPath)?.value
}

/** Deterministic one-liner for shelf_list_design_profiles. */
export function summarizeDesignProfile(profile: DesignProfile): string {
  const colors = tokensInGroup(profile, 'color').length
  const lightOverrides = flattenTokens(profile.modes.light).length
  const families = tokensInGroup(profile, 'typography')
    .filter((token) => token.type === 'fontFamily')
    .map((token) => String(token.value).split(',')[0].trim())
  const parts = [
    colors > 0
      ? `${colors} color${colors === 1 ? '' : 's'}${lightOverrides > 0 ? ' (dark+light)' : ''}`
      : null,
    families.length > 0 ? families.join(' / ') : null,
    profile.assets.length > 0
      ? `${profile.assets.length} asset${profile.assets.length === 1 ? '' : 's'}`
      : null,
    profile.direction ? `direction: ${profile.direction.length} chars` : null,
  ].filter((part) => part !== null)
  return parts.join(' · ') || 'empty profile'
}

function renderTokenLines(profile: DesignProfile, group: string): string {
  const base = tokensInGroup(profile, group)
  if (base.length === 0) return '(none defined)'
  return base
    .map((token) => {
      const light = overrideFor(profile.modes.light, token.path)
      const dark = overrideFor(profile.modes.dark, token.path)
      const overrides = [
        light !== undefined && light !== token.value ? `light: ${light}` : null,
        dark !== undefined && dark !== token.value ? `dark: ${dark}` : null,
      ].filter((part) => part !== null)
      const name = token.path.replace(`${group}.`, '')
      return `- ${name}: ${token.value}${overrides.length > 0 ? ` (${overrides.join(', ')})` : ''}`
    })
    .join('\n')
}

export function buildDesignBriefSections(
  profile: DesignProfile,
  opts: { designMd?: DesignMdResult } = {},
): DesignBriefSection[] {
  const sections: DesignBriefSection[] = []

  sections.push({
    id: 'identity',
    title: `Design profile: ${profile.name}`,
    body: [
      `This is the user's brand/design source of truth${profile.isDefault ? ' (default profile)' : ''}.`,
      'Apply these tokens and this direction to what you build unless the project itself overrides them.',
      profile.sourceNote ? `Source: ${maskSecrets(profile.sourceNote)}` : null,
      `Last updated: ${profile.updatedAt.slice(0, 10)}`,
    ]
      .filter((line) => line !== null)
      .join('\n'),
  })

  sections.push({
    id: 'colors',
    title: 'Colors (base values; per-mode overrides in parentheses)',
    body: renderTokenLines(profile, 'color'),
  })

  sections.push({
    id: 'typography',
    title: 'Typography',
    body: renderTokenLines(profile, 'typography'),
  })

  sections.push({
    id: 'dimension',
    title: 'Dimension (radii, layout)',
    body: renderTokenLines(profile, 'dimension'),
  })

  // Profiles may carry custom top-level groups (arbitrary DTCG imports) —
  // a "complete" brief must not silently drop them.
  const knownPrefixes = ['color.', 'typography.', 'dimension.']
  const otherTokens = flattenTokens(profile.tokens).filter(
    (token) => !knownPrefixes.some((prefix) => token.path.startsWith(prefix)),
  )
  if (otherTokens.length > 0) {
    sections.push({
      id: 'other-tokens',
      title: 'Other tokens',
      body: otherTokens.map((token) => `- ${token.path}: ${token.value}`).join('\n'),
    })
  }

  if (profile.direction) {
    sections.push({
      id: 'direction',
      title: 'Direction (voice, personality, do/don\'t)',
      body: maskSecrets(profile.direction),
    })
  }

  if (profile.assets.length > 0) {
    sections.push({
      id: 'assets',
      title: 'Brand assets (absolute paths on this machine)',
      body: profile.assets
        .map((asset) => `- ${asset.kind}: ${asset.path} (${asset.mime})`)
        .join('\n'),
    })
  }

  if (opts.designMd?.found) {
    sections.push({
      id: 'project-design-md',
      title: "This project's DESIGN.md (wins on conflict)",
      body: [
        'The project ships its own design doc. Project specifics override the brand defaults above.',
        opts.designMd.path ? `Path: ${opts.designMd.path}` : null,
        '',
        opts.designMd.content
          ? maskSecrets(opts.designMd.content)
          : '(file present but empty or unreadable — read it before styling)',
      ]
        .filter((line) => line !== null)
        .join('\n'),
    })
  }

  return sections
}

export function renderDesignBrief(sections: DesignBriefSection[]): string {
  return sections
    .map((section, index) =>
      index === 0
        ? `## ${section.title}\n${section.body}`
        : `### ${section.title}\n${section.body}`,
    )
    .join('\n\n')
}

export function buildDesignBrief(
  profile: DesignProfile,
  opts: { designMd?: DesignMdResult } = {},
): string {
  return renderDesignBrief(buildDesignBriefSections(profile, opts))
}

/**
 * Condensed Brand section for gap briefs — enough to keep a build on-brand,
 * with a pointer to the full profile. Never the whole brief (briefs must
 * stay scannable).
 */
export function buildBrandSectionForGapBrief(profile: DesignProfile): GapBriefSection {
  const colors = tokensInGroup(profile, 'color').slice(0, 6)
  const families = tokensInGroup(profile, 'typography')
    .filter((token) => token.type === 'fontFamily')
    .map((token) => String(token.value).split(',')[0].trim())
  const directionLead = maskSecrets(profile.direction).split('\n').find((line) => line.trim()) || ''
  return {
    id: 'brand',
    title: 'Brand (Shelf Design Engine)',
    body: [
      `Build this on-brand with the user's "${profile.name}" design profile.`,
      colors.length > 0
        ? `Key colors: ${colors.map((token) => `${token.path.replace('color.', '')} ${token.value}`).join(', ')}`
        : null,
      families.length > 0 ? `Fonts: ${families.join(' / ')}` : null,
      directionLead ? `Direction: ${directionLead}` : null,
      'Call `shelf_get_design_profile` (zero arguments resolves the default profile) for full tokens and the complete brand brief.',
    ]
      .filter((line) => line !== null)
      .join('\n'),
  }
}
