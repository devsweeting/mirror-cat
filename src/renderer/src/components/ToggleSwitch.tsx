interface ToggleSwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Accessible name, e.g. "Alignment grid". */
  label: string
  title?: string
  offLabel?: string
  onLabel?: string
}

/**
 * An on/off setting drawn like the app's segmented controls (Off | On) but
 * behaving as one switch: the whole control is a single button, so a click
 * anywhere on it flips the setting, and the highlight slides to the new
 * side. Space / Enter toggle it from the keyboard.
 */
export default function ToggleSwitch({
  checked,
  onChange,
  label,
  title,
  offLabel = 'Off',
  onLabel = 'On'
}: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      className="toggle-switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-switch-thumb" aria-hidden="true" />
      <span className="toggle-switch-label" data-side="off" aria-hidden="true">
        {offLabel}
      </span>
      <span className="toggle-switch-label" data-side="on" aria-hidden="true">
        {onLabel}
      </span>
    </button>
  )
}
