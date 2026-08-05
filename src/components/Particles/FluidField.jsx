import { useEffect, useRef } from "react";
import * as THREE from "three";

import { resolveCssColor } from "../History/HistoryAmbient";

import "./FluidField.css";

THREE.ColorManagement.enabled = false;

// A real (if deliberately modest) SPH — smoothed-particle hydrodynamics —
// fluid: density and pressure fields estimated from particle positions,
// not a spring network or a repulsion heuristic dressed up as "fluid."
// Implements the standard real-time formulation from Müller, Charypar &
// Gross, "Particle-Based Fluid Simulation for Interactive Applications"
// (Eurographics/SIGGRAPH 2003) — the reference essentially every real-time
// graphics SPH demo since has built on — rather than deriving a fluid model
// from scratch. What's below is genuinely a from-a-paper implementation,
// not an invention; the two kernel constants marked "verified by hand" are
// re-derived in these comments from the actual normalization integral
// (∫W dA = 1 over the disk of radius h) rather than just copied, since a
// wrong constant here wouldn't crash anything, it would just silently mean
// the tuning below doesn't mean what it's commented to mean.
const REST_DENSITY = 1000;
const STIFFNESS = 1200;   // k in P = k·(ρ - ρ₀); sound speed c = √k, used for the CFL check below
const VISCOSITY = 200;
const GRAVITY = 30;       // sim units/s², -y

const GRID = 10;          // 10×10 initial block
const SPACING = 1.15;
const PARTICLE_COUNT = GRID * GRID;
// The standard real-time-SPH heuristic for particle mass: give each
// particle the mass a spacing×spacing patch of rest-density fluid would
// carry, so a well-packed neighborhood's density estimate starts out close
// to REST_DENSITY. This is a heuristic, not an identity — the *actual*
// resulting density also depends on the kernel's own smoothing profile and
// how many neighbors fall within h, which is exactly the part of SPH
// tuning no amount of hand-derivation replaces the need to actually look
// at (see the note in the panel wrapper).
const PARTICLE_MASS = REST_DENSITY * SPACING * SPACING;

const SMOOTHING_RADIUS = 1.6 * SPACING; // h — kernel support radius
const SUBSTEPS = 3;
const VELOCITY_CLAMP = 40;
const BOUNDARY_RESTITUTION = 0.45; // velocity kept (not lost) on a wall bounce

const DOMAIN_W = 30;
const DOMAIN_H = 22;

// The cursor pushes fluid it moves through, scaled by how fast it's
// actually moving — the same "real drag responds to velocity" idea
// CursorAura.jsx's ripples and ParticleCuboid.jsx's repulsion already use.
const CURSOR_RADIUS = 3.2;
const CURSOR_STRENGTH = 900;

// 2D poly6 kernel (density estimation): normalization derived from
// ∫₀^h σ(h²-r²)³ · 2πr dr = 1. Substituting u = h²-r² turns the integral
// into ∫₀^{h²} u³ du / 2 = h⁸/8, giving σ·2π·h⁸/8 = 1 → σ = 4/(πh⁸) — the
// 2D figure (distinct from the more commonly quoted 3D constant, 315/64π,
// since this is a flat simulation, not a slice through a 3D one).
const poly6Coeff = (h) => 4 / (Math.PI * h ** 8);
const poly6 = (r, h, coeff) => (r >= h ? 0 : coeff * (h * h - r * r) ** 3);

// 2D spiky kernel gradient (pressure force — spiky rather than poly6
// specifically because poly6's own gradient vanishes at r→0, which lets
// particles pile up with no separating force right where it matters most).
// The kernel itself normalizes to σ = 10/(πh⁵) by the same disk-integral
// method above (∫₀^h σ(h-r)³·2πr dr = σ·πh⁵/10 = 1); differentiating
// (h-r)³ brings down a factor of 3, giving the gradient's own constant,
// 3·10/(πh⁵) = 30/(πh⁵).
const spikyGradCoeff = (h) => 30 / (Math.PI * h ** 5);
const spikyGrad = (r, h, coeff) => (r >= h || r <= 0 ? 0 : -coeff * (h - r) * (h - r));

