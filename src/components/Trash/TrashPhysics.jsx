import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { createPortal } from "react-dom";
import Matter from "matter-js";

import { NOTE_COLORS } from "../../constants/colors";

import "./TrashPhysics.css";

// The "gone forever" dissolve (see triggerDissolve further down) — one
// shared raw-WebGL canvas rather than a context per piece (a big "empty
// trash" burst can settle a dozen-plus pieces within the same
// FADE_MS window, and a dozen-plus concurrent WebGL contexts is a real
// budget most browsers cap well under), the same "no three.js needed for
// this" reasoning ThemeWipeGL and NavRipple already settled on. A fixed
// bank of MAX_DISSOLVES slots, looped every fragment rather than one draw
// call per burst — the standard way to render "several simultaneous small
// effects" in one pass instead of one context/program per effect.
const MAX_DISSOLVES = 6;
const DISSOLVE_RADIUS = 46; // px the ring travels out to at progress 1

const DISSOLVE_VERT = `
  attribute vec2 aPos;
  void main() {
    gl_Position = vec4(aPos, 0.0, 1.0);
  }
`;

const DISSOLVE_FRAG = `
  precision mediump float;
  uniform vec2 uResolution;
  uniform vec2 uOrigin[${ MAX_DISSOLVES }];
  uniform float uProgress[${ MAX_DISSOLVES }];
  uniform vec3 uColor[${ MAX_DISSOLVES }];
  uniform float uActive[${ MAX_DISSOLVES }];

  void main() {
    vec2 frag = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
    vec3 accum = vec3(0.0);
    float alpha = 0.0;

    for (int i = 0; i < ${ MAX_DISSOLVES }; i++) {
      if (uActive[i] < 0.5) continue;

      float dist = length(frag - uOrigin[i]);
      float r = uProgress[i] * ${ DISSOLVE_RADIUS.toFixed(1) };
      // A bright expanding ring rather than a filled disc — an ember
      // line marking the edge of what just disintegrated, not a solid
      // blob covering it.
      float ring = smoothstep(12.0, 0.0, abs(dist - r));
      float a = ring * (1.0 - uProgress[i]) * 0.85;
      accum += uColor[i] * a;
      alpha = max(alpha, a);
    }

    if (alpha < 0.01) discard;
    gl_FragColor = vec4(accum, alpha);
  }
`;

