import { screen } from 'electron'
import type { DisplayInfo } from '../shared/types'

/**
 * Displays as the user knows them: the OS display name when there is one
 * ("LG HDR 4K", "Built-in Retina Display"), otherwise a plain fallback.
 * Resolution is not baked into the label -- the UI shows it separately.
 */
export function listDisplays(): DisplayInfo[] {
  const primary = screen.getPrimaryDisplay()
  let externalIndex = 0
  return screen.getAllDisplays().map((d) => {
    const isPrimary = d.id === primary.id
    const fallback = isPrimary ? 'Main display' : `External display ${++externalIndex}`
    return {
      id: d.id,
      label: d.label?.trim() || fallback,
      bounds: d.bounds,
      isPrimary
    }
  })
}
