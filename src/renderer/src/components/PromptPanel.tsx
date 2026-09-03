import { useState } from 'react'
import { getContentProvider } from '../ai/contentService'
import { useSceneStore } from '../state/sceneStore'

interface PromptPanelProps {
  surfaceId: string | null
}

export default function PromptPanel({ surfaceId }: PromptPanelProps) {
  const [prompt, setPrompt] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const setSurfaceContent = useSceneStore((s) => s.setSurfaceContent)

  const generate = async (): Promise<void> => {
    if (!surfaceId || !prompt.trim()) return
    setIsGenerating(true)
    try {
      const content = await getContentProvider().generate({ prompt })
      setSurfaceContent(surfaceId, content)
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="prompt-panel">
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe what should appear on this surface..."
        rows={3}
        disabled={!surfaceId}
      />
      <button onClick={generate} disabled={!surfaceId || isGenerating || !prompt.trim()}>
        {isGenerating ? 'Generating...' : 'Generate'}
      </button>
      {!surfaceId && <p className="hint">Select a surface first.</p>}
    </div>
  )
}
