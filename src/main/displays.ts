import { screen } from 'electron'
import type { DisplayInfo } from '../shared/types'

export function listDisplays(): DisplayInfo[] {
  const primary = screen.getPrimaryDisplay()
  return screen.getAllDisplays().map((d) => ({
    id: d.id,
    label: `${d.size.width}x${d.size.height}${d.id === primary.id ? ' (Primary)' : ''}`,
    bounds: d.bounds,
    isPrimary: d.id === primary.id
  }))
}
