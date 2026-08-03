// The handful of things both custom cursors (CursorAura's WebGL comet,
// CursorDot's ink-chain pen) needed identically — everything else about
// them (a fragment shader vs. an SVG path, ripples vs. a wrap/caret morph)
// is genuinely different rendering, not the same logic twice, so only
// this much is actually shared.

// Frame-rate independent decay: raise (1-k) to dt*60 rather than just
// multiplying by dt, so a value eased at 60Hz and one eased at 144Hz reach
// the same place in the same wall-clock time instead of the faster
// display just taking more, smaller steps toward it.
export const frameEase = (k, dt) => 1 - Math.pow(1 - k, dt * 60);

// Neither custom cursor makes sense without a mouse, or for anyone who's
// asked for less motion — both fall back to the OS cursor in either case.
export const prefersNativeCursor = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
  window.matchMedia("(pointer: coarse)").matches;
