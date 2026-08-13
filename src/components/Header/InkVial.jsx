import { useEffect, useRef } from "react";

import { WaveField } from "../../utils/waveField";
import { smoothPath } from "../../utils/svgPath";

// A real liquid column, not a spring-scaled rectangle — the same
// hand-verified 2D wave equation solver NoteConstellation's own ink pool
// and FluidVisualizer already run, just at vial scale: a narrow, mostly
// 1D field (VIAL_ROWS is the minimum that still gives one real interior
// row) whose height samples across x become the surface's own wavy top
// edge. `height` (how full the vial is) is a plain, separately-owned
// number — the wave field only ever perturbs THAT baseline, it never
// carries the fill level itself, the same separation of "how much" from
// "how it moves" utils/waveField.js's own module comment draws between
// itself and utils/sph.js.
const VIAL_COLS = 8;
const VIAL_ROWS = 3;
const VIAL_CELL = 3;
const VIAL_WAVE_SPEED = 40;
const VIAL_DAMPING = 0.94;
const VIAL_WIDTH = 18;   // matches the old .ink-bar's own fixed width
const VIAL_HEIGHT = 64;  // matches the old bar's own max height (8 + 56)
const VIAL_AMPLITUDE = 5; // px of visible ripple at the surface
const VIAL_OPEN_SPLASH = 0.6;   // struck once, every time the popover opens
const VIAL_COUNT_SPLASH = 0.35; // per note gained or lost, capped below

const InkVial = ({ count, height, colorName, open, reduceMotion }) => {
  const waveRef = useRef(null);
  const pathRef = useRef(null);
  const prevCountRef = useRef(count);
  const prevOpenRef = useRef(false);
  const rafRef = useRef(null);

  if (!waveRef.current) {
    waveRef.current = new WaveField(VIAL_COLS, VIAL_ROWS, VIAL_CELL, { waveSpeed: VIAL_WAVE_SPEED, damping: VIAL_DAMPING });
  }

  // Struck once on open — a small standing-wave strike (exciteMode, the
  // same "hit like a bell" this vial is genuinely small and closed enough
  // to actually be), not a localized splat: there's no meaningful "where"
  // on a column this narrow.
  useEffect(() => {
    if (open && !prevOpenRef.current && !reduceMotion) {
      waveRef.current.exciteMode(1, 1, VIAL_OPEN_SPLASH);
    }
    prevOpenRef.current = open;
  }, [open, reduceMotion]);

  // Struck again whenever this color's own count actually changes — a
  // note joining or leaving the color visibly disturbs its own vial,
  // capped so a bulk operation (clearing the whole desk into one color)
  // can't ring it far past what still reads as a level, not a fountain.
  useEffect(() => {
    const delta = count - prevCountRef.current;
    prevCountRef.current = count;
    if (delta !== 0 && !reduceMotion) {
      waveRef.current.exciteMode(1, 1, Math.min(1.2, Math.abs(delta) * VIAL_COUNT_SPLASH));
    }
  }, [count, reduceMotion]);

  // The live ripple — only while the popover is actually open, the same
  // "don't animate what nobody can see" discipline every continuous loop
  // in this app already keeps.
  useEffect(() => {
    if (!open || reduceMotion) return undefined;

    let lastT = performance.now();
    const tick = (now) => {
      rafRef.current = requestAnimationFrame(tick);
      const dt = Math.min(0.032, (now - lastT) / 1000);
      lastT = now;

      const wave = waveRef.current;
      wave.step(dt);

      const baseline = VIAL_HEIGHT - height;
      const points = [];
      for (let i = 0; i < VIAL_COLS; i++) {
        const h = wave.height[VIAL_COLS + i]; // row 1 — the field's one real interior row
        points.push({ x: (i / (VIAL_COLS - 1)) * VIAL_WIDTH, y: baseline - h * VIAL_AMPLITUDE });
      }

      if (pathRef.current) {
        pathRef.current.setAttribute("d", `${ smoothPath(points) } L ${ VIAL_WIDTH } ${ VIAL_HEIGHT } L 0 ${ VIAL_HEIGHT } Z`);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [open, reduceMotion, height]);

  // The flat fallback (reduced motion, or simply before the loop above
  // ever draws a first frame) — the exact rectangle the old plain
  // .ink-bar rendered, so there's a correct shape on screen even with the
  // wave never once stepped.
  const flatPath = `M 0 ${ VIAL_HEIGHT - height } L ${ VIAL_WIDTH } ${ VIAL_HEIGHT - height } L ${ VIAL_WIDTH } ${ VIAL_HEIGHT } L 0 ${ VIAL_HEIGHT } Z`;

  return (
    <svg className="ink-vial" width={ VIAL_WIDTH } height={ VIAL_HEIGHT } viewBox={ `0 0 ${ VIAL_WIDTH } ${ VIAL_HEIGHT }` } aria-hidden="true">
      <path ref={ pathRef } className={ `ink-vial-fill ${ colorName }-bg` } d={ flatPath } />
    </svg>
  );
};

export default InkVial;
