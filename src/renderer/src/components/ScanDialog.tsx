import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { CaptureEvent, CaptureSession } from '@shared/capture'
import { CAPTURE_SESSION_MS } from '@shared/capture'
import { mediaUrl, type MediaAsset } from '@shared/media'
import type { Surface } from '@shared/types'
import { useSceneStore } from '../state/sceneStore'

interface ScanDialogProps {
  /** Where "Put on …" sends the photo; null when no surface is selected. */
  surface: Surface | null
  onClose: () => void
}

type Phase =
  | { kind: 'starting' }
  | { kind: 'error'; message: string }
  | { kind: 'waiting'; session: CaptureSession; phone: 'none' | 'connected' | 'sending' }
  | { kind: 'photo'; session: CaptureSession; asset: MediaAsset }
  | { kind: 'expired' }

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * Scan: take a photo with your phone and bring it into MirrorCat. Shows a
 * QR code for a short-lived link on the home network (see
 * main/capture/captureServer.ts); the photo lands in the library and can go
 * straight onto the selected surface. The link closes with the dialog.
 */
export default function ScanDialog({ surface, onClose }: ScanDialogProps) {
  const setSurfaceAsset = useSceneStore((s) => s.setSurfaceAsset)
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' })
  const [notice, setNotice] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

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

  // Open a link when the dialog opens; always close it when it closes.
  useEffect(() => {
    // Deferred a tick so StrictMode's mount/unmount/mount doesn't open two links.
    const timer = setTimeout(() => void start(), 0)
    return () => {
      clearTimeout(timer)
      void window.mirrorcat.capture.stop()
    }
  }, [start])

  useEffect(
    () =>
      window.mirrorcat.capture.onEvent((event: CaptureEvent) => {
        if (event.type === 'rejected') setNotice(event.message)
        if (event.type === 'photo' || event.type === 'uploading') setNotice(null)
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
              return { kind: 'photo', session, asset: event.asset }
            case 'rejected':
              return { kind: 'waiting', session, phone: 'connected' }
          }
          return current
        })
      }),
    []
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
    setSurfaceAsset(surface.id, asset.id)
    onClose()
  }

  const minutes = Math.round(CAPTURE_SESSION_MS / 60000)

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
          <h1 id="scan-title">{phase.kind === 'photo' ? 'Photo received' : 'Scan with your phone'}</h1>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close scan">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {phase.kind === 'photo' ? (
          <div className="scan-body scan-photo">
            <img className="scan-photo-image" src={mediaUrl(phase.asset.id)} alt="The photo from your phone" />
            <p className="scan-note">Saved to your library as “{phase.asset.name}”.</p>
            <div className="scan-actions">
              {surface && (
                <button type="button" className="btn" onClick={() => putOnSurface(phase.asset)}>
                  Put on {surface.name}
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setPhase({ kind: 'waiting', session: phase.session, phone: 'connected' })}
              >
                Take another
              </button>
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
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
                <li>Stand beside the projector and take the photo.</li>
                <li>It shows up here, and in your library.</li>
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
                  Your phone needs to be on the same Wi-Fi. The link works for {minutes} minutes:{' '}
                  <span className="scan-url" title={`On ${phase.session.interfaceName}`}>
                    {phase.session.url.replace(/^http:\/\//, '')}
                  </span>
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
