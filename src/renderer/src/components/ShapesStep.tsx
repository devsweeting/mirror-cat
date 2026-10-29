import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DEFAULT_MASK_PARAMS } from '@shared/mask'
import { mediaUrl, type MediaAsset } from '@shared/media'
import type { FrameBox } from '@shared/sam'
import type { DetectedShape } from '@shared/shapes'
import type { CornerSet } from '@shared/types'
import { useSceneStore } from '../state/sceneStore'
import { useSamStatus } from '../hooks/useSamStatus'
import { MOD_KEY, hasMod, isTyping } from '../lib/keys'
import DetailedFinder from './DetailedFinder'
import ShapePicker, { type ShapeTarget } from './ShapePicker'
import Tooltip, { Keys } from './Tooltip'

interface ShapesStepProps {
  /** The photo fitted to the projector: shapes are found in this. */
  fitted: MediaAsset
  /** Header, drawn by the dialog; gets the shortcuts button. */
  header: (extra: ReactNode) => ReactNode
  onBack: () => void
  /** One surface filling the frame with the whole photo. */
  onProjectWhole: () => void
  /** Surfaces were made (first one to select), or nothing was. */
  onMade: (firstSurfaceId: string | null) => void
}

interface ListState {
  found: DetectedShape[]
  picks: Record<string, ShapeTarget>
}

const UNDO_LIMIT = 20

/** Every shortcut, for the help list (keys, what it does). */
const SHORTCUTS: [string[], string][] = [
  [['1', '–', '9'], 'Pick or unpick a shape'],
  [[MOD_KEY, 'A'], 'Pick all'],
  [[MOD_KEY, 'D'], 'Pick none'],
  [['C'], 'Combine picked shapes'],
  [['⌫'], 'Remove picked shapes from the list'],
  [[MOD_KEY, 'Z'], 'Undo'],
  [['F'], 'Find more shapes (detailed finder)'],
  [['↵'], 'Make the surfaces'],
  [['Esc'], 'Cancel a box, or close']
]

/**
 * Pick the shapes: the shapes found in a fitted scan, ready to become
 * surfaces. Click to pick, drag a box to add one, combine picked shapes
 * into one, remove the ones you don't want -- with undo and a key for
 * everything. Each picked shape becomes a new surface or moves an existing
 * one onto it.
 */
