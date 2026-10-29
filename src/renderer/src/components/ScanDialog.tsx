import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { CaptureEvent, CaptureSession, FrameDetection } from '@shared/capture'
import { CAPTURE_SESSION_MS } from '@shared/capture'
import { mediaUrl, type MediaAsset } from '@shared/media'
import type { CornerSet, Surface } from '@shared/types'
import { FULL_FRAME } from '@shared/scanPattern'
import { DEFAULT_MASK_PARAMS } from '@shared/mask'
import { shapeNumber, type DetectedShape } from '@shared/shapes'
import { useSceneStore } from '../state/sceneStore'
import FrameCornersEditor from './FrameCornersEditor'
import ShapePicker, { type ShapeTarget } from './ShapePicker'

interface ScanDialogProps {
  /** Where "Put on …" sends the photo; null when no surface is selected. */
  surface: Surface | null
  /** Whether the projector is on. Only then can the scan pattern be shown. */
  live: boolean
  /** A new surface showing the photo on the wall was made; select it. */
  onProjected: (surfaceId: string) => void
  onClose: () => void
}

type FoundFrame = { state: 'done'; result: FrameDetection; corners: CornerSet }
type Detect = { state: 'off' } | { state: 'finding' } | FoundFrame

type Phase =
  | { kind: 'starting' }
  | { kind: 'error'; message: string }
  | { kind: 'waiting'; session: CaptureSession; phone: 'none' | 'connected' | 'sending' }
  | { kind: 'photo'; session: CaptureSession; asset: MediaAsset; detect: Detect }
  | {
      kind: 'shapes'
      session: CaptureSession
      asset: MediaAsset
      /** The lined-up frame, to go back to. */
      detect: FoundFrame
      /** The photo fitted to the projector: shapes are found in this. */
      fitted: MediaAsset
      /** Null while looking. */
      found: DetectedShape[] | null
      picks: Record<string, ShapeTarget>
    }
  | { kind: 'expired' }

