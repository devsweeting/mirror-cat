import { create } from 'zustand'
import {
  mediaUrl,
  type MediaAsset,
  type MediaImportError,
  type MediaImportResult,
  type MediaKind
} from '@shared/media'
import { probePendingAssets } from './mediaProbe'

interface MediaStore {
  /** Newest first, as the main process sends them. */
  assets: MediaAsset[]
  /** False until the first list arrives, so "missing file" isn't shown during startup. */
  loaded: boolean
  importing: boolean
  /** Problems from the most recent import, shown until dismissed. */
  importErrors: MediaImportError[]
  dismissImportErrors: () => void
}

export const useMediaStore = create<MediaStore>((set) => ({
  assets: [],
  loaded: false,
  importing: false,
  importErrors: [],
  dismissImportErrors: () => set({ importErrors: [] })
}))

/**
 * Load the library and follow changes broadcast from main (imports, renames
 * and deletes from any window). Returns an unsubscribe.
 *
 * With `probe`, also measures and thumbnails new videos (and images main
 * couldn't thumbnail) as they arrive. Only the control window should probe,
 * so the work isn't done twice.
 */
export function connectMediaLibrary({ probe }: { probe: boolean }): () => void {
  const apply = (assets: MediaAsset[]): void => {
    useMediaStore.setState({ assets, loaded: true })
    if (probe) probePendingAssets(assets)
  }
  const unsubscribe = window.mirrorcat.media.onChanged(apply)
  window.mirrorcat.media
    .list()
    .then(apply)
    .catch((error) => console.error('[media] list failed', error))
  return unsubscribe
}

/**
 * What a surface should render, or undefined for the placeholder (no asset,
 * asset deleted, or a video that turned out not to play here).
 */
export function surfaceMedia(
  assetId: string | null,
  assets: MediaAsset[]
): { url: string; kind: MediaKind; aspect?: number } | undefined {
  if (!assetId) return undefined
  const asset = assets.find((a) => a.id === assetId)
  if (!asset || asset.playable === false) return undefined
  return {
    url: mediaUrl(asset.id),
    kind: asset.kind,
    // Unknown (0×0) until a fresh video has been probed.
    aspect: asset.width > 0 && asset.height > 0 ? asset.width / asset.height : undefined
  }
}

async function runImport(task: () => Promise<MediaImportResult>): Promise<MediaAsset[]> {
  useMediaStore.setState({ importing: true })
  try {
    const { imported, errors } = await task()
    useMediaStore.setState({ importErrors: errors })
    return imported
  } catch (error) {
    console.error('[media] import failed', error)
    useMediaStore.setState({
      importErrors: [{ name: 'Import', message: 'Something went wrong importing. Try again.' }]
    })
    return []
  } finally {
    useMediaStore.setState({ importing: false })
  }
}

/** Open the OS file picker and import whatever the user chooses. */
export function pickAndImport(): Promise<MediaAsset[]> {
  return runImport(() => window.mirrorcat.media.pickAndImport())
}

/** Import files dropped from the OS (Finder/Explorer). */
export function importDroppedFiles(files: FileList | File[]): Promise<MediaAsset[]> {
  const paths = Array.from(files)
    .map((file) => window.mirrorcat.getPathForFile(file))
    .filter((path) => path.length > 0)
  if (paths.length === 0) return Promise.resolve([])
  return runImport(() => window.mirrorcat.media.importPaths(paths))
}
