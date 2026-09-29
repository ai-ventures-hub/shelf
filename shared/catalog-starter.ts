import type { Tool } from './contracts'
import { normalizeCatalog } from './team-catalog'
import { detectGitRemote } from './tool-share-git'
import { containsLikelySecret } from './capability-intelligence'

export function validateCatalogStarter(content: string): string {
  if (typeof content !== 'string' || Buffer.byteLength(content) > 512 * 1024)
    throw new Error('Catalog is too large.')
  const result = normalizeCatalog(JSON.parse(content))
  if (!result.catalog.name?.trim()) throw new Error('Give this team catalog a name.')
  if (result.warnings.length) throw new Error(result.warnings.join(' '))
  const output = JSON.stringify(result.catalog, null, 2) + '\n'
  // Check what will be written, after normalization strips invisible
  // characters: a zero-width space inside a token hides it from a check
  // on the raw input, and stripping then rebuilds the live credential.
  if (containsLikelySecret(content) || containsLikelySecret(output))
    throw new Error('The catalog appears to contain a credential. Remove it before exporting.')
  return output
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
