import { forwardRef, useImperativeHandle, useRef } from "react";
import { createPortal } from "react-dom";
import Matter from "matter-js";

import { curlNoise2 } from "../../utils/noise";

import "./FilterScatter.css";

// Clearing the filters sweeps the color row physically clean — the same
// real matter-js toss NotePile.jsx already established for scattering a
// whole desk (fresh engine, one floor, real restitution/friction, plain
// absolutely-positioned spans driven by a raw rAF loop rather than a
// React re-render per tick), reused here at a much smaller scale and for
// a single one-shot burst rather than a standing pile. Deliberately
// layered ON TOP of the real, unaffected .color-filter row rather than
// hiding it first: those seven squares never actually change appearance
// from clearing (only the active ring does), so what actually reads here
// is the color's own ink lifting off the clean squares underneath and
// scattering away — not a duplicate glitch.
const GRAVITY = 1.3;
const TOSS_DURATION = 1100;
const FADE_SPAN = 300; // ms, the tail end of TOSS_DURATION spent fading out
const RESTITUTION = 0.5;
const KICK_VX = 10;
const KICK_VY_MIN = 4;
const KICK_VY_SPAN = 4;

// The clear button's own real drag-release velocity (see Header.jsx's
// onDragEnd, framer's info.velocity — px/s in screen space), rescaled into
// matter's own px/frame-ish units and clamped so an enthusiastic flick
// throws the row noticeably harder/further without ever overpowering the
// floor/restitution tuning above. A plain tap still passes no fling at
// all, so it keeps today's gentle default kick untouched.
const FLING_TO_MATTER = 1 / 60;
const FLING_MAX_VX = 26;
const FLING_MAX_VY = 22;

// A gentle divergence-free gust (see utils/noise.js's curlNoise2 — the
// exact same construction NoteConstellation's own ambient current already
// runs) applied as a real per-frame force on every airborne chip, so the
// toss isn't just gravity plus an initial kick: the row drifts and curls
// through a shared little breeze on its way down, the same way a handful
// of real paper scraps never falls in perfectly straight arcs.
const TURBULENCE_SPATIAL_SCALE = 0.006;
const TURBULENCE_TIME_SCALE = 0.0011;
const TURBULENCE_STRENGTH = 0.00016;

// The velocity smear (see the tick loop below) — the same "elongate along
// the direction of travel, volume-conserving" recipe QuickDock's own trail
// blob already applies to a hover sweep, read here off each chip's real
// matter velocity every frame instead of a framer layoutId jump. Below
// SMEAR_MIN_SPEED a chip just tumbles on its own body.angle, same as
// before; above it, the stretch axis blends toward the velocity heading so
// a fast chip reads as flicked ink rather than a rigid spinning square.
const SMEAR_MIN_SPEED = 3;
const SMEAR_MAX_STRETCH = 2.1;
const SMEAR_SPEED_DIVISOR = 11;

// The wind-up (see the setTimeout below): every clone spawns at its real
// chip position, then spends this long compressing toward the row's own
// center before the physics/turbulence/velocity ever engage — the same
// "gathering before it lets go" beat QuickDock's own retract already
// documents, borrowed here for the opposite direction (a gather-then-throw
// instead of a gather-then-collapse).
const ANTICIPATE_MS = 70;
const ANTICIPATE_PULL = 0.22;
const ANTICIPATE_SQUEEZE = 0.86;

