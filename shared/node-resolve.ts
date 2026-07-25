/**
 * Resolve an absolute Node binary for MCP client configs (Claude, Cursor, …).
 * Prefer filesystem candidates over login shells — those can hang on nvm/pyenv hooks.
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Common install locations — checked before any shell so Connect never hangs. */
function candidateNodePaths(): string[] {
  const home = os.homedir()
  const out = [
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
    path.join(home, '.local', 'bin', 'node'),
  ]
  // Newest nvm / fnm builds without spawning a login shell.
  try {
    const nvmVersions = path.join(home, '.nvm', 'versions', 'node')
    if (fs.existsSync(nvmVersions)) {
      const dirs = fs
        .readdirSync(nvmVersions)
        .filter((d) => d.startsWith('v'))
        .sort()
        .reverse()
      for (const dir of dirs.slice(0, 5)) {
        out.push(path.join(nvmVersions, dir, 'bin', 'node'))
      }
    }
  } catch {
    // ignore
  }
  try {
    const fnm = path.join(home, '.local', 'share', 'fnm', 'node-versions')
    if (fs.existsSync(fnm)) {
      const dirs = fs.readdirSync(fnm).sort().reverse()
      for (const dir of dirs.slice(0, 5)) {
        out.push(path.join(fnm, dir, 'installation', 'bin', 'node'))
      }
    }
  } catch {
    // ignore
  }
  return out
}

export async function resolveNodeCommand(): Promise<{
  command: string
  ok: boolean
  path?: string
}> {
  for (const candidate of candidateNodePaths()) {
    if (candidate && fs.existsSync(candidate)) {
      return { command: candidate, ok: true, path: candidate }
    }
  }

  // Non-login shell with a hard timeout (login shells have hung Connect on "Checking…").
  try {
    const { stdout } = await execFileAsync('/bin/zsh', ['-c', 'command -v node'], {
      timeout: 2_500,
      env: process.env,
    })
    const nodePath = stdout.trim().split('\n')[0]?.trim()
    if (nodePath && fs.existsSync(nodePath)) {
      return { command: nodePath, ok: true, path: nodePath }
    }
  } catch {
    // fall through
  }

  return {
    command: 'node',
    ok: false,
    path: undefined,
  }
}
