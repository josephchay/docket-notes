import { useEffect, useRef } from "react";
import * as THREE from "three";

import { resolveCssColor } from "../History/HistoryAmbient";

import "./BoidField.css";

THREE.ColorManagement.enabled = false;

// A real flock — Craig Reynolds' 1987 "boids" model (Reynolds, "Flocks,
// Herds, and Schools: A Distributed Behavioral Model," SIGGRAPH 1987), the
// original and still-standard construction for emergent flocking from
// purely local rules. Every other Particles/ demo with many bodies answers
// to either a global force law (GravityField's inverse-square gravity,
// ChladniField's fixed field), a constraint solver (ClothField), or a PDE
// on a grid (InkBloomField). A boid answers to neither — its only inputs
// are the handful of flockmates currently within its own perception
// radius, averaged into three competing desires:
//   separation — steer away from whatever's crowding it right now
//   alignment  — steer to match its neighbors' own average heading
//   cohesion   — steer toward its neighbors' own average position
// No boid ever sees the flock as a whole, and nothing here designates a
// leader; the swirling, splitting, re-merging murmuration read is entirely
// emergent from ~200 individually near-sighted agents each running the
// same three rules. Steering itself follows Reynolds' own standard
// formulation throughout: every rule computes a *desired* velocity, then
// steer = desired − current, clamped to MAX_FORCE — never the desired
// velocity applied directly — which is what lets a boid's own existing
// momentum smoothly blend multiple simultaneous desires instead of
// snapping toward whichever rule fired most recently.
//
// Neighbor search is a plain O(N²) double loop, not a spatial grid —
// deliberately, the same honest reasoning NoteList.jsx's own blob
// separation comment already gives for a smaller N: at BOID_COUNT ≈ 220,
// that's ~48k pair checks/frame, comfortably cheap in JS at 60fps, and
// there's no scale a demo panel would ever reach that'd justify a
// quadtree's own added complexity (utils/quadtree.js, already earning its
// keep in NoteConstellation.jsx, where N and the per-pair cost are both
// substantially higher).
//
// The domain wraps (a torus, not a wall) — exit the right edge, reappear
// on the left — the standard choice for boids specifically: a hard or
// soft boundary would constantly fight cohesion's own pull toward
// whatever's near the domain's actual center, which is a distraction the
// classic demo doesn't have. The camera's own view exactly matches the
// wrap domain (VIEW_EXTENT === DOMAIN_HALF) so the seam sits exactly at
// the canvas edge — a boid vanishes off one side the same instant it
// reappears on the other, never mid-frame.
const DOMAIN_HALF = 6;
const VIEW_EXTENT = DOMAIN_HALF;
const DOMAIN_SIZE = DOMAIN_HALF * 2;

const BOID_COUNT = 220;
const TRAIL_LENGTH = 6;

const PERCEPTION_RADIUS = 1.3;
const SEPARATION_RADIUS = 0.55;

const MAX_SPEED = 3.2;
const MIN_SPEED = 0.9; // real flocking birds don't hover — a floor keeps the flock always visibly airborne rather than letting cohesion settle it into a near-static clump
const MAX_FORCE = 3.5;

const ALIGNMENT_WEIGHT = 1.1; // fixed — BoidPanel exposes separation/cohesion as the two tunable dials (see DEFAULT_SEPARATION_WEIGHT/DEFAULT_COHESION_WEIGHT), a third slider bought little further range worth exploring
const DEFAULT_SEPARATION_WEIGHT = 1.6;
const DEFAULT_COHESION_WEIGHT = 0.9;

const CURSOR_FOLLOW_RADIUS = 4.5;
const CURSOR_FOLLOW_STRENGTH = 0.7;
const CURSOR_SCATTER_RADIUS = 1.8;
const CURSOR_SCATTER_STRENGTH = 14;

const STATS_EMIT_MS = 150;

// Shortest signed offset between two coordinates on a circular domain of
// the given size — e.g. on a size-12 ring, going from 5.5 to −5.5 is a
// step of +1 (via the seam) rather than −11 the raw difference would say.
// Used for every neighbor delta below so cohesion/alignment/separation all
// correctly treat a boid just across the wrap seam as adjacent, not as
// being on the opposite side of the whole domain.
const wrapDelta = (d, size) => {
  if (d > size / 2) return d - size;
  if (d < -size / 2) return d + size;
  return d;
};

