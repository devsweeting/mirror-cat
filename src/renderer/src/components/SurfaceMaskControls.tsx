import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent
} from 'react'
import type { Surface } from '@shared/types'
import { mediaUrl } from '@shared/media'
import { DEFAULT_MASK_PARAMS, MAX_MASK_FEATHER, MAX_MASK_GROW, maskUrl } from '@shared/mask'
import { useSceneStore } from '../state/sceneStore'
import { useMediaStore } from '../state/mediaStore'
import { toggleMaskMode, useMaskPaint } from '../state/maskPaint'
import { imageHasTransparency, imageToMaskPng, saveMaskPng } from '../masks/maskImage'

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

/** Cut-out suggestions dismissed this session, by asset id. */
const dismissedCutouts = new Set<string>()

interface SurfaceMaskControlsProps {
  surface: Surface
}

/**
 * The drawer's mask section, kept to one well and one slider:
 *
 * - The well shows the mask (or the invitation to make one). Click it to
 *   edit on the stage (same as M), or drop an image on it.
 * - Edge softens the outline -- the setting you actually reach for.
 * - Everything rarer (invert, grow, replace, remove) lives behind "…".
 *
 * When the surface's picture has a transparent background, it offers to
 * light only the opaque part.
 */
export default function SurfaceMaskControls({ surface }: SurfaceMaskControlsProps) {
  const setSurfaceMask = useSceneStore((s) => s.setSurfaceMask)
  const updateSurfaceMask = useSceneStore((s) => s.updateSurfaceMask)
  const editing = useMaskPaint((s) => s.surfaceId === surface.id)
  const asset = useMediaStore((s) => s.assets.find((a) => a.id === surface.assetId))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dropOver, setDropOver] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  /** Which image the transparency answer is for, so a stale one never shows. */
  const [cutout, setCutout] = useState<{ id: string; yes: boolean } | null>(null)
  const [, setDismissTick] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const optionsRef = useRef<HTMLDivElement>(null)
  const optionsButtonRef = useRef<HTMLButtonElement>(null)
  const baseId = useId()
  const helpId = `${baseId}-help`
  const optionsId = `${baseId}-options`
  const featherId = `${baseId}-feather`
  const growId = `${baseId}-grow`
  const mask = surface.mask

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

  // Close the options on any click outside them.
  useEffect(() => {
    if (!optionsOpen) return
    const onDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOptionsOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [optionsOpen])

  useEffect(() => {
    if (optionsOpen) optionsRef.current?.querySelector<HTMLElement>('button, input')?.focus()
  }, [optionsOpen])

  const closeOptions = (): void => {
    setOptionsOpen(false)
    optionsButtonRef.current?.focus()
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
    setOptionsOpen(false)
    try {
      const picked = await window.mirrorcat.masks.pickImage()
      if (picked) await applyImage(new Blob([picked.bytes as BlobPart]))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t open that image.')
    }
  }

  const applyCutout = async (): Promise<void> => {
    setOptionsOpen(false)
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

  const handleOptionsKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      closeOptions()
    }
  }

  const showSuggestion =
    !mask && !editing && hasCutout && imageId !== null && !dismissedCutouts.has(imageId)
  const featherPct = Math.round((mask?.feather ?? 0) * 1000) / 10
  const growPct = Math.round((mask?.grow ?? 0) * 1000) / 10
  const featherFill = (featherPct / 100 / MAX_MASK_FEATHER) * 100
  const growFill = ((growPct / 100 + MAX_MASK_GROW) / (2 * MAX_MASK_GROW)) * 100

  return (
    <div className="mask-controls" ref={rootRef}>
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
        <button
          ref={optionsButtonRef}
          type="button"
          className="icon-btn"
          onClick={() => setOptionsOpen((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={optionsOpen}
          aria-controls={optionsOpen ? optionsId : undefined}
          aria-label="Mask options"
          title="Mask options"
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
            <circle cx="8" cy="8" r="1.3" fill="currentColor" />
            <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
          </svg>
        </button>
      </div>

      <div id={helpId} className="drawer-help" hidden={!showHelp}>
        A mask keeps light off the parts of a surface you don’t want lit, like everything around an
        object. Outline the object on the stage (or paint it), or drop in an image where white or
        solid areas are lit. It moves with the surface when you adjust the corners. Hidden areas
        show hatched here and stay dark on the projector.
      </div>

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
            {busy
              ? 'Making the mask…'
              : editing
                ? 'Editing on the stage'
                : mask
                  ? 'Edit on the stage'
                  : 'Mask this surface'}
          </span>
          <span className="mask-well-sub">
            {editing
              ? 'Done or Esc to finish'
              : dropOver
                ? 'Drop to use as the mask'
                : 'Outline on the stage or drop an image'}
          </span>
        </span>
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

      {mask && (
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
            onChange={(e) => updateSurfaceMask(surface.id, { feather: Number(e.target.value) / 100 })}
          />
        </div>
      )}

      {optionsOpen && (
        <div
          id={optionsId}
          ref={optionsRef}
          className="content-menu mask-options"
          role="dialog"
          aria-label="Mask options"
          onKeyDown={handleOptionsKeyDown}
        >
          {mask && (
            <>
              <div className="mask-option-row">
                <span>Invert</span>
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
              <div className="mask-option-field">
                <div className="mask-option-row">
                  <label htmlFor={growId}>Grow</label>
                  <span className="num">
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
                  onChange={(e) =>
                    updateSurfaceMask(surface.id, { grow: Number(e.target.value) / 100 })
                  }
                  onDoubleClick={() => updateSurfaceMask(surface.id, { grow: 0 })}
                />
              </div>
              <div className="mask-option-divider" />
            </>
          )}
          <button type="button" onClick={() => void chooseImage()} disabled={busy || editing}>
            {mask ? 'Replace with an image…' : 'Use an image…'}
          </button>
          {hasCutout && (
            <button type="button" onClick={() => void applyCutout()} disabled={busy || editing}>
              Light only the image
            </button>
          )}
          {mask && (
            <button
              type="button"
              className="danger"
              onClick={() => {
                setSurfaceMask(surface.id, null)
                closeOptions()
              }}
              disabled={busy || editing}
            >
              Remove mask
            </button>
          )}
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
