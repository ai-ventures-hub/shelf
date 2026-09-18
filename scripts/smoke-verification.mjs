/** Finite-command verification tests. Every command runs in a disposable fixture. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
const require = createRequire(import.meta.url)
const { LibraryStore } = require('../dist-electron/shared/library-store')
const { VerificationRunner } = require('../dist-electron/shared/verification-runner')
const { VerificationStore } = require('../dist-electron/shared/verification-store')
const { ProjectMemoryStore } = require('../dist-electron/shared/project-memory-store')
const { ReceiptStore } = require('../dist-electron/shared/receipt-store')
const { DesignProfileStore } = require('../dist-electron/shared/design-profile-store')
const {
  prepareVerificationHandoff,
} = require('../dist-electron/shared/verification-handoff')
const { verificationActive } = require('../dist-electron/shared/verification-contracts')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-verification-'))
const library = new LibraryStore(root)
const runner = new VerificationRunner(library)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const step = (label, command, timeoutSeconds = 10) => ({
  id: randomUUID(),
  label,
  command,
  timeoutSeconds,
})
const secret = 'verification-fixture-secret-not-real'
let tool = library.save({
  name: 'Verification fixture',
  projectPath: root,
  launchCommand: 'echo unchanged-launch',
  env: { PRIVATE_VALUE: secret },
})
const originalLibrary = fs.readFileSync(path.join(root, 'library.json'), 'utf8')
function save(steps) {
  return runner.save({
    toolId: tool.id,
    expectedRevision: runner.get(tool.id).workflow?.revision || null,
    steps,
  })
}
function start() {
  return runner.start({
    toolId: tool.id,
    workflowRevision: runner.get(tool.id).workflow.revision,
    toolRevision: tool.updatedAt,
  })
}
async function finish(run) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const record = runner.get(tool.id).runs.find((item) => item.id === run.id)
    if (!verificationActive(record.status)) return record
    if (record.status === 'cleanup_required') throw new Error(JSON.stringify(record))
    await sleep(40)
  }
  throw new Error('Timed out waiting for fixture verification')
}
try {
  assert.equal(runner.get(tool.id).workflow, null)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      scripts: {
        typecheck: 'echo types',
        test: 'echo tests',
        build: 'echo build',
        dev: 'watch',
      },
    }),
  )
  assert.deepEqual(
    runner.suggest(tool.id).map((item) => item.command),
    ['npm run typecheck', 'npm run test', 'npm run build'],
  )
  const workflow = save([
    step('First', 'echo first >> order.txt'),
    step('Second', 'echo second >> order.txt'),
  ])
  assert.throws(
    () => runner.save({ toolId: tool.id, expectedRevision: null, steps: workflow.steps }),
    /changed elsewhere/,
  )
  assert.throws(
    () =>
      runner.start({
        toolId: tool.id,
        workflowRevision: randomUUID(),
        toolRevision: tool.updatedAt,
      }),
    /changed/,
  )
  assert.throws(
    () =>
      runner.start({
        toolId: tool.id,
        workflowRevision: workflow.revision,
        toolRevision: 'stale',
      }),
    /changed/,
  )
  const run = start()
  assert.throws(start, /already active/)
  assert.throws(() => save(workflow.steps), /Finish or cancel/)
  const complete = await finish(run)
  assert.equal(complete.status, 'passed')
  assert.deepEqual(
    complete.steps.map((item) => item.status),
    ['passed', 'passed'],
  )
  assert.equal(fs.readFileSync(path.join(root, 'order.txt'), 'utf8'), 'first\nsecond\n')
  assert.equal(
    fs.readFileSync(path.join(root, 'library.json'), 'utf8'),
    originalLibrary,
    'launch configuration is unchanged',
  )
  console.log(
    'OK: ordered execution, immutable launch config, stale review rejection, duplicate run and edit guards',
  )

  save([
    step('Pass', 'echo first'),
    step('Fail', 'echo broken >&2; exit 7'),
    step('Skip', 'touch should-not-exist'),
  ])
  const failed = await finish(start())
  assert.equal(failed.status, 'failed')
  assert.deepEqual(
    failed.steps.map((item) => item.status),
    ['passed', 'failed', 'skipped'],
  )
  assert.equal(failed.steps[1].exitCode, 7)
  assert.equal(fs.existsSync(path.join(root, 'should-not-exist')), false)
  assert.ok(
    runner
      .logs(tool.id, failed.id, failed.steps[1].id)
      .some((item) => item.text === 'broken'),
  )
  const fresh = new VerificationRunner(library)
  assert.equal(fresh.get(tool.id).runs[0].id, failed.id)
  assert.ok(
    fresh
      .logs(tool.id, failed.id, failed.steps[1].id)
      .some((item) => item.text === 'broken'),
  )
  const memory = new ProjectMemoryStore(root)
  memory.save({
    toolId: tool.id,
    expectedRevision: null,
    fields: {
      purpose: 'Fixture purpose',
      conventions: '',
      decisions: '',
      knownIssues: '',
      nextSteps: '',
    },
  })
  const handoff = await prepareVerificationHandoff(
    {
      library,
      memory,
      receipts: new ReceiptStore(root),
      design: new DesignProfileStore(root),
    },
    tool.id,
    failed.id,
  )
  assert.ok(
    handoff.markdown.includes('Fixture purpose') &&
      handoff.markdown.includes('broken') &&
      handoff.markdown.includes('exit code: 7'),
  )
  await assert.rejects(
    () => prepareVerificationHandoff({ library, memory }, tool.id, randomUUID()),
    /no longer retained/,
  )
  console.log(
    'OK: stop on first failure, retained output and memory handoff, restart reads exact history',
  )

  const client = new Client({ name: 'verification-smoke', version: '1.0.0' })
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [path.resolve('dist-mcp/mcp/server.js')],
        env: { ...process.env, SHELF_DATA_ROOT: root },
        stderr: 'pipe',
      }),
    )
    const tools = (await client.listTools()).tools
    for (const name of ['shelf_get_verification', 'shelf_prepare_verification_handoff'])
      assert.equal(
        tools.find((item) => item.name === name)?.annotations?.readOnlyHint,
        true,
      )
    const call = async (name, args) => {
      const result = await client.callTool({ name, arguments: args })
      assert.ok(!result.isError, JSON.stringify(result))
      return JSON.parse(result.content.find((item) => item.type === 'text').text)
    }
    const retrieved = await call('shelf_get_verification', { id: tool.id })
    assert.equal(retrieved.runs[0].id, failed.id)
    const brief = await call('shelf_prepare_verification_handoff', {
      id: tool.id,
      runId: failed.id,
    })
    assert.ok(
      brief.markdown.includes('broken') && brief.markdown.includes('Fixture purpose'),
    )
    const missing = await client.callTool({
      name: 'shelf_prepare_verification_handoff',
      arguments: { id: tool.id, runId: randomUUID() },
    })
    assert.equal(missing.isError, true)
    assert.equal(runner.get(tool.id).runs.length, 2, 'MCP reads do not start commands')
    console.log(
      'OK: bundled MCP discovery, read-only verification history and exact-run handoff',
    )
  } finally {
    await client.close()
  }

  fs.writeFileSync(
    path.join(root, 'output.cjs'),
    `process.stdout.write(process.env.PRIVATE_VALUE.slice(0, 12)); setTimeout(() => { process.stdout.write(process.env.PRIVATE_VALUE.slice(12) + '\\n'); process.stderr.write('last line'); }, 80)`,
  )
  save([step('Secrets', 'node output.cjs')])
  const masked = await finish(start())
  const output = runner.logs(tool.id, masked.id, masked.steps[0].id)
  assert.equal(JSON.stringify(output).includes(secret), false)
  assert.ok(
    output.some((item) => item.text === 'last line'),
    'partial final line is flushed',
  )
  assert.ok(output.some((item) => item.text.includes('***')))
  console.log(
    'OK: secrets split across stdout chunks are masked; final partial output retained',
  )

  save([step('Timeout', 'sleep 30', 1), step('Skip', 'touch should-not-exist')])
  const timed = await finish(start())
  assert.equal(timed.status, 'timed_out')
  assert.equal(timed.steps[1].status, 'skipped')
  save([step('Cancel', 'sleep 30'), step('Skip', 'touch should-not-exist')])
  const cancelled = start()
  await sleep(100)
  const childPid = runner.get(tool.id).runs[0].child.pid
  assert.equal(runner.activity().length, 1)
  await runner.cancel(tool.id, cancelled.id)
  assert.equal(runner.get(tool.id).runs[0].status, 'cancelled')
  assert.throws(() => process.kill(-childPid, 0), /ESRCH/)
  assert.equal(runner.activity().length, 0)
  const immediate = start()
  await runner.cancel(tool.id, immediate.id)
  assert.equal(runner.get(tool.id).runs[0].status, 'cancelled')
  console.log('OK: timeouts, cancellation, process-group cleanup, immediate cancellation')

  save([
    step('Background', 'sleep 30 & echo $! > descendant.pid; exit 0'),
    step('After cleanup', 'echo done'),
  ])
  const background = await finish(start())
  assert.equal(background.status, 'passed')
  const descendant = Number(
    fs.readFileSync(path.join(root, 'descendant.pid'), 'utf8').trim(),
  )
  assert.throws(
    () => process.kill(descendant, 0),
    /ESRCH/,
    'a successful shell cannot leave a background process behind',
  )
  console.log('OK: surviving background descendants are stopped before the next step')

  // A disk failure after spawn must stop execution and retain a retryable record.
  save([step('Storage failure', 'sleep 30'), step('Skip', 'touch should-not-exist')])
  const update = runner.store.update.bind(runner.store)
  let writes = 0
  runner.store.update = (run) => {
    if (++writes >= 2) throw new Error('Fixture disk failure')
    return update(run)
  }
  const unsaved = start()
  for (
    let count = 0;
    count < 100 && runner.get(tool.id).runs[0].status !== 'cleanup_required';
    count++
  )
    await sleep(30)
  assert.equal(runner.get(tool.id).runs[0].status, 'cleanup_required')
  assert.throws(start, /already active/)
  runner.store.update = update
  await runner.cancel(tool.id, unsaved.id)
  assert.equal(runner.get(tool.id).runs[0].status, 'interrupted')
  assert.equal(fs.existsSync(path.join(root, 'should-not-exist')), false)
  console.log(
    'OK: history-write failure stops commands and preserves retryable ownership',
  )

  // Simulated signal refusal must not claim cancellation succeeded or lose ownership.
  const lifecycle = require('../dist-electron/shared/process-lifecycle')
  const terminate = lifecycle.terminateProcess
  save([step('Signal failure', 'sleep 30')])
  const refused = start()
  await sleep(100)
  lifecycle.terminateProcess = async () => {
    throw new Error('Fixture signal refusal')
  }
  try {
    await assert.rejects(() => runner.cancel(tool.id, refused.id), /signal refusal/)
    assert.equal(runner.get(tool.id).runs[0].status, 'cleanup_required')
    assert.throws(start, /already active/)
  } finally {
    lifecycle.terminateProcess = terminate
  }
  await runner.cancel(tool.id, refused.id)
  assert.equal(runner.get(tool.id).runs[0].status, 'cancelled')
  console.log(
    'OK: failed termination remains visible, blocks duplicate execution, and can be retried',
  )

  // Explicit rerun creates a new record, never silently resumes the previous run.
  save([step('Pass', 'true')])
  for (let i = 0; i < 11; i++) await finish(start())
  assert.equal(runner.get(tool.id).runs.length, 10)
  assert.equal(fs.readdirSync(path.join(root, 'verification', 'runs')).length, 10)
  assert.throws(
    () => runner.logs(tool.id, failed.id, failed.steps[1].id),
    /no longer available/,
  )
  console.log('OK: bounded ten-run history and output pruning')

  const state = runner.get(tool.id)
  const interrupted = {
    ...structuredClone(state.runs[0]),
    id: randomUUID(),
    status: 'running',
    endedAt: undefined,
    owner: { pid: 2147483647, identity: 'gone' },
  }
  interrupted.steps[0].status = 'running'
  runner.store.begin(interrupted)
  assert.equal(new VerificationRunner(library).get(tool.id).runs[0].status, 'interrupted')
  const orphanChild = lifecycle.spawnLoginShell('sleep 30', { cwd: root })
  try {
    await new Promise((resolve, reject) => {
      orphanChild.once('spawn', resolve)
      orphanChild.once('error', reject)
    })
    const { processIdentity } = require('../dist-electron/shared/process-identity')
    const identity = processIdentity(orphanChild.pid, true)
    assert.ok(identity)
    const orphan = {
      ...structuredClone(runner.get(tool.id).runs[0]),
      id: randomUUID(),
      status: 'running',
      endedAt: undefined,
      child: { pid: orphanChild.pid, identity: 'does-not-match' },
    }
    orphan.steps[0].status = 'running'
    runner.store.begin(orphan)
    assert.equal(runner.get(tool.id).runs[0].status, 'cleanup_required')
    await assert.rejects(
      () => runner.cancel(tool.id, orphan.id),
      /Cannot safely identify/,
    )
    process.kill(orphanChild.pid, 0)
    const identified = runner.get(tool.id).runs[0]
    identified.child.identity = identity
    runner.store.update(identified)
    await runner.cancel(tool.id, orphan.id)
    assert.equal(runner.get(tool.id).runs[0].status, 'interrupted')
    assert.throws(() => process.kill(-orphanChild.pid, 0), /ESRCH/)
    console.log(
      'OK: interrupted child cleanup checks process identity and refuses a mismatched PID',
    )
  } finally {
    await lifecycle.terminateProcess({ child: orphanChild, pgid: orphanChild.pid })
  }

  const dataFile = fs
    .readdirSync(path.join(root, 'verification'))
    .find((file) => file.endsWith('.json'))
  const location = path.join(root, 'verification', dataFile)
  assert.equal(fs.statSync(location).mode & 0o777, 0o600)
  fs.writeFileSync(location, '{broken')
  assert.throws(() => new VerificationStore(root).get(tool.id), /could not be read/)
  assert.throws(
    () =>
      runner.save({
        toolId: tool.id,
        expectedRevision: null,
        steps: [step('No', 'true')],
      }),
    /could not be read/,
  )
  assert.equal(fs.readFileSync(location, 'utf8'), '{broken')
  console.log('OK: interrupted run recovery, private records, corrupt data preserved')
} finally {
  await runner.stopAll()
  fs.rmSync(root, { recursive: true, force: true })
}
