import { useEffect, useRef } from "react";
import * as THREE from "three";

import { resolveCssColor } from "../History/HistoryAmbient";

import "./MetaballField.css";

THREE.ColorManagement.enabled = false;

// Real 3D metaballs, raymarched — a genuinely different rendering
// technique from every other Particles/ demo, which all draw either point
// sprites (GravityField.jsx, ChladniField.jsx, BoidField.jsx...), line
// segments (EpicycleField.jsx, LSystemField.jsx), or a flat analytical
// field sampled once per pixel with no notion of depth (InterferenceField
// .jsx). This is the first with actual 3D geometry, and it has none of it
// as a mesh: every pixel's own ray is marched by hand through a scene
// defined entirely as math (a signed distance function — a formula that
// returns, for any point in space, the distance to the nearest surface),
// sphere-traced (step by exactly that returned distance every iteration,
// which is safe by construction: a real SDF can never report a distance
// larger than the true one, so a step of that length can never overshoot
// through a surface) until it's close enough to count as a hit or has
// traveled too far to matter.
//
// The blend between blobs (see map() below) is Inigo Quilez's polynomial
// smooth minimum — a real, widely-published closed form (iquilezles.org,
// "smooth minimum"), not a fade dressed up as one: smin(a, b, k) reduces
// to plain min(a, b) as k → 0, and its own first derivative stays
// continuous through the blend region, which is what a corner-free molten
// merge actually requires and a naive min() of two SDFs can't give at
// all — two spheres under plain min() meet at a sharp crease.
//
// Surface normals come from the SDF's own gradient (central differences
// across map(), see calcNormal) — a real mathematical fact, not a
// approximation invented for this file: for an exact signed distance
// field, |∇f| = 1 everywhere and ∇f points away from the surface along
// the normal, by definition of what "distance to the surface" means.
// Shadows are Inigo Quilez's own soft-shadow technique (also a real,
// widely-published technique, not an ad hoc darkening): a second march
// toward the light tracks how close that ray ever passes to any
// occluder relative to distance traveled, which is what gives a
// continuous penumbra instead of a binary lit/shadowed edge. Lit from the
// exact same fixed direction (−0.45, 0.65, 0.6) SplatFluidRenderer.js's
// own fluid shading already uses, so this reads as lit by the same "sun"
// as everything else in the app rather than inventing its own convention.
const NUM_BLOBS = 6;
const SMOOTH_K = 0.85;
const FLOOR_Y = -2.0;

const CAMERA_POS = new THREE.Vector3(0, 1.8, 6.5);
const CAMERA_TARGET = new THREE.Vector3(0, -0.6, 0);
const FOV_DEG = 50;

// Simple, deliberately modest physics — gravity, floor bounce with
// restitution and friction, gentle mutual repulsion (allowing real partial
// overlap, since the whole point of smin blending is watching overlapping
// blobs read as one molten surface, not staying apart), and a soft
// cylindrical wall so the cluster stays in frame. Nothing here claims to
// be a physics contribution the way GravityField.jsx's real N-body or
// ClothField.jsx's real Verlet constraints are — the actual subject this
// round is the raymarched rendering above, and this exists only to give
// it something worth rendering.
const GRAVITY = 4.5;
const RESTITUTION = 0.42;
const REPEL_STRENGTH = 3.5;
const WALL_RADIUS = 2.1;
const DRAG_PLANE_Y = FLOOR_Y + 0.9;
const DRAG_REPEL_RADIUS = 1.6;
const DRAG_REPEL_STRENGTH = 14;

const MAX_STEPS = 70;
const MAX_DIST = 20.0;
const SURFACE_EPS = 0.0015;
const SHADOW_STEPS = 28;

const REDUCED_MOTION_SETTLE_STEPS = 260;

const PASSTHROUGH_VERT = `
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`;

