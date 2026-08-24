import { useEffect, useRef } from "react";
import * as THREE from "three";
import gsap from "gsap";

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

// Up to this many simultaneous pointers (fingers) can each paint their own
// ink at once — see uMultiSeedPos in SIM_FRAG. Extra pointers beyond this
// cap are simply not tracked, same "cap and ignore the rest" approach
// MAX_RIPPLES takes in CursorDot.jsx.
const MAX_SEEDS = 4;
const OFFGRID = -9999; // parks an unused multi-seed slot far outside the 0..SIM_DIM domain so its smoothstep falloff is always exactly 0

// Pointer-drag velocity (in sim texels/ms, see handlePointerMove) is turned
// into uFlowDir's magnitude by this factor, then smoothed and capped —
// tuned by feel against this exact SIM_DIM/DOM mapping the same way every
// other constant in this file is, not trusted from a formula alone.
const FLOW_VELOCITY_TO_MAG = 1.2;
const MAX_FLOW_MAG = 1.4;
const FLOW_SMOOTH = 0.25; // low-pass factor, same shape as CursorDot's VEL_SMOOTH
const FLOW_DECAY = 0.94; // per-frame decay back toward isotropic once the pointer stops/lifts

// A scripted tour through Pearson's own named regimes, recovered verbatim
// from InkBloomPanel.jsx's own hand-tuned PRESETS table (that panel is
// gone, but these coordinates were tuned against this exact grid/timestep
// and are worth keeping rather than re-guessing). Deliberately skips
// "worms" (visually the least distinct next to coral) and ends on mitosis
// — DEFAULT_FEED/DEFAULT_KILL above — so an autoplay sweep settles back on
// the same look the sim already opens with.
const PRESET_SWEEP = [
  { feed: 0.03, kill: 0.062 }, // spots
  { feed: 0.03, kill: 0.057 }, // stripes
  { feed: 0.0545, kill: 0.062 }, // coral
  { feed: DEFAULT_FEED, kill: DEFAULT_KILL }, // mitosis
];
const SWEEP_EASE_S = 1.8; // time spent morphing between two regimes
const SWEEP_HOLD_S = 2.2; // time spent sitting in a regime before the next morph

