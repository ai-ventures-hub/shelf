/** Project memory and handoffs use only disposable local fixtures. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
const require = createRequire(import.meta.url)
const { ProjectMemoryStore } = require('../dist-electron/shared/project-memory-store')
const { LibraryStore } = require('../dist-electron/shared/library-store')
const { ReceiptStore } = require('../dist-electron/shared/receipt-store')
const { RunLogStore } = require('../dist-electron/shared/run-log-store')
const { DesignProfileStore } = require('../dist-electron/shared/design-profile-store')
const { prepareProjectHandoff } = require('../dist-electron/shared/project-handoff')
const environmentModule = require('../dist-electron/shared/tool-environment')
const {
  emptyProjectMemory,
} = require('../dist-electron/shared/project-context-contracts')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-phase4-'))
let client
try {
  const library = new LibraryStore(root)
  const memory = new ProjectMemoryStore(root)
  const otherWriter = new ProjectMemoryStore(root)
  const receipts = new ReceiptStore(root)
  const design = new DesignProfileStore(root)
  const services = { library, memory, receipts, design }
  const secret = 'phase4-synthetic-private-value'
  const tool = library.save({
    name: 'Project context fixture',
    projectPath: root,
    launchCommand: 'echo review-only',
    env: { CUSTOM_AUTH: secret },
  })
  assert.equal(memory.get(tool.id), null)
  assert.equal(
    fs.existsSync(path.join(root, 'project-memory.json')),
    false,
    'reads do not initialize memory files',
  )
  const fields = {
    ...emptyProjectMemory(),
    purpose: 'Fixture project',
    conventions: '<script>literal text</script>',
    decisions: 'Use existing architecture.',
    knownIssues: `Auth failed: ${secret}`,
    nextSteps: 'Reproduce before editing.',
  }
  const first = memory.save({
    toolId: tool.id,
    expectedRevision: null,
    fields,
  })
  assert.deepEqual(otherWriter.get(tool.id), first, 'separate store sees persisted notes')
  assert.equal(fs.statSync(path.join(root, 'project-memory.json')).mode & 0o777, 0o600)
  assert.throws(
    () => otherWriter.save({ toolId: tool.id, expectedRevision: null, fields }),
    /changed elsewhere/,
  )
  const second = otherWriter.save({
    toolId: tool.id,
    expectedRevision: first.revision,
    fields: { ...fields, nextSteps: 'New session plan' },
  })
  assert.notEqual(first.revision, second.revision)
  assert.throws(
    () =>
      memory.save({
        toolId: tool.id,
        expectedRevision: first.revision,
        fields,
      }),
    /changed elsewhere/,
  )
  assert.throws(() =>
    memory.save({
      toolId: tool.id,
      expectedRevision: second.revision,
      fields: { ...fields, purpose: 'x'.repeat(4001) },
    }),
  )
  assert.throws(() =>
    memory.save({
      toolId: tool.id,
      expectedRevision: second.revision,
      fields,
      unexpected: true,
    }),
  )
  assert.equal(memory.get(tool.id).revision, second.revision)
  console.log(
    'OK: persisted memory, private file, revision conflicts, bounded and strict inputs',
  )

  const before = fs.readFileSync(path.join(root, 'library.json'), 'utf8')
  let result = await prepareProjectHandoff(services, tool.id, {
    task: `Investigate ${secret}`,
  })
  assert.equal(result.memoryRevision, second.revision)
  assert.match(result.markdown, /New session plan/)
  assert.match(result.markdown, /Environment checks: not included/)
  assert.match(result.markdown, /Run evidence: not included/)
  assert.ok(!result.markdown.includes(secret))
  assert.match(result.markdown, /not permission/)
  assert.equal(fs.readFileSync(path.join(root, 'library.json'), 'utf8'), before)
  assert.equal(receipts.list().length, 0, 'handoff never launches a tool')

  const runLogs = new RunLogStore(root)
  const runId = runLogs.begin(tool.id)
  receipts.begin({
    id: runId,
    toolId: tool.id,
    toolName: tool.name,
    launchCommand: 'echo historic-command',
  })
  receipts.end(runId, {
    outcome: 'failed',
    exitCode: 7,
    message: 'Fixture failure',
  })
  runLogs.append(
    tool.id,
    Array.from({ length: 120 }, (_, i) => ({
      toolId: tool.id,
      stream: 'stdout',
      text: `line ${i}: ${secret}`,
      at: new Date().toISOString(),
    })),
    runId,
  )
  result = await prepareProjectHandoff(services, tool.id, {
    runId,
    includeLogs: true,
    includeEnvironment: true,
    includeDesign: true,
  })
  assert.match(result.markdown, /historic-command/)
  assert.match(result.markdown, /Recorded outcome: failed/)
  assert.match(result.markdown, /Exit code: 7/)
  assert.match(result.markdown, /earlier output omitted/)
  assert.ok(!result.markdown.includes(secret))
  assert.ok(!result.markdown.includes('line 0:'))
  assert.match(result.markdown, /## Environment checks/)
  assert.match(result.markdown, /## Design context/)
  const noLogs = await prepareProjectHandoff(services, tool.id, { runId })
  assert.ok(!noLogs.markdown.includes('line 119'))
  assert.match(noLogs.markdown, /Run output: not included/)
  await assert.rejects(
    prepareProjectHandoff(services, tool.id, { includeLogs: true }),
    /Choose a run/,
  )
  await assert.rejects(
    prepareProjectHandoff(services, tool.id, { runId: '../../etc/passwd' }),
  )
  const other = library.save({
    name: 'Other fixture',
    launchCommand: 'echo untouched',
  })
  await assert.rejects(
    prepareProjectHandoff(services, other.id, { runId }),
    /selected run/,
  )
  receipts.clear({ toolId: tool.id })
  await assert.rejects(
    prepareProjectHandoff(services, tool.id, { runId }),
    /selected run/,
  )
  console.log(
    'OK: read-only handoffs, secret masking, explicit historical identity, bounded optional logs',
  )

  const inspect = environmentModule.inspectToolEnvironment
  try {
    environmentModule.inspectToolEnvironment = async () => {
      throw new Error('private failure detail')
    }
    const partial = await prepareProjectHandoff(services, tool.id, {
      includeEnvironment: true,
    })
    assert.match(partial.markdown, /Unavailable/)
    assert.ok(!partial.markdown.includes('private failure detail'))
    environmentModule.inspectToolEnvironment = async () => {
      memory.save({
        toolId: tool.id,
        expectedRevision: memory.get(tool.id).revision,
        fields,
      })
      return {
        checkedAt: new Date().toISOString(),
        checks: [],
        setupSteps: [],
      }
    }
    await assert.rejects(
      prepareProjectHandoff(services, tool.id, { includeEnvironment: true }),
      /changed while preparing/,
    )
  } finally {
    environmentModule.inspectToolEnvironment = inspect
  }
  console.log('OK: partial diagnostic failure and concurrent-context change recovery')

  const file = path.join(root, 'project-memory.json')
  const valid = fs.readFileSync(file, 'utf8')
  for (const invalid of [
    '{broken',
    JSON.stringify({ version: 2, memories: [] }),
    JSON.stringify({ version: 1, memories: [first, first] }),
  ]) {
    fs.writeFileSync(file, invalid)
    assert.throws(() => memory.get(tool.id), /original project-memory.json is unchanged/)
    assert.throws(() => memory.save({ toolId: tool.id, expectedRevision: null, fields }))
    assert.equal(
      fs.readFileSync(file, 'utf8'),
      invalid,
      'bad data must never be overwritten',
    )
  }
  fs.writeFileSync(file, valid)
  // Unicode fields can fit the character limit while exceeding the whole-file byte limit.
  const largeRecord = {
    ...first,
    ...Object.fromEntries(Object.keys(fields).map((key) => [key, '界'.repeat(4000)])),
  }
  const maximumBytes = 32 * 1024 * 1024
  // Compact record size gives an upper bound; trim once for pretty-print overhead.
  const count = Math.floor(maximumBytes / Buffer.byteLength(JSON.stringify(largeRecord)))
  const large = {
    version: 1,
    memories: Array.from({ length: count }, (_, index) => ({
      ...largeRecord,
      toolId: `large-${index}`,
    })),
  }
  let lastValid = JSON.stringify(large, null, 2) + '\n'
  while (Buffer.byteLength(lastValid) > maximumBytes) {
    large.memories.pop()
    lastValid = JSON.stringify(large, null, 2) + '\n'
  }
  fs.writeFileSync(file, lastValid)
  assert.throws(
    () =>
      memory.save({
        toolId: tool.id,
        expectedRevision: null,
        fields: Object.fromEntries(
          Object.keys(fields).map((key) => [key, '界'.repeat(4000)]),
        ),
      }),
    /memory is full/,
  )
  assert.equal(fs.readFileSync(file, 'utf8'), lastValid)
  fs.writeFileSync(file, valid)
  console.log(
    'OK: corrupt/future/duplicate files and oversized Unicode saves preserve the original',
  )

  client = new Client({ name: 'shelf-phase4-smoke', version: '1.0.0' })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('dist-mcp/mcp/server.js')],
      env: { ...process.env, SHELF_DATA_ROOT: root },
      stderr: 'pipe',
    }),
  )
  const tools = (await client.listTools()).tools
  for (const name of ['shelf_get_project_memory', 'shelf_prepare_handoff']) {
    assert.equal(
      tools.find((tool) => tool.name === name)?.annotations?.readOnlyHint,
      true,
    )
  }
  assert.ok(
    !tools.some((tool) => /shelf_(save|update)_project_memory/.test(tool.name)),
    'agents have no memory write tool',
  )
  const call = async (name, args) => {
    const response = await client.callTool({ name, arguments: args })
    assert.ok(!response.isError, JSON.stringify(response))
    assert.ok(!JSON.stringify(response).includes(secret))
    return JSON.parse(response.content[0].text)
  }
  const fetched = await call('shelf_get_project_memory', { id: tool.id })
  assert.equal(fetched.memory.purpose, fields.purpose)
  assert.ok(!fetched.memory.knownIssues.includes(secret))
  assert.equal(
    memory.get(tool.id).knownIssues,
    fields.knownIssues,
    'redaction does not change saved source',
  )
  const brief = await call('shelf_prepare_handoff', {
    id: tool.id,
    options: { task: 'Continue the project' },
  })
  assert.match(brief.markdown, /Continue the project/)
  assert.equal((await call('shelf_get_project_memory', { id: other.id })).memory, null)
  assert.equal(
    (
      await client.callTool({
        name: 'shelf_prepare_handoff',
        arguments: { id: tool.id, options: { runId } },
      })
    ).isError,
    true,
  )
  assert.equal(
    (
      await client.callTool({
        name: 'shelf_get_project_memory',
        arguments: { id: 'missing' },
      })
    ).isError,
    true,
  )
  memory.save({
    toolId: tool.id,
    expectedRevision: memory.get(tool.id).revision,
    fields: emptyProjectMemory(),
  })
  assert.equal(
    (await call('shelf_get_project_memory', { id: tool.id })).memory.purpose,
    '',
  )
  console.log(
    'OK: real MCP discovery, read-only annotations, live saved-context reads, empty memory, redaction and errors',
  )
} finally {
  await client?.close()
  fs.rmSync(root, { recursive: true, force: true })
}
