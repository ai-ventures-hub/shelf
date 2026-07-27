import type { ComponentType } from 'react'
import { FileText, Globe, Image } from 'lucide-react'

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>

/**
 * Icon tiles for the demo fixture tools — Lucide glyphs on colored tiles,
 * matching the app's own tool-icon language.
 */
const TOOL_TILES: Record<string, { Icon: IconComponent; hue: 'green' | 'indigo' | 'slate' }> = {
  'image-prepper': { Icon: Image, hue: 'green' },
  'wp-manager': { Icon: Globe, hue: 'indigo' },
  'doc-converter': { Icon: FileText, hue: 'slate' },
}

export function ToolTile({ toolId, size = 17 }: { toolId: string; size?: number }) {
  const tile = TOOL_TILES[toolId]
  if (!tile) return null
  return (
    <span className="tool-tile" data-hue={tile.hue} aria-hidden>
      <tile.Icon size={size} strokeWidth={2} />
    </span>
  )
}