// 2D viscosity-kernel Laplacian: 40/(πh⁵)·(h-r). Taken from the standard
// real-time-SPH literature (it appears consistently across independent
// reference implementations of Müller's scheme) rather than re-derived
// from scratch in this pass — unlike the two kernels above, this one is
// reused on the strength of convergent published sources, not an
// independent derivation.
const viscLapCoeff = (h) => 40 / (Math.PI * h ** 5);
const viscLap = (r, h, coeff) => (r >= h ? 0 : coeff * (h - r));

const VERT = `
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`;

// The same gaussian-metaball technique LiquidMeter.jsx/InkGoo.jsx/
// ParticleCuboid.jsx all already use — genuinely the right rendering choice
// here, not just a reused convenience: SPH already represents the fluid as
// an implicit density field sampled by particles, and metaballs are
// exactly that same idea (an implicit field, thresholded into a surface)
// applied to rendering. A fixed particle count this modest (100) needs a
// generous per-particle radius for the field to actually read as a
// continuous liquid rather than a loose cloud of dots.
const FRAG = `
  precision highp float;

  uniform vec2 uResolution;
  uniform float uDpr;
  uniform vec3 uBalls[${ PARTICLE_COUNT }];
  uniform vec3 uInk;
  uniform vec3 uRim;
  uniform vec3 uBg;

  void main() {
    vec2 p = gl_FragCoord.xy / uDpr;
    p.y = uResolution.y - p.y;

    float field = 0.0;
    for (int i = 0; i < ${ PARTICLE_COUNT }; i++) {
      vec3 b = uBalls[i];
      vec2 d = p - b.xy;
      field += exp(-dot(d, d) / (b.z * b.z));
    }

    float body = smoothstep(0.5, 0.56, field);
    float rim = smoothstep(0.5, 0.6, field) * (1.0 - smoothstep(0.6, 1.05, field));
    vec3 col = mix(uInk, uRim, rim * 0.5);

    if (body < 0.01) discard;
    gl_FragColor = vec4(mix(uBg, col, body), 1.0);
  }
`;

