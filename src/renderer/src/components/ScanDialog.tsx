import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { CaptureEvent, CaptureSession, FrameDetection } from '@shared/capture'
import { CAPTURE_SESSION_MS } from '@shared/capture'
import { mediaUrl, type MediaAsset } from '@shared/media'
import type { CornerSet, Surface } from '@shared/types'
import { photoSurfaceCorners } from '@shared/scanPattern'
import { useSceneStore } from '../state/sceneStore'
import FrameCornersEditor from './FrameCornersEditor'

interface ScanDialogProps {
  /** Where "Put on …" sends the photo; null when no surface is selected. */
  surface: Surface | null
  /** Whether the projector is on. Only then can the scan pattern be shown. */
  live: boolean
  /** A new surface showing the photo on the wall was made; select it. */
  onProjected: (surfaceId: string) => void
  onClose: () => void
}

type Detect =
  | { state: 'off' }
  | { state: 'finding' }
  | { state: 'done'; result: FrameDetection; corners: CornerSet }

type Phase =
  | { kind: 'starting' }
  | { kind: 'error'; message: string }
  | { kind: 'waiting'; session: CaptureSession; phone: 'none' | 'connected' | 'sending' }
  | { kind: 'photo'; session: CaptureSession; asset: MediaAsset; detect: Detect }
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
 * it), and "Project onto the wall" makes a surface that shows the photo
 * exactly where it came from. The link and the pattern close with the
 * dialog.
 */
export default function ScanDialog({ surface, live, onProjected, onClose }: ScanDialogProps) {
  const store = useSceneStore
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

  const projectOntoWall = (asset: MediaAsset, frameInPhoto: CornerSet): void => {
    const corners = photoSurfaceCorners(frameInPhoto)
    if (!corners) {
      setNotice('Those corners don’t make a frame shape. Move them onto the frame’s corners and try again.')
      return
    }
    const scene = store.getState()
    const id = scene.addSurface('Scan')
    scene.setSurfaceAsset(id, asset.id)
    scene.updateCorners(id, corners)
    scene.updateSurfaceSettings(id, { fit: 'stretch', warp: 'perspective' })
    onProjected(id)
    onClose()
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
                  onClick={() => projectOntoWall(phase.asset, detect.corners)}
                  title="Make a surface that shows the photo exactly where it was taken"
                >
                  Project onto the wall
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
              <li>{live ? 'Check the frame MirrorCat finds, then project it.' : 'It shows up here, and in your library.'}</li>
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
