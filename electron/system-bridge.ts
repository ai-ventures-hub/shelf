import { shell } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { agentLauncherScript, type StarterAgentCli } from '../shared/tool-starter'

/**
 * macOS system bridges — prefer `open` over AppleScript to avoid Automation prompts.
 */
export async function openUrl(url: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('URL is invalid.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Shelf only opens http:// and https:// tool URLs.')
  }
  await shell.openExternal(parsed.toString())
}

export async function openPath(targetPath: string): Promise<void> {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Path does not exist: ${targetPath}`)
  }
  await shell.openPath(targetPath)
}

/** Prefer Cursor, then VS Code, then default folder open. */
export async function openEditor(projectPath: string): Promise<void> {
  if (!projectPath || !fs.existsSync(projectPath)) {
    throw new Error('Project folder is missing.')
  }

  const apps = ['Cursor', 'Visual Studio Code']
  for (const app of apps) {
    const ok = await tryOpenApp(app, projectPath)
    if (ok) return
  }

  await shell.openPath(projectPath)
}

export async function openTerminal(projectPath: string): Promise<void> {
  if (!projectPath || !fs.existsSync(projectPath)) {
    throw new Error('Project folder is missing.')
  }

  // `open -a Terminal` with a folder opens a shell there on recent macOS.
  await new Promise<void>((resolve, reject) => {
    const child = spawn('open', ['-a', 'Terminal', projectPath], {
      stdio: 'ignore',
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Terminal open exited with code ${code}`))
    })
  })
}

function tryOpenApp(appName: string, target: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('open', ['-a', appName, target], { stdio: 'ignore' })
    child.on('error', () => resolve(false))
    child.on('exit', (code) => resolve(code === 0))
  })
}

/** Launch a macOS .app by name (e.g. Claude Desktop). */
export async function openApp(appName: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('open', ['-a', appName], { stdio: 'ignore' })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Could not open ${appName}. Is it installed?`))
    })
  })
}

/**
 * Open a coding agent in a tool's folder with the starter's kickoff prompt.
 * Writes a one-shot .command script (see agentLauncherScript) and hands it
 * to Terminal with `open`, so no Automation permission is involved.
 */
export async function openAgentInTerminal(folder: string, agent: StarterAgentCli): Promise<void> {
  if (!folder || !fs.existsSync(folder)) throw new Error('Project folder is missing.')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-agent-'))
  const script = path.join(dir, 'start-agent.command')
  fs.writeFileSync(script, agentLauncherScript(folder, agent), { mode: 0o700 })
  await new Promise<void>((resolve, reject) => {
    const child = spawn('open', ['-a', 'Terminal', script], { stdio: 'ignore' })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Terminal open exited with code ${code}`))))
  })
}
