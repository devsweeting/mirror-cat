import { useEffect, useId, useState, type CSSProperties, type DragEvent } from 'react'
import type { Surface } from '@shared/types'
import { mediaUrl } from '@shared/media'
import { DEFAULT_MASK_PARAMS, MAX_MASK_FEATHER, MAX_MASK_GROW, maskUrl } from '@shared/mask'
import { useSceneStore } from '../state/sceneStore'
import { useMediaStore } from '../state/mediaStore'
import { toggleMaskMode, useMaskPaint } from '../state/maskPaint'
import { imageHasTransparency, imageToMaskPng, saveMaskPng } from '../masks/maskImage'
import ToggleSwitch from './ToggleSwitch'

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const MASK_OPEN_KEY = 'mirrorcat.maskOpen'

/** Cut-out suggestions dismissed this session, by asset id. */
const dismissedCutouts = new Set<string>()

function readOpen(): boolean {
  try {
    return localStorage.getItem(MASK_OPEN_KEY) === '1'
  } catch {
    return false
  }
}

function writeOpen(open: boolean): void {
  try {
    localStorage.setItem(MASK_OPEN_KEY, open ? '1' : '0')
  } catch {
    // Remembering the section is a convenience; ignore storage failures.
  }
}

interface SurfaceMaskControlsProps {
  surface: Surface
}

/**
 * The drawer's mask settings, folded into one dropdown whose header says
 * the current state ("None", "On, soft 1%"). Inside: the mask well (click
 * to edit on the stage, same as M; drop an image on it), Edge, Invert,
 * Grow, and the image / remove actions. It opens by itself while the mask
 * is being edited. A cut-out suggestion or an error shows even when it's
 * closed, since both ask for attention.
 */
