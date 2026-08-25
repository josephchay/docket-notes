import { useEffect, useRef } from "react";
import * as THREE from "three";

// Same reasoning as AmbientField.jsx: keep THREE from converting hex inks
// into linear space on the way in.
THREE.ColorManagement.enabled = false;

const COUNT = 20;

// Individual per-point Lissajous wander — unchanged formula from the
// original shader-only version, just evaluated in JS now (see the big
// comment below on why everything moved out of the vertex shader).
const wanderOffset = (seed, elapsed) => ({
  x: Math.sin(elapsed * seed.speed + seed.phase) * seed.driftR,
  y: Math.cos(elapsed * seed.speed * 0.8 + seed.phase * 1.3) * seed.driftR,
});

// Mutual cohesion/repulsion: a lightweight pairwise force field among the
// COUNT points themselves (trivial at O(n^2)=400 pairs/frame) so the dust
// reads as a loose, breathing group rather than 20 fully independent
// oscillators — points drift together, jostle apart once too close, and
// never fully overlap at rest.
const COHESION_RADIUS = 0.55;
const COHESION_STRENGTH = 0.05;
const REPEL_RADIUS = 0.16;
const REPEL_STRENGTH = 0.4;
const GROUP_DAMPING = 3.2;

// Cursor repulsion — a hovering/moving pointer over the pane pushes nearby
// points away, like ink fleeing a fingertip; released the instant the
// pointer leaves, same force shape as the mutual repulsion above.
const MOUSE_REPEL_RADIUS = 0.4;
const MOUSE_REPEL_STRENGTH = 0.9;

// Per-point resting radius (NDC units) and its idle twinkle — folded into
// radius rather than alpha (see FRAG below) so it composes cleanly through
// the smooth-min merge instead of needing a second blended channel.
const RADIUS_MIN = 0.018;
const RADIUS_MAX = 0.05;
const PULSE_MIN = 0.55;

// Staggered entrance: each point grows in from zero radius, delayed by its
// own seed phase — reused as a free per-point stagger key since it has no
// other use at t=0 and every point already carries one.
const ENTRANCE_RAMP_S = 0.55;
const ENTRANCE_STAGGER_SPAN = 0.65;

// Gooey retint pooling: the smooth-min blend radius the merged SDF field
// uses (see FRAG) — small at rest so points read mostly independent, spiked
// by retintUniform() itself while a color transition is actually in flight
// so the dust visibly pools together before redistributing in the new tint.
const MERGE_K_BASE = 0.014;
const MERGE_K_RETINT = 0.09;
const EDGE_SOFT = 0.012;

// A weak, always-on pull back toward each point's own original spawn spot —
// negligible next to cohesion/repulsion while it has neighbors nearby, but
// enough to eventually recover a point that cursor repulsion has pushed
// clear outside COHESION_RADIUS of every other point (past that range,
// mutual force alone is zero and pure damping would otherwise strand it
// wherever it happened to stop).
const ANCHOR_STRENGTH = 0.012;

// How fast uPos/uRad blend toward their reduceMotion-on/off target each
// second — smooths the transition itself so flipping reduceMotion mid-
// session (a live prop, not just a mount-time value) eases across rather
// than snapping between "wander+pulse animated" and "bare resting" values
// in a single frame.
const MOTION_BLEND_RATE = 6;

