import React, { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import Matter from "matter-js";
import { FaArrowRotateLeft } from "react-icons/fa6";

import { playImpact } from "../../utils/sound";
import { notePreviewText } from "../../utils/notePreview";

import "./NotePile.css";

const GRAVITY = 1;
const PIECE_W = 132;
const PIECE_H = 100;
const CLICK_THRESHOLD = 6;     // px of movement under which a press counts as "open", not "toss"
const DROP_STAGGER_MS = 26;

// Jelly squash-and-stretch: one scalar per piece, spring-driven toward 0
// (its resting, undeformed pose) every tick. Positive means "just got hit,
// squashed flat and bulging wide"; negative means "elongating, thin" — a
// fresh toss seeds it there, as if still falling, so the piece visibly
// stretches back to its resting paper shape as physics lands it, the same
// squash-and-stretch language Note.jsx's own spawn morph and delete blob
// already use elsewhere, just driven by this pile's real collision physics
// instead of a scripted keyframe sequence.
const SQUASH_STIFFNESS = 220;
const SQUASH_DAMPING = 12;
const MIN_IMPACT_SPEED = 2.2;        // px/tick below which a touch isn't a real "landing"
const IMPACT_SOUND_COOLDOWN_MS = 45; // keeps an avalanche of pieces from becoming a wall of noise

// Toss the whole (filtered) desk into a real, physically-simulated pile —
// matter-js applied to live notes instead of Trash/TrashPhysics's falling
// debris. Bodies are plain absolutely-positioned <div>s whose transform is
// written straight to style every tick (no React re-render per physics
// step), the same imperative-driver discipline TrashPhysics already uses;
// the difference here is each piece stays clickable (opens the real note)
// and draggable (a real Matter.MouseConstraint lets you fling pieces
// around), so a press is only ever "open" once it's clear the pointer
// barely moved — otherwise it was a toss, and physics keeps it.
//
// Two more things ride the same per-tick loop, both off numbers the engine
// is already computing rather than a second, separately-timed animation:
// a light paper flutter (a small skew keyed to each piece's own spin, so
// every piece wobbles on its own unrepeated phase) while a piece is still
// actually moving, and a shadow that grows and softens with real velocity
// — not static height, which would stay permanently large for anything
// sitting high in a settled pile — in place of the old fixed two-state
// (resting/dragging) shadow.
const NotePile = ({ notes, onOpenNote, onExit }) => {
  const containerRef = useRef(null);
  const engineRef = useRef(null);
  const bodiesRef = useRef({});     // id -> { body, el, squash, squashVel }
  const wallsRef = useRef(null);
  const elRefs = useRef({});
  const lastImpactSoundRef = useRef(0);

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

    // A piece lifts slightly (a bigger, closer shadow) for as long as it's
    // actively being dragged — real Matter drag events, independent of the
    // separate pointerdown/up pair further below (that one only ever
    // measures click-vs-toss distance and never touches any visuals).
    const handleStartDrag = (e) => {
      const piece = bodiesRef.current[e.body?.__pieceKey];
      if (piece) {
        piece.el.classList.add("dragging");
        // Hands the shadow back to the .dragging CSS rule — an inline
        // style always outranks a class regardless of which was written
        // more recently, so the per-tick airborne shadow below has to
        // actually let go of it, not just stop overwriting it.
        piece.el.style.boxShadow = "";
      }
    };
    const handleEndDrag = (e) => {
      const piece = bodiesRef.current[e.body?.__pieceKey];
      if (piece) piece.el.classList.remove("dragging");
    };
    Matter.Events.on(mouseConstraint, "startdrag", handleStartDrag);
    Matter.Events.on(mouseConstraint, "enddrag", handleEndDrag);

    // Every real landing — the floor, a wall, another piece — kicks that
    // piece's own squash spring, scaled by how fast it was actually
    // moving; the impact sound rides the same trigger, rate-limited so a
    // big avalanche of pieces settling at once doesn't turn into noise.
    const handleCollisionStart = (e) => {
      for (const pair of e.pairs) {
        for (const body of [pair.bodyA, pair.bodyB]) {
          const piece = bodiesRef.current[body.__pieceKey];
          if (!piece) continue;

          const speed = Math.hypot(body.velocity.x, body.velocity.y);
          if (speed < MIN_IMPACT_SPEED) continue;

          const strength = Math.min(1, speed / 14);
          piece.squashVel += strength * 1.6;

          const now = performance.now();
          if (now - lastImpactSoundRef.current > IMPACT_SOUND_COOLDOWN_MS) {
            lastImpactSoundRef.current = now;
            playImpact(strength);
          }
        }
      }
    };
    Matter.Events.on(engine, "collisionStart", handleCollisionStart);

    let raf = requestAnimationFrame(tick);

    // A gentle cohesion between same-colored pieces — the same 1/r pull
    // AmbientField.jsx's dust motes repel each other with, run in reverse
    // and gated to same color, rather than a new force law invented just
    // for this. Applied as a small, hard-capped velocity nudge each tick
    // rather than through Matter.Body.applyForce: matter-js's own force
    // integration scales by each body's mass and the engine's internal
    // gravity.scale, neither of which this can pin down without actually
    // running it, so setVelocity keeps the nudge exactly the magnitude
    // written here regardless of that scaling. Skipped above a piece count
    // where an O(n²) pass every tick would start costing real frame time —
    // a decorative flourish is allowed to just not run at that point rather
    // than risk the pile's own frame rate for it.
    const COHESION_RANGE = 160;
    const COHESION_STRENGTH = 0.012;
    const COHESION_MAX_NUDGE = 0.35;
    const COHESION_MAX_PIECES = 80;

    const applyCohesion = () => {
      const pieces = Object.values(bodiesRef.current);
      if (pieces.length > COHESION_MAX_PIECES) return;

      for (let i = 0; i < pieces.length; i++) {
        const a = pieces[i];
        if (a.el.classList.contains("dragging")) continue;
        // A piece that's essentially stopped doesn't go looking for a
        // same-color neighbor to creep toward — only pieces still actually
        // settling pull on others, so a pile at rest stays at rest rather
        // than slowly re-sorting itself forever.
        if (Math.hypot(a.body.velocity.x, a.body.velocity.y) < 0.05) continue;

        for (let j = i + 1; j < pieces.length; j++) {
          const b = pieces[j];
          if (a.color !== b.color || b.el.classList.contains("dragging")) continue;

          const dx = b.body.position.x - a.body.position.x;
          const dy = b.body.position.y - a.body.position.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 1 || dist > COHESION_RANGE) continue;

          const pull = Math.min(COHESION_MAX_NUDGE, COHESION_STRENGTH * (COHESION_RANGE / dist));
          const nx = (dx / dist) * pull;
          const ny = (dy / dist) * pull;

          Matter.Body.setVelocity(a.body, { x: a.body.velocity.x + nx, y: a.body.velocity.y + ny });
          Matter.Body.setVelocity(b.body, { x: b.body.velocity.x - nx, y: b.body.velocity.y - ny });
        }
      }
    };

    function tick() {
      raf = requestAnimationFrame(tick);
      applyCohesion();
      Matter.Engine.update(engine, 1000 / 60);

      const dt = 1 / 60;

      for (const piece of Object.values(bodiesRef.current)) {
        const { body, el } = piece;

        // A critically-underdamped spring pulling squash back toward 0 —
        // the brief overshoot past zero is what actually reads as jelly
        // rather than just a snap back to shape.
        piece.squashVel += (-SQUASH_STIFFNESS * piece.squash - SQUASH_DAMPING * piece.squashVel) * dt;
        piece.squash += piece.squashVel * dt;

        const squash = Math.max(-.9, Math.min(1.1, piece.squash));
        const scaleY = 1 - squash * .55;
        const scaleX = 1 + squash * .4;

        // How much this piece is actually still moving, normalized — not
        // its static height above the floor. Height alone would stay
        // permanently large for anything sitting high in a settled pile
        // (stacked on other pieces, not falling), giving it an oversized
        // shadow/flutter forever even at true rest; velocity is what
        // genuinely distinguishes "still falling" from "settled, just
        // elevated by the pile beneath it," and drops to 0 the instant a
        // piece actually stops, wherever in the stack that happens to be.
        const speed = Math.hypot(body.velocity.x, body.velocity.y);
        const airborne = Math.max(0, Math.min(1, speed / 6));

        // A light sheet of paper's own flutter through the air — a small
        // skew riding the piece's own spin (never a separate clock, so
        // every piece flutters on its own unrepeated phase), fading out
        // as it settles so a resting pile stays perfectly still rather
        // than idly wobbling forever.
        const flutter = Math.sin(body.angle * 3.2) * 3.5 * airborne;

        el.style.transform =
          `translate(${ body.position.x }px, ${ body.position.y }px) translate(-50%, -50%) rotate(${ body.angle }rad) skew(${ flutter }deg) scale(${ scaleX }, ${ scaleY })`;

        // The shadow itself grows, softens, and drifts further out the
        // higher a piece currently is — real airborne depth, off the same
        // data — then tightens back into a grounded contact shadow as it
        // settles. Dragging keeps its own fixed CSS lift (see .dragging
        // and handleStartDrag above) rather than fighting this per-frame.
        if (!el.classList.contains("dragging")) {
          const blur = 10 + airborne * 30;
          const spread = -10 - airborne * 6;
          const offsetY = 10 + airborne * 22;
          const alpha = .3 - airborne * .1;
          el.style.boxShadow =
            `0 1px 1px rgba(25, 25, 25, 0.05), 0 ${ offsetY }px ${ blur }px ${ spread }px rgba(25, 25, 25, ${ alpha })`;
        }
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
      body.__pieceKey = note.id;
      Matter.Body.setAngularVelocity(body, (Math.random() - .5) * .25);
      Matter.Body.setVelocity(body, { x: (Math.random() - .5) * 3, y: 2 + Math.random() * 2 });

      Matter.World.add(engine.world, body);
      // Seeded already stretched thin, as if mid-fall — the squash spring
      // above pulls it toward its resting shape the same way a real
      // landing does, so a fresh toss reads as one continuous piece of
      // physics rather than "drop, then separately animate in."
      bodiesRef.current[note.id] = { body, el, squash: -.55, squashVel: 0, color: note.color };
      el.style.opacity = "1";
    }, index * DROP_STAGGER_MS));

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", handleResize);
      staggerTimers.forEach((timer) => window.clearTimeout(timer));
      Matter.Events.off(mouseConstraint, "startdrag", handleStartDrag);
      Matter.Events.off(mouseConstraint, "enddrag", handleEndDrag);
      Matter.Events.off(engine, "collisionStart", handleCollisionStart);
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
              <span className="pile-piece-text">{ notePreviewText(note.text) }</span>
            </button>
          ))
        }
      </div>
    </motion.div>
  );
};

export default NotePile;
