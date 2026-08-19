import { useEffect, useRef } from "react";
import * as THREE from "three";

import { resolveCssColor } from "../History/HistoryAmbient";

import "./LeniaField.css";

THREE.ColorManagement.enabled = false;

// Lenia — Bert Chan's continuous generalization of cellular automata
// ("Lenia: Biology of Artificial Life," Complex Systems, 2019), the same
// family Conway's Game of Life belongs to but with continuous space,
// continuous time, and a continuous state — which is what lets it produce
// genuinely lifelike gliding, rotating, pulsating structures instead of
// Life's own blocky discrete ones. Every step:
//   A(t+dt) = clip( A(t) + dt · G( K ⊛ A(t) ), 0, 1 )
// K ⊛ A is a real 2D convolution — every point's own new value depends on
// a *weighted average* of a whole neighborhood, not just its immediate
// neighbors — through K, a smooth ring-shaped kernel (peaked at a nonzero
// radius, vanishing at both the center and the outer edge; see the kernel
// precompute below) normalized so its weights sum to exactly 1, which
// guarantees the convolution itself never leaves the [0, 1] range A
// already lives in — a convex combination of in-range values can't exceed
// that range, a real property of the construction, not an accident this
// happens to hold. G is a growth function — a Gaussian bump centered at μ
// with width σ, remapped to [−1, 1] — so a neighborhood's own convolved
// "reading" close to μ grows, one far from μ decays; clip() bounds the
// result every step regardless of how G, K, μ, or σ are tuned, so unlike
// InkBloomField's own diffusion terms this system has no dt-driven
// instability to guard against at all, by construction.
//
// This is InkBloomField's nearest relative in the app — both are a scalar
// field re-evaluated from its own recent neighborhood every step — but a
// genuinely different mathematical object underneath: Gray-Scott's
// Laplacian is a *differential* operator (a local finite-difference
// approximation of a second derivative, peaked and negative exactly at
// the center); Lenia's kernel is an *integral* one (a nonlocal weighted
// average over a real neighborhood, positive throughout, peaked away from
// the center). That difference in kind — not just in the numbers — is
// what separates smooth organic blooming from creatures that actually
// glide.
//
// The kernel core and growth function below are the standard Lenia
// *construction* (a smooth normalized ring, a Gaussian growth mapping);
// unlike Gray-Scott's named regimes (ChladniField's own mode pairs,
// InkBloomPanel's own presets), the exact μ/σ that produce a specific
// named "species" (Chan's own catalog includes dozens) aren't reproduced
// here from memory with real confidence — μ/σ are live sliders in
// LeniaPanel.jsx for exactly that reason, the honest hedge every
// hand-tuned-rather-than-derived constant in this app's Particles/ series
// already gets.
//
// The convolution itself is genuinely expensive — every fragment samples
// its whole KERNEL_DIM × KERNEL_DIM neighborhood, not a fixed 9-point
// stencil — so GRID_DIM and KERNEL_RADIUS below are both deliberately
// smaller than InkBloomField's own 256×256/3×3 (96×96 texels, 13×13
// taps): 96² × 169 taps × STEPS_PER_FRAME(2) ≈ 3.1M texture samples/frame,
// the same order of magnitude InkBloomField's own 256² × 9 × 10 ≈ 5.9M
// already runs at — a deliberately re-balanced budget (fewer, pricier
// texels), not a smaller one. GLSL ES 1.0 also requires a for-loop's own
// bound to be a compile-time constant, not a uniform — KERNEL_DIM is
// template-interpolated directly into the shader source below so the
// JS-side kernel precompute and the GLSL loop bound can never drift out
// of sync with each other, rather than being separately hardcoded twice.
const GRID_DIM = 96;
const KERNEL_RADIUS = 6;
const KERNEL_DIM = KERNEL_RADIUS * 2 + 1; // 13

// Where the ring peaks and how wide it is, both as a fraction of
// KERNEL_RADIUS — 0.5 puts the ring at half the kernel's own reach, a
// standard, safe middle ground (peaked well clear of both the vanishing
// center and the vanishing outer edge).
const RING_PEAK = 0.5;
const RING_SIGMA = 0.15;

const STEPS_PER_FRAME = 2;
const DT = 0.12;

const DEFAULT_MU = 0.15;
const DEFAULT_SIGMA = 0.017;

