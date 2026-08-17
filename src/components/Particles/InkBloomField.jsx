import { useEffect, useRef } from "react";
import * as THREE from "three";

import { resolveCssColor } from "../History/HistoryAmbient";

import "./InkBloomField.css";

THREE.ColorManagement.enabled = false;

// A real Gray-Scott reaction-diffusion system — Turing's 1952 model for how
// two uniformly-mixed chemicals can spontaneously pattern an otherwise
// featureless surface ("The Chemical Basis of Morphogenesis"), in the
// specific activator/substrate formulation Pearson made famous for
// producing an enormous range of patterns from one pair of equations
// ("Complex Patterns in a Simple System," Science, 1993):
//   du/dt = Du·∇²u − uv² + f(1−u)
//   dv/dt = Dv·∇²v + uv² − (f+k)v
// u is the substrate (blank page), v the activator (ink); uv² is the
// reaction itself — it consumes substrate to make more ink exactly where
// ink already is, which is what turns one seeded point into a spreading,
// branching bloom rather than a fading dot. f resupplies substrate
// everywhere at a fixed feed rate, k is how fast ink decays; the balance
// between those two constants alone is what decides whether a given seed
// dies out, explodes to fill the page, or settles into spots, stripes,
// coral, or slowly-dividing "mitosis" blobs — see the FEED/KILL presets in
// InkBloomPanel.jsx.
//
// Every other Particles/ demo in this app integrates an ODE (GravityField's
// N bodies, ParticleCuboid's lattice, each body/point only ever pushed by
// forces, never by its neighbors' own *state*) or a constraint system
// (ClothField). This is the first one that's genuinely a PDE over space
// too: each point's rate of change depends on its neighbors' u/v through
// the Laplacian terms above, which is the actual mechanism (a "short-range
// activation, long-range inhibition" instability) that lets a uniform field
// spontaneously pattern itself at all.
//
// Solved on a real GPU grid, not a hand-rolled diffusion approximation: two
// off-screen float render targets ping-pong every step (see step() below)
// — one pass's fragment shader reads last step's entire grid as a texture
// and writes the next one, the standard technique for stepping any PDE
// forward on the GPU. SplatFluidRenderer.js's own splat target is the
// closest precedent already in this app, though that one only ever needs
// last *frame's* particles as input, never last *step's own output* the
// way a genuine feedback loop does — this is the first real ping-pong in
// the app.
const SIM_DIM = 256; // fixed simulation domain, independent of the container's own pixel size — same "normalized domain, decoupled from the render surface" principle GravityField's VIEW_EXTENT and ClothField's DOMAIN_W/H already use
const STEPS_PER_FRAME = 10;
const INITIAL_BURST_STEPS = 300;
const REDUCED_MOTION_PAINT_STEPS = 40; // a single pointerdown's worth of stepping while ambient motion is off, so a tap still visibly deposits and spreads a little ink rather than doing nothing at all

// Substrate diffuses twice as fast as ink (Du = 2·Dv) — not a tuned
// aesthetic choice but the actual condition Turing's own instability
// analysis requires for a uniform field to go unstable into a pattern at
// all, rather than just smoothing flat. dt = 1 paired with the 9-point
// kernel below (see SIM_FRAG) is the standard, widely-reused Gray-Scott
// shader parameterization, kept here for a checkable reason rather than
// just copied: that kernel's off-center weights (4×0.2 + 4×0.05) sum to
// 1.0 — it's already normalized as a weighted local *average*, not a raw
// unscaled cross-Laplacian (whose off-center weights sum to 4) — so the
// operator is already about 4× gentler than the textbook explicit-diffusion
// stability bound dt ≤ dx²/(4·D) assumes for that raw form, which is what
// leaves dt = 1 with real headroom instead of sitting right on the edge of
// it. STEPS_PER_FRAME above is pure pacing on top of an already-stable
// step — how many steps run per rendered frame — never a stability
// concern the way FluidField.jsx's own SUBSTEPS is for its CFL condition.
const DU = 1.0;
const DV = 0.5;

const DEFAULT_FEED = 0.0367;
const DEFAULT_KILL = 0.0649;

const PAINT_SEED_RADIUS = 4.5; // sim-grid texels, not CSS pixels
const INITIAL_SEED_COUNT = 6;
const INITIAL_SEED_RADIUS = 3;

