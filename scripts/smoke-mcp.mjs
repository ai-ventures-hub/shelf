/**
 * MCP client smoke: upsert fixture → list → launch → logs → stop → remove.
 * Run: npm run smoke:mcp
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const serverEntry = path.join(root, 'dist-mcp/mcp/server.js')
const fixture = path.join(root, 'fixtures/sample-tool')
const smokeName = `MCP Smoke ${Date.now()}`

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
    env: { ...process.env },
    stderr: 'pipe',
  })

  const client = new Client({ name: 'shelf-smoke', version: '0.1.0' })
  await client.connect(transport)

  try {
    const upserted = await callTool(client, 'shelf_upsert_tool', {
      name: smokeName,
      description: 'Temporary MCP smoke fixture',
      tags: ['Fixtures', 'Smoke'],
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

    const inspected = await callTool(client, 'shelf_inspect_project', {
      projectPath: fixture,
    })
    if (!inspected.launchCommand || !Array.isArray(inspected.signals)) {
      throw new Error('shelf_inspect_project returned unexpected shape')
    }
    console.log('OK: inspect_project', inspected.launchCommand)

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

    await callTool(client, 'shelf_remove_tool', { id: toolId })
    const after = await callTool(client, 'shelf_list_tools')
    if (after.tools.some((t) => t.id === toolId)) {
      throw new Error('Tool still present after remove')
    }
    console.log('OK: mcp smoke passed')
  } finally {
    await client.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