// NUM_BLOBS/MAX_STEPS/SHADOW_STEPS are all GLSL for-loop bounds, which
// GLSL ES 1.0 requires to be compile-time constants — template-
// interpolated here (the same necessity LeniaField.jsx's own kernel loop
// and InterferenceField.jsx's own source loop already have) so the JS-side
// blob array length and these loop bounds can never drift apart.
const FRAG = `
  precision highp float;
  uniform vec2 uResolution;
  uniform vec3 uCameraPos;
  uniform vec3 uCameraForward;
  uniform vec3 uCameraRight;
  uniform vec3 uCameraUp;
  uniform float uFovScale;
  uniform vec3 uBlobPos[${NUM_BLOBS}];
  uniform float uBlobRadius[${NUM_BLOBS}];
  uniform vec3 uPaper;
  uniform vec3 uInk;

  // Polynomial smooth minimum (Inigo Quilez) — see the file header.
  float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
  }

  // Scene distance + material id (0 = ink blob, 1 = paper floor) packed
  // into one vec2 — the standard way to carry "which surface actually won
  // the min" alongside the distance itself through a raymarch.
  vec2 map(vec3 p) {
    float d = 1.0e5;
    for (int i = 0; i < ${NUM_BLOBS}; i++) {
      float bd = length(p - uBlobPos[i]) - uBlobRadius[i];
      d = smin(d, bd, ${SMOOTH_K.toFixed(4)});
    }
    float floorD = p.y - ${FLOOR_Y.toFixed(4)};
    if (floorD < d) return vec2(floorD, 1.0);
    return vec2(d, 0.0);
  }

  vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(
      map(p + e.xyy).x - map(p - e.xyy).x,
      map(p + e.yxy).x - map(p - e.yxy).x,
      map(p + e.yyx).x - map(p - e.yyx).x
    ));
  }

  float softShadow(vec3 ro, vec3 rd, float mint, float maxt, float k) {
    float res = 1.0;
    float t = mint;
    for (int i = 0; i < ${SHADOW_STEPS}; i++) {
      if (t >= maxt) break;
      float h = map(ro + rd * t).x;
      if (h < 0.001) return 0.0;
      res = min(res, k * h / t);
      t += clamp(h, 0.01, 0.5);
    }
    return clamp(res, 0.0, 1.0);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
    vec3 rd = normalize(uCameraForward + uv.x * uFovScale * uCameraRight + uv.y * uFovScale * uCameraUp);
    vec3 ro = uCameraPos;

    float t = 0.0;
    float mat = -1.0;
    for (int i = 0; i < ${MAX_STEPS}; i++) {
      vec3 p = ro + rd * t;
      vec2 res = map(p);
      if (res.x < ${SURFACE_EPS.toFixed(6)}) { mat = res.y; break; }
      t += res.x;
      if (t > ${MAX_DIST.toFixed(2)}) break;
    }

    vec3 col = uPaper * 0.94;
    if (mat >= 0.0) {
      vec3 p = ro + rd * t;
      vec3 n = calcNormal(p);
      vec3 lightDir = normalize(vec3(-0.45, 0.65, 0.6));
      float diff = max(dot(n, lightDir), 0.0);
      vec3 viewDir = normalize(ro - p);
      vec3 halfDir = normalize(lightDir + viewDir);
      float spec = pow(max(dot(n, halfDir), 0.0), 40.0);
      float shadow = softShadow(p + n * 0.02, lightDir, 0.02, 8.0, 16.0);

      vec3 base = mat > 0.5 ? uPaper : uInk;
      col = base * (0.32 + 0.68 * diff * shadow) + vec3(1.0) * spec * shadow * 0.35;
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

// Ray-vs-horizontal-plane intersection — used only to turn a 2D drag into
// a 3D repulsion point (see handlePointerMove below), the one place this
// file needs the inverse of the camera-ray construction the shader itself
// only ever runs forward.
const intersectPlaneY = (ro, rd, planeY) => {
  if (Math.abs(rd.y) < 1e-6) return null;
  const t = (planeY - ro.y) / rd.y;
  if (t < 0) return null;
  return new THREE.Vector3(ro.x + rd.x * t, planeY, ro.z + rd.z * t);
};

// active/reduceMotion follow every other Particles/ field's own contract.
// tossToken bumps to give every blob a fresh upward, randomized velocity
// kick (the panel's own "Toss" button) — positions untouched, so they
// genuinely bounce and resettle from real momentum rather than being
// teleported back to a tidy start, the same contract BoidField's own
// "Startle" and CrystalField's own "New crystal" already hold themselves
// to for their own replay actions.
const MetaballField = ({ active, reduceMotion = false, tossToken = 0 }) => {
  const canvasRef = useRef(null);
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  const tossFnRef = useRef(null);

  useEffect(() => {
    if (!active) return undefined;

    const canvas = canvasRef.current;
    const parent = canvas.parentElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: false });
    renderer.setPixelRatio(dpr);

    const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadGeometry = new THREE.PlaneGeometry(2, 2);

    // The raymarch camera's own basis — fixed for the panel's lifetime
    // (nothing here ever moves the camera), computed once rather than
    // rebuilt every frame.
    const forward = new THREE.Vector3().subVectors(CAMERA_TARGET, CAMERA_POS).normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward);
    const fovScale = Math.tan(((FOV_DEG * Math.PI) / 180) / 2);

    const uniforms = {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uCameraPos: { value: CAMERA_POS.clone() },
      uCameraForward: { value: forward },
      uCameraRight: { value: right },
      uCameraUp: { value: up },
      uFovScale: { value: fovScale },
      uBlobPos: { value: Array.from({ length: NUM_BLOBS }, () => new THREE.Vector3()) },
      uBlobRadius: { value: new Array(NUM_BLOBS).fill(0.6) },
      uPaper: { value: new THREE.Color(resolveCssColor("var(--page-surface-color)")) },
      uInk: { value: new THREE.Color(resolveCssColor("var(--page-ink-color)")) },
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: PASSTHROUGH_VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(quadGeometry, material));

    const themeObserver = new MutationObserver(() => {
      uniforms.uPaper.value.set(resolveCssColor("var(--page-surface-color)"));
      uniforms.uInk.value.set(resolveCssColor("var(--page-ink-color)"));
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const resize = () => {
      const cssW = parent.clientWidth || 1;
      const cssH = parent.clientHeight || 1;
      renderer.setSize(cssW, cssH, false);
      uniforms.uResolution.value.set(cssW * dpr, cssH * dpr);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(parent);

    const blobs = Array.from({ length: NUM_BLOBS }, (_, i) => ({
      pos: new THREE.Vector3((Math.random() - 0.5) * 2.4, 1 + Math.random() * 2.2, (Math.random() - 0.5) * 1.2),
      vel: new THREE.Vector3(0, 0, 0),
      radius: 0.55 + (i % 3) * 0.12,
    }));

    const toss = () => {
      for (const b of blobs) {
        b.vel.set((Math.random() - 0.5) * 2.5, 3 + Math.random() * 1.5, (Math.random() - 0.5) * 2.5);
      }
    };
    tossFnRef.current = toss;

    let dragging = false;
    const dragPoint = new THREE.Vector3();

    // One physics tick across every blob — gravity, gentle mutual
    // repulsion (allowing real overlap, see the file header), drag-repel
    // while held, then integrate and resolve the floor/wall bounds.
    const step = (dt) => {
      for (const b of blobs) b.vel.y -= GRAVITY * dt;

      for (let i = 0; i < blobs.length; i++) {
        for (let j = i + 1; j < blobs.length; j++) {
          const a = blobs[i], b = blobs[j];
          const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y, dz = b.pos.z - a.pos.z;
          const dist = Math.hypot(dx, dy, dz) || 0.0001;
          const minDist = (a.radius + b.radius) * 0.85;
          if (dist < minDist) {
            const push = (minDist - dist) * REPEL_STRENGTH * dt;
            const nx = dx / dist, ny = dy / dist, nz = dz / dist;
            a.vel.x -= nx * push; a.vel.y -= ny * push; a.vel.z -= nz * push;
            b.vel.x += nx * push; b.vel.y += ny * push; b.vel.z += nz * push;
          }
        }
      }

      if (dragging) {
        for (const b of blobs) {
          const dx = b.pos.x - dragPoint.x, dz = b.pos.z - dragPoint.z;
          const dist = Math.hypot(dx, dz) || 0.0001;
          if (dist < DRAG_REPEL_RADIUS) {
            const push = (1 - dist / DRAG_REPEL_RADIUS) * DRAG_REPEL_STRENGTH * dt;
            b.vel.x += (dx / dist) * push;
            b.vel.z += (dz / dist) * push;
            b.vel.y += push * 0.5;
          }
        }
      }

      for (const b of blobs) {
        b.pos.addScaledVector(b.vel, dt);

        const floorLevel = FLOOR_Y + b.radius;
        if (b.pos.y < floorLevel) {
          b.pos.y = floorLevel;
          if (b.vel.y < 0) b.vel.y = -b.vel.y * RESTITUTION;
          b.vel.x *= 0.9; b.vel.z *= 0.9;
        }

        const r = Math.hypot(b.pos.x, b.pos.z);
        if (r > WALL_RADIUS) {
          const nx = b.pos.x / r, nz = b.pos.z / r;
          b.pos.x = nx * WALL_RADIUS;
          b.pos.z = nz * WALL_RADIUS;
          const vn = b.vel.x * nx + b.vel.z * nz;
          if (vn > 0) { b.vel.x -= vn * nx * 1.4; b.vel.z -= vn * nz * 1.4; }
        }
      }
    };

    const writeBlobUniforms = () => {
      for (let i = 0; i < NUM_BLOBS; i++) {
        uniforms.uBlobPos.value[i].copy(blobs[i].pos);
        uniforms.uBlobRadius.value[i] = blobs[i].radius;
      }
    };

    // Same reduced-motion reasoning as every other Particles/ demo: a
    // synchronous burst so the panel opens on a real, already-settled
    // pile rather than blobs frozen mid-fall. Full-motion visitors watch
    // the actual drop and settle live instead.
    if (reduceMotionRef.current) {
      for (let i = 0; i < REDUCED_MOTION_SETTLE_STEPS; i++) step(1 / 60);
    }
    writeBlobUniforms();

    const ndcFromEvent = (e) => {
      const rect = canvas.getBoundingClientRect();
      const aspect = canvas.clientWidth / canvas.clientHeight;
      return {
        x: ((e.clientX - rect.left) / rect.width - 0.5) * aspect,
        y: -((e.clientY - rect.top) / rect.height - 0.5),
      };
    };
    const rayFromNdc = (ndc) => new THREE.Vector3()
      .copy(forward)
      .addScaledVector(right, ndc.x * fovScale)
      .addScaledVector(up, ndc.y * fovScale)
      .normalize();

    // Under reduced motion, tick() below never calls step() on its own —
    // so without this, dragging would update dragPoint/dragging correctly
    // but the blobs would never visibly react. A small synchronous burst
    // right here mirrors every other Particles/ demo's own reduced-motion
    // drag handling: interaction still moves the blobs, ambient auto-fall
    // still doesn't resume on its own afterward.
    const updateDrag = (e) => {
      const rd = rayFromNdc(ndcFromEvent(e));
      const hit = intersectPlaneY(CAMERA_POS, rd, DRAG_PLANE_Y);
      if (!hit) return;
      dragPoint.copy(hit);
      if (reduceMotionRef.current) {
        for (let i = 0; i < 10; i++) step(1 / 60);
        writeBlobUniforms();
      }
    };

    const handlePointerDown = (e) => { dragging = true; updateDrag(e); };
    const handlePointerMove = (e) => { if (dragging) updateDrag(e); };
    const handlePointerUp = () => { dragging = false; };

    canvas.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    let raf = null;
    let lastTime = performance.now();

    const tick = () => {
      raf = requestAnimationFrame(tick);

      const now = performance.now();
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      if (!reduceMotionRef.current) {
        step(dt);
        writeBlobUniforms();
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

    return () => {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", handleVisibility);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      tossFnRef.current = null;
      quadGeometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [active]);

  // The panel's own "Toss" button bumps tossToken — guarded to >0 so
  // mounting never fires a redundant toss on top of the fresh airborne
  // spawn the effect above already creates, and tossFnRef is nulled on
  // unmount so a stale bump after the panel closes safely no-ops.
  useEffect(() => {
    if (tossToken > 0) tossFnRef.current?.();
  }, [tossToken]);

  return (
    <canvas
      ref={ canvasRef }
      className="metaball-field-canvas"
      aria-hidden="true"
    />
  );
};

export default MetaballField;
