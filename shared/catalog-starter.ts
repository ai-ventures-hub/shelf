import type { Tool } from './contracts'
import { normalizeCatalog } from './team-catalog'
import { detectGitRemote } from './tool-share-git'
import { containsLikelySecret } from './capability-intelligence'

export function validateCatalogStarter(content: string): string {
  if (typeof content !== 'string' || Buffer.byteLength(content) > 512 * 1024)
    throw new Error('Catalog is too large.')
  if (containsLikelySecret(content))
    throw new Error('The catalog appears to contain a credential. Remove it before exporting.')
  const result = normalizeCatalog(JSON.parse(content))
  if (!result.catalog.name?.trim()) throw new Error('Give this team catalog a name.')
  if (result.warnings.length) throw new Error(result.warnings.join(' '))
  return JSON.stringify(result.catalog, null, 2) + '\n'
}

/** Reuse the catalog format and Git remote validation; never export launch/env data. */
export async function prepareCatalogStarter(
  name: string,
  tools: Tool[],
): Promise<{ content: string; warnings: string[] }> {
  if (typeof name !== 'string' || !name.trim()) throw new Error('Give this team catalog a name.')
  const warnings: string[] = []
  const entries = []
  for (const tool of tools) {
    const repo =
      tool.source?.repo || (tool.projectPath ? await detectGitRemote(tool.projectPath) : null)
    if (!repo) {
      warnings.push(`${tool.name}: no Git remote found; left out of the catalog.`)
      continue
    }
    entries.push({
      name: tool.name,
      description: tool.description,
      capabilities: tool.capabilities,
      repo,
    })
  }
  return {
    content: validateCatalogStarter(JSON.stringify({ shelfCatalog: 1, name, tools: entries })),
    warnings,
  }
}
