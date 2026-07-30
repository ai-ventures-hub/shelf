import { spawn } from 'node:child_process'

/**
 * Deep-process-tree fixture: spawns server.mjs DETACHED so the listener sits
 * in its own process group (like npm→vite workers or zsh job control) while
 * remaining a descendant of this wrapper. Forwards SIGTERM/SIGINT to the
 * child's group the way real runners do.
 */
const child = spawn(process.execPath, ['server.mjs'], {
  detached: true,
  stdio: 'inherit',
  env: process.env,
})

function forward(signal) {
  try {
    process.kill(-child.pid, signal)
  } catch {
    // group already gone
  }
  try {
    child.kill(signal)
  } catch {
    // child already gone
  }
  setTimeout(() => process.exit(0), 300)
}

process.on('SIGTERM', () => forward('SIGTERM'))
process.on('SIGINT', () => forward('SIGINT'))
child.on('exit', () => process.exit(0))
