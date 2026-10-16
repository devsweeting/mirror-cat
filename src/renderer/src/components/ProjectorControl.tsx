import { useState } from 'react'
import type { DisplayInfo } from '@shared/types'
import { useSceneStore } from '../state/sceneStore'

interface ProjectorControlProps {
  displays: DisplayInfo[]
  selectedDisplayId: number | null
  onSelectDisplay: (id: number) => void
}

/**
 * The app's most consequential action -- putting light on the wall -- so it
 * lives in the top bar as one control: which display, and go live / stop.
 * "Live" is derived from the scene's outputDisplayId, which is only set
 * once the output window has actually opened.
 */
export default function ProjectorControl({
  displays,
  selectedDisplayId,
  onSelectDisplay
}: ProjectorControlProps) {
  const outputDisplayId = useSceneStore((s) => s.outputDisplayId)
  const setOutputDisplayId = useSceneStore((s) => s.setOutputDisplayId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const live = outputDisplayId !== null

  const goLive = async (): Promise<void> => {
    if (selectedDisplayId === null) return
    setBusy(true)
    setError(null)
    try {
      await window.mirrorcat.openOutputWindow(selectedDisplayId)
      setOutputDisplayId(selectedDisplayId)
    } catch (err) {
      setError(
        err instanceof Error
          ? `Couldn't open the projector window: ${err.message}`
          : "Couldn't open the projector window."
      )
    } finally {
      setBusy(false)
    }
  }

  const stop = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.mirrorcat.closeOutputWindow()
    } finally {
      setOutputDisplayId(null)
      setBusy(false)
    }
  }

  return (
    <div className={`projector-control${live ? ' live' : ''}`}>
      <label className="projector-select">
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <rect
            x="1.5"
            y="4.5"
            width="13"
            height="7"
            rx="1.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <circle cx="10.5" cy="8" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M4 11.5v1.5M12 11.5v1.5"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
        <span className="visually-hidden">Projector display</span>
        <select
          value={selectedDisplayId ?? ''}
          onChange={(e) => onSelectDisplay(Number(e.target.value))}
          disabled={live || busy || displays.length === 0}
          title={
            live ? 'Stop projecting to change the display' : 'Display connected to your projector'
          }
        >
          {displays.length === 0 && <option value="">No displays found</option>}
          {displays.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
              {d.isPrimary ? ' (this screen)' : ''}
            </option>
          ))}
        </select>
        <span className="select-caret" aria-hidden="true" />
      </label>

      {live ? (
        <button
          type="button"
          className="btn projector-stop"
          onClick={() => void stop()}
          disabled={busy}
        >
          <span className="live-dot" aria-hidden="true" />
          Stop projecting
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-light"
          onClick={() => void goLive()}
          disabled={busy || selectedDisplayId === null}
        >
          Go live
        </button>
      )}

      {error && (
        <p className="projector-error error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
