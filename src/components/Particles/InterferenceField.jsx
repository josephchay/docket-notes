import { useEffect, useRef } from "react";
import * as THREE from "three";

import { resolveCssColor } from "../History/HistoryAmbient";

import "./InterferenceField.css";

THREE.ColorManagement.enabled = false;

// Real wave interference — click to drop a stone, and the water's own
// height at any point is nothing more than the plain sum of every active
// source's own circular wave (the superposition principle, not an
// approximation of it): h(x, y, t) = Σᵢ Aᵢ(r) · sin(k·rᵢ − ω·ageᵢ) · edgeᵢ,
// rᵢ the distance to source i. Where two sources' waves arrive in phase
// the sum reinforces (constructive interference); where they arrive a
// half-wavelength apart it cancels (destructive) — the classic hyperbolic
// fringe pattern between any two sources is that difference playing out
// continuously across the whole pond, not drawn, just added up.
//
// Aᵢ(r) = AMPLITUDE / √r is a real physical falloff, not a tuned fade: a
// circular wave's own energy spreads over a circumference that grows with
// r, and intensity ~ amplitude² has to fall as 1/r to conserve that
// energy — so amplitude itself falls as 1/√r, the standard 2D result
// (contrast a 1D wave like AudioWaveString.jsx's own string, which needs
// no such term, and a 3D point source's own 1/r amplitude falloff, a
// different exponent again for a different geometry).
//
// edgeᵢ is what keeps this an honest *ripple*, not a static interference
// texture: a source born at time birthᵢ has only had time for its wave to
// reach out to radius WAVE_SPEED · (t − birthᵢ) so far, and edgeᵢ is a
// smoothstep gate that's exactly 0 beyond that real leading edge and 1
// well inside it — a newly dropped stone's ring is still visibly
// *arriving* outward across the pond, not an instantly-complete pattern
// that merely started existing.
//
// This is the one panel in the set with no per-frame loop over many
// bodies or grid cells anywhere — h itself is a closed-form sum over at
// most MAX_SOURCES terms, so the entire simulation is a single fullscreen
// shader pass evaluating that sum once per pixel, with no ping-pong render
// target (InkBloomField.jsx, LeniaField.jsx) and no CPU-side stepping
// (every particle-based demo in the set) anywhere in this file at all.
// Rendered as topographic contour lines — h thresholded against a regular
// ladder of height levels, the standard "distance to nearest integer"
// shader technique — rather than smooth shading, which is what turns the
// interference pattern into the woodgrain-like ring structure real ripple
// photography shows, instead of a blurred gradient.
const VIEW_EXTENT = 5; // half-height of the visible pond, world units
const MAX_SOURCES = 6;

const WAVE_SPEED = 2.2;
const WAVELENGTH = 0.5;
const AMPLITUDE = 0.4;
const MIN_R = 0.15; // clamps the 1/√r falloff's own singularity at a source's exact center
const EDGE_SOFTNESS = 0.4; // world units the leading edge softens across, rather than a hard cutoff
const BAND_FREQUENCY = 6; // contour levels per unit of h — tuned by hand for a pleasant ring density at this AMPLITUDE, the same "checked against this exact configuration" standard every other Particles/ demo's own tuned constants already hold to
const LINE_WIDTH = 0.08;

const DEFAULT_SOURCE_OFFSET = 1.3; // the two sources the pond opens with, placed symmetrically so the classic two-source fringe pattern is visible immediately
const REDUCED_MOTION_TIME = 4; // a fixed, already-well-developed snapshot of the wave field, not t = 0
const REDUCED_MOTION_NEW_SOURCE_AGE = 1.5; // a source placed under reduced motion is backdated this far so it shows a real partial ring immediately, rather than age = 0 (no visible disturbance yet) with no ongoing animation to grow it from there

const PASSTHROUGH_VERT = `
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`;

// h itself, then a topographic-contour read of it — see the file header
// for both. uSourceActive gates unused source slots to exactly zero
// rather than the loop bound itself varying (MAX_SOURCES is a compile-time
// constant either way, template-interpolated below so the GLSL and the
// JS-side array length can never drift apart, the same necessity
// LeniaField.jsx's own kernel-loop bound already has). The physical
// constants (wave speed, wavelength-derived k/ω, amplitude falloff,
// contour spacing) are template-interpolated the same way — GLSL literals
// rather than uniforms, since like InkBloomField.jsx's own Du/Dv they
// never change at runtime, so a uniform would only cost an upload with
// nothing to show for it.
const FRAG = `
  precision highp float;
  uniform vec2 uResolution;
  uniform float uViewExtent;
  uniform vec2 uSourcePos[${MAX_SOURCES}];
  uniform float uSourceBirth[${MAX_SOURCES}];
  uniform float uSourceActive[${MAX_SOURCES}];
  uniform float uTime;
  uniform vec3 uPaper;
  uniform vec3 uInk;

  void main() {
    vec2 uv = gl_FragCoord.xy / uResolution;
    vec2 ndc = uv * 2.0 - 1.0;
    float aspect = uResolution.x / uResolution.y;
    vec2 p = vec2(ndc.x * aspect, ndc.y) * uViewExtent;

    float h = 0.0;
    float maxEdge = 0.0;

    for (int i = 0; i < ${MAX_SOURCES}; i++) {
      float active = uSourceActive[i];
      float r = distance(p, uSourcePos[i]);
      float age = max(uTime - uSourceBirth[i], 0.0);
      float wavefront = ${WAVE_SPEED.toFixed(4)} * age;
      float edge = smoothstep(wavefront, wavefront - ${EDGE_SOFTNESS.toFixed(4)}, r) * active;
      float amp = ${AMPLITUDE.toFixed(4)} / sqrt(max(r, ${MIN_R.toFixed(4)}));
      float phase = ${((2 * Math.PI) / WAVELENGTH).toFixed(6)} * r - ${(((2 * Math.PI) / WAVELENGTH) * WAVE_SPEED).toFixed(6)} * age;
      h += amp * sin(phase) * edge;
      maxEdge = max(maxEdge, edge);
    }

    float scaled = h * ${BAND_FREQUENCY.toFixed(4)};
    float distToLine = abs(scaled - floor(scaled + 0.5));
    float line = (1.0 - smoothstep(0.0, ${LINE_WIDTH.toFixed(4)}, distToLine)) * maxEdge;

    gl_FragColor = vec4(mix(uPaper, uInk, line), 1.0);
  }
`;