const PAINT_SEED_RADIUS = 5; // sim-grid texels, not CSS pixels
const INITIAL_BLOB_COUNT = 6;
const INITIAL_BLOB_RADIUS = 7;
const INITIAL_BURST_STEPS = 180; // enough that the opening soup has already started organizing, not raw noise — the same fixed burst runs regardless of reduceMotion (see resetSim() below), since InkBloomField's own "already alive" opening is what this follows, not the separate bigger-burst-for-reduced-motion pattern ChladniField/BoidField/CrystalField/PendulumField use for THEIR different reason (those let full-motion visitors watch a dramatic live unfold from a bare starting point instead)
const REDUCED_MOTION_PAINT_STEPS = 30;

const STATS_EMIT_MS = 150;

const PASSTHROUGH_VERT = `
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`;

// The convolution + growth + integrate step. uKernel is a precomputed
// KERNEL_DIM × KERNEL_DIM lookup (see the JS-side kernel build below) —
// sampled with NearestFilter at exact texel centers, so this is a real
// weight lookup, never an interpolated approximation of one.
const SIM_FRAG = `
  precision highp float;
  uniform sampler2D uState;
  uniform sampler2D uKernel;
  uniform vec2 uResolution;
  uniform float uMu;
  uniform float uSigma;
  uniform float uDt;
  uniform float uSeedActive;
  uniform vec2 uSeedPos;
  uniform float uSeedRadius;

  void main() {
    vec2 texel = 1.0 / uResolution;
    vec2 uv = gl_FragCoord.xy * texel;

    float convSum = 0.0;
    for (int ky = 0; ky < ${KERNEL_DIM}; ky++) {
      for (int kx = 0; kx < ${KERNEL_DIM}; kx++) {
        vec2 offset = vec2(float(kx), float(ky)) - float(${KERNEL_RADIUS});
        float stateVal = texture2D(uState, uv + offset * texel).r;
        vec2 kernelUv = (vec2(float(kx), float(ky)) + 0.5) / float(${KERNEL_DIM});
        float kernelVal = texture2D(uKernel, kernelUv).r;
        convSum += stateVal * kernelVal;
      }
    }

    float centered = convSum - uMu;
    float growth = 2.0 * exp(-(centered * centered) / (2.0 * uSigma * uSigma)) - 1.0;

    float current = texture2D(uState, uv).r;
    float next = current + uDt * growth;

    if (uSeedActive > 0.5) {
      float d = distance(gl_FragCoord.xy, uSeedPos);
      float s = smoothstep(uSeedRadius, 0.0, d);
      next = max(next, s);
    }

    gl_FragColor = vec4(clamp(next, 0.0, 1.0), 0.0, 0.0, 1.0);
  }
`;

// Field value -> paper color, a plain smoothstep threshold — a display
// choice kept separate from the physics above, same separation
// InkBloomField's own display pass already draws.
const DISPLAY_FRAG = `
  precision highp float;
  uniform sampler2D uState;
  uniform vec2 uResolution;
  uniform vec3 uPaper;
  uniform vec3 uInk;

  void main() {
    vec2 uv = gl_FragCoord.xy / uResolution;
    float v = texture2D(uState, uv).r;
    float t = smoothstep(0.12, 0.55, v);
    gl_FragColor = vec4(mix(uPaper, uInk, t), 1.0);
  }
`;

