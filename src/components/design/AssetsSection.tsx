/**
 * Brand assets panel: thumbnail tiles with per-asset kind, remove, one
 * "Add asset" picker button, and drag-and-drop onto the grid. Assets mutate
 * through their own IPC (not the editor draft), so they never collide with
 * the token auto-save debounce.
 */
import { useEffect, useState, type DragEvent } from 'react'
import type { DesignAsset, DesignAssetKind } from '../../types'

const KINDS: DesignAssetKind[] = ['logo', 'wordmark', 'icon', 'other']

function AssetThumb({ asset }: { asset: DesignAsset }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    window.shelf?.designAssetDataUrl?.(asset.path)
      .then((url) => {
        if (!cancelled) setSrc(url)
      })
      .catch(() => {
        if (!cancelled) setSrc(null)
      })
    return () => {
      cancelled = true
    }
  }, [asset.path])

  if (src) return <img src={src} alt="" />
  // Non-previewable (pdf, fonts): file-extension glyph.
  const ext = asset.path.split('.').pop()?.toUpperCase() || 'FILE'
  return <span className="asset-glyph">{ext}</span>
}

interface AssetsSectionProps {
  assets: DesignAsset[]
  busy: boolean
  onPick: () => void
  onDropPaths: (paths: string[]) => void
  onRemove: (asset: DesignAsset) => void
  onKindChange: (asset: DesignAsset, kind: DesignAssetKind) => void
}

export function AssetsSection({
  assets,
  busy,
  onPick,
  onDropPaths,
  onRemove,
  onKindChange,
}: AssetsSectionProps) {
  const [dragOver, setDragOver] = useState(false)

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const paths = Array.from(e.dataTransfer.files)
      .map((file) => window.shelf?.getPathForFile?.(file))
      .filter((p): p is string => Boolean(p))
    if (paths.length > 0) onDropPaths(paths)
  }

  return (
    <section className="panel">
      <header className="panel-header">
        <h2 className="panel-title">Assets</h2>
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          disabled={busy}
          onClick={onPick}
        >
          Add asset
        </button>
      </header>
      <div className="panel-body stack">
        <div
          className={`asset-grid${dragOver ? ' is-dragover' : ''}`}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault()
              setDragOver(true)
            }
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {assets.map((asset) => {
            const basename = asset.path.split('/').pop() || asset.path
            return (
              <div key={asset.path} className="asset-tile">
                <button
                  type="button"
                  className="asset-tile-remove"
                  title="Remove asset"
                  aria-label={`Remove ${basename}`}
                  disabled={busy}
                  onClick={() => onRemove(asset)}
                >
                  ×
                </button>
                <AssetThumb asset={asset} />
                <span className="asset-tile-name" title={asset.path}>
                  {basename}
                </span>
                <select
                  className="field-input asset-kind-select"
                  value={asset.kind}
                  aria-label={`Kind for ${basename}`}
                  disabled={busy}
                  onChange={(e) => onKindChange(asset, e.target.value as DesignAssetKind)}
                >
                  {KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </select>
              </div>
            )
          })}
          {assets.length === 0 ? (
            <p className="field-hint asset-grid-empty">
              Drop logo or wordmark files here, or use Add asset. SVG and PNG preview;
              fonts and PDFs are stored for agents.
            </p>
          ) : null}
        </div>
        <p className="field-hint" style={{ margin: 0 }}>
          Files are copied into Shelf's data folder — agents get absolute paths in the brand
          brief.
        </p>
      </div>
    </section>
  )
}