const FilterScatter = forwardRef((_, ref) => {
  const layerRef = useRef(null);

  useImperativeHandle(ref, () => ({
    // chips: [{ x, y, size, color }] — page-space centers (getBoundingClientRect,
    // no scroll adjustment needed since these are always near the fixed
    // header) and each chip's own CSS color value. fling: null for a plain
    // tap, or { x, y } — framer's own drag-release velocity in px/s — for a
    // real flick (see Header.jsx's onDragEnd).
    scatter(chips, fling) {
      const layer = layerRef.current;
      if (!layer || chips.length === 0) return;

      const engine = Matter.Engine.create({ gravity: { x: 0, y: GRAVITY } });
      const thickness = 200;
      const floor = Matter.Bodies.rectangle(
        window.innerWidth / 2, window.innerHeight + thickness / 2, window.innerWidth + thickness * 2, thickness,
        { isStatic: true, restitution: RESTITUTION },
      );
      Matter.World.add(engine.world, [floor]);

      const centerX = chips.reduce((sum, chip) => sum + chip.x, 0) / chips.length;
      const centerY = chips.reduce((sum, chip) => sum + chip.y, 0) / chips.length;

      const flingVX = fling ? Math.max(-FLING_MAX_VX, Math.min(FLING_MAX_VX, fling.x * FLING_TO_MATTER)) : 0;
      const flingVY = fling ? Math.max(-FLING_MAX_VY, Math.min(FLING_MAX_VY, fling.y * FLING_TO_MATTER)) : 0;

      const bodies = chips.map((chip) => {
        const body = Matter.Bodies.rectangle(chip.x, chip.y, chip.size, chip.size, {
          restitution: RESTITUTION,
          friction: .4,
          frictionAir: .015,
          chamfer: { radius: 4 },
        });
        // Added to the world immediately but not yet simulated — Engine.update
        // only runs once the tick loop starts below, so the anticipation beat
        // plays as a pure CSS transform first, untouched by gravity.
        Matter.World.add(engine.world, body);

        const el = document.createElement("span");
        el.className = "filter-scatter-chip";
        el.style.width = `${ chip.size }px`;
        el.style.height = `${ chip.size }px`;
        el.style.backgroundColor = chip.color;
        el.style.transform = `translate(${ chip.x }px, ${ chip.y }px) translate(-50%, -50%)`;
        el.style.transition = `transform ${ ANTICIPATE_MS }ms cubic-bezier(.3, 0, .7, 1)`;
        layer.appendChild(el);

        return { body, el, chip };
      });

      // Next frame so the browser registers the spawn transform above before
      // the transition target changes — otherwise it'd have nothing to
      // animate from and would just snap straight to the compressed pose.
      requestAnimationFrame(() => {
        for (const { el, chip } of bodies) {
          const pullX = (centerX - chip.x) * ANTICIPATE_PULL;
          const pullY = (centerY - chip.y) * ANTICIPATE_PULL;
          el.style.transform = `translate(${ chip.x + pullX }px, ${ chip.y + pullY }px) translate(-50%, -50%) scale(${ ANTICIPATE_SQUEEZE })`;
        }
      });

      setTimeout(() => {
        for (const { body } of bodies) {
          const baseVY = -(KICK_VY_MIN + Math.random() * KICK_VY_SPAN);
          Matter.Body.setVelocity(body, {
            x: (Math.random() - .5) * KICK_VX + flingVX,
            // Never softened below the default upward kick — Math.min picks
            // whichever is more negative (stronger upward), so a downward
            // flingVY is simply ignored while an upward one (already
            // negative) only ever adds more lift.
            y: Math.min(baseVY, baseVY + flingVY),
          });
          Matter.Body.setAngularVelocity(body, (Math.random() - .5) * .5);
        }

        for (const { el } of bodies) {
          el.style.transition = "";
        }

        const start = performance.now();
        const tick = () => {
          Matter.Engine.update(engine, 1000 / 60);
          const age = performance.now() - start;
          const t = age * TURBULENCE_TIME_SCALE;

          for (const { body, el } of bodies) {
            const gust = curlNoise2(body.position.x * TURBULENCE_SPATIAL_SCALE, body.position.y * TURBULENCE_SPATIAL_SCALE, t);
            Matter.Body.applyForce(body, body.position, {
              x: gust.x * TURBULENCE_STRENGTH,
              y: gust.y * TURBULENCE_STRENGTH,
            });

            const speed = Math.hypot(body.velocity.x, body.velocity.y);
            const stretchAmount = speed > SMEAR_MIN_SPEED
              ? Math.min(SMEAR_MAX_STRETCH, 1 + (speed - SMEAR_MIN_SPEED) / SMEAR_SPEED_DIVISOR)
              : 1;
            const blend = (stretchAmount - 1) / (SMEAR_MAX_STRETCH - 1);
            const velocityAngle = Math.atan2(body.velocity.y, body.velocity.x);
            // Below SMEAR_MIN_SPEED this is just body.angle (tumble as
            // before); as speed climbs, the drawn angle eases toward the
            // heading of travel so the elongation actually points where the
            // chip is going instead of stretching across its own tumble.
            const drawAngle = body.angle + (velocityAngle - body.angle) * blend;
            const squash = 1 / Math.sqrt(stretchAmount);

            el.style.transform = `translate(${ body.position.x }px, ${ body.position.y }px) translate(-50%, -50%) `
              + `rotate(${ drawAngle }rad) scale(${ stretchAmount }, ${ squash })`;

            if (age > TOSS_DURATION - FADE_SPAN) {
              el.style.opacity = String(Math.max(0, 1 - (age - (TOSS_DURATION - FADE_SPAN)) / FADE_SPAN));
            }
          }

          if (age < TOSS_DURATION) {
            requestAnimationFrame(tick);
            return;
          }

          bodies.forEach(({ el }) => el.remove());
          Matter.World.clear(engine.world, false);
          Matter.Engine.clear(engine);
        };
        requestAnimationFrame(tick);
      }, ANTICIPATE_MS);
    },
  }));

  return createPortal(
    <div ref={ layerRef } className="filter-scatter-layer" aria-hidden="true" />,
    document.body,
  );
});

export default FilterScatter;