// A single oversized triangle covering the whole -1..1 clip box — one
// full-screen pass instead of COUNT separate THREE.Points sprites, needed
// because a genuine metaball merge requires each fragment to see every
// point's position at once, which per-primitive point-sprite rendering
// can't give it (each point's own fragment shader invocation has no way to
// read a DIFFERENT point's screen position). No matrix uniforms needed —
// same "write clip space directly" convention the original shader used.
const VERT = `
  varying vec2 vPos;

  void main() {
    vPos = position.xy;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Loops over every point's live NDC position/radius (uploaded fresh each
// frame from the JS-side integrator below) and combines them into one
// field via Inigo Quilez's polynomial smooth-min, so overlapping-enough
// circles genuinely fuse into a shared blob instead of just stacking two
// flat alpha discs. uMergeK controls how eagerly they fuse.
const FRAG = `
  precision mediump float;

  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uMergeK;
  uniform float uAspect;
  uniform vec2 uPos[${ COUNT }];
  uniform float uRad[${ COUNT }];

  varying vec2 vPos;

  float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
  }

  void main() {
    float d = 1.0e3;
    for (int i = 0; i < ${ COUNT }; i++) {
      // NDC x and y map to different pixel counts whenever the pane isn't
      // square — scaling the x leg of the difference by uAspect (width /
      // height) before measuring distance is what keeps a circle a circle
      // instead of an ellipse stretched by the pane's own aspect ratio.
      vec2 diff = vPos - uPos[i];
      diff.x *= uAspect;
      float sdf = length(diff) - uRad[i];
      d = smin(d, sdf, uMergeK);
    }

    float a = (1.0 - smoothstep(-${ EDGE_SOFT.toFixed(3) }, ${ EDGE_SOFT.toFixed(3) }, d)) * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

// Resolves a CSS color value down to something THREE.Color can parse — the
// action-color styles in HistoryPanel.jsx hand this a raw `var(--x-color)`
// reference (see ACTION_STYLES), which THREE has no idea what to do with on
// its own.
export const resolveCssColor = (value) => {
  if (!value) return "#191919";

  const match = /var\((--[\w-]+)\)/.exec(value);
  if (!match) return value;

  const resolved = getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim();
  return resolved || "#191919";
};

// Smoothly lerps a shader's uColor uniform toward whatever `value` resolves
// to right now — shared by both triggers below that need a retint: the
// previewed action changing, and the theme flipping. Most of ACTION_STYLES'
// colors are theme-invariant by design (see colors.css), but the
// DEFAULT_STYLE fallback resolves from --page-ink-color, which *does* flip
// — re-running this against whatever the CSS variable resolves to *right
// now* is what keeps that case from going stale after a theme toggle. Also
// spikes-and-settles uniforms.uMergeK over the exact same timeline, so the
// dust visibly pools together mid-transition and redistributes once the
// new tint has landed — a retint is the one moment this file already knows
// is "something changed," so it's the natural trigger for the merge beat
// rather than adding a second, independent timer.
const retintUniform = (uniforms, value) => {
  const target = new THREE.Color(resolveCssColor(value));
  const start = {
    r: uniforms.uColor.value.r,
    g: uniforms.uColor.value.g,
    b: uniforms.uColor.value.b,
  };

  // A true no-op — most commonly the mount-time call, which always retints
  // FROM the color uColor was just constructed with TO that identical prop
  // (see the [] effect below vs the [color] effect right after it) — skips
  // the merge-pool spike entirely rather than playing the "something
  // changed" flourish for a color that never actually changed.
  if (start.r === target.r && start.g === target.g && start.b === target.b) {
    return () => {};
  }

  const startK = uniforms.uMergeK.value;
  const duration = 500;
  const startTime = performance.now();
  let raf = null;

  const step = (now) => {
    const t = Math.min(1, (now - startTime) / duration);
    uniforms.uColor.value.setRGB(
      start.r + (target.r - start.r) * t,
      start.g + (target.g - start.g) * t,
      start.b + (target.b - start.b) * t,
    );
    // Peaks at t=.5 (mid-transition), back to its start value by t=1 — the
    // same "most visible at the peak, settled by the end" shape several
    // other panels' own turbulence-wobble effects already use.
    const pool = 4 * t * (1 - t);
    uniforms.uMergeK.value = startK + (MERGE_K_RETINT - startK) * pool;
    if (t < 1) {
      raf = requestAnimationFrame(step);
    } else {
      uniforms.uMergeK.value = MERGE_K_BASE;
    }
  };
  raf = requestAnimationFrame(step);

  return () => { if (raf) cancelAnimationFrame(raf); };
};

// A faint drifting-dust wash behind the right pane's preview, re-tinted to
// whichever action's color is currently previewed — the same raw-Three.js
// technique AmbientField.jsx uses for the page's own background, scoped to
// this one pane (sized off its own parent via ResizeObserver rather than
// the window) and driven by a `color` prop instead of the light/dark theme.
//
// Points now carry real per-point JS-side state (position, velocity) rather
// than being purely time-parametric — needed so the mutual-cohesion force
// field below has something to integrate, and so the metaball FRAG pass
// above has live positions to read every frame. The individual Lissajous
// wander moved out of the vertex shader and into the same per-frame JS pass
// alongside it, since a single-triangle full-screen quad has no per-point
// vertex invocations left to compute it in.
const HistoryAmbient = ({ color, reduceMotion }) => {
  const canvasRef = useRef(null);
  const uniformsRef = useRef(null);
  const colorRef = useRef(color);
  colorRef.current = color;
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  // Whichever retintUniform() cancel fn is currently in flight, from
  // *either* source below — shared so a theme flip arriving mid-retint
  // (or vice versa) actually cancels the other one first, rather than two
  // rAF loops both writing uColor the same frame and flickering against
  // each other.
  const activeRetintRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas.parentElement;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();

    // Oversized triangle: (-1,-1), (3,-1), (-1,3) — fully covers the -1..1
    // clip box with one primitive, no seam a two-triangle quad would have.
    const triPositions = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(triPositions, 3));

    const points = [];
    for (let i = 0; i < COUNT; i++) {
      const x = (Math.random() * 2 - 1) * 0.85;
      const y = (Math.random() * 2 - 1) * 0.85;
      points.push({
        pos: { x, y },
        vel: { x: 0, y: 0 },
        anchor: { x, y },
        seed: {
          phase: Math.random() * Math.PI * 2,
          driftR: 0.02 + Math.random() * 0.06,
          speed: 0.15 + Math.random() * 0.35,
        },
        radius: RADIUS_MIN + Math.random() * (RADIUS_MAX - RADIUS_MIN),
      });
    }

    const uPos = new Float32Array(COUNT * 2);
    const uRad = new Float32Array(COUNT);

    const uniforms = {
      uColor: { value: new THREE.Color(resolveCssColor(color)) },
      uOpacity: { value: 0.3 },
      uMergeK: { value: MERGE_K_BASE },
      uAspect: { value: 1 },
      uPos: { value: uPos },
      uRad: { value: uRad },
    };
    uniformsRef.current = uniforms;

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    // The triangle's own vertices already ARE clip-space coordinates (see
    // VERT) — no camera/projection needed, matching how the original
    // shader wrote gl_Position directly too. THREE still needs a camera
    // object to call renderer.render(scene, camera) with.
    const camera = new THREE.Camera();

    const resize = () => {
      const width = parent.clientWidth || 1;
      const height = parent.clientHeight || 1;
      renderer.setSize(width, height, false);
      uniforms.uAspect.value = width / height;
    };
    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(parent);

    // Real pointer position, tracked in the pane's own NDC space (matching
    // how the points themselves are positioned) — null while the pointer
    // isn't over the pane at all, so the repulsion term below can cleanly
    // skip itself rather than repelling from a stale last-known point.
    const mouseNdc = { x: null, y: null };
    const handlePointerMove = (e) => {
      const rect = parent.getBoundingClientRect();
      mouseNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseNdc.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    };
    const handlePointerLeave = () => { mouseNdc.x = null; mouseNdc.y = null; };
    parent.addEventListener("pointermove", handlePointerMove, { passive: true });
    parent.addEventListener("pointerleave", handlePointerLeave, { passive: true });

    const clock = new THREE.Clock();
    let raf = null;

    // One shared step: mutual cohesion/repulsion + cursor repulsion + a weak
    // anchor pull drive each point's `pos` via a plain damped-force
    // integrator (same accel/vel/pos shape used throughout this app's other
    // spring code). Forces are computed into a scratch buffer for every
    // point FIRST, then applied in a second pass — a genuine Jacobi step,
    // so point i and point j's pairwise force are computed from the exact
    // same (this-frame's-start) snapshot of both positions rather than one
    // reading the other's already-this-frame-updated value.
    const forces = Array.from({ length: COUNT }, () => ({ x: 0, y: 0 }));

    const stepGroup = (dt, elapsed, motionAmount) => {
      for (let i = 0; i < COUNT; i++) {
        const p = points[i];
        let fx = 0, fy = 0;

        for (let j = 0; j < COUNT; j++) {
          if (j === i) continue;
          const q = points[j];
          const dx = q.pos.x - p.pos.x;
          const dy = q.pos.y - p.pos.y;
          const dist = Math.hypot(dx, dy) || 0.0001;

          if (dist < REPEL_RADIUS) {
            const push = (1 - dist / REPEL_RADIUS) * REPEL_STRENGTH;
            fx -= (dx / dist) * push;
            fy -= (dy / dist) * push;
          } else if (dist < COHESION_RADIUS) {
            const pull = (dist / COHESION_RADIUS) * COHESION_STRENGTH;
            fx += (dx / dist) * pull;
            fy += (dy / dist) * pull;
          }
        }

        if (mouseNdc.x !== null) {
          const dx = p.pos.x - mouseNdc.x;
          const dy = p.pos.y - mouseNdc.y;
          const dist = Math.hypot(dx, dy) || 0.0001;
          if (dist < MOUSE_REPEL_RADIUS) {
            const push = (1 - dist / MOUSE_REPEL_RADIUS) * MOUSE_REPEL_STRENGTH;
            fx += (dx / dist) * push;
            fy += (dy / dist) * push;
          }
        }

        fx += (p.anchor.x - p.pos.x) * ANCHOR_STRENGTH;
        fy += (p.anchor.y - p.pos.y) * ANCHOR_STRENGTH;

        forces[i].x = fx;
        forces[i].y = fy;
      }

      for (let i = 0; i < COUNT; i++) {
        const p = points[i];
        const accelX = forces[i].x - p.vel.x * GROUP_DAMPING;
        const accelY = forces[i].y - p.vel.y * GROUP_DAMPING;
        p.vel.x += accelX * dt;
        p.vel.y += accelY * dt;
        p.pos.x += p.vel.x * dt;
        p.pos.y += p.vel.y * dt;

        // motionAmount eases 0..1 on a reduceMotion flip (see tick() below)
        // rather than snapping — wander/pulse/entrance are the ONLY things
        // it scales, so the underlying group physics above always keeps
        // running (imperceptibly slow relative to its own damping) while
        // the visibly animated layer smoothly fades to/from its resting
        // "bare position, full radius" values instead of popping.
        const wander = wanderOffset(p.seed, elapsed);
        const entranceDelay = (p.seed.phase / (Math.PI * 2)) * ENTRANCE_STAGGER_SPAN;
        const entranceT = Math.max(0, Math.min(1, (elapsed - entranceDelay) / ENTRANCE_RAMP_S));
        const pulse = PULSE_MIN + (1 - PULSE_MIN) * (0.5 + 0.5 * Math.sin(elapsed * p.seed.speed * 1.7 + p.seed.phase * 2.0));

        uPos[i * 2] = p.pos.x + wander.x * motionAmount;
        uPos[i * 2 + 1] = p.pos.y + wander.y * motionAmount;
        uRad[i] = p.radius * (1 + (pulse * entranceT - 1) * motionAmount);
      }
    };

    // A local elapsed accumulator built from the SAME clamped dt physics
    // already uses, instead of THREE.Clock's own getElapsedTime() — a
    // regaining-visibility tab can leave Clock's internal elapsedTime
    // having jumped by the entire hidden-tab gap in one shot (getDelta()
    // always folds its diff into elapsedTime, it does not "drop" it, despite
    // what an earlier version of this comment claimed), which would have
    // popped the wander/pulse phase to an uncorrelated value on every tab
    // switch. Built from dt (already clamped to 0.05s/frame) instead, this
    // can never advance by more than one clamped frame's worth regardless
    // of how long the tab was hidden.
    let elapsedAccum = 0;
    // 1 = full wander/pulse/entrance motion, 0 = settled at rest — eased
    // toward reduceMotion's target each frame rather than switched.
    let motionAmount = reduceMotionRef.current ? 0 : 1;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05);
      elapsedAccum += dt;

      const motionTarget = reduceMotionRef.current ? 0 : 1;
      motionAmount += (motionTarget - motionAmount) * Math.min(1, dt * MOTION_BLEND_RATE);

      stepGroup(dt, elapsedAccum, motionAmount);
      renderer.render(scene, camera);
    };

    const handleVisibility = () => {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = null;
      } else if (!raf) {
        clock.getDelta(); // reset Clock's own oldTime so ITS internal state doesn't carry the gap either, even though elapsedAccum above no longer depends on it
        tick();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    tick();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", handleVisibility);
      parent.removeEventListener("pointermove", handlePointerMove);
      parent.removeEventListener("pointerleave", handlePointerLeave);
      resizeObserver.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-tints smoothly toward whatever action is currently previewed rather
  // than snapping.
  useEffect(() => {
    const uniforms = uniformsRef.current;
    if (!uniforms) return;
    activeRetintRef.current?.();
    activeRetintRef.current = retintUniform(uniforms, color);
    return () => activeRetintRef.current?.();
  }, [color]);

  // Also re-tints on a theme flip alone — the same manual RAF-lerp
  // AmbientField.jsx's own light/dark theme-flip observer already does.
  // Needed because the effect above only fires when the `color` *prop*
  // changes; if it's currently DEFAULT_STYLE's --page-ink-color (the one
  // ACTION_STYLES color that isn't theme-invariant) and the theme flips
  // without the previewed action also changing, that prop string stays
  // identical even though what it resolves to just changed underneath it.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const uniforms = uniformsRef.current;
      if (!uniforms) return;
      activeRetintRef.current?.();
      activeRetintRef.current = retintUniform(uniforms, colorRef.current);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      observer.disconnect();
      activeRetintRef.current?.();
    };
  }, []);

  return <canvas ref={ canvasRef } className="history-ambient" aria-hidden="true" />;
};

export default HistoryAmbient;
