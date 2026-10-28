import { app, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { detectInstalledClients } from '../../shared/mcp-client-detect'
import { loginShellHasNode, resolveNodeCommand } from '../../shared/node-resolve'
import {
  createToolProject,
  defaultToolsRoot,
  detectAgentClis,
  pickStarterPort,
  STARTER_KICKOFF_PROMPT,
} from '../../shared/tool-starter'
import * as system from '../system-bridge'
import type { IpcContext } from './context'
import { handle } from './typed'

/**
 * Start a new tool from an idea. Creation is a user action here, so the
 * tool is saved directly; nothing is installed or launched.
 */
export function registerStarterIpc(ctx: IpcContext): void {
  const { store, prefs, designProfiles, toolDrafts } = ctx

  handle('starter:prepare', async () => {
    const [clis, port] = await Promise.all([
      detectAgentClis(),
      pickStarterPort([...store.list(), ...toolDrafts.list()]).catch(() => null),
    ])
    const cursor = detectInstalledClients().some((client) => client.kind === 'cursor' && client.installed)
    return {
      toolsRoot: defaultToolsRoot(),
      port,
      agents: [
        { id: 'claude-code' as const, installed: clis['claude-code'] },
        { id: 'codex' as const, installed: clis.codex },
        { id: 'cursor' as const, installed: cursor },
      ],
    }
  })
  handle('starter:create', async (_e, input) => {
    if (!input || typeof input !== 'object') throw new Error('Describe the tool to start.')
    const uiPrefs = prefs.get()
    // Prefer plain `node`, which survives Node upgrades and reads the same
    // on a coworker's Mac; pin a path only when the launch shell lacks node.
    const node = await loginShellHasNode() ? { ok: true, command: 'node', env: undefined } : await resolveNodeCommand()
    return createToolProject({
      name: String(input.name ?? ''),
      idea: String(input.idea ?? ''),
      parentDir: typeof input.parentDir === 'string' ? input.parentDir : undefined,
      port: typeof input.port === 'number' ? input.port : undefined,
      designProfileId: input.designProfileId === null ? null : typeof input.designProfileId === 'string' ? input.designProfileId : undefined,
    }, {
      store,
      designProfiles,
      drafts: toolDrafts,
      nodeCommand: { command: node.ok ? node.command : 'node', env: node.env },
      toolDefaults: {
        iconColor: uiPrefs.defaultIconColor,
        iconBackground: uiPrefs.defaultIconBackground,
      },
    })
  })
  handle('starter:chooseFolder', async () => {
    const root = defaultToolsRoot()
    const result = await dialog.showOpenDialog(ctx.getMainWindow()!, {
      title: 'Choose where new tools go',
      buttonLabel: 'Use this folder',
      defaultPath: fs.existsSync(root) ? root : app.getPath('home'),
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : result.filePaths[0] || null
  })
  handle('starter:openAgent', async (_e, toolId, agent) => {
    const folder = store.get(toolId)?.projectPath
    if (!folder || !fs.existsSync(folder)) throw new Error('This tool has no project folder on this Mac.')
    // The kickoff prompt points at AGENTS.md, so only offer it where one exists.
    if (!fs.existsSync(path.join(folder, 'AGENTS.md'))) throw new Error('This project has no AGENTS.md build brief.')
    if (agent === 'claude-code' || agent === 'codex') await system.openAgentInTerminal(folder, agent)
    else if (agent === 'cursor') await system.openEditor(folder)
    else if (agent === 'terminal') await system.openTerminal(folder)
    else throw new Error('Choose Claude Code, Codex, Cursor, or Terminal.')
    return { prompt: STARTER_KICKOFF_PROMPT }
  })
}
