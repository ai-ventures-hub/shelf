/** Exercise the route locally, including real concurrent PostgreSQL throttling. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { randomUUID, webcrypto } from 'node:crypto'
import { execFileSync, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import ts from 'typescript'

const exec = promisify(execFile)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-onboarding-'))
const source = fs.readFileSync(new URL('../src/app/api/onboarding/route.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function route(getSql) {
  const exports = {}
  vm.runInNewContext(compiled, { exports, require: name => {
    assert.equal(name, '@/lib/db')
    return { getSql }
  }, Request, Response, TextEncoder, TextDecoder, crypto: webcrypto, console: { error() {} } })
  return exports.POST
}
const request = (ip = '198.51.100.10', forwarded = 'spoofed', body = { appVersion: 'test', answers: { persona: 'fixture' } }) =>
  new Request('http://fixture.invalid/api/onboarding', { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip, 'x-forwarded-for': forwarded }, body: JSON.stringify(body) })
let bin, started = false
try {
  // Validate cheap rejection and the documented fail-open throttle policy without a DB.
  const unavailable = route(() => { throw new Error('fixture database unavailable') })
  assert.equal((await unavailable(request('x', 'y', { email: 'invalid' }))).status, 400)
  assert.equal((await unavailable(request())).status, 500, 'submission failures remain retryable')
  let cancelled = false
  const oversized = new Request('http://fixture.invalid/api/onboarding', { method: 'POST', duplex: 'half', body: new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(2048)) },
    cancel() { cancelled = true },
  }) })
  assert.equal((await unavailable(oversized)).status, 413, 'chunked bodies are bounded before buffering')
  assert.equal(cancelled, true)
  const failOpen = route(() => Object.assign((strings) => strings.join('').includes('onboarding_throttle') ? Promise.reject(new Error('fixture throttle unavailable')) : Promise.resolve([]), { transaction: () => assert.fail('unavailable throttle cannot start a transaction') }))
  assert.equal((await failOpen(request())).status, 200, 'throttle outages retain the existing fail-open policy')

  try {
    bin = process.env.SHELF_TEST_PG_BIN_DIR || execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim()
    fs.accessSync(path.join(bin, 'initdb'), fs.constants.X_OK)
    fs.accessSync(path.join(bin, 'pg_ctl'), fs.constants.X_OK)
  } catch {
    bin = undefined
    if (process.env.SHELF_REQUIRE_PG === '1') throw new Error('PostgreSQL initdb/pg_ctl are required for this check.')
    console.log('SKIP: PostgreSQL initdb/pg_ctl unavailable; route validation checks passed, concurrent SQL check not run')
    process.exitCode = 0
  }
  if (bin) {
    const data = path.join(root, 'data')
    execFileSync(path.join(bin, 'initdb'), ['-D', data, '-A', 'trust', '--no-locale'], { stdio: 'ignore' })
    execFileSync(path.join(bin, 'pg_ctl'), ['-D', data, '-l', path.join(root, 'postgres.log'), '-o', `-F -h '' -k ${root}`, '-w', 'start'], { stdio: 'ignore' })
    started = true
    const pg = async (text) => {
      const file = path.join(root, `${randomUUID()}.sql`)
      fs.writeFileSync(file, text + ';\n', { mode: 0o600 })
      try {
        return (await exec(path.join(bin, 'psql'), ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', root, '-d', 'postgres', '-f', file])).stdout.trim()
      } finally {
        fs.unlinkSync(file)
      }
    }
    const literal = value => typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`
    const sql = (strings, ...args) => {
      const text = strings.reduce((out, part, i) => out + part + (i < args.length ? literal(args[i]) : ''), '')
      return { text, then: (resolve, reject) => pg(text).then(() => resolve([]), reject) }
    }
    sql.transaction = async (queries, options) => {
      assert.equal(options.isolationLevel, 'ReadCommitted')
      const output = await pg(`BEGIN ISOLATION LEVEL READ COMMITTED; ${queries.map(query => query.text).join('; ')}; COMMIT;`)
      return [[], output ? [{ ip_hash: output }] : []]
    }
    await pg('CREATE TABLE onboarding_responses (name text, email text, app_version text, platform text, answers jsonb)')
    const post = route(() => sql)
    assert.equal((await post(request())).status, 200)
    await pg('TRUNCATE onboarding_throttle, onboarding_responses')
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => post(request('198.51.100.10', `spoof-${i}`))))
    assert.equal(results.filter(result => result.status === 200).length, 5, 'exactly five simultaneous requests are admitted')
    assert.equal(results.filter(result => result.status === 429).length, 15)
    assert.equal(await pg('SELECT count(*) FROM onboarding_responses'), '5')
    assert.equal(await pg('SELECT count(DISTINCT ip_hash) FROM onboarding_throttle'), '1', 'spoofed forwarding hops do not change the bucket')
    assert.equal((await post(request('198.51.100.11'))).status, 200, 'another platform IP gets its own bucket')
    await pg("UPDATE onboarding_throttle SET submitted_at = now() - interval '8 days'")
    assert.equal((await post(request())).status, 200, 'the rolling hour expires')
    assert.equal(await pg('SELECT count(*) FROM onboarding_throttle'), '1', 'seven-day retention pruning remains intact')
    console.log('OK: route validation, fail-open policy, real PostgreSQL concurrency, trusted IP buckets, expiry, and pruning')
  }
} finally {
  if (started) execFileSync(path.join(bin, 'pg_ctl'), ['-D', path.join(root, 'data'), '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' })
  fs.rmSync(root, { recursive: true, force: true })
}