const STATS_EMIT_MS = 150;

const PASSTHROUGH_VERT = `
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`;

// The reaction-diffusion step itself. u/v are packed into the r/g channels
// of a single float texture rather than two separate textures — one
// ping-pong pair instead of two, since every term above reads and writes
// both fields together at the same grid point anyway.
//
// The 9-point kernel (0.05 corner / 0.2 edge / -1 center) is the standard
// isotropic Gray-Scott Laplacian — corners weighted less than edges so the
// discrete operator spreads roughly evenly in every direction instead of
// visibly favoring the grid's own horizontal/vertical axes the way a plain
// 4-neighbor cross does. Verified by hand to sum to zero (4×0.05 + 4×0.2 −
// 1 = 0) the way any discrete Laplacian must — a perfectly uniform field
// has to diffuse to nothing, or a flat, evenly-fed region would drift for
// no physical reason.
const SIM_FRAG = `
  precision highp float;
  uniform sampler2D uState;
  uniform vec2 uResolution;
  uniform float uF;
  uniform float uK;
  uniform float uSeedActive;
  uniform vec2 uSeedPos;
  uniform float uSeedRadius;

  vec2 laplacian(vec2 uv, vec2 texel) {
    vec2 sum = vec2(0.0);
    sum += texture2D(uState, uv + texel * vec2(-1.0, -1.0)).rg * 0.05;
    sum += texture2D(uState, uv + texel * vec2( 0.0, -1.0)).rg * 0.2;
    sum += texture2D(uState, uv + texel * vec2( 1.0, -1.0)).rg * 0.05;
    sum += texture2D(uState, uv + texel * vec2(-1.0,  0.0)).rg * 0.2;
    sum += texture2D(uState, uv).rg * -1.0;
    sum += texture2D(uState, uv + texel * vec2( 1.0,  0.0)).rg * 0.2;
    sum += texture2D(uState, uv + texel * vec2(-1.0,  1.0)).rg * 0.05;
    sum += texture2D(uState, uv + texel * vec2( 0.0,  1.0)).rg * 0.2;
    sum += texture2D(uState, uv + texel * vec2( 1.0,  1.0)).rg * 0.05;
    return sum;
  }

  void main() {
    vec2 texel = 1.0 / uResolution;
    vec2 uv = gl_FragCoord.xy * texel;
    vec2 state = texture2D(uState, uv).rg;
    float u = state.r;
    float v = state.g;

    vec2 lap = laplacian(uv, texel);
    float reaction = u * v * v;
    // Du/Dv mirror the DU/DV constants above verbatim (not read as
    // uniforms — they never change at runtime, unlike uF/uK, so there is
    // nothing a uniform would buy here beyond an extra JS->GPU upload).
    float du = 1.0 * lap.r - reaction + uF * (1.0 - u);
    float dv = 0.5 * lap.g + reaction - (uF + uK) * v;

    u += du;
    v += dv;

    // Pointer-seeded ink: a soft circular deposit raising v (and drawing
    // down u, the substrate it's converting) centered on wherever the
    // pointer currently is, in the exact same grid-pixel space
    // gl_FragCoord already uses — see simPosFromEvent in the component
    // below for the DOM-event -> grid-pixel conversion.
    if (uSeedActive > 0.5) {
      float d = distance(gl_FragCoord.xy, uSeedPos);
      float s = smoothstep(uSeedRadius, 0.0, d);
      v = mix(v, 1.0, s);
      u = mix(u, 0.0, s * 0.6);
    }

    gl_FragColor = vec4(clamp(u, 0.0, 1.0), clamp(v, 0.0, 1.0), 0.0, 1.0);
  }
`;