const hexToUnit = (hex) => {
  const clean = (hex || "#191919").replace("#", "");
  const value = parseInt(clean, 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
};

const GRAVITY = 1.15;
const SETTLE_HOLD_MS = 1200;  // how long a piece lingers, settled, before it starts fading
const FADE_MS = 420;
const MAX_BODIES = 70;        // trims the oldest once a big "empty trash" burst piles up
const REDUCED_FADE_MS = 550;  // reduced-motion fallback: no fall, just a fade in place

// A real shredder, not a metaphor — shred (drop()'s default) cuts the
// swatch into actual vertical strips, each its own tiny physics body,
// rather than one solid square standing in for "deleted." A restore
// toss (see TrashPanel.jsx's future drag-to-toss, drop({shred:false}))
// stays one whole piece — nothing about restoring a note destroys it,
// so the body it hands off to should read as intact, catchable,
// reversible, the same distinction the panel's own restore-vs-shred exit
// animations already draw for the button path.
const SHRED_STRIP_COUNT = 5;
const SHRED_STRIP_GAP = 1.5; // px between strips — reads as cut apart even before velocity separates them
const SHRED_STRIP_MIN_WIDTH = 2.5; // px — thinner than this stops looking like paper and starts looking like a rounding error

// Live drag-to-toss (see grab/moveGrabbed/releaseGrabbed below) — a
// grabbed piece is held as a STATIC body (unaffected by gravity, but
// still a real obstacle anything already piled up can bounce off of)
// that tracks the pointer 1:1, the same "direct manipulation shouldn't
// lag" discipline every other drag in this app already keeps. Release
// reads the pointer's own last tracked velocity — a firm enough upward
// throw (vy past RESTORE_VELOCITY_THRESHOLD; screen space, so upward is
// negative) reads as "thrown back," anything else — a drop, a sideways
// toss, a downward fling — reads as "let go," gravity's own honest
// default for something no longer held.
const RESTORE_VELOCITY_THRESHOLD = -7; // px/Matter-tick of upward speed a release needs to clear to read as a toss-back
const TOSS_VELOCITY_MAX = 26; // px/Matter-tick cap, so a very fast mouse move can't launch a piece absurdly far
// A restored piece fades on its own short fixed clock instead of the
// normal settle-then-fade window (SETTLE_HOLD_MS/FADE_MS) — it was
// thrown clear specifically so it wouldn't sit in the pile, so nothing
// about how it actually lands should decide how long it stays visible.
const RESTORE_FLIGHT_HOLD_MS = 120;
const RESTORE_FLIGHT_FADE_MS = 360;

// Jelly squash-and-stretch on impact — the same spring-driven scalar
// NotePile.jsx's pile physics uses, reused here at a lighter touch since
// these chips are much smaller and can spawn many at once during "empty
// trash." Kicked by real collisions (the floor, a wall, another chip),
// scaled by how fast the chip was actually moving.
const SQUASH_STIFFNESS = 240;
const SQUASH_DAMPING = 13;
const MIN_IMPACT_SPEED = 2;

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
const TrashPhysics = forwardRef(({ reduceMotion }, ref) => {
  const layerRef = useRef(null);
  const engineRef = useRef(null);
  const bodiesRef = useRef([]);   // { body, el, bornAt, squash, squashVel, color, dissolved, restoreFlight? }
  const wallsRef = useRef(null);  // { floor, left, right }
  const grabbedRef = useRef(new Map()); // id -> live-held piece mid drag-to-toss (see grab/moveGrabbed/releaseGrabbed)
  const dissolveCanvasRef = useRef(null);
  const dissolveDrawRef = useRef(null);
  // Fixed-size bank of burst slots (see MAX_DISSOLVES) — plain objects
  // reused in place rather than an array that grows/shrinks, so a long
  // session's worth of shredding never allocates more than these six.
  const dissolveSlotsRef = useRef(
    Array.from({ length: MAX_DISSOLVES }, () => ({ active: false, x: 0, y: 0, color: [0, 0, 0], triggeredAt: 0 })),
  );

  useEffect(() => {
    const engine = Matter.Engine.create({ gravity: { x: 0, y: GRAVITY } });
    engineRef.current = engine;
    // Captured once up front for cleanup's own sake below — the Map
    // instance itself never changes across this component's lifetime
    // (grab/moveGrabbed/releaseGrabbed only ever mutate it in place via
    // set/delete), so reading it now and reading grabbedRef.current
    // fresh at unmount time would be the exact same object either way.
    const grabbedPieces = grabbedRef.current;

    // The dissolve's own tiny WebGL setup — same compile/link/resize
    // discipline ThemeWipeGL and NavRipple already use. Skipped
    // entirely under reduced motion, the same "don't even build the GL
    // program for a visitor who'll never see it animate" restraint
    // ThemeWipe's own capability check applies at a higher level.
    let disposeDissolveGl = () => {};
    if (!reduceMotion && dissolveCanvasRef.current) {
      const canvas = dissolveCanvasRef.current;
      const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
      if (gl) {
        const compile = (type, source) => {
          const shader = gl.createShader(type);
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
        };
        const vertex = compile(gl.VERTEX_SHADER, DISSOLVE_VERT);
        const fragment = compile(gl.FRAGMENT_SHADER, DISSOLVE_FRAG);

        if (vertex && fragment) {
          const program = gl.createProgram();
          gl.attachShader(program, vertex);
          gl.attachShader(program, fragment);
          gl.linkProgram(program);
          gl.useProgram(program);

          const buffer = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
          const aPos = gl.getAttribLocation(program, "aPos");
          gl.enableVertexAttribArray(aPos);
          gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

          const uniforms = {
            resolution: gl.getUniformLocation(program, "uResolution"),
            origin: gl.getUniformLocation(program, "uOrigin"),
            progress: gl.getUniformLocation(program, "uProgress"),
            color: gl.getUniformLocation(program, "uColor"),
            active: gl.getUniformLocation(program, "uActive"),
          };

          let dpr = Math.min(window.devicePixelRatio || 1, 2);
          const resizeDissolve = () => {
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.round(window.innerWidth * dpr);
            canvas.height = Math.round(window.innerHeight * dpr);
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
          };
          resizeDissolve();
          window.addEventListener("resize", resizeDissolve);

          dissolveDrawRef.current = () => {
            const slots = dissolveSlotsRef.current;
            const origins = new Float32Array(MAX_DISSOLVES * 2);
            const progresses = new Float32Array(MAX_DISSOLVES);
            const colors = new Float32Array(MAX_DISSOLVES * 3);
            const actives = new Float32Array(MAX_DISSOLVES);

            let anyActive = false;
            slots.forEach((slot, i) => {
              if (!slot.active) return;
              anyActive = true;
              origins[i * 2] = slot.x * dpr;
              origins[i * 2 + 1] = slot.y * dpr;
              progresses[i] = slot.progress;
              colors[i * 3] = slot.color[0];
              colors[i * 3 + 1] = slot.color[1];
              colors[i * 3 + 2] = slot.color[2];
              actives[i] = 1;
            });

            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            if (!anyActive) return;

            gl.uniform2fv(uniforms.origin, origins);
            gl.uniform1fv(uniforms.progress, progresses);
            gl.uniform3fv(uniforms.color, colors);
            gl.uniform1fv(uniforms.active, actives);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
          };

          disposeDissolveGl = () => {
            window.removeEventListener("resize", resizeDissolve);
            dissolveDrawRef.current = null;
            gl.deleteProgram(program);
            gl.deleteShader(vertex);
            gl.deleteShader(fragment);
            gl.deleteBuffer(buffer);
          };
        }
      }
    }

    // The dissolve's own trigger — fires once per piece, the instant it
    // crosses into its own fade window (see the tick loop below). Reuses
    // whichever of the six slots has been burning longest if all are
    // already spoken for, so a big "empty trash" volley settling within
    // one FADE_MS window always has somewhere to put its own burst
    // rather than just dropping it silently.
    const triggerDissolve = (x, y, colorName) => {
      const slots = dissolveSlotsRef.current;
      const free = slots.find((s) => !s.active);
      const slot = free || slots.reduce((oldest, s) => (s.triggeredAt < oldest.triggeredAt ? s : oldest), slots[0]);

      slot.active = true;
      slot.x = x;
      slot.y = y;
      slot.color = hexToUnit(NOTE_COLORS[colorName]);
      slot.triggeredAt = performance.now();
      slot.progress = 0;
    };

    // Every real landing — the floor, a wall, another chip — kicks that
    // chip's own squash spring, scaled by how fast it was actually moving.
    const handleCollisionStart = (e) => {
      for (const pair of e.pairs) {
        for (const candidate of [pair.bodyA, pair.bodyB]) {
          const piece = bodiesRef.current.find((p) => p.body === candidate);
          if (!piece) continue;

          const speed = Math.hypot(candidate.velocity.x, candidate.velocity.y);
          if (speed < MIN_IMPACT_SPEED) continue;

          piece.squashVel += Math.min(1, speed / 12) * 1.5;
        }
      }
    };
    Matter.Events.on(engine, "collisionStart", handleCollisionStart);

    let raf = requestAnimationFrame(tick);

    function tick() {
      raf = requestAnimationFrame(tick);
      Matter.Engine.update(engine, 1000 / 60);

      const now = performance.now();
      const survivors = [];
      const dt = 1 / 60;

      for (const piece of bodiesRef.current) {
        const { body, el, bornAt } = piece;
        const age = now - bornAt;

        // A released toss-back rides its own short fixed clock instead
        // of the settle-then-fade timing below — it was thrown clear
        // specifically so it wouldn't sit in the pile, so nothing about
        // where its own arc actually carries it should decide how long
        // it stays visible. No squash tracking either: it's leaving, not
        // landing.
        if (piece.restoreFlight) {
          const total = RESTORE_FLIGHT_HOLD_MS + RESTORE_FLIGHT_FADE_MS;
          if (age > total) {
            Matter.World.remove(engine.world, body);
            el.remove();
            continue;
          }

          el.style.transform =
            `translate(${ body.position.x }px, ${ body.position.y }px) translate(-50%, -50%) rotate(${ body.angle }rad)`;
          if (age > RESTORE_FLIGHT_HOLD_MS) {
            el.style.opacity = String(Math.max(0, 1 - (age - RESTORE_FLIGHT_HOLD_MS) / RESTORE_FLIGHT_FADE_MS));
          }

          survivors.push(piece);
          continue;
        }

        if (age > SETTLE_HOLD_MS + FADE_MS) {
          Matter.World.remove(engine.world, body);
          el.remove();
          continue;
        }

        // A critically-underdamped spring pulling squash back toward 0 —
        // the brief overshoot past zero is what reads as jelly rather than
        // a flat snap back to shape.
        piece.squashVel += (-SQUASH_STIFFNESS * piece.squash - SQUASH_DAMPING * piece.squashVel) * dt;
        piece.squash += piece.squashVel * dt;
        const squash = Math.max(-.7, Math.min(1, piece.squash));
        const scaleY = 1 - squash * .5;
        const scaleX = 1 + squash * .35;

        el.style.transform =
          `translate(${ body.position.x }px, ${ body.position.y }px) translate(-50%, -50%) rotate(${ body.angle }rad) scale(${ scaleX }, ${ scaleY })`;

        if (age > SETTLE_HOLD_MS) {
          el.style.opacity = String(Math.max(0, 1 - (age - SETTLE_HOLD_MS) / FADE_MS));

          // Fires exactly once, right as this piece actually enters its
          // own fade — a plain per-piece flag rather than an age-window
          // check, since age keeps climbing well past this point and
          // would otherwise retrigger every frame for the rest of this
          // piece's life.
          if (!piece.dissolved) {
            piece.dissolved = true;
            triggerDissolve(body.position.x, body.position.y, piece.color);
          }
        }

        survivors.push(piece);
      }

      bodiesRef.current = survivors;

      // The dissolve bank's own progress — every active slot ages at the
      // same FADE_MS rate its piece's own opacity just faded at above, so
      // the WebGL ring and the DOM piece it's marking finish together.
      const slots = dissolveSlotsRef.current;
      for (const slot of slots) {
        if (!slot.active) continue;
        slot.progress = (now - slot.triggeredAt) / FADE_MS;
        if (slot.progress >= 1) slot.active = false;
      }
      dissolveDrawRef.current?.();
    }

    return () => {
      cancelAnimationFrame(raf);
      Matter.Events.off(engine, "collisionStart", handleCollisionStart);
      Matter.World.clear(engine.world, false);
      Matter.Engine.clear(engine);
      bodiesRef.current.forEach(({ el }) => el.remove());
      bodiesRef.current = [];
      grabbedPieces.forEach(({ el }) => el.remove());
      grabbedPieces.clear();
      wallsRef.current = null;
      disposeDissolveGl();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // One physics body + its DOM element, wired into the shared world and
  // the tick loop's own bookkeeping array — pulled out since shred now
  // calls this once per strip instead of once per piece, and a restore
  // toss still calls it exactly once.
  const spawnPiece = (engine, layer, x, y, w, h, color, extraClassName, angle, vx, vy, angularVel) => {
    const el = document.createElement("span");
    el.className = `trash-physics-chip ${ extraClassName } ${ color }-bg`;
    el.style.width = `${ w }px`;
    el.style.height = `${ h }px`;
    layer.appendChild(el);

    const body = Matter.Bodies.rectangle(x, y, w, h, {
      restitution: .5,
      friction: .35,
      frictionAir: .012,
      angle,
    });
    Matter.Body.setAngularVelocity(body, angularVel);
    Matter.Body.setVelocity(body, { x: vx, y: vy });
    Matter.World.add(engine.world, body);

    // color/dissolved ride along on the piece record purely for
    // triggerDissolve's own sake (see the tick loop) — the physics side
    // never reads either.
    bodiesRef.current.push({ body, el, bornAt: performance.now(), squash: 0, squashVel: 0, color, dissolved: false });
  };

  // Pulled out of drop()'s own shred branch so a release-time shred (see
  // releaseGrabbed) can reuse the exact same strip-cutting math rather
  // than duplicating it — the only thing a toss's own release velocity
  // adds on top is a directional bias, layered onto the strips' usual
  // fan-out kick rather than replacing it.
  const spawnShredStrips = (engine, layer, x, y, w, h, color, biasVx = 0, biasVy = 0) => {
    const stripCount = Math.max(2, Math.min(SHRED_STRIP_COUNT, Math.floor(w / (SHRED_STRIP_MIN_WIDTH + SHRED_STRIP_GAP))));
    const stripW = (w - SHRED_STRIP_GAP * (stripCount - 1)) / stripCount;
    const startX = x - w / 2 + stripW / 2;

    for (let i = 0; i < stripCount; i++) {
      const fan = (i - (stripCount - 1) / 2) / stripCount;
      spawnPiece(
        engine, layer,
        startX + i * (stripW + SHRED_STRIP_GAP), y,
        stripW, h, color, "trash-physics-strip",
        (Math.random() - .5) * .25,
        biasVx + fan * 6 + (Math.random() - .5) * 1.2,
        biasVy - (0.5 + Math.random() * 1.2),
        (Math.random() - .5) * .5,
      );
    }
  };

  useImperativeHandle(ref, () => ({
    // shred (the default — every existing caller means this) cuts the
    // swatch into SHRED_STRIP_COUNT real vertical strips, each its own
    // body; shred: false hands off one intact piece instead, for a
    // restore toss that should read as the note surviving, not being
    // destroyed.
    drop({ x, y, width = 24, height = 24, color, panelRect, shred = true }) {
      const engine = engineRef.current;
      const layer = layerRef.current;
      if (!engine || !layer) return;

      const w = Math.max(14, Math.min(width, 40));
      const h = Math.max(14, Math.min(height, 40));

      if (reduceMotion) {
        // No gravity/pile simulation — just a soft fade right where it was
        // shredded from, still confirming the action without the
        // sustained falling/tumbling motion that's the whole point of
        // this layer otherwise. One piece regardless of `shred` — the
        // strip cut is exactly the sustained physical detail reduced
        // motion asks this to skip.
        const el = document.createElement("span");
        el.className = `trash-physics-chip ${ color }-bg`;
        el.style.width = `${ w }px`;
        el.style.height = `${ h }px`;
        layer.appendChild(el);
        el.style.transform = `translate(${ x }px, ${ y }px) translate(-50%, -50%)`;
        el.style.transition = `opacity ${ REDUCED_FADE_MS }ms ease-in`;
        requestAnimationFrame(() => { el.style.opacity = "0"; });
        setTimeout(() => el.remove(), REDUCED_FADE_MS + 50);
        return;
      }

      if (panelRect) ensureWalls(panelRect);

      if (shred) {
        // Strip width is whatever SHRED_STRIP_COUNT even divisions of the
        // real swatch width allows, floored at SHRED_STRIP_MIN_WIDTH — a
        // very narrow swatch (a short single-letter title's own chip) still
        // shreds visibly rather than trying to cut pieces too thin to read,
        // even if that means fewer, slightly wider strips than the nominal
        // count.
        spawnShredStrips(engine, layer, x, y, w, h, color);
      } else {
        spawnPiece(
          engine, layer, x, y, w, h, color, "",
          (Math.random() - .5) * .6,
          (Math.random() - .5) * 2.4, 0,
          (Math.random() - .5) * .3,
        );
      }

      while (bodiesRef.current.length > MAX_BODIES) {
        const oldest = bodiesRef.current.shift();
        Matter.World.remove(engine.world, oldest.body);
        oldest.el.remove();
      }
    },

    // Live drag-to-toss: TrashPanel.jsx calls this once a press on a
    // row's swatch clears its own movement threshold, handing that note
    // off to a real physics body immediately rather than waiting for a
    // release. Static while held — gravity doesn't fight the pointer,
    // but the body still sits in the world as a real obstacle anything
    // already piled up can bounce off, same as a wall.
    grab({ id, x, y, width = 24, height = 24, color, panelRect }) {
      if (reduceMotion) return;
      const engine = engineRef.current;
      const layer = layerRef.current;
      if (!engine || !layer) return;

      if (panelRect) ensureWalls(panelRect);

      const w = Math.max(14, Math.min(width, 40));
      const h = Math.max(14, Math.min(height, 40));

      const el = document.createElement("span");
      el.className = `trash-physics-chip trash-physics-grabbed ${ color }-bg`;
      el.style.width = `${ w }px`;
      el.style.height = `${ h }px`;
      el.style.transform = `translate(${ x }px, ${ y }px) translate(-50%, -50%)`;
      layer.appendChild(el);

      const body = Matter.Bodies.rectangle(x, y, w, h, { isStatic: true, restitution: .5, friction: .35 });
      Matter.World.add(engine.world, body);

      grabbedRef.current.set(id, { body, el, w, h, color, lastX: x, lastY: y, lastT: performance.now(), vx: 0, vy: 0 });
    },

    // Direct manipulation, not tick-loop-driven — the DOM transform is
    // written right here, the instant the pointer moves, rather than
    // waiting on the next rAF the way settling pieces sync from Matter's
    // own step. Velocity is tracked as this call's own instantaneous
    // rate, the same "read the latest delta" convention this app's other
    // toss gestures already use, scaled from raw px/ms up to Matter's own
    // px-per-tick unit (its engine steps at a fixed 1000/60ms — see the
    // tick loop's Engine.update call) so a released throw's speed lands
    // on the same scale everything else in this world already moves at.
    moveGrabbed(id, x, y) {
      const piece = grabbedRef.current.get(id);
      if (!piece) return;

      const now = performance.now();
      const dt = Math.max(1, now - piece.lastT);
      piece.vx = ((x - piece.lastX) / dt) * (1000 / 60);
      piece.vy = ((y - piece.lastY) / dt) * (1000 / 60);
      piece.lastX = x;
      piece.lastY = y;
      piece.lastT = now;

      Matter.Body.setPosition(piece.body, { x, y });
      piece.el.style.transform = `translate(${ x }px, ${ y }px) translate(-50%, -50%)`;
    },

    // Reads whichever velocity moveGrabbed last tracked to decide the
    // toss: a firm enough upward speed (screen space, so upward is
    // negative) reads as thrown back and hands the SAME element off to a
    // short restoreFlight fade (see the tick loop) rather than spawning
    // it fresh, since restoring keeps the one piece it always was.
    // Anything else — dropped in place, flung sideways, thrown down —
    // reads as let go, and shreds into strips right where it was
    // released, biased by however fast it was actually moving.
    releaseGrabbed(id) {
      const piece = grabbedRef.current.get(id);
      if (!piece) return { restored: false };
      grabbedRef.current.delete(id);

      const engine = engineRef.current;
      const layer = layerRef.current;
      const { x, y } = piece.body.position;
      Matter.World.remove(engine.world, piece.body);

      const vx = Math.max(-TOSS_VELOCITY_MAX, Math.min(TOSS_VELOCITY_MAX, piece.vx));
      const vy = Math.max(-TOSS_VELOCITY_MAX, Math.min(TOSS_VELOCITY_MAX, piece.vy));
      const restored = vy < RESTORE_VELOCITY_THRESHOLD;

      if (restored) {
        const body = Matter.Bodies.rectangle(x, y, piece.w, piece.h, { restitution: .5, friction: .35, frictionAir: .012 });
        Matter.Body.setVelocity(body, { x: vx, y: vy });
        Matter.World.add(engine.world, body);
        bodiesRef.current.push({
          body, el: piece.el, bornAt: performance.now(), squash: 0, squashVel: 0,
          color: piece.color, dissolved: false, restoreFlight: true,
        });
      } else {
        piece.el.remove();
        spawnShredStrips(engine, layer, x, y, piece.w, piece.h, piece.color, vx * .4, vy * .4);
      }

      while (bodiesRef.current.length > MAX_BODIES) {
        const oldest = bodiesRef.current.shift();
        Matter.World.remove(engine.world, oldest.body);
        oldest.el.remove();
      }

      return { restored };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [reduceMotion]);

  return createPortal(
    <div ref={ layerRef } className="trash-physics-layer" aria-hidden="true">
      {
        !reduceMotion && <canvas ref={ dissolveCanvasRef } className="trash-physics-dissolve" />
      }
    </div>,
    document.body,
  );
});

export default TrashPhysics;
