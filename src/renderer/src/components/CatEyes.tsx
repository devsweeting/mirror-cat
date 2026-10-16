/**
 * Cat's eyes -- the one signature element. Split cyan/magenta (a nod to
 * the chromatic fringing at the edge of a projected image), glowing like
 * eyeshine in a dark room, with a slow blink. These two colors appear
 * nowhere else in the UI.
 *
 * - idle: soft glow, an occasional blink
 * - working: Cat is generating; pupils widen and the glow breathes
 * - live: the projector is on; full, steady glow
 *
 * This is the only ambient motion in the app; everything else stays still.
 */
export type CatMood = 'idle' | 'working' | 'live'

interface CatEyesProps {
  /** Rendered width in px; height is half of it. */
  size?: number
  mood?: CatMood
}

export default function CatEyes({ size = 24, mood = 'idle' }: CatEyesProps) {
  return (
    <svg
      className={`cat-eyes ${mood}`}
      width={size}
      height={size / 2}
      viewBox="0 0 24 12"
      aria-hidden="true"
    >
      <g transform="rotate(-14 5.5 6)">
        <g className="eye eye-left">
          <path className="iris" d="M0.8 6 Q5.5 -2.6 10.2 6 Q5.5 14.6 0.8 6 Z" />
          <ellipse className="pupil" cx="5.5" cy="6" rx="1" ry="3.4" />
        </g>
      </g>
      <g transform="rotate(14 18.5 6)">
        <g className="eye eye-right">
          <path className="iris" d="M13.8 6 Q18.5 -2.6 23.2 6 Q18.5 14.6 13.8 6 Z" />
          <ellipse className="pupil" cx="18.5" cy="6" rx="1" ry="3.4" />
        </g>
      </g>
    </svg>
  )
}
