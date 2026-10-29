import { app } from 'electron'
import { join } from 'path'
import { SAM_DIR_NAME } from './samModel'
import { VisionClient } from './visionClient'

/**
 * Where the detailed finder's model lives. Dev/e2e can point at an existing
 * download with MIRRORCAT_SAM_DIR; a packaged app always uses userData.
 */
export function samModelDir(): string {
  const override = !app.isPackaged ? process.env.MIRRORCAT_SAM_DIR : undefined
  return override || join(app.getPath('userData'), 'models', SAM_DIR_NAME)
}

/** The one vision process client: frame finding, shape finding, SAM. */
export const vision = new VisionClient(samModelDir)
