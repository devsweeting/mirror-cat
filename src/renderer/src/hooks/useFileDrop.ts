import { useRef, useState, type DragEvent } from 'react'

interface FileDropHandlers<T extends HTMLElement> {
  onDragEnter: (event: DragEvent<T>) => void
  onDragOver: (event: DragEvent<T>) => void
  onDragLeave: (event: DragEvent<T>) => void
  onDrop: (event: DragEvent<T>) => void
}

function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes('Files')
}

/**
 * Accept files dragged in from the OS. `isOver` drives a drop highlight;
 * the enter/leave counter stops it flickering as the pointer crosses child
 * elements (each fires its own enter/leave pair).
 */
export function useFileDrop<T extends HTMLElement>(
  onFiles: (files: File[]) => void
): { isOver: boolean; handlers: FileDropHandlers<T> } {
  const [isOver, setIsOver] = useState(false)
  const depth = useRef(0)

  return {
    isOver,
    handlers: {
      onDragEnter: (event) => {
        if (!carriesFiles(event)) return
        event.preventDefault()
        depth.current += 1
        setIsOver(true)
      },
      onDragOver: (event) => {
        if (!carriesFiles(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      },
      onDragLeave: (event) => {
        if (!carriesFiles(event)) return
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setIsOver(false)
      },
      onDrop: (event) => {
        if (!carriesFiles(event)) return
        event.preventDefault()
        event.stopPropagation()
        depth.current = 0
        setIsOver(false)
        const files = Array.from(event.dataTransfer.files)
        if (files.length > 0) onFiles(files)
      }
    }
  }
}
