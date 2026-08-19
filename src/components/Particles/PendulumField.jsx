import { useEffect, useRef } from "react";
import * as THREE from "three";

import { resolveCssColor } from "../History/HistoryAmbient";

import "./PendulumField.css";

THREE.ColorManagement.enabled = false;

// A real double pendulum — two rigid rods hinged end to end, the standard
// textbook example of deterministic chaos: a system with no randomness
// anywhere in it, whose future is still practically unpredictable, because
// two starting angles that differ by a fraction of a degree diverge into
// completely different motion within seconds. This panel runs N_PENDULUMS
// of them at once (see below), each released from the *same* angle plus an
// imperceptible per-pendulum offset (PERTURBATION_EPS radians — genuinely
// too small to see in the starting position), purely so that divergence
// itself becomes visible: for the first instant they swing as one, then
// visibly fan apart, which is the actual, literal meaning of "sensitive
// dependence on initial conditions," not an illustration of it.
//
// Equations of motion via θ1, θ2 (each rod's angle from straight-down) and
// their angular velocities ω1, ω2, derived from the system's Lagrangian —
// the standard published result (see e.g. Eric W. Weisstein, "Double
// Pendulum," MathWorld, or any classical-mechanics reference; cited here
// rather than re-derived, the same "a real published formulation, not
// invented" standard FluidField.jsx's Müller/Charypar/Gross citation and
// ChladniField.jsx's own eigenmode combination already hold themselves to):
//   ω1' = [ −g(2m1+m2)sin θ1 − m2 g sin(θ1−2θ2)
//           − 2 sin(θ1−θ2) m2 (ω2²L2 + ω1²L1 cos(θ1−θ2)) ]
//         / [ L1(2m1+m2−m2 cos(2θ1−2θ2)) ]
//   ω2' = [ 2 sin(θ1−θ2) (ω1²L1(m1+m2) + g(m1+m2) cos θ1 + ω2²L2 m2 cos(θ1−θ2)) ]
//         / [ L2(2m1+m2−m2 cos(2θ1−2θ2)) ]
// Hand-verified the one way that's actually checkable without re-deriving
// the Lagrangian: taking m2 → 0 collapses ω1' to −g sin θ1 / L1, the plain
// single-pendulum equation, exactly as it must (a massless second rod
// can't feed anything back into the first).
//
// Integrated with RK4 (four weighted derivative samples per step, the
// standard general-purpose choice for a smooth nonlinear ODE like this
// one), not the semi-implicit Euler every other Particles/ demo's own
// N-body/spring/wave systems use — those are simple enough that Euler's
// well-known energy drift stays imperceptible at their own timescales, but
// this system is chaotic: any integration error becomes a second,
// unintended source of divergence indistinguishable from the real one
// PERTURBATION_EPS is deliberately providing, and RK4's dramatically lower
// per-step error is what actually keeps the fan's spread meaning
// something. A small angular damping term (DAMPING) rides on top for two
// honest reasons: real hinges have friction the pure equations above don't
// model, and it's a deliberate long-run safety net against the small
// residual energy drift no explicit integrator, RK4 included, is fully
// immune to over many real-time minutes — not part of the cited equations
// above, and not hidden as if it were.
const N_PENDULUMS = 50;
const TRAIL_LENGTH = 40;

const L1 = 2.4;
const L2 = 2.2;
const M1 = 1.4;
const M2 = 1.0;
const G = 10;
const DAMPING = 0.025;
const SUBSTEPS = 4;

const PERTURBATION_EPS = 0.00015; // radians — the entire "different initial condition" every pendulum but the first starts from
const DEFAULT_RELEASE_ANGLE = Math.PI / 2; // horizontal — an energetic, reliably chaotic release, not resting near the stable equilibrium
const REACH = L1 + L2;
const VIEW_EXTENT = REACH + 0.8; // comfortable margin — a chaotic swing can genuinely reach any angle, so the view is sized off the pendulum's own real maximum reach, not guessed

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
// (GravityField.jsx, ChladniField.jsx, BoidField.jsx, CrystalField.jsx).
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