// Ink concentration -> paper color. The bare v field sits on a low ambient
// baseline almost everywhere except where a bloom has genuinely risen well
// above it, so the smoothstep threshold below is a rendering choice (how
// dark the page reads), kept deliberately separate from the physics above
// the same way FluidField.jsx's own `body = smoothstep(0.5, 0.56, field)`
// is a display threshold on top of a physical density, not part of the
// density itself. The gradient-based edge term is a cheap, honest nod to
// real capillary action — ink runs darker right at a spreading edge (a
// coffee-ring, a fountain-pen feather) than in a bloom's own already-soaked
// interior — built from the same "sample four neighbors, take the gradient
// magnitude" idiom SplatFluidRenderer.js's own pseudo-normal already uses,
// just spent here on an ink tint instead of a lighting normal.
const DISPLAY_FRAG = `
  precision highp float;
  uniform sampler2D uState;
  uniform vec2 uResolution;
  uniform vec3 uPaper;
  uniform vec3 uInk;

  void main() {
    vec2 texel = 1.0 / uResolution;
    vec2 uv = gl_FragCoord.xy * texel;
    float v = texture2D(uState, uv).g;
    float t = smoothstep(0.1, 0.5, v);

    float vL = texture2D(uState, uv - vec2(texel.x, 0.0)).g;
    float vR = texture2D(uState, uv + vec2(texel.x, 0.0)).g;
    float vD = texture2D(uState, uv - vec2(0.0, texel.y)).g;
    float vU = texture2D(uState, uv + vec2(0.0, texel.y)).g;
    float grad = length(vec2(vR - vL, vU - vD));
    float edge = smoothstep(0.02, 0.4, grad) * t;

    vec3 col = mix(uPaper, uInk, t);
    col = mix(col, uInk, edge * 0.3);

    gl_FragColor = vec4(col, 1.0);
  }
`;

