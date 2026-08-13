import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

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
//
// Those two halves are now actually COUPLED rather than merely coexisting:
// the baseline no longer snaps to whatever `height` says, it rides its own
// damped spring toward it (see FILL_* below), and that spring's own
// acceleration is injected into the wave field every step — real liquid in
// a container that's being filled doesn't just rise, it sloshes on the way,
// and it sloshes because the bulk is accelerating, not on a timer.
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

// The fill level's own spring — deliberately underdamped (ω = √90 ≈ 9.5
// rad/s, ζ = 9/(2·9.5) ≈ 0.47), so a level change overshoots and settles
// rather than easing flatly into place, the same jelly character every
// other spring on this desk already reads as.
const FILL_STIFFNESS = 90;
const FILL_DAMPING = 9;

// How hard the bulk's own acceleration drives the surface (see the tick
// loop) — a container being filled fast sloshes; one already settled at
// its level doesn't, because its acceleration is zero. Clamped so a huge
// jump (a decant emptying one whole color into another) still reads as a
// level rather than a fountain.
const SLOSH_COUPLING = 0.00009;
const SLOSH_MAX = 0.9;

// Capillary rise — real liquid in a narrow tube climbs its walls, the
// meniscus decaying inward over the capillary length (Jurin's law's own
// exponential wall profile). At this tube's width the two walls' profiles
// genuinely overlap in the middle, which is exactly why a vial this narrow
// reads as visibly concave rather than flat.
const MENISCUS_RISE = 2.6;  // px the surface climbs right at each wall
const MENISCUS_LAMBDA = 4;  // px — how far in that climb decays

