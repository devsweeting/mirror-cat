// Small inline UI icons, drawn in currentColor so they follow the text color.

/** Four tiles: the media library. */
export function LibraryIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect
        x="2"
        y="2"
        width="5"
        height="5"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <rect
        x="9"
        y="2"
        width="5"
        height="5"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <rect
        x="2"
        y="9"
        width="5"
        height="5"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <rect
        x="9"
        y="9"
        width="5"
        height="5"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  )
}

/** A projector on little feet. */
export function ProjectorIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <rect
        x="1.5"
        y="4.5"
        width="13"
        height="7"
        rx="1.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <circle cx="10.5" cy="8" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M4 11.5v1.5M12 11.5v1.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** A gear: Settings. */
export function SettingsIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7L3.6 3.6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="8" cy="8" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}
