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
// Two suns, not one — see binaryOrbitState below — but their COMBINED mass
// stays exactly 600, so the SUBSTEPS stability note's own arithmetic (and
// every planet's circularVelocity spawn calc, which takes this as the
// "enclosed mass" of a single central point) is still calibrated correctly
// without needing to re-derive it.
const STAR_MASS_A = 380;
const STAR_MASS_B = 220;
const STAR_MASS = STAR_MASS_A + STAR_MASS_B;
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

// Press-and-hold gravity well: holding still (rather than pulling back for
// a sling) drops a temporary massive point straight into the SAME `bodies`
// array step() already iterates — no separate force code needed, the
// existing pairwise loop just sees one more mass. WELL_HOLD_TOLERANCE is
// how far the pointer may still drift and count as "holding still" (a
// literally-zero-movement test would false-negative on ordinary hand
// tremor); crossing it before WELL_HOLD_MS elapses instead reads as the
// start of a deliberate sling pull-back.
const WELL_HOLD_MS = 220;
const WELL_HOLD_TOLERANCE = 0.35;
const WELL_MASS = 140;

// Binary star system — see binaryOrbitState below.
const BINARY_SEPARATION = 1.1;

// Velocity-tinted trail: how strongly a trail point's own RECORDED speed
// (captured the instant it was the head, not the planet's current live
// speed — see planet.trailSpeed) blends that segment's stored color toward
// the star's own hue, reading as a perihelion whip glowing hot along the
// whole trail rather than just the head.
const SPEED_TINT_STRENGTH = 0.85;

