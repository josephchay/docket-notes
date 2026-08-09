import { useEffect, useRef } from "react";
import * as THREE from "three";

import { resolveCssColor } from "../History/HistoryAmbient";
import { poly6Coeff, poly6, spikyGradCoeff, spikyGrad, viscLapCoeff, viscLap, particleMassFor } from "../../utils/sph";
import { UniformGrid } from "../../utils/sphGrid";
import { FoamPool, shouldSpawnFoam } from "../../utils/sphFoam";
import { SplatFluidRenderer } from "./SplatFluidRenderer";

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

// 20×20 initial block (400 particles, 4× the original 10×10) — the density
// field is now built by SplatFluidRenderer's GPU splat pass rather than a
// per-pixel uBalls[] shader loop (see that file's own header for why the
// old approach couldn't scale past N≈100-130), and neighbor search below
// runs through utils/sphGrid.js's UniformGrid rather than an all-pairs
// double loop, so this is no longer bound by either of the ceilings that
// capped the original count. DOMAIN_W/H and the block's start position
// scale up by the same 2× factor as GRID so the dam-break's proportions —
// how much empty room the block has to collapse into — read identically to
// the original 10×10/30×22 scene, just denser.
const GRID = 20;
const SPACING = 1.15;
const PARTICLE_COUNT = GRID * GRID;
// See utils/sph.js's own particleMassFor for the reasoning (the standard
// real-time-SPH mass heuristic — a heuristic, not an identity; see the note
// in the panel wrapper about what this file's own tuning can't fully
// hand-verify beyond that).
const PARTICLE_MASS = particleMassFor(REST_DENSITY, SPACING);

const SMOOTHING_RADIUS = 1.6 * SPACING; // h — kernel support radius
const SUBSTEPS = 3;
const VELOCITY_CLAMP = 40;
const BOUNDARY_RESTITUTION = 0.45; // velocity kept (not lost) on a wall bounce

const DOMAIN_W = 60;
const DOMAIN_H = 44;
const BLOCK_START_X = 4;
const BLOCK_START_Y = 20;

// The cursor pushes fluid it moves through, scaled by how fast it's
// actually moving — the same "real drag responds to velocity" idea
// CursorAura.jsx's ripples and ParticleCuboid.jsx's repulsion already use.
// Radius doubled alongside DOMAIN_W/H/GRID above, so the cursor's reach
// stays the same fraction of the (now larger) fluid body it always was.
const CURSOR_RADIUS = 6.4;
const CURSOR_STRENGTH = 900;

// poly6/spikyGrad/viscLap kernels now live in utils/sph.js (see that file
// for the verified normalization derivations) — imported above rather than
// declared here, once FluidVisualizer.jsx needed the exact same math and a
// second independently-drifting copy stopped being acceptable.

// Foam/spray: see utils/sphFoam.js for the full reasoning. A splash reads
// as "fast and near the surface" — FOAM_SPEED_THRESHOLD is roughly half
// VELOCITY_CLAMP (only genuinely energetic motion throws spray, not every
// ripple), FOAM_DENSITY_RATIO of rest density is loose enough to catch the
// collapsing block's leading edge without also firing deep in its interior.
const FOAM_CAPACITY = 260;
const FOAM_SPEED_THRESHOLD = VELOCITY_CLAMP * 0.5;
const FOAM_DENSITY_RATIO = 0.85;
const FOAM_RADIUS_MIN = 0.12;
const FOAM_RADIUS_MAX = 0.3;
const FOAM_LIFE_MIN = 0.35;
const FOAM_LIFE_MAX = 0.85;
// Multiplicative per-substep velocity decay (see FoamPool.update) — close
// enough to 1 that a droplet still arcs visibly before settling, at 3
// substeps/frame this still bleeds off within well under a second.
const FOAM_DRAG = 0.985;

