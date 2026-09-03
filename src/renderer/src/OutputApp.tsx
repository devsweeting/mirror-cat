import { useEffect, useRef, useState } from 'react'
import ProjectionCanvas from './components/ProjectionCanvas'
import type { SceneState } from '@shared/types'

const EMPTY_SCENE: SceneState = { surfaces: [], content: {}, outputDisplayId: null }

/**
 * Runs in the fullscreen, borderless window pointed at the projector.
 * Pure display: it has no editing UI, and just renders every surface at
 * whatever corner-pin calibration the control window last sent it.
 */
export default function OutputApp() {
  const [scene, setScene] = useState<SceneState>(EMPTY_SCENE)
  // Electron doesn't guarantee ordering between the requestSceneSync reply
  // and a live scene:update broadcast, so a live update that arrives first
  // must win over the (now-stale) sync response resolving after it.
  const receivedLiveUpdate = useRef(false)

  useEffect(() => {
    window.mirrorcat.requestSceneSync().then((synced) => {
      if (synced && !receivedLiveUpdate.current) setScene(synced)
    })
    return window.mirrorcat.onSceneUpdate((next) => {
      receivedLiveUpdate.current = true
      setScene(next)
    })
  }, [])

  return (
    <div className="output-stage">
      {scene.surfaces.map((surface) => (
        <div key={surface.id} className="output-layer">
          <ProjectionCanvas
            surface={surface}
            textureDataUrl={surface.contentId ? scene.content[surface.contentId]?.dataUrl : undefined}
          />
        </div>
      ))}
    </div>
  )
}
