import { useEffect, useMemo, useState } from 'react'
import Sidebar from './components/Sidebar'
import ProjectionCanvas from './components/ProjectionCanvas'
import CatEyes from './components/CatEyes'
import { useSceneStore } from './state/sceneStore'
import type { SceneState } from '@shared/types'

export default function App() {
  const surfaces = useSceneStore((s) => s.surfaces)
  const content = useSceneStore((s) => s.content)
  const updateCorners = useSceneStore((s) => s.updateCorners)
  const outputDisplayId = useSceneStore((s) => s.outputDisplayId)
  const [selectedSurfaceId, setSelectedSurfaceId] = useState<string | null>(null)

  // Fall back to the first surface without a render -> effect -> setState
  // -> render round trip: derive it during render instead of syncing state.
  // Also falls back when the previously-selected surface no longer exists
  // (e.g. it was just deleted), instead of only when nothing was selected.
  const effectiveSurfaceId = surfaces.some((s) => s.id === selectedSurfaceId)
    ? selectedSurfaceId
    : (surfaces[0]?.id ?? null)

  // Mirror every scene change to the main process so the output window
  // (if one is open, on the projector-connected display) stays in sync.
  // Batched to one send per animation frame so dragging a corner handle
  // doesn't re-serialize every surface's base64 image on every pointermove.
  useEffect(() => {
    let frameId: number | null = null
    let pending: SceneState | null = null

    const flush = (): void => {
      frameId = null
      if (pending) {
        window.mirrorcat.sendSceneUpdate(pending)
        pending = null
      }
    }

    const unsubscribe = useSceneStore.subscribe((state) => {
      pending = {
        surfaces: state.surfaces,
        content: state.content,
        outputDisplayId: state.outputDisplayId
      }
      if (frameId === null) frameId = requestAnimationFrame(flush)
    })

    return () => {
      unsubscribe()
      if (frameId !== null) cancelAnimationFrame(frameId)
    }
  }, [])

  const selectedSurface = useMemo(
    () => surfaces.find((s) => s.id === effectiveSurfaceId) ?? null,
    [surfaces, effectiveSurfaceId]
  )

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="wordmark">
          <CatEyes size={16} />
          MIRROR CAT
        </div>
        <div className="topbar-spacer" />
        <div className={`status-pill ${outputDisplayId !== null ? 'live' : 'idle'}`}>
          <span className="dot" />
          {outputDisplayId !== null ? 'LIVE OUTPUT' : 'STANDBY'}
        </div>
      </header>

      <div className="body">
        <Sidebar selectedSurfaceId={effectiveSurfaceId} onSelectSurface={setSelectedSurfaceId} />
        <main className="stage">
          {selectedSurface ? (
            <ProjectionCanvas
              surface={selectedSurface}
              textureDataUrl={
                selectedSurface.contentId ? content[selectedSurface.contentId]?.dataUrl : undefined
              }
              editable
              onCornersChange={(corners) => updateCorners(selectedSurface.id, corners)}
            />
          ) : (
            <p className="empty-state">Add a surface to get started.</p>
          )}
        </main>
      </div>
    </div>
  )
}
