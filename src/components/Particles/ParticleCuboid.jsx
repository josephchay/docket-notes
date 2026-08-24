import { useEffect, useRef } from "react";
import * as THREE from "three";
import gsap from "gsap";

import { resolveCssColor } from "../History/HistoryAmbient";
import { NOTE_COLORS } from "../../constants/colors";
import { playImpact } from "../../utils/sound";

import "./ParticleCuboid.css";

THREE.ColorManagement.enabled = false;

// Only a fallback for the very first frame, before the container's real
// size has ever been measured — dims.w/h (set by the ResizeObserver below,
// the same pattern HistoryAmbient.jsx already uses for the same reason:
// this now lives in settings-preview, a container it doesn't control the
// size of) are what everything below actually renders against.
const FALLBACK_W = 480;
const FALLBACK_H = 300;

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

// A genuine close contact (tighter than the full MUTUAL_RANGE personal-
// space zone) plays the same soft impact cue NotePile.jsx's own physics
// already uses for real matter-js collisions — reused as-is, including its
// own internal volume/pitch response to `strength`, rather than a second
// sound designed just for this. Rate-limited the same way NotePile's own
// impact sound is, so a big disturbance with many close particles at once
// reads as one soft impact rather than a wall of clicks.
const IMPACT_THRESHOLD = 0.45;
const IMPACT_COOLDOWN_MS = 90;

// A particle can be picked up directly (see handlePointerDown below) and
// springs toward the cursor's own 3D position on a stiffer, snappier spring
// than the lattice's normal one — ω = √90 ≈ 9.49 rad/s, ω·dt ≈ 0.47 at the
// clamped worst-case dt, still comfortably under the 2.0 stability bound.
const GRAB_SPRING_K = 90;
const GRAB_SPRING_DAMPING = 16;
const PICK_RADIUS = 46; // px — screen-space click tolerance for grabbing a particle

const ROTATE_SPEED = 0.22; // rad/s
const PHYSICS_DT_MAX = 0.05;

// Release-fling: the pointer's own last swipe velocity (converted from NDC
// to world units at the grabbed particle's depth, the same project/
// unproject trick the grab spring already uses) is added as a one-time
// impulse to particle.vel right as it's let go — the grab spring's own
// heavy GRAB_SPRING_DAMPING mostly damps out velocity WHILE dragging (it's
// tuned for a smooth, controlled follow, not for building up throw speed),
// so without this a "flick and release" would read as barely more than a
// slow drift back home.
const FLING_SAMPLE_DT = 1 / 60;
const FLING_STRENGTH = 1.0;

// Double-click/tap toggles the whole lattice between the cuboid arrangement
// and a Fibonacci-sphere one — a second named target for restLocal, blended
// per-frame by morphState.t (see tick() below) rather than a separate
// tween-the-position system, so the existing spring integrator does all the
// actual morphing motion itself once its target is time-varying.
const SPHERE_RADIUS = 1.8;
const MORPH_DURATION = 0.9;