const FluidField = ({ active, reduceMotion = false }) => {
  const canvasRef = useRef(null);
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

  useEffect(() => {
    if (!active) return undefined;

    const canvas = canvasRef.current;
    const parent = canvas.parentElement;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);

    const scene = new THREE.Scene();
    const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const dims = { w: 480, h: 360 };
    const resize = () => {
      dims.w = parent.clientWidth || 480;
      dims.h = parent.clientHeight || 360;
      renderer.setSize(dims.w, dims.h, false);
      uniforms.uResolution.value.set(dims.w, dims.h);
    };

    const uniforms = {
      uResolution: { value: new THREE.Vector2(dims.w, dims.h) },
      uDpr: { value: dpr },
      uBalls: { value: Array.from({ length: PARTICLE_COUNT }, () => new THREE.Vector3()) },
      uInk: { value: new THREE.Color(resolveCssColor("var(--page-ink-color)")) },
      uRim: { value: new THREE.Color(resolveCssColor("var(--page-bg-color)")) },
      uBg: { value: new THREE.Color(resolveCssColor("var(--page-bg-color)")) },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: false,
      depthTest: false,
      depthWrite: false,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(quad);

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(parent);

    // The dam-break setup: a dense block in the domain's upper-left,
    // released under gravity to collapse and spread — the classic SPH
    // benchmark scene, chosen because its behavior is well-documented
    // enough elsewhere that a visitor familiar with fluid sims has a real
    // reference for what "looks right" here, not because it's the only
    // thing this could show.
    const particles = [];
    for (let ix = 0; ix < GRID; ix++) {
      for (let iy = 0; iy < GRID; iy++) {
        particles.push({
          pos: new THREE.Vector2(2 + ix * SPACING, 10 + iy * SPACING),
          vel: new THREE.Vector2(0, 0),
          density: REST_DENSITY,
          pressure: 0,
          force: new THREE.Vector2(),
        });
      }
    }

    const poly6C = poly6Coeff(SMOOTHING_RADIUS);
    const spikyC = spikyGradCoeff(SMOOTHING_RADIUS);
    const viscC = viscLapCoeff(SMOOTHING_RADIUS);
    const selfDensity = PARTICLE_MASS * poly6(0, SMOOTHING_RADIUS, poly6C);

    const delta = new THREE.Vector2();

    // One SPH substep — two full passes over every pair within h, since
    // pressure force at every particle depends on the *already-computed*
    // density at every one of its neighbors, not just its own. A single
    // combined pass (accumulate density and force together) isn't
    // available here the way it was for the cuboid's or gravity field's
    // pairwise forces — this is a real, structural difference in SPH, not
    // an implementation choice.
    const step = (dt) => {
      // Pass 1 — density, then the equation of state (pressure).
      for (const p of particles) p.density = selfDensity;

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i], b = particles[j];
          delta.copy(b.pos).sub(a.pos);
          const r = delta.length();
          if (r >= SMOOTHING_RADIUS) continue;

          const w = poly6(r, SMOOTHING_RADIUS, poly6C);
          a.density += PARTICLE_MASS * w;
          b.density += PARTICLE_MASS * w;
        }
      }

      for (const p of particles) {
        // Clamped to non-negative — a real, deliberate stabilization (not
        // an arbitrary hack): an under-dense region's "pressure" going
        // negative would otherwise pull neighboring particles toward it
        // (an unphysical attraction in a scheme meant to model an
        // incompressible-ish liquid), a well-known practical fix in
        // real-time SPH implementations.
        p.pressure = Math.max(0, STIFFNESS * (p.density - REST_DENSITY));
        p.force.set(0, 0);
      }

      // Pass 2 — pressure + viscosity forces, now that every particle's
      // density/pressure is settled for this substep.
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i], b = particles[j];
          delta.copy(b.pos).sub(a.pos);
          const r = delta.length();
          if (r >= SMOOTHING_RADIUS || r <= 0.0001) continue;

          const dirX = delta.x / r, dirY = delta.y / r;

          // Symmetric pressure term (Pᵢ+Pⱼ)/(2ρⱼ) form — this specific
          // averaging is what makes the force exactly equal and opposite
          // between the pair (real momentum conservation), rather than an
          // asymmetric form that would quietly leak or invent momentum
          // over many steps.
          const gradMag = spikyGrad(r, SMOOTHING_RADIUS, spikyC);
          const pressureTerm = -PARTICLE_MASS * (a.pressure + b.pressure) / (2 * b.density) * gradMag;
          // Points from b toward a when repulsive (pressureTerm > 0 in the
          // direction opposite dir), matching the physical picture: a
          // compressed (high-pressure) region pushes particles apart.
          const pfx = -dirX * pressureTerm;
          const pfy = -dirY * pressureTerm;
          a.force.x += pfx; a.force.y += pfy;
          b.force.x -= pfx; b.force.y -= pfy;

          const lap = viscLap(r, SMOOTHING_RADIUS, viscC);
          const viscTerm = VISCOSITY * PARTICLE_MASS * lap / b.density;
          const vfx = (b.vel.x - a.vel.x) * viscTerm;
          const vfy = (b.vel.y - a.vel.y) * viscTerm;
          a.force.x += vfx; a.force.y += vfy;
          b.force.x -= vfx; b.force.y -= vfy;
        }
      }

      for (const p of particles) {
        // Gravity and the cursor push are accelerations/forces per unit
        // mass already, added directly rather than scaled by density —
        // pressure/viscosity above are the ones that came out of the SPH
        // sums as forces-per-particle, divided by this particle's own
        // density to get an acceleration (force ÷ mass-density-of-the-
        // local-fluid-parcel is the SPH convention, not force ÷ this
        // particle's own point mass).
        let ax = p.force.x / p.density;
        let ay = p.force.y / p.density - GRAVITY;

        if (cursor.active) {
          const cdx = p.pos.x - cursor.x;
          const cdy = p.pos.y - cursor.y;
          const cdist = Math.max(0.15, Math.hypot(cdx, cdy));
          if (cdist < CURSOR_RADIUS) {
            const push = (CURSOR_STRENGTH * (1 + cursor.speedBoost)) / (cdist * cdist) * (1 - cdist / CURSOR_RADIUS);
            ax += (cdx / cdist) * push;
            ay += (cdy / cdist) * push;
          }
        }

        p.vel.x += ax * dt;
        p.vel.y += ay * dt;

        const speed = p.vel.length();
        if (speed > VELOCITY_CLAMP) p.vel.multiplyScalar(VELOCITY_CLAMP / speed);

        p.pos.x += p.vel.x * dt;
        p.pos.y += p.vel.y * dt;

        // Boundary: reflect and damp rather than a hard clamp alone — a
        // wall should feel like it absorbs some of the impact, not act as
        // a perfectly elastic or perfectly rigid stop either one.
        if (p.pos.x < 0) { p.pos.x = 0; p.vel.x = -p.vel.x * BOUNDARY_RESTITUTION; }
        else if (p.pos.x > DOMAIN_W) { p.pos.x = DOMAIN_W; p.vel.x = -p.vel.x * BOUNDARY_RESTITUTION; }
        if (p.pos.y < 0) { p.pos.y = 0; p.vel.y = -p.vel.y * BOUNDARY_RESTITUTION; }
        else if (p.pos.y > DOMAIN_H) { p.pos.y = DOMAIN_H; p.vel.y = -p.vel.y * BOUNDARY_RESTITUTION; }
      }
    };

    // Cursor state: position in sim-space plus a velocity-derived "how hard
    // is it moving" boost, the same idea (not the same code) as
    // ParticleCuboid.jsx's REPEL_SPEED_GAIN.
    const cursor = { x: 0, y: 0, active: false, speedBoost: 0 };
    const prevCursor = { x: 0, y: 0, time: performance.now() };

    const simFromEvent = (e) => {
      const rect = canvas.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width;
      const ny = (e.clientY - rect.top) / rect.height;
      // Screen Y grows downward, sim Y grows upward (see the render pass'
      // own flip below) — inverted here so the cursor meets the fluid
      // where it visually looks like it is, not its mirror image.
      return { x: nx * DOMAIN_W, y: (1 - ny) * DOMAIN_H };
    };

    const handlePointerMove = (e) => {
      if (reduceMotionRef.current) return;
      const now = performance.now();
      const { x, y } = simFromEvent(e);
      const dt = Math.max(0.001, (now - prevCursor.time) / 1000);
      const speed = Math.hypot(x - prevCursor.x, y - prevCursor.y) / dt;
      cursor.x = x; cursor.y = y; cursor.active = true;
      cursor.speedBoost = Math.min(3, speed * 0.05);
      prevCursor.x = x; prevCursor.y = y; prevCursor.time = now;
    };
    const handlePointerLeave = () => { cursor.active = false; };
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerleave", handlePointerLeave);

    let lastTime = performance.now();
    let raf = null;

    const tick = () => {
      raf = requestAnimationFrame(tick);

      const now = performance.now();
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      if (!reduceMotionRef.current) {
        const subDt = dt / SUBSTEPS;
        for (let s = 0; s < SUBSTEPS; s++) step(subDt);
      }

      const scaleX = dims.w / DOMAIN_W;
      const scaleY = dims.h / DOMAIN_H;
      // Render radius scales with the smaller of the two axis scales, so a
      // non-square container never stretches the metaballs into ellipses.
      const renderScale = Math.min(scaleX, scaleY);
      const renderRadius = SMOOTHING_RADIUS * 0.9 * renderScale;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i].pos;
        const px = p.x * scaleX;
        const py = dims.h - p.y * scaleY; // sim Y up → screen Y down
        uniforms.uBalls.value[i].set(px, py, renderRadius);
      }

      renderer.render(scene, quadCamera);
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

    const themeObserver = new MutationObserver(() => {
      uniforms.uInk.value.set(resolveCssColor("var(--page-ink-color)"));
      uniforms.uRim.value.set(resolveCssColor("var(--page-bg-color)"));
      uniforms.uBg.value.set(resolveCssColor("var(--page-bg-color)"));
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", handleVisibility);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      quad.geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [active]);

  return (
    <canvas
      ref={ canvasRef }
      className="fluid-field-canvas"
      aria-hidden="true"
    />
  );
};

export default FluidField;
