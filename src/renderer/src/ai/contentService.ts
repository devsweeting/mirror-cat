import type { GeneratedContent } from '@shared/types'

export interface ContentGenerationRequest {
  prompt: string
  width?: number
  height?: number
}

export interface ContentProvider {
  readonly name: string
  generate(request: ContentGenerationRequest): Promise<GeneratedContent>
}

/**
 * Deterministic placeholder provider. Turns a prompt into a canvas
 * gradient + ring pattern so the generate -> texture -> warp pipeline is
 * testable end-to-end before a real generative backend is wired in.
 *
 * Swap this out once you've picked a real provider -- see README.md,
 * "Wiring a real AI provider".
 */
export class MockPatternProvider implements ContentProvider {
  readonly name = 'mock-pattern'

  async generate({ prompt, width = 1024, height = 1024 }: ContentGenerationRequest): Promise<GeneratedContent> {
    const hash = hashString(prompt)
    const hueA = hash % 360
    const hueB = (hash * 7) % 360

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')

    const gradient = ctx.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, `hsl(${hueA}, 70%, 55%)`)
    gradient.addColorStop(1, `hsl(${hueB}, 70%, 35%)`)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)

    ctx.globalAlpha = 0.25
    const rings = 6 + (hash % 5)
    for (let i = 0; i < rings; i++) {
      const t = i / rings
      ctx.beginPath()
      ctx.arc(width / 2, height / 2, t * width * 0.5, 0, Math.PI * 2)
      ctx.strokeStyle = `hsl(${(hueA + i * 30) % 360}, 90%, 80%)`
      ctx.lineWidth = 6
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    // Simulate network latency so loading states in the UI are exercised
    // even against this local mock provider.
    await new Promise((resolve) => setTimeout(resolve, 300))

    return {
      id: `content-${Date.now()}`,
      prompt,
      createdAt: Date.now(),
      dataUrl: canvas.toDataURL('image/png')
    }
  }
}

function hashString(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

let activeProvider: ContentProvider = new MockPatternProvider()

export function getContentProvider(): ContentProvider {
  return activeProvider
}

export function setContentProvider(provider: ContentProvider): void {
  activeProvider = provider
}
