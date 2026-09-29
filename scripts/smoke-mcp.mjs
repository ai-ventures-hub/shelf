/**
 * MCP client smoke: stage fixture → accept (GUI path) → upsert → list →
 * launch → logs → stop → remove, plus the agent-policy regressions.
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
const fixturePort = Number(process.env.SHELF_SMOKE_MCP_PORT || 8766)
if (!Number.isInteger(fixturePort) || fixturePort < 1024 || fixturePort > 65535) throw new Error('Invalid SHELF_SMOKE_MCP_PORT')
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

/** Plain-text tools (logs, handoffs) return one text block, not JSON. */
async function callText(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args })
  const text = result.content?.find((c) => c.type === 'text')?.text
  if (result.isError) throw new Error(text)
  return text
}

function connectServer(extraEnv = {}) {
  return new StdioClientTransport({
    command: 'node',
    args: [serverEntry],
    // The SDK intentionally forwards only a small default env allowlist.
    // Preserve the isolated SHELF_DATA_ROOT supplied by smoke:all.
    env: { ...process.env, SHELF_DATA_ROOT: smokeDataRoot, ...extraEnv },
    stderr: 'pipe',
  })
}

async function main() {
  const client = new Client({ name: 'shelf-smoke', version: '0.1.0' })
  await client.connect(connectServer())

  const { LibraryStore: SmokeLibraryStore } = requireCjs('../dist-electron/shared/library-store.js')
  const { ProcessManager } = requireCjs('../dist-electron/shared/process-manager.js')
  const { ReceiptStore } = requireCjs('../dist-electron/shared/receipt-store.js')
  const { ToolDraftStore, acceptToolDraft } = requireCjs('../dist-electron/shared/tool-draft-store.js')
  const guiStore = new SmokeLibraryStore(smokeDataRoot)
  const guiProcesses = new ProcessManager(guiStore, { receipts: new ReceiptStore(smokeDataRoot) })
  const guiDrafts = new ToolDraftStore(smokeDataRoot)
  /** The user pressing Accept on a draft card in Shelf. */
  const acceptInGui = (draftId) => acceptToolDraft(draftId, guiDrafts, { store: guiStore, processes: guiProcesses })

  try {
    // Every tool declares annotations: unannotated tools read as
    // destructive/open-world to clients.
    const listing = await client.listTools()
    const missingAnnotations = listing.tools.filter(
      (tool) => !tool.annotations || typeof tool.annotations.readOnlyHint !== 'boolean',
    )
    if (missingAnnotations.length) {
      throw new Error(`Tools without annotations: ${missingAnnotations.map((t) => t.name).join(', ')}`)
    }
    const hint = (name, key) => listing.tools.find((t) => t.name === name)?.annotations?.[key]
    for (const name of ['shelf_list_tools', 'shelf_get_tool', 'shelf_get_status', 'shelf_get_logs', 'shelf_find_capability', 'shelf_inspect_project', 'shelf_list_receipts', 'shelf_get_verification', 'shelf_prepare_handoff']) {
      if (hint(name, 'readOnlyHint') !== true || hint(name, 'openWorldHint') !== false) throw new Error(`${name} must be read-only and closed-world`)
    }
    for (const name of ['shelf_remove_tool', 'shelf_clear_receipts', 'shelf_stop_tool']) {
      if (hint(name, 'destructiveHint') !== true) throw new Error(`${name} must be marked destructive`)
    }
    for (const name of ['shelf_launch_tool', 'shelf_register_project']) {
      if (hint(name, 'openWorldHint') !== true) throw new Error(`${name} must be marked open-world`)
    }
    if (!client.getInstructions()?.includes('staged')) throw new Error('server instructions missing the draft policy')
    if (JSON.stringify(listing).includes('"pattern"')) throw new Error('tools/list still carries regex patterns')
    console.log(`OK: ${listing.tools.length} tools annotated; instructions carry shared policy; ${JSON.stringify(listing).length} B listing`)

    const toolArgs = {
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
      launchCommand: `PORT=${fixturePort} node server.mjs`,
      url: `http://127.0.0.1:${fixturePort}`,
      port: fixturePort,
      notes: 'Created by smoke-mcp. Safe to remove.',
      env: {
        SMOKE_SECRET_TOKEN: 'should-be-masked',
        // Not a "secret-looking" key name — ALL values must mask regardless.
        DATABASE_URL: 'postgres://user:hunter2@localhost/db',
      },
    }

    // Regression (2.1 policy bypass): creating a tool for a folder the user
    // never accepted must stage a draft, not write library.json.
    const staged = await callTool(client, 'shelf_upsert_tool', toolArgs)
    if (staged.outcome !== 'pending_consent' || staged.action !== 'staged' || !staged.draft?.id) {
      throw new Error(`upsert of a new folder must stage a draft, got ${JSON.stringify(staged).slice(0, 200)}`)
    }
    if (guiStore.list().length !== 0) throw new Error('upsert wrote library.json for an unaccepted folder')
    if (staged.draft.launchCommand !== `PORT=${fixturePort} node server.mjs`) {
      throw new Error('draft must carry the agent launchCommand for review')
    }
    if (JSON.stringify(staged).includes('hunter2') || !staged.draft.envKeys.includes('DATABASE_URL')) {
      throw new Error('draft must carry env key names only')
    }
    if (!staged.notCarried?.fields?.includes('agentAccess')) {
      throw new Error('upsert staging must say which fields the draft does not carry')
    }
    console.log('OK: upsert of a new folder stages a draft (no library write)')

    // The user accepts in Shelf; then agent updates to the accepted tool work.
    const accepted = await acceptInGui(staged.draft.id)
    if (!accepted.tool?.id) throw new Error(`accept failed: ${accepted.outcome}`)
    // Update by id WITHOUT launchCommand: fields merge onto the stored record.
    const { name: _n, launchCommand: _l, projectPath: _p, ...updateArgs } = toolArgs
    const upserted = await callTool(client, 'shelf_upsert_tool', { id: accepted.tool.id, ...updateArgs })
    if (upserted.action !== 'updated' || upserted.tool.id !== accepted.tool.id) {
      throw new Error('upsert by id must update the accepted tool')
    }
    if (guiStore.get(accepted.tool.id).launchCommand !== `PORT=${fixturePort} node server.mjs`) {
      throw new Error('omitted launchCommand must keep the stored command')
    }
    console.log('upsert', upserted.action, upserted.tool.id)
    if (upserted.tool.env?.SMOKE_SECRET_TOKEN !== '***') {
      throw new Error('Expected secret env value to be masked in MCP output')
    }
    if (upserted.tool.env?.DATABASE_URL !== '***') {
      throw new Error('Every env value must be masked in MCP output, not just secret-named keys')
    }
    if (JSON.stringify(upserted).includes('hunter2')) {
      throw new Error('Raw env value leaked somewhere in the upsert response')
    }

    // Round-trip guard: echoing the MASKED read back through upsert must
    // restore the stored values, never persist '***' placeholders.
    const echoed = await callTool(client, 'shelf_upsert_tool', {
      id: upserted.tool.id,
      name: upserted.tool.name,
      launchCommand: upserted.tool.launchCommand,
      env: upserted.tool.env,
      notes: 'Round-trip touched only this field.',
    })
    const rawStore = new SmokeLibraryStore(smokeDataRoot)
    const rawTool = rawStore.get(echoed.tool.id)
    if (rawTool.env?.SMOKE_SECRET_TOKEN !== 'should-be-masked') {
      throw new Error('Masked env round-trip clobbered the stored secret value')
    }
    if (rawTool.env?.DATABASE_URL !== 'postgres://user:hunter2@localhost/db') {
      throw new Error('Masked env round-trip clobbered DATABASE_URL')
    }
    if (rawTool.launchCommand !== `PORT=${fixturePort} node server.mjs`) {
      throw new Error('Masked launchCommand round-trip clobbered the stored command')
    }
    if (rawTool.notes !== 'Round-trip touched only this field.') {
      throw new Error('Round-trip guard must not block genuinely new values')
    }
    console.log('OK: masked read → upsert round-trip restores real values')

    const free = await callTool(client, 'shelf_find_free_port', {
      preferred: fixturePort,
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
    const row = listed.tools.find((t) => t.id === toolId)
    if (!row) {
      throw new Error('upserted tool missing from shelf_list_tools')
    }
    // Compact rows: one-word readiness, no per-tool boilerplate.
    if (row.readiness !== 'needs_setup' || 'projectPath' in row || 'message' in row || typeof row.status !== 'string') {
      throw new Error(`list rows must be compact, got ${JSON.stringify(row)}`)
    }
    console.log('OK: listed (compact rows)')

    const got = await callTool(client, 'shelf_get_tool', { id: toolId })
    if (got.tool.name !== smokeName) throw new Error('get_tool name mismatch')
    if (!got.readiness?.shelfActions?.includes('shelf_launch_tool') || got.tool.projectPath !== fs.realpathSync.native(fixture)) {
      throw new Error('get_tool keeps full readiness and the project folder')
    }
    const notFound = await client.callTool({ name: 'shelf_get_tool', arguments: { id: 'nope' } })
    if (!notFound.isError || !/shelf_list_tools/.test(notFound.content[0].text)) {
      throw new Error('Tool not found must point at shelf_list_tools')
    }
    console.log('OK: get')

    const found = await callTool(client, 'shelf_find_capability', {
      task: 'I need to serve a local smoke fixture',
      accessKind: 'mcp',
    })
    if (found.matches?.[0]?.toolId !== toolId || !found.matches[0].reasons?.length) {
      throw new Error('shelf_find_capability did not return an explainable match')
    }
    if (typeof found.matches[0].readiness !== 'string' || 'runtime' in found.matches[0]) {
      throw new Error('capability matches must use compact readiness/status')
    }
    const nothing = await callTool(client, 'shelf_find_capability', { task: 'render holographic weather forecasts' })
    if (nothing.count !== 0 || !/shelf_record_capability_gap/.test(nothing.next || '')) {
      throw new Error('zero matches must point at shelf_record_capability_gap')
    }
    // Subscribed team-catalog entries the user has not installed are visible,
    // read-only, and never installable by the agent.
    fs.writeFileSync(
      path.join(smokeDataRoot, 'team-catalogs.json'),
      JSON.stringify({
        version: 1,
        catalogs: [
          {
            id: 'team-1',
            url: 'https://git.example.com/team/tools.git',
            name: 'Team Tools',
            addedAt: new Date().toISOString(),
            entries: [
              { name: 'Podcast Scribe', description: 'Transcribes podcast audio', capabilities: ['transcribe podcast audio'], repo: 'https://git.example.com/team/scribe.git' },
            ],
          },
        ],
      }),
    )
    const teamFound = await callTool(client, 'shelf_find_capability', { task: 'transcribe podcast audio' })
    const teamHit = teamFound.teamMatches?.[0]
    if (!teamHit || teamHit.installed !== false || teamHit.source !== 'team' || !/Team Tools in Shelf/.test(teamHit.note) || 'repo' in teamHit) {
      throw new Error(`team catalog entries must surface as not installed: ${JSON.stringify(teamFound)}`)
    }
    fs.rmSync(path.join(smokeDataRoot, 'team-catalogs.json'))
    console.log('OK: capability match (compact, zero-match next step, team catalog read-only)')

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
    const defaultGaps = await callTool(client, 'shelf_list_capability_gaps')
    if (defaultGaps.status !== 'open' || defaultGaps.gaps[0]?.examples || defaultGaps.gaps[0]?.exampleCount !== 1) {
      throw new Error('gap list defaults: open, examples omitted with a count')
    }
    const withExamples = await callTool(client, 'shelf_list_capability_gaps', { includeExamples: true })
    if (!Array.isArray(withExamples.gaps[0]?.examples)) throw new Error('includeExamples must return examples')
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
    const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-mcp-links-'))
    try {
      const dry = await callTool(client, 'shelf_register_project', {
        projectPath: registerProj,
        dryRun: true,
      })
      if (dry.outcome !== 'dry_run' || dry.autoRunnable !== true) {
        throw new Error(`Unexpected dryRun result: ${dry.outcome}/${dry.autoRunnable}`)
      }
      if (dry.draft?.status !== 'none') throw new Error('dryRun must report draft.status none before staging')
      const beforeRegister = await callTool(client, 'shelf_list_tools')
      const registered = await callTool(client, 'shelf_register_project', {
        projectPath: registerProj,
        launch: true,
        runSetup: true,
        description: 'Registered by smoke-mcp',
        capabilities: ['serve a registered fixture'],
      })
      if (registered.outcome !== 'pending_consent' || !registered.draft?.id) {
        throw new Error(
          `Expected pending_consent, got ${registered.outcome}`,
        )
      }
      if (registered.draft.envKeys?.some((key) => key.includes('='))) {
        throw new Error('draft exposed an env value')
      }
      if (
        registered.draft.status !== 'pending' ||
        registered.draft.description !== 'Registered by smoke-mcp' ||
        registered.draft.capabilities?.[0] !== 'serve a registered fixture' ||
        'suggestion' in registered
      ) {
        throw new Error(`draft must carry description/capabilities once, got ${JSON.stringify(registered).slice(0, 300)}`)
      }
      const afterRegister = await callTool(client, 'shelf_list_tools')
      if (afterRegister.count !== beforeRegister.count) {
        throw new Error('register_project must not add a tool before the user accepts it')
      }
      const again = await callTool(client, 'shelf_register_project', {
        projectPath: registerProj,
      })
      if (again.draft?.id !== registered.draft.id) {
        throw new Error('a second registration must refresh the same draft')
      }
      console.log('OK: register_project stages a draft with description/capabilities')

      // Regression (reproduced bypass): register → pending, then upsert the
      // same folder with a new command, then register again. Nothing may be
      // saved or launched until the user accepts.
      const bypass = await callTool(client, 'shelf_upsert_tool', {
        name: 'Bypass Attempt',
        projectPath: registerProj,
        launchCommand: 'node server.mjs --evil',
      })
      if (bypass.outcome !== 'pending_consent' || bypass.draft.id !== registered.draft.id) {
        throw new Error('upsert of a pending folder must refresh the same draft')
      }
      const reRegistered = await callTool(client, 'shelf_register_project', { projectPath: registerProj })
      if (reRegistered.outcome !== 'pending_consent' || reRegistered.state) {
        throw new Error(`register after upsert must stay pending, got ${reRegistered.outcome}`)
      }
      if ((await callTool(client, 'shelf_list_tools')).count !== beforeRegister.count) {
        throw new Error('upsert/register bypass wrote library.json')
      }
      // Status read path without side effects.
      const pendingDry = await callTool(client, 'shelf_register_project', { projectPath: registerProj, dryRun: true })
      if (pendingDry.draft?.status !== 'pending' || pendingDry.draft.id !== registered.draft.id) {
        throw new Error('dryRun must report the pending draft')
      }
      console.log('OK: upsert→register bypass stays pending; dryRun reports the draft')

      // Symlinked spelling of the same new folder shares the card.
      const pendingLink = path.join(linkDir, 'pending-link')
      fs.symlinkSync(registerProj, pendingLink)
      const viaLink = await callTool(client, 'shelf_register_project', { projectPath: pendingLink })
      if (viaLink.draft?.id !== registered.draft.id || viaLink.draft.projectPath !== fs.realpathSync.native(registerProj)) {
        throw new Error('a symlinked path must refresh the same draft, showing the real folder')
      }

      // The user accepts → dryRun reports accepted with the new tool id.
      const acceptedReg = await acceptInGui(registered.draft.id)
      const acceptedDry = await callTool(client, 'shelf_register_project', { projectPath: registerProj, dryRun: true })
      if (acceptedDry.draft?.status !== 'accepted' || acceptedDry.draft.toolId !== acceptedReg.tool.id) {
        throw new Error(`dryRun must report accepted → toolId, got ${JSON.stringify(acceptedDry.draft)}`)
      }
      if (guiDrafts.list().length !== 0) throw new Error('accepted draft must not linger')
      await callTool(client, 'shelf_remove_tool', { id: acceptedReg.tool.id })
      console.log('OK: symlink shares the draft; dryRun reports accepted → toolId')

      // Regression: a nonexistent folder is invalid, never pending_consent.
      const missingFolder = path.join(registerProj, 'does-not-exist')
      const invalid = await callTool(client, 'shelf_register_project', { projectPath: missingFolder })
      if (invalid.outcome !== 'invalid_folder' || invalid.draft) {
        throw new Error(`nonexistent folder must be invalid_folder, got ${invalid.outcome}`)
      }
      const invalidUpsert = await client.callTool({
        name: 'shelf_upsert_tool',
        arguments: { name: 'Ghost', projectPath: missingFolder, launchCommand: 'true' },
      })
      if (!invalidUpsert.isError) throw new Error('upsert into a nonexistent folder must be refused')
      if (guiDrafts.list().length !== 0) throw new Error('an invalid folder must not stage a draft')
      console.log('OK: nonexistent folder → invalid_folder')

      // Regression: a symlinked or different-case path to an ALREADY
      // registered folder updates that tool; it never stages a duplicate.
      const registeredLink = path.join(linkDir, 'registered-link')
      fs.symlinkSync(fixture, registeredLink)
      const spellings = [registeredLink]
      if (process.platform === 'darwin' && fs.existsSync(fixture.toUpperCase())) spellings.push(fixture.toUpperCase())
      const countBefore = guiStore.list().length
      for (const spelling of spellings) {
        const viaSpelling = await callTool(client, 'shelf_register_project', { projectPath: spelling, launch: false })
        if (viaSpelling.outcome === 'pending_consent' || viaSpelling.created !== false || viaSpelling.tool?.id !== toolId) {
          throw new Error(`${spelling} must update the registered tool, got ${viaSpelling.outcome}`)
        }
      }
      if (guiStore.list().length !== countBefore || guiDrafts.list().length !== 0) {
        throw new Error('another spelling of a registered folder created a duplicate or a draft')
      }
      console.log(`OK: ${spellings.length} alternate spelling(s) of a registered folder update in place`)
    } finally {
      fs.rmSync(registerProj, { recursive: true, force: true })
      fs.rmSync(linkDir, { recursive: true, force: true })
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

    // --- shelf_upsert_collection: agent write path + ownership ---
    // Create by name, with a bogus id mixed in to prove unknown ids are
    // reported rather than silently swallowed.
    const madeCollection = await callTool(client, 'shelf_upsert_collection', {
      name: 'Movie Studio',
      description: 'Agent-built stack',
      toolIds: [upserted.tool.id, 'not-a-real-tool-id'],
    })
    if (madeCollection.action !== 'created') {
      throw new Error(`Expected created, got ${madeCollection.action}`)
    }
    if (!madeCollection.collection.toolIds.includes(upserted.tool.id)) {
      throw new Error('shelf_upsert_collection did not store the member')
    }
    if (madeCollection.collection.toolIds.includes('not-a-real-tool-id')) {
      throw new Error('unknown tool id was stored')
    }
    if (!madeCollection.warnings?.[0]?.includes('not-a-real-tool-id')) {
      throw new Error('unknown tool id was not reported back')
    }
    // Same name again updates the agent's own draft instead of duplicating.
    const reupsert = await callTool(client, 'shelf_upsert_collection', {
      name: 'Movie Studio',
      addToolIds: [upserted.tool.id],
    })
    if (reupsert.action !== 'updated' || reupsert.collection.id !== madeCollection.collection.id) {
      throw new Error('re-upsert by name should update the same agent draft')
    }
    if (reupsert.collection.toolIds.length !== 1) {
      throw new Error('addToolIds must not duplicate an existing member')
    }
    // removeToolIds empties it; the collection survives.
    const emptied = await callTool(client, 'shelf_upsert_collection', {
      id: madeCollection.collection.id,
      name: 'Movie Studio',
      removeToolIds: [upserted.tool.id],
    })
    if (emptied.collection.toolIds.length !== 0) throw new Error('removeToolIds did not drop the member')

    // The GUI adopting it (any collections:save) locks agents out.
    const { adoptCollection } = requireCjs('../dist-electron/shared/library-store.js')
    const adoptStore = new SmokeLibraryStore(smokeDataRoot)
    adoptStore.saveCollection(adoptCollection(adoptStore.getCollection(madeCollection.collection.id)))
    const refused = await client.callTool({
      name: 'shelf_upsert_collection',
      arguments: { id: madeCollection.collection.id, name: 'Movie Studio', addToolIds: [upserted.tool.id] },
    })
    if (!refused.isError || !/user-owned/i.test(refused.content[0].text)) {
      throw new Error('agents must not edit a user-adopted collection')
    }
    // …and cannot squat the name either.
    const nameSquat = await client.callTool({
      name: 'shelf_upsert_collection',
      arguments: { name: 'movie studio', toolIds: [] },
    })
    if (!nameSquat.isError || !/user owns it/i.test(nameSquat.content[0].text)) {
      throw new Error('agents must not hijack a user-owned collection by name')
    }
    // A design-profile binding is the user's call and survives agent edits.
    // A runaway agent cannot flood its own context through this tool.
    const flood = await client.callTool({
      name: 'shelf_upsert_collection',
      arguments: { name: 'Flood', toolIds: Array.from({ length: 500 }, (_, i) => `id-${i}`) },
    })
    if (!flood.isError) throw new Error('oversized toolIds array must be rejected at the schema')
    const someUnknown = await callTool(client, 'shelf_upsert_collection', {
      name: 'Some Unknown',
      toolIds: Array.from({ length: 40 }, (_, i) => `ghost-${i}`),
    })
    if (someUnknown.warnings[0].length > 400) {
      throw new Error('unknown-id warning must be capped, got ' + someUnknown.warnings[0].length)
    }
    if (!/and 30 more/.test(someUnknown.warnings[0])) {
      throw new Error('capped warning should say how many were elided: ' + someUnknown.warnings[0])
    }
    // A long-id flood must stay bounded in the RESPONSE, not just in count.
    const longIds = await callTool(client, 'shelf_upsert_collection', {
      name: 'Long Ids',
      toolIds: Array.from({ length: 200 }, (_, i) => `${'x'.repeat(110)}-${i}`),
    })
    if (longIds.warnings[0].length > 800) {
      throw new Error('warning must truncate long ids, got ' + longIds.warnings[0].length)
    }
    // shelf_get_collection tells an agent whether it may write.
    const ownership = await callTool(client, 'shelf_get_collection', { id: madeCollection.collection.id })
    if (ownership.collection.editableByAgent !== false) {
      throw new Error('adopted collection must report editableByAgent:false')
    }
    console.log('OK: upsert_collection (create, idempotent name, add/remove, adoption locks agents out, bounded output)')

    // An agent must not be able to rename a tool into a look-alike of another.
    const twinA = await callTool(client, 'shelf_upsert_tool', {
      name: 'Twin Target', launchCommand: 'echo a', projectPath: fixture,
    })
    const renameClash = await client.callTool({
      name: 'shelf_upsert_tool',
      arguments: { id: upserted.tool.id, name: 'Twin  Target', launchCommand: 'echo b' },
    })
    if (!renameClash.isError || !/already reads as/i.test(renameClash.content[0].text)) {
      throw new Error('renaming into a fold-equal name must be refused')
    }
    await callTool(client, 'shelf_remove_tool', { id: twinA.tool.id })
    console.log('OK: tool rename cannot manufacture a look-alike')

    // --- Design Engine read path (v1.0 Phase 1) ---
    // Zero-arg resolution with an empty store must error with guidance, not
    // invent a profile.
    let emptyRejected = false
    try {
      await callTool(client, 'shelf_get_design_profile')
    } catch (err) {
      emptyRejected = /no design profiles exist/i.test(String(err.message || err))
    }
    if (!emptyRejected) {
      throw new Error('Zero-arg get with no profiles must error with guidance')
    }

    // Seed a profile through the shared store (MCP is read-only by design);
    // the server re-reads design-profiles.json per call, so no restart needed.
    const { DesignProfileStore } = requireCjs('../dist-electron/shared/design-profile-store.js')
    const profileStore = new DesignProfileStore(smokeDataRoot)
    const seededProfile = profileStore.save({
      name: 'Smoke Brand',
      tokens: { color: { brand: { $value: '#7895ff', $type: 'color' } } },
      modes: { light: { color: { brand: { $value: '#4f6ef2', $type: 'color' } } } },
      direction: 'Calm, precise, dark-first. SMOKE_DESIGN_SECRET=leakme must be masked.',
    })

    const profileList = await callTool(client, 'shelf_list_design_profiles')
    const listedProfile = profileList.profiles?.find((p) => p.id === seededProfile.id)
    if (
      profileList.count !== 1 ||
      !listedProfile?.isDefault ||
      typeof listedProfile.summary !== 'string' ||
      !Array.isArray(listedProfile.boundCollections)
    ) {
      throw new Error('shelf_list_design_profiles returned unexpected shape')
    }

    // Zero-arg call resolves the default — the acceptance-gate path.
    const defaultProfile = await callTool(client, 'shelf_get_design_profile')
    if (
      defaultProfile.resolvedVia !== 'default' ||
      !defaultProfile.brief?.includes('#7895ff') ||
      !defaultProfile.brief.includes('Calm, precise')
    ) {
      throw new Error('Zero-arg shelf_get_design_profile must return the default brief')
    }
    // Default format sends each fact once: the brief renders every token and
    // the direction, so the structured copies stay out.
    if ('tokens' in defaultProfile || 'direction' in defaultProfile) {
      throw new Error('default brief format must not duplicate tokens/direction')
    }
    const tokensOnly = await callTool(client, 'shelf_get_design_profile', { format: 'tokens' })
    if (tokensOnly.tokens?.color?.brand?.$value !== '#7895ff' || 'brief' in tokensOnly) {
      throw new Error('format tokens must return DTCG tokens without the brief')
    }
    const fullProfile = await callTool(client, 'shelf_get_design_profile', { format: 'full' })
    if (!fullProfile.tokens || !fullProfile.brief || typeof fullProfile.direction !== 'string') {
      throw new Error('format full must return tokens, direction, and brief')
    }
    if (
      fullProfile.direction.includes('leakme') ||
      defaultProfile.brief.includes('leakme')
    ) {
      throw new Error('Design profile direction must be masked in MCP output')
    }

    // Collection-scoped resolution: bind via the shared LibraryStore (GUI path).
    const { LibraryStore } = requireCjs('../dist-electron/shared/library-store.js')
    const smokeLibrary = new LibraryStore(smokeDataRoot)
    const designCollection = smokeLibrary.saveCollection({
      id: '',
      name: 'Design Smoke Collection',
      toolIds: [toolId],
      designProfileId: seededProfile.id,
    })
    const viaCollection = await callTool(client, 'shelf_get_design_profile', {
      collectionId: designCollection.id,
    })
    if (viaCollection.resolvedVia !== 'collection') {
      throw new Error(`Expected collection resolution, got ${viaCollection.resolvedVia}`)
    }
    const viaTool = await callTool(client, 'shelf_get_design_profile', { toolId })
    if (viaTool.resolvedVia !== 'tool-collection' || viaTool.profile.id !== seededProfile.id) {
      throw new Error(`Expected tool-collection resolution, got ${viaTool.resolvedVia}`)
    }
    let unknownProfileRejected = false
    try {
      await callTool(client, 'shelf_get_design_profile', { id: 'not-a-profile' })
    } catch {
      unknownProfileRejected = true
    }
    if (!unknownProfileRejected) {
      throw new Error('Unknown explicit profile id must error, not fall back')
    }
    console.log('OK: design profiles (list, default, collection, tool)')

    // --- shelf_get_collection: one-call stack context ---
    const collectionCtx = await callTool(client, 'shelf_get_collection', {
      name: 'design smoke collection', // case-insensitive name lookup
    })
    if (collectionCtx.collection.id !== designCollection.id) {
      throw new Error('shelf_get_collection name lookup returned the wrong collection')
    }
    const member = collectionCtx.members.find((m) => m.id === toolId)
    if (!member || !member.readiness || typeof member.status !== 'string') {
      throw new Error('Collection member missing readiness/runtime state')
    }
    if (
      collectionCtx.designProfile?.id !== seededProfile.id ||
      collectionCtx.designProfile.resolvedVia !== 'collection' ||
      !collectionCtx.designProfile.summary
    ) {
      throw new Error('shelf_get_collection must resolve the bound design profile')
    }
    let unknownCollectionRejected = false
    try {
      await callTool(client, 'shelf_get_collection', { id: 'nope' })
    } catch (err) {
      unknownCollectionRejected = /shelf_list_collections/.test(String(err.message || err))
    }
    if (!unknownCollectionRejected) {
      throw new Error('Unknown collection must error with list guidance')
    }
    let arglessRejected = false
    try {
      await callTool(client, 'shelf_get_collection', {})
    } catch {
      arglessRejected = true
    }
    if (!arglessRejected) {
      throw new Error('shelf_get_collection without id or name must error')
    }
    console.log('OK: collection context (members, runtime, brand)')

    // Resource: markdown brief on hit, JSON found:false on miss.
    const resource = await client.readResource({
      uri: `shelf://design/profiles/${seededProfile.id}`,
    })
    const resourceHit = resource.contents?.[0]
    if (
      resourceHit?.mimeType !== 'text/markdown' ||
      !String(resourceHit.text).includes('Smoke Brand')
    ) {
      throw new Error('Design profile resource must return the markdown brief')
    }
    const missing = await client.readResource({ uri: 'shelf://design/profiles/bogus' })
    const missBody = JSON.parse(missing.contents?.[0]?.text || '{}')
    if (missing.contents?.[0]?.mimeType !== 'application/json' || missBody.found !== false) {
      throw new Error('Missing design profile resource must return JSON found:false')
    }
    console.log('OK: design profile resource')

    // --- Agent write path: shelf_upsert_design_profile constraints ---
    const agentUpsert = await callTool(client, 'shelf_upsert_design_profile', {
      name: 'Extracted Brand',
      tokens: { color: { brand: { $value: '#a1b2c3', $type: 'color' } } },
      direction: 'Bold, geometric, high-contrast.',
      sourceNote: 'https://example.com/brand-page',
    })
    if (agentUpsert.action !== 'created' || agentUpsert.profile.origin !== 'agent') {
      throw new Error('Agent upsert must create an agent-owned profile')
    }
    if (agentUpsert.profile.isDefault) {
      throw new Error('Agent-created profile must not become default when one exists')
    }
    // The write response no longer echoes the whole brief; read it back.
    if ('brief' in agentUpsert || typeof agentUpsert.summary !== 'string') {
      throw new Error('Upsert response must summarize, not echo the brief')
    }
    const agentBrief = (await callTool(client, 'shelf_get_design_profile', { id: agentUpsert.profile.id })).brief
    if (
      !agentBrief?.includes('#a1b2c3') ||
      !agentBrief.includes('Source: https://example.com/brand-page')
    ) {
      throw new Error('Saved agent profile brief missing tokens or sourceNote')
    }
    const agentReupsert = await callTool(client, 'shelf_upsert_design_profile', {
      name: 'Extracted Brand',
      direction: 'Bold, geometric, high-contrast. Revised.',
    })
    if (agentReupsert.action !== 'updated' || agentReupsert.profile.id !== agentUpsert.profile.id) {
      throw new Error('Same-name re-extraction must update the agent draft in place')
    }

    // User-owned profiles are untouchable by name and by id.
    let userOwnedRejected = false
    try {
      await callTool(client, 'shelf_upsert_design_profile', { name: 'Smoke Brand' })
    } catch (err) {
      userOwnedRejected = /user-owned/i.test(String(err.message || err))
    }
    if (!userOwnedRejected) {
      throw new Error('Upsert must refuse a user-owned profile name with guidance')
    }
    let userIdRejected = false
    try {
      await callTool(client, 'shelf_upsert_design_profile', {
        id: seededProfile.id,
        name: 'Hijack',
      })
    } catch {
      userIdRejected = true
    }
    if (!userIdRejected) {
      throw new Error('Upsert must refuse an explicit user-owned profile id')
    }

    // Credential-looking content is refused in EVERY field, not masked —
    // including bare vendor tokens with no KEY= assignment.
    const secretPayloads = [
      { name: 'Leaky Brand', direction: 'Use API_KEY=abc123 everywhere.' },
      { name: 'Leaky Brand', sourceNote: 'from https://x.test?ACCESS_KEY=abc123' },
      {
        name: 'Leaky Brand',
        tokens: { color: { sneaky: { $value: 'AWS_SECRET=abc123', $type: 'color' } } },
      },
      { name: 'Leaky Brand', direction: `Deploy key ghp_${'a'.repeat(36)} lives here.` },
      { name: 'Leaky Brand', sourceNote: 'sk-a1b2cdefghijklmnop34qr' },
      // Mid-text PEM: \b never matched a leading '-', so this once slipped by.
      {
        name: 'Leaky Brand',
        direction: 'key follows:\n-----BEGIN RSA PRIVATE KEY-----\nMIIabc',
      },
      {
        name: 'Leaky Brand',
        tokens: {
          color: {
            sneaky: {
              $value: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij_klm',
              $type: 'color',
            },
          },
        },
      },
    ]
    for (const payload of secretPayloads) {
      let secretRejected = false
      try {
        await callTool(client, 'shelf_upsert_design_profile', payload)
      } catch {
        secretRejected = true
      }
      if (!secretRejected) {
        throw new Error(
          `Upsert must refuse credential-like content in ${Object.keys(payload).join('/')}`,
        )
      }
    }

    // Design-system vocabulary must NOT read as credentials: sk-/xox kebab
    // identifiers without digits are legitimate content (audit regression).
    const benign = await callTool(client, 'shelf_upsert_design_profile', {
      name: 'Kebab Brand',
      direction: 'Use sk-primary-button-large for CTAs; avoid xoxb-like-token-names.',
      tokens: {
        color: { 'sk-brand': { $value: 'var(--sk-color-brand-primary)', $type: 'color' } },
      },
    })
    if (benign.action !== 'created') {
      throw new Error('Kebab-case sk-/xox names must not be refused as secrets')
    }

    // Size caps: agent drafts are brand summaries, not document storage.
    const oversizePayloads = [
      { name: 'Cap Brand', direction: 'x'.repeat(20_001) },
      { name: 'Cap Brand', sourceNote: 'y'.repeat(1_001) },
      {
        name: 'Cap Brand',
        tokens: { blob: { big: { $value: 'z'.repeat(140 * 1024), $type: 'other' } } },
      },
      { name: 'N'.repeat(121) },
    ]
    for (const payload of oversizePayloads) {
      let oversizeRejected = false
      try {
        await callTool(client, 'shelf_upsert_design_profile', payload)
      } catch (err) {
        oversizeRejected = /exceeds|max/i.test(String(err.message || err))
      }
      if (!oversizeRejected) {
        throw new Error(
          `Upsert must refuse oversized ${Object.keys(payload).join('/')} with a size message`,
        )
      }
    }

    // Rename-by-id cannot masquerade under an existing profile's name.
    let renameRejected = false
    try {
      await callTool(client, 'shelf_upsert_design_profile', {
        id: agentUpsert.profile.id,
        name: 'Smoke Brand',
      })
    } catch {
      renameRejected = true
    }
    if (!renameRejected) {
      throw new Error('Rename-by-id onto an existing name must be refused')
    }

    // GUI edit transfers ownership and locks the agent out.
    profileStore.save({
      id: agentUpsert.profile.id,
      name: 'Extracted Brand',
      origin: 'user',
    })
    let lockedOut = false
    try {
      await callTool(client, 'shelf_upsert_design_profile', {
        id: agentUpsert.profile.id,
        name: 'Extracted Brand',
      })
    } catch {
      lockedOut = true
    }
    if (!lockedOut) {
      throw new Error('A user-edited profile must be closed to agent updates')
    }

    // The default never moved through any of the above.
    const afterUpserts = await callTool(client, 'shelf_list_design_profiles')
    const stillDefault = afterUpserts.profiles.find((p) => p.isDefault)
    if (afterUpserts.count !== 3 || stillDefault?.id !== seededProfile.id) {
      throw new Error('Agent writes must never move the default profile')
    }
    console.log('OK: agent upsert (draft-only, ownership, secret refusal)')

    // Gap briefs gain a Brand section once a profile resolves — existing
    // content (capabilities, register-back, id) must be untouched.
    const brandedBrief = await callTool(client, 'shelf_get_gap_brief', { id: smokeGap.id })
    if (
      !brandedBrief.brief.includes('### Brand (Shelf Design Engine)') ||
      !brandedBrief.brief.includes('shelf_get_design_profile') ||
      !brandedBrief.brief.includes(gapInput.capabilities[0]) ||
      !brandedBrief.brief.includes('shelf_register_project')
    ) {
      throw new Error('Gap brief must gain a Brand section without losing existing sections')
    }
    console.log('OK: gap brief brand section')

    // Collections launch through the stack contract, not member by member.
    const stack = await callTool(client, 'shelf_upsert_collection', { name: 'Launch Stack', toolIds: [toolId] })
    const bothIds = await client.callTool({ name: 'shelf_launch_tool', arguments: { id: toolId, collectionId: stack.collection.id } })
    if (!bothIds.isError) throw new Error('id and collectionId are mutually exclusive')
    const stackStarted = await callTool(client, 'shelf_launch_tool', { collectionId: stack.collection.id })
    if (stackStarted.results?.[0]?.outcome !== 'started' || stackStarted.results[0].status !== 'running' || 'state' in stackStarted.results[0]) {
      throw new Error(`collection launch must report compact member outcomes, got ${JSON.stringify(stackStarted)}`)
    }
    const stackStopped = await callTool(client, 'shelf_stop_tool', { collectionId: stack.collection.id })
    if (stackStopped.results?.[0]?.outcome !== 'stopped') {
      throw new Error(`collection stop must stop the member, got ${JSON.stringify(stackStopped)}`)
    }
    console.log('OK: launch/stop by collectionId')

    const launched = await callTool(client, 'shelf_launch_tool', { id: toolId })
    console.log('launch', launched.state.status, launched.state.message)
    if (launched.state.status !== 'running' || launched.status !== 'running') {
      throw new Error(`Expected running, got ${launched.state.status}`)
    }

    const logs = await callText(client, 'shelf_get_logs', { id: toolId, limit: 50 })
    if (!logs.includes('Sample tool listening') || !logs.startsWith(`${smokeName} (${toolId})`)) {
      throw new Error('Expected ready log line missing from the text log block')
    }
    if (/"toolId"|"stream"/.test(logs)) throw new Error('logs must be plain text, not per-line JSON')
    console.log('OK: logs (plain text)')

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
    const onlyFailed = await callTool(client, 'shelf_list_receipts', { id: toolId, outcomes: ['failed', 'error'] })
    if (onlyFailed.receipts.some((r) => r.outcome !== 'failed' && r.outcome !== 'error')) {
      throw new Error('outcomes filter must apply')
    }
    // A past run's output by runId (receipt ids are run ids).
    const pastRun = receiptList.receipts[receiptList.receipts.length - 1]
    const pastLogs = await callText(client, 'shelf_get_logs', { id: toolId, runId: pastRun.id })
    if (!pastLogs.includes(`run ${pastRun.id}`) || !pastLogs.includes('Sample tool listening')) {
      throw new Error('get_logs runId must return that run')
    }
    const unknownRun = await client.callTool({ name: 'shelf_get_logs', arguments: { id: toolId, runId: 'not-a-run' } })
    if (!unknownRun.isError || !/shelf_list_receipts/.test(unknownRun.content[0].text)) {
      throw new Error('unknown runId must point at shelf_list_receipts')
    }
    console.log('OK: receipts outcomes filter; logs by runId')

    // A launch failure carries agent-actionable next steps and the output
    // tail; a missing entry file is a bad command, not missing deps.
    const brokenPort = fixturePort + 1
    const broken = await callTool(client, 'shelf_upsert_tool', {
      name: `${smokeName} broken`,
      projectPath: fixture,
      launchCommand: 'node ./missing-entry.mjs',
      port: brokenPort,
      checkPort: false,
    })
    if (broken.action !== 'created') throw new Error('a second tool in an accepted folder may be created')
    const failedLaunch = await callTool(client, 'shelf_launch_tool', { id: broken.tool.id })
    if (
      failedLaunch.state.status !== 'error' ||
      failedLaunch.state.code !== 'bad_launch_command' ||
      !/shelf_upsert_tool/.test(failedLaunch.next || '') ||
      !/Cannot find module/.test(failedLaunch.logTail || '')
    ) {
      throw new Error(`failed launch must carry code/next/logTail, got ${JSON.stringify(failedLaunch).slice(0, 400)}`)
    }
    await callTool(client, 'shelf_remove_tool', { id: broken.tool.id })
    console.log('OK: failed launch → bad_launch_command with next + logTail')

    // Regression: a tool that never listens returns "starting" instead of
    // holding the request past the client timeout (wait shortened by env).
    const slowClient = new Client({ name: 'shelf-smoke-slow', version: '0.1.0' })
    await slowClient.connect(connectServer({ SHELF_MCP_LAUNCH_WAIT_MS: '1500' }))
    try {
      const slow = await callTool(slowClient, 'shelf_upsert_tool', {
        name: `${smokeName} never listens`,
        projectPath: fixture,
        launchCommand: 'node -e "setInterval(() => {}, 1000)"',
        port: fixturePort + 2,
        checkPort: false,
      })
      const t0 = Date.now()
      const slowLaunch = await callTool(slowClient, 'shelf_launch_tool', { id: slow.tool.id })
      const elapsed = Date.now() - t0
      if (slowLaunch.status !== 'starting' || !/shelf_get_status/.test(slowLaunch.next) || elapsed > 10_000) {
        throw new Error(`slow launch must return starting quickly, got ${slowLaunch.status} after ${elapsed}ms`)
      }
      const waited = await callTool(slowClient, 'shelf_get_status', { id: slow.tool.id, waitForMs: 800 })
      if (waited.state.status !== 'starting' || waited.waitedMs < 700 || !waited.next) {
        throw new Error(`get_status waitForMs must wait while starting, got ${JSON.stringify(waited)}`)
      }
      const slowStopped = await callTool(slowClient, 'shelf_stop_tool', { id: slow.tool.id })
      if (slowStopped.state.status !== 'stopped') throw new Error('stop must cancel a pending launch')
      await callTool(slowClient, 'shelf_remove_tool', { id: slow.tool.id })
      console.log(`OK: never-listening launch returned "starting" after ${elapsed}ms; waitForMs polls`)
    } finally {
      await slowClient.close()
    }

    // Regression: {} must not wipe every tool's history.
    const clearAll = await client.callTool({ name: 'shelf_clear_receipts', arguments: {} })
    if (!clearAll.isError || !/all: true/.test(clearAll.content[0].text)) {
      throw new Error('clear_receipts without id must require all: true')
    }
    if ((await callTool(client, 'shelf_list_receipts', { id: toolId })).count < 1) {
      throw new Error('refused clear must keep history')
    }
    const clearedOne = await callTool(client, 'shelf_clear_receipts', { id: toolId })
    if (typeof clearedOne.removed !== 'number') throw new Error('clear by id must still work')
    console.log('OK: clear_receipts requires all:true')

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
