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
      env: {
        SMOKE_SECRET_TOKEN: 'should-be-masked',
        // Not a "secret-looking" key name — ALL values must mask regardless.
        DATABASE_URL: 'postgres://user:hunter2@localhost/db',
      },
    })
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
      defaultProfile.tokens?.color?.brand?.$value !== '#7895ff' ||
      !defaultProfile.brief?.includes('#7895ff') ||
      !defaultProfile.brief.includes('Calm, precise')
    ) {
      throw new Error('Zero-arg shelf_get_design_profile must return default tokens + brief')
    }
    if (
      defaultProfile.direction.includes('leakme') ||
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
    if (
      !agentUpsert.brief?.includes('#a1b2c3') ||
      !agentUpsert.brief.includes('Source: https://example.com/brand-page')
    ) {
      throw new Error('Upsert response brief missing tokens or sourceNote')
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
