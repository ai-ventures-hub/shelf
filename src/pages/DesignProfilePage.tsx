/**
 * Design profile editor. Auto-saves a local draft (name/tokens/modes/
 * direction) on a 500ms debounce — assets are deliberately outside the draft
 * and mutate through their own IPC, so asset ops never collide with the
 * debounce. External file changes are adopted only while the editor is
 * clean; while dirty, the local edit wins and its save overwrites (the
 * watcher re-syncs the moment the editor is clean again).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AssetsSection } from '../components/design/AssetsSection'
import {
  ColorTokensSection,
  type ColorEditTarget,
} from '../components/design/ColorTokensSection'
import { DesignPreview } from '../components/design/DesignPreview'
import { NamePromptDialog } from '../components/NamePromptDialog'
import { useDesignProfiles } from '../hooks/useDesignProfiles'
import { usePrefs } from '../hooks/usePrefs'
import { useUiMode } from '../hooks/useUiMode'
import {
  STARTER_TOKENS,
  deleteToken,
  flattenGroup,
  humanizeTokenName,
  leavesOf,
  setToken,
} from '../lib/designTokens'
import type { DesignAssetKind, DesignTokenGroup } from '../types'

interface Draft {
  name: string
  tokens: DesignTokenGroup
  modes: { light: DesignTokenGroup; dark: DesignTokenGroup }
  direction: string
}

type SaveState = 'idle' | 'pending' | 'saved' | 'error'

const SAVE_DEBOUNCE_MS = 500

function serialize(draft: Draft): string {
  return JSON.stringify(draft)
}

export function DesignProfilePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { isDeveloper } = useUiMode()
  const { resolvedTheme } = usePrefs()
  const {
    profiles,
    loading,
    saveProfile,
    deleteProfile,
    setDefaultProfile,
    pickAsset,
    importAsset,
    removeAsset,
  } = useDesignProfiles()
  const profile = profiles.find((p) => p.id === id)

  const [draft, setDraft] = useState<Draft | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<ColorEditTarget>('base')
  // Start the preview in the app's own theme so it never contradicts what the
  // user just saw (a light starter palette under a "Dark" toggle reads broken).
  const [previewMode, setPreviewMode] = useState<'light' | 'dark'>(resolvedTheme)
  const [addColorOpen, setAddColorOpen] = useState(false)
  const [briefCopied, setBriefCopied] = useState(false)
  const [assetBusy, setAssetBusy] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [jsonDirty, setJsonDirty] = useState(false)
  const [jsonError, setJsonError] = useState<string | null>(null)

  const lastSavedRef = useRef('')
  const lastSavedNameRef = useRef('')
  const adoptedIdRef = useRef('')
  const adoptedUpdatedAtRef = useRef('')
  const timerRef = useRef<number | null>(null)
  const draftRef = useRef<Draft | null>(null)
  draftRef.current = draft

  const adoptProfile = useCallback(() => {
    if (!profile) return
    const next: Draft = {
      name: profile.name,
      tokens: profile.tokens,
      modes: profile.modes,
      direction: profile.direction,
    }
    setDraft(next)
    lastSavedRef.current = serialize(next)
    lastSavedNameRef.current = profile.name
    adoptedIdRef.current = profile.id
    adoptedUpdatedAtRef.current = profile.updatedAt
  }, [profile])

  // Seed on first load and UNCONDITIONALLY on id change — the route element is
  // reused for /design/a → /design/b, and showing A's draft under B's URL
  // would let the next keystroke overwrite B with A's content. Any pending
  // save for A is flushed by the [persist]-cleanup effect (old closure, old
  // id) before this adopts B.
  useEffect(() => {
    if (profile && profile.id !== adoptedIdRef.current) adoptProfile()
  }, [profile, adoptProfile])

  // External reconciliation: adopt refreshed data only while clean.
  useEffect(() => {
    if (!profile || !draft) return
    const clean = serialize(draft) === lastSavedRef.current && timerRef.current === null
    if (clean && profile.updatedAt !== adoptedUpdatedAtRef.current) adoptProfile()
  }, [profile, draft, adoptProfile])

  const persist = useCallback(
    async (toSave: Draft) => {
      if (!id) return
      // Never send an empty name — the store rejects it; keep the last good one.
      const name = toSave.name.trim() || lastSavedNameRef.current
      try {
        const saved = await saveProfile({
          id,
          name,
          tokens: toSave.tokens,
          modes: toSave.modes,
          direction: toSave.direction,
        })
        lastSavedRef.current = serialize(toSave)
        lastSavedNameRef.current = saved.name
        adoptedUpdatedAtRef.current = saved.updatedAt
        // Newer edits may already be pending — don't claim "Saved" over them.
        if (timerRef.current === null) {
          setSaveState('saved')
          window.setTimeout(() => {
            setSaveState((cur) => (cur === 'saved' ? 'idle' : cur))
          }, 2000)
        }
      } catch (err) {
        setSaveState('error')
        setSaveError(err instanceof Error ? err.message : String(err))
      }
    },
    [id, saveProfile],
  )

  const updateDraft = useCallback(
    (patch: Partial<Draft>) => {
      setDraft((cur) => {
        if (!cur) return cur
        const next = { ...cur, ...patch }
        setSaveState('pending')
        setSaveError(null)
        if (timerRef.current !== null) window.clearTimeout(timerRef.current)
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null
          void persist(next)
        }, SAVE_DEBOUNCE_MS)
        return next
      })
    },
    [persist],
  )

  // Flush a pending save when leaving the page.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
        if (draftRef.current) void persist(draftRef.current)
      }
    }
  }, [persist])

  // Advanced JSON tracks GUI edits until the user starts typing in it —
  // otherwise Apply would silently revert colors changed while it was open.
  useEffect(() => {
    if (!jsonDirty && draft) {
      setJsonText(JSON.stringify({ tokens: draft.tokens, modes: draft.modes }, null, 2))
      setJsonError(null)
    }
  }, [jsonDirty, draft])

  if (!loading && !profile) {
    return (
      <div className="empty-state">
        <div>
          <h2>Profile not found</h2>
          <Link className="btn btn-primary" to="/design">
            Back to Design
          </Link>
        </div>
      </div>
    )
  }
  if (!profile || !draft) return null

  const mode = editTarget === 'base' ? null : editTarget

  function changeToken(path: string, value: string) {
    if (!draft) return
    if (mode) {
      updateDraft({
        modes: { ...draft.modes, [mode]: setToken(draft.modes[mode], path, value, 'color') },
      })
    } else {
      updateDraft({ tokens: setToken(draft.tokens, path, value, 'color') })
    }
  }

  function clearOverride(path: string) {
    if (!draft || !mode) return
    updateDraft({
      modes: { ...draft.modes, [mode]: deleteToken(draft.modes[mode], path) },
    })
  }

  function addColor(rawName: string) {
    if (!draft) return
    const name = rawName
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
    // Never clobber an existing color with the placeholder value.
    const exists = leavesOf(draft.tokens, 'color').some(
      (leaf) => leaf.path === `color.${name}`,
    )
    if (name && !exists) {
      updateDraft({ tokens: setToken(draft.tokens, `color.${name}`, '#888888', 'color') })
    }
    setAddColorOpen(false)
  }

  async function copyBrief() {
    if (!id) return
    try {
      const brief = await window.shelf.designBrief(id)
      if (!brief) return
      await navigator.clipboard.writeText(brief)
      setBriefCopied(true)
      window.setTimeout(() => setBriefCopied(false), 2000)
    } catch (err) {
      setSaveState('error')
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }

  async function makeDefault() {
    if (!profile) return
    try {
      await setDefaultProfile(profile.id)
    } catch (err) {
      setSaveState('error')
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleDelete() {
    if (!profile) return
    const others = profiles.filter((p) => p.id !== profile.id)
    const successor = profile.isDefault && others.length > 0 ? others[0] : null
    const message = successor
      ? `Delete “${profile.name}”? “${successor.name}” will become the default profile and agents will pick it up immediately.`
      : `Delete “${profile.name}”? Agents will no longer find this brand.`
    if (!window.confirm(message)) return
    await deleteProfile(profile.id)
    if (successor) await setDefaultProfile(successor.id)
    navigate('/design')
  }

  async function runAssetOp(op: () => Promise<unknown>) {
    setAssetBusy(true)
    try {
      await op()
    } catch (err) {
      // Surface through the same banner as save failures — a silently
      // missing asset reads as "the drop did nothing".
      setSaveState('error')
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setAssetBusy(false)
    }
  }

  /** Filename heuristic so a dropped logo shows up in the preview immediately. */
  function guessAssetKind(sourcePath: string): DesignAssetKind {
    const base = sourcePath.split('/').pop()?.toLowerCase() || ''
    if (base.includes('wordmark') || base.includes('lockup')) return 'wordmark'
    if (base.includes('logo') || base.includes('mark')) return 'logo'
    if (base.includes('icon') || base.includes('favicon')) return 'icon'
    const hasLogo = profile?.assets.some((a) => a.kind === 'logo' || a.kind === 'wordmark')
    const isImage = /\.(svg|png|jpe?g|webp|gif)$/.test(base)
    return !hasLogo && isImage ? 'logo' : 'other'
  }

  function applyJson() {
    const isGroup = (v: unknown): boolean =>
      v === undefined || (typeof v === 'object' && v !== null && !Array.isArray(v))
    try {
      const parsed = JSON.parse(jsonText) as {
        tokens?: DesignTokenGroup
        modes?: { light?: DesignTokenGroup; dark?: DesignTokenGroup }
      }
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        !isGroup(parsed.tokens) ||
        !isGroup(parsed.modes) ||
        !isGroup(parsed.modes?.light) ||
        !isGroup(parsed.modes?.dark)
      ) {
        throw new Error('Expected an object with "tokens" and "modes" token groups.')
      }
      updateDraft({
        tokens: parsed.tokens ?? {},
        modes: { light: parsed.modes?.light ?? {}, dark: parsed.modes?.dark ?? {} },
      })
      setJsonError(null)
      setJsonDirty(false)
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : String(err))
    }
  }

  const typographyLeaves = leavesOf(draft.tokens, 'typography')
  const dimensionLeaves = leavesOf(draft.tokens, 'dimension')

  /** Re-seed one emptied group so Simple mode is never a dead end. */
  function restoreStarterGroup(group: 'typography' | 'dimension') {
    if (!draft) return
    let tokens = draft.tokens
    for (const leaf of flattenGroup(STARTER_TOKENS[group] as DesignTokenGroup, group)) {
      tokens = setToken(tokens, leaf.path, leaf.value, leaf.type)
    }
    updateDraft({ tokens })
  }

  return (
    <>
      <header className="page-header-compact design-editor-header">
        <Link className="btn btn-quiet btn-sm" to="/design" title="Back to Design">
          ← Design
        </Link>
        <input
          className="design-name-input"
          value={draft.name}
          aria-label="Profile name"
          placeholder="Profile name"
          onChange={(e) => updateDraft({ name: e.target.value })}
          onBlur={() => {
            if (!draft.name.trim()) updateDraft({ name: lastSavedNameRef.current })
          }}
        />
        {/* Visual-only indicator — announcing every debounce cycle would be
            screen-reader noise; failures use the role=alert banner below. */}
        <span
          className={`design-saved is-${!draft.name.trim() ? 'error' : saveState}`}
        >
          {!draft.name.trim()
            ? 'Name required'
            : saveState === 'pending'
              ? 'Saving…'
              : saveState === 'saved'
                ? 'Saved ✓'
                : ''}
        </span>
        {profile.isDefault ? (
          <span className="tag-chip" title="Agents resolve this profile by default">
            Default
          </span>
        ) : (
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => void makeDefault()}
          >
            Make default
          </button>
        )}
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => void copyBrief()}>
          {briefCopied ? 'Copied ✓' : 'Copy brand brief'}
        </button>
        <button
          type="button"
          className="btn btn-danger btn-sm"
          onClick={() => void handleDelete()}
        >
          Delete
        </button>
      </header>

      {saveState === 'error' && saveError ? (
        <div className="warning-card" role="alert">
          Could not save: {saveError}{' '}
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => draftRef.current && void persist(draftRef.current)}
          >
            Retry
          </button>
        </div>
      ) : null}

      <div className="design-editor">
        <div className="design-editor-main stack">
          <ColorTokensSection
            tokens={draft.tokens}
            modes={draft.modes}
            editTarget={editTarget}
            onEditTargetChange={(target) => {
              setEditTarget(target)
              // Editing a mode should show that mode — once — then stay manual.
              if (target !== 'base') setPreviewMode(target)
            }}
            onChangeToken={changeToken}
            onClearOverride={clearOverride}
            onAddColor={() => setAddColorOpen(true)}
          />

          <section className="panel">
            <header className="panel-header">
              <h2 className="panel-title">Typography</h2>
            </header>
            <div className="panel-body">
              {typographyLeaves.length === 0 ? (
                <div className="action-row" style={{ margin: 0 }}>
                  <p className="field-hint" style={{ margin: 0 }}>
                    No typography tokens in this profile.
                  </p>
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={() => restoreStarterGroup('typography')}
                  >
                    Add starter typography
                  </button>
                </div>
              ) : null}
              <div className="form-grid">
                {typographyLeaves.map((leaf) => {
                  const label = humanizeTokenName(leaf.path.replace(/^typography\./, ''))
                  return (
                    <label key={leaf.path} className="field">
                      <span className="field-label">{label}</span>
                      <input
                        className="field-input"
                        value={String(leaf.value)}
                        onChange={(e) =>
                          updateDraft({
                            tokens: setToken(
                              draft.tokens,
                              leaf.path,
                              leaf.type === 'fontWeight' && /^\d+$/.test(e.target.value)
                                ? Number(e.target.value)
                                : e.target.value,
                              leaf.type,
                            ),
                          })
                        }
                      />
                    </label>
                  )
                })}
                <p className="field-hint span-2" style={{ margin: 0 }}>
                  Fonts preview only if installed on this Mac — agents receive the family
                  names either way.
                </p>
              </div>
            </div>
          </section>

          <section className="panel">
            <header className="panel-header">
              <h2 className="panel-title">Dimension</h2>
            </header>
            <div className="panel-body">
              {dimensionLeaves.length === 0 ? (
                <div className="action-row" style={{ margin: 0 }}>
                  <p className="field-hint" style={{ margin: 0 }}>
                    No dimension tokens in this profile.
                  </p>
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={() => restoreStarterGroup('dimension')}
                  >
                    Add starter dimensions
                  </button>
                </div>
              ) : null}
              <div className="form-grid">
                {dimensionLeaves.map((leaf) => (
                  <label key={leaf.path} className="field">
                    <span className="field-label">
                      {humanizeTokenName(leaf.path.replace(/^dimension\./, ''))}
                    </span>
                    <input
                      className="field-input"
                      value={String(leaf.value)}
                      placeholder="e.g. 12px"
                      onChange={(e) =>
                        updateDraft({
                          tokens: setToken(draft.tokens, leaf.path, e.target.value, 'dimension'),
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
          </section>

          <section className="panel">
            <header className="panel-header">
              <h2 className="panel-title">Direction</h2>
            </header>
            <div className="panel-body stack">
              <textarea
                className="field-textarea design-direction"
                value={draft.direction}
                aria-label="Brand direction"
                placeholder={'# Voice\nCalm, specific, no hype.\n\n## Do\n- …\n\n## Don\'t\n- …'}
                onChange={(e) => updateDraft({ direction: e.target.value })}
              />
              <p className="field-hint" style={{ margin: 0 }}>
                Voice, personality, do/don't — markdown, pasted verbatim into agent briefs.
              </p>
            </div>
          </section>

          <AssetsSection
            assets={profile.assets}
            busy={assetBusy}
            onPick={() => void runAssetOp(() => pickAsset(profile.id, 'other'))}
            onDropPaths={(paths) =>
              void runAssetOp(async () => {
                for (const p of paths) await importAsset(profile.id, p, guessAssetKind(p))
              })
            }
            onRemove={(asset) => {
              const basename = asset.path.split('/').pop() || asset.path
              if (
                !window.confirm(
                  `Remove ${basename}? Shelf deletes its copied file; the original stays where it came from.`,
                )
              ) {
                return
              }
              void runAssetOp(() => removeAsset(profile.id, asset.path))
            }}
            onKindChange={(asset, kind) =>
              void runAssetOp(() =>
                saveProfile({
                  id: profile.id,
                  name: profile.name,
                  assets: profile.assets.map((a) =>
                    a.path === asset.path ? { ...a, kind } : a,
                  ),
                }),
              )
            }
          />

          {isDeveloper ? (
            <section className="form-advanced">
              <button
                type="button"
                className="form-advanced-toggle"
                aria-expanded={advancedOpen}
                onClick={() => setAdvancedOpen((v) => !v)}
              >
                <span>Advanced — raw tokens (DTCG JSON)</span>
              </button>
              {advancedOpen ? (
                <div className="stack" style={{ marginTop: '0.75rem' }}>
                  <textarea
                    className="field-textarea design-json"
                    value={jsonText}
                    spellCheck={false}
                    aria-label="Raw tokens JSON"
                    onChange={(e) => {
                      setJsonText(e.target.value)
                      setJsonDirty(true)
                    }}
                  />
                  {jsonError ? (
                    <p className="field-hint" style={{ margin: 0, color: 'var(--danger)' }}>
                      {jsonError}
                    </p>
                  ) : null}
                  <div className="action-row" style={{ margin: 0 }}>
                    <button type="button" className="btn btn-quiet btn-sm" onClick={applyJson}>
                      Apply JSON
                    </button>
                    <p className="field-hint" style={{ margin: 0 }}>
                      Paste Style Dictionary / Figma token exports. Applies only when valid —
                      raw text never auto-saves.
                    </p>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>

        <DesignPreview
          name={draft.name}
          tokens={draft.tokens}
          modes={draft.modes}
          assets={profile.assets}
          mode={previewMode}
          onModeChange={setPreviewMode}
        />
      </div>

      <NamePromptDialog
        open={addColorOpen}
        title="Add color"
        label="Color name"
        placeholder="e.g. brand-strong"
        confirmLabel="Add"
        onCancel={() => setAddColorOpen(false)}
        onConfirm={addColor}
      />
    </>
  )
}