// The four coupled derivatives at a given state — see the file header for
// the equations themselves. Shared by every RK4 sample below so the actual
// physics is written out exactly once.
const derivative = (t1, t2, w1, w2) => {
  const delta = t1 - t2;
  const sinDelta = Math.sin(delta);
  const cosDelta = Math.cos(delta);
  const den = 2 * M1 + M2 - M2 * Math.cos(2 * delta);

  const dw1 = (
    -G * (2 * M1 + M2) * Math.sin(t1)
    - M2 * G * Math.sin(t1 - 2 * t2)
    - 2 * sinDelta * M2 * (w2 * w2 * L2 + w1 * w1 * L1 * cosDelta)
  ) / (L1 * den);

  const dw2 = (
    2 * sinDelta * (
      w1 * w1 * L1 * (M1 + M2)
      + G * (M1 + M2) * Math.cos(t1)
      + w2 * w2 * L2 * M2 * cosDelta
    )
  ) / (L2 * den);

  return { dt1: w1, dt2: w2, dw1, dw2 };
};

// Classic 4th-order Runge-Kutta over the 4D state (θ1, θ2, ω1, ω2) — four
// derivative samples (k1 at the start, k2/k3 at trial midpoints, k4 at a
// trial endpoint), combined with the standard 1:2:2:1 weighting.
const rk4Step = (p, dt) => {
  const k1 = derivative(p.t1, p.t2, p.w1, p.w2);
  const k2 = derivative(p.t1 + dt / 2 * k1.dt1, p.t2 + dt / 2 * k1.dt2, p.w1 + dt / 2 * k1.dw1, p.w2 + dt / 2 * k1.dw2);
  const k3 = derivative(p.t1 + dt / 2 * k2.dt1, p.t2 + dt / 2 * k2.dt2, p.w1 + dt / 2 * k2.dw1, p.w2 + dt / 2 * k2.dw2);
  const k4 = derivative(p.t1 + dt * k3.dt1, p.t2 + dt * k3.dt2, p.w1 + dt * k3.dw1, p.w2 + dt * k3.dw2);

  p.t1 += dt / 6 * (k1.dt1 + 2 * k2.dt1 + 2 * k3.dt1 + k4.dt1);
  p.t2 += dt / 6 * (k1.dt2 + 2 * k2.dt2 + 2 * k3.dt2 + k4.dt2);
  p.w1 += dt / 6 * (k1.dw1 + 2 * k2.dw1 + 2 * k3.dw1 + k4.dw1);
  p.w2 += dt / 6 * (k1.dw2 + 2 * k2.dw2 + 2 * k3.dw2 + k4.dw2);

  p.w1 *= 1 - DAMPING * dt;
  p.w2 *= 1 - DAMPING * dt;
};

// World position of each joint, pivot at the origin — θ measured from
// straight down, so θ = 0 puts a bob directly beneath whatever it hangs
// from (the stable equilibrium), matching the convention the equations
// above were written in (see the m2 → 0 check in the file header, which
// only comes out right under this exact convention).
const bob1Pos = (p) => ({ x: L1 * Math.sin(p.t1), y: -L1 * Math.cos(p.t1) });
const bob2Pos = (p, b1) => ({ x: b1.x + L2 * Math.sin(p.t2), y: b1.y - L2 * Math.cos(p.t2) });