// How many sim steps it takes a freshly-crossed texel's age to fully
// saturate (see the age channel comment on SIM_FRAG below) — chosen so a
// bloom visibly reads as "young" for a couple of seconds at STEPS_PER_FRAME
// * 60fps before settling into its final aged tone.
const AGE_RATE = 1 / 1500;

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
  uniform vec2 uMultiSeedPos[${MAX_SEEDS}];
  uniform vec2 uFlowDir;

  // Same 9-point isotropic kernel as before, but each neighbor's own
  // contribution is now nudged up or down by how well its direction lines
  // up with uFlowDir (paper-grain / gravity bias, fed from pointer drag
  // velocity — see handlePointerMove below) before the center weight is
  // derived as the negative sum of every neighbor. That's what keeps the
  // operator summing to exactly zero for ANY uFlowDir, not just the
  // isotropic (0,0) case — a perfectly uniform field still can't drift for
  // no reason, the same invariant the original fixed kernel held (see the
  // file-level comment above).
  vec2 laplacian(vec2 uv, vec2 texel) {
    vec2 dNW = vec2(-1.0, -1.0); vec2 dN = vec2(0.0, -1.0); vec2 dNE = vec2(1.0, -1.0);
    vec2 dW  = vec2(-1.0,  0.0);                             vec2 dE  = vec2(1.0,  0.0);
    vec2 dSW = vec2(-1.0,  1.0); vec2 dS = vec2(0.0,  1.0); vec2 dSE = vec2(1.0,  1.0);

    float FLOW_STRENGTH = 0.6;
    float wNW = 0.05 * (1.0 + dot(normalize(dNW), uFlowDir) * FLOW_STRENGTH);
    float wN  = 0.2  * (1.0 + dot(normalize(dN),  uFlowDir) * FLOW_STRENGTH);
    float wNE = 0.05 * (1.0 + dot(normalize(dNE), uFlowDir) * FLOW_STRENGTH);
    float wW  = 0.2  * (1.0 + dot(normalize(dW),  uFlowDir) * FLOW_STRENGTH);
    float wE  = 0.2  * (1.0 + dot(normalize(dE),  uFlowDir) * FLOW_STRENGTH);
    float wSW = 0.05 * (1.0 + dot(normalize(dSW), uFlowDir) * FLOW_STRENGTH);
    float wS  = 0.2  * (1.0 + dot(normalize(dS),  uFlowDir) * FLOW_STRENGTH);
    float wSE = 0.05 * (1.0 + dot(normalize(dSE), uFlowDir) * FLOW_STRENGTH);

    vec2 sum = vec2(0.0);
    sum += texture2D(uState, uv + texel * dNW).rg * wNW;
    sum += texture2D(uState, uv + texel * dN ).rg * wN;
    sum += texture2D(uState, uv + texel * dNE).rg * wNE;
    sum += texture2D(uState, uv + texel * dW ).rg * wW;
    sum += texture2D(uState, uv + texel * dE ).rg * wE;
    sum += texture2D(uState, uv + texel * dSW).rg * wSW;
    sum += texture2D(uState, uv + texel * dS ).rg * wS;
    sum += texture2D(uState, uv + texel * dSE).rg * wSE;

    float wCenter = wNW + wN + wNE + wW + wE + wSW + wS + wSE;
    sum += texture2D(uState, uv).rg * -wCenter;
    return sum;
  }

  void main() {
    vec2 texel = 1.0 / uResolution;
    vec2 uv = gl_FragCoord.xy * texel;
    vec4 raw = texture2D(uState, uv);
    float u = raw.r;
    float v = raw.g;
    float age = raw.b;

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
    // below for the DOM-event -> grid-pixel conversion. This single-seed
    // path stays reserved for one-shot bursts (the initial scatter,
    // reduced-motion taps) — see seedAt() below.
    if (uSeedActive > 0.5) {
      float d = distance(gl_FragCoord.xy, uSeedPos);
      float s = smoothstep(uSeedRadius, 0.0, d);
      v = mix(v, 1.0, s);
      u = mix(u, 0.0, s * 0.6);
    }

    // Continuous multi-pointer painting: up to MAX_SEEDS simultaneous
    // fingers/pointers each deposit their own blob every step, reusing the
    // exact smoothstep-deposit math above. Inactive slots are parked far
    // off the 0..uResolution domain (see OFFGRID in the component) so
    // their distance is always huge and s is always ~0 — no branch or
    // count uniform needed.
    for (int i = 0; i < ${MAX_SEEDS}; i++) {
      float d2 = distance(gl_FragCoord.xy, uMultiSeedPos[i]);
      float s2 = smoothstep(uSeedRadius, 0.0, d2);
      v = mix(v, 1.0, s2);
      u = mix(u, 0.0, s2 * 0.6);
    }

    // Bloom-age tracking: once a texel first crosses the same v > 0.1
    // threshold DISPLAY_FRAG uses to start rendering ink, its age climbs
    // every step it stays inked, saturating at 1.0. Pausing (not
    // resetting) while v dips back below the threshold means age reads as
    // "how long has this texel actually been inked," not "is it inked
    // right now" — see DISPLAY_FRAG for how it's turned into a color.
    if (v > 0.1 && age < 1.0) {
      age += ${AGE_RATE};
    }

    gl_FragColor = vec4(clamp(u, 0.0, 1.0), clamp(v, 0.0, 1.0), clamp(age, 0.0, 1.0), 1.0);
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
    vec4 raw = texture2D(uState, uv);
    float v = raw.g;
    float age = raw.b;
    float t = smoothstep(0.1, 0.5, v);

    float vL = texture2D(uState, uv - vec2(texel.x, 0.0)).g;
    float vR = texture2D(uState, uv + vec2(texel.x, 0.0)).g;
    float vD = texture2D(uState, uv - vec2(0.0, texel.y)).g;
    float vU = texture2D(uState, uv + vec2(0.0, texel.y)).g;
    float grad = length(vec2(vR - vL, vU - vD));
    float edge = smoothstep(0.02, 0.4, grad) * t;

    // Age-driven 3-stop ink gradient: a texel that just crossed the ink
    // threshold starts a touch darker/wetter-looking than the resting
    // uInk tone, then bleeds toward a softer, slightly paper-lightened
    // tone as it matures — so a bloom visibly records which part grew
    // first instead of every drop of ink, old or new, reading identically.
    vec3 inkFresh = clamp(uInk * 1.18, 0.0, 1.0);
    vec3 inkFaded = mix(uInk, uPaper, 0.32);
    vec3 agedInk = age < 0.5
      ? mix(inkFresh, uInk, age * 2.0)
      : mix(uInk, inkFaded, (age - 0.5) * 2.0);

    vec3 col = mix(uPaper, agedInk, t);
    col = mix(col, agedInk, edge * 0.3);

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
  autoplay = false,
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
  // Lets the separate autoplay effect below reach the live simUniforms
  // object the mount effect owns, without re-running the whole WebGL setup
  // whenever the `autoplay` prop flips.
  const uniformsHandleRef = useRef(null);
  // True only while the autoplay GSAP sweep is actively driving uF/uK
  // itself — tick() checks this so the sweep's own values aren't
  // immediately stomped by the ordinary feedRef/killRef assignment every
  // frame runs otherwise.
  const autoplayActiveRef = useRef(false);

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
      uMultiSeedPos: { value: Array.from({ length: MAX_SEEDS }, () => new THREE.Vector2(OFFGRID, OFFGRID)) },
      uFlowDir: { value: new THREE.Vector2(0, 0) },
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
    uniformsHandleRef.current = { sim: simUniforms };

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
      // A reset can land mid-drag (a preset pick while actively painting)
      // — clear any live multi-seed positions tick() last wrote so the
      // fresh scatter/burst below isn't co-deposited on top of wherever
      // the pointer happens to currently be.
      for (let i = 0; i < MAX_SEEDS; i++) simUniforms.uMultiSeedPos.value[i].set(OFFGRID, OFFGRID);

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
    // pointerId -> {x, y} in sim-grid space, one entry per currently-down
    // pointer (up to MAX_SEEDS) — replaces the old single seeding/seedX/
    // seedY trio so multiple simultaneous fingers each paint their own ink.
    const activePointers = new Map();
    // Smoothed drag-velocity direction+magnitude fed straight into
    // uFlowDir every ambient frame (see tick() below); decays back toward
    // (0,0) — isotropic diffusion — once no pointer is moving.
    const flow = { x: 0, y: 0 };
    // pointerId -> { x, y, t } (sim-grid space / performance.now() ms) —
    // keyed per-pointer so a second finger's move event can never compute
    // its "velocity" as the delta from a DIFFERENT finger's last position.
    const lastMoveByPointer = new Map();

    const simPosFromEvent = (e) => {
      const rect = canvas.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width;
      const ny = (e.clientY - rect.top) / rect.height;
      return { x: nx * SIM_DIM, y: (1 - ny) * SIM_DIM };
    };

    const handlePointerDown = (e) => {
      const p = simPosFromEvent(e);
      // Tracked regardless of reduceMotion so handlePointerMove's own
      // reduceMotion branch below (gated on activePointers.has) still
      // recognizes this pointer as down; capped at MAX_SEEDS either way.
      if (activePointers.size < MAX_SEEDS) activePointers.set(e.pointerId, p);
      if (reduceMotionRef.current) {
        // The ambient loop below won't carry this any further while motion
        // is reduced, so a tap gets its own small synchronous burst right
        // here instead — interaction still visibly spreads ink, ambient
        // auto-blooming just doesn't continue on its own afterward. Still
        // single-point (uses seedAt's original uSeedPos, not
        // uMultiSeedPos) since reduced motion only needs a tap to
        // register, not true simultaneous-touch fidelity.
        simUniforms.uF.value = feedRef.current;
        simUniforms.uK.value = killRef.current;
        for (let i = 0; i < REDUCED_MOTION_PAINT_STEPS; i++) seedAt(p.x, p.y, PAINT_SEED_RADIUS);
      }
    };
    const handlePointerMove = (e) => {
      if (reduceMotionRef.current) {
        if (!activePointers.has(e.pointerId)) return;
        const p = simPosFromEvent(e);
        activePointers.set(e.pointerId, p);
        simUniforms.uF.value = feedRef.current;
        simUniforms.uK.value = killRef.current;
        for (let i = 0; i < 8; i++) seedAt(p.x, p.y, PAINT_SEED_RADIUS);
        return;
      }
      if (!activePointers.has(e.pointerId)) return;
      const p = simPosFromEvent(e);
      activePointers.set(e.pointerId, p);

      const now = performance.now();
      const prev = lastMoveByPointer.get(e.pointerId);
      if (prev) {
        const dt = Math.max(now - prev.t, 1);
        const vx = (p.x - prev.x) / dt;
        const vy = (p.y - prev.y) / dt;
        const speed = Math.hypot(vx, vy);
        if (speed > 1e-4) {
          const mag = Math.min(speed * FLOW_VELOCITY_TO_MAG, MAX_FLOW_MAG);
          const nx = (vx / speed) * mag;
          const ny = (vy / speed) * mag;
          flow.x += (nx - flow.x) * FLOW_SMOOTH;
          flow.y += (ny - flow.y) * FLOW_SMOOTH;
        }
      }
      lastMoveByPointer.set(e.pointerId, { x: p.x, y: p.y, t: now });
    };
    const handlePointerUp = (e) => {
      activePointers.delete(e.pointerId);
      lastMoveByPointer.delete(e.pointerId);
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    let raf = null;
    let lastStatsEmit = 0;

    const tick = () => {
      raf = requestAnimationFrame(tick);

      // While the autoplay sweep (see the effect below) is actively
      // driving uF/uK itself via its own GSAP onUpdate, leave them alone
      // here — otherwise this line would stomp the sweep's tweened value
      // right back to the plain feed/kill prop every single frame.
      if (!autoplayActiveRef.current) {
        simUniforms.uF.value = feedRef.current;
        simUniforms.uK.value = killRef.current;
      }

      // Kept fresh every frame regardless of reduceMotion (cheap CPU-side
      // writes, no GPU cost) so any step() call — the ambient loop below,
      // or a reduced-motion seedAt() burst in handlePointerDown/Move —
      // never reads a multi-seed slot or brush radius left stale from
      // before reduceMotion last flipped, or from resetSim()'s own
      // temporary INITIAL_SEED_RADIUS.
      simUniforms.uSeedRadius.value = PAINT_SEED_RADIUS;
      const posArray = simUniforms.uMultiSeedPos.value;
      let seedIdx = 0;
      for (const p of activePointers.values()) {
        if (seedIdx >= MAX_SEEDS) break;
        posArray[seedIdx].set(p.x, p.y);
        seedIdx++;
      }
      for (; seedIdx < MAX_SEEDS; seedIdx++) posArray[seedIdx].set(OFFGRID, OFFGRID);

      if (!reduceMotionRef.current) {
        flow.x *= FLOW_DECAY;
        flow.y *= FLOW_DECAY;
        simUniforms.uFlowDir.value.set(flow.x, flow.y);

        for (let s = 0; s < STEPS_PER_FRAME; s++) step();
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
      window.removeEventListener("pointercancel", handlePointerUp);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      resetFnRef.current = null;
      uniformsHandleRef.current = null;
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

  // Scripted feed/kill sweep — an idle/tour pass through Pearson's named
  // regimes (see PRESET_SWEEP above), morphing the LIVE simulation from
  // one pattern language to the next rather than reseeding between them,
  // so the transition itself is watchable. Skipped under reduced motion,
  // same as every other purely-decorative continuous motion in this app.
  useEffect(() => {
    if (!active || !autoplay || reduceMotion) return undefined;
    const handle = uniformsHandleRef.current;
    if (!handle) return undefined;

    autoplayActiveRef.current = true;
    const sweep = { feed: DEFAULT_FEED, kill: DEFAULT_KILL };
    const tl = gsap.timeline({
      onUpdate: () => {
        handle.sim.uF.value = sweep.feed;
        handle.sim.uK.value = sweep.kill;
      },
      onComplete: () => { autoplayActiveRef.current = false; },
    });
    PRESET_SWEEP.forEach((preset) => {
      tl.to(sweep, { feed: preset.feed, kill: preset.kill, duration: SWEEP_EASE_S, ease: "sine.inOut" })
        .to(sweep, { duration: SWEEP_HOLD_S });
    });

    return () => {
      tl.kill();
      autoplayActiveRef.current = false;
    };
  }, [active, autoplay, reduceMotion]);

  return (
    <canvas
      ref={ canvasRef }
      className="ink-bloom-canvas"
      aria-hidden="true"
    />
  );
};

export default InkBloomField;
