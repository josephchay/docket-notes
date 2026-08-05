import { useEffect, useRef } from "react";
import * as THREE from "three";

import { resolveCssColor } from "../History/HistoryAmbient";
import { NOTE_COLORS } from "../../constants/colors";

THREE.ColorManagement.enabled = false;

const CANVAS_W = 480;
const CANVAS_H = 420;

// The lattice: 4×3×3 rather than a symmetric cube, so it actually reads as
// a cuboid rather than a cube once it's rotating and foreshortened.
const NX = 4, NY = 3, NZ = 3;
const SPACING = 1.3;
const PARTICLE_COUNT = NX * NY * NZ;
// A genuine world-space radius (comparable to half the lattice spacing, so
// neighboring particles' fields can actually overlap and merge when pulled
// together) — converted to a pixel radius per-particle, per-frame, by the
// real perspective size relation in the physics loop below, not a fixed
// pixel figure faked to "look right" at one depth.
const WORLD_RADIUS = 0.85;

// A damped spring pulling each particle back to its own lattice point —
// ω = √(k/m) ≈ 6.3 rad/s, so ω·dt ≈ 0.1 at 60fps, roughly 19× under the
// ω·dt < 2 stability bound semi-implicit Euler needs for an undamped
// oscillator (damping only helps from there). Checked by hand before this
// ever ran as code, the same way every other spring/PDE stepper this
// session was.
const SPRING_K = 40;
const SPRING_DAMPING = 9;

// Cursor repulsion: real inverse-square falloff (1/r² is the correct 3D
// analogue here, unlike the 1/r AmbientField's dust field uses — that one
// derived 1/r as correct specifically for a field confined to a 2D plane;
// this cuboid is a genuine 3D volume). Clamped at both ends: MIN_DIST stops
// 1/r² from blowing up as a particle nears the cursor's own depth-plane
// position, REPEL_RANGE keeps the push local to the particles actually
// near the pointer rather than the whole cuboid flinching at once.
const REPEL_K = 2.0;
const REPEL_RANGE = 2.5;
const REPEL_MIN_DIST = 0.3;
// A fast swipe pushes harder than a slow hover — real fluid drag scales
// with velocity, not just proximity. Scales REPEL_K up to 4× at a full-
// canvas swipe in under a fifth of a second; clamped so a single huge
// pointer jump (a window regaining focus, say) can't spike it further.
const REPEL_SPEED_GAIN = 0.6;
const REPEL_SPEED_MAX_BOOST = 3;
const VELOCITY_CLAMP = 8; // world units/s — a hard safety net on top of the analysis above, not load-bearing on its own

// Mutual repulsion between particles themselves, the same 1/r² family as
// the cursor's own push — "personal space" rather than a constant field.
// MUTUAL_RANGE sits just inside the lattice's own resting spacing (1.3), so
// an undisturbed cuboid feels essentially nothing from this (neighbors sit
// just outside range at rest) — it only activates once the cursor (or a
// grabbed particle, below) has actually pushed two particles closer than
// they'd naturally sit, at which point they push back on each other too,
// not just spring individually back to their own lattice point.
const MUTUAL_K = 1.0;
const MUTUAL_RANGE = 1.15;
const MUTUAL_MIN_DIST = 0.25;

// A particle can be picked up directly (see handlePointerDown below) and
// springs toward the cursor's own 3D position on a stiffer, snappier spring
// than the lattice's normal one — ω = √90 ≈ 9.49 rad/s, ω·dt ≈ 0.47 at the
// clamped worst-case dt, still comfortably under the 2.0 stability bound.
const GRAB_SPRING_K = 90;
const GRAB_SPRING_DAMPING = 16;
const PICK_RADIUS = 46; // px — screen-space click tolerance for grabbing a particle

const ROTATE_SPEED = 0.22; // rad/s
const PHYSICS_DT_MAX = 0.05;

const VERT = `
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`;

