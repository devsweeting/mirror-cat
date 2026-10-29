import { createHash } from 'crypto'
import { mkdtemp, readdir, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { downloadSam, samInstalled, type Fetcher, type ModelFile } from './samModel'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

async function tempDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'mc-sam-'))
  dirs.push(d)
  return d
}

const bytesA = new Uint8Array(3000).map((_, i) => i % 251)
const bytesB = new Uint8Array(500).fill(7)
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')
const FILES: ModelFile[] = [
  { name: 'a.onnx', bytes: bytesA.length, sha256: sha(bytesA) },
  { name: 'b.onnx_data', bytes: bytesB.length, sha256: sha(bytesB) }
]

/** Serves each file in a few chunks; `tamper` swaps one byte of b. */
function fetcher(tamper = false): { fetch: Fetcher; urls: string[] } {
  const urls: string[] = []
  const fetch: Fetcher = async (url) => {
    urls.push(url)
    const data = url.endsWith('a.onnx') ? bytesA : Uint8Array.from(bytesB)
    if (tamper && url.endsWith('b.onnx_data')) data[10] = 8
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < data.length; i += 700) controller.enqueue(data.slice(i, i + 700))
        controller.close()
      }
    })
    return new Response(body, { status: 200 })
  }
  return { fetch, urls }
}

describe('downloadSam', () => {
  it('downloads every file from the pinned revision, checks it and reports progress', async () => {
    const dir = await tempDir()
    const { fetch, urls } = fetcher()
    const progress: number[] = []
    await downloadSam(dir, fetch, (n) => progress.push(n), new AbortController().signal, FILES)
    expect(await readFile(join(dir, 'a.onnx'))).toEqual(Buffer.from(bytesA))
    expect(await samInstalled(dir, FILES)).toBe(true)
    expect(progress.at(-1)).toBe(3500)
    expect(urls[0]).toMatch(/onnx-community\/sam2\.1-hiera-tiny-ONNX\/resolve\/[0-9a-f]{40}\/onnx\/a\.onnx$/)
  })

  it('refuses a file that doesn’t match its checksum and leaves nothing half-done', async () => {
    const dir = await tempDir()
    await expect(
      downloadSam(dir, fetcher(true).fetch, () => {}, new AbortController().signal, FILES)
    ).rejects.toThrow(/didn’t match/)
    expect(await readdir(dir)).toEqual(['a.onnx'])
    expect(await samInstalled(dir, FILES)).toBe(false)
  })

  it('skips files already there (a retry picks up where it stopped)', async () => {
    const dir = await tempDir()
    await downloadSam(dir, fetcher().fetch, () => {}, new AbortController().signal, FILES)
    const again = fetcher()
    await downloadSam(dir, again.fetch, () => {}, new AbortController().signal, FILES)
    expect(again.urls).toEqual([])
  })
})
