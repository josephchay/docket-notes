import { forwardRef, useImperativeHandle, useRef } from "react";
import { createPortal } from "react-dom";
import Matter from "matter-js";

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

const FilterScatter = forwardRef((_, ref) => {
  const layerRef = useRef(null);

  useImperativeHandle(ref, () => ({
    // chips: [{ x, y, size, color }] — page-space centers (getBoundingClientRect,
    // no scroll adjustment needed since these are always near the fixed
    // header) and each chip's own CSS color value.
    scatter(chips) {
      const layer = layerRef.current;
      if (!layer || chips.length === 0) return;

      const engine = Matter.Engine.create({ gravity: { x: 0, y: GRAVITY } });
      const thickness = 200;
      const floor = Matter.Bodies.rectangle(
        window.innerWidth / 2, window.innerHeight + thickness / 2, window.innerWidth + thickness * 2, thickness,
        { isStatic: true, restitution: RESTITUTION },
      );
      Matter.World.add(engine.world, [floor]);

      const bodies = chips.map((chip) => {
        const body = Matter.Bodies.rectangle(chip.x, chip.y, chip.size, chip.size, {
          restitution: RESTITUTION,
          friction: .4,
          frictionAir: .015,
          chamfer: { radius: 4 },
        });
        Matter.Body.setVelocity(body, { x: (Math.random() - .5) * KICK_VX, y: -(KICK_VY_MIN + Math.random() * KICK_VY_SPAN) });
        Matter.Body.setAngularVelocity(body, (Math.random() - .5) * .5);
        Matter.World.add(engine.world, body);

        const el = document.createElement("span");
        el.className = "filter-scatter-chip";
        el.style.width = `${ chip.size }px`;
        el.style.height = `${ chip.size }px`;
        el.style.backgroundColor = chip.color;
        layer.appendChild(el);

        return { body, el };
      });

      const start = performance.now();
      const tick = () => {
        Matter.Engine.update(engine, 1000 / 60);
        const age = performance.now() - start;

        for (const { body, el } of bodies) {
          el.style.transform = `translate(${ body.position.x }px, ${ body.position.y }px) translate(-50%, -50%) rotate(${ body.angle }rad)`;
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
    },
  }));

  return createPortal(
    <div ref={ layerRef } className="filter-scatter-layer" aria-hidden="true" />,
    document.body,
  );
});

export default FilterScatter;
