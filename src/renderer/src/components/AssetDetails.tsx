import { useState } from 'react'
import type { Surface } from '@shared/types'
import { formatDuration, formatLabel, type MediaAsset } from '@shared/media'
import { useSceneStore } from '../state/sceneStore'
import { useMediaStore } from '../state/mediaStore'

interface AssetDetailsProps {
  asset: MediaAsset
  usedOn: Surface[]
  target: Surface | null
  onAssign: () => void
  onDeleted: () => void
}

/** The selected asset's details, rename, assign and delete, under the library grid. */
export default function AssetDetails({
  asset,
  usedOn,
  target,
  onAssign,
  onDeleted
}: AssetDetailsProps) {
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
    } catch (error) {
      console.error('[media] delete failed', error)
      useMediaStore.setState({
        importErrors: [{ name: asset.name, message: 'Couldn’t delete this file. Try again.' }]
      })
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
