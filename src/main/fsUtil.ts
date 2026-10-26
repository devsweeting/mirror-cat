import { promises as fs } from 'fs'
import { randomBytes } from 'crypto'

/**
 * Write to a temp file beside the target, then rename over it. A crash or
 * power cut mid-write leaves the previous file intact instead of a
 * truncated one -- important for library.json and scene.json, which the
 * app can't recover from if half-written.
 */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await fs.writeFile(tmp, data)
    await fs.rename(tmp, path)
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined)
    throw error
  }
}

export function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/**
 * Move an unreadable JSON file aside (rather than overwriting it) so a bug
 * in our parser never silently destroys the user's data.
 */
export async function quarantine(path: string): Promise<string> {
  const target = `${path}.corrupt-${Date.now()}`
  await fs.rename(path, target).catch(() => undefined)
  return target
}