export default function ShapesStep({ fitted, header, onBack, onProjectWhole, onMade }: ShapesStepProps) {
  const store = useSceneStore
  const surfaces = useSceneStore((s) => s.surfaces)
  const samStatus = useSamStatus()
  const [list, setList] = useState<ListState | null>(null)
  const [history, setHistory] = useState<ListState[]>([])
  const [pendingBox, setPendingBox] = useState<FrameBox | null>(null)
  const [findingMore, setFindingMore] = useState(false)
  const [moreResult, setMoreResult] = useState<string | null>(null)
  const [combining, setCombining] = useState(false)
  const [making, setMaking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const helpRef = useRef<HTMLDivElement>(null)

  // Look for shapes once, when the step opens.
  useEffect(() => {
    let alive = true
    window.mirrorcat.capture
      .findShapes(fitted.id)
      .catch(() => [])
      .then((found) => {
        if (alive) setList({ found, picks: Object.fromEntries(found.map((s) => [s.id, 'new' as ShapeTarget])) })
      })
    return () => {
      alive = false
    }
  }, [fitted.id])

  const found = list?.found ?? null
  const picks = useMemo(() => list?.picks ?? {}, [list])
  const pickedIds = useMemo(() => (found ? found.filter((s) => picks[s.id]).map((s) => s.id) : []), [found, picks])
  const busy = making || combining || findingMore || pendingBox !== null

  // The list as of the last render, for changes made after an await.
  const listRef = useRef<ListState | null>(null)
  useEffect(() => {
    listRef.current = list
  }, [list])

  /** A change to the list that undo can take back. */
  const commit = useCallback((next: (current: ListState) => ListState) => {
    const current = listRef.current
    if (!current) return
    const value = next(current)
    listRef.current = value
    setHistory((h) => [...h.slice(-(UNDO_LIMIT - 1)), current])
    setList(value)
  }, [])

  const undo = useCallback(() => {
    const previous = history[history.length - 1]
    if (!previous) return
    listRef.current = previous
    setHistory(history.slice(0, -1))
    setList(previous)
  }, [history])

  const toggle = useCallback((id: string) => {
    setList((current) => {
      if (!current) return current
      const picks = { ...current.picks }
      if (picks[id]) delete picks[id]
      else picks[id] = 'new'
      return { ...current, picks }
    })
  }, [])

  const pickAll = useCallback((all: boolean) => {
    setList((current) =>
      current
        ? {
            ...current,
            picks: all ? Object.fromEntries(current.found.map((s) => [s.id, current.picks[s.id] ?? 'new'])) : {}
          }
        : current
    )
  }, [])

  const setTarget = (id: string, target: ShapeTarget): void => {
    setList((current) => {
      if (!current) return current
      const picks: Record<string, ShapeTarget> = {}
      // One surface can only sit on one shape: whoever had it goes back to "new".
      for (const [k, t] of Object.entries(current.picks)) picks[k] = target !== 'new' && t === target ? 'new' : t
      picks[id] = target
      return { ...current, picks }
    })
  }

  const remove = useCallback(() => {
    if (pickedIds.length === 0) return
    const gone = new Set(pickedIds)
    commit((current) => ({ found: current.found.filter((s) => !gone.has(s.id)), picks: {} }))
  }, [commit, pickedIds])

  const combine = useCallback(async () => {
    if (pickedIds.length < 2 || combining) return
    setCombining(true)
    setNotice(null)
    try {
      const shape = await window.mirrorcat.capture.combineShapes(fitted.id, pickedIds)
      if (!shape) {
        setNotice('Those shapes couldn’t be combined. Try picking shapes that are near each other.')
        return
      }
      const parts = new Set(pickedIds)
      commit((current) => {
        const at = current.found.findIndex((s) => parts.has(s.id))
        const rest = current.found.filter((s) => !parts.has(s.id))
        rest.splice(Math.max(0, Math.min(at, rest.length)), 0, shape)
        return { found: rest, picks: { [shape.id]: 'new' } }
      })
    } finally {
      setCombining(false)
    }
  }, [combining, commit, fitted.id, pickedIds])

  /** A box around something: find the shape in it and pick it. */
  const findInBox = async (box: FrameBox): Promise<void> => {
    if (pendingBox) return
    setPendingBox(box)
    setNotice(null)
    try {
      const result = await window.mirrorcat.capture.findInBox(fitted.id, box)
      if (result.found === 'nothing') {
        setNotice('Couldn’t find one clear shape in that box. Draw it close around the edges you want.')
        return
      }
      const shape = result.shape
      commit((current) => ({
        found: current.found.some((s) => s.id === shape.id) ? current.found : [...current.found, shape],
        picks: { ...current.picks, [shape.id]: current.picks[shape.id] ?? 'new' }
      }))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Couldn’t look in that box.')
    } finally {
      setPendingBox(null)
    }
  }

  /** The detailed finder over the whole photo; new shapes come in unpicked. */
  const findMore = useCallback(async () => {
    if (findingMore || samStatus?.state !== 'ready') return
    setFindingMore(true)
    setMoreResult(null)
    setNotice(null)
    try {
      const added = await window.mirrorcat.capture.findMore(fitted.id)
      if (added.length > 0) commit((current) => ({ ...current, found: [...current.found, ...added] }))
      setMoreResult(
        added.length === 0
          ? 'Nothing new. Drag a box around anything still missing.'
          : `Found ${added.length} more. Click the ones you want.`
      )
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The detailed finder didn’t finish.')
    } finally {
      setFindingMore(false)
    }
  }, [commit, findingMore, fitted.id, samStatus?.state])

  /**
   * Each picked shape becomes a surface: a new one, or an existing surface
   * moved onto it (keeping its content). Four-sided shapes need only their
   * corners; traced ones also get an exact mask, cut in main.
   */
  const make = useCallback(async () => {
    if (!found || pickedIds.length === 0 || making) return
    setMaking(true)
    setNotice(null)
    let first: string | null = null
    try {
      for (const [index, shape] of found.entries()) {
        const target = picks[shape.id]
        if (!target) continue
        const exists = target !== 'new' && store.getState().surfaces.some((s) => s.id === target)
        const id = exists ? target : store.getState().addSurface(`Shape ${index + 1}`)
        const maskId =
          shape.kind === 'outline' ? await window.mirrorcat.capture.shapeMask(fitted.id, shape.id, shape.corners) : null
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
      setMaking(false)
      return
    }
    setMaking(false)
    onMade(first)
  }, [fitted.id, found, making, onMade, pickedIds.length, picks, store])

  // Keys. Ignored while typing or choosing in a list, and while busy.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (isTyping(event.target) || event.defaultPrevented || !found) return
      const key = event.key
      const mod = hasMod(event)
      let handled = true
      if (mod && key.toLowerCase() === 'z' && !event.shiftKey) undo()
      else if (mod && key.toLowerCase() === 'a') pickAll(true)
      else if (mod && key.toLowerCase() === 'd') pickAll(false)
      else if (mod || event.altKey) handled = false
      else if (/^[1-9]$/.test(key) && found[Number(key) - 1]) toggle(found[Number(key) - 1].id)
      else if (key === 'c' || key === 'C') void combine()
      else if (key === 'Backspace' || key === 'Delete') remove()
      else if (key === 'f' || key === 'F') void findMore()
      else if (key === '?') setHelpOpen((o) => !o)
      else if (key === 'Enter' && !(event.target instanceof HTMLButtonElement)) void make()
      else handled = false
      if (handled) event.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [combine, findMore, found, make, pickAll, remove, toggle, undo])

  // The shortcuts list closes on Esc (before the dialog does) or a click elsewhere.
  useEffect(() => {
    if (!helpOpen) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setHelpOpen(false)
      }
    }
    const onDown = (event: MouseEvent): void => {
      if (!helpRef.current?.contains(event.target as Node)) setHelpOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown)
    }
  }, [helpOpen])

  const status =
    found === null
      ? 'Looking for shapes…'
      : found.length === 0
        ? 'No shapes found yet. Drag a box around something, or project the whole photo.'
        : 'Each shape you pick becomes a surface with its corners in place, ready for your own content.'

  const shortcutsButton = (
    <div className="shortcuts" ref={helpRef}>
      <Tooltip label="Keyboard shortcuts" keys={['?']} side="bottom">
        <button
          type="button"
          className="icon-btn"
          aria-label="Keyboard shortcuts"
          aria-expanded={helpOpen}
          onClick={() => setHelpOpen((o) => !o)}
        >
          <svg viewBox="0 0 20 14" width="18" height="13" aria-hidden="true">
            <rect x="1" y="1" width="18" height="12" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M4.5 4.6h1M8 4.6h1M11.5 4.6h1M15 4.6h.5M4.5 7.2h1M8 7.2h1M11.5 7.2h1M15 7.2h.5M6.5 10h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </Tooltip>
      {helpOpen && (
        <div className="shortcuts-panel" role="dialog" aria-label="Keyboard shortcuts">
          <dl>
            {SHORTCUTS.map(([keys, what]) => (
              <div key={what} className="shortcut">
                <dt>
                  <Keys keys={keys} />
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  )

  const selectionBar =
    found && (pickedIds.length > 0 || history.length > 0) ? (
      <div className="selection-bar" onPointerDown={(e) => e.stopPropagation()}>
        {pickedIds.length > 0 && (
          <>
            <span className="selection-count">{pickedIds.length} picked</span>
            <Tooltip
              label={pickedIds.length < 2 ? 'Pick two or more shapes to combine them' : 'Combine into one shape'}
              keys={['C']}
            >
              <button
                type="button"
                className="bar-btn"
                onClick={() => void combine()}
                disabled={pickedIds.length < 2 || busy}
                aria-label="Combine picked shapes"
              >
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <rect x="1.5" y="1.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
                  <rect x="6.5" y="6.5" width="8" height="8" rx="1.5" fill="currentColor" fillOpacity=".25" stroke="currentColor" strokeWidth="1.4" />
                </svg>
                {combining ? 'Combining…' : 'Combine'}
              </button>
            </Tooltip>
            <Tooltip label="Remove from the list" keys={['⌫']}>
              <button
                type="button"
                className="bar-btn"
                onClick={remove}
                disabled={busy}
                aria-label="Remove picked shapes from the list"
              >
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                </svg>
                Remove
              </button>
            </Tooltip>
          </>
        )}
        {history.length > 0 && (
          <Tooltip label="Undo the last change" keys={[MOD_KEY, 'Z']}>
            <button type="button" className="bar-btn" onClick={undo} disabled={busy} aria-label="Undo">
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M5.5 3.5 2.5 6.5l3 3M2.8 6.5h6.7a4 4 0 0 1 0 8H7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Undo
            </button>
          </Tooltip>
        )}
      </div>
    ) : null

  const listHead =
    found && found.length > 0 ? (
      <div className="shape-list-head">
        <span>
          {pickedIds.length} of {found.length} picked
        </span>
        <span className="shape-list-actions">
          <Tooltip label="Pick all" keys={[MOD_KEY, 'A']}>
            <button
              type="button"
              className="link-btn"
              onClick={() => pickAll(true)}
              disabled={pickedIds.length === found.length}
              aria-label="Pick all shapes"
            >
              All
            </button>
          </Tooltip>
          <Tooltip label="Pick none" keys={[MOD_KEY, 'D']}>
            <button
              type="button"
              className="link-btn"
              onClick={() => pickAll(false)}
              disabled={pickedIds.length === 0}
              aria-label="Pick no shapes"
            >
              None
            </button>
          </Tooltip>
        </span>
      </div>
    ) : null

  return (
    <>
      {header(shortcutsButton)}
      <div className="scan-body scan-photo">
        {found ? (
          <ShapePicker
            imageUrl={mediaUrl(fitted.id)}
            shapes={found}
            picks={picks}
            surfaces={surfaces.map((s) => ({ id: s.id, name: s.name }))}
            onToggle={toggle}
            onTarget={setTarget}
            onBox={(box) => void findInBox(box)}
            pendingBox={pendingBox}
            selectionBar={selectionBar}
            listHead={listHead}
            footer={
              <DetailedFinder
                status={samStatus}
                busy={findingMore}
                result={moreResult}
                onFindMore={() => void findMore()}
              />
            }
          />
        ) : (
          <img className="scan-photo-image finding" src={mediaUrl(fitted.id)} alt="Your scan, fitted to the projector" />
        )}

        {found && (
          <ul className="shape-howto" aria-label="How to pick shapes">
            <li>
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <path d="M4 2.5v10l2.6-2.4 1.7 3.7 1.6-.7-1.7-3.6 3.5-.2z" fill="currentColor" />
              </svg>
              Click a shape to pick it
            </li>
            <li>
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <rect x="2" y="3" width="12" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.4 1.8" />
              </svg>
              Drag to draw one it missed
            </li>
            <li>
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <rect x="1.5" y="1.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <rect x="6.5" y="6.5" width="8" height="8" rx="1.5" fill="currentColor" fillOpacity=".25" stroke="currentColor" strokeWidth="1.4" />
              </svg>
              Pick two or more to combine them
            </li>
          </ul>
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
            <Tooltip label="Make a surface for each picked shape" keys={['↵']}>
              <button type="button" className="btn" disabled={busy || pickedIds.length === 0} onClick={() => void make()}>
                {making
                  ? 'Making surfaces…'
                  : pickedIds.length === 0
                    ? 'Pick a shape'
                    : `Make ${pickedIds.length} surface${pickedIds.length === 1 ? '' : 's'}`}
              </button>
            </Tooltip>
          )}
          <button
            type="button"
            className={found && found.length > 0 ? 'btn btn-ghost' : 'btn'}
            disabled={busy || found === null}
            onClick={onProjectWhole}
            title="One surface filling the frame, showing the photo exactly where it was taken"
          >
            Project the whole photo
          </button>
          <button type="button" className="btn btn-ghost" disabled={making} onClick={onBack}>
            Back
          </button>
        </div>
      </div>
    </>
  )
}
