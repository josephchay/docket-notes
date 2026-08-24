import { useEffect, useRef } from "react";
import * as THREE from "three";

import "./AmbientField.css";

// Raw shader colors go to the canvas untouched — same reasoning as
// InkGoo.jsx's tour creature: keep THREE from converting hex inks into
// linear space on the way in.
THREE.ColorManagement.enabled = false;

const COUNT = 50;

// Whole-number JS floats stringify without a decimal point (`(1.0).toString()
// === "1"`), which template-interpolates into GLSL ES 1.00 as an untyped
// `int` literal — illegal against a `float` operand in relational/arithmetic
// ops (no implicit int->float conversion) and fails the WHOLE shader
// program's compile, not just the feature using it. Use this for any JS
// constant spliced into a float-typed GLSL expression.
const glslFloat = (n) => (Number.isInteger(n) ? `${ n }.0` : `${ n }`);

// How many recent clicks/taps can be scattering the field at once — extra
// clicks beyond this overwrite the oldest active slot (see nextPulseSlot).
const PULSE_COUNT = 4;
const PULSE_LIFE_S = 1.0; // must match the `age < 1.0` cutoff in VERT below
const PULSE_STRENGTH = 0.045;

// How much drift/repel amplitude idle damps away at uIdle=1 (0..1) — never
// fully to zero, so the field still reads as faintly alive at rest.
const IDLE_DRIFT_DAMP = 0.7;
const IDLE_DELAY_MS = 6000;
const IDLE_TWEEN_MS = 1400;

const BASE_OPACITY = 0.16;
const DIMMED_OPACITY = 0.05;
const ENTRANCE_FADE_MS = 1600;
const DIM_TWEEN_MS = 500;

const VERT = `
  attribute vec3 aSeed;   // x: phase, y: drift radius (NDC units), z: speed
  attribute float aSize;  // point size, px

  uniform float uTime;
  uniform vec2 uMouse;    // -1..1, smoothed toward the live pointer
  // Every mote's own rest position, so each one can feel every other one —
  // set once at init and never touched again (see the JS side); the field
  // doesn't need these to move to stay alive, only to know where they
  // started, the same way LiquidMeter.jsx's own uBalls[] loop already reads
  // a fixed-size uniform array by index rather than a texture or SSBO.
  uniform vec2 uBasePositions[${ COUNT }];
  // xy = NDC click position, z = the uTime it landed at; z < 0.0 means the
  // slot is unused (see PULSE_COUNT/handlePointerDown in the component).
  uniform vec3 uPulses[${ PULSE_COUNT }];
  // 0..1, tweened toward 1 after a stretch of no input (see armIdleTimer
  // below) — damps drift/repel so the field visibly calms rather than
  // drifting at full amplitude forever regardless of whether anyone's here.
  uniform float uIdle;

  varying float vAlpha;

  void main() {
    float motion = 1.0 - uIdle * ${ glslFloat(IDLE_DRIFT_DAMP) };
    vec2 drift = vec2(
      sin(uTime * aSeed.z + aSeed.x) * aSeed.y,
      cos(uTime * aSeed.z * 0.8 + aSeed.x * 1.3) * aSeed.y
    ) * motion;
    // Larger (nearer-reading) dots parallax toward the pointer a little
    // more than small ones — a cheap sense of depth without a real z-axis.
    vec2 parallax = uMouse * 0.05 * (aSize / 7.0);

    // A real mutual repulsion between every pair of motes — 1/r in 2D
    // (not 1/r²; that's the 3D inverse-square law, the correct 2D analogue
    // for a field confined to a plane is one power lower), the same
    // "charged particles" math a force-directed graph layout settles with.
    // Computed off each mote's static rest position rather than its
    // current drifting one, so this is a constant per-pair bias baked once
    // rather than a converging n-body simulation that would need a real
    // integration step (position += velocity * dt, accumulated frame over
    // frame) to settle — cheaper, and this field is meant to stay alive
    // and unsettled anyway, not relax into a fixed arrangement.
    vec2 repel = vec2(0.0);
    for (int j = 0; j < ${ COUNT }; j++) {
      vec2 d = position.xy - uBasePositions[j];
      float dist2 = dot(d, d);
      // Guards both the true self-term (d = 0 exactly) and any two motes
      // that happened to land unusually close together at init — without
      // this, 1/dist2 blows up as dist approaches 0.
      if (dist2 > 0.0002) {
        repel += d / dist2;
      }
    }
    repel *= 0.00035 * motion;
    // A hard cap on top of that near-field guard — belt and suspenders —
    // so no random initial scatter can ever push a mote meaningfully off
    // its own patch of the field regardless of how the 50 points happened
    // to land.
    float repelLen = length(repel);
    if (repelLen > 0.06) {
      repel = repel / repelLen * 0.06;
    }

    // Click/tap scatter: reuses the exact same 1/r 2D falloff and
    // near-field guard as the mutual repel term above, just keyed off
    // recent pulse origins instead of every other mote's rest position,
    // and fading out linearly over PULSE_LIFE_S instead of staying
    // permanent. Inactive slots (uPulses[k].z < 0.0) contribute nothing.
    vec2 pulseForce = vec2(0.0);
    for (int k = 0; k < ${ PULSE_COUNT }; k++) {
      float age = uTime - uPulses[k].z;
      if (uPulses[k].z >= 0.0 && age >= 0.0 && age < ${ glslFloat(PULSE_LIFE_S) }) {
        vec2 d = position.xy - uPulses[k].xy;
        float dist2 = dot(d, d);
        if (dist2 > 0.0002) {
          float fade = 1.0 - age / ${ glslFloat(PULSE_LIFE_S) };
          pulseForce += normalize(d) * fade * ${ glslFloat(PULSE_STRENGTH) };
        }
      }
    }

    vec2 p = position.xy + drift + parallax + repel + pulseForce;
    gl_Position = vec4(p, 0.0, 1.0);
    gl_PointSize = aSize;
    vAlpha = 0.45 + 0.55 * sin(uTime * aSeed.z * 1.7 + aSeed.x * 2.0);
  }
`;

