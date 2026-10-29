import { useEffect, useState } from 'react'
import type { SamStatus } from '@shared/sam'

/** The detailed finder's status, kept current while mounted. */
export function useSamStatus(): SamStatus | null {
  const [status, setStatus] = useState<SamStatus | null>(null)
  useEffect(() => {
    let alive = true
    void window.mirrorcat.capture.samStatus().then((s) => alive && setStatus(s))
    const off = window.mirrorcat.capture.onSamStatus((s) => alive && setStatus(s))
    return () => {
      alive = false
      off()
    }
  }, [])
  return status
}