export default function SurfaceMaskControls({ surface }: SurfaceMaskControlsProps) {
  const setSurfaceMask = useSceneStore((s) => s.setSurfaceMask)
  const updateSurfaceMask = useSceneStore((s) => s.updateSurfaceMask)
  const editing = useMaskPaint((s) => s.surfaceId === surface.id)
  const asset = useMediaStore((s) => s.assets.find((a) => a.id === surface.assetId))
  const [open, setOpen] = useState(readOpen)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dropOver, setDropOver] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  /** Which image the transparency answer is for, so a stale one never shows. */
  const [cutout, setCutout] = useState<{ id: string; yes: boolean } | null>(null)
  const [, setDismissTick] = useState(0)
  const baseId = useId()
  const bodyId = `${baseId}-body`
  const helpId = `${baseId}-help`
  const featherId = `${baseId}-feather`
  const growId = `${baseId}-grow`
  const mask = surface.mask
  const expanded = open || editing

  // Does the surface's picture have a transparent background?
  const imageId = asset?.kind === 'image' ? asset.id : null
  const imageMime = asset?.mimeType ?? ''
  useEffect(() => {
    if (!imageId) return
    let cancelled = false
    void imageHasTransparency(imageId, imageMime).then((yes) => {
      if (!cancelled) setCutout({ id: imageId, yes })
    })
    return () => {
      cancelled = true
    }
  }, [imageId, imageMime])
  const hasCutout = !!imageId && cutout?.id === imageId && cutout.yes

  const toggleOpen = (): void => {
    writeOpen(!expanded)
    setOpen(!expanded)
  }

  const applyImage = async (blob: Blob): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (blob.size > MAX_UPLOAD_BYTES) throw new Error('That image is over 50 MB.')
      const id = await saveMaskPng(await imageToMaskPng(blob))
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

  const chooseImage = async (): Promise<void> => {
    try {
      const picked = await window.mirrorcat.masks.pickImage()
      if (picked) await applyImage(new Blob([picked.bytes as BlobPart]))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t open that image.')
    }
  }

  const applyCutout = async (): Promise<void> => {
    if (!imageId) return
    try {
      const response = await fetch(mediaUrl(imageId))
      await applyImage(await response.blob())
    } catch {
      setError('Couldn’t read this surface’s image.')
    }
  }

  const dismissCutout = (): void => {
    if (imageId) dismissedCutouts.add(imageId)
    setDismissTick((n) => n + 1)
  }

  const handleDragOver = (event: DragEvent<HTMLButtonElement>): void => {
    if (![...event.dataTransfer.items].some((i) => i.kind === 'file')) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
    setDropOver(true)
  }

  const handleDrop = (event: DragEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    // Keep the stage's own drop handler (library import) out of it.
    event.stopPropagation()
    setDropOver(false)
    const file = [...event.dataTransfer.files].find((f) => f.type.startsWith('image/'))
    if (file) void applyImage(file)
    else setError('Drop a PNG, JPEG or WebP image.')
  }

  const featherPct = Math.round((mask?.feather ?? 0) * 1000) / 10
  const growPct = Math.round((mask?.grow ?? 0) * 1000) / 10
  const featherFill = (featherPct / 100 / MAX_MASK_FEATHER) * 100
  const growFill = ((growPct / 100 + MAX_MASK_GROW) / (2 * MAX_MASK_GROW)) * 100
  const showSuggestion =
    !mask && !editing && hasCutout && imageId !== null && !dismissedCutouts.has(imageId)

  const summary = busy
    ? 'Making the mask…'
    : editing
      ? 'Editing on the stage'
      : !mask
        ? 'None'
        : ['On', mask.invert && 'inverted', featherPct > 0 && `soft ${featherPct.toFixed(1)}%`]
            .filter(Boolean)
            .join(', ')

  return (
    <div className="drawer-section mask-controls">
      <button
        type="button"
        className="drawer-disclosure"
        onClick={toggleOpen}
        aria-expanded={expanded}
        aria-controls={bodyId}
      >
        <span className="drawer-label">Mask</span>
        <span className="drawer-disclosure-summary">{summary}</span>
        <svg
          className="drawer-disclosure-chevron"
          viewBox="0 0 12 12"
          width="10"
          height="10"
          aria-hidden="true"
        >
          <path
            d="M2.5 4.5 6 8l3.5-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {showSuggestion && (
        <div className="mask-suggestion" role="note">
          <span>This image has a transparent background.</span>
          <div className="mask-suggestion-actions">
            <button type="button" className="btn" onClick={() => void applyCutout()}>
              Light only the image
            </button>
            <button type="button" className="btn btn-ghost" onClick={dismissCutout}>
              Not now
            </button>
          </div>
        </div>
      )}

      <div id={bodyId} className="drawer-section-body" hidden={!expanded}>
        <button
          type="button"
          className={`mask-well${editing ? ' editing' : ''}${dropOver ? ' drop-over' : ''}${mask ? ' has-mask' : ''}`}
          onClick={() => toggleMaskMode(surface)}
          onDragOver={handleDragOver}
          onDragLeave={() => setDropOver(false)}
          onDrop={handleDrop}
          disabled={busy || (!surface.visible && !editing)}
          aria-pressed={editing}
          aria-label={editing ? 'Finish editing the mask' : 'Edit the mask on the stage'}
          title={surface.visible ? 'Edit on the stage (M)' : 'Show the surface to edit its mask'}
        >
          <span className="mask-well-thumb" aria-hidden="true">
            {mask ? (
              <img
                src={maskUrl(mask.id)}
                alt=""
                draggable={false}
                className={mask.invert ? 'inverted' : undefined}
              />
            ) : (
              <svg viewBox="0 0 40 26" width="40" height="26">
                <path
                  d="M9 5 31 7 29 21 8 19Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeDasharray="2.5 2"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </span>
          <span className="mask-well-text">
            <span className="mask-well-title">
              {editing ? 'Editing on the stage' : mask ? 'Edit on the stage' : 'Mask this surface'}
            </span>
            <span className="mask-well-sub">
              {editing
                ? 'Done or Esc to finish'
                : dropOver
                  ? 'Drop to use as the mask'
                  : 'Or drop an image here'}
            </span>
          </span>
        </button>

        {mask && (
          <>
            <div className="drawer-field">
              <div className="drawer-row">
                <label className="drawer-label" htmlFor={featherId}>
                  Edge
                </label>
                <span className="drawer-value num">
                  {featherPct === 0 ? 'Crisp' : `Soft ${featherPct.toFixed(1)}%`}
                </span>
              </div>
              <input
                id={featherId}
                className="slider"
                type="range"
                min={0}
                max={MAX_MASK_FEATHER * 100}
                step={0.1}
                value={featherPct}
                aria-label="Edge softness"
                style={{ '--fill': `${featherFill}%` } as CSSProperties}
                onChange={(e) =>
                  updateSurfaceMask(surface.id, { feather: Number(e.target.value) / 100 })
                }
              />
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
                title="Push the edge out to cover an object’s rim, or pull it in. Double-click to reset."
                style={{ '--fill': `${growFill}%` } as CSSProperties}
                onChange={(e) => updateSurfaceMask(surface.id, { grow: Number(e.target.value) / 100 })}
                onDoubleClick={() => updateSurfaceMask(surface.id, { grow: 0 })}
              />
            </div>

            <div className="drawer-row">
              <span className="drawer-label">Invert</span>
              <ToggleSwitch
                checked={mask.invert}
                onChange={(invert) => updateSurfaceMask(surface.id, { invert })}
                label="Invert mask"
                title="Swap what’s lit and what’s dark"
              />
            </div>
          </>
        )}

        <div className="mask-actions">
          {hasCutout && (
            <button
              type="button"
              className="link-btn"
              onClick={() => void applyCutout()}
              disabled={busy || editing}
            >
              Light only the image
            </button>
          )}
          <span className="mask-actions-icons">
            <button
              type="button"
              className="icon-btn"
              onClick={() => void chooseImage()}
              disabled={busy || editing}
              aria-label={mask ? 'Replace with an image' : 'Use an image'}
              title={mask ? 'Replace with an image…' : 'Use an image…'}
            >
              {/* A picture with a swap arrow: use an image as the mask. */}
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <rect
                  x="1.8"
                  y="2.8"
                  width="9.4"
                  height="8"
                  rx="1.4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
                <path
                  d="m2.6 9.6 2.6-2.6 2 2 1.2-1.2 2 2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
                <path
                  d="M13.8 7.2v4.6a2 2 0 0 1-2 2H7.4m1.6-1.6-1.6 1.6 1.6 1.6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {mask && (
              <button
                type="button"
                className="icon-btn icon-btn-danger"
                onClick={() => setSurfaceMask(surface.id, null)}
                disabled={busy || editing}
                aria-label="Remove mask"
                title="Remove mask"
              >
                <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                  <path
                    d="M2.5 4.2h11M6.2 4.2V2.6h3.6v1.6M3.9 4.2l.7 9.2h6.8l.7-9.2M6.6 6.6v4.5M9.4 6.6v4.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
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
        </div>

        <div id={helpId} className="drawer-help" hidden={!showHelp}>
          A mask keeps light off the parts of a surface you don’t want lit, like everything around
          an object. Outline the object on the stage (or paint it), or use an image where white or
          solid areas are lit. It moves with the surface when you adjust the corners. Hidden areas
          show hatched here and stay dark on the projector.
        </div>
      </div>

      {error && (
        <div className="drawer-help mask-error" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}