// Staged escape-recycle: instead of an instant teleport the moment a planet
// crosses ESCAPE_RADIUS, it fades out in place over RECYCLE_OUT_S, THEN
// resets onto a fresh orbit and fades back in over RECYCLE_IN_S — "burn up
// and reform" rather than a pop. Slightly asymmetric durations (a touch
// quicker out than in) so the two readable as distinct beats, not one
// mirrored fade.
const RECYCLE_OUT_S = 0.4;
const RECYCLE_IN_S = 0.5;

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
    const starColorA = new THREE.Color(NOTE_COLORS.yellow);
    const starColorB = new THREE.Color(NOTE_COLORS.orange);

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

    // Reduced two-body Keplerian orbit: two masses m1/m2 separated by `sep`
    // co-orbit their own common barycenter. Each star sits r = sep ×
    // (other mass / total mass) from that barycenter — the textbook
    // definition of a mass-weighted center — placed symmetric about the
    // origin along one axis so the barycenter lands exactly at (0,0),
    // which is what lets circularOrbitState above (and the escape-recycle
    // check below) keep assuming the system's mass sits at the origin
    // without needing to track the binary's own position separately.
    //
    // ω isn't the bare-inverse-square textbook ω² = G(m1+m2)/sep³ — that
    // assumes the SAME unsoftened force law step() itself doesn't actually
    // use. step() computes gravity as G·m1·m2/(sep²+SOFTENING²) (see
    // SOFTENING above), so deriving ω from the unsoftened law would hand
    // the stars a starting speed calibrated for a stronger pull than the
    // sim actually applies at this separation — measurably so, since
    // SOFTENING²=0.09 is ~7% of sep²=1.21 at BINARY_SEPARATION=1.1 — and
    // the resulting excess speed turns the "circular" orbit properly
    // eccentric instead (confirmed live: separation swinging 0.9 to 2.1
    // before this fix, not holding anywhere near a constant 1.1). Setting
    // centripetal acceleration equal to the ACTUAL softened force the sim
    // will apply — ω²·r1 = G·m2/(sep²+SOFTENING²), and r1 = sep·m2/(m1+m2)
    // — gives the corrected ω² = G(m1+m2) / (sep·(sep²+SOFTENING²)) instead.
    const binaryOrbitState = (m1, m2, sep) => {
      const r1 = sep * (m2 / (m1 + m2));
      const r2 = sep * (m1 / (m1 + m2));
      const softenedSepSq = sep * sep + SOFTENING * SOFTENING;
      const omega = Math.sqrt((G * (m1 + m2)) / (sep * softenedSepSq));
      return {
        a: { pos: new THREE.Vector2(-r1, 0), vel: new THREE.Vector2(0, -omega * r1) },
        b: { pos: new THREE.Vector2(r2, 0), vel: new THREE.Vector2(0, omega * r2) },
      };
    };

    const makeBody = (mass, r, angle, colorIndex) => {
      const { pos, vel } = circularOrbitState(r, angle);
      return {
        pos,
        vel,
        mass,
        color: palette[colorIndex % palette.length],
        trail: Array.from({ length: TRAIL_LENGTH }, () => pos.clone()),
        trailSpeed: new Float32Array(TRAIL_LENGTH),
        // Which star (0 = A, 1 = B) was nearer at the instant each trail
        // sample was recorded — the speed tint below blends toward THAT
        // star's own hue, not always the same one.
        trailNearB: new Float32Array(TRAIL_LENGTH),
        // Staged escape-recycle state — see the tick loop below. null while
        // on an ordinary orbit; "out" while fading away post-escape; "in"
        // while fading back in on its freshly reset orbit.
        recyclePhase: null,
        recycleT: 0,
        recycleAlpha: 1,
      };
    };

    const binary = binaryOrbitState(STAR_MASS_A, STAR_MASS_B, BINARY_SEPARATION);
    const stars = [
      { pos: binary.a.pos, vel: binary.a.vel, mass: STAR_MASS_A, color: starColorA, trail: null },
      { pos: binary.b.pos, vel: binary.b.vel, mass: STAR_MASS_B, color: starColorB, trail: null },
    ];

    const planets = Array.from({ length: PLANET_COUNT }, (_, i) => {
      const r = SPAWN_R_MIN + Math.random() * (SPAWN_R_MAX - SPAWN_R_MIN);
      const angle = Math.random() * Math.PI * 2;
      const mass = PLANET_MASS_MIN + Math.random() * (PLANET_MASS_MAX - PLANET_MASS_MIN);
      const colorIndex = Math.floor(((r - SPAWN_R_MIN) / (SPAWN_R_MAX - SPAWN_R_MIN)) * palette.length);
      return makeBody(mass, r, angle, colorIndex);
    });

    // The gravity well, when active — see handlePointerMove below. Starts
    // parked far outside the view (never influences anything at that
    // distance-squared) rather than needing a separate "is a well active"
    // branch inside step()'s own pairwise loop; it's simply absent from
    // `bodies` until a hold actually arms it, and spliced back out on
    // release.
    let well = null;

    const bodies = [...stars, ...planets];

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

    // The two stars drawn as their own small point buffer, same
    // shader/material family — a tiny separate geometry rather than
    // folding them into the trail buffer above, since neither carries a
    // trail history. Point size scales with each star's own mass (√mass,
    // the same "area rather than radius scales with the physical quantity"
    // convention as the planets' own `5 + mass*4` trail-size formula
    // below) so the heavier of the two visibly reads as the heavier one.
    const starSizes = stars.map((s) => Math.sqrt(s.mass) * 1.3);
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(stars.length * 3), 3));
    starGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(stars.length).fill(1), 1));
    starGeometry.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(starSizes), 1));
    starGeometry.setAttribute("aColor", new THREE.BufferAttribute(
      new Float32Array(stars.flatMap((s) => [s.color.r, s.color.g, s.color.b])), 3,
    ));
    const starMaterial = new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: dpr } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const starPoints = new THREE.Points(starGeometry, starMaterial);
    scene.add(starPoints);

    // The gravity well's own marker — a single point, initialized at the
    // origin with alpha 0 and kept invisible via alpha alone (not
    // position) whenever no well is active, rather than adding/removing
    // this geometry from the scene each hold. Safe because tick() always
    // writes alpha (and, when active, position) before the very first
    // render call — this raw buffer's initial position is never actually
    // painted.
    const wellGeometry = new THREE.BufferGeometry();
    wellGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
    wellGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array([0]), 1));
    wellGeometry.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array([18]), 1));
    wellGeometry.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array([0.15, 0.15, 0.15]), 3));
    const wellMaterial = new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: dpr } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const wellPoint = new THREE.Points(wellGeometry, wellMaterial);
    scene.add(wellPoint);

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

    // Mass-weighted center of just the two stars — used both by the
    // "recycle the farthest planet" sling target search below and by the
    // escape-radius check in tick(), the same role `star.pos` played
    // single-star, now genuinely tracking wherever the binary's own
    // barycenter currently sits (it drifts slightly under planet
    // perturbation, same as the old single star already did).
    const starsCenter = new THREE.Vector2();
    const updateStarsCenter = () => {
      starsCenter.set(
        (stars[0].pos.x * stars[0].mass + stars[1].pos.x * stars[1].mass) / STAR_MASS,
        (stars[0].pos.y * stars[0].mass + stars[1].pos.y * stars[1].mass) / STAR_MASS,
      );
    };

    // Press anywhere: could become either gesture below, decided by
    // whether the pointer moves before or after WELL_HOLD_MS elapses.
    // Scoped to ONE pointerId at a time — a second concurrent touch is
    // ignored outright rather than clobbering the first press's own
    // dragStart/well (which, for the well specifically, would otherwise
    // orphan the first well in `bodies` with nothing left referencing it
    // to remove later).
    let dragStart = null; // world-space Vector2, or null when not pressed at all
    let dragStartTime = 0;
    let wellArmed = false; // true once a hold has committed to well mode (never becomes a sling)
    let activePointerId = null;

    const endPress = () => {
      if (well) bodies.splice(bodies.indexOf(well), 1);
      well = null;
      wellArmed = false;
      dragStart = null;
      activePointerId = null;
    };

    const handlePointerDown = (e) => {
      if (reduceMotionRef.current) return;
      if (dragStart) return; // a press is already in progress on another pointer
      const w = worldFromNdc(ndcFromEvent(e));
      dragStart = new THREE.Vector2(w.x, w.y);
      dragStartTime = performance.now();
      wellArmed = false;
      activePointerId = e.pointerId;
    };

    // Press-and-hold gravity well: holding roughly still (within
    // WELL_HOLD_TOLERANCE) for WELL_HOLD_MS commits this press to well
    // mode instead of a sling — drops `well` straight into the SAME
    // `bodies` array step() already iterates, so the existing pairwise
    // N-body loop pulls every planet toward it with zero new force code.
    // Once armed, the well tracks the pointer live for as long as it's
    // held, and dissolves back out on release. `well.kinematic` (read by
    // step() below) keeps its OWN position pointer-driven only — without
    // it, real gravity would integrate the well's position too, so it'd
    // silently drift away from the cursor between move events (worst right
    // when held motionless, the one moment it's meant to stay put), and
    // its velocity would accumulate a phantom, motion-unrelated value that
    // then polluted the kinetic-energy stat below. It still exerts (and
    // feels) real force either way — only its own integration is skipped.
    const handlePointerMove = (e) => {
      if (reduceMotionRef.current) return;
      if (!dragStart || e.pointerId !== activePointerId) return;
      const w = worldFromNdc(ndcFromEvent(e));

      if (!wellArmed) {
        const held = performance.now() - dragStartTime > WELL_HOLD_MS;
        const stillNear = dragStart.distanceTo(new THREE.Vector2(w.x, w.y)) < WELL_HOLD_TOLERANCE;
        if (held && stillNear) {
          wellArmed = true;
          well = { pos: dragStart.clone(), vel: new THREE.Vector2(0, 0), mass: WELL_MASS, kinematic: true };
          bodies.push(well);
        } else {
          return;
        }
      }

      well.pos.set(w.x, w.y);
    };

    const handlePointerUp = (e) => {
      if (e.pointerId !== activePointerId) return;

      if (wellArmed) {
        endPress();
        return;
      }

      if (!dragStart) return;
      const w = worldFromNdc(ndcFromEvent(e));
      const end = new THREE.Vector2(w.x, w.y);
      const launchVel = dragStart.clone().sub(end).multiplyScalar(SLING_STRENGTH);

      // Bounded pool: recycle whichever planet currently sits farthest from
      // the stars' own center rather than growing the array without limit
      // — every slingshot always has somewhere to land, and the
      // simulation's own cost never creeps up no matter how many times
      // someone plays with it.
      updateStarsCenter();
      let farthest = 0;
      let farthestDist = -1;
      for (let i = 0; i < planets.length; i++) {
        const d = planets[i].pos.distanceTo(starsCenter);
        if (d > farthestDist) { farthestDist = d; farthest = i; }
      }
      const target = planets[farthest];
      target.pos.copy(dragStart);
      target.vel.copy(launchVel.length() > VELOCITY_CLAMP ? launchVel.normalize().multiplyScalar(VELOCITY_CLAMP) : launchVel);
      target.mass = PLANET_MASS_MIN + Math.random() * (PLANET_MASS_MAX - PLANET_MASS_MIN);
      target.recyclePhase = null;
      target.recycleAlpha = 1;
      for (const p of target.trail) p.copy(dragStart);
      target.trailSpeed.fill(target.vel.length());
      target.trailNearB.fill(
        dragStart.distanceTo(stars[0].pos) < dragStart.distanceTo(stars[1].pos) ? 0 : 1,
      );

      dragStart = null;
      activePointerId = null;
    };
    // pointercancel (a touch hijacked into a scroll, a stylus lift, the
    // browser losing track of the pointer mid-gesture) gets the exact same
    // cleanup as a real release — without this, a press that never
    // receives its matching pointerup would leave dragStart permanently
    // stale, and any LATER, entirely unrelated pointer movement that
    // merely happened to pass near that old press point would satisfy
    // handlePointerMove's held-and-still-near check and arm a phantom well
    // nobody could ever release.
    canvas.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", endPress);

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
        // A kinematic body (the well) still exerted and felt real force
        // above — every planet genuinely gets pulled toward it — but its
        // OWN motion is pointer-driven, not physics-driven, so it skips
        // its own integration entirely rather than accumulating a velocity
        // nothing else ever reads or corrects.
        if (body.kinematic) continue;

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
        // starts a staged recycle instead of teleporting instantly — see
        // the fade-driving pass further below. Only ARMS the transition
        // here (skips planets already mid-transition); the physics keeps
        // integrating it normally throughout (still a real, gravitating
        // body right up until it's actually reset), only its rendered
        // alpha/size fade during "out".
        updateStarsCenter();
        for (const planet of planets) {
          if (!planet.recyclePhase && planet.pos.distanceTo(starsCenter) > ESCAPE_RADIUS) {
            planet.recyclePhase = "out";
            planet.recycleT = 0;
          }
        }
      } else {
        // Reduced motion: instantly resolve any recycle already in flight
        // rather than leaving it frozen at a fractional, dimmed alpha for
        // as long as reduceMotion stays on — matches this app's standing
        // "freeze at the target, skip the animated path" convention rather
        // than a mid-fade stuck state nothing else in this file does.
        for (const planet of planets) {
          if (planet.recyclePhase === "out") {
            const r = SPAWN_R_MIN + Math.random() * (SPAWN_R_MAX - SPAWN_R_MIN);
            const angle = Math.random() * Math.PI * 2;
            const { pos, vel } = circularOrbitState(r, angle);
            planet.pos.copy(pos);
            planet.vel.copy(vel);
            for (const p of planet.trail) p.copy(pos);
            planet.trailSpeed.fill(vel.length());
            planet.trailNearB.fill(pos.distanceTo(stars[0].pos) < pos.distanceTo(stars[1].pos) ? 0 : 1);
          }
          if (planet.recyclePhase) {
            planet.recyclePhase = null;
            planet.recycleAlpha = 1;
          }
        }
      }

      // Every body's own true position, averaged by mass — the actual
      // definition of a system's center of mass, R = Σ(mᵢrᵢ)/Σmᵢ — used
      // only to decide where to *draw* everything, never fed back into the
      // physics above. A genuine N-body system's barycenter can drift as
      // bodies interact (real momentum, not an artificially fixed sun), so
      // rendering relative to it keeps the whole scene visually centered
      // without needing to fake the star's position as immovable. The
      // gravity well, while active, is deliberately left OUT of this sum —
      // it's a real gravitating body physics-wise (see step() above,
      // which reads straight off `bodies`), but a temporary tool the
      // visitor is actively dragging around shouldn't itself drag the
      // camera's own reference frame along with it.
      barycenter.set(0, 0);
      let totalMass = 0;
      for (const body of stars) {
        barycenter.x += body.pos.x * body.mass;
        barycenter.y += body.pos.y * body.mass;
        totalMass += body.mass;
      }
      for (const body of planets) {
        barycenter.x += body.pos.x * body.mass;
        barycenter.y += body.pos.y * body.mass;
        totalMass += body.mass;
      }
      barycenter.multiplyScalar(1 / totalMass);

      // The system's own real total kinetic energy — Σ½mv², over every
      // CURRENTLY gravitating body (including the well while it's active,
      // an honest reading of what's actually happening physically) —
      // purely for the panel chrome's own display (see onSystemStats
      // below); nothing downstream of the stepper above ever reads this
      // back.
      let kineticEnergy = 0;
      for (const body of bodies) kineticEnergy += 0.5 * body.mass * body.vel.lengthSq();

      if (onSystemStatsRef.current && now - lastStatsEmitRef.current > STATS_EMIT_MS) {
        lastStatsEmitRef.current = now;
        onSystemStatsRef.current({ kineticEnergy, bodyCount: bodies.length });
      }

      if (!reduceMotionRef.current) {
        for (const planet of planets) {
          for (let t = planet.trail.length - 1; t > 0; t--) {
            planet.trail[t].copy(planet.trail[t - 1]);
            planet.trailSpeed[t] = planet.trailSpeed[t - 1];
            planet.trailNearB[t] = planet.trailNearB[t - 1];
          }
          planet.trail[0].copy(planet.pos);
          planet.trailSpeed[0] = planet.vel.length();
          planet.trailNearB[0] = planet.pos.distanceTo(stars[0].pos) < planet.pos.distanceTo(stars[1].pos) ? 0 : 1;

          // Advances the staged recycle: "out" fades alpha/size toward 0,
          // then performs the actual position/velocity reset (the same
          // fresh-circular-orbit teleport the old instant version always
          // did) and flips straight into "in", which fades back up from 0
          // on the new orbit — a burn-away/reform beat instead of a pop.
          if (planet.recyclePhase === "out") {
            planet.recycleT += dt;
            planet.recycleAlpha = Math.max(0, 1 - planet.recycleT / RECYCLE_OUT_S);
            if (planet.recycleT >= RECYCLE_OUT_S) {
              const r = SPAWN_R_MIN + Math.random() * (SPAWN_R_MAX - SPAWN_R_MIN);
              const angle = Math.random() * Math.PI * 2;
              const { pos, vel } = circularOrbitState(r, angle);
              planet.pos.copy(pos);
              planet.vel.copy(vel);
              for (const p of planet.trail) p.copy(pos);
              planet.trailSpeed.fill(vel.length());
              planet.trailNearB.fill(pos.distanceTo(stars[0].pos) < pos.distanceTo(stars[1].pos) ? 0 : 1);
              planet.recyclePhase = "in";
              planet.recycleT = 0;
            }
          } else if (planet.recyclePhase === "in") {
            planet.recycleT += dt;
            planet.recycleAlpha = Math.min(1, planet.recycleT / RECYCLE_IN_S);
            if (planet.recycleT >= RECYCLE_IN_S) {
              planet.recyclePhase = null;
              planet.recycleAlpha = 1;
            }
          }
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

          const fade = (1 - t / TRAIL_LENGTH) * planet.recycleAlpha;
          alphas[idx] = fade * fade * 0.85;
          sizes[idx] = (5 + planet.mass * 4) * fade + 2;

          // Velocity-tinted trail: this SEGMENT's own recorded speed (not
          // the planet's current live speed) blends its stored color
          // toward the nearer star's hue — a perihelion whip glows hot
          // along the whole trail it left, not just at the head.
          const speedT = Math.min(1, planet.trailSpeed[t] / VELOCITY_CLAMP) * SPEED_TINT_STRENGTH;
          const hot = planet.trailNearB[t] === 0 ? starColorA : starColorB;
          colors[idx * 3] = planet.color.r + (hot.r - planet.color.r) * speedT;
          colors[idx * 3 + 1] = planet.color.g + (hot.g - planet.color.g) * speedT;
          colors[idx * 3 + 2] = planet.color.b + (hot.b - planet.color.b) * speedT;
        }
      }

      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.aAlpha.needsUpdate = true;
      geometry.attributes.aSize.needsUpdate = true;
      geometry.attributes.aColor.needsUpdate = true;

      const starPos = starGeometry.attributes.position.array;
      for (let i = 0; i < stars.length; i++) {
        starPos[i * 3] = stars[i].pos.x - barycenter.x;
        starPos[i * 3 + 1] = stars[i].pos.y - barycenter.y;
      }
      starGeometry.attributes.position.needsUpdate = true;

      const wellAttrs = wellGeometry.attributes;
      if (well) {
        wellAttrs.position.array[0] = well.pos.x - barycenter.x;
        wellAttrs.position.array[1] = well.pos.y - barycenter.y;
        wellAttrs.aAlpha.array[0] = 0.5;
      } else {
        wellAttrs.aAlpha.array[0] = 0;
      }
      wellAttrs.position.needsUpdate = true;
      wellAttrs.aAlpha.needsUpdate = true;

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
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", endPress);
      resizeObserver.disconnect();
      geometry.dispose();
      material.dispose();
      starGeometry.dispose();
      starMaterial.dispose();
      wellGeometry.dispose();
      wellMaterial.dispose();
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
