import { useEffect, useRef } from "react";
import * as THREE from "three";
import gsap from "gsap";

import { resolveCssColor } from "../History/HistoryAmbient";

THREE.ColorManagement.enabled = false;

const VIAL_W = 44;
const VIAL_H = 56;
const SURFACE_COUNT = 5;
const SURFACE_RADIUS = 9;

// A real damped 1D wave equation across the vial's width — the grid spacing
// between the metaballs above doubling as the spatial step. Speed is slow
// (a small, cohesive body of ink, not open water); the Courant number
// (WAVE_SPEED·dt/WAVE_DX) stays under 0.1 even at 60fps and under 0.25 even
// at the WAVE_DT_MAX floor, two-plus orders of magnitude under the
// stability limit of 1 an explicit central-difference stepper needs — this
// can't ring itself into numerical instability regardless of frame timing.
const WAVE_DX = VIAL_W / (SURFACE_COUNT - 1);
const WAVE_SPEED = 50;     // px/s
const WAVE_DAMPING = 2.5;  // 1/s — settles within roughly a second
const WAVE_DT_MAX = 0.05;  // clamps the physics step so a stalled/backgrounded frame can't feed the stepper a huge dt

const VERT = `
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`;

// A handful of small metaballs riding the fill's own baseline (rather than
// a plain sine curve) for a genuinely blobby, merging liquid meniscus —
// adapting InkGoo.jsx's established gaussian-metaball technique (same
// falloff/threshold/rim shape) rather than a new one just for this. Below
// the baseline is a plain hard-edged mask, not more metaballs — union-ing
// a solid fill with the wave field is far more reliable than trying to
// tune a "flood" metaball's implicit threshold to always reach the bottom
// regardless of the current level, and the wave balls already sit right on
// that same edge, so the two blend seamlessly.
const FRAG = `
  precision highp float;

  uniform vec2 uResolution;
  uniform float uDpr;
  uniform vec3 uBalls[${ SURFACE_COUNT }];
  uniform float uBaseY;
  uniform vec3 uInk;
  uniform vec3 uRim;

  void main() {
    vec2 p = gl_FragCoord.xy / uDpr;
    p.y = uResolution.y - p.y;

    float field = 0.0;
    for (int i = 0; i < ${ SURFACE_COUNT }; i++) {
      vec3 b = uBalls[i];
      vec2 d = p - b.xy;
      field += exp(-dot(d, d) / (b.z * b.z));
    }

    float waveBody = smoothstep(0.5, 0.56, field);
    float solidMask = smoothstep(uBaseY - 1.0, uBaseY + 1.0, p.y);
    float body = max(waveBody, solidMask);

    float rim = smoothstep(0.5, 0.6, field) * (1.0 - smoothstep(0.6, 1.05, field));
    vec3 col = mix(uInk, uRim, rim * 0.5);

    if (body < 0.01) discard;
    gl_FragColor = vec4(col, body);
  }
`;

