/**
 * The MCP side of Start a new tool: the new-tool prompt hands an agent the
 * recipe (free port, default design profile, contract, register through a
 * draft), and removing a tool over MCP clears its memory and idle
 * verification history. Real stdio server, isolated data root.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const require = createRequire(import.meta.url)
const { LibraryStore } = require('../dist-electron/shared/library-store')
const { DesignProfileStore } = require('../dist-electron/shared/design-profile-store')
const { ProjectMemoryStore } = require('../dist-electron/shared/project-memory-store')
const { VerificationStore } = require('../dist-electron/shared/verification-store')

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-mcp-new-tool-'))
const store = new LibraryStore(dataRoot)
const profile = new DesignProfileStore(dataRoot).save({ name: 'Acme', isDefault: true, tokens: { color: { brand: { $value: '#c2410c', $type: 'color' } } } })
const taken = store.save({ id: '', name: 'Taken', tags: [], capabilities: [], agentAccess: [], favorite: false, projectPath: dataRoot, launchCommand: 'true', port: 4400, createdAt: '', updatedAt: '' })

const client = new Client({ name: 'shelf-new-tool-smoke', version: '0.1.0' })
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: ['dist-mcp/mcp/server.js'],
  env: { ...process.env, SHELF_DATA_ROOT: dataRoot },
  stderr: 'ignore',
}))

try {
  const { prompts } = await client.listPrompts()
  const listed = prompts.find((prompt) => prompt.name === 'new-tool')
  assert.ok(listed, 'new-tool is listed')
  assert.deepEqual(listed.arguments.map((arg) => [arg.name, Boolean(arg.required)]), [['idea', true], ['name', false]])

  const named = await client.getPrompt({ name: 'new-tool', arguments: { idea: 'Turn client photos into web-ready images.', name: 'Photo Prepper' } })
  const text = named.messages[0].content.text
  assert.ok(text.includes(path.join(os.homedir(), 'Shelf Tools', 'Photo Prepper')), 'names the folder under ~/Shelf Tools')
  assert.match(text, /Use port 44\d\d\./)
  assert.ok(!text.includes('Use port 4400.'), 'skips a port another library tool claims')
  assert.ok(text.includes(profile.id) && text.includes('shelf_get_design_profile'), 'points at the default profile')
  assert.ok(text.includes('shelf_register_project'), 'ends with a registration the user accepts')
  assert.ok(text.includes('## Shelf tool contract') && text.includes('Turn client photos into web-ready images.'))
  assert.ok(!text.includes('Shelf tool id'), 'no tool exists yet')
  const unnamed = await client.getPrompt({ name: 'new-tool', arguments: { idea: 'Track invoices.' } })
  assert.ok(unnamed.messages[0].content.text.includes('choose a short, title-case name'))
  console.log('OK: the new-tool prompt carries a free port, the default profile, and the contract')

  // Folder changes need acceptance too; siblings store the accepted spelling.
  const accepted = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-accepted-')))
  const unaccepted = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-unaccepted-'))
  const link = path.join(os.tmpdir(), `shelf-accepted-link-${Date.now()}`)
  fs.symlinkSync(accepted, link)
  try {
    const home = store.save({ id: '', name: 'Home', tags: [], capabilities: [], agentAccess: [], favorite: false, projectPath: accepted, launchCommand: 'true', createdAt: '', updatedAt: '' })
    const moved = await client.callTool({ name: 'shelf_upsert_tool', arguments: { id: home.id, projectPath: unaccepted, launchCommand: 'touch MARKER' } })
    assert.ok(moved.isError && /needs the user's review/.test(moved.content[0].text), JSON.stringify(moved.content))
    assert.equal(new LibraryStore(dataRoot).get(home.id).projectPath, accepted, 'the folder did not change')
    const sibling = await client.callTool({ name: 'shelf_upsert_tool', arguments: { name: 'Sibling API', projectPath: link, launchCommand: 'true' } })
    assert.ok(!sibling.isError, JSON.stringify(sibling.content))
    const saved = new LibraryStore(dataRoot).list().find((tool) => tool.name === 'Sibling API')
    assert.equal(saved.projectPath, accepted, 'a sibling stores the accepted folder, not a retargetable symlink')
    console.log('OK: upsert refuses moves to unaccepted folders and stores accepted spellings')
  } finally {
    fs.rmSync(link, { force: true })
  }

  // Removing a tool clears its notes and idle verification history.
  new ProjectMemoryStore(dataRoot).save({ toolId: taken.id, expectedRevision: null, fields: { purpose: 'temporary', conventions: '', decisions: '', knownIssues: '', nextSteps: '' } })
  new VerificationStore(dataRoot).save({ toolId: taken.id, expectedRevision: null, steps: [{ id: '0f8fad5b-d9cb-469f-a165-70867728950e', label: 'Test', command: 'true', timeoutSeconds: 60 }] })
  const removed = await client.callTool({ name: 'shelf_remove_tool', arguments: { id: taken.id } })
  assert.ok(!removed.isError, JSON.stringify(removed.content))
  assert.equal(new ProjectMemoryStore(dataRoot).get(taken.id), null)
  assert.equal(new VerificationStore(dataRoot).get(taken.id).workflow, null)
  console.log('OK: shelf_remove_tool clears memory and idle verification history')

  console.log('OK: MCP new-tool smoke passed')
} finally {
  await client.close()
  fs.rmSync(dataRoot, { recursive: true, force: true })
}
