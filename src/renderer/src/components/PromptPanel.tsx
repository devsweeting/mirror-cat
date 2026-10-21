import { useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { Surface } from '@shared/types'
import { getContentProvider } from '../ai/contentService'
import { useSceneStore } from '../state/sceneStore'
import CatEyes from './CatEyes'

interface PromptPanelProps {
  /** The selected surface: what Cat paints on. */
  surface: Surface | null
}

/**
 * Cat's prompt bar, docked under the stage so you write the prompt right
 * next to the wall it lands on. The chip names the target surface in its
 * own outline color. Enter generates; Shift+Enter adds a line.
 */
export default function PromptPanel({ surface }: PromptPanelProps) {
  const [prompt, setPrompt] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const setSurfaceAsset = useSceneStore((s) => s.setSurfaceAsset)

  const canGenerate = !!surface && !isGenerating && prompt.trim().length > 0

  const generate = async (): Promise<void> => {
    if (!surface || !prompt.trim() || isGenerating) return
    const surfaceId = surface.id
    setIsGenerating(true)
    setError(null)
    try {
      const image = await getContentProvider().generate({ prompt })
      // Saved to the library first, so a generation is never lost -- it
      // stays available to swap back to even after the surface changes.
      const asset = await window.mirrorcat.media.importGenerated({
        bytes: image.bytes,
        name: image.prompt.slice(0, 40),
        prompt: image.prompt
      })
      setSurfaceAsset(surfaceId, asset.id)
    } catch (err) {
      console.error('[generate] failed', err)
      setError("Cat couldn't generate that image. Your prompt is still here; try again.")
    } finally {
      setIsGenerating(false)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void generate()
    }
  }

  return (
    <div className="composer-wrap">
      <form
        className={`composer${isGenerating ? ' working' : ''}${surface ? '' : ' disabled'}`}
        style={surface ? ({ '--surface-color': surface.outlineColor } as CSSProperties) : undefined}
        onSubmit={(e) => {
          e.preventDefault()
          void generate()
        }}
        aria-busy={isGenerating}
      >
        <CatEyes size={34} mood={isGenerating ? 'working' : 'idle'} />
        {surface && (
          <span className="composer-target" title={`Generates onto ${surface.name}`}>
            <span className="target-dot" aria-hidden="true" />
            {surface.name}
          </span>
        )}
        <textarea
          className="composer-input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            surface ? 'What should Cat paint?' : 'Add a surface, then ask Cat to paint it'
          }
          aria-label={surface ? `Prompt for ${surface.name}` : 'Prompt'}
          rows={1}
          disabled={!surface}
        />
        <button type="submit" className="btn btn-light composer-submit" disabled={!canGenerate}>
          {isGenerating ? 'Generating…' : 'Generate'}
        </button>
      </form>
      {error && (
        <p className="error composer-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