// A little ink vial rather than a flat progress bar — same fixed 44×56
// footprint and eased-baseline behavior the SVG version already had, now a
// real metaball field instead of two overlapping sine waves. Clipped to
// the vial's rounded-rect shape via the frame div's own CSS
// (border-radius + overflow: hidden), the same way HistoryAmbient.jsx's
// canvas is clipped by its parent rather than a shader-side mask.
const LiquidMeter = ({ ratio = 0, color = "var(--page-ink-color)", label, reduceMotion = false, celebration = null }) => {
  const canvasRef = useRef(null);
  const currentRef = useRef(0);
  const targetRef = useRef(ratio);
  const uniformsRef = useRef(null);
  const pulseRef = useRef({ value: 1 });
  const pulseTlRef = useRef(null);
  // The wave field's own state — three buffers rotated each step (current,
  // previous, and a scratch slot for the next one) rather than allocated
  // fresh every frame. waveImpulseRef is how the ratio/celebration effect
  // below hands a milestone crossing to the physics step in the render
  // effect — set there, consumed and zeroed the next time tick() runs.
  const waveCurrRef = useRef(null);
  const wavePrevRef = useRef(null);
  const waveNextRef = useRef(null);
  const waveImpulseRef = useRef(0);
  const waveLastRef = useRef(0);
  const prevRatioRef = useRef(ratio);
  const prevCelebrationKeyRef = useRef(celebration?.key ?? null);
  const colorRef = useRef(color);
  colorRef.current = color;
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

  useEffect(() => {
    targetRef.current = Math.max(0, Math.min(1, ratio));

    // Two ways to notice the same crossing, kept together rather than
    // picking one: the ratio heuristic below already covers a vial that was
    // open through the exact render a milestone landed on (Header.jsx's own
    // milestoneRatio sits at essentially 1 right before a crossing, then
    // drops sharply once the next note pours in); `celebration` is the
    // same crossing Home.jsx's own InkCelebration pill fires from, so a
    // vial that's open right when the desk actually crosses a milestone
    // pulses on the identical instant the pill blooms, rather than a
    // separately-inferred one. Neither alone covers every case: the ratio
    // heuristic still needs to stay for a vial that only gets opened later,
    // well after the crossing (celebration's own key will already have
    // moved past by then).
    const prev = prevRatioRef.current;
    const ratioCrossed = prev >= .96 && ratio < prev - .3;
    const celebrationFired = !!celebration && celebration.key !== prevCelebrationKeyRef.current;

    if (ratioCrossed || celebrationFired) {
      pulseTlRef.current?.kill();
      pulseTlRef.current = gsap.timeline()
        .to(pulseRef.current, { value: 1.4, duration: .14, ease: "power2.in" })
        .to(pulseRef.current, { value: 1, duration: .9, ease: "elastic.out(1.1, .42)" });

      // A real impulse into the wave field (see WAVE_* above and the physics
      // step in the render effect below) on top of the radius pulse — the
      // surface actually gets struck and ripples outward/reflects off the
      // vial walls, rather than every metaball just swelling in place.
      waveImpulseRef.current = 5;
    }
    prevRatioRef.current = ratio;
    prevCelebrationKeyRef.current = celebration?.key ?? prevCelebrationKeyRef.current;
  }, [ratio, celebration]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(0x000000, 0);
    renderer.setSize(VIAL_W, VIAL_H, false);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const uniforms = {
      uResolution: { value: new THREE.Vector2(VIAL_W, VIAL_H) },
      uDpr: { value: dpr },
      uBalls: { value: Array.from({ length: SURFACE_COUNT }, () => new THREE.Vector3()) },
      uBaseY: { value: VIAL_H },
      uInk: { value: new THREE.Color(resolveCssColor(colorRef.current)) },
      uRim: { value: new THREE.Color(resolveCssColor("var(--page-bg-color)")) },
    };
    uniformsRef.current = uniforms;

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(quad);

    waveCurrRef.current = new Float32Array(SURFACE_COUNT);
    wavePrevRef.current = new Float32Array(SURFACE_COUNT);
    waveNextRef.current = new Float32Array(SURFACE_COUNT);
    waveLastRef.current = performance.now();

    const clock = new THREE.Clock();
    let raf = null;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t = clock.getElapsedTime();

      currentRef.current += (targetRef.current - currentRef.current) * .05;
      const baseY = VIAL_H - 4 - currentRef.current * (VIAL_H - 10);
      uniforms.uBaseY.value = baseY;

      // The wave field's own physics step — a milestone impulse (if one
      // landed since the last frame) struck in first, then one explicit
      // central-difference step of the damped wave equation
      // (∂²u/∂t² = c²∂²u/∂x² − γ∂u/∂t) propagates and damps it. Reflecting
      // (Neumann) walls at both ends, since a real liquid surface doesn't
      // just vanish at the glass — it bounces.
      const waveNow = performance.now();
      const waveDt = Math.min(WAVE_DT_MAX, (waveNow - waveLastRef.current) / 1000);
      waveLastRef.current = waveNow;

      const curr = waveCurrRef.current;
      const prev = wavePrevRef.current;

      if (waveImpulseRef.current !== 0) {
        const mid = (SURFACE_COUNT - 1) / 2;
        for (let i = 0; i < SURFACE_COUNT; i++) {
          const offset = i - mid;
          curr[i] += waveImpulseRef.current * Math.exp(-(offset * offset) / 2);
        }
        waveImpulseRef.current = 0;
      }

      if (waveDt > 0) {
        const r2 = ((WAVE_SPEED * waveDt) / WAVE_DX) ** 2;
        const dampTerm = WAVE_DAMPING * waveDt;
        const next = waveNextRef.current;

        for (let i = 0; i < SURFACE_COUNT; i++) {
          const left = i === 0 ? curr[1] : curr[i - 1];
          const right = i === SURFACE_COUNT - 1 ? curr[SURFACE_COUNT - 2] : curr[i + 1];
          const laplacian = left - 2 * curr[i] + right;
          next[i] = (2 - dampTerm) * curr[i] - (1 - dampTerm) * prev[i] + r2 * laplacian;
        }

        // Rotate the three buffers rather than allocating fresh arrays every
        // frame — the buffer that was `prev` is stale now and becomes next
        // frame's scratch space.
        waveCurrRef.current = next;
        wavePrevRef.current = curr;
        waveNextRef.current = prev;
      }

      const pulse = pulseRef.current.value;
      const heights = waveCurrRef.current;
      for (let i = 0; i < SURFACE_COUNT; i++) {
        const x = (i / (SURFACE_COUNT - 1)) * VIAL_W;
        // A small ambient wobble layered on top at render time only (never
        // fed back into the physics buffers above) so the surface still
        // reads as gently alive between milestones, the same continuous
        // idle character this always had — the real wave-equation motion
        // now carries the milestone impulses instead.
        const ambient = reduceMotionRef.current ? 0 : Math.sin(t * (1.1 + i * .23) + i * 1.7) * 0.9;
        const y = baseY + heights[i] + ambient;
        uniforms.uBalls.value[i].set(x, y, SURFACE_RADIUS * pulse);
      }

      renderer.render(scene, camera);
    };

    const handleVisibility = () => {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = null;
      } else if (!raf) {
        clock.getDelta(); // drop the paused-time gap rather than jumping the drift on return
        waveLastRef.current = performance.now(); // same reasoning, for the wave stepper's own clock
        tick();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    tick();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", handleVisibility);
      pulseTlRef.current?.kill();
      quad.geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-tints on the previewed color changing and on a theme flip alone —
  // --page-ink-color/--page-bg-color both actually vary between light and
  // dark (see colors.css), and this component's own mount lifetime (tied
  // to Header's popover) is short but not guaranteed to never span a
  // theme toggle.
  useEffect(() => {
    const retint = () => {
      const uniforms = uniformsRef.current;
      if (!uniforms) return;
      uniforms.uInk.value.set(resolveCssColor(colorRef.current));
      uniforms.uRim.value.set(resolveCssColor("var(--page-bg-color)"));
    };

    retint();

    const observer = new MutationObserver(retint);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [color]);

  return (
    <div className="liquid-meter">
      <div className="liquid-meter-frame">
        <canvas ref={ canvasRef } className="liquid-meter-canvas" aria-hidden="true" />
      </div>
      {
        label && <span className="liquid-meter-label">{ label }</span>
      }
    </div>
  );
};

export default LiquidMeter;
