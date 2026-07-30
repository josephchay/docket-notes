import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { createPortal } from "react-dom";
import Matter from "matter-js";

import "./TrashPhysics.css";

const GRAVITY = 1.15;
const SETTLE_HOLD_MS = 1200;  // how long a piece lingers, settled, before it starts fading
const FADE_MS = 420;
const MAX_BODIES = 70;        // trims the oldest once a big "empty trash" burst piles up

// A single shared Matter.js world, portaled to document.body so it always
// draws above the Trash panel regardless of any transform the panel or its
// ancestors carry — the same portal reasoning Note.jsx's radial menu
// already uses. TrashPanel.jsx calls drop() once per shredded item, right
// where that item's swatch sat in the list, and a small physics body takes
// the visual handoff from there: gravity, a floor and side walls sized to
// the panel's own current position, and collisions against whatever's
// already piled up. Bodies are plain absolutely-positioned <div>s whose
// transform is written directly to style each tick (no React re-render per
// physics step) — the same imperative-driver pattern QuickDock's magnetic
// quickTo tweens and InkGoo's per-frame uniforms already use elsewhere.
const TrashPhysics = forwardRef((_props, ref) => {
  const layerRef = useRef(null);
  const engineRef = useRef(null);
  const bodiesRef = useRef([]);   // { body, el, bornAt }
  const wallsRef = useRef(null);  // { floor, left, right }

  useEffect(() => {
    const engine = Matter.Engine.create({ gravity: { x: 0, y: GRAVITY } });
    engineRef.current = engine;

    let raf = requestAnimationFrame(tick);

    function tick() {
      raf = requestAnimationFrame(tick);
      Matter.Engine.update(engine, 1000 / 60);

      const now = performance.now();
      const survivors = [];

      for (const piece of bodiesRef.current) {
        const { body, el, bornAt } = piece;
        const age = now - bornAt;

        if (age > SETTLE_HOLD_MS + FADE_MS) {
          Matter.World.remove(engine.world, body);
          el.remove();
          continue;
        }

        el.style.transform =
          `translate(${ body.position.x }px, ${ body.position.y }px) translate(-50%, -50%) rotate(${ body.angle }rad)`;

        if (age > SETTLE_HOLD_MS) {
          el.style.opacity = String(Math.max(0, 1 - (age - SETTLE_HOLD_MS) / FADE_MS));
        }

        survivors.push(piece);
      }

      bodiesRef.current = survivors;
    }

    return () => {
      cancelAnimationFrame(raf);
      Matter.World.clear(engine.world, false);
      Matter.Engine.clear(engine);
      bodiesRef.current.forEach(({ el }) => el.remove());
      bodiesRef.current = [];
      wallsRef.current = null;
    };
  }, []);

  // A floor along the trash panel's current bottom edge and walls along its
  // sides, so dropped pieces tumble and pile up inside roughly where the
  // panel itself sits rather than scattering across the whole viewport.
  // Rebuilt each drop (cheap — three static bodies) since the panel can
  // reflow as items leave the list.
  const ensureWalls = (panelRect) => {
    const engine = engineRef.current;
    if (!engine) return;

    if (wallsRef.current) {
      Matter.World.remove(engine.world, Object.values(wallsRef.current));
    }

    const thickness = 40;
    const floor = Matter.Bodies.rectangle(
      panelRect.left + panelRect.width / 2,
      panelRect.bottom + thickness / 2 - 6,
      panelRect.width,
      thickness,
      { isStatic: true, restitution: .35, friction: .6 },
    );
    const left = Matter.Bodies.rectangle(
      panelRect.left - thickness / 2,
      panelRect.bottom - panelRect.height / 2,
      thickness,
      panelRect.height * 2,
      { isStatic: true, restitution: .3 },
    );
    const right = Matter.Bodies.rectangle(
      panelRect.right + thickness / 2,
      panelRect.bottom - panelRect.height / 2,
      thickness,
      panelRect.height * 2,
      { isStatic: true, restitution: .3 },
    );

    Matter.World.add(engine.world, [floor, left, right]);
    wallsRef.current = { floor, left, right };
  };

  useImperativeHandle(ref, () => ({
    drop({ x, y, width = 24, height = 24, color, panelRect }) {
      const engine = engineRef.current;
      const layer = layerRef.current;
      if (!engine || !layer) return;

      if (panelRect) ensureWalls(panelRect);

      const w = Math.max(14, Math.min(width, 40));
      const h = Math.max(14, Math.min(height, 40));

      const body = Matter.Bodies.rectangle(x, y, w, h, {
        restitution: .5,
        friction: .35,
        frictionAir: .012,
        angle: (Math.random() - .5) * .6,
      });
      Matter.Body.setAngularVelocity(body, (Math.random() - .5) * .3);
      Matter.Body.setVelocity(body, { x: (Math.random() - .5) * 2.4, y: 0 });
      Matter.World.add(engine.world, body);

      const el = document.createElement("span");
      el.className = `trash-physics-chip ${ color }-bg`;
      el.style.width = `${ w }px`;
      el.style.height = `${ h }px`;
      layer.appendChild(el);

      bodiesRef.current.push({ body, el, bornAt: performance.now() });

      if (bodiesRef.current.length > MAX_BODIES) {
        const oldest = bodiesRef.current.shift();
        Matter.World.remove(engine.world, oldest.body);
        oldest.el.remove();
      }
    },
  }), []);

  return createPortal(
    <div ref={ layerRef } className="trash-physics-layer" aria-hidden="true" />,
    document.body,
  );
});

export default TrashPhysics;
