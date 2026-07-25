import { shell } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'

/**
 * macOS system bridges — prefer `open` over AppleScript to avoid Automation prompts.
 */
export async function openUrl(url: string): Promise<void> {
  await shell.openExternal(url)
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
