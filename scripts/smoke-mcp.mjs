/**
 * MCP client smoke: upsert fixture → list → launch → logs → stop → remove.
 * Run: npm run smoke:mcp
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const requireCjs = createRequire(import.meta.url)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const serverEntry = path.join(root, 'dist-mcp/mcp/server.js')
const fixture = path.join(root, 'fixtures/sample-tool')
const smokeName = `MCP Smoke ${Date.now()}`
const smokeDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-mcp-smoke-'))

function parseToolText(result) {
  const text = result.content?.find((c) => c.type === 'text')?.text
  if (!text) throw new Error(`No text content: ${JSON.stringify(result)}`)
  if (result.isError) throw new Error(text)
  return JSON.parse(text)
}

async function callTool(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args })
  return parseToolText(result)
}

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverEntry],
    // The SDK intentionally forwards only a small default env allowlist.
    // Preserve the isolated SHELF_DATA_ROOT supplied by smoke:all.
    env: { ...process.env, SHELF_DATA_ROOT: smokeDataRoot },
    stderr: 'pipe',
  })

  const client = new Client({ name: 'shelf-smoke', version: '0.1.0' })
  await client.connect(transport)

  try {
    const upserted = await callTool(client, 'shelf_upsert_tool', {
      name: smokeName,
      description: 'Temporary MCP smoke fixture',
      tags: ['Fixtures', 'Smoke'],
      capabilities: ['serve a local smoke fixture', 'inspect local service logs'],
      agentAccess: [
        {
          kind: 'mcp',
          transport: 'stdio',
          entrypoint: 'node ./mcp/server.js',
          setupRequired: true,
          notes: 'Smoke metadata only.',
        },
      ],
      projectPath: fixture,
      launchCommand: 'PORT=8766 node server.mjs',
      url: 'http://127.0.0.1:8766',
      port: 8766,
      notes: 'Created by smoke-mcp. Safe to remove.',
      env: { SMOKE_SECRET_TOKEN: 'should-be-masked' },
    })
    console.log('upsert', upserted.action, upserted.tool.id)
    if (upserted.tool.env?.SMOKE_SECRET_TOKEN !== '***') {
      throw new Error('Expected secret env value to be masked in MCP output')
    }

    const free = await callTool(client, 'shelf_find_free_port', {
      preferred: 8766,
      from: 8700,
      to: 8800,
      count: 3,
    })
    if (!free.port || !Array.isArray(free.candidates)) {
      throw new Error('shelf_find_free_port returned unexpected shape')
    }
    console.log('OK: find_free_port', free.port)

    const toolId = upserted.tool.id
    const listed = await callTool(client, 'shelf_list_tools')
    if (!listed.tools.some((t) => t.id === toolId)) {
      throw new Error('upserted tool missing from shelf_list_tools')
    }
    console.log('OK: listed')

    const got = await callTool(client, 'shelf_get_tool', { id: toolId })
    if (got.tool.name !== smokeName) throw new Error('get_tool name mismatch')
    console.log('OK: get')

    const found = await callTool(client, 'shelf_find_capability', {
      task: 'I need to serve a local smoke fixture',
      accessKind: 'mcp',
    })
    if (found.matches?.[0]?.toolId !== toolId || !found.matches[0].reasons?.length) {
      throw new Error('shelf_find_capability did not return an explainable match')
    }
    console.log('OK: capability match')

    const readiness = await callTool(client, 'shelf_check_tool_readiness', { id: toolId })
    if (readiness.readiness?.state !== 'needs_setup') {
      throw new Error('Expected declared MCP access to need setup')
    }
    console.log('OK: capability readiness')

    const gapInput = {
      task: `Transcribe smoke audio ${smokeName}`,
      capabilities: [`transcribe smoke audio ${smokeName}`],
      reason: 'No Shelf fixture handles transcription.',
      relatedToolIds: [toolId, 'unknown-tool'],
      suggestedAccess: 'cli',
    }
    await callTool(client, 'shelf_record_capability_gap', gapInput)
    const repeated = await callTool(client, 'shelf_record_capability_gap', gapInput)
    if (repeated.action !== 'updated' || repeated.gap.occurrenceCount !== 2) {
      throw new Error('Expected repeated capability gap to deduplicate')
    }
    const gapList = await callTool(client, 'shelf_list_capability_gaps', { status: 'open' })
    const smokeGap = gapList.gaps.find((gap) => gap.capabilities.includes(gapInput.capabilities[0]))
    if (!smokeGap || smokeGap.relatedToolIds.includes('unknown-tool')) {
      throw new Error('Capability gap list or related-tool validation failed')
    }
    console.log('OK: capability gap')

    const briefResult = await callTool(client, 'shelf_get_gap_brief', { id: smokeGap.id })
    if (
      !briefResult.brief?.includes(gapInput.capabilities[0]) ||
      !briefResult.brief.includes('shelf_register_project') ||
      !briefResult.brief.includes(smokeGap.id)
    ) {
      throw new Error('Gap brief missing capabilities, register-back, or gap id')
    }
    console.log('OK: gap brief')

    const plannedGap = await callTool(client, 'shelf_update_capability_gap', {
      id: smokeGap.id,
      status: 'planned',
      relatedToolIds: [toolId, 'unknown-tool'],
    })
    if (
      plannedGap.gap.status !== 'planned' ||
      plannedGap.gap.relatedToolIds.includes('unknown-tool')
    ) {
      throw new Error('Agent planned-update failed or leaked an unknown tool id')
    }
    let resolveRejected = false
    try {
      await callTool(client, 'shelf_update_capability_gap', {
        id: smokeGap.id,
        status: 'resolved',
      })
    } catch {
      resolveRejected = true
    }
    if (!resolveRejected) {
      throw new Error('Agents must not be able to set a gap to resolved')
    }

    // Regression (0.9 review): an all-unknown relatedToolIds list must error,
    // not report success while attaching nothing.
    let unknownIdsRejected = false
    try {
      await callTool(client, 'shelf_update_capability_gap', {
        id: smokeGap.id,
        relatedToolIds: ['not-a-real-tool-id'],
      })
    } catch {
      unknownIdsRejected = true
    }
    if (!unknownIdsRejected) {
      throw new Error('All-unknown relatedToolIds must be rejected, not a silent no-op')
    }

    // Regression (0.9 review): agents must not reopen a USER-resolved gap by
    // re-marking it planned. Flip to resolved via the shared store (the GUI
    // path), then verify the agent update is refused.
    const { CapabilityGapStore } = requireCjs('../dist-electron/shared/capability-gap-store.js')
    new CapabilityGapStore(smokeDataRoot).updateStatus(smokeGap.id, 'resolved')
    let reopenRejected = false
    try {
      await callTool(client, 'shelf_update_capability_gap', {
        id: smokeGap.id,
        status: 'planned',
      })
    } catch {
      reopenRejected = true
    }
    if (!reopenRejected) {
      throw new Error('Agents must not reopen a user-resolved gap')
    }
    console.log('OK: gap agent update (planned only, no reopen, no silent no-op)')

    const inspected = await callTool(client, 'shelf_inspect_project', {
      projectPath: fixture,
    })
    if (!inspected.launchCommand || !Array.isArray(inspected.signals)) {
      throw new Error('shelf_inspect_project returned unexpected shape')
    }
    console.log('OK: inspect_project', inspected.launchCommand)

    // One-shot register against an independent temp project (the shared
    // fixture folder already belongs to the upserted tool above).
    const registerProj = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-mcp-register-'))
    fs.copyFileSync(
      path.join(fixture, 'server.mjs'),
      path.join(registerProj, 'server.mjs'),
    )
    fs.writeFileSync(
      path.join(registerProj, 'package.json'),
      JSON.stringify({
        name: 'mcp-register-fixture',
        private: true,
        scripts: { start: 'node server.mjs' },
      }),
    )
    try {
      const dry = await callTool(client, 'shelf_register_project', {
        projectPath: registerProj,
        dryRun: true,
      })
      if (dry.outcome !== 'dry_run' || dry.autoRunnable !== true) {
        throw new Error(`Unexpected dryRun result: ${dry.outcome}/${dry.autoRunnable}`)
      }
      const beforeRegister = await callTool(client, 'shelf_list_tools')
      const registered = await callTool(client, 'shelf_register_project', {
        projectPath: registerProj,
      })
      if (registered.outcome !== 'launched' || !registered.tool?.id) {
        throw new Error(
          `Expected launched, got ${registered.outcome}: ${registered.state?.message}`,
        )
      }
      const afterRegister = await callTool(client, 'shelf_list_tools')
      if (afterRegister.count !== beforeRegister.count + 1) {
        throw new Error('register_project must add exactly one tool')
      }
      await callTool(client, 'shelf_stop_tool', { id: registered.tool.id })
      await callTool(client, 'shelf_remove_tool', { id: registered.tool.id })
      console.log('OK: register_project one-shot')
    } finally {
      fs.rmSync(registerProj, { recursive: true, force: true })
    }

    const design = await callTool(client, 'shelf_get_design_md', { id: toolId })
    if (typeof design.found !== 'boolean') {
      throw new Error('shelf_get_design_md missing found flag')
    }
    console.log('OK: design_md', design.found)

    const collections = await callTool(client, 'shelf_list_collections')
    if (!Array.isArray(collections.collections)) {
      throw new Error('shelf_list_collections missing collections array')
    }
    console.log('OK: collections', collections.count)

    const launched = await callTool(client, 'shelf_launch_tool', { id: toolId })
    console.log('launch', launched.state.status, launched.state.message)
    if (launched.state.status !== 'running') {
      throw new Error(`Expected running, got ${launched.state.status}`)
    }

    const logs = await callTool(client, 'shelf_get_logs', { id: toolId, limit: 50 })
    if (!logs.lines.some((l) => String(l.text).includes('Sample tool listening'))) {
      throw new Error('Expected ready log line missing')
    }
    console.log('OK: logs')

    const stopped = await callTool(client, 'shelf_stop_tool', { id: toolId })
    if (stopped.state.status !== 'stopped') {
      throw new Error(`Expected stopped, got ${stopped.state.status}`)
    }
    console.log('OK: stop')

    const receiptList = await callTool(client, 'shelf_list_receipts', {
      id: toolId,
      limit: 10,
    })
    if (!Array.isArray(receiptList.receipts) || receiptList.receipts.length < 1) {
      throw new Error('Expected at least one run receipt after launch/stop')
    }
    console.log('OK: receipts', receiptList.count)

    // Provenance: the server must stamp receipts with the client identity it
    // learned from the initialize handshake (Client name above).
    const stamped = receiptList.receipts.find((r) => r.startedBy)
    if (!stamped || stamped.startedBy.kind !== 'mcp' || stamped.startedBy.client !== 'shelf-smoke') {
      throw new Error(
        `Expected receipt startedBy {kind:'mcp', client:'shelf-smoke'}, got ${JSON.stringify(stamped?.startedBy)}`,
      )
    }
    console.log('OK: receipt provenance', stamped.startedBy.client)

    await callTool(client, 'shelf_remove_tool', { id: toolId })
    const after = await callTool(client, 'shelf_list_tools')
    if (after.tools.some((t) => t.id === toolId)) {
      throw new Error('Tool still present after remove')
    }
    console.log('OK: mcp smoke passed')
  } finally {
    await client.close()
    fs.rmSync(smokeDataRoot, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
