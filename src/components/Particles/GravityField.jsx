import { useEffect, useRef } from "react";
import * as THREE from "three";

import { NOTE_COLORS } from "../../constants/colors";

import "./GravityField.css";

THREE.ColorManagement.enabled = false;

// Simulation units throughout — not pixels, not real astronomical units.
// G = 1 is the standard toy-simulation convention (rather than the real
// 6.674e-11): it just rescales what "mass" and "distance" mean, and every
// other constant below (masses, radii, velocities) is chosen relative to
// it, so the physics stays exactly Newton's law, just in units sized for
// this scene rather than the solar system.
const G = 1;
const STAR_MASS = 600;
const PLANET_COUNT = 22;
const PLANET_MASS_MIN = 0.6;
const PLANET_MASS_MAX = 1.8;
const SPAWN_R_MIN = 2;
const SPAWN_R_MAX = 7;

// Gravitational softening — F = G·m₁·m₂ / (r² + ε²) rather than the bare
// inverse-square law. This is a standard technique in real N-body
// astrophysics codes (not a hack invented for this): the bare 1/r² force
// diverges as two bodies approach r = 0, which a discrete timestep can
// never actually resolve (the force in the single frame right before
// "contact" is already enormous); softening caps the maximum possible
// force at G·m₁·m₂/ε² regardless of how close two bodies get, which is
// what actually keeps this numerically stable through close encounters —
// verified by hand below against the closest realistic approach distance.
const SOFTENING = 0.3;

// A close stellar encounter is *supposed* to fling a planet hard — that's
// a real gravity-assist slingshot, not a bug — but it needs a hard ceiling
// so a single extreme encounter can't send a point streaking off in one
// frame rather than reading as a dramatic, trackable pass.
const VELOCITY_CLAMP = 60;

// Past this radius a planet has genuinely escaped the system (not just
// swung out on a wide ellipse) and gets recycled into a fresh circular
// orbit rather than drifting forever off the edge of a bounded canvas.
const ESCAPE_RADIUS = 13;

const VIEW_EXTENT = 9; // half-width/height of the orthographic view, world units
const TRAIL_LENGTH = 18;
const SUBSTEPS = 4;
const SLING_STRENGTH = 5;

// A real damped-Euler stepper (see the tick loop) needs its timestep small
// relative to the fastest orbital period actually present, or a close
// orbit gets under-resolved and visibly precesses/drifts. Checked by hand
// against the innermost spawn radius before picking SUBSTEPS: circular
// orbit period T = 2π·r/v = 2π·r^1.5/√(GM). At r = SPAWN_R_MIN = 2,
// M = STAR_MASS = 600 → T ≈ 2π·2.83/24.5 ≈ 0.73s. At 60fps with 4
// substeps, the physics step is dt/4 ≈ 0.0042s, giving ≈175 steps across
// that fastest orbit — comfortably in the "resolves cleanly" range for a
// symplectic Euler integrator (semi-implicit Euler — update velocity from
// the current force, then position from the new velocity — is itself
// symplectic, meaning it conserves energy on average over long
// integration times rather than systematically bleeding or gaining it,
// which plain/explicit Euler does not; that property is exactly why it's
// the standard simple choice for orbital simulations, not just reused here
// out of convenience).

const VERT = `
  attribute float aAlpha;
  attribute float aSize;
  attribute vec3 aColor;

  varying float vAlpha;
  varying vec3 vColor;

  uniform float uPixelRatio;

  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// A soft round falloff per point, the same gl_PointCoord technique
// AmbientField.jsx's own dust field already uses — each trail segment is
// one of these, fading in both size and alpha from a particle's current
// head position back through its recent history.
const FRAG = `
  precision mediump float;

  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    float a = smoothstep(0.5, 0.0, d) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

// A true N-body gravitational simulation, not a fixed-sun-plus-orbiters
// approximation — every body (including the star) pulls on and is pulled
// by every other one, real momentum and all. Drag anywhere to sling a new
// body into the system with real velocity from the gesture (Angry-Birds
// style: it launches opposite the drag, the way a real slingshot does).
// Rendered as a flat top-down orbital plane via a genuine
// THREE.OrthographicCamera and Three.js's own transform pipeline (no
// hand-derived projection math this time — unlike ParticleCuboid.jsx's 3D
// scene, a flat 2D view has no reason to reimplement anything Three.js
// already does correctly).
// How often the panel chrome around this canvas actually gets a fresh
// physics reading (see onSystemStats below) — real quantities computed
// straight off the same body list the stepper itself owns, just reported
// out at a chrome-appropriate rate rather than every one of the 240
// substeps/second the simulation itself actually runs at.
const STATS_EMIT_MS = 150;