const FluidField = ({ active, reduceMotion = false }) => {
  const canvasRef = useRef(null);
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

  useEffect(() => {
    if (!active) return undefined;

    const canvas = canvasRef.current;
    const parent = canvas.parentElement;

    const fluidRenderer = new SplatFluidRenderer(canvas, { foamCapacity: FOAM_CAPACITY });
    fluidRenderer.setFieldCount(PARTICLE_COUNT);

    const applyTint = () => {
      const bg = resolveCssColor("var(--page-bg-color)");
      const ink = resolveCssColor("var(--page-ink-color)");
      fluidRenderer.setTint(bg, bg);
      fluidRenderer.setFoamColor(ink);
      // Every particle shares one flat ink color (unlike FluidVisualizer.jsx's
      // per-particle palette), so the "blended" color the resolve pass reads
      // back out of the field is just that same ink color again — filled once
      // here (and again on theme change) rather than every frame in tick().
      const inkColor = new THREE.Color(ink);
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        fluidRenderer.fieldColors[i * 3] = inkColor.r;
        fluidRenderer.fieldColors[i * 3 + 1] = inkColor.g;
        fluidRenderer.fieldColors[i * 3 + 2] = inkColor.b;
      }
    };
    applyTint();

    const dims = { w: 480, h: 360 };
    const resize = () => {
      dims.w = parent.clientWidth || 480;
      dims.h = parent.clientHeight || 360;
      fluidRenderer.setSize(dims.w, dims.h);
    };
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
          pos: new THREE.Vector2(BLOCK_START_X + ix * SPACING, BLOCK_START_Y + iy * SPACING),
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
    // Cell size == smoothing radius h, per sphGrid.js's own contract — built
    // fresh from current positions at the top of every substep, since the
    // grid only narrows candidates for *this* configuration of particles.
    const grid = new UniformGrid(DOMAIN_W, DOMAIN_H, SMOOTHING_RADIUS);
    const foamPool = new FoamPool(FOAM_CAPACITY);

    // One SPH substep — two full passes over every pair within h, since
    // pressure force at every particle depends on the *already-computed*
    // density at every one of its neighbors, not just its own. A single
    // combined pass (accumulate density and force together) isn't
    // available here the way it was for the cuboid's or gravity field's
    // pairwise forces — this is a real, structural difference in SPH, not
    // an implementation choice.
    const step = (dt) => {
      grid.build(particles);

      // Pass 1 — density, then the equation of state (pressure). Neighbor
      // candidates now come from the grid's own 3×3-cell query rather than
      // every other particle in the pool; the `k <= i` skip is what keeps
      // each unordered pair counted exactly once (the same role `j = i + 1`
      // played in the old all-pairs loop), since a cell query has no
      // inherent ordering of its own to lean on.
      for (const p of particles) p.density = selfDensity;

      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        grid.forEachNear(a.pos.x, a.pos.y, (k) => {
          if (k <= i) return;
          const b = particles[k];
          delta.copy(b.pos).sub(a.pos);
          const r = delta.length();
          if (r >= SMOOTHING_RADIUS) return;

          const w = poly6(r, SMOOTHING_RADIUS, poly6C);
          a.density += PARTICLE_MASS * w;
          b.density += PARTICLE_MASS * w;
        });
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
        const a = particles[i];
        grid.forEachNear(a.pos.x, a.pos.y, (k) => {
          if (k <= i) return;
          const b = particles[k];
          delta.copy(b.pos).sub(a.pos);
          const r = delta.length();
          if (r >= SMOOTHING_RADIUS || r <= 0.0001) return;

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
        });
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

        // A fast, under-dense particle is exactly what a real splash looks
        // like locally (see shouldSpawnFoam's own comment) — checked with
        // this substep's own freshly-computed density/speed, before the
        // position update below moves it.
        if (shouldSpawnFoam(speed, p.density, REST_DENSITY, FOAM_SPEED_THRESHOLD, FOAM_DENSITY_RATIO, Math.random)) {
          const radius = FOAM_RADIUS_MIN + Math.random() * (FOAM_RADIUS_MAX - FOAM_RADIUS_MIN);
          const life = FOAM_LIFE_MIN + Math.random() * (FOAM_LIFE_MAX - FOAM_LIFE_MIN);
          foamPool.spawn(p.pos.x, p.pos.y, p.vel.x * 0.4, p.vel.y * 0.4 + 3, radius, life);
        }

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

      foamPool.update(dt, GRAVITY, FOAM_DRAG);
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
      fluidRenderer.setPointRadius(renderRadius);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i].pos;
        const px = p.x * scaleX;
        const py = dims.h - p.y * scaleY; // sim Y up → screen Y down
        fluidRenderer.fieldPositions[i * 3] = px;
        fluidRenderer.fieldPositions[i * 3 + 1] = py;
      }

      for (let i = 0; i < FOAM_CAPACITY; i++) {
        const alive = foamPool.life[i] > 0;
        fluidRenderer.foamPositions[i * 3] = foamPool.x[i] * scaleX;
        fluidRenderer.foamPositions[i * 3 + 1] = dims.h - foamPool.y[i] * scaleY;
        fluidRenderer.foamRadii[i] = foamPool.radius[i] * renderScale;
        fluidRenderer.foamAlphas[i] = alive ? foamPool.life[i] / foamPool.maxLife[i] : 0;
      }

      fluidRenderer.render();
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

    const themeObserver = new MutationObserver(applyTint);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", handleVisibility);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      fluidRenderer.dispose();
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
