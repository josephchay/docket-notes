import { useEffect, useRef } from "react";
import * as THREE from "three";

import { resolveCssColor } from "../History/HistoryAmbient";

import "./ChladniField.css";

THREE.ColorManagement.enabled = false;

// Chladni figures — the patterns loose sand settles into on a plate driven
// at one of its own resonant frequencies, first published by Ernst Chladni
// in 1787 and, a century and a half later, exactly what Hans Jenny's
// cymatics work made famous. A real closed-form solution, not a fitted
// approximation: for a square plate with free edges, driving it at the
// frequency of eigenmode (n, m) actually excites BOTH (n, m) and its
// degenerate twin (m, n) simultaneously (a square's diagonal symmetry
// makes these two genuinely equal-frequency modes of the same plate, not
// two different drives), and any linear combination of degenerate modes is
// itself a valid mode. The antisymmetric combination below —
//   z(x, y) = cos(nπx/L)cos(mπy/L) − cos(mπx/L)cos(nπy/L)
// — is the standard one (it's the combination that actually respects the
// square's own diagonal-reflection symmetry), and it's what produces
// Chladni's real intricate nodal networks rather than the plain
// rectangular grid a single mode alone would draw.
//
// Sand doesn't collect at random — it's driven off the high-vibration
// antinodes and left behind on the quiescent nodal lines, where z(x, y) is
// (near) zero. Modeled below as literal gradient descent on z² (the local
// vibration-energy density): F = −∇(z²) = −2z·∇z, computed from the exact
// analytic partials of the closed form above (see chladniGrad), not a
// finite-difference approximation — a smooth trig function has no reason
// to earn its derivative the hard way. A small always-on per-grain jitter
// on top keeps settled grains visibly trembling along their line rather
// than freezing into a static image, the same restlessness real sand on a
// driven plate never fully loses.
//
// Every other Particles/ demo with many independent bodies (GravityField's
// planets, ParticleCuboid's lattice) still pays an O(N²) or neighbor-search
// cost somewhere, because those bodies interact with EACH OTHER. Grains
// here don't — each one only ever answers to the fixed field z(x, y), so
// this is the one genuinely embarrassingly-parallel demo in the set: full
// GRAIN_COUNT with zero neighbor search, only marginally more expensive
// than rendering the same number of static points.
const PLATE_SIZE = 10;
const VIEW_EXTENT = 5.6;
const GRAIN_COUNT = 4200;

const MODE_MIN = 1;
const MODE_MAX = 10;
const DEFAULT_MODE_A = 3;
const DEFAULT_MODE_B = 5;

// Tuned by hand against this exact grain count/damping — like
// FluidFieldPanel's own disclaimer, the qualitative behavior (grains
// genuinely migrate to and hold at the nodal lines, for every mode pair in
// range) is what's actually verified here, not one clean hand-checkable
// constant the way an orbit's period or a spring's ω·dt is.
const FORCE_STRENGTH = 1.4;
const DAMPING = 0.88;
const JITTER_STRENGTH = 0.4;
const SUBSTEPS = 2;

const POINTER_RADIUS = 1.4;
const POINTER_STRENGTH = 11;

// A display/reporting threshold for the "settled" stat below — like
// InkBloomField's own smoothstep display curve, deliberately kept separate
// from the physics itself, which only ever pushes toward z = 0 and never
// checks against a cutoff.
const SETTLE_THRESHOLD = 0.22;
const REDUCED_MOTION_SETTLE_STEPS = 200; // a one-time synchronous settle so a reduced-motion visitor still opens on a real pattern, not a frozen random scatter — see the effect body below
const REDUCED_MOTION_DRAG_STEPS = 16; // per pointer-move sample, same "interaction still works, ambient auto-motion doesn't" contract InkBloomField's own reduced-motion paint bursts use

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

// A soft round falloff per point, the same gl_PointCoord technique
// GravityField.jsx/AmbientField.jsx already use — one ink color for every
// grain (unlike GravityField's per-body palette, grains aren't individually
// distinguished), with vAlpha carrying each grain's own settledness.
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

// z(x, y) — see the file header for what this closed form is and why.
// (ux, uy) are domain-shifted into [0, L] (the form's own natural range);
// callers pass plate-centered (x, y) and add PLATE_SIZE/2 first.
const chladniZ = (n, m, ux, uy, k) => (
  Math.cos(n * k * ux) * Math.cos(m * k * uy) - Math.cos(m * k * ux) * Math.cos(n * k * uy)
);

