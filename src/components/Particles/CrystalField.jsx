import { useEffect, useRef } from "react";
import * as THREE from "three";

import { UniformGrid } from "../../utils/sphGrid";
import { resolveCssColor } from "../History/HistoryAmbient";

import "./CrystalField.css";

THREE.ColorManagement.enabled = false;

// Diffusion-limited aggregation — Witten & Sander, "Diffusion-Limited
// Aggregation, a Kinetic Critical Phenomenon" (Physical Review Letters,
// 1981), the standard model behind frost on glass, mineral dendrites,
// Lichtenberg figures, and electrodeposition alike: particles undergo an
// ordinary random walk (Brownian motion) until one happens to wander
// within sticking distance of the growing structure, at which point it
// freezes in place forever and a fresh walker takes its spot. No rule
// anywhere biases a walker toward the aggregate — growth is a pure
// side-effect of the aggregate happening to be *in the way* of enough
// random paths, which is what gives real DLA structures their
// characteristic branching: a walker is far more likely to stick to an
// already-outward-reaching tip (more of the domain funnels toward it) than
// to wander all the way into the structure's own interior, so branches
// that get slightly ahead keep pulling further ahead — a rich-get-richer
// dynamic with no rule that explicitly says so. The resulting shape has a
// genuine measured fractal dimension of ≈1.71 in 2D (rigorously below the
// branches' own topological dimension of 1, meaning space-filling but not
// solid) — a real, well-studied number, not just an evocative claim about
// the picture.
//
// Every other Particles/ demo with many independent bodies moves *all* of
// them by a deterministic rule (GravityField's forces, BoidField's
// steering, ChladniField's field). This is the first one where the motion
// itself is genuinely stochastic and the only "physics" is a distance
// check — and the first structure in the set that never stops growing
// under its own rules; it only ever adds.
//
// Sticking needs "is anything within STICK_RADIUS of this walker" checked
// for every one of WALKER_COUNT walkers, every frame, against an aggregate
// that can grow into the thousands — exactly the neighbor-query problem
// utils/sphGrid.js's UniformGrid already exists to solve (see that file's
// own header), reused here rather than re-derived: cell size equal to
// STICK_RADIUS, rebuilt fresh each frame from the current aggregate (an
// O(n) counting sort over at most MAX_AGGREGATE_SIZE points — cheap even
// every frame at this scale, unlike FluidField's own per-substep rebuild
// of a genuinely larger, continuously-moving particle set).
const DOMAIN_SIZE = 12;
const CENTER = DOMAIN_SIZE / 2;
const VIEW_EXTENT = DOMAIN_SIZE;

const WALKER_COUNT = 140;
const MAX_AGGREGATE_SIZE = 1600;

const STICK_RADIUS = 0.16;
const STEP_SIZE = 0.055; // well under STICK_RADIUS so a walker's own per-frame jump can't visibly skip past the aggregate without ever registering within range
const SPAWN_RADIUS = 5.6; // near the domain edge — classic DLA gives a walker room to wander before it can reach the structure, which is part of what makes early growth slow and late growth fast
const ESCAPE_RADIUS = 5.85; // just inside the domain edge — a walker that wanders this far out is recycled back onto the spawn ring rather than drifting uselessly at the boundary

// Real 2D Brownian motion: displacement variance grows linearly with
// elapsed time, so a step's own standard deviation scales with √dt, not
// dt itself — the same diffusion law InkBloomField's Gray-Scott system
// obeys in continuous PDE form (its Du/Dv diffusion terms), showing up
// here instead as the correct time-scaling for a single discrete random
// walker. FRAME_DT_REF is the frame time STEP_SIZE was actually tuned
// against; a step elsewhere scales by √(dt/FRAME_DT_REF) so the aggregate
// grows at the same real-world rate regardless of frame rate. Per-axis
// uniform jitter rather than a proper 2D Gaussian is a standard, widely-
// used real-time simplification — very slightly anisotropic in principle,
// invisible in practice once thousands of independent steps blur it out,
// the same character valueNoise3's own header claims for an analogous
// simplification.
const FRAME_DT_REF = 1 / 60;

const DRAG_BIAS_STRENGTH = 2.2;
const MAX_DRAG_DIST = 3;

const STATS_EMIT_MS = 150;

const VERT = `
  attribute float aAlpha;
  attribute float aSize;
  varying float vAlpha;
  uniform float uPixelRatio;

  void main() {
    vAlpha = aAlpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// The same soft round falloff every other Particles/ point cloud uses
// (GravityField.jsx, ChladniField.jsx, BoidField.jsx) — one ink color
// throughout, vAlpha alone carrying "frozen into the structure" (dark)
// versus "still wandering" (faint) rather than a second color.
const FRAG = `
  precision mediump float;
  varying float vAlpha;
  uniform vec3 uColor;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    float a = smoothstep(0.5, 0.0, d) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

