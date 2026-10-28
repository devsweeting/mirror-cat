import { useId, useRef, useState, type ChangeEvent, type CSSProperties } from 'react'
import type { Surface } from '@shared/types'
import { mediaUrl } from '@shared/media'
import {
  DEFAULT_MASK_PARAMS,
  MAX_MASK_FEATHER,
  MAX_MASK_GROW,
  maskUrl
} from '@shared/mask'
import { cornersAspect } from '@shared/proportionalResize'
import { useSceneStore } from '../state/sceneStore'
import { useMediaStore } from '../state/mediaStore'
import { endMaskPaint, startMaskPaint, useMaskPaint } from '../state/maskPaint'
import { imageToMaskPng } from '../masks/maskImage'

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

interface SurfaceMaskControlsProps {
  surface: Surface
}

/**
 * Drawer section for a surface's mask: paint it on the stage, upload one,
 * or cut it from the surface's own picture's transparency; then invert,
 * grow and feather it. The how-to sits behind the info icon.
 */
export default function SurfaceMaskControls({ surface }: SurfaceMaskControlsProps) {
  const setSurfaceMask = useSceneStore((s) => s.setSurfaceMask)
  const updateSurfaceMask = useSceneStore((s) => s.updateSurfaceMask)
  const painting = useMaskPaint((s) => s.surfaceId === surface.id)
  const asset = useMediaStore((s) => s.assets.find((a) => a.id === surface.assetId))
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const baseId = useId()
  const helpId = `${baseId}-help`
  const growId = `${baseId}-grow`
  const featherId = `${baseId}-feather`
  const mask = surface.mask

  const applyImage = async (blob: Blob): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (blob.size > MAX_UPLOAD_BYTES) throw new Error('That image is over 50 MB.')
      const id = await window.mirrorcat.masks.save(await imageToMaskPng(blob))
      const params = surface.mask ?? DEFAULT_MASK_PARAMS
      setSurfaceMask(surface.id, {
        id,
        invert: params.invert,
        grow: params.grow,
        feather: params.feather
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t use that image as a mask.')
    } finally {
      setBusy(false)
    }
  }

  const handleFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void applyImage(file)
  }

  const fromSurfaceImage = async (): Promise<void> => {
    if (!asset) return
    try {
      const response = await fetch(mediaUrl(asset.id))
      await applyImage(await response.blob())
    } catch {
      setError('Couldn’t read this surface’s image.')
    }
  }

  const togglePaint = (): void => {
    if (painting) {
      void endMaskPaint()
      return
    }
    // Shape a fresh canvas like the surface looks on the stage.
    const stage = document.querySelector<HTMLElement>('.editor-stage')
    const aspect = stage
      ? cornersAspect(surface.corners, stage.clientWidth, stage.clientHeight)
      : 16 / 9
    setError(null)
    startMaskPaint(surface, aspect).catch(() => setError('Couldn’t open the mask for painting.'))
  }

  const growPct = Math.round((mask?.grow ?? 0) * 1000) / 10
  const featherPct = Math.round((mask?.feather ?? 0) * 1000) / 10
  const growFill = ((growPct / 100 + MAX_MASK_GROW) / (2 * MAX_MASK_GROW)) * 100
  const featherFill = (featherPct / 100 / MAX_MASK_FEATHER) * 100

  return (
    <div className="mask-controls">
      <div className="drawer-row">
        <span className="drawer-label label-with-info">
          Mask
          <button
            type="button"
            className="info-button"
            onClick={() => setShowHelp((v) => !v)}
            aria-expanded={showHelp}
            aria-controls={helpId}
            aria-label="About masks"
            title="About masks"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <circle cx="8" cy="5" r="0.9" fill="currentColor" />
              <path d="M8 7.3v4.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </span>
        {mask && (
          <img
            className={`mask-thumb${mask.invert ? ' inverted' : ''}`}
            src={maskUrl(mask.id)}
            alt="Current mask"
            draggable={false}
          />
        )}
      </div>

      <div className="mask-actions">
        <button
          type="button"
          className={`btn btn-ghost${painting ? ' active' : ''}`}
          aria-pressed={painting}
          onClick={togglePaint}
          disabled={busy || !surface.visible}
          title={surface.visible ? 'Paint the mask on the stage' : 'Show the surface to paint it'}
        >
          {painting ? 'Done painting' : 'Paint'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => fileInput.current?.click()}
          disabled={busy || painting}
        >
          {mask ? 'Replace…' : 'Upload…'}
        </button>
        {asset?.kind === 'image' && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void fromSurfaceImage()}
            disabled={busy || painting}
            title="Light only the non-transparent parts of this surface’s image"
          >
            From image
          </button>
        )}
        {mask && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setSurfaceMask(surface.id, null)}
            disabled={busy || painting}
            aria-label="Remove mask"
          >
            Remove
          </button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={handleFile}
          aria-label="Mask image file"
        />
      </div>

      <div id={helpId} className="drawer-help" hidden={!showHelp}>
        A mask keeps light off the parts of a surface you don’t want lit, like everything around an
        object. Paint it right on the stage while you watch the wall, or upload an image: white (or,
        in a PNG with transparency, the solid parts) is lit. It moves with the surface when you
        adjust the corners. Grow pushes the edge out to cover an object’s rim; feather softens it.
      </div>

      {mask && (
        <>
          <div className="drawer-row">
            <span className="drawer-label">Invert</span>
            <div className="segmented" role="radiogroup" aria-label="Invert mask">
              <button
                type="button"
                role="radio"
                aria-checked={!mask.invert}
                onClick={() => updateSurfaceMask(surface.id, { invert: false })}
              >
                Off
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mask.invert}
                onClick={() => updateSurfaceMask(surface.id, { invert: true })}
              >
                On
              </button>
            </div>
          </div>

          <div className="drawer-field">
            <div className="drawer-row">
              <label className="drawer-label" htmlFor={growId}>
                Grow
              </label>
              <span className="drawer-value num">
                {growPct > 0 ? '+' : ''}
                {growPct.toFixed(1)}%
              </span>
            </div>
            <input
              id={growId}
              className="slider"
              type="range"
              min={-MAX_MASK_GROW * 100}
              max={MAX_MASK_GROW * 100}
              step={0.1}
              value={growPct}
              style={{ '--fill': `${growFill}%` } as CSSProperties}
              onChange={(e) =>
                updateSurfaceMask(surface.id, { grow: Number(e.target.value) / 100 })
              }
              onDoubleClick={() => updateSurfaceMask(surface.id, { grow: 0 })}
            />
          </div>

          <div className="drawer-field">
            <div className="drawer-row">
              <label className="drawer-label" htmlFor={featherId}>
                Feather
              </label>
              <span className="drawer-value num">{featherPct.toFixed(1)}%</span>
            </div>
            <input
              id={featherId}
              className="slider"
              type="range"
              min={0}
              max={MAX_MASK_FEATHER * 100}
              step={0.1}
              value={featherPct}
              style={{ '--fill': `${featherFill}%` } as CSSProperties}
              onChange={(e) =>
                updateSurfaceMask(surface.id, { feather: Number(e.target.value) / 100 })
              }
            />
          </div>
        </>
      )}

      {busy && (
        <div className="drawer-help" role="status">
          Making the mask…
        </div>
      )}
      {error && (
        <div className="drawer-help mask-error" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}