// active/reduceMotion follow every other Particles/ field's own contract.
// scatterToken bumps to release fresh from DEFAULT_RELEASE_ANGLE again
// (the panel's own "Release" button) — the same full-reset contract
// CrystalField's own regrow uses, for the same reason: nothing here is a
// continuously-tunable parameter the way ChladniField's modes are.
// onStats mirrors GravityFieldPanel's own onSystemStats.
const PendulumField = ({ active, reduceMotion = false, scatterToken = 0, onStats }) => {
  const canvasRef = useRef(null);
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  const onStatsRef = useRef(onStats);
  useEffect(() => { onStatsRef.current = onStats; });
  const releaseFnRef = useRef(null);

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

    const makePendulum = (angle, index) => {
      const t1 = angle + index * PERTURBATION_EPS;
      const t2 = t1;
      const b1 = bob1Pos({ t1, t2 });
      const b2 = bob2Pos({ t1, t2 }, b1);
      return {
        t1, t2, w1: 0, w2: 0,
        trail: Array.from({ length: TRAIL_LENGTH }, () => new THREE.Vector2(b2.x, b2.y)),
      };
    };
    const pendulums = Array.from({ length: N_PENDULUMS }, (_, i) => makePendulum(DEFAULT_RELEASE_ANGLE, i));

    // Grabbing anywhere releases every pendulum fresh from wherever the
    // pointer currently is, fully extended (both rods pointing the same
    // direction) — the classic "pull the pendulum out straight, let go"
    // gesture, the same "grabbed bodies are driven directly, not
    // integrated" contract GravityField.jsx's own grab-and-throw already
    // uses. Releasing is nothing more than dragging becoming false again:
    // normal RK4 integration below simply resumes from wherever the drag
    // last left every pendulum, with real angular velocity zero — an
    // actual release from rest, not a separate reset path.
    let dragging = false;
    let dragAngle = DEFAULT_RELEASE_ANGLE;
    const ndcFromEvent = (e) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: -(((e.clientY - rect.top) / rect.height) * 2 - 1),
      };
    };
    const worldFromNdc = (ndc) => new THREE.Vector3(ndc.x, ndc.y, 0).unproject(camera);
    const updateDragAngle = (e) => {
      const w = worldFromNdc(ndcFromEvent(e));
      // atan2(x, −y) is the inverse of the (x, y) = (sin θ, −cos θ)
      // convention bob1Pos/bob2Pos and the equations of motion both share
      // — see their own comment for why θ = 0 means "straight down."
      dragAngle = Math.atan2(w.x, -w.y);
    };

    const releaseDefault = () => {
      dragAngle = DEFAULT_RELEASE_ANGLE;
      for (let i = 0; i < N_PENDULUMS; i++) {
        const p = pendulums[i];
        p.t1 = DEFAULT_RELEASE_ANGLE + i * PERTURBATION_EPS;
        p.t2 = p.t1;
        p.w1 = 0;
        p.w2 = 0;
        const b1 = bob1Pos(p);
        const b2 = bob2Pos(p, b1);
        for (const tp of p.trail) tp.set(b2.x, b2.y);
      }
    };
    releaseFnRef.current = releaseDefault;

    const handlePointerDown = (e) => {
      dragging = true;
      updateDragAngle(e);
    };
    const handlePointerMove = (e) => {
      if (!dragging) return;
      updateDragAngle(e);
      // Reduced motion never runs the ambient RK4 loop below, but a held
      // drag still directly *sets* every pendulum's angle every frame
      // (see step() below) rather than integrating — that assignment is
      // cheap and instant regardless of reduceMotion, so the fan visibly
      // tracks the drag live even with motion reduced; only the free
      // swing after release needs the reduced-motion burst on pointer-up
      // below.
    };
    const handlePointerUp = () => {
      if (!dragging) return;
      dragging = false;
      if (reduceMotionRef.current) {
        for (let i = 0; i < 260; i++) step(1 / 60);
        writeBuffers();
      }
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    // One tick across every pendulum — while a drag holds them, every
    // pendulum's angle is set directly from dragAngle (fanned by the same
    // PERTURBATION_EPS the free release uses, so the divergence is already
    // previewable before you even let go); otherwise each one gets
    // SUBSTEPS real RK4 steps. handlePointerUp above already calls this
    // function by name — safe despite being defined first, the same
    // closure-over-a-later-const every other Particles/ demo's own
    // reduced-motion handlers already rely on: nothing can actually invoke
    // it until the whole synchronous effect body (this definition
    // included) has finished running and event listeners are attached.
    const step = (dt) => {
      if (dragging) {
        for (let i = 0; i < N_PENDULUMS; i++) {
          const p = pendulums[i];
          p.t1 = dragAngle + i * PERTURBATION_EPS;
          p.t2 = p.t1;
          p.w1 = 0;
          p.w2 = 0;
          const b1 = bob1Pos(p);
          const b2 = bob2Pos(p, b1);
          for (const tp of p.trail) tp.set(b2.x, b2.y);
        }
        return;
      }

      const subDt = dt / SUBSTEPS;
      for (let i = 0; i < N_PENDULUMS; i++) {
        const p = pendulums[i];
        for (let s = 0; s < SUBSTEPS; s++) rk4Step(p, subDt);

        const b1 = bob1Pos(p);
        const b2 = bob2Pos(p, b1);
        for (let t = p.trail.length - 1; t > 0; t--) p.trail[t].copy(p.trail[t - 1]);
        p.trail[0].set(b2.x, b2.y);
      }
    };

    // Ensemble spread of every pendulum's own bob2 — the standard
    // deviation of their current positions, as a share of the pendulum's
    // own maximum possible reach. Starts at (near) zero, since every
    // pendulum begins within PERTURBATION_EPS of identical, and climbs as
    // chaos actually pulls them apart — a real, directly measured quantity
    // for the panel chrome's own stat, the same "genuine reading off the
    // live state, not a decorative number" standard GravityFieldPanel's
    // kinetic-energy stat already sets. Only ever called from the
    // throttled stats block below, not every frame — it allocates one
    // small object per pendulum, cheap at N_PENDULUMS but no reason to pay
    // it 60 times a second when the chrome itself only reads it every
    // STATS_EMIT_MS anyway.
    const computeSpreadPct = () => {
      let sx = 0, sy = 0;
      const pts = new Array(N_PENDULUMS);
      for (let i = 0; i < N_PENDULUMS; i++) {
        const p = pendulums[i];
        const b2 = bob2Pos(p, bob1Pos(p));
        pts[i] = b2;
        sx += b2.x; sy += b2.y;
      }
      const mx = sx / N_PENDULUMS, my = sy / N_PENDULUMS;
      let varSum = 0;
      for (const b2 of pts) {
        const dx = b2.x - mx, dy = b2.y - my;
        varSum += dx * dx + dy * dy;
      }
      const stdDev = Math.sqrt(varSum / N_PENDULUMS);
      return Math.min(100, Math.round((100 * stdDev) / REACH));
    };

    // Trail points for every pendulum's bob2, plus three fixed extra
    // slots — the pivot marker and pendulum[0]'s own current bob1/bob2 —
    // rendered brighter as a "hero" so the actual two-rod mechanism
    // producing all this stays visible underneath the fan of trails, the
    // same "one clear body, many ghost echoes" split BoidField.jsx's own
    // trail rendering already establishes for a different reason.
    const trailPointCount = N_PENDULUMS * TRAIL_LENGTH;
    const EXTRA_POINTS = 3;
    const totalPoints = trailPointCount + EXTRA_POINTS;
    const positions = new Float32Array(totalPoints * 3);
    const alphas = new Float32Array(totalPoints);
    const sizes = new Float32Array(totalPoints);

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

    // The hero pendulum's own two rods — a plain two-segment line, the one
    // piece of non-point geometry in this file, since a trail of dots
    // can't read as a rigid rod the way it reads as a moving bob's path.
    const rodPositions = new Float32Array(3 * 3);
    const rodGeometry = new THREE.BufferGeometry();
    rodGeometry.setAttribute("position", new THREE.BufferAttribute(rodPositions, 3));
    const rodMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color(resolveCssColor("var(--page-ink-color)")),
      transparent: true,
      opacity: 0.55,
    });
    const rodLine = new THREE.Line(rodGeometry, rodMaterial);
    scene.add(rodLine);

    // Same re-tint convention as ChladniField.jsx/BoidField.jsx/
    // CrystalField.jsx — two materials to retint here, not one.
    const themeObserver = new MutationObserver(() => {
      const ink = resolveCssColor("var(--page-ink-color)");
      uniforms.uColor.value.set(ink);
      rodMaterial.color.set(ink);
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const writeBuffers = () => {
      for (let i = 0; i < N_PENDULUMS; i++) {
        const p = pendulums[i];
        for (let t = 0; t < TRAIL_LENGTH; t++) {
          const idx = i * TRAIL_LENGTH + t;
          const tp = p.trail[t];
          positions[idx * 3] = tp.x;
          positions[idx * 3 + 1] = tp.y;
          positions[idx * 3 + 2] = 0;

          const fade = 1 - t / TRAIL_LENGTH;
          alphas[idx] = fade * fade * 0.5;
          sizes[idx] = 2.6 * fade + 1;
        }
      }

      const hero = pendulums[0];
      const heroB1 = bob1Pos(hero);
      const heroB2 = bob2Pos(hero, heroB1);

      const pivotIdx = trailPointCount;
      positions[pivotIdx * 3] = 0; positions[pivotIdx * 3 + 1] = 0; positions[pivotIdx * 3 + 2] = 0;
      alphas[pivotIdx] = 0.5; sizes[pivotIdx] = 5;

      const b1Idx = trailPointCount + 1;
      positions[b1Idx * 3] = heroB1.x; positions[b1Idx * 3 + 1] = heroB1.y; positions[b1Idx * 3 + 2] = 0;
      alphas[b1Idx] = 0.95; sizes[b1Idx] = 7;

      const b2Idx = trailPointCount + 2;
      positions[b2Idx * 3] = heroB2.x; positions[b2Idx * 3 + 1] = heroB2.y; positions[b2Idx * 3 + 2] = 0;
      alphas[b2Idx] = 0.95; sizes[b2Idx] = 7;

      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.aAlpha.needsUpdate = true;
      geometry.attributes.aSize.needsUpdate = true;

      rodPositions[0] = 0; rodPositions[1] = 0; rodPositions[2] = 0;
      rodPositions[3] = heroB1.x; rodPositions[4] = heroB1.y; rodPositions[5] = 0;
      rodPositions[6] = heroB2.x; rodPositions[7] = heroB2.y; rodPositions[8] = 0;
      rodGeometry.attributes.position.needsUpdate = true;
    };

    // Same reduced-motion reasoning as every other Particles/ demo: a
    // synchronous burst so the panel opens on a real, already-diverged fan
    // rather than 50 pendulums frozen together at the release angle.
    // Full-motion visitors get the divergence itself live instead — the
    // entire point of this one is watching it happen.
    if (reduceMotionRef.current) {
      for (let i = 0; i < 300; i++) step(1 / 60);
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

      if (dragging || !reduceMotionRef.current) {
        step(dt);
        writeBuffers();
      }

      renderer.render(scene, camera);

      if (onStatsRef.current && now - lastStatsEmit > STATS_EMIT_MS) {
        lastStatsEmit = now;
        onStatsRef.current({ spreadPct: computeSpreadPct() });
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
      releaseFnRef.current = null;
      geometry.dispose();
      material.dispose();
      rodGeometry.dispose();
      rodMaterial.dispose();
      renderer.dispose();
    };
  }, [active]);

  // The panel's own "Release" button bumps scatterToken — guarded to >0 so
  // mounting never fires a redundant release on top of the fresh fan the
  // effect above just created, and releaseFnRef is nulled on unmount so a
  // stale bump after the panel closes safely no-ops.
  useEffect(() => {
    if (scatterToken > 0) releaseFnRef.current?.();
  }, [scatterToken]);

  return (
    <canvas
      ref={ canvasRef }
      className="pendulum-field-canvas"
      aria-hidden="true"
    />
  );
};

export default PendulumField;
