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
        // Numeric, newest first: a string sort ranks v9 above v22.
        .sort(compareVersionsDescending)
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
      const dirs = fs.readdirSync(fnm).sort(compareVersionsDescending)
      for (const dir of dirs.slice(0, 5)) {
        out.push(path.join(fnm, dir, 'installation', 'bin', 'node'))
      }
    }
  } catch {
    // ignore
  }
  return out
}

function compareVersionsDescending(a: string, b: string): number {
  const parts = (value: string) => value.replace(/^v/, '').split('.').map((part) => Number.parseInt(part, 10) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0)
  }
  return 0
}

/**
 * Whether the login shell Shelf launches tools with finds `node` on its own.
 * Then a tool's command can say `node` and keep working across Node upgrades.
 */
export async function loginShellHasNode(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('/bin/zsh', ['-lc', 'command -v node'], { timeout: 2_500, env: process.env })
    return Boolean(stdout.trim())
  } catch {
    return false
  }
}

export interface ResolvedNodeCommand {
  command: string
  ok: boolean
  path?: string
  /** Extra env the MCP entry must carry (Electron-as-Node fallback). */
  env?: Record<string, string>
}

export async function resolveNodeCommand(): Promise<ResolvedNodeCommand> {
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

  // Last resort: Shelf ships its own Node runtime inside Electron. Running
  // the app binary with ELECTRON_RUN_AS_NODE turns "install Node 20+ first"
  // into zero-step success on Macs with no dev toolchain.
  if (process.versions.electron && process.execPath && fs.existsSync(process.execPath)) {
    return {
      command: process.execPath,
      ok: true,
      path: process.execPath,
      env: { ELECTRON_RUN_AS_NODE: '1' },
    }
  }

  return {
    command: 'node',
    ok: false,
    path: undefined,
  }
}