// active/reduceMotion follow every other Particles/ field's own contract.
// scatterToken bumps to grow a fresh crystal from a single seed again (the
// panel's own "New crystal" button) — unlike ChladniField's live-retune
// contract, there is nothing to smoothly retune here (nothing "undoes" a
// stuck particle), so a full regrow is the only reset that makes sense.
// onStats mirrors GravityFieldPanel's own onSystemStats.
const CrystalField = ({ active, reduceMotion = false, scatterToken = 0, onStats }) => {
  const canvasRef = useRef(null);
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  const onStatsRef = useRef(onStats);
  useEffect(() => { onStatsRef.current = onStats; });
  const regrowFnRef = useRef(null);

  useEffect(() => {
    if (!active) return undefined;

    const canvas = canvasRef.current;
    const parent = canvas.parentElement;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);

    const scene = new THREE.Scene();
    // A 0..DOMAIN_SIZE frustum (not the centered ±VIEW_EXTENT every other
    // Particles/ camera uses) so world coordinates land directly in the
    // zero-based space UniformGrid itself expects (see FluidField.jsx's
    // own identical DOMAIN_W/DOMAIN_H convention) — no coordinate shift
    // needed anywhere between the simulation and the grid it queries.
    const camera = new THREE.OrthographicCamera(0, VIEW_EXTENT, VIEW_EXTENT, 0, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    const resize = () => {
      const w = parent.clientWidth || 1;
      const h = parent.clientHeight || 1;
      renderer.setSize(w, h, false);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(parent);

    const grid = new UniformGrid(DOMAIN_SIZE, DOMAIN_SIZE, STICK_RADIUS);

    const respawnWalker = (w) => {
      const angle = Math.random() * Math.PI * 2;
      w.x = CENTER + Math.cos(angle) * SPAWN_RADIUS;
      w.y = CENTER + Math.sin(angle) * SPAWN_RADIUS;
    };
    const makeWalker = () => {
      const w = { x: 0, y: 0 };
      respawnWalker(w);
      return w;
    };
    const walkers = Array.from({ length: WALKER_COUNT }, makeWalker);

    // Grows only — a plain array (not a fixed-capacity typed structure the
    // way the render buffers below are) purely so its own .length always
    // exactly matches the live count, which is what lets grid.build() read
    // it directly with no separate "how many of these are actually active"
    // bookkeeping to keep in sync.
    let aggregatePoints = [{ pos: new THREE.Vector2(CENTER, CENTER) }];

    const regrow = () => {
      aggregatePoints = [{ pos: new THREE.Vector2(CENTER, CENTER) }];
      for (const w of walkers) respawnWalker(w);
    };
    regrowFnRef.current = regrow;

    // Fixed capacity for the render buffers (aggregate slots, then walker
    // slots) — same "allocate for the max, geometry.setDrawRange to the
    // live portion" idiom SplatFluidRenderer.js's own splat points already
    // use, so a growing aggregate never needs to reallocate a GPU buffer
    // mid-flight.
    const maxPoints = MAX_AGGREGATE_SIZE + WALKER_COUNT;
    const positions = new Float32Array(maxPoints * 3);
    const alphas = new Float32Array(maxPoints);
    const sizes = new Float32Array(maxPoints);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));

    const uniforms = {
      uPixelRatio: { value: dpr },
      uColor: { value: new THREE.Color(resolveCssColor("var(--page-ink-color)")) },
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    scene.add(points);

    // Same re-tint convention as ChladniField.jsx/BoidField.jsx.
    const themeObserver = new MutationObserver(() => {
      uniforms.uColor.value.set(resolveCssColor("var(--page-ink-color)"));
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    // Drag = a steady wind, not a one-off flick: strength scales with how
    // far the pointer currently sits from where the drag started (capped
    // at MAX_DRAG_DIST), recomputed fresh every frame from live positions
    // rather than accumulated from per-event deltas — the same "always
    // derived from current state, never stale" reasoning as every other
    // continuously-held gesture in this app, and it means the bias always
    // drops to exactly zero the instant the pointer lifts, with nothing
    // left over to decay.
    let dragging = false;
    const dragOrigin = new THREE.Vector2();
    const pointerWorld = new THREE.Vector2();
    const ndcFromEvent = (e) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: -(((e.clientY - rect.top) / rect.height) * 2 - 1),
      };
    };
    const worldFromNdc = (ndc) => new THREE.Vector3(ndc.x, ndc.y, 0).unproject(camera);

    const handlePointerDown = (e) => {
      const w = worldFromNdc(ndcFromEvent(e));
      dragOrigin.set(w.x, w.y);
      pointerWorld.set(w.x, w.y);
      dragging = true;
    };
    // Under reduced motion, tick() below never calls step() on its own —
    // so without this, dragging would keep dragOrigin/pointerWorld/
    // dragging correctly updated but the crystal would never visibly lean
    // toward the drag at all. A small synchronous burst right here mirrors
    // BoidField.jsx's own reduced-motion nudge: interaction still grows
    // and steers the crystal, ambient auto-growth still doesn't resume on
    // its own afterward.
    const handlePointerMove = (e) => {
      const w = worldFromNdc(ndcFromEvent(e));
      pointerWorld.set(w.x, w.y);
      if (dragging && reduceMotionRef.current) {
        for (let i = 0; i < 20; i++) aggregateSize = step(FRAME_DT_REF);
        writeBuffers();
      }
    };
    const handlePointerUp = () => { dragging = false; };

    canvas.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    // One tick across every walker — see the file header for the model.
    // Rebuilds the grid fresh from the current aggregate first (so every
    // walker this frame queries the same snapshot; a stick that happens
    // mid-frame simply isn't visible to anyone else until the next
    // rebuild — harmless, the same one-rebuild-per-substep economy
    // FluidField.jsx's own grid already runs on).
    const step = (dt) => {
      grid.build(aggregatePoints);

      let bx = 0, by = 0;
      if (dragging) {
        const dx = pointerWorld.x - dragOrigin.x;
        const dy = pointerWorld.y - dragOrigin.y;
        const dist = Math.hypot(dx, dy) || 1;
        const capped = Math.min(dist, MAX_DRAG_DIST) / dist;
        bx = dx * capped * DRAG_BIAS_STRENGTH;
        by = dy * capped * DRAG_BIAS_STRENGTH;
      }

      const stepScale = STEP_SIZE * Math.sqrt(dt / FRAME_DT_REF);

      for (let i = 0; i < WALKER_COUNT; i++) {
        const w = walkers[i];
        w.x += (Math.random() - 0.5) * 2 * stepScale + bx * dt;
        w.y += (Math.random() - 0.5) * 2 * stepScale + by * dt;

        if (Math.hypot(w.x - CENTER, w.y - CENTER) > ESCAPE_RADIUS) {
          respawnWalker(w);
          continue;
        }

        if (aggregatePoints.length >= MAX_AGGREGATE_SIZE) continue;

        let stuck = false;
        grid.forEachNear(w.x, w.y, (idx) => {
          if (stuck) return;
          const ap = aggregatePoints[idx].pos;
          if (Math.hypot(ap.x - w.x, ap.y - w.y) < STICK_RADIUS) stuck = true;
        });

        if (stuck) {
          aggregatePoints.push({ pos: new THREE.Vector2(w.x, w.y) });
          respawnWalker(w);
        }
      }

      return aggregatePoints.length;
    };

    const writeBuffers = () => {
      const aggCount = aggregatePoints.length;
      for (let i = 0; i < aggCount; i++) {
        const p = aggregatePoints[i].pos;
        positions[i * 3] = p.x;
        positions[i * 3 + 1] = p.y;
        positions[i * 3 + 2] = 0;
        alphas[i] = 0.85;
        sizes[i] = 3.2;
      }
      for (let i = 0; i < WALKER_COUNT; i++) {
        const idx = aggCount + i;
        const w = walkers[i];
        positions[idx * 3] = w.x;
        positions[idx * 3 + 1] = w.y;
        positions[idx * 3 + 2] = 0;
        alphas[idx] = 0.26;
        sizes[idx] = 2.6;
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.aAlpha.needsUpdate = true;
      geometry.attributes.aSize.needsUpdate = true;
      geometry.setDrawRange(0, aggCount + WALKER_COUNT);
    };

    // Populate the render buffers before the first real frame, then — same
    // reasoning as every other Particles/ demo's own reduced-motion path —
    // give reduced-motion visitors a synchronous run so the panel opens on
    // a real, partially-grown crystal rather than a lone seed. Full-motion
    // visitors get the actual growth live instead: watching branches pull
    // ahead of each other over time is the entire point of this one.
    let aggregateSize = step(0);
    if (reduceMotionRef.current) {
      for (let i = 0; i < 400; i++) aggregateSize = step(FRAME_DT_REF);
    }
    writeBuffers();

    let raf = null;
    let lastTime = performance.now();
    let lastStatsEmit = 0;

    const tick = () => {
      raf = requestAnimationFrame(tick);

      const now = performance.now();
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      if (!reduceMotionRef.current) {
        aggregateSize = step(dt);
        writeBuffers();
      }

      renderer.render(scene, camera);

      if (onStatsRef.current && now - lastStatsEmit > STATS_EMIT_MS) {
        lastStatsEmit = now;
        onStatsRef.current({ aggregateSize, capacity: MAX_AGGREGATE_SIZE });
      }
    };

    const handleVisibility = () => {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = null;
      } else if (!raf) {
        lastTime = performance.now();
        tick();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    tick();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", handleVisibility);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      regrowFnRef.current = null;
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [active]);

  // The panel's own "New crystal" button bumps scatterToken — guarded to
  // >0 so mounting never fires a redundant regrow on top of the fresh
  // single-seed crystal the effect above just created, and regrowFnRef is
  // nulled on unmount so a stale bump after the panel closes safely no-ops.
  useEffect(() => {
    if (scatterToken > 0) regrowFnRef.current?.();
  }, [scatterToken]);

  return (
    <canvas
      ref={ canvasRef }
      className="crystal-field-canvas"
      aria-hidden="true"
    />
  );
};

export default CrystalField;
