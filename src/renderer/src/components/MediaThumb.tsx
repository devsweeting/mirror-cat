import { formatLabel, hasPreview, thumbnailUrl, type MediaAsset } from '@shared/media'

interface MediaThumbProps {
  asset: MediaAsset
  /** Show the file-type badge (PNG, MP4…) in the bottom-right corner. */
  badge?: boolean
}

/**
 * The inside of any media preview box: the thumbnail (or a placeholder
 * glyph while a video's poster frame is still being made) plus a file-type
 * badge, so you can tell a still from a video -- and a MOV from an MP4 --
 * at a glance. The parent box must be position: relative and sized.
 */
export default function MediaThumb({ asset, badge = true }: MediaThumbProps) {
  const unplayable = asset.kind === 'video' && asset.playable === false
  return (
    <>
      {hasPreview(asset) ? (
        <img
          className="media-thumb-img"
          src={thumbnailUrl(asset.id)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      ) : (
        <span className="media-thumb-fallback" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="16" height="16">
            <rect
              x="1.5"
              y="3"
              width="13"
              height="10"
              rx="2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <path d="M6.5 6v4l3.5-2z" fill="currentColor" />
          </svg>
        </span>
      )}
      {badge && (
        <span
          className={`media-badge${asset.kind === 'video' ? ' video' : ''}${unplayable ? ' unplayable' : ''}`}
          title={unplayable ? 'This video can’t be played here' : undefined}
        >
          {asset.kind === 'video' && (
            <svg viewBox="0 0 8 8" width="6" height="6" aria-hidden="true">
              <path d="M1.5 1v6l5-3z" fill="currentColor" />
            </svg>
          )}
          {formatLabel(asset)}
        </span>
      )}
    </>
  )
}