// active/reduceMotion follow every other Particles/ field's own contract.
// Sources are static once placed (no dragging) — a moving source's true
// wake would need every past position it ever occupied, not just its
// current one; a stationary point source is exactly what the closed form
// above computes, no approximation involved, so that's the interaction
// this panel actually offers. resetToken bumps to clear back to an empty
// pond (the panel's own "Clear" button).
const InterferenceField = ({ active, reduceMotion = false, resetToken = 0 }) => {
  const canvasRef = useRef(null);
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  const clearFnRef = useRef(null);

  useEffect(() => {
    if (!active) return undefined;

    const canvas = canvasRef.current;
    const parent = canvas.parentElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: false });
    renderer.setPixelRatio(dpr);

    const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadGeometry = new THREE.PlaneGeometry(2, 2);

    const uniforms = {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uViewExtent: { value: VIEW_EXTENT },
      uSourcePos: { value: Array.from({ length: MAX_SOURCES }, () => new THREE.Vector2(0, 0)) },
      uSourceBirth: { value: new Array(MAX_SOURCES).fill(0) },
      uSourceActive: { value: new Array(MAX_SOURCES).fill(0) },
      uTime: { value: 0 },
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

    // Bounded pool: a 7th click recycles whichever source is oldest —
    // same "there's always somewhere for a fresh one to land, cost never
    // creeps up" reasoning GravityField.jsx's own slingshot recycling
    // already uses, applied here to clicks instead of escaped planets.
    let sources = [];
    const pushSource = (x, y, birth) => {
      if (sources.length >= MAX_SOURCES) sources.shift();
      sources.push({ x, y, birth });
    };

    const placeDefaultSources = () => {
      sources = [];
      pushSource(-DEFAULT_SOURCE_OFFSET, 0, 0);
      pushSource(DEFAULT_SOURCE_OFFSET, 0, 0.1);
    };
    placeDefaultSources();

    const clearPond = () => { sources = []; };
    clearFnRef.current = clearPond;

    const writeSourceUniforms = () => {
      for (let i = 0; i < MAX_SOURCES; i++) {
        const s = sources[i];
        uniforms.uSourceActive.value[i] = s ? 1 : 0;
        if (s) {
          uniforms.uSourcePos.value[i].set(s.x, s.y);
          uniforms.uSourceBirth.value[i] = s.birth;
        }
      }
    };

    const ndcFromEvent = (e) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: -(((e.clientY - rect.top) / rect.height) * 2 - 1),
      };
    };
    // Matches the shader's own uv -> world mapping exactly (aspect-scaled
    // x, both axes scaled by uViewExtent) rather than an unproject camera
    // — there's no Three.js camera whose own frustum this quad's world
    // space is actually defined by; the shader invents that mapping
    // itself, so the inverse has to be hand-matched to it here too.
    const worldFromEvent = (e, elapsed) => {
      const ndc = ndcFromEvent(e);
      const aspect = canvas.clientWidth / canvas.clientHeight;
      return { x: ndc.x * aspect * VIEW_EXTENT, y: ndc.y * VIEW_EXTENT, t: elapsed };
    };

    let raf = null;
    const startTime = performance.now();

    const handlePointerDown = (e) => {
      const elapsed = (performance.now() - startTime) / 1000;
      const w = worldFromEvent(e, elapsed);
      const birth = reduceMotionRef.current
        ? REDUCED_MOTION_TIME - REDUCED_MOTION_NEW_SOURCE_AGE
        : w.t;
      pushSource(w.x, w.y, birth);
      if (reduceMotionRef.current) {
        writeSourceUniforms();
        uniforms.uTime.value = REDUCED_MOTION_TIME;
        renderer.render(scene, quadCamera);
      }
    };
    canvas.addEventListener("pointerdown", handlePointerDown);

    const tick = () => {
      raf = requestAnimationFrame(tick);

      writeSourceUniforms();
      uniforms.uTime.value = reduceMotionRef.current
        ? REDUCED_MOTION_TIME
        : (performance.now() - startTime) / 1000;

      renderer.render(scene, quadCamera);
    };

    const handleVisibility = () => {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = null;
      } else if (!raf) {
        tick();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    tick();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", handleVisibility);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      clearFnRef.current = null;
      quadGeometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [active]);

  useEffect(() => {
    if (resetToken > 0) clearFnRef.current?.();
  }, [resetToken]);

  return (
    <canvas
      ref={ canvasRef }
      className="interference-field-canvas"
      aria-hidden="true"
    />
  );
};

export default InterferenceField;