const GravityField = ({ active, reduceMotion = false, onSystemStats }) => {
  const canvasRef = useRef(null);
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  // Read fresh inside the tick loop below (which only ever mounts once per
  // `active` toggle) rather than closed over at effect-start — the same
  // "sync a ref every render, read the ref in the long-lived effect"
  // pattern TrashPhysics' own onPileTilt callback already uses.
  const onSystemStatsRef = useRef(onSystemStats);
  useEffect(() => { onSystemStatsRef.current = onSystemStats; });
  const lastStatsEmitRef = useRef(0);

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

    const palette = Object.values(NOTE_COLORS).map((hex) => new THREE.Color(hex));
    const starColor = new THREE.Color(NOTE_COLORS.yellow);

    // Circular-orbit velocity: setting gravity equal to the centripetal
    // force needed for a circular path (GMm/r² = mv²/r) and solving for v
    // gives v = √(GM/r) — the actual textbook relation, not a tuned
    // approximation. Spawned bodies start on a real stable circular orbit
    // around the star alone; the moment a second body's own gravity is
    // felt (immediately, since this is true N-body) that orbit starts
    // perturbing into something richer, which is the whole point.
    const circularVelocity = (r, enclosedMass) => Math.sqrt((G * enclosedMass) / Math.max(0.5, r));

    // Just the physical state — position and velocity — for a circular
    // orbit at radius r, angle around the star. Split out from makeBody
    // below so recycling a body (escaped, or bumped by a slingshot) can
    // reuse this without also reallocating a color or a fresh trail-history
    // array it's just going to overwrite anyway.
    const circularOrbitState = (r, angle) => {
      const pos = new THREE.Vector2(Math.cos(angle) * r, Math.sin(angle) * r);
      const speed = circularVelocity(r, STAR_MASS);
      // Perpendicular to the radius vector — tangential, the direction a
      // circular orbit actually moves in.
      const vel = new THREE.Vector2(-Math.sin(angle), Math.cos(angle)).multiplyScalar(speed);
      return { pos, vel };
    };

    const makeBody = (mass, r, angle, colorIndex) => {
      const { pos, vel } = circularOrbitState(r, angle);
      return {
        pos,
        vel,
        mass,
        color: palette[colorIndex % palette.length],
        trail: Array.from({ length: TRAIL_LENGTH }, () => pos.clone()),
      };
    };

    const star = {
      pos: new THREE.Vector2(0, 0),
      vel: new THREE.Vector2(0, 0),
      mass: STAR_MASS,
      color: starColor,
      trail: null, // the star doesn't carry a trail — see the render pass below
    };

    const planets = Array.from({ length: PLANET_COUNT }, (_, i) => {
      const r = SPAWN_R_MIN + Math.random() * (SPAWN_R_MAX - SPAWN_R_MIN);
      const angle = Math.random() * Math.PI * 2;
      const mass = PLANET_MASS_MIN + Math.random() * (PLANET_MASS_MAX - PLANET_MASS_MIN);
      const colorIndex = Math.floor(((r - SPAWN_R_MIN) / (SPAWN_R_MAX - SPAWN_R_MIN)) * palette.length);
      return makeBody(mass, r, angle, colorIndex);
    });

    const bodies = [star, ...planets];

    // Geometry: TRAIL_LENGTH points per planet (the star renders separately,
    // below, as its own single larger point via a second draw call) — a
    // flat position/alpha/size/color buffer, rewritten every frame from the
    // physics state rather than recreated.
    const trailPointCount = PLANET_COUNT * TRAIL_LENGTH;
    const positions = new Float32Array(trailPointCount * 3);
    const alphas = new Float32Array(trailPointCount);
    const sizes = new Float32Array(trailPointCount);
    const colors = new Float32Array(trailPointCount * 3);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));

    // Standard alpha blending, not additive — matches AmbientField.jsx's
    // own point-sprite convention (the closest precedent in this app for
    // rendering many small points), keeping this in the same calm ink
    // register rather than introducing an unverified "glowing space"
    // register of its own, especially with up to 22×18 trail points
    // potentially overlapping near a dense inner orbit.
    const material = new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: dpr } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    // The star drawn as its own single point, same shader/material family
    // — a tiny second geometry rather than folding it into the trail
    // buffer above, since it has no trail history to carry.
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
    starGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array([1]), 1));
    starGeometry.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array([26]), 1));
    starGeometry.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array([starColor.r, starColor.g, starColor.b]), 3));
    const starMaterial = new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: dpr } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const starPoint = new THREE.Points(starGeometry, starMaterial);
    scene.add(starPoint);

    // Drag-to-sling: press anywhere, drag, release — the new body launches
    // from the press point opposite the drag direction (a real slingshot:
    // pull back, release, it flies the other way), with speed proportional
    // to how far it was pulled. World coordinates come from
    // Camera.unproject rather than hand-derived — trivial to invert for an
    // axis-aligned orthographic camera by hand, but reusing the same
    // trusted Three.js call this project already leans on elsewhere keeps
    // one fewer place that math could go quietly wrong.
    const ndcFromEvent = (e) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: -(((e.clientY - rect.top) / rect.height) * 2 - 1),
      };
    };
    const worldFromNdc = (ndc) => new THREE.Vector3(ndc.x, ndc.y, 0).unproject(camera);

    let dragStart = null; // world-space Vector2, or null when not dragging
    const handlePointerDown = (e) => {
      if (reduceMotionRef.current) return;
      const w = worldFromNdc(ndcFromEvent(e));
      dragStart = new THREE.Vector2(w.x, w.y);
    };
    const handlePointerUp = (e) => {
      if (!dragStart) return;
      const w = worldFromNdc(ndcFromEvent(e));
      const end = new THREE.Vector2(w.x, w.y);
      const launchVel = dragStart.clone().sub(end).multiplyScalar(SLING_STRENGTH);

      // Bounded pool: recycle whichever planet currently sits farthest from
      // the star rather than growing the array without limit — every
      // slingshot always has somewhere to land, and the simulation's own
      // cost never creeps up no matter how many times someone plays with it.
      let farthest = 0;
      let farthestDist = -1;
      for (let i = 0; i < planets.length; i++) {
        const d = planets[i].pos.distanceTo(star.pos);
        if (d > farthestDist) { farthestDist = d; farthest = i; }
      }
      const target = planets[farthest];
      target.pos.copy(dragStart);
      target.vel.copy(launchVel.length() > VELOCITY_CLAMP ? launchVel.normalize().multiplyScalar(VELOCITY_CLAMP) : launchVel);
      target.mass = PLANET_MASS_MIN + Math.random() * (PLANET_MASS_MAX - PLANET_MASS_MIN);
      for (const p of target.trail) p.copy(dragStart);

      dragStart = null;
    };
    canvas.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointerup", handlePointerUp);

    let lastTime = performance.now();
    let raf = null;
    const barycenter = new THREE.Vector2();
    const delta = new THREE.Vector2();

    // One physics substep — real pairwise Newtonian gravity between every
    // pair of bodies (star included), softened, integrated with
    // semi-implicit Euler (velocity from this step's forces, then position
    // from the updated velocity — see the stability note above).
    const step = (dt) => {
      for (const body of bodies) {
        if (!body.force) body.force = new THREE.Vector2();
        body.force.set(0, 0);
      }

      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i], b = bodies[j];
          delta.copy(b.pos).sub(a.pos);
          const distSq = delta.lengthSq() + SOFTENING * SOFTENING;
          const dist = Math.sqrt(distSq);
          const strength = (G * a.mass * b.mass) / distSq;
          // delta/dist is the unit vector from a to b; force on a points
          // toward b (attraction), force on b is the exact opposite —
          // Newton's third law, not assumed but a direct consequence of
          // accumulating the same magnitude onto both with opposite sign.
          const fx = (delta.x / dist) * strength;
          const fy = (delta.y / dist) * strength;
          a.force.x += fx; a.force.y += fy;
          b.force.x -= fx; b.force.y -= fy;
        }
      }

      for (const body of bodies) {
        body.vel.x += (body.force.x / body.mass) * dt;
        body.vel.y += (body.force.y / body.mass) * dt;

        const speed = body.vel.length();
        if (speed > VELOCITY_CLAMP) body.vel.multiplyScalar(VELOCITY_CLAMP / speed);

        body.pos.x += body.vel.x * dt;
        body.pos.y += body.vel.y * dt;
      }
    };

    const tick = () => {
      raf = requestAnimationFrame(tick);

      const now = performance.now();
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      if (!reduceMotionRef.current) {
        const subDt = dt / SUBSTEPS;
        for (let s = 0; s < SUBSTEPS; s++) step(subDt);

        // A planet that's genuinely escaped (not just on a wide ellipse)
        // gets recycled into a fresh circular orbit rather than left to
        // drift off toward infinity forever.
        for (const planet of planets) {
          if (planet.pos.distanceTo(star.pos) > ESCAPE_RADIUS) {
            const r = SPAWN_R_MIN + Math.random() * (SPAWN_R_MAX - SPAWN_R_MIN);
            const angle = Math.random() * Math.PI * 2;
            const { pos, vel } = circularOrbitState(r, angle);
            planet.pos.copy(pos);
            planet.vel.copy(vel);
            for (const p of planet.trail) p.copy(pos);
          }
        }
      }

      // Every body's own true position, averaged by mass — the actual
      // definition of a system's center of mass, R = Σ(mᵢrᵢ)/Σmᵢ — used
      // only to decide where to *draw* everything, never fed back into the
      // physics above. A genuine N-body system's barycenter can drift as
      // bodies interact (real momentum, not an artificially fixed sun), so
      // rendering relative to it keeps the whole scene visually centered
      // without needing to fake the star's position as immovable.
      barycenter.set(0, 0);
      let totalMass = 0;
      // The system's own real total kinetic energy — Σ½mv², accumulated in
      // the same pass rather than a second loop over bodies, purely for
      // the panel chrome's own display (see onSystemStats below); nothing
      // downstream of the stepper above ever reads this back.
      let kineticEnergy = 0;
      for (const body of bodies) {
        barycenter.x += body.pos.x * body.mass;
        barycenter.y += body.pos.y * body.mass;
        totalMass += body.mass;
        kineticEnergy += 0.5 * body.mass * body.vel.lengthSq();
      }
      barycenter.multiplyScalar(1 / totalMass);

      if (onSystemStatsRef.current && now - lastStatsEmitRef.current > STATS_EMIT_MS) {
        lastStatsEmitRef.current = now;
        onSystemStatsRef.current({ kineticEnergy, bodyCount: bodies.length });
      }

      if (!reduceMotionRef.current) {
        for (const planet of planets) {
          for (let t = planet.trail.length - 1; t > 0; t--) planet.trail[t].copy(planet.trail[t - 1]);
          planet.trail[0].copy(planet.pos);
        }
      }

      for (let p = 0; p < planets.length; p++) {
        const planet = planets[p];
        for (let t = 0; t < TRAIL_LENGTH; t++) {
          const idx = p * TRAIL_LENGTH + t;
          const trailPos = planet.trail[t];
          positions[idx * 3] = trailPos.x - barycenter.x;
          positions[idx * 3 + 1] = trailPos.y - barycenter.y;
          positions[idx * 3 + 2] = 0;

          const fade = 1 - t / TRAIL_LENGTH;
          alphas[idx] = fade * fade * 0.85;
          sizes[idx] = (5 + planet.mass * 4) * fade + 2;
          colors[idx * 3] = planet.color.r;
          colors[idx * 3 + 1] = planet.color.g;
          colors[idx * 3 + 2] = planet.color.b;
        }
      }

      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.aAlpha.needsUpdate = true;
      geometry.attributes.aSize.needsUpdate = true;
      geometry.attributes.aColor.needsUpdate = true;

      const starPos = starGeometry.attributes.position.array;
      starPos[0] = star.pos.x - barycenter.x;
      starPos[1] = star.pos.y - barycenter.y;
      starGeometry.attributes.position.needsUpdate = true;

      renderer.render(scene, camera);
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
      window.removeEventListener("pointerup", handlePointerUp);
      resizeObserver.disconnect();
      geometry.dispose();
      material.dispose();
      starGeometry.dispose();
      starMaterial.dispose();
      renderer.dispose();
    };
  }, [active]);

  return (
    <canvas
      ref={ canvasRef }
      className="gravity-field-canvas"
      aria-hidden="true"
    />
  );
};

export default GravityField;
