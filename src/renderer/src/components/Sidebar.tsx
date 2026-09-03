import { useEffect, useState } from 'react'
import type { DisplayInfo } from '@shared/types'
import { useSceneStore } from '../state/sceneStore'
import PromptPanel from './PromptPanel'
import CatEyes from './CatEyes'

interface SidebarProps {
  selectedSurfaceId: string | null
  onSelectSurface: (id: string) => void
}

export default function Sidebar({ selectedSurfaceId, onSelectSurface }: SidebarProps) {
  const surfaces = useSceneStore((s) => s.surfaces)
  const addSurface = useSceneStore((s) => s.addSurface)
  const removeSurface = useSceneStore((s) => s.removeSurface)
  const outputDisplayId = useSceneStore((s) => s.outputDisplayId)
  const setOutputDisplayId = useSceneStore((s) => s.setOutputDisplayId)

  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [selectedDisplayId, setSelectedDisplayId] = useState<number | null>(null)
  const [isProjecting, setIsProjecting] = useState(false)
  const [projectError, setProjectError] = useState<string | null>(null)

  useEffect(() => {
    window.mirrorcat.getDisplays().then((list) => {
      setDisplays(list)
      // Default to a non-primary display when one exists -- that's almost
      // always the projector, while the primary is the laptop screen.
      const preferred = list.find((d) => !d.isPrimary) ?? list[0]
      setSelectedDisplayId(preferred?.id ?? null)
    })
  }, [])

  const startProjecting = async (): Promise<void> => {
    if (selectedDisplayId === null) return
    setProjectError(null)
    try {
      await window.mirrorcat.openOutputWindow(selectedDisplayId)
      setOutputDisplayId(selectedDisplayId)
      setIsProjecting(true)
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : 'Failed to start projecting.')
    }
  }

  const stopProjecting = async (): Promise<void> => {
    await window.mirrorcat.closeOutputWindow()
    setOutputDisplayId(null)
    setIsProjecting(false)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <p className="sidebar-label">OUTPUT DISPLAY</p>
        <select
          value={selectedDisplayId ?? ''}
          onChange={(e) => setSelectedDisplayId(Number(e.target.value))}
          disabled={isProjecting || displays.length === 0}
        >
          {displays.length === 0 && <option>No displays found</option>}
          {displays.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
        {isProjecting ? (
          <button onClick={stopProjecting}>Stop projecting</button>
        ) : (
          <button onClick={startProjecting} disabled={selectedDisplayId === null}>
            Send to projector
          </button>
        )}
        {outputDisplayId !== null && <p className="hint">Live on display {outputDisplayId}</p>}
        {projectError && <p className="error">{projectError}</p>}
      </div>

      <div className="sidebar-section">
        <p className="sidebar-label">SURFACES</p>
        <ul className="surface-list">
          {surfaces.map((surface) => (
            <li key={surface.id} className={surface.id === selectedSurfaceId ? 'active' : ''}>
              <button onClick={() => onSelectSurface(surface.id)}>{surface.name}</button>
              <button
                className="icon-button"
                onClick={() => removeSurface(surface.id)}
                aria-label={`Remove ${surface.name}`}
              >
                x
              </button>
            </li>
          ))}
        </ul>
        <button onClick={() => addSurface(`Surface ${surfaces.length + 1}`)}>+ Add surface</button>
      </div>

      <div className="sidebar-section grow">
        <div className="cat-header">
          <CatEyes />
          <div>
            <div className="cat-name">Cat</div>
            <div className="cat-tag">assistant</div>
          </div>
        </div>
        <PromptPanel surfaceId={selectedSurfaceId} />
      </div>
    </aside>
  )
}