// Assembly intro: each particle starts scattered outward from its own
// lattice point and gets pulled home by the SAME spring integrator as
// always, just with its restoring strength ramped from 0 to full over
// ASSEMBLY_DURATION (see assembly.k below) instead of snapping to full
// strength the instant the component mounts — no separate position-tween
// needed, the existing integrator does the assembling on its own once it
// has a nonzero k to pull with.
const ASSEMBLY_SCATTER = 3.5; // world units
const ASSEMBLY_DURATION = 0.75;

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
  // 0..1 per particle, VELOCITY_CLAMP-normalized real speed (see tick()) —
  // a fast-moving particle (freshly repelled, grabbed, or just released
  // from a fling) both flares its own field radius wider and flashes
  // toward white, then relaxes back to its resting look as SPRING_DAMPING
  // bleeds its velocity off. Reuses the exact gaussian/colorSum
  // accumulation already below, just modulated per-particle by this.
  uniform float uBallEnergy[${ PARTICLE_COUNT }];
  uniform vec3 uRim;
  uniform vec3 uBg;

  void main() {
    vec2 p = gl_FragCoord.xy / uDpr;
    p.y = uResolution.y - p.y;

    float field = 0.0;
    vec3 colorSum = vec3(0.0);
    for (int i = 0; i < ${ PARTICLE_COUNT }; i++) {
      vec3 b = uBalls[i];
      float energy = uBallEnergy[i];
      float radiusBoost = 1.0 + energy * 0.35;
      vec2 d = p - b.xy;
      float contribution = exp(-dot(d, d) / (b.z * b.z * radiusBoost * radiusBoost));
      field += contribution;
      vec3 tint = mix(uBallColors[i], vec3(1.0), energy * 0.5);
      colorSum += tint * contribution;
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
  // Lets the separate reduceMotion-watching effect below reach into the
  // mount effect's own live assembly/morph tweens — mirrors the
  // uniformsHandleRef pattern established in AmbientField.jsx's own round.
  const cuboidHandleRef = useRef(null);

  useEffect(() => {
    if (!active) return undefined;

    const canvas = canvasRef.current;
    const parent = canvas.parentElement;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);

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
    // — only the lattice itself rotates, the camera stays put. Vertical FOV
    // is fixed, so a wider container only ever reveals more horizontal
    // room around the cuboid — it can't crop it, whatever the aspect ratio
    // settings-preview happens to be at.
    const worldCamera = new THREE.PerspectiveCamera(48, FALLBACK_W / FALLBACK_H, 0.1, 100);
    worldCamera.position.set(0, 0, 8.5);
    worldCamera.lookAt(0, 0, 0);
    worldCamera.updateMatrixWorld();

    // The container's real, live size — read off the canvas's own parent
    // (settings-preview) the same way HistoryAmbient.jsx already does for
    // the same reason, rather than a size this component picks itself.
    const dims = { w: FALLBACK_W, h: FALLBACK_H };
    const resize = () => {
      dims.w = parent.clientWidth || FALLBACK_W;
      dims.h = parent.clientHeight || FALLBACK_H;
      renderer.setSize(dims.w, dims.h, false);
      uniforms.uResolution.value.set(dims.w, dims.h);
      worldCamera.aspect = dims.w / dims.h;
      worldCamera.updateProjectionMatrix();
    };

    const uniforms = {
      uResolution: { value: new THREE.Vector2(FALLBACK_W, FALLBACK_H) },
      uDpr: { value: dpr },
      uBalls: { value: Array.from({ length: PARTICLE_COUNT }, () => new THREE.Vector3()) },
      // NOTE_COLORS' own hex strings, not resolveCssColor — they're already
      // plain values, not CSS custom properties, and (unlike uRim/uBg
      // below) don't change with the light/dark theme, so they're set once
      // here and never touched by the theme observer further down.
      uBallColors: { value: Array.from({ length: PARTICLE_COUNT }, () => new THREE.Color()) },
      uBallEnergy: { value: new Array(PARTICLE_COUNT).fill(0) },
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

    // Cycled by (ix+iy+iz), not banded along one axis alone — a particle's
    // color still shifts smoothly to its neighbors along any of the three
    // axes (moving one step along X, Y, or Z each changes the sum by 1, one
    // palette step), rather than the whole cuboid reading as flat colored
    // slabs stacked along a single direction.
    const palette = Object.values(NOTE_COLORS).map((hex) => new THREE.Color(hex));

    // The lattice itself: each particle's own rest point (unrotated, local
    // space), current position, and velocity.
    const half = { x: (NX - 1) / 2, y: (NY - 1) / 2, z: (NZ - 1) / 2 };
    // A Fibonacci sphere — points evenly distributed over a sphere's
    // surface via the golden-angle spiral construction — as the second
    // named shape restLocal can morph toward (see morphState.t in tick()).
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
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
          const sy = 1 - (index / (PARTICLE_COUNT - 1)) * 2; // 1..-1
          const ringRadius = Math.sqrt(Math.max(0, 1 - sy * sy));
          const theta = goldenAngle * index;
          const sphereLocal = new THREE.Vector3(
            Math.cos(theta) * ringRadius,
            sy,
            Math.sin(theta) * ringRadius,
          ).multiplyScalar(SPHERE_RADIUS);

          uniforms.uBallColors.value[index].copy(palette[(ix + iy + iz) % palette.length]);
          // Assembly intro: starts scattered outward from its own lattice
          // point rather than already resting there — skipped under
          // reduceMotion, which starts the lattice already fully formed
          // (assembly.k below is seeded at 1 in that case).
          const pos = restLocal.clone();
          if (!reduceMotionRef.current) {
            const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
            pos.addScaledVector(dir, ASSEMBLY_SCATTER);
          }
          particles.push({
            restLocal,
            sphereLocal,
            restWorld: restLocal.clone(),
            pos,
            vel: new THREE.Vector3(),
          });
        }
      }
    }

    // Assembly intro: k ramps 0->1 over ASSEMBLY_DURATION and multiplies
    // the normal (non-grabbed) spring constant in tick() below, so the
    // scattered particles above visibly gather themselves home under the
    // same integrator rather than a separate position tween. Reduced
    // motion skips the tween and starts at full strength (k=1) instead.
    const assembly = { k: reduceMotionRef.current ? 1 : 0 };
    const assemblyTween = reduceMotionRef.current
      ? null
      : gsap.to(assembly, { k: 1, duration: ASSEMBLY_DURATION, ease: "power2.out" });

    // Double-click/tap toggles between the cuboid and sphere targets —
    // blended into restWorld each frame by morphState.t (see tick()).
    const morphState = { t: 0 };
    let morphTween = null;
    let morphTarget = 0;
    const handleDoubleClick = () => {
      if (reduceMotionRef.current) return;
      morphTarget = morphState.t > 0.5 ? 0 : 1;
      morphTween?.kill();
      morphTween = gsap.to(morphState, { t: morphTarget, duration: MORPH_DURATION, ease: "power2.inOut" });
    };

    // reduceMotion is a live-toggleable prop on this same mounted instance
    // (SettingsPanel's own "Reduce motion" switch, no remount involved),
    // unlike every other reduceMotion check in this file — which only ever
    // gates something from STARTING — this needs to actively interrupt
    // whichever of the two tweens above might already be mid-flight the
    // instant it flips true, jumping straight to each one's own end state
    // rather than freezing partway (assembly.k=1 so the lattice reads as
    // fully formed, morphState.t snapped to whichever shape it was already
    // headed toward) — the same "skip the animated path, land on the
    // target" rule reduceMotion gets everywhere else in this app.
    cuboidHandleRef.current = () => {
      assemblyTween?.kill();
      assembly.k = 1;
      morphTween?.kill();
      morphTween = null;
      morphState.t = morphTarget;
    };
    canvas.addEventListener("dblclick", handleDoubleClick);

    // Pointer tracked in NDC (-1..1), the coordinate space Camera.project
    // already returns and Camera.unproject already expects — no separate
    // pixel→NDC conversion needed anywhere else below.
    const pointerNdc = { x: 2, y: 2 }; // starts well off-screen so nothing repels before a real pointer event
    // NDC units/s, refreshed once per tick() frame (see the pointerSpeed
    // block below) — read by handlePointerUp's own fling impulse so a
    // release always uses the most recently measured swipe velocity.
    const pointerVelNdc = { x: 0, y: 0 };
    const handlePointerMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    };
    // A drag that carries the cursor past the canvas's own edge (a fast
    // flick, matching handlePointerUp's own window-level listener below)
    // would otherwise go untracked here — canvas-scoped pointermove simply
    // stops firing once the cursor leaves it. Gated on an active grab so
    // the ordinary ambient cursor-repulsion case stays canvas-scoped only,
    // unchanged from before.
    const handleWindowPointerMove = (e) => {
      if (grabbed === -1) return;
      handlePointerMove(e);
    };
    // Snapping pointerNdc to the off-screen sentinel here used to also fire
    // mid-drag the instant the cursor left the canvas — corrupting both the
    // live grab target (which would freeze onto that sentinel's own world
    // position) and the release-fling velocity (a synthetic jump to the
    // sentinel reads as an enormous, bogus swipe). Skipped entirely while a
    // particle is grabbed; handleWindowPointerMove above keeps pointerNdc
    // live instead until the real pointerup actually releases it.
    const handlePointerLeave = () => {
      if (grabbed !== -1) return;
      pointerNdc.x = 2; pointerNdc.y = 2;
    };
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerleave", handlePointerLeave);
    window.addEventListener("pointermove", handleWindowPointerMove);

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
      const clickX = ((e.clientX - rect.left) / rect.width) * dims.w;
      const clickY = ((e.clientY - rect.top) / rect.height) * dims.h;

      let nearest = -1;
      let nearestDist = PICK_RADIUS;
      for (let i = 0; i < particles.length; i++) {
        const b = uniforms.uBalls.value[i];
        const d = Math.hypot(b.x - clickX, b.y - clickY);
        if (d < nearestDist) { nearestDist = d; nearest = i; }
      }
      grabbed = nearest;
    };
    const handlePointerUp = () => {
      if (grabbed !== -1 && !reduceMotionRef.current) {
        const particle = particles[grabbed];
        // Same project/unproject trick the grab spring itself already uses
        // to place the cursor in 3D at the particle's own depth — sampled
        // at two nearby NDC points (now, and one FLING_SAMPLE_DT earlier
        // per the last measured swipe velocity) to derive a real world-
        // space velocity vector, added as a one-time impulse on release.
        const depthZ = new THREE.Vector3().copy(particle.pos).project(worldCamera).z;
        const p0 = new THREE.Vector3(
          pointerNdc.x - pointerVelNdc.x * FLING_SAMPLE_DT,
          pointerNdc.y - pointerVelNdc.y * FLING_SAMPLE_DT,
          depthZ,
        ).unproject(worldCamera);
        const p1 = new THREE.Vector3(pointerNdc.x, pointerNdc.y, depthZ).unproject(worldCamera);
        particle.vel.x += ((p1.x - p0.x) / FLING_SAMPLE_DT) * FLING_STRENGTH;
        particle.vel.y += ((p1.y - p0.y) / FLING_SAMPLE_DT) * FLING_STRENGTH;
        particle.vel.z += ((p1.z - p0.z) / FLING_SAMPLE_DT) * FLING_STRENGTH;
      }
      grabbed = -1;
    };
    canvas.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointerup", handlePointerUp);

    let angle = 0;
    let lastTime = performance.now();
    let lastImpactSound = 0;
    let raf = null;

    const projected = new THREE.Vector3();
    const cursorAtDepth = new THREE.Vector3();
    const morphLocal = new THREE.Vector3();
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
      const dxNdc = pointerNdc.x - prevPointerNdc.x;
      const dyNdc = pointerNdc.y - prevPointerNdc.y;
      const pointerSpeed = Math.hypot(dxNdc, dyNdc) / dt;
      const speedBoost = Math.min(REPEL_SPEED_MAX_BOOST, pointerSpeed * REPEL_SPEED_GAIN);
      pointerVelNdc.x = dxNdc / dt;
      pointerVelNdc.y = dyNdc / dt;
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

            // Scaled by the same assembly.k ramp as the restoring spring
            // (see tick()'s own k = SPRING_K * assembly.k below) — without
            // this, particles scattered for the assembly intro can land
            // within MUTUAL_RANGE of each other by pure chance and shove
            // at full personal-space strength while the spring pulling
            // them home is still barely ramped up, an unrelated jostle
            // (and possible surprise impact-sound cue) the moment this
            // panel opens.
            const push = (MUTUAL_K * assembly.k) / (dist * dist);
            const fx = (dx / dist) * push;
            const fy = (dy / dist) * push;
            const fz = (dz / dist) * push;
            mutualForce[i].x += fx; mutualForce[i].y += fy; mutualForce[i].z += fz;
            mutualForce[j].x -= fx; mutualForce[j].y -= fy; mutualForce[j].z -= fz;

            if (dist < IMPACT_THRESHOLD && now - lastImpactSound > IMPACT_COOLDOWN_MS) {
              lastImpactSound = now;
              playImpact(1 - dist / IMPACT_THRESHOLD);
            }
          }
        }
      }

      for (let i = 0; i < particles.length; i++) {
        const particle = particles[i];
        // Blends toward the sphere target as morphState.t goes 0->1 (see
        // handleDoubleClick above) before rotating — a genuinely time-
        // varying restLocal is all the spring integrator below needs to
        // morph the whole lattice on its own, no separate tween-the-
        // position code required.
        morphLocal.lerpVectors(particle.restLocal, particle.sphereLocal, morphState.t);
        particle.restWorld.copy(morphLocal).applyMatrix4(rotationMatrix);
        const isGrabbed = i === grabbed;

        // A held particle springs toward the cursor's own 3D position (at
        // its own depth) on the stiffer GRAB_SPRING instead of toward its
        // lattice point on the normal one — everyone else keeps springing
        // home as usual, at a strength ramped by the assembly intro above
        // (1 once it's finished, so this is a no-op past the first
        // ASSEMBLY_DURATION seconds of the component's life).
        let targetX = particle.restWorld.x, targetY = particle.restWorld.y, targetZ = particle.restWorld.z;
        let k = SPRING_K * assembly.k, damping = SPRING_DAMPING;

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

        let speed = particle.vel.length();
        if (speed > VELOCITY_CLAMP) {
          particle.vel.multiplyScalar(VELOCITY_CLAMP / speed);
          speed = VELOCITY_CLAMP;
        }
        // Reuses VELOCITY_CLAMP as the normalization reference — the clamp
        // just above guarantees speed never exceeds it, so this is always
        // already in [0,1] with no separate Math.min needed.
        uniforms.uBallEnergy.value[i] = speed / VELOCITY_CLAMP;

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
        const screenScale = (dims.h / 2) / (viewDist * Math.tan((worldCamera.fov * Math.PI) / 360));

        projected.copy(p).project(worldCamera);
        const px = (projected.x * 0.5 + 0.5) * dims.w;
        const py = (1 - (projected.y * 0.5 + 0.5)) * dims.h;
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
      assemblyTween?.kill();
      morphTween?.kill();
      cuboidHandleRef.current = null;
      document.removeEventListener("visibilitychange", handleVisibility);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("dblclick", handleDoubleClick);
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      quad.geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [active]);

  // reduceMotion can flip live on an already-mounted instance (see
  // cuboidHandleRef's own comment above) — this is what actually reacts to
  // that, immediately snapping any in-flight assembly/morph tween to its
  // resting state rather than letting it keep animating to completion.
  useEffect(() => {
    if (!reduceMotion) return undefined;
    cuboidHandleRef.current?.();
    return undefined;
  }, [reduceMotion]);

  // No width/height attributes — the canvas fills its parent (position:
  // absolute; inset:0, see ParticleCuboid.css) and the ResizeObserver above
  // reads that parent's real size, the same convention HistoryAmbient.jsx
  // already uses for a canvas living inside a container it doesn't own the
  // size of.
  return (
    <canvas
      ref={ canvasRef }
      className="particle-cuboid-canvas"
      aria-hidden="true"
    />
  );
};

export default ParticleCuboid;
