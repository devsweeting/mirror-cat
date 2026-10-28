import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import Sidebar from './components/Sidebar'
import ProjectionCanvas from './components/ProjectionCanvas'
import CatEyes from './components/CatEyes'
import ProjectorControl from './components/ProjectorControl'
import PromptPanel from './components/PromptPanel'
import LibraryPanel from './components/LibraryPanel'
import { LibraryIcon, SettingsIcon } from './components/icons'
import SettingsPanel from './components/settings/SettingsPanel'
import { useSceneStore } from './state/sceneStore'
import {
  connectMediaLibrary,
  importDroppedFiles,
  surfaceMedia,
  useMediaStore
} from './state/mediaStore'
import { editCorners, editEdgeNodes, redoShape, undoShape } from './state/shapeHistory'
import { useUiStore } from './state/uiStore'
import { useFileDrop } from './hooks/useFileDrop'
import type { DisplayInfo, SceneState } from '@shared/types'

function toSyncedScene(state: SceneState): SceneState {
  return { surfaces: state.surfaces, outputDisplayId: state.outputDisplayId }
}

export default function App() {
  const surfaces = useSceneStore((s) => s.surfaces)
  const setSurfaceAsset = useSceneStore((s) => s.setSurfaceAsset)
  const addSurface = useSceneStore((s) => s.addSurface)
  const libraryOpen = useUiStore((s) => s.libraryOpen)
  const toggleLibrary = useUiStore((s) => s.toggleLibrary)
  const settingsOpen = useUiStore((s) => s.settingsOpen)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)

  // App menu ▸ Settings (⌘,).
  useEffect(() => window.mirrorcat.onOpenSettings(() => setSettingsOpen(true)), [setSettingsOpen])
  const assets = useMediaStore((s) => s.assets)
  const assetCount = assets.length
  const outputDisplayId = useSceneStore((s) => s.outputDisplayId)
  const [selectedSurfaceId, setSelectedSurfaceId] = useState<string | null>(null)
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [selectedDisplayId, setSelectedDisplayId] = useState<number | null>(null)

  // Edit ▸ Undo / Redo (and ⌘Z / ⇧⌘Z, which the menu owns) arrive from
  // main. Inside a text field they keep their normal meaning -- undo typing
  // -- otherwise they step surface-shape history and select the surface
  // that changed, so an undo is never invisible.
  useEffect(
    () =>
      window.mirrorcat.onEditCommand((command) => {
        const el = document.activeElement
        const typing =
          el instanceof HTMLInputElement ||
          el instanceof HTMLTextAreaElement ||
          (el instanceof HTMLElement && el.isContentEditable)
        if (typing) {
          document.execCommand(command)
          return
        }
        const changed = command === 'undo' ? undoShape() : redoShape()
        if (changed) setSelectedSurfaceId(changed)
      }),
    []
  )

  // Lives here (not in the sidebar) because the stage needs the chosen
  // display's shape to frame itself as the projector.
  useEffect(() => {
    const apply = (list: DisplayInfo[]): void => {
      setDisplays(list)
      // Keep the pick if that display is still there. Otherwise default to
      // a non-primary display -- almost always the projector, while the
      // primary is the laptop screen.
      setSelectedDisplayId((current) => {
        if (current !== null && list.some((d) => d.id === current)) return current
        return (list.find((d) => !d.isPrimary) ?? list[0])?.id ?? null
      })
    }
    window.mirrorcat
      .getDisplays()
      .then(apply)
      .catch((error) => console.error('[displays] list failed', error))
    return window.mirrorcat.onDisplaysChanged(apply)
  }, [])

  // While projecting, frame the display actually in use; otherwise the one
  // picked in the sidebar. Falls back to 16:9 before displays load.
  const frameDisplay = displays.find((d) => d.id === (outputDisplayId ?? selectedDisplayId)) ?? null
  const frameWidth = frameDisplay?.bounds.width ?? 16
  const frameHeight = frameDisplay?.bounds.height ?? 9

  // Fall back to the first surface without a render -> effect -> setState
  // -> render round trip: derive it during render instead of syncing state.
  // Also falls back when the previously-selected surface no longer exists
  // (e.g. it was just deleted), instead of only when nothing was selected.
  const effectiveSurfaceId = surfaces.some((s) => s.id === selectedSurfaceId)
    ? selectedSurfaceId
    : (surfaces[0]?.id ?? null)

  // The control window is the one that measures new videos / thumbnails.
  useEffect(() => connectMediaLibrary({ probe: true }), [])

  // Dropping a file anywhere that isn't a drop zone would otherwise make
  // Electron navigate the whole window to that file.
  useEffect(() => {
    const block = (event: DragEvent): void => event.preventDefault()
    window.addEventListener('dragover', block)
    window.addEventListener('drop', block)
    return () => {
      window.removeEventListener('dragover', block)
      window.removeEventListener('drop', block)
    }
  }, [])

  // Mirror every scene change to the main process, which relays it to the
  // output window (if one is open) and autosaves it. Batched to one send
  // per animation frame so a corner drag doesn't flood IPC.
  useEffect(() => {
    let frameId: number | null = null
    let pending: SceneState | null = null

    // Send the starting scene (possibly just restored from the autosave)
    // right away; the subscription below only fires on changes, so without
    // this the projector would stay blank until the first edit.
    window.mirrorcat.sendSceneUpdate(toSyncedScene(useSceneStore.getState()))

    const flush = (): void => {
      frameId = null
      if (pending) {
        window.mirrorcat.sendSceneUpdate(pending)
        pending = null
      }
    }

    const unsubscribe = useSceneStore.subscribe((state) => {
      pending = toSyncedScene(state)
      if (frameId === null) frameId = requestAnimationFrame(flush)
    })

    return () => {
      unsubscribe()
      if (frameId !== null) cancelAnimationFrame(frameId)
    }
  }, [])

  // Files dropped on the stage go into the library and straight onto the
  // selected surface -- the fastest path from "I have a picture" to
  // "it's on the wall".
  const stageDrop = useFileDrop<HTMLElement>((files) => {
    const targetId = effectiveSurfaceId
    void importDroppedFiles(files).then(([first]) => {
      if (first && targetId) setSurfaceAsset(targetId, first.id)
    })
  })
  const dropTargetName = surfaces.find((s) => s.id === effectiveSurfaceId)?.name

  // Array order is stacking order, back to front -- exactly what the
  // projector draws. (The sidebar lists it reversed, front on top.)
  const layerOrder = useMemo(() => surfaces.filter((s) => s.visible), [surfaces])

  const selectedSurface = surfaces.find((s) => s.id === effectiveSurfaceId) ?? null
  const live = outputDisplayId !== null

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="wordmark">
          <CatEyes size={28} mood={live ? 'live' : 'idle'} />
          <span>Mirror Cat</span>
        </div>
        <div className="topbar-spacer" />
        <button
          type="button"
          className={`btn btn-ghost topbar-library${libraryOpen ? ' active' : ''}`}
          onClick={toggleLibrary}
          aria-pressed={libraryOpen}
          aria-controls="media-library"
          title={libraryOpen ? 'Hide library' : 'Show library'}
        >
          <LibraryIcon />
          Library
          {assetCount > 0 && <span className="topbar-count num">{assetCount}</span>}
        </button>
        <button
          type="button"
          className="icon-btn topbar-settings"
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          title="Settings (⌘,)"
        >
          <SettingsIcon />
        </button>
        <ProjectorControl
          displays={displays}
          selectedDisplayId={selectedDisplayId}
          onSelectDisplay={setSelectedDisplayId}
        />
      </header>

      <div className="body">
        <Sidebar selectedSurfaceId={effectiveSurfaceId} onSelectSurface={setSelectedSurfaceId} />
        <main className={`stage${stageDrop.isOver ? ' drop-over' : ''}`} {...stageDrop.handlers}>
          {stageDrop.isOver && (
            <div className="stage-drop-overlay" aria-hidden="true">
              {dropTargetName
                ? `Drop to put it on ${dropTargetName}`
                : 'Drop to add to the library'}
            </div>
          )}
          <div className="stage-frame-area">
            <div
              className={`editor-stage${live ? ' live' : ''}`}
              style={
                {
                  '--frame-ratio': frameWidth / frameHeight,
                  aspectRatio: `${frameWidth} / ${frameHeight}`
                } as CSSProperties
              }
            >
              {/* Every visible surface's content is drawn in its true
                  stacking order, so the preview matches the projector. The
                  selected surface's outline and handles are a separate,
                  content-free layer on top, so they're always reachable
                  even when it sits behind other surfaces. */}
              {layerOrder.map((surface) => {
                const isSelected = surface.id === effectiveSurfaceId
                return (
                  <div key={surface.id} className="editor-layer">
                    <ProjectionCanvas
                      surface={surface}
                      media={surfaceMedia(surface.assetId, assets)}
                      ghost={!isSelected}
                    />
                  </div>
                )
              })}
              {selectedSurface?.visible && (
                <div
                  key={`handles-${selectedSurface.id}`}
                  className="editor-layer selected handles-layer"
                >
                  <ProjectionCanvas
                    surface={selectedSurface}
                    media={surfaceMedia(selectedSurface.assetId, assets)}
                    editable
                    contentless
                    onCornersChange={(corners) => editCorners(selectedSurface.id, corners)}
                    onEdgeNodesChange={(nodes) => editEdgeNodes(selectedSurface.id, nodes)}
                  />
                </div>
              )}
              {surfaces.length === 0 ? (
                <div className="stage-hint">
                  <p>A surface is one shape on your wall: a frame, a door, a shelf.</p>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setSelectedSurfaceId(addSurface('Surface 1'))}
                  >
                    Add a surface
                  </button>
                </div>
              ) : (
                layerOrder.length === 0 && (
                  <div className="stage-hint">
                    <p>All surfaces are hidden. Turn one back on with its dot in the list.</p>
                  </div>
                )
              )}
            </div>
          </div>
          <p className="frame-caption">
            <span className="num">
              {frameDisplay
                ? `${frameDisplay.bounds.width} × ${frameDisplay.bounds.height} (${aspectLabel(frameWidth, frameHeight)})`
                : '16:9 preview'}
            </span>
            {live && <span className="frame-live">Live on the projector</span>}
          </p>
          <PromptPanel surface={selectedSurface} />
        </main>
        {libraryOpen && <LibraryPanel targetSurfaceId={effectiveSurfaceId} />}
      </div>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

/** "16:9", "16:10", "4:3" etc., or a decimal ratio for odd sizes. */
function aspectLabel(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const d = gcd(width, height)
  const w = width / d
  const h = height / d
  return w <= 32 && h <= 32 ? `${w}:${h}` : `${(width / height).toFixed(2)}:1`
}
