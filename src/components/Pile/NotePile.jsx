import React, { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import Matter from "matter-js";
import { FaArrowRotateLeft } from "react-icons/fa6";

import "./NotePile.css";

const GRAVITY = 1;
const PIECE_W = 132;
const PIECE_H = 100;
const CLICK_THRESHOLD = 6;     // px of movement under which a press counts as "open", not "toss"
const DROP_STAGGER_MS = 26;

// Toss the whole (filtered) desk into a real, physically-simulated pile —
// matter-js applied to live notes instead of Trash/TrashPhysics's falling
// debris. Bodies are plain absolutely-positioned <div>s whose transform is
// written straight to style every tick (no React re-render per physics
// step), the same imperative-driver discipline TrashPhysics already uses;
// the difference here is each piece stays clickable (opens the real note)
// and draggable (a real Matter.MouseConstraint lets you fling pieces
// around), so a press is only ever "open" once it's clear the pointer
// barely moved — otherwise it was a toss, and physics keeps it.
const NotePile = ({ notes, onOpenNote, onExit }) => {
  const containerRef = useRef(null);
  const engineRef = useRef(null);
  const bodiesRef = useRef({});     // id -> { body, el }
  const wallsRef = useRef(null);
  const elRefs = useRef({});

  // Whichever a press turns out to be — the click's own onClick fires right
  // after pointerup regardless of how far the piece was dragged, so this is
  // the one flag standing between "that was a toss" and "open the note."
  // Left false covers keyboard activation too, since Enter/Space never runs
  // a pointerdown/pointerup pair to set it in the first place.
  const suppressClickRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const engine = Matter.Engine.create({ gravity: { x: 0, y: GRAVITY } });
    engineRef.current = engine;

    const buildWalls = () => {
      const rect = container.getBoundingClientRect();
      if (wallsRef.current) Matter.World.remove(engine.world, Object.values(wallsRef.current));

      const thickness = 60;
      const floor = Matter.Bodies.rectangle(
        rect.width / 2, rect.height + thickness / 2 - 4, rect.width + thickness * 2, thickness,
        { isStatic: true, restitution: .3, friction: .7 },
      );
      const left = Matter.Bodies.rectangle(
        -thickness / 2, rect.height / 2, thickness, rect.height * 3,
        { isStatic: true, restitution: .3 },
      );
      const right = Matter.Bodies.rectangle(
        rect.width + thickness / 2, rect.height / 2, thickness, rect.height * 3,
        { isStatic: true, restitution: .3 },
      );

      wallsRef.current = { floor, left, right };
      Matter.World.add(engine.world, [floor, left, right]);
    };
    buildWalls();

    const mouse = Matter.Mouse.create(container);
    const mouseConstraint = Matter.MouseConstraint.create(engine, {
      mouse,
      constraint: { stiffness: .2, damping: .15, render: { visible: false } },
    });
    Matter.World.add(engine.world, mouseConstraint);

    let raf = requestAnimationFrame(tick);

    function tick() {
      raf = requestAnimationFrame(tick);
      Matter.Engine.update(engine, 1000 / 60);

      for (const { body, el } of Object.values(bodiesRef.current)) {
        el.style.transform =
          `translate(${ body.position.x }px, ${ body.position.y }px) translate(-50%, -50%) rotate(${ body.angle }rad)`;
      }
    }

    const handleResize = () => buildWalls();
    window.addEventListener("resize", handleResize);

    const staggerTimers = notes.map((note, index) => window.setTimeout(() => {
      const el = elRefs.current[note.id];
      if (!el || !engineRef.current) return;

      const rect = container.getBoundingClientRect();
      const x = Math.min(rect.width - PIECE_W, Math.max(PIECE_W, Math.random() * rect.width));
      const y = -80 - Math.random() * 220;

      const body = Matter.Bodies.rectangle(x, y, PIECE_W * (.9 + Math.random() * .2), PIECE_H * (.9 + Math.random() * .2), {
        restitution: .4,
        friction: .45,
        frictionAir: .01,
        angle: (Math.random() - .5) * .5,
      });
      Matter.Body.setAngularVelocity(body, (Math.random() - .5) * .25);
      Matter.Body.setVelocity(body, { x: (Math.random() - .5) * 3, y: 2 + Math.random() * 2 });

      Matter.World.add(engine.world, body);
      bodiesRef.current[note.id] = { body, el };
      el.style.opacity = "1";
    }, index * DROP_STAGGER_MS));

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", handleResize);
      staggerTimers.forEach((timer) => window.clearTimeout(timer));
      Matter.World.clear(engine.world, false);
      Matter.Engine.clear(engine);
      engineRef.current = null;
      bodiesRef.current = {};
      wallsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePieceDown = (e) => {
    const startX = e.clientX;
    const startY = e.clientY;

    const handlePointerUp = (upEvent) => {
      window.removeEventListener("pointerup", handlePointerUp);
      const dist = Math.hypot(upEvent.clientX - startX, upEvent.clientY - startY);
      suppressClickRef.current = dist >= CLICK_THRESHOLD;
    };

    window.addEventListener("pointerup", handlePointerUp);
  };

  const handlePieceClick = (id) => () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onOpenNote?.(id);
  };

  return (
    <motion.div
      className="pile-layer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: .25 } }}
    >
      <motion.button
        type="button"
        className="pile-exit"
        initial={{ opacity: 0, translateY: -10 }}
        animate={{ opacity: 1, translateY: 0 }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: .94 }}
        transition={{ type: "spring", stiffness: 380, damping: 18, delay: .3 }}
        onClick={ onExit }
      >
        <FaArrowRotateLeft className="pile-exit-icon" />
        Restore the grid
      </motion.button>
      <div ref={ containerRef } className="pile-stage">
        {
          notes.map((note) => (
            <button
              key={ note.id }
              type="button"
              ref={ (el) => {
                if (el) {
                  el.style.opacity = "0";
                  elRefs.current[note.id] = el;
                } else {
                  delete elRefs.current[note.id];
                }
              } }
              className={ `pile-piece ${ note.color }-bg` }
              style={{ width: PIECE_W, height: PIECE_H }}
              aria-label={ `Open ${ note.title?.trim() || "untitled note" }` }
              onPointerDown={ handlePieceDown }
              onClick={ handlePieceClick(note.id) }
            >
              <span className="pile-piece-title">{ note.title?.trim() || "Untitled" }</span>
              <span className="pile-piece-text">{ note.text }</span>
            </button>
          ))
        }
      </div>
    </motion.div>
  );
};

export default NotePile;