const InkVial = forwardRef(({ count, height, colorName, open, reduceMotion, riseDelay = 0 }, ref) => {
  const waveRef = useRef(null);
  const pathRef = useRef(null);
  const prevCountRef = useRef(count);
  const prevOpenRef = useRef(false);
  const rafRef = useRef(null);

  // The bulk fill's own spring state (see FILL_*) — level is where the
  // surface actually sits right now, which is only equal to the `height`
  // prop once it has finished settling there.
  const fillRef = useRef({ level: 0, vel: 0 });
  const heightRef = useRef(height);
  heightRef.current = height;
  // Held at empty until the panel's own staggered rise reaches this vial
  // (see riseDelay) — set the moment `open` flips true.
  const riseAtRef = useRef(0);

  if (!waveRef.current) {
    waveRef.current = new WaveField(VIAL_COLS, VIAL_ROWS, VIAL_CELL, { waveSpeed: VIAL_WAVE_SPEED, damping: VIAL_DAMPING });
  }

  // Lets InkLevelsPanel strike this vial from outside its own count/open
  // reactions — the connected-tube splash propagation to a neighbor, and
  // the milestone cascade, both need to excite a vial for a reason that
  // has nothing to do with ITS OWN count changing. Purely additive: the
  // two effects below still own every strike that's actually about this
  // vial's own count/open transitions, exactly as before.
  useImperativeHandle(ref, () => ({
    strike(amount) {
      if (!reduceMotion) waveRef.current.exciteMode(1, 1, amount);
    },
  }), [reduceMotion]);

  // Struck once on open — a small standing-wave strike (exciteMode, the
  // same "hit like a bell" this vial is genuinely small and closed enough
  // to actually be), not a localized splat: there's no meaningful "where"
  // on a column this narrow. Opening also resets the fill to empty so the
  // panel's own entrance is a real pour-in (see the tick loop's spring)
  // rather than the scaleY squash this used to ride, which stretched the
  // whole SVG — ripple and all — instead of actually raising a level.
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      if (!reduceMotion) {
        fillRef.current = { level: 0, vel: 0 };
        riseAtRef.current = performance.now() + riseDelay;
        // Discard whatever the field accumulated while nobody was
        // watching. step() only ever runs while the panel is open, so any
        // strike landing during a closed stretch (a note poured onto the
        // desk still moves this color's count, and the panel's own
        // neighbour-splash can reach this vial too) just sat in `height`
        // undamped — without this, reopening after a busy session would
        // release every one of them at once as a single violent lurch
        // rather than the small greeting splash below.
        waveRef.current.height.fill(0);
        waveRef.current.prevHeight.fill(0);
        waveRef.current.exciteMode(1, 1, VIAL_OPEN_SPLASH);
      } else {
        fillRef.current = { level: height, vel: 0 };
      }
    }
    prevOpenRef.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const fill = fillRef.current;

      // The bulk's own damped spring toward the level `height` asks for,
      // held at empty until this vial's own turn in the staggered rise.
      const target = now < riseAtRef.current ? 0 : heightRef.current;
      const accel = (target - fill.level) * FILL_STIFFNESS - fill.vel * FILL_DAMPING;
      fill.vel += accel * dt;
      fill.level += fill.vel * dt;

      // Two-way coupling, the half this file never had: the bulk pushes
      // the surface. A container whose contents are accelerating sloshes
      // (and sloshes AGAINST the acceleration, hence the negative sign);
      // one already settled at its level has zero acceleration and so
      // stays glassy on its own, with no separate "stop sloshing" rule
      // needed anywhere.
      const slosh = Math.max(-SLOSH_MAX, Math.min(SLOSH_MAX, -accel * SLOSH_COUPLING));
      if (Math.abs(slosh) > 0.0005) wave.exciteMode(1, 1, slosh);

      wave.step(dt);

      const baseline = VIAL_HEIGHT - fill.level;
      const points = [];
      for (let i = 0; i < VIAL_COLS; i++) {
        const x = (i / (VIAL_COLS - 1)) * VIAL_WIDTH;
        const h = wave.height[VIAL_COLS + i]; // row 1 — the field's one real interior row
        // Capillary rise at both walls (see MENISCUS_*) — subtracted
        // because SVG y runs downward, so climbing the glass is a smaller
        // y, not a larger one.
        const meniscus = MENISCUS_RISE * (Math.exp(-x / MENISCUS_LAMBDA) + Math.exp(-(VIAL_WIDTH - x) / MENISCUS_LAMBDA));
        points.push({ x, y: baseline - h * VIAL_AMPLITUDE - meniscus });
      }

      if (pathRef.current) {
        pathRef.current.setAttribute("d", `${ smoothPath(points) } L ${ VIAL_WIDTH } ${ VIAL_HEIGHT } L 0 ${ VIAL_HEIGHT } Z`);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [open, reduceMotion]);

  // The flat fallback (reduced motion, or simply before the loop above
  // ever draws a first frame) — the exact rectangle the old plain
  // .ink-bar rendered, so there's a correct shape on screen even with the
  // wave never once stepped.
  const flatPath = `M 0 ${ VIAL_HEIGHT - height } L ${ VIAL_WIDTH } ${ VIAL_HEIGHT - height } L ${ VIAL_WIDTH } ${ VIAL_HEIGHT } L 0 ${ VIAL_HEIGHT } Z`;

  return (
    <svg className="ink-vial" width={ VIAL_WIDTH } height={ VIAL_HEIGHT } viewBox={ `0 0 ${ VIAL_WIDTH } ${ VIAL_HEIGHT }` } aria-hidden="true">
      {/* The tube itself — this vial never actually drew a container
          before, only its contents, which is what left the meniscus above
          with no glass to climb. Kept deliberately faint: it reads as the
          edge of a vessel, not as UI chrome competing with the ink. */}
      <rect
        className="ink-vial-glass"
        x=".5" y=".5"
        width={ VIAL_WIDTH - 1 } height={ VIAL_HEIGHT - 1 }
        rx={ VIAL_WIDTH / 2 - .5 }
      />
      <path ref={ pathRef } className={ `ink-vial-fill ${ colorName }-bg` } d={ flatPath } />
      {/* The specular stripe every cylinder of glass carries down its own
          near side — drawn OVER the fill (a highlight sits on the glass,
          in front of whatever is behind it), and narrow/faint enough to
          read as a sheen rather than a second liquid. */}
      <rect
        className="ink-vial-shine"
        x="3.2" y="4"
        width="2.4" height={ VIAL_HEIGHT - 10 }
        rx="1.2"
      />
    </svg>
  );
});

export default InkVial;
