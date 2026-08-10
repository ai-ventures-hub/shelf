/**
 * Paste-ready agent brief for a capability gap ("Copy brief for your AI
 * tool"). The audience is the user's coding agent: lead with machine-usable
 * facts, end with register-back instructions so the built tool closes the
 * loop. Deterministic — output depends only on the gap + tools passed in.
 *
 * Built as named, composable sections (PLAN-0.9.md): v1.0 injects a Brand
 * section from the Design Engine here. Insert sections; never rewrite.
 */
import { deriveToolReadiness } from './capability-intelligence'
import type { CapabilityGap, Tool } from './types'

export interface GapBriefSection {
  id: string
  title: string
  body: string
}

function formatDay(iso: string): string {
  return iso.slice(0, 10)
}

export function buildGapBriefSections(
  gap: CapabilityGap,
  relatedTools: Tool[],
): GapBriefSection[] {
  const sections: GapBriefSection[] = []

  sections.push({
    id: 'task',
    title: 'Shelf capability gap — build brief',
    body: [
      `Task: ${gap.task}`,
      `Why existing tools are insufficient: ${gap.reason}`,
      `Requested ${gap.occurrenceCount} time${gap.occurrenceCount === 1 ? '' : 's'} (first ${formatDay(gap.createdAt)}, last ${formatDay(gap.lastRequestedAt)})`,
      gap.suggestedAccess
        ? `Suggested agent access for the new tool: ${gap.suggestedAccess}`
        : null,
    ]
      .filter((line) => line !== null)
      .join('\n'),
  })

  sections.push({
    id: 'capabilities',
    title: 'Requested capabilities',
    body: gap.capabilities.map((capability) => `- ${capability}`).join('\n'),
  })

  if (relatedTools.length > 0) {
    sections.push({
      id: 'related-tools',
      title: 'Related existing tools (extend rather than duplicate)',
      body: relatedTools
        .map((tool) => {
          const readiness = deriveToolReadiness(tool)
          return [
            `- ${tool.name}${tool.description ? ` — ${tool.description}` : ''}`,
            tool.projectPath ? `  - Project folder: ${tool.projectPath}` : null,
            tool.capabilities.length > 0
              ? `  - Capabilities: ${tool.capabilities.join(', ')}`
              : null,
            tool.agentAccess.length > 0
              ? `  - Declared access: ${Array.from(new Set(tool.agentAccess.map((a) => a.kind))).join(', ')}`
              : null,
            `  - Readiness: ${readiness.summary}`,
          ]
            .filter((line) => line !== null)
            .join('\n')
        })
        .join('\n'),
    })
  }

  if (gap.examples.length > 1) {
    sections.push({
      id: 'examples',
      title: 'Recent request examples',
      body: gap.examples
        .map((example) => `- ${example.task} (${formatDay(example.at)})`)
        .join('\n'),
    })
  }

  sections.push({
    id: 'register-back',
    title: 'When built: register it back to Shelf',
    body: [
      'Shelf is the local tool library this request came from. After the tool runs locally:',
      '',
      '1. While building, mark the gap planned:',
      `   \`shelf_update_capability_gap\` with \`{ "id": "${gap.id}", "status": "planned" }\``,
      '2. Register the finished tool (inspect → save → launch in one call):',
      '   `shelf_register_project` with the project\'s absolute folder path',
      '3. Set the requested capabilities on the registered tool via `shelf_upsert_tool`:',
      `   \`"capabilities": ${JSON.stringify(gap.capabilities)}\``,
      '',
      'Do NOT mark the gap resolved — Shelf suggests resolution to the user once a',
      'registered tool covers the requested capabilities, and the user confirms.',
    ].join('\n'),
  })

  return sections
}

export function renderGapBrief(sections: GapBriefSection[]): string {
  return sections
    .map((section, index) =>
      index === 0
        ? `## ${section.title}\n${section.body}`
        : `### ${section.title}\n${section.body}`,
    )
    .join('\n\n')
}

export function buildGapBrief(gap: CapabilityGap, relatedTools: Tool[]): string {
  return renderGapBrief(buildGapBriefSections(gap, relatedTools))
}
