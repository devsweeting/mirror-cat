/**
 * The one signature visual flourish in the design system: two ellipses,
 * split cyan/magenta, that blink slowly. Used anywhere the "Cat" AI
 * assistant is represented -- the topbar wordmark and the assistant panel.
 * Deliberately the *only* animated/branded element; everything else in
 * the UI stays quiet.
 */
export default function CatEyes({ size = 22 }: { size?: number }) {
  return (
    <span className="cat-eyes" style={{ width: size, height: size }} aria-hidden="true">
      <span />
      <span />
    </span>
  )
}