/** Starting corners when the frame wasn't found: a guess to drag from. */
const GUESS: CornerSet = [
  { x: 0.15, y: 0.15 },
  { x: 0.85, y: 0.15 },
  { x: 0.85, y: 0.85 },
  { x: 0.15, y: 0.85 }
]

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * Scan: take a photo with your phone and bring it into MirrorCat.
 *
 * While it waits, the projector (if live) shows the scan pattern -- a
 * glowing frame with a marker in each corner. When the photo arrives, the
 * frame is found in it, outlined for you to check (drag a corner to fix
 * it). Continue fits the photo to the projector and finds the shapes in
 * it: each one you pick becomes a surface, its corners already in place
 * (and an exact mask for shapes that aren't four-sided), ready for your
 * own content. Or project the whole photo exactly where it came from. The
 * link and the pattern close with the dialog.
 */
export default function ScanDialog({ surface, live, onProjected, onClose }: ScanDialogProps) {
  const store = useSceneStore
  const surfaces = useSceneStore((s) => s.surfaces)
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' })
  const [notice, setNotice] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  // Read inside the phone-event listener, which shouldn't re-subscribe on every change.
  const liveRef = useRef(live)
  useEffect(() => {
    liveRef.current = live
  }, [live])

  const start = useCallback(async () => {
    setPhase({ kind: 'starting' })
    setNotice(null)
    const result = await window.mirrorcat.capture.start()
    setPhase(
      result.ok
        ? { kind: 'waiting', session: result.session, phone: 'none' }
        : { kind: 'error', message: result.message }
    )
  }, [])

  // Open a link when the dialog opens; always close it (and the pattern) when it closes.
  useEffect(() => {
    // Deferred a tick so StrictMode's mount/unmount/mount doesn't open two links.
    const timer = setTimeout(() => void start(), 0)
    return () => {
      clearTimeout(timer)
      void window.mirrorcat.capture.setPattern(false)
      void window.mirrorcat.capture.stop()
    }
  }, [start])

  // The pattern shows while we wait for a photo with the projector on.
  const waiting = phase.kind === 'waiting'
  useEffect(() => {
    void window.mirrorcat.capture.setPattern(waiting && live)
  }, [waiting, live])

  const findFrame = useCallback(async (asset: MediaAsset) => {
    const result = await window.mirrorcat.capture.detectFrame(asset.id)
    setPhase((current) =>
      current.kind === 'photo' && current.asset.id === asset.id
        ? { ...current, detect: { state: 'done', result, corners: result.corners ?? GUESS } }
        : current
    )
  }, [])

  useEffect(
    () =>
      window.mirrorcat.capture.onEvent((event: CaptureEvent) => {
        if (event.type === 'rejected') setNotice(event.message)
        if (event.type === 'photo' || event.type === 'uploading') setNotice(null)
        if (event.type === 'photo' && liveRef.current) void findFrame(event.asset)
        setPhase((current) => {
          if (event.type === 'expired') return { kind: 'expired' }
          if (current.kind !== 'waiting' && current.kind !== 'photo') return current
          const session = current.session
          switch (event.type) {
            case 'visited':
              return current.kind === 'waiting' ? { ...current, phone: 'connected' } : current
            case 'uploading':
              return { kind: 'waiting', session, phone: 'sending' }
            case 'photo':
              return {
                kind: 'photo',
                session,
                asset: event.asset,
                detect: liveRef.current ? { state: 'finding' } : { state: 'off' }
              }
            case 'rejected':
              return { kind: 'waiting', session, phone: 'connected' }
          }
          return current
        })
      }),
    [findFrame]
  )

  // Focus moves into the dialog and back on close; Escape closes.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [onClose])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab' || !dialogRef.current) return
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const handleBackdropMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) onClose()
  }

  const putOnSurface = (asset: MediaAsset): void => {
    if (!surface) return
    store.getState().setSurfaceAsset(surface.id, asset.id)
    onClose()
  }

  const [projecting, setProjecting] = useState(false)

  /**
   * Straighten the frame's part of the photo into a projector-sized image
   * (every photo pixel lands on the projector pixel that lit it), then
   * look for shapes in it.
   */
  const continueToShapes = async (
    session: CaptureSession,
    asset: MediaAsset,
    detect: FoundFrame
  ): Promise<void> => {
    setProjecting(true)
    setNotice(null)
    let fitted: MediaAsset
    try {
      fitted = await window.mirrorcat.capture.rectify(asset.id, detect.corners)
    } catch (error) {
      console.error('[scan] could not fit the photo', error)
      setNotice('Those corners don’t make a frame shape. Move them onto the frame’s corners and try again.')
      setProjecting(false)
      return
    }
    setProjecting(false)
    setPhase({ kind: 'shapes', session, asset, detect, fitted, found: null, picks: {} })
    const found = await window.mirrorcat.capture.findShapes(fitted.id).catch(() => [])
    setPhase((current) =>
      current.kind === 'shapes' && current.fitted.id === fitted.id
        ? { ...current, found, picks: Object.fromEntries(found.map((s) => [s.id, 'new'])) }
        : current
    )
  }

  /** A new surface filling the frame, showing the whole fitted photo. */
  const projectWhole = (fitted: MediaAsset): void => {
    const scene = store.getState()
    const id = scene.addSurface('Scan')
    scene.setSurfaceAsset(id, fitted.id)
    scene.updateCorners(id, FULL_FRAME.map((c) => ({ ...c })) as CornerSet)
    scene.updateSurfaceSettings(id, { fit: 'stretch', warp: 'perspective' })
    onProjected(id)
    onClose()
  }

  /**
   * Each picked shape becomes a surface: a new one, or an existing surface
   * moved onto it (keeping its content). Four-sided shapes need only their
   * corners; traced ones also get an exact mask, cut in main from the
   * shape's pixels.
   */
  const makeSurfaces = async (fitted: MediaAsset, found: DetectedShape[], picks: Record<string, ShapeTarget>) => {
    setProjecting(true)
    setNotice(null)
    let first: string | null = null
    try {
      for (const shape of found) {
        const target = picks[shape.id]
        if (!target) continue
        const exists = target !== 'new' && store.getState().surfaces.some((s) => s.id === target)
        const id = exists ? target : store.getState().addSurface(`Shape ${shapeNumber(shape)}`)
        const maskId =
          shape.kind === 'outline'
            ? await window.mirrorcat.capture.shapeMask(fitted.id, shape.id, shape.corners)
            : null
        const scene = store.getState()
        scene.updateCorners(id, shape.corners.map((c) => ({ ...c })) as CornerSet)
        scene.updateEdgeNodes(id, [[], [], [], []])
        scene.updateSurfaceSettings(id, { warp: 'perspective' })
        // An old mask was cut for a different shape, so it never carries over.
        scene.setSurfaceMask(id, maskId ? { id: maskId, ...DEFAULT_MASK_PARAMS } : null)
        first ??= id
      }
    } catch (error) {
      console.error('[scan] could not make surfaces', error)
      setNotice('Some shapes couldn’t be made into surfaces. Check the surfaces list, then try again.')
      setProjecting(false)
      return
    }
    setProjecting(false)
    if (first) onProjected(first)
    onClose()
  }

  const togglePick = (shapeId: string): void => {
    setPhase((current) => {
      if (current.kind !== 'shapes') return current
      const picks = { ...current.picks }
      if (picks[shapeId]) delete picks[shapeId]
      else picks[shapeId] = 'new'
      return { ...current, picks }
    })
  }

  const setTarget = (shapeId: string, target: ShapeTarget): void => {
    setPhase((current) => {
      if (current.kind !== 'shapes') return current
      const picks: Record<string, ShapeTarget> = {}
      // One surface can only sit on one shape: whoever had it goes back to "new".
      for (const [id, t] of Object.entries(current.picks)) picks[id] = target !== 'new' && t === target ? 'new' : t
      picks[shapeId] = target
      return { ...current, picks }
    })
  }

  const pickAll = (all: boolean): void => {
    setPhase((current) =>
      current.kind === 'shapes' && current.found
        ? {
            ...current,
            picks: all ? Object.fromEntries(current.found.map((s) => [s.id, current.picks[s.id] ?? 'new'])) : {}
          }
        : current
    )
  }

  const takeAnother = (session: CaptureSession): void => {
    setNotice(null)
    setPhase({ kind: 'waiting', session, phone: 'connected' })
  }

  const setCorners = (corners: CornerSet): void => {
    setPhase((current) =>
      current.kind === 'photo' && current.detect.state === 'done'
        ? { ...current, detect: { ...current.detect, corners } }
        : current
    )
  }

  const minutes = Math.round(CAPTURE_SESSION_MS / 60000)

  if (phase.kind === 'shapes') {
    const { found, picks, fitted } = phase
    const pickedCount = found ? found.filter((s) => picks[s.id]).length : 0
    const status =
      found === null
        ? 'Looking for shapes…'
        : found.length === 0
          ? 'Didn’t find any flat shapes. You can still project the whole photo, then draw surfaces yourself.'
          : `Found ${found.length} shape${found.length === 1 ? '' : 's'}. Each one you pick becomes a surface with its corners in place, ready for your own content.`

    return (
      <div className="settings-backdrop" onMouseDown={handleBackdropMouseDown}>
        <div
          ref={dialogRef}
          className="scan-dialog scan-dialog-shapes"
          role="dialog"
          aria-modal="true"
          aria-labelledby="scan-title"
          tabIndex={-1}
          onKeyDown={handleKeyDown}
        >
          <header className="settings-header">
            <h1 id="scan-title">Pick the shapes</h1>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close scan">
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </header>
          <div className="scan-body scan-photo">
            {found && found.length > 0 ? (
              <ShapePicker
                imageUrl={mediaUrl(fitted.id)}
                shapes={found}
                picks={picks}
                surfaces={surfaces.map((s) => ({ id: s.id, name: s.name }))}
                onToggle={togglePick}
                onTarget={setTarget}
                onPickAll={pickAll}
              />
            ) : (
              <img
                className={`scan-photo-image${found === null ? ' finding' : ''}`}
                src={mediaUrl(fitted.id)}
                alt="Your scan, fitted to the projector"
              />
            )}

            <p className="scan-status" role="status">
              {status}
            </p>
            {notice && (
              <p className="scan-status error" role="alert">
                {notice}
              </p>
            )}

            <div className="scan-actions">
              {found && found.length > 0 && (
                <button
                  type="button"
                  className="btn"
                  disabled={projecting || pickedCount === 0}
                  onClick={() => void makeSurfaces(fitted, found, picks)}
                >
                  {projecting
                    ? 'Making surfaces…'
                    : pickedCount === 0
                      ? 'Pick a shape'
                      : `Make ${pickedCount} surface${pickedCount === 1 ? '' : 's'}`}
                </button>
              )}
              <button
                type="button"
                className={found && found.length > 0 ? 'btn btn-ghost' : 'btn'}
                disabled={projecting || found === null}
                onClick={() => projectWhole(fitted)}
                title="One surface filling the frame, showing the photo exactly where it was taken"
              >
                Project the whole photo
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={projecting}
                onClick={() =>
                  setPhase({ kind: 'photo', session: phase.session, asset: phase.asset, detect: phase.detect })
                }
              >
                Back
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (phase.kind === 'photo') {
    const detect = phase.detect
    const result = detect.state === 'done' ? detect.result : null
    const unsure = result ? [0, 1, 2, 3].filter((i) => !result.markersFound.includes(i)) : []
    const found = result?.markersFound.length ?? 0
    const status =
      detect.state === 'finding'
        ? 'Finding the projector frame…'
        : !result
          ? null
          : !result.corners
            ? 'Couldn’t find the frame in this photo. Drag the corners onto the glowing frame’s corners, or take another with the whole frame in view.'
            : result.estimated
              ? `Found ${found} of 4 corner markers. Check the highlighted corner${4 - found > 1 ? 's' : ''}.`
              : 'Found the projector frame. Check that the outline sits on its corners.'

    return (
      <div className="settings-backdrop" onMouseDown={handleBackdropMouseDown}>
        <div
          ref={dialogRef}
          className="scan-dialog scan-dialog-wide"
          role="dialog"
          aria-modal="true"
          aria-labelledby="scan-title"
          tabIndex={-1}
          onKeyDown={handleKeyDown}
        >
          <header className="settings-header">
            <h1 id="scan-title">{detect.state === 'off' ? 'Photo received' : 'Line up the photo'}</h1>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close scan">
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </header>
          <div className="scan-body scan-photo">
            {detect.state === 'done' ? (
              <FrameCornersEditor
                imageUrl={mediaUrl(phase.asset.id)}
                corners={detect.corners}
                onChange={setCorners}
                unsure={result?.corners ? unsure : [0, 1, 2, 3]}
              />
            ) : (
              <img
                className={`scan-photo-image${detect.state === 'finding' ? ' finding' : ''}`}
                src={mediaUrl(phase.asset.id)}
                alt="The photo from your phone"
              />
            )}

            {status && (
              <p
                className={`scan-status${result && !result.corners ? ' warn' : ''}`}
                role="status"
              >
                {status}
              </p>
            )}
            {detect.state === 'off' && (
              <p className="scan-note">
                Saved to your library as “{phase.asset.name}”. Go live before scanning and the
                projector shows a frame to line photos up with the wall.
              </p>
            )}
            {notice && (
              <p className="scan-status error" role="alert">
                {notice}
              </p>
            )}

            <div className="scan-actions">
              {detect.state === 'done' && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => void continueToShapes(phase.session, phase.asset, detect)}
                  disabled={projecting}
                  title="Fit the photo to the projector, then pick the shapes to map"
                >
                  {projecting ? 'Fitting to the projector…' : 'Continue'}
                </button>
              )}
              {surface && (
                <button
                  type="button"
                  className={detect.state === 'off' ? 'btn' : 'btn btn-ghost'}
                  onClick={() => putOnSurface(phase.asset)}
                >
                  Put on {surface.name}
                </button>
              )}
              <button type="button" className="btn btn-ghost" onClick={() => takeAnother(phase.session)}>
                Take another
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="settings-backdrop" onMouseDown={handleBackdropMouseDown}>
      <div
        ref={dialogRef}
        className="scan-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <header className="settings-header">
          <h1 id="scan-title">Scan with your phone</h1>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close scan">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="scan-body">
          <div className="scan-code" aria-live="polite">
            {phase.kind === 'waiting' ? (
              <img
                className="scan-qr"
                src={`data:image/svg+xml;utf8,${encodeURIComponent(phase.session.qrSvg)}`}
                alt={`QR code for ${phase.session.url}`}
              />
            ) : (
              <div className="scan-qr-placeholder">
                {phase.kind === 'starting' && <span className="scan-spinner" aria-hidden="true" />}
              </div>
            )}
          </div>

          <div className="scan-side">
            <ol className="scan-steps">
              <li>Point your phone’s camera at the code.</li>
              <li>
                {live
                  ? 'Stand beside the projector and fit the whole glowing frame in the photo.'
                  : 'Stand beside the projector and take the photo.'}
              </li>
              <li>
                {live
                  ? 'Check the frame MirrorCat finds, then pick the shapes to map.'
                  : 'It shows up here, and in your library.'}
              </li>
            </ol>

            <p
              className={`scan-status${phase.kind === 'error' || phase.kind === 'expired' ? ' error' : ''}`}
              role="status"
            >
              {phase.kind === 'waiting' && (
                <span className={`scan-dot${phase.phone === 'none' ? ' waiting' : ''}`} aria-hidden="true" />
              )}
              {phase.kind === 'starting' && 'Opening a link…'}
              {phase.kind === 'waiting' &&
                (phase.phone === 'none'
                  ? 'Waiting for your phone'
                  : phase.phone === 'connected'
                    ? 'Phone connected. Take the photo when you’re ready.'
                    : 'Receiving the photo…')}
              {phase.kind === 'error' && phase.message}
              {phase.kind === 'expired' && 'This link has expired.'}
            </p>
            {notice && phase.kind === 'waiting' && (
              <p className="scan-status error" role="alert">
                {notice}
              </p>
            )}

            {(phase.kind === 'error' || phase.kind === 'expired') && (
              <button type="button" className="btn scan-retry" onClick={() => void start()}>
                {phase.kind === 'expired' ? 'New link' : 'Try again'}
              </button>
            )}

            {phase.kind === 'waiting' && (
              <p className="scan-note">
                {live
                  ? 'The projector is showing the scan frame. '
                  : 'Go live first and the projector shows a frame to line the photo up with. '}
                Your phone needs to be on the same Wi-Fi; the link works for {minutes} minutes:{' '}
                <span className="scan-url" title={`On ${phase.session.interfaceName}`}>
                  {phase.session.url.replace(/^http:\/\//, '')}
                </span>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