const wrapCoord = (v, half) => {
  const size = half * 2;
  if (v > half) return v - size;
  if (v < -half) return v + size;
  return v;
};

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
// (GravityField.jsx, ChladniField.jsx) — one ink color for the whole
// flock, trail-position alpha carrying the "streak fading behind a moving
// body" read rather than any per-point rotation/shape trick.
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

const clampMag = (x, y, max) => {
  const len = Math.hypot(x, y);
  if (len <= max || len < 0.0001) return { x, y };
  const s = max / len;
  return { x: x * s, y: y * s };
};

// active/reduceMotion follow every other Particles/ field's own contract.
// separationWeight/cohesionWeight are read fresh every frame via refs, so
// BoidPanel's own sliders retune the live flock's character — from a tight
// school to a loose scatter — with no reset needed, the same live-retune
// contract ChladniField's own mode steppers already establish. scatterToken
// bumps to fling every boid a fresh random velocity kick (the panel's own
// "Startle" button) without relocating anyone, so the flock visibly regroups
// from real disorder rather than teleporting back to a tidy start state.
// onStats mirrors GravityFieldPanel's own onSystemStats.
const BoidField = ({
  active,
  reduceMotion = false,
  separationWeight = DEFAULT_SEPARATION_WEIGHT,
  cohesionWeight = DEFAULT_COHESION_WEIGHT,
  scatterToken = 0,
  onStats,
}) => {
  const canvasRef = useRef(null);
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  const separationWeightRef = useRef(separationWeight);
  separationWeightRef.current = separationWeight;
  const cohesionWeightRef = useRef(cohesionWeight);
  cohesionWeightRef.current = cohesionWeight;
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

    const makeBoid = () => {
      const angle = Math.random() * Math.PI * 2;
      const speed = MAX_SPEED * 0.6;
      const pos = new THREE.Vector2(
        (Math.random() - 0.5) * DOMAIN_SIZE,
        (Math.random() - 0.5) * DOMAIN_SIZE,
      );
      return {
        pos,
        vel: new THREE.Vector2(Math.cos(angle) * speed, Math.sin(angle) * speed),
        trail: Array.from({ length: TRAIL_LENGTH }, () => pos.clone()),
        size: 3.5 + Math.random() * 2,
      };
    };
    const boids = Array.from({ length: BOID_COUNT }, makeBoid);

    // The panel's own "Startle" button — a fresh random velocity kick for
    // every boid, positions untouched, so the flock scatters from real
    // momentum and has to genuinely regroup rather than being teleported
    // back to a tidy start.
    const scatter = () => {
      for (const b of boids) {
        const angle = Math.random() * Math.PI * 2;
        b.vel.set(Math.cos(angle), Math.sin(angle)).multiplyScalar(MAX_SPEED * 1.4);
      }
    };
    scatterFnRef.current = scatter;

    const trailPointCount = BOID_COUNT * TRAIL_LENGTH;
    const positions = new Float32Array(trailPointCount * 3);
    const alphas = new Float32Array(trailPointCount);
    const sizes = new Float32Array(trailPointCount);

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

    // Same re-tint convention as ChladniField.jsx/InkBloomField.jsx.
    const themeObserver = new MutationObserver(() => {
      uniforms.uColor.value.set(resolveCssColor("var(--page-ink-color)"));
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    // Cursor as a curious presence, not a predator by default: hovering
    // gives every boid within CURSOR_FOLLOW_RADIUS a gentle constant pull
    // (not distance-weighted, so it's felt evenly across the whole radius
    // rather than only right at the cursor), reading as the flock drifting
    // to stay near you. Press and hold flips the same presence into a
    // sharp startle — strong, distance-weighted repulsion within a much
    // tighter radius — the same "ambient is gentle, the held gesture is
    // the real disturbance" layering ClothField's wind/grab pair and
    // GravityField's orbits/slingshot pair already use.
    let pointerInside = false;
    let pointerDown = false;
    const pointerWorld = new THREE.Vector2();
    const ndcFromEvent = (e) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: -(((e.clientY - rect.top) / rect.height) * 2 - 1),
      };
    };
    const worldFromNdc = (ndc) => new THREE.Vector3(ndc.x, ndc.y, 0).unproject(camera);

    // Under reduced motion, tick() below never calls step() on its own —
    // so without this, hovering or pressing would update pointerInside/
    // pointerDown/pointerWorld correctly but the flock would never
    // visibly react at all. A small synchronous burst right here mirrors
    // ChladniField.jsx's own reduced-motion drag handling: interaction
    // still moves the flock, ambient auto-motion still doesn't resume on
    // its own afterward.
    const reducedMotionNudge = () => {
      if (!reduceMotionRef.current) return;
      for (let i = 0; i < 6; i++) totalSpeed = step(0.02);
      writeBuffers();
    };

    const handlePointerMove = (e) => {
      const w = worldFromNdc(ndcFromEvent(e));
      pointerWorld.set(w.x, w.y);
      pointerInside = true;
      reducedMotionNudge();
    };
    const handlePointerLeave = () => { pointerInside = false; pointerDown = false; };
    const handlePointerDown = (e) => {
      const w = worldFromNdc(ndcFromEvent(e));
      pointerWorld.set(w.x, w.y);
      pointerInside = true;
      pointerDown = true;
      reducedMotionNudge();
    };
    const handlePointerUp = () => { pointerDown = false; };

    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerleave", handlePointerLeave);
    canvas.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointerup", handlePointerUp);

    let totalSpeed = 0;

    // One steering pass across every boid — see the file header for the
    // three rules and why steer = desired − current throughout.
    const step = (dt) => {
      const sepW = separationWeightRef.current;
      const cohW = cohesionWeightRef.current;
      let speedSum = 0;

      for (let i = 0; i < BOID_COUNT; i++) {
        const b = boids[i];

        let sepX = 0, sepY = 0, sepCount = 0;
        let aliX = 0, aliY = 0;
        let cohX = 0, cohY = 0, neighborCount = 0;

        for (let j = 0; j < BOID_COUNT; j++) {
          if (j === i) continue;
          const other = boids[j];
          const dx = wrapDelta(other.pos.x - b.pos.x, DOMAIN_SIZE);
          const dy = wrapDelta(other.pos.y - b.pos.y, DOMAIN_SIZE);
          const dist = Math.hypot(dx, dy);
          if (dist >= PERCEPTION_RADIUS || dist < 0.0001) continue;

          aliX += other.vel.x; aliY += other.vel.y;
          cohX += dx; cohY += dy; // accumulate the wrap-corrected DELTA, not other's raw position — averaging deltas and adding to b.pos at use gives the correctly-wrapped "toward local center" direction with no separate unwrap step needed
          neighborCount++;

          if (dist < SEPARATION_RADIUS) {
            // Push away from the neighbor, harder the closer it is.
            sepX -= dx / dist; sepY -= dy / dist;
            sepCount++;
          }
        }

        let steerX = 0;
        let steerY = 0;

        if (neighborCount > 0) {
          const aliLen = Math.hypot(aliX, aliY) || 1;
          const aliDesX = (aliX / aliLen) * MAX_SPEED;
          const aliDesY = (aliY / aliLen) * MAX_SPEED;
          const ali = clampMag(aliDesX - b.vel.x, aliDesY - b.vel.y, MAX_FORCE);
          steerX += ali.x * ALIGNMENT_WEIGHT;
          steerY += ali.y * ALIGNMENT_WEIGHT;

          const cohLen = Math.hypot(cohX, cohY) || 1;
          const cohDesX = (cohX / cohLen) * MAX_SPEED;
          const cohDesY = (cohY / cohLen) * MAX_SPEED;
          const coh = clampMag(cohDesX - b.vel.x, cohDesY - b.vel.y, MAX_FORCE);
          steerX += coh.x * cohW;
          steerY += coh.y * cohW;
        }

        if (sepCount > 0) {
          const sepLen = Math.hypot(sepX, sepY) || 1;
          const sepDesX = (sepX / sepLen) * MAX_SPEED;
          const sepDesY = (sepY / sepLen) * MAX_SPEED;
          const sep = clampMag(sepDesX - b.vel.x, sepDesY - b.vel.y, MAX_FORCE);
          steerX += sep.x * sepW;
          steerY += sep.y * sepW;
        }

        if (pointerInside) {
          const cdx = pointerWorld.x - b.pos.x;
          const cdy = pointerWorld.y - b.pos.y;
          const cdist = Math.hypot(cdx, cdy);
          if (pointerDown) {
            if (cdist < CURSOR_SCATTER_RADIUS && cdist > 0.0001) {
              const push = (1 - cdist / CURSOR_SCATTER_RADIUS) * CURSOR_SCATTER_STRENGTH;
              steerX += (-cdx / cdist) * push;
              steerY += (-cdy / cdist) * push;
            }
          } else if (cdist < CURSOR_FOLLOW_RADIUS && cdist > 0.0001) {
            steerX += (cdx / cdist) * CURSOR_FOLLOW_STRENGTH;
            steerY += (cdy / cdist) * CURSOR_FOLLOW_STRENGTH;
          }
        }

        b.vel.x += steerX * dt;
        b.vel.y += steerY * dt;

        const speed = b.vel.length();
        if (speed > MAX_SPEED) b.vel.multiplyScalar(MAX_SPEED / speed);
        else if (speed > 0.0001 && speed < MIN_SPEED) b.vel.multiplyScalar(MIN_SPEED / speed);

        b.pos.x += b.vel.x * dt;
        b.pos.y += b.vel.y * dt;

        const wrappedX = wrapCoord(b.pos.x, DOMAIN_HALF);
        const wrappedY = wrapCoord(b.pos.y, DOMAIN_HALF);
        const wrapped = wrappedX !== b.pos.x || wrappedY !== b.pos.y;
        b.pos.x = wrappedX;
        b.pos.y = wrappedY;

        if (wrapped) {
          // Snap the whole trail to the post-wrap position instead of
          // leaving stale pre-wrap history behind — otherwise the next
          // TRAIL_LENGTH frames would draw one long streak clear across
          // the domain, the exact "teleport artifact" GravityField's own
          // star-birth respawn avoids the same way.
          for (const p of b.trail) p.copy(b.pos);
        } else {
          for (let t = b.trail.length - 1; t > 0; t--) b.trail[t].copy(b.trail[t - 1]);
          b.trail[0].copy(b.pos);
        }

        speedSum += b.vel.length();
      }

      return speedSum / BOID_COUNT;
    };

    const writeBuffers = () => {
      for (let i = 0; i < BOID_COUNT; i++) {
        const b = boids[i];
        for (let t = 0; t < TRAIL_LENGTH; t++) {
          const idx = i * TRAIL_LENGTH + t;
          const p = b.trail[t];
          positions[idx * 3] = p.x;
          positions[idx * 3 + 1] = p.y;
          positions[idx * 3 + 2] = 0;

          const fade = 1 - t / TRAIL_LENGTH;
          alphas[idx] = fade * fade * 0.85;
          sizes[idx] = b.size * fade + 1.4;
        }
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.aAlpha.needsUpdate = true;
      geometry.attributes.aSize.needsUpdate = true;
    };

    // Populate the render buffers from the initial scatter before the
    // first real frame, then — same reasoning as ChladniField.jsx's own
    // reduced-motion settle — give reduced-motion visitors a synchronous
    // run so the flock opens on a real, already-organized murmuration
    // rather than 220 points frozen mid-launch. Full-motion visitors get
    // the actual emergence live instead, the more interesting thing to
    // watch happen.
    totalSpeed = step(0);
    if (reduceMotionRef.current) {
      for (let i = 0; i < 240; i++) totalSpeed = step(0.02);
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
        totalSpeed = step(dt);
        writeBuffers();
      }

      renderer.render(scene, camera);

      if (onStatsRef.current && now - lastStatsEmit > STATS_EMIT_MS) {
        lastStatsEmit = now;
        onStatsRef.current({ cruiseFraction: Math.min(1, totalSpeed / MAX_SPEED) });
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
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerup", handlePointerUp);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      scatterFnRef.current = null;
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [active]);

  // The panel's own "Startle" button bumps scatterToken — guarded to >0 so
  // mounting never fires a redundant kick on top of the fresh flock the
  // effect above just created, and scatterFnRef is nulled on unmount so a
  // stale bump after the panel closes safely no-ops.
  useEffect(() => {
    if (scatterToken > 0) scatterFnRef.current?.();
  }, [scatterToken]);

  return (
    <canvas
      ref={ canvasRef }
      className="boid-field-canvas"
      aria-hidden="true"
    />
  );
};

export { DEFAULT_SEPARATION_WEIGHT, DEFAULT_COHESION_WEIGHT };
export default BoidField;