// active/reduceMotion follow every other Particles/ field's own contract.
// mu/sigma are read fresh every frame via refs, so LeniaPanel's own
// sliders retune the live growth function with no reset needed — the same
// live-retune contract ChladniField's mode steppers and InkBloomField's
// feed/kill both already establish. resetToken bumps to reseed a random
// soup under whatever mu/sigma are current right now (the panel's own
// "Reseed" button), the same explicit-not-automatic reset InkBloomPanel's
// own presets use. onSteps mirrors InkBloomField's own onSteps.
const LeniaField = ({
  active,
  reduceMotion = false,
  mu = DEFAULT_MU,
  sigma = DEFAULT_SIGMA,
  resetToken = 0,
  onSteps,
}) => {
  const canvasRef = useRef(null);
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  const muRef = useRef(mu);
  muRef.current = mu;
  const sigmaRef = useRef(sigma);
  sigmaRef.current = sigma;
  const onStepsRef = useRef(onSteps);
  useEffect(() => { onStepsRef.current = onSteps; });
  const resetFnRef = useRef(null);

  useEffect(() => {
    if (!active) return undefined;

    const canvas = canvasRef.current;
    const parent = canvas.parentElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: false });
    renderer.setPixelRatio(dpr);
    renderer.autoClear = false;

    const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadGeometry = new THREE.PlaneGeometry(2, 2);

    // Wraps (a torus), not clamped — InkBloomField's own ink deliberately
    // stays on the page (ClampToEdgeWrapping, "ink doesn't leave the
    // paper"); a Lenia creature is closer to an independent organism than
    // a stain, and should be able to glide continuously across an edge
    // and carry on rather than meeting a wall there, so RepeatWrapping —
    // a genuine, deliberate difference from InkBloomField, not an
    // inconsistency with it.
    const makeTarget = () => new THREE.WebGLRenderTarget(GRID_DIM, GRID_DIM, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    });

    let targetA = makeTarget();
    let targetB = makeTarget();
    let read = targetA;
    let write = targetB;
    let totalSteps = 0;

    // The ring kernel — see the file header for the shape and why it's
    // normalized to sum to 1. Built once; μ/σ (the growth function, a
    // completely separate thing from the kernel's own shape) are live
    // uniforms instead, never requiring this to be rebuilt.
    const kernelData = new Float32Array(KERNEL_DIM * KERNEL_DIM);
    let kernelSum = 0;
    for (let ky = 0; ky < KERNEL_DIM; ky++) {
      for (let kx = 0; kx < KERNEL_DIM; kx++) {
        const dx = kx - KERNEL_RADIUS;
        const dy = ky - KERNEL_RADIUS;
        const r = Math.hypot(dx, dy) / KERNEL_RADIUS;
        const w = r <= 1 ? Math.exp(-((r - RING_PEAK) ** 2) / (2 * RING_SIGMA * RING_SIGMA)) : 0;
        kernelData[ky * KERNEL_DIM + kx] = w;
        kernelSum += w;
      }
    }
    for (let i = 0; i < kernelData.length; i++) kernelData[i] /= kernelSum;

    const kernelTexture = new THREE.DataTexture(kernelData, KERNEL_DIM, KERNEL_DIM, THREE.RedFormat, THREE.FloatType);
    kernelTexture.minFilter = THREE.NearestFilter;
    kernelTexture.magFilter = THREE.NearestFilter;
    kernelTexture.needsUpdate = true;

    const simUniforms = {
      uState: { value: null },
      uKernel: { value: kernelTexture },
      uResolution: { value: new THREE.Vector2(GRID_DIM, GRID_DIM) },
      uMu: { value: DEFAULT_MU },
      uSigma: { value: DEFAULT_SIGMA },
      uDt: { value: DT },
      uSeedActive: { value: 0 },
      uSeedPos: { value: new THREE.Vector2(0, 0) },
      uSeedRadius: { value: PAINT_SEED_RADIUS },
    };
    const simMaterial = new THREE.ShaderMaterial({
      uniforms: simUniforms,
      vertexShader: PASSTHROUGH_VERT,
      fragmentShader: SIM_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    const simScene = new THREE.Scene();
    simScene.add(new THREE.Mesh(quadGeometry, simMaterial));

    const displayUniforms = {
      uState: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uPaper: { value: new THREE.Color(resolveCssColor("var(--page-surface-color)")) },
      uInk: { value: new THREE.Color(resolveCssColor("var(--page-ink-color)")) },
    };
    const displayMaterial = new THREE.ShaderMaterial({
      uniforms: displayUniforms,
      vertexShader: PASSTHROUGH_VERT,
      fragmentShader: DISPLAY_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    const displayScene = new THREE.Scene();
    displayScene.add(new THREE.Mesh(quadGeometry, displayMaterial));

    const themeObserver = new MutationObserver(() => {
      displayUniforms.uPaper.value.set(resolveCssColor("var(--page-surface-color)"));
      displayUniforms.uInk.value.set(resolveCssColor("var(--page-ink-color)"));
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    // Same ping-pong step InkBloomField.jsx already uses: read the current
    // state, write the next one, swap so `read` always ends up holding the
    // just-written, freshest data.
    const step = () => {
      simUniforms.uState.value = read.texture;
      renderer.setRenderTarget(write);
      renderer.render(simScene, quadCamera);
      const tmp = read;
      read = write;
      write = tmp;
      totalSteps += 1;
    };

    const seedAt = (px, py, radius) => {
      simUniforms.uSeedActive.value = 1;
      simUniforms.uSeedPos.value.set(px, py);
      simUniforms.uSeedRadius.value = radius;
      step();
      simUniforms.uSeedActive.value = 0;
    };

    // A blank field plus a handful of random soup blobs, then a
    // synchronous burst so the panel opens on soup that's already started
    // organizing rather than raw noise — the same "already alive" opening
    // state InkBloomField's own reset uses, for the same reason: watching
    // it emerge from literal nothing isn't the interesting part, watching
    // what it's already becoming is.
    const resetSim = () => {
      renderer.setRenderTarget(targetA);
      renderer.setClearColor(new THREE.Color(0, 0, 0), 1);
      renderer.clear(true, true, false);
      renderer.setRenderTarget(targetB);
      renderer.clear(true, true, false);
      read = targetA;
      write = targetB;
      totalSteps = 0;

      for (let i = 0; i < INITIAL_BLOB_COUNT; i++) {
        seedAt(
          (0.15 + Math.random() * 0.7) * GRID_DIM,
          (0.15 + Math.random() * 0.7) * GRID_DIM,
          INITIAL_BLOB_RADIUS,
        );
      }
      for (let i = 0; i < INITIAL_BURST_STEPS; i++) step();
    };
    resetFnRef.current = resetSim;
    resetSim();

    const resize = () => {
      const cssW = parent.clientWidth || 1;
      const cssH = parent.clientHeight || 1;
      renderer.setSize(cssW, cssH, false);
      displayUniforms.uResolution.value.set(cssW * dpr, cssH * dpr);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(parent);

    // Paint-to-seed: same technique and coordinate handling as
    // InkBloomField.jsx's own pointer paint (see that file's own comment
    // for the DOM -> grid-pixel Y-flip reasoning, identical here).
    let seeding = false;
    let seedX = 0;
    let seedY = 0;
    const simPosFromEvent = (e) => {
      const rect = canvas.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width;
      const ny = (e.clientY - rect.top) / rect.height;
      return { x: nx * GRID_DIM, y: (1 - ny) * GRID_DIM };
    };

    const handlePointerDown = (e) => {
      const p = simPosFromEvent(e);
      seeding = true;
      seedX = p.x;
      seedY = p.y;
      if (reduceMotionRef.current) {
        simUniforms.uMu.value = muRef.current;
        simUniforms.uSigma.value = sigmaRef.current;
        for (let i = 0; i < REDUCED_MOTION_PAINT_STEPS; i++) seedAt(seedX, seedY, PAINT_SEED_RADIUS);
      }
    };
    const handlePointerMove = (e) => {
      if (!seeding) return;
      const p = simPosFromEvent(e);
      seedX = p.x;
      seedY = p.y;
      if (reduceMotionRef.current) {
        simUniforms.uMu.value = muRef.current;
        simUniforms.uSigma.value = sigmaRef.current;
        for (let i = 0; i < 8; i++) seedAt(seedX, seedY, PAINT_SEED_RADIUS);
      }
    };
    const handlePointerUp = () => { seeding = false; };

    canvas.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    let raf = null;
    let lastStatsEmit = 0;

    const tick = () => {
      raf = requestAnimationFrame(tick);

      simUniforms.uMu.value = muRef.current;
      simUniforms.uSigma.value = sigmaRef.current;

      if (!reduceMotionRef.current) {
        simUniforms.uSeedActive.value = seeding ? 1 : 0;
        if (seeding) {
          simUniforms.uSeedPos.value.set(seedX, seedY);
          simUniforms.uSeedRadius.value = PAINT_SEED_RADIUS;
        }
        for (let i = 0; i < STEPS_PER_FRAME; i++) step();
        simUniforms.uSeedActive.value = 0;
      }

      displayUniforms.uState.value = read.texture;
      renderer.setRenderTarget(null);
      renderer.render(displayScene, quadCamera);

      const now = performance.now();
      if (onStepsRef.current && now - lastStatsEmit > STATS_EMIT_MS) {
        lastStatsEmit = now;
        onStepsRef.current(totalSteps);
      }
    };

    const handleVisibility = () => {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = null;
      } else if (!raf) {
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
      resetFnRef.current = null;
      quadGeometry.dispose();
      simMaterial.dispose();
      displayMaterial.dispose();
      kernelTexture.dispose();
      targetA.dispose();
      targetB.dispose();
      renderer.dispose();
    };
  }, [active]);

  useEffect(() => {
    if (resetToken > 0) resetFnRef.current?.();
  }, [resetToken]);

  return (
    <canvas
      ref={ canvasRef }
      className="lenia-field-canvas"
      aria-hidden="true"
    />
  );
};

export default LeniaField;
