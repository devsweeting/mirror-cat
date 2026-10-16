import { useId, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { Surface } from '@shared/types'
import { formatDuration, formatLabel, type MediaAsset, type MediaSource } from '@shared/media'
import MediaThumb from './MediaThumb'
import { useSceneStore } from '../state/sceneStore'
import { importDroppedFiles, pickAndImport, useMediaStore } from '../state/mediaStore'
import { useUiStore } from '../state/uiStore'
import { useFileDrop } from '../hooks/useFileDrop'

type Filter = 'all' | MediaSource

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'upload', label: 'Uploads' },
  { value: 'generated', label: 'Generated' }
]

interface LibraryPanelProps {
  /** The selected surface; "Use" and double-click put images on it. */
  targetSurfaceId: string | null
}

/**
 * Right-hand panel listing every image in the app-wide media library.
 * Click a tile to inspect it, double-click (or "Use on …") to put it on the
 * selected surface. Files dropped anywhere on the panel are imported.
 */
export default function LibraryPanel({ targetSurfaceId }: LibraryPanelProps) {
  const assets = useMediaStore((s) => s.assets)
  const importing = useMediaStore((s) => s.importing)
  const importErrors = useMediaStore((s) => s.importErrors)
  const dismissImportErrors = useMediaStore((s) => s.dismissImportErrors)
  const surfaces = useSceneStore((s) => s.surfaces)
  const setSurfaceAsset = useSceneStore((s) => s.setSurfaceAsset)
  const setLibraryOpen = useUiStore((s) => s.setLibraryOpen)

  const [filter, setFilter] = useState<Filter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showAssignHelp, setShowAssignHelp] = useState(false)
  const assignHelpId = useId()

  const target = surfaces.find((s) => s.id === targetSurfaceId) ?? null
  const usage = useMemo(() => {
    const map = new Map<string, Surface[]>()
    for (const surface of surfaces) {
      if (!surface.assetId) continue
      map.set(surface.assetId, [...(map.get(surface.assetId) ?? []), surface])
    }
    return map
  }, [surfaces])

  const visible = filter === 'all' ? assets : assets.filter((a) => a.source === filter)
  const selected = assets.find((a) => a.id === selectedId) ?? null

  const assign = (assetId: string): void => {
    if (target) setSurfaceAsset(target.id, assetId)
  }

  const afterImport = (imported: MediaAsset[]): void => {
    if (imported.length === 0) return
    setFilter('all')
    setSelectedId(imported[0].id)
  }

  const drop = useFileDrop<HTMLElement>((files) => {
    void importDroppedFiles(files).then(afterImport)
  })

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape' && !(event.target instanceof HTMLInputElement)) {
      setLibraryOpen(false)
    }
  }

  return (
    <aside
      id="media-library"
      className={`library-panel${drop.isOver ? ' drop-over' : ''}`}
      aria-label="Media library"
      onKeyDown={handleKeyDown}
      style={target ? ({ '--surface-color': target.outlineColor } as CSSProperties) : undefined}
      {...drop.handlers}
    >
      <header className="panel-head">
        <h2 className="panel-title">Library</h2>
        {assets.length > 0 && <span className="panel-count num">{assets.length}</span>}
        <button
          type="button"
          className="icon-btn panel-close"
          onClick={() => setLibraryOpen(false)}
          aria-label="Close media library"
          title="Close (Esc)"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      <div className="library-toolbar">
        <button
          type="button"
          className="btn library-upload"
          onClick={() => void pickAndImport().then(afterImport)}
          disabled={importing}
        >
          {importing ? 'Adding…' : 'Add images or videos'}
        </button>
        {target ? (
          <>
            <p className="library-target">
              <span className="target-swatch" aria-hidden="true" />
              <span>
                For <strong>{target.name}</strong>
              </span>
              <button
                type="button"
                className="info-button"
                onClick={() => setShowAssignHelp((v) => !v)}
                aria-expanded={showAssignHelp}
                aria-controls={assignHelpId}
                aria-label="How to put an image on a surface"
                title="How to put an image on a surface"
              >
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <circle
                    cx="8"
                    cy="8"
                    r="6.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                  />
                  <circle cx="8" cy="5" r="0.9" fill="currentColor" />
                  <path
                    d="M8 7.3v4.2"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </p>
            <p id={assignHelpId} className="drawer-help" hidden={!showAssignHelp}>
              Double-click an image to put it on <strong>{target.name}</strong>.
            </p>
          </>
        ) : (
          <p className="library-target">Add a surface to assign images</p>
        )}
        <div className="segmented library-filters" role="radiogroup" aria-label="Filter">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={filter === f.value}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {importErrors.length > 0 && (
        <div className="library-errors" role="alert">
          <ul>
            {importErrors.map((e, i) => (
              <li key={`${e.name}-${i}`}>
                <strong>{e.name}</strong> — {e.message}
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-ghost" onClick={dismissImportErrors}>
            Dismiss
          </button>
        </div>
      )}

      <div className="library-scroll">
        {visible.length === 0 ? (
          <div className="library-empty">
            <p>
              {assets.length === 0
                ? 'Images and videos you add or generate collect here.'
                : filter === 'generated'
                  ? 'Nothing generated yet. Ask Cat below the stage.'
                  : 'No uploads yet.'}
            </p>
            <p className="hint">Drop image files here, or choose Add images.</p>
          </div>
        ) : (
          <ul className="library-grid">
            {visible.map((asset) => {
              const usedOn = usage.get(asset.id) ?? []
              const onTarget = !!target && target.assetId === asset.id
              return (
                <li key={asset.id}>
                  <button
                    type="button"
                    className={`library-tile${asset.id === selectedId ? ' selected' : ''}${onTarget ? ' on-target' : ''}`}
                    onClick={() => setSelectedId(asset.id)}
                    onDoubleClick={() => assign(asset.id)}
                    aria-pressed={asset.id === selectedId}
                    title={
                      target ? `${asset.name} — double-click to use on ${target.name}` : asset.name
                    }
                  >
                    <MediaThumb asset={asset} />
                    {usedOn.length > 0 && (
                      <span className="tile-badge" title={`Used on ${usedOn.length} surface(s)`}>
                        {usedOn.length}
                      </span>
                    )}
                    <span className="tile-name">{asset.name}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {selected && (
        <AssetDetails
          key={selected.id}
          asset={selected}
          usedOn={usage.get(selected.id) ?? []}
          target={target}
          onAssign={() => assign(selected.id)}
          onDeleted={() => setSelectedId(null)}
        />
      )}

      {drop.isOver && (
        <div className="library-drop-overlay" aria-hidden="true">
          Drop to add to library
        </div>
      )}
    </aside>
  )
}

interface AssetDetailsProps {
  asset: MediaAsset
  usedOn: Surface[]
  target: Surface | null
  onAssign: () => void
  onDeleted: () => void
}

function AssetDetails({ asset, usedOn, target, onAssign, onDeleted }: AssetDetailsProps) {
  const clearAssetEverywhere = useSceneStore((s) => s.clearAssetEverywhere)
  const [mode, setMode] = useState<'idle' | 'renaming' | 'confirmDelete'>('idle')
  const [draftName, setDraftName] = useState(asset.name)
  const [deleting, setDeleting] = useState(false)
  const onTarget = target?.assetId === asset.id

  const commitRename = (): void => {
    setMode('idle')
    if (draftName.trim() && draftName.trim() !== asset.name) {
      void window.mirrorcat.media.rename(asset.id, draftName)
    }
  }

  const confirmDelete = async (): Promise<void> => {
    setDeleting(true)
    // Clear surfaces first so neither window is left pointing at a file
    // that's about to disappear.
    clearAssetEverywhere(asset.id)
    try {
      await window.mirrorcat.media.remove(asset.id)
      onDeleted()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section className="asset-details" aria-label={`Selected ${asset.kind}`}>
      {mode === 'renaming' ? (
        <input
          className="field asset-rename"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') {
              setDraftName(asset.name)
              setMode('idle')
            }
          }}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Image name"
          maxLength={80}
          autoFocus
        />
      ) : (
        <button
          type="button"
          className="asset-name"
          onClick={() => {
            setDraftName(asset.name)
            setMode('renaming')
          }}
          title="Rename"
        >
          {asset.name}
        </button>
      )}

      <p className="asset-meta">
        <span>{formatLabel(asset)}</span>
        {asset.width > 0 && asset.height > 0 && (
          <span className="num">
            {asset.width} × {asset.height}
          </span>
        )}
        {asset.durationMs !== undefined && (
          <span className="num">{formatDuration(asset.durationMs)}</span>
        )}
        <span className="num">{formatBytes(asset.bytes)}</span>
        <span>{asset.source === 'generated' ? 'Generated' : 'Uploaded'}</span>
      </p>
      {asset.kind === 'video' && asset.playable === false && (
        <p className="asset-warning">
          This video’s format can’t be played here. Re-export it as MP4 (H.264) and add it again.
        </p>
      )}
      {asset.prompt && <p className="asset-prompt">“{asset.prompt}”</p>}
      <p className="asset-usage">
        {usedOn.length === 0 ? 'Not on any surface' : `On ${usedOn.map((s) => s.name).join(', ')}`}
      </p>

      {mode === 'confirmDelete' ? (
        <div className="asset-confirm" role="alert">
          <p>
            {usedOn.length > 0
              ? `Delete it? ${usedOn.length === 1 ? 'That surface' : 'Those surfaces'} will go blank.`
              : `Delete this ${asset.kind} from the library?`}
          </p>
          <div className="asset-actions">
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void confirmDelete()}
              disabled={deleting}
            >
              Delete
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setMode('idle')}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="asset-actions">
          <button
            type="button"
            className="btn asset-use"
            onClick={onAssign}
            disabled={!target || onTarget}
          >
            {!target
              ? 'No surface selected'
              : onTarget
                ? `On ${target.name}`
                : `Use on ${target.name}`}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setMode('confirmDelete')}>
            Delete
          </button>
        </div>
      )}
    </section>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}
