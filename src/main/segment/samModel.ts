import { createHash } from 'crypto'
import { createWriteStream } from 'fs'
import { mkdir, rename, rm, stat } from 'fs/promises'
import { join } from 'path'

/**
 * SAM 2.1 hiera-tiny (Meta, Apache-2.0) as ONNX, from Hugging Face's
 * onnx-community export -- pinned to one revision and checked by SHA-256,
 * so a file can't change under us after it's published.
 *
 * - vision_encoder: 1024×1024 image → three feature maps (once per photo).
 * - prompt_encoder_mask_decoder: features + points/boxes → three candidate
 *   masks (256×256 logits) with predicted quality.
 */
const REPO = 'https://huggingface.co/onnx-community/sam2.1-hiera-tiny-ONNX/resolve'
const REVISION = '814a066640debee5a91e70aa401fb8e17e030503'

export interface ModelFile {
  name: string
  bytes: number
  sha256: string
}

export const SAM_FILES: readonly ModelFile[] = [
  {
    name: 'vision_encoder.onnx',
    bytes: 354238,
    sha256: '4f30aacd3aaefbca81a0b7fe4c1fc96345570ea0a6f80ced599493d1b3be2e8c'
  },
  {
    name: 'vision_encoder.onnx_data',
    bytes: 134084864,
    sha256: 'e83df9866a5afe68ea7f0f721f18f65137fc3acbf0da1c74e946d363e09c69cc'
  },
  {
    name: 'prompt_encoder_mask_decoder.onnx',
    bytes: 213114,
    sha256: '874414704c5d686db7d206a35f6e15d26563d50c8c4468fccc6739bd7e491dcf'
  },
  {
    name: 'prompt_encoder_mask_decoder.onnx_data',
    bytes: 20958208,
    sha256: 'e9874d900dd4134ed60eab1e97910327c2419e0b2954485d8fd6e7f1a1470f47'
  }
]

export const SAM_TOTAL_BYTES = SAM_FILES.reduce((n, f) => n + f.bytes, 0)

export const SAM_DIR_NAME = 'sam2.1-hiera-tiny'

/** Every file present at its expected size (hashes are checked when downloaded). */
export async function samInstalled(dir: string, files: readonly ModelFile[] = SAM_FILES): Promise<boolean> {
  for (const file of files) {
    const info = await stat(join(dir, file.name)).catch(() => null)
    if (!info || info.size !== file.bytes) return false
  }
  return true
}

export type Fetcher = (url: string, init: { signal: AbortSignal }) => Promise<Response>

/**
 * Download the files that aren't already there. Each streams to a .part
 * file while it's hashed, and is renamed into place only if its size and
 * SHA-256 match. Throws on a mismatch, a network error or `signal` abort;
 * a half-done download leaves no .part file behind.
 */
export async function downloadSam(
  dir: string,
  fetcher: Fetcher,
  onProgress: (receivedBytes: number) => void,
  signal: AbortSignal,
  files: readonly ModelFile[] = SAM_FILES
): Promise<void> {
  await mkdir(dir, { recursive: true })
  let received = 0
  for (const file of files) {
    const target = join(dir, file.name)
    const existing = await stat(target).catch(() => null)
    if (existing?.size === file.bytes) {
      received += file.bytes
      onProgress(received)
      continue
    }
    const part = `${target}.part`
    const out = createWriteStream(part)
    try {
      const response = await fetcher(`${REPO}/${REVISION}/onnx/${file.name}`, { signal })
      if (!response.ok || !response.body) throw new Error(`Download failed (${response.status})`)
      const hash = createHash('sha256')
      let size = 0
      const reader = response.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > file.bytes) throw new Error('The download was larger than expected')
        hash.update(value)
        if (!out.write(value)) await new Promise((resolve) => out.once('drain', resolve))
        received += value.byteLength
        onProgress(received)
      }
      await new Promise<void>((resolve, reject) =>
        out.end((error?: Error | null) => (error ? reject(error) : resolve()))
      )
      if (size !== file.bytes || hash.digest('hex') !== file.sha256) {
        throw new Error('The download didn’t match the published model')
      }
      await rename(part, target)
    } catch (error) {
      out.destroy()
      await rm(part, { force: true })
      throw error
    }
  }
}

/** Remove the model (after it fails to load, say). */
export async function removeSam(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}