// A soft round falloff per point (gl_PointCoord is the point's own local
// 0..1 quad) so it reads as a dust mote / faint star rather than a hard
// square sprite.
const FRAG = `
  precision mediump float;

  uniform vec3 uColor;
  uniform float uOpacity;

  varying float vAlpha;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    float a = smoothstep(0.5, 0.0, d) * vAlpha * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

// A cancelable, one-shot rAF-driven linear tween — shared shape for the
// idle settle and the opacity fade-in/dim transitions below (the
// pre-existing theme re-tint above needs its own RGB-triple version and is
// left untouched). Each call site only supplies what actually differs: the
// current/target values and a per-frame setter.
const makeTweener = () => {
  let raf = null;
  const cancel = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  };
  const to = (from, target, duration, setValue) => {
    cancel();
    const startTime = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - startTime) / duration);
      setValue(from + (target - from) * t);
      raf = t < 1 ? requestAnimationFrame(step) : null;
    };
    raf = requestAnimationFrame(step);
  };
  return { to, cancel };
};

// A faint field of drifting dust behind the desk — barely-there specks in
// the page's own ink, so it reads as dust motes on fresh paper in light
// mode and faint stars in the Ink theme, without changing anything but
// which color they're drawn in (see the theme effect below). Same
// low-level raw-Three.js + custom ShaderMaterial style as InkGoo.jsx rather
// than a heavier scene-graph abstraction — one THREE.Points cloud, driven
// entirely by uniforms so there's no per-frame JS work beyond updating a
// clock and a smoothed pointer position.
const AmbientField = ({ reduceMotion = false, dimmed = false }) => {
  const canvasRef = useRef(null);
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  const dimmedRef = useRef(dimmed);
  dimmedRef.current = dimmed;
  // Lets the separate `dimmed`-watching effect below reach the live
  // uniforms/opacity tweener/idle-canceler the mount effect owns, mirroring
  // the uniformsHandleRef pattern InkBloomField.jsx's own round established.
  const uniformsHandleRef = useRef(null);
  // The opacity target the entrance fade or the last dimmed-effect run is
  // already heading toward — lets the dimmed effect no-op when it's already
  // correct (including right after mount, if `dimmed` started true) instead
  // of relying on a "skip the first run" guard, which a real remount (React
  // StrictMode's mount->cleanup->mount replay) would desync from whatever
  // the mount effect's own most recent run actually set up.
  const lastOpacityTargetRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const positions = new Float32Array(COUNT * 3);
    const seeds = new Float32Array(COUNT * 3);
    const sizes = new Float32Array(COUNT);
    // The same rest positions above, handed to the shader a second way — a
    // plain array of Vector2 rather than a BufferAttribute, since this one
    // feeds a `uniform vec2[COUNT]` (every mote reads all of them, every
    // frame) rather than a per-vertex attribute (each mote reads only its
    // own). Built in the same loop so the two can never drift apart.
    const basePositions = Array.from({ length: COUNT }, () => new THREE.Vector2());

    for (let i = 0; i < COUNT; i++) {
      const x = (Math.random() * 2 - 1) * 1.05;
      const y = (Math.random() * 2 - 1) * 1.05;

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = 0;
      basePositions[i].set(x, y);

      seeds[i * 3] = Math.random() * Math.PI * 2;      // phase
      seeds[i * 3 + 1] = 0.015 + Math.random() * 0.05;  // drift radius
      seeds[i * 3 + 2] = 0.15 + Math.random() * 0.35;   // speed

      sizes[i] = (2 + Math.random() * 5) * dpr;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));

    const ink = getComputedStyle(document.documentElement).getPropertyValue("--page-ink-color").trim() || "#191919";
    // Read once at mount (this effect only ever runs with `[]` deps) — if
    // `dimmed` is already true on the very first render, the entrance fade
    // below targets DIMMED_OPACITY directly instead of always fading up to
    // BASE_OPACITY and only correcting itself whenever `dimmed` next flips.
    const initialOpacityTarget = dimmed ? DIMMED_OPACITY : BASE_OPACITY;
    const uniforms = {
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(0, 0) },
      uColor: { value: new THREE.Color(ink || "#191919") },
      // Starts at 0 (not the real target) so the entrance-fade tween below
      // can own the ramp-up — reduceMotion skips straight to the target.
      uOpacity: { value: 0 },
      uBasePositions: { value: basePositions },
      uPulses: { value: Array.from({ length: PULSE_COUNT }, () => new THREE.Vector3(0, 0, -1)) },
      uIdle: { value: 0 },
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

    const resize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight, false);
    };
    resize();
    window.addEventListener("resize", resize);

    // A smoothed pointer position — lerped toward the live target each
    // frame rather than snapped straight to it, so the field's parallax
    // trails the cursor a beat instead of jittering with every mouse event.
    const mouseTarget = { x: 0, y: 0 };
    const handlePointerMove = (e) => {
      mouseTarget.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseTarget.y = -((e.clientY / window.innerHeight) * 2 - 1);
      armIdleTimer();
    };
    window.addEventListener("pointermove", handlePointerMove);

    // Click/tap scatter: overwrites the oldest of PULSE_COUNT slots with
    // this click's NDC position and current clock time — VERT reads uTime
    // each frame to compute each slot's own age/fade, so no further JS
    // work is needed per click beyond this one uniform write.
    let nextPulseSlot = 0;
    const handlePointerDown = (e) => {
      armIdleTimer();
      if (reduceMotionRef.current) return;
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = -((e.clientY / window.innerHeight) * 2 - 1);
      const slot = nextPulseSlot % PULSE_COUNT;
      nextPulseSlot += 1;
      uniforms.uPulses.value[slot].set(nx, ny, uniforms.uTime.value);
    };
    window.addEventListener("pointerdown", handlePointerDown);

    // Idle settle/wake: after IDLE_DELAY_MS of no pointer input, tween
    // uIdle up so drift/repel visibly calm down (see `motion` in VERT);
    // any fresh input tweens it back down and restarts the wait. Its own
    // tweener/timeout, independent of the opacity one below.
    const idleTweener = makeTweener();
    let idleTimeout = null;
    const armIdleTimer = () => {
      if (reduceMotionRef.current) return;
      if (idleTimeout) clearTimeout(idleTimeout);
      if (uniforms.uIdle.value > 0) {
        idleTweener.to(uniforms.uIdle.value, 0, IDLE_TWEEN_MS, (v) => { uniforms.uIdle.value = v; });
      }
      idleTimeout = setTimeout(() => {
        // Re-checked here (not just on arm/re-arm) since reduceMotion can
        // flip true during the wait with no further pointer event to
        // re-run armIdleTimer's own guard above.
        if (reduceMotionRef.current) return;
        idleTweener.to(uniforms.uIdle.value, 1, IDLE_TWEEN_MS, (v) => { uniforms.uIdle.value = v; });
      }, IDLE_DELAY_MS);
    };
    armIdleTimer();

    // Re-tints between the light and dark theme's own ink color whenever
    // .home's data-theme attribute flips — mirrors InkGoo.jsx's own
    // per-theme re-tint, just watched here instead of taken as a prop.
    // Its own rAF chain, separate from tick()'s — tracked in colorRaf so
    // an unmount mid-transition (a theme flip right as the panel closes,
    // say) can actually cancel it instead of leaving it scheduling frames
    // against a disposed material/renderer, the same bug main tick()'s
    // own `raf` variable already exists to avoid.
    let colorRaf = null;
    const themeObserver = new MutationObserver(() => {
      const nextInk = getComputedStyle(document.documentElement).getPropertyValue("--page-ink-color").trim();
      if (!nextInk) return;
      const target = new THREE.Color(nextInk);
      const start = { r: uniforms.uColor.value.r, g: uniforms.uColor.value.g, b: uniforms.uColor.value.b };
      const duration = 500;
      const startTime = performance.now();

      if (colorRaf) cancelAnimationFrame(colorRaf);

      const step = (now) => {
        const t = Math.min(1, (now - startTime) / duration);
        uniforms.uColor.value.setRGB(
          start.r + (target.r - start.r) * t,
          start.g + (target.g - start.g) * t,
          start.b + (target.b - start.b) * t,
        );
        colorRaf = t < 1 ? requestAnimationFrame(step) : null;
      };
      colorRaf = requestAnimationFrame(step);
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const clock = new THREE.Clock();
    let raf = null;

    const tick = () => {
      raf = requestAnimationFrame(tick);

      uniforms.uTime.value = clock.getElapsedTime();
      uniforms.uMouse.value.x += (mouseTarget.x - uniforms.uMouse.value.x) * 0.04;
      uniforms.uMouse.value.y += (mouseTarget.y - uniforms.uMouse.value.y) * 0.04;

      renderer.render(scene, camera);
    };

    const handleVisibility = () => {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = null;
      } else if (!raf) {
        clock.getDelta(); // drop the paused-time gap rather than jumping the drift on return
        tick();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    // Settle-in entrance fade: uOpacity started at 0 above, so the field
    // fades up to initialOpacityTarget rather than popping in at full
    // density on first paint (reduceMotion skips the animated path and
    // jumps straight there). Shares opacityTweener with the dimmed-panel
    // effect below so the two can never both drive uOpacity at once — see
    // lastOpacityTargetRef for how they hand off cleanly instead of racing.
    const opacityTweener = makeTweener();
    lastOpacityTargetRef.current = initialOpacityTarget;
    if (reduceMotionRef.current) {
      uniforms.uOpacity.value = initialOpacityTarget;
    } else {
      opacityTweener.to(0, initialOpacityTarget, ENTRANCE_FADE_MS, (v) => { uniforms.uOpacity.value = v; });
    }

    // Snaps every new-feature-added animated state straight to its
    // reduceMotion-appropriate resting value — called from the effect
    // below whenever the `reduceMotion` prop flips true, so a tween that
    // was already in flight (or a timer already armed) before the flip
    // can't keep animating after it.
    const snapForReducedMotion = () => {
      if (idleTimeout) clearTimeout(idleTimeout);
      idleTimeout = null;
      idleTweener.cancel();
      uniforms.uIdle.value = 0;
      opacityTweener.cancel();
      uniforms.uOpacity.value = dimmedRef.current ? DIMMED_OPACITY : BASE_OPACITY;
    };
    uniformsHandleRef.current = { uniforms, opacityTweener, snapForReducedMotion };

    tick();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (colorRaf) cancelAnimationFrame(colorRaf);
      if (idleTimeout) clearTimeout(idleTimeout);
      idleTweener.cancel();
      opacityTweener.cancel();
      uniformsHandleRef.current = null;
      lastOpacityTargetRef.current = null;
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerdown", handlePointerDown);
      themeObserver.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, []);

  // Panel-aware dimming: reuses the exact same "the page recedes" signal
  // Home.jsx already computes for its own `.home` receded/focus classes
  // (see the `dimmed` prop) rather than inventing a new one, so the dust
  // visibly recedes behind a foreground panel/editor instead of competing
  // with it at constant brightness. No-ops when the target already matches
  // lastOpacityTargetRef — correctly covers both "dimmed hasn't actually
  // changed since the entrance fade already aimed here" (including right
  // after mount) and a StrictMode replay, without needing a separate
  // "skip the first run" flag that could desync from a real remount.
  useEffect(() => {
    const handle = uniformsHandleRef.current;
    if (!handle) return undefined;
    const target = dimmed ? DIMMED_OPACITY : BASE_OPACITY;
    if (lastOpacityTargetRef.current === target) return undefined;
    lastOpacityTargetRef.current = target;
    const { uniforms, opacityTweener } = handle;
    if (reduceMotionRef.current) {
      opacityTweener.cancel();
      uniforms.uOpacity.value = target;
    } else {
      opacityTweener.to(uniforms.uOpacity.value, target, DIM_TWEEN_MS, (v) => { uniforms.uOpacity.value = v; });
    }
    return undefined;
  }, [dimmed]);

  // Immediately snaps idle/opacity state to their resting values the
  // instant reduceMotion flips true, so a tween or idle timer already in
  // flight from before the flip can't keep animating after it.
  useEffect(() => {
    if (!reduceMotion) return undefined;
    uniformsHandleRef.current?.snapForReducedMotion?.();
    return undefined;
  }, [reduceMotion]);

  return <canvas ref={ canvasRef } className="ambient-field" aria-hidden="true" />;
};

export default AmbientField;