// active/reduceMotion follow every other Particles/ field's own contract.
// feed/kill are read fresh every frame via refs (see feedRef/killRef below)
// rather than only at mount, so InkBloomPanel's sliders retune the live
// simulation instead of only affecting the next reseed. resetToken is a
// plain counter — bumping it (a preset pick, or the panel's own reset
// button) reseeds a blank page under whatever feed/kill are current *right
// now*; it deliberately does NOT fire on every feed/kill change on its own,
// since that would reseed mid-drag on every tick of a slider, when the
// point of the sliders is to retune a pattern that's already blooming.
// onSteps mirrors GravityFieldPanel's own onSystemStats — a live reading
// for the panel chrome, throttled to STATS_EMIT_MS rather than the raw
// per-frame rate.
const InkBloomField = ({
  active,
  reduceMotion = false,
  feed = DEFAULT_FEED,
  kill = DEFAULT_KILL,
  resetToken = 0,
  onSteps,
}) => {
  const canvasRef = useRef(null);
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const killRef = useRef(kill);
  killRef.current = kill;
  const onStepsRef = useRef(onSteps);
  useEffect(() => { onStepsRef.current = onSteps; });
  const resetFnRef = useRef(null);

  useEffect(() => {
    if (!active) return undefined;

    const canvas = canvasRef.current;
    const parent = canvas.parentElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // No alpha, no antialias — the display pass always writes every pixel
    // of the canvas opaquely (a fullscreen quad, no discards), and there is
    // no polygon geometry whose edges MSAA would even apply to.
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: false });
    renderer.setPixelRatio(dpr);
    renderer.autoClear = false;

    const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadGeometry = new THREE.PlaneGeometry(2, 2);

    const makeTarget = () => new THREE.WebGLRenderTarget(SIM_DIM, SIM_DIM, {
      type: THREE.HalfFloatType,
      // Sampling always lands exactly on texel centers (gl_FragCoord.xy
      // gives pixel centers, and every neighbor lookup shifts by an exact
      // integer multiple of the texel size) — so linear filtering reduces
      // to the exact texel value here, same as nearest would, while also
      // softening the DISPLAY pass's own upscale from this fixed 256-wide
      // grid to whatever the panel's actual CSS size is, for free.
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    });

    let targetA = makeTarget();
    let targetB = makeTarget();
    let read = targetA;
    let write = targetB;
    let totalSteps = 0;

    const simUniforms = {
      uState: { value: null },
      uResolution: { value: new THREE.Vector2(SIM_DIM, SIM_DIM) },
      uF: { value: DEFAULT_FEED },
      uK: { value: DEFAULT_KILL },
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

    // Same re-tint convention as ParticleCuboid.jsx/LiquidMeter.jsx — this
    // panel can plausibly stay open across a theme toggle (reachable from
    // the command palette, which itself layers over other open panels), so
    // paper/ink shouldn't go stale until it's closed and reopened.
    const themeObserver = new MutationObserver(() => {
      displayUniforms.uPaper.value.set(resolveCssColor("var(--page-surface-color)"));
      displayUniforms.uInk.value.set(resolveCssColor("var(--page-ink-color)"));
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    // One reaction-diffusion step: read the current state, write the next
    // one, then swap so `read` always ends up holding the just-written,
    // freshest data — true after any number of calls regardless of parity,
    // since each call's own swap is self-contained.
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

    // Blank page (u=1 everywhere: full substrate, no ink) plus a handful of
    // random seed points, then a synchronous burst so the panel opens on
    // an already-blooming pattern rather than a few barely-visible dots —
    // the same "already alive the instant you open it" quality ClothField
    // (already hanging) and GravityField (22 planets already orbiting)
    // both have. Cheap enough to run synchronously: INITIAL_BURST_STEPS
    // fullscreen passes over a 256×256 grid, not a per-frame cost.
    const resetSim = () => {
      renderer.setRenderTarget(targetA);
      renderer.setClearColor(new THREE.Color(1, 0, 0), 1);
      renderer.clear(true, true, false);
      renderer.setRenderTarget(targetB);
      renderer.clear(true, true, false);
      read = targetA;
      write = targetB;
      totalSteps = 0;

      for (let i = 0; i < INITIAL_SEED_COUNT; i++) {
        seedAt(
          (0.2 + Math.random() * 0.6) * SIM_DIM,
          (0.2 + Math.random() * 0.6) * SIM_DIM,
          INITIAL_SEED_RADIUS,
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

    // Paint-to-seed: press and drag deposits ink at the pointer, converted
    // from DOM client coordinates into the same grid-pixel space
    // gl_FragCoord uses in the sim pass — a Y-flip is required since CSS
    // clientY grows downward from the element's top while gl_FragCoord.y
    // grows upward from the framebuffer's bottom (the standard WebGL
    // convention, consistent between this render target and the default
    // framebuffer alike, which is exactly what keeps the display pass
    // right-side-up with no separate flip of its own anywhere else).
    let seeding = false;
    let seedX = 0;
    let seedY = 0;
    const simPosFromEvent = (e) => {
      const rect = canvas.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width;
      const ny = (e.clientY - rect.top) / rect.height;
      return { x: nx * SIM_DIM, y: (1 - ny) * SIM_DIM };
    };

    const handlePointerDown = (e) => {
      const p = simPosFromEvent(e);
      seeding = true;
      seedX = p.x;
      seedY = p.y;
      if (reduceMotionRef.current) {
        // The ambient loop below won't carry this any further while motion
        // is reduced, so a tap gets its own small synchronous burst right
        // here instead — interaction still visibly spreads ink, ambient
        // auto-blooming just doesn't continue on its own afterward.
        simUniforms.uF.value = feedRef.current;
        simUniforms.uK.value = killRef.current;
        for (let i = 0; i < REDUCED_MOTION_PAINT_STEPS; i++) seedAt(seedX, seedY, PAINT_SEED_RADIUS);
      }
    };
    const handlePointerMove = (e) => {
      if (!seeding) return;
      const p = simPosFromEvent(e);
      seedX = p.x;
      seedY = p.y;
      if (reduceMotionRef.current) {
        simUniforms.uF.value = feedRef.current;
        simUniforms.uK.value = killRef.current;
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

      simUniforms.uF.value = feedRef.current;
      simUniforms.uK.value = killRef.current;

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
      targetA.dispose();
      targetB.dispose();
      renderer.dispose();
    };
  }, [active]);

  // A preset pick or the panel's own reset button bumps resetToken —
  // guarded to >0 so mounting with the default value never fires a
  // redundant reseed on top of resetSim()'s own call above, and resetFnRef
  // is nulled out on unmount (cleanup above) so a stale bump after the
  // panel has closed safely no-ops instead of touching disposed GPU
  // resources.
  useEffect(() => {
    if (resetToken > 0) resetFnRef.current?.();
  }, [resetToken]);

  return (
    <canvas
      ref={ canvasRef }
      className="ink-bloom-canvas"
      aria-hidden="true"
    />
  );
};

export default InkBloomField;