// Exact analytic partials of chladniZ — differentiating a closed-form trig
// sum by hand rather than sampling neighbors, since there's no reason to
// approximate a derivative that's this cheap to write out directly.
const chladniGrad = (n, m, ux, uy, k) => {
  const a = n * k;
  const b = m * k;
  return {
    dzdx: -a * Math.sin(a * ux) * Math.cos(b * uy) + b * Math.sin(b * ux) * Math.cos(a * uy),
    dzdy: -b * Math.cos(a * ux) * Math.sin(b * uy) + a * Math.cos(b * ux) * Math.sin(a * uy),
  };
};

// GLSL's smoothstep, ported plain — used here purely as a display curve
// (see SETTLE_THRESHOLD/vAlpha above), reversed-edges the same way
// InkBloomField's own display shader inverts smoothstep's ramp direction
// (edge0 > edge1) to turn "low |z|" into "high alpha" instead of the other
// way around.
const smoothstepJs = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

// active/reduceMotion follow every other Particles/ field's own contract.
// modeA/modeB are read fresh every frame via refs, so ChladniPanel's own
// steppers retune the live field instead of only affecting a future
// reseed — changing modes needs no reset at all, unlike InkBloomField's
// feed/kill: existing grains simply flow toward wherever the new field's
// own nodes now are. scatterToken is a plain bump-to-trigger counter (the
// panel's own "Scatter" button) that re-randomizes every grain's position,
// purely so a visitor can watch the same pattern re-assert itself from
// chaos again without closing and reopening the panel. onStats mirrors
// GravityFieldPanel's own onSystemStats.
const ChladniField = ({
  active,
  reduceMotion = false,
  modeA = DEFAULT_MODE_A,
  modeB = DEFAULT_MODE_B,
  scatterToken = 0,
  onStats,
}) => {
  const canvasRef = useRef(null);
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  const modeARef = useRef(modeA);
  modeARef.current = modeA;
  const modeBRef = useRef(modeB);
  modeBRef.current = modeB;
  const onStatsRef = useRef(onStats);
  useEffect(() => { onStatsRef.current = onStats; });
  const scatterFnRef = useRef(null);

  useEffect(() => {
    if (!active) return undefined;

    const canvas = canvasRef.current;
    const parent = canvas.parentElement;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-VIEW_EXTENT, VIEW_EXTENT, VIEW_EXTENT, -VIEW_EXTENT, 0.1, 100);
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

    const K = Math.PI / PLATE_SIZE;
    const HALF = PLATE_SIZE / 2;

    const randomPos = () => (Math.random() - 0.5) * PLATE_SIZE;
    const grains = Array.from({ length: GRAIN_COUNT }, () => ({
      x: randomPos(),
      y: randomPos(),
      vx: 0,
      vy: 0,
      size: 3 + Math.random() * 2.5,
    }));

    const scatter = () => {
      for (const g of grains) {
        g.x = randomPos();
        g.y = randomPos();
        g.vx = 0;
        g.vy = 0;
      }
    };
    scatterFnRef.current = scatter;

    const positions = new Float32Array(GRAIN_COUNT * 3);
    const alphas = new Float32Array(GRAIN_COUNT);
    const sizes = new Float32Array(GRAIN_COUNT);
    for (let i = 0; i < GRAIN_COUNT; i++) sizes[i] = grains[i].size;

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

    // Same re-tint convention as ParticleCuboid.jsx/InkBloomField.jsx.
    const themeObserver = new MutationObserver(() => {
      uniforms.uColor.value.set(resolveCssColor("var(--page-ink-color)"));
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    // Drag-to-disturb: press and drag scatters nearby grains outward with a
    // proximity-weighted kick — the same "grab a real handful and watch it
    // resettle" quality ClothField's grab and GravityField's slingshot
    // already give their own demos. World coordinates via Camera.unproject,
    // same reasoning as GravityField's own ndcFromEvent/worldFromNdc pair.
    let pointerActive = false;
    const pointerWorld = new THREE.Vector2();
    const ndcFromEvent = (e) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: -(((e.clientY - rect.top) / rect.height) * 2 - 1),
      };
    };
    const worldFromNdc = (ndc) => new THREE.Vector3(ndc.x, ndc.y, 0).unproject(camera);

    let settledCount = 0;

    // One physics step across every grain — see the file header for the
    // force itself. Returns how many grains currently sit on a node
    // (|z| < SETTLE_THRESHOLD), purely for the panel chrome's own stat.
    const step = (dt) => {
      const n = modeARef.current;
      const m = modeBRef.current;
      let settled = 0;

      for (let i = 0; i < GRAIN_COUNT; i++) {
        const g = grains[i];
        const ux = g.x + HALF;
        const uy = g.y + HALF;

        const z = chladniZ(n, m, ux, uy, K);
        const { dzdx, dzdy } = chladniGrad(n, m, ux, uy, K);

        const fx = -2 * z * dzdx * FORCE_STRENGTH;
        const fy = -2 * z * dzdy * FORCE_STRENGTH;

        g.vx += (fx + (Math.random() * 2 - 1) * JITTER_STRENGTH) * dt;
        g.vy += (fy + (Math.random() * 2 - 1) * JITTER_STRENGTH) * dt;

        if (pointerActive) {
          const ddx = g.x - pointerWorld.x;
          const ddy = g.y - pointerWorld.y;
          const dist = Math.hypot(ddx, ddy);
          if (dist < POINTER_RADIUS && dist > 0.0001) {
            const push = (1 - dist / POINTER_RADIUS) * POINTER_STRENGTH;
            g.vx += (ddx / dist) * push * dt;
            g.vy += (ddy / dist) * push * dt;
          }
        }

        g.vx *= DAMPING;
        g.vy *= DAMPING;
        g.x += g.vx * dt;
        g.y += g.vy * dt;

        if (g.x < -HALF) { g.x = -HALF; g.vx = 0; }
        else if (g.x > HALF) { g.x = HALF; g.vx = 0; }
        if (g.y < -HALF) { g.y = -HALF; g.vy = 0; }
        else if (g.y > HALF) { g.y = HALF; g.vy = 0; }

        if (Math.abs(z) < SETTLE_THRESHOLD) settled++;

        positions[i * 3] = g.x;
        positions[i * 3 + 1] = g.y;
        positions[i * 3 + 2] = 0;
        alphas[i] = 0.28 + 0.68 * smoothstepJs(1.3, 0.05, Math.abs(z));
      }

      return settled;
    };

    // dt = 0 purely to populate positions/alphas from the initial random
    // scatter before the first real render — otherwise frame one would
    // show every grain still sitting at the typed array's default (0,0,0).
    // Under reduced motion there is no ongoing rAF stepping to settle the
    // page live (see tick() below), so that case additionally gets a
    // one-time synchronous burst here — deliberately NOT the default for
    // everyone: watching sand actually organize out of a random scatter
    // over the first couple of real seconds is the whole point of a real
    // Chladni demonstration, so full-motion visitors get that live rather
    // than opening on an already-solved page the way GravityField/
    // InkBloomField's own "already alive" panels do.
    settledCount = step(0);
    if (reduceMotionRef.current) {
      for (let i = 0; i < REDUCED_MOTION_SETTLE_STEPS; i++) settledCount = step(0.02);
    }

    const handlePointerDown = (e) => {
      pointerActive = true;
      const w = worldFromNdc(ndcFromEvent(e));
      pointerWorld.set(w.x, w.y);
      if (reduceMotionRef.current) {
        for (let i = 0; i < REDUCED_MOTION_DRAG_STEPS; i++) settledCount = step(0.02);
        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.aAlpha.needsUpdate = true;
      }
    };
    const handlePointerMove = (e) => {
      if (!pointerActive) return;
      const w = worldFromNdc(ndcFromEvent(e));
      pointerWorld.set(w.x, w.y);
      if (reduceMotionRef.current) {
        for (let i = 0; i < REDUCED_MOTION_DRAG_STEPS; i++) settledCount = step(0.02);
        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.aAlpha.needsUpdate = true;
      }
    };
    const handlePointerUp = () => { pointerActive = false; };

    canvas.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    let raf = null;
    let lastTime = performance.now();
    let lastStatsEmit = 0;

    const tick = () => {
      raf = requestAnimationFrame(tick);

      const now = performance.now();
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      if (!reduceMotionRef.current) {
        const subDt = dt / SUBSTEPS;
        for (let s = 0; s < SUBSTEPS; s++) settledCount = step(subDt);
      }

      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.aAlpha.needsUpdate = true;
      renderer.render(scene, camera);

      if (onStatsRef.current && now - lastStatsEmit > STATS_EMIT_MS) {
        lastStatsEmit = now;
        onStatsRef.current({ settledFraction: settledCount / GRAIN_COUNT });
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
      scatterFnRef.current = null;
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [active]);

  // The panel's own "Scatter" button bumps scatterToken — guarded to >0 so
  // mounting never fires a redundant re-scatter on top of the fresh random
  // grains the effect above already created, and scatterFnRef is nulled on
  // unmount so a stale bump after the panel closes safely no-ops.
  useEffect(() => {
    if (scatterToken > 0) scatterFnRef.current?.();
  }, [scatterToken]);

  return (
    <canvas
      ref={ canvasRef }
      className="chladni-field-canvas"
      aria-hidden="true"
    />
  );
};

export { MODE_MIN, MODE_MAX, DEFAULT_MODE_A, DEFAULT_MODE_B };
export default ChladniField;