// The same gaussian-metaball technique LiquidMeter.jsx/InkGoo.jsx already
// use, generalized from a handful of balls to a whole lattice's worth —
// verified safe at this particle count specifically because a cuboid you
// can actually parse as a cuboid only ever needs a few dozen points to
// begin with (a few hundred would just read as a fuzzy cloud, not a
// recognizable box), which keeps the O(particles × pixels) field summation
// this relies on comfortably cheap regardless. Each particle now carries
// its own color (see uBallColors, assigned per lattice position in JS); the
// blended color at any pixel is the field-weighted average of every
// contributing ball's color — the standard way multi-color metaballs mix
// (a pixel dominated by one nearby ball reads mostly that ball's color,
// one equidistant between two different-colored balls reads as a genuine
// blend of both) — real ink mixing, not one flat tint with a rim highlight.
const FRAG = `
  precision highp float;

  uniform vec2 uResolution;
  uniform float uDpr;
  uniform vec3 uBalls[${ PARTICLE_COUNT }];
  uniform vec3 uBallColors[${ PARTICLE_COUNT }];
  uniform vec3 uRim;
  uniform vec3 uBg;

  void main() {
    vec2 p = gl_FragCoord.xy / uDpr;
    p.y = uResolution.y - p.y;

    float field = 0.0;
    vec3 colorSum = vec3(0.0);
    for (int i = 0; i < ${ PARTICLE_COUNT }; i++) {
      vec3 b = uBalls[i];
      vec2 d = p - b.xy;
      float contribution = exp(-dot(d, d) / (b.z * b.z));
      field += contribution;
      colorSum += uBallColors[i] * contribution;
    }

    vec3 blended = field > 0.0001 ? colorSum / field : uRim;
    float body = smoothstep(0.5, 0.56, field);
    float rim = smoothstep(0.5, 0.6, field) * (1.0 - smoothstep(0.6, 1.05, field));
    vec3 col = mix(blended, uRim, rim * 0.5);

    if (body < 0.01) discard;
    gl_FragColor = vec4(mix(uBg, col, body), 1.0);
  }
`;

