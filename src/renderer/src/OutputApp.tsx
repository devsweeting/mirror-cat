import { useEffect, useRef, useState } from 'react'
import ProjectionCanvas from './components/ProjectionCanvas'
import type { SceneState } from '@shared/types'
import { connectMediaLibrary, surfaceMedia, useMediaStore } from './state/mediaStore'

const EMPTY_SCENE: SceneState = { surfaces: [], outputDisplayId: null }

/**
 * Runs in the fullscreen, borderless window pointed at the projector.
 * Pure display: it has no editing UI, and just renders every surface at
 * whatever corner-pin calibration the control window last sent it.
 * Media loads straight from the library protocol; the scene it receives
 * over IPC carries only asset ids. It follows the library too, so it knows
 * whether each asset is an image or a video.
 */
export default function OutputApp() {
  const [scene, setScene] = useState<SceneState>(EMPTY_SCENE)
  const assets = useMediaStore((s) => s.assets)
  // Electron doesn't guarantee ordering between the requestSceneSync reply
  // and a live scene:update broadcast, so a live update that arrives first
  // must win over the (now-stale) sync response resolving after it.
  const receivedLiveUpdate = useRef(false)

  useEffect(() => connectMediaLibrary({ probe: false }), [])

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
      {scene.surfaces
        .filter((surface) => surface.visible)
        .map((surface) => (
          <div key={surface.id} className="output-layer">
            <ProjectionCanvas surface={surface} media={surfaceMedia(surface.assetId, assets)} />
          </div>
        ))}
    </div>
  )
}
