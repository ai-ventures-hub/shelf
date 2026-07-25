import { useEffect, useState } from 'react'
import { ColorField } from '../components/ColorField'
import { LucideIconPicker } from '../components/LucideIconPicker'
import { useLibrary } from '../hooks/useLibrary'
import { usePrefs } from '../hooks/usePrefs'
import type { AppearanceMode } from '../types'

const APPEARANCE: { id: AppearanceMode; label: string; hint: string }[] = [
  { id: 'system', label: 'System', hint: 'Follow macOS light/dark appearance.' },
  { id: 'light', label: 'Light', hint: 'Always use the light Studio palette.' },
  { id: 'dark', label: 'Dark', hint: 'Always use the dark Studio palette.' },
]

/** Presets mirrored from shared/global-shortcut.ts for the renderer bundle. */
const SHORTCUT_PRESETS = [
  { accelerator: 'Command+Shift+Space', label: '⌘⇧Space' },
  { accelerator: 'Alt+Space', label: '⌥Space' },
  { accelerator: 'Control+Shift+S', label: '⌃⇧S' },
  { accelerator: 'Command+Option+Space', label: '⌘⌥Space' },
] as const

export function SettingsPage() {
  const { prefs, updatePrefs, resolvedTheme, shortcutStatus } = usePrefs()
  const { tools, collections } = useLibrary()
  // Draft so typing does not re-register the hotkey on every keystroke.
  const [shortcutDraft, setShortcutDraft] = useState(prefs.globalShortcut)

  useEffect(() => {
    setShortcutDraft(prefs.globalShortcut)
  }, [prefs.globalShortcut])

  async function commitShortcut(next: string) {
    const trimmed = next.trim()
    setShortcutDraft(trimmed)
    if (trimmed === prefs.globalShortcut) return
    await updatePrefs({ globalShortcut: trimmed })
  }

  return (
    <>
      <header className="page-header page-header-compact">
        <div className="page-header-copy">
          <h1 className="page-title">Settings</h1>
          <p className="page-meta">Appearance and desktop preferences for this Mac.</p>
        </div>
      </header>

      <section className="panel" style={{ marginBottom: '1rem' }}>
        <div className="panel-header">
          <h2 className="panel-title">Appearance</h2>
        </div>
        <div className="panel-body stack">
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            Active theme: <strong>{resolvedTheme}</strong>
          </p>
          <div className="appearance-grid" role="radiogroup" aria-label="Appearance">
            {APPEARANCE.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={prefs.appearance === opt.id}
                className={`appearance-card${prefs.appearance === opt.id ? ' is-selected' : ''}`}
                onClick={() => void updatePrefs({ appearance: opt.id })}
              >
                <strong>{opt.label}</strong>
                <span>{opt.hint}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: '1rem' }}>
        <div className="panel-header">
          <h2 className="panel-title">Tool icon defaults</h2>
        </div>
        <div className="panel-body stack">
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            Applied when you create a new tool. Each tool can still override these on its edit
            form.
          </p>
          <div className="field">
            <span className="field-label">Default Lucide icon</span>
            <LucideIconPicker
              value={prefs.defaultIconLucide}
              iconColor={prefs.defaultIconColor}
              iconBackground={prefs.defaultIconBackground}
              onChange={(name) => void updatePrefs({ defaultIconLucide: name })}
            />
          </div>
          <div className="form-grid">
            <ColorField
              id="defaultIconBackground"
              label="Background Color"
              value={prefs.defaultIconBackground}
              onChange={(hex) => void updatePrefs({ defaultIconBackground: hex })}
            />
            <ColorField
              id="defaultIconColor"
              label="Icon Color"
              value={prefs.defaultIconColor}
              onChange={(hex) => void updatePrefs({ defaultIconColor: hex })}
            />
          </div>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: '1rem' }}>
        <div className="panel-header">
          <h2 className="panel-title">Library layout</h2>
        </div>
        <div className="panel-body stack">
          <label className="field">
            <span className="field-label">Default view</span>
            <select
              className="field-input"
              value={prefs.viewMode}
              onChange={(e) =>
                void updatePrefs({ viewMode: e.target.value as typeof prefs.viewMode })
              }
            >
              <option value="grid">Grid</option>
              <option value="list">List</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Default sort</span>
            <select
              className="field-input"
              value={prefs.sort}
              onChange={(e) =>
                void updatePrefs({ sort: e.target.value as typeof prefs.sort })
              }
            >
              <option value="name">Name</option>
              <option value="recent">Recent</option>
              <option value="status">Status</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Sidebar width ({prefs.sidebarWidth}px)</span>
            <input
              type="range"
              min={210}
              max={280}
              value={prefs.sidebarWidth}
              onChange={(e) =>
                void updatePrefs({ sidebarWidth: Number(e.target.value) })
              }
            />
          </label>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: '1rem' }}>
        <div className="panel-header">
          <h2 className="panel-title">Menu bar &amp; global shortcut</h2>
        </div>
        <div className="panel-body stack">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={prefs.menuBarEnabled}
              onChange={(e) => void updatePrefs({ menuBarEnabled: e.target.checked })}
            />
            Show Shelf in the menu bar
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={prefs.closeToMenuBar}
              disabled={!prefs.menuBarEnabled}
              onChange={(e) => void updatePrefs({ closeToMenuBar: e.target.checked })}
            />
            Close window hides to menu bar (Quit from tray / ⌘Q)
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={prefs.globalShortcutEnabled}
              onChange={(e) =>
                void updatePrefs({ globalShortcutEnabled: e.target.checked })
              }
            />
            Enable global show/hide shortcut
          </label>
          {prefs.globalShortcutEnabled && shortcutStatus && !shortcutStatus.ok ? (
            <div className="warning-card" role="alert">
              <strong>Shortcut not active.</strong> {shortcutStatus.error}
              <div className="shortcut-preset-row" style={{ marginTop: '0.75rem' }}>
                {SHORTCUT_PRESETS.filter((p) => p.accelerator !== shortcutStatus.accelerator)
                  .slice(0, 3)
                  .map((preset) => (
                    <button
                      key={preset.accelerator}
                      type="button"
                      className="btn btn-quiet btn-sm"
                      onClick={() => void commitShortcut(preset.accelerator)}
                    >
                      Try {preset.label}
                    </button>
                  ))}
              </div>
            </div>
          ) : null}
          {prefs.globalShortcutEnabled && shortcutStatus?.ok ? (
            <p className="field-hint" style={{ margin: 0 }}>
              Active: <code>{shortcutStatus.accelerator}</code>
            </p>
          ) : null}
          <label className="field">
            <span className="field-label">Global shortcut</span>
            <input
              className="field-input"
              value={shortcutDraft}
              disabled={!prefs.globalShortcutEnabled}
              onChange={(e) => setShortcutDraft(e.target.value)}
              onBlur={() => void commitShortcut(shortcutDraft)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void commitShortcut(shortcutDraft)
                }
              }}
              placeholder="Command+Shift+Space"
            />
            <div className="shortcut-preset-row" aria-label="Shortcut presets">
              {SHORTCUT_PRESETS.map((preset) => (
                <button
                  key={preset.accelerator}
                  type="button"
                  className={
                    prefs.globalShortcut === preset.accelerator
                      ? 'btn btn-quiet btn-sm is-selected'
                      : 'btn btn-quiet btn-sm'
                  }
                  disabled={!prefs.globalShortcutEnabled}
                  onClick={() => void commitShortcut(preset.accelerator)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <p className="field-hint">
              Electron accelerator syntax. Applies on blur or Enter. Another app may already
              own the key — use a preset if registration fails.
            </p>
          </label>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: '1rem' }}>
        <div className="panel-header">
          <h2 className="panel-title">URL scheme</h2>
        </div>
        <div className="panel-body stack">
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            Shelf registers the <code>shelf://</code> protocol so agents and scripts can open or
            control tools.
          </p>
          <ul className="shortcut-list">
            <li>
              <code>shelf://open</code> — show Shelf
            </li>
            <li>
              <code>shelf://quick-open</code> — show Quick Open
            </li>
            <li>
              <code>shelf://tools/&#123;id&#125;</code> — open a tool
            </li>
            <li>
              <code>shelf://tools/&#123;id&#125;/launch</code> — launch
            </li>
            <li>
              <code>shelf://launch?name=Photo%20Prepper</code> — launch by name
            </li>
          </ul>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: '1rem' }}>
        <div className="panel-header">
          <h2 className="panel-title">Shortcuts</h2>
        </div>
        <div className="panel-body">
          <ul className="shortcut-list">
            <li>
              <kbd>⌘K</kbd> Quick Open
            </li>
            <li>
              <kbd>⌘⇧Space</kbd> Show / hide Shelf (global)
            </li>
            <li>
              <kbd>⌘N</kbd> Add tool
            </li>
            <li>
              <kbd>⌘F</kbd> Focus library search
            </li>
            <li>
              <kbd>⌘,</kbd> Settings
            </li>
          </ul>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: '1rem' }}>
        <div className="panel-header">
          <h2 className="panel-title">Run history</h2>
        </div>
        <div className="panel-body stack">
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            Launch receipts are stored locally in Application Support (separate from the tool
            library). Cap is 400 entries. Filter and export from Recent, or export everything here.
          </p>
          <div className="action-row" style={{ marginBottom: 0, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                void window.shelf.exportReceipts({ format: 'json' }).then((result) => {
                  if (result.saved && result.path) {
                    window.alert(`Saved receipts to ${result.path}`)
                  }
                })
              }}
            >
              Export JSON
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                void window.shelf.exportReceipts({ format: 'csv' }).then((result) => {
                  if (result.saved && result.path) {
                    window.alert(`Saved receipts to ${result.path}`)
                  }
                })
              }}
            >
              Export CSV
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                if (!window.confirm('Clear all run receipts on this Mac?')) return
                void window.shelf.clearReceipts().then(() => {
                  window.alert('Run history cleared.')
                })
              }}
            >
              Clear all receipts
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">About this library</h2>
        </div>
        <div className="panel-body">
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            {tools.length} tools · {collections.length} collections · local-first · no account
          </p>
          <p style={{ margin: '0.75rem 0 0', color: 'var(--subtle)', fontSize: '0.85rem' }}>
            Shelf Community includes the full personal library, process lifecycle, MCP tools,
            organization, and project DESIGN.md bridge. Shelf Profiles (reusable design
            governance) is a future separately licensed add-on — not required for core use.
          </p>
        </div>
      </section>
    </>
  )
}