// A cuboid lattice of ink particles, each on its own damped spring back to
// its resting grid point, that the cursor pushes through like a real
// physical field rather than a decorative hover state. The metaball
// blending is genuine (the same technique LiquidMeter's ink vial uses, see
// FRAG above) — the 3D↔2D conversion behind it leans entirely on Three.js's
// own Camera.project/unproject rather than any hand-derived perspective
// math, specifically so the one part of this that's hardest to verify by
// hand never has to be.
const ParticleCuboid = ({ active, reduceMotion = false }) => {
  const canvasRef = useRef(null);
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

  useEffect(() => {
    if (!active) return undefined;

    const canvas = canvasRef.current;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(CANVAS_W, CANVAS_H, false);

    // The quad that actually gets painted — an orthographic camera over a
    // fullscreen triangle-pair, exactly LiquidMeter.jsx's own setup, driven
    // by the uBalls uniform the physics below computes every frame.
    const scene = new THREE.Scene();
    const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // A second camera that never renders anything — used purely as a
    // trusted math object (project/unproject) to convert the lattice's real
    // 3D physics into the 2D ball positions the quad shader above actually
    // draws, and to find where the 2D cursor sits in 3D at each particle's
    // own depth. Simple, fixed pose (looking straight down -Z, no roll) so
    // "which way is world +X/+Y" never depends on the cuboid's own rotation
    // — only the lattice itself rotates, the camera stays put.
    const worldCamera = new THREE.PerspectiveCamera(48, CANVAS_W / CANVAS_H, 0.1, 100);
    worldCamera.position.set(0, 0, 8.5);
    worldCamera.lookAt(0, 0, 0);
    worldCamera.updateMatrixWorld();

    const uniforms = {
      uResolution: { value: new THREE.Vector2(CANVAS_W, CANVAS_H) },
      uDpr: { value: dpr },
      uBalls: { value: Array.from({ length: PARTICLE_COUNT }, () => new THREE.Vector3()) },
      // NOTE_COLORS' own hex strings, not resolveCssColor — they're already
      // plain values, not CSS custom properties, and (unlike uRim/uBg
      // below) don't change with the light/dark theme, so they're set once
      // here and never touched by the theme observer further down.
      uBallColors: { value: Array.from({ length: PARTICLE_COUNT }, () => new THREE.Color()) },
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

    // Cycled by (ix+iy+iz), not banded along one axis alone — a particle's
    // color still shifts smoothly to its neighbors along any of the three
    // axes (moving one step along X, Y, or Z each changes the sum by 1, one
    // palette step), rather than the whole cuboid reading as flat colored
    // slabs stacked along a single direction.
    const palette = Object.values(NOTE_COLORS).map((hex) => new THREE.Color(hex));

    // The lattice itself: each particle's own rest point (unrotated, local
    // space), current position, and velocity.
    const half = { x: (NX - 1) / 2, y: (NY - 1) / 2, z: (NZ - 1) / 2 };
    const particles = [];
    for (let ix = 0; ix < NX; ix++) {
      for (let iy = 0; iy < NY; iy++) {
        for (let iz = 0; iz < NZ; iz++) {
          const restLocal = new THREE.Vector3(
            (ix - half.x) * SPACING,
            (iy - half.y) * SPACING,
            (iz - half.z) * SPACING,
          );
          const index = particles.length;
          uniforms.uBallColors.value[index].copy(palette[(ix + iy + iz) % palette.length]);
          particles.push({
            restLocal,
            restWorld: restLocal.clone(),
            pos: restLocal.clone(),
            vel: new THREE.Vector3(),
          });
        }
      }
    }

    // Pointer tracked in NDC (-1..1), the coordinate space Camera.project
    // already returns and Camera.unproject already expects — no separate
    // pixel→NDC conversion needed anywhere else below.
    const pointerNdc = { x: 2, y: 2 }; // starts well off-screen so nothing repels before a real pointer event
    const handlePointerMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    };
    const handlePointerLeave = () => { pointerNdc.x = 2; pointerNdc.y = 2; };
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerleave", handlePointerLeave);

    // Which particle (if any) is currently held — picked by nearest
    // screen-space distance against last frame's own rendered ball
    // positions (uBalls is already exactly that: px, py, radius per
    // particle), rather than a fresh raycast. Released on pointerup
    // anywhere in the window, not just the canvas, so a drag that ends
    // outside it (a fast flick past the panel's own edge) still lets go
    // cleanly instead of leaving a particle stuck following a pointer
    // that's no longer being tracked here.
    let grabbed = -1;
    const handlePointerDown = (e) => {
      if (reduceMotionRef.current) return;

      const rect = canvas.getBoundingClientRect();
      const clickX = ((e.clientX - rect.left) / rect.width) * CANVAS_W;
      const clickY = ((e.clientY - rect.top) / rect.height) * CANVAS_H;

      let nearest = -1;
      let nearestDist = PICK_RADIUS;
      for (let i = 0; i < particles.length; i++) {
        const b = uniforms.uBalls.value[i];
        const d = Math.hypot(b.x - clickX, b.y - clickY);
        if (d < nearestDist) { nearestDist = d; nearest = i; }
      }
      grabbed = nearest;
    };
    const handlePointerUp = () => { grabbed = -1; };
    canvas.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointerup", handlePointerUp);

    let angle = 0;
    let lastTime = performance.now();
    let raf = null;

    const projected = new THREE.Vector3();
    const cursorAtDepth = new THREE.Vector3();
    const mutualForce = Array.from({ length: PARTICLE_COUNT }, () => ({ x: 0, y: 0, z: 0 }));
    const prevPointerNdc = { x: 2, y: 2 };
    const rotationMatrix = new THREE.Matrix4();

    const tick = () => {
      raf = requestAnimationFrame(tick);

      const now = performance.now();
      const dt = Math.min(PHYSICS_DT_MAX, (now - lastTime) / 1000);
      lastTime = now;

      if (!reduceMotionRef.current) angle += ROTATE_SPEED * dt;
      rotationMatrix.makeRotationY(angle);

      // How fast the pointer itself is moving right now (NDC units/s) — a
      // fast swipe boosts the repulsion below; a still pointer (including
      // the off-screen (2,2) idle position, whose own "speed" the instant
      // a real pointermove first lands would otherwise spike this) reads as
      // zero. dt is already clamped above, so this can't spike from a huge
      // divide-by-tiny-dt either.
      const pointerSpeed = Math.hypot(pointerNdc.x - prevPointerNdc.x, pointerNdc.y - prevPointerNdc.y) / dt;
      const speedBoost = Math.min(REPEL_SPEED_MAX_BOOST, pointerSpeed * REPEL_SPEED_GAIN);
      prevPointerNdc.x = pointerNdc.x;
      prevPointerNdc.y = pointerNdc.y;

      // Mutual repulsion, computed as its own pass over every pair before
      // anyone moves this frame (see MUTUAL_* above) — 630 pairs for 36
      // particles, trivial, and it means the force every particle feels is
      // based on where its neighbors actually were at the start of the
      // step rather than a mix of already-moved and not-yet-moved ones
      // depending on loop order.
      for (let i = 0; i < particles.length; i++) {
        mutualForce[i].x = 0; mutualForce[i].y = 0; mutualForce[i].z = 0;
      }
      if (!reduceMotionRef.current) {
        for (let i = 0; i < particles.length; i++) {
          for (let j = i + 1; j < particles.length; j++) {
            const dx = particles[i].pos.x - particles[j].pos.x;
            const dy = particles[i].pos.y - particles[j].pos.y;
            const dz = particles[i].pos.z - particles[j].pos.z;
            const dist = Math.max(MUTUAL_MIN_DIST, Math.hypot(dx, dy, dz));
            if (dist >= MUTUAL_RANGE) continue;

            const push = MUTUAL_K / (dist * dist);
            const fx = (dx / dist) * push;
            const fy = (dy / dist) * push;
            const fz = (dz / dist) * push;
            mutualForce[i].x += fx; mutualForce[i].y += fy; mutualForce[i].z += fz;
            mutualForce[j].x -= fx; mutualForce[j].y -= fy; mutualForce[j].z -= fz;
          }
        }
      }

      for (let i = 0; i < particles.length; i++) {
        const particle = particles[i];
        particle.restWorld.copy(particle.restLocal).applyMatrix4(rotationMatrix);
        const isGrabbed = i === grabbed;

        // A held particle springs toward the cursor's own 3D position (at
        // its own depth) on the stiffer GRAB_SPRING instead of toward its
        // lattice point on the normal one — everyone else keeps springing
        // home as usual.
        let targetX = particle.restWorld.x, targetY = particle.restWorld.y, targetZ = particle.restWorld.z;
        let k = SPRING_K, damping = SPRING_DAMPING;

        if (isGrabbed && !reduceMotionRef.current) {
          projected.copy(particle.pos).project(worldCamera);
          cursorAtDepth.set(pointerNdc.x, pointerNdc.y, projected.z).unproject(worldCamera);
          targetX = cursorAtDepth.x; targetY = cursorAtDepth.y; targetZ = cursorAtDepth.z;
          k = GRAB_SPRING_K; damping = GRAB_SPRING_DAMPING;
        }

        const ax = (targetX - particle.pos.x) * k - particle.vel.x * damping;
        const ay = (targetY - particle.pos.y) * k - particle.vel.y * damping;
        const az = (targetZ - particle.pos.z) * k - particle.vel.z * damping;

        // A held particle doesn't flee its own cursor — it's being pulled
        // toward it on purpose above, and letting repulsion fight that
        // spring at the same time would just read as jitter.
        let rx = 0, ry = 0, rz = 0;
        if (!reduceMotionRef.current && !isGrabbed) {
          // Where the cursor sits in 3D, at this particle's own depth —
          // projecting the particle to learn its NDC-Z, then unprojecting
          // the pointer's own NDC-XY at that same Z. Both calls are
          // Three.js's own, not hand-derived perspective math.
          projected.copy(particle.pos).project(worldCamera);
          cursorAtDepth.set(pointerNdc.x, pointerNdc.y, projected.z).unproject(worldCamera);

          const dx = particle.pos.x - cursorAtDepth.x;
          const dy = particle.pos.y - cursorAtDepth.y;
          const dz = particle.pos.z - cursorAtDepth.z;
          const dist = Math.max(REPEL_MIN_DIST, Math.hypot(dx, dy, dz));

          if (dist < REPEL_RANGE) {
            const push = (REPEL_K * (1 + speedBoost)) / (dist * dist);
            rx = (dx / dist) * push;
            ry = (dy / dist) * push;
            rz = (dz / dist) * push;
          }
        }

        particle.vel.x += (ax + rx + mutualForce[i].x) * dt;
        particle.vel.y += (ay + ry + mutualForce[i].y) * dt;
        particle.vel.z += (az + rz + mutualForce[i].z) * dt;

        const speed = particle.vel.length();
        if (speed > VELOCITY_CLAMP) particle.vel.multiplyScalar(VELOCITY_CLAMP / speed);

        particle.pos.x += particle.vel.x * dt;
        particle.pos.y += particle.vel.y * dt;
        particle.pos.z += particle.vel.z * dt;
      }

      // Project every particle's final position to screen pixels for the
      // metaball shader — apparent radius scaled by the standard
      // perspective size relation (size ∝ 1/distance-from-camera), so
      // particles further from the camera read as smaller, the same real
      // depth cue an actual object recedes with.
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i].pos;
        const viewDist = worldCamera.position.distanceTo(p);
        const screenScale = (CANVAS_H / 2) / (viewDist * Math.tan((worldCamera.fov * Math.PI) / 360));

        projected.copy(p).project(worldCamera);
        const px = (projected.x * 0.5 + 0.5) * CANVAS_W;
        const py = (1 - (projected.y * 0.5 + 0.5)) * CANVAS_H;
        // World-space radius × (pixels per world unit at this depth) — the
        // bug this replaced multiplied a *pixel* figure by that same
        // px/unit scale, which is a units error (px × px/unit = px²/unit),
        // not just a bad number; this is now dimensionally the right thing.
        const radius = Math.max(6, WORLD_RADIUS * screenScale);

        uniforms.uBalls.value[i].set(px, py, radius);
      }

      renderer.render(scene, quadCamera);
    };

    const handleVisibility = () => {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = null;
      } else if (!raf) {
        lastTime = performance.now(); // drop the paused-time gap rather than feeding the physics a huge dt on return
        tick();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    tick();

    // Same re-tint convention as LiquidMeter.jsx — this panel can plausibly
    // stay open across a theme toggle (it's reachable from the command
    // palette, which itself stays open over other panels), so the rim/bg
    // colors shouldn't go stale until it's closed and reopened. The
    // particles' own palette colors are theme-invariant (NOTE_COLORS is the
    // same set in both themes) and were only ever set once, above.
    const themeObserver = new MutationObserver(() => {
      uniforms.uRim.value.set(resolveCssColor("var(--page-bg-color)"));
      uniforms.uBg.value.set(resolveCssColor("var(--page-bg-color)"));
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", handleVisibility);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerup", handlePointerUp);
      themeObserver.disconnect();
      quad.geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [active]);

  return (
    <canvas
      ref={ canvasRef }
      className="particle-cuboid-canvas"
      width={ CANVAS_W }
      height={ CANVAS_H }
      aria-hidden="true"
    />
  );
};

export default ParticleCuboid;
