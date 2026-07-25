/**
 * Resolve a project-local DESIGN.md for Community agent/UI bridge.
 * Silent when missing — never throws for “not found”.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { DesignMdResult } from './types'

const CANDIDATES = ['DESIGN.md', 'design.md', 'Design.md']

/**
 * Look for DESIGN.md in projectPath, then one parent directory.
 */
export function resolveDesignMd(
  projectPath?: string,
  toolId?: string,
): DesignMdResult {
  const base: DesignMdResult = {
    found: false,
    projectPath: projectPath || undefined,
    toolId,
  }
  if (!projectPath?.trim()) return base

  const roots = [projectPath, path.dirname(projectPath)]
  for (const root of roots) {
    if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) continue
    for (const name of CANDIDATES) {
      const filePath = path.join(root, name)
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) continue
      try {
        const content = fs.readFileSync(filePath, 'utf8')
        return {
          found: true,
          path: filePath,
          content,
          projectPath,
          toolId,
        }
      } catch {
        return {
          found: true,
          path: filePath,
          content: '',
          projectPath,
          toolId,
        }
      }
    }
  }
  return base
}
