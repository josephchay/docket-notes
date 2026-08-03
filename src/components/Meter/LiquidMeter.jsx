import { useEffect, useRef } from "react";
import * as THREE from "three";
import gsap from "gsap";

import { resolveCssColor } from "../History/HistoryAmbient";

THREE.ColorManagement.enabled = false;

const VIAL_W = 44;
const VIAL_H = 56;
const SURFACE_COUNT = 5;
const SURFACE_RADIUS = 9;

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
const LiquidMeter = ({ ratio = 0, color = "var(--page-ink-color)", label, reduceMotion = false }) => {
  const canvasRef = useRef(null);
  const currentRef = useRef(0);
  const targetRef = useRef(ratio);
  const uniformsRef = useRef(null);
  const pulseRef = useRef({ value: 1 });
  const pulseTlRef = useRef(null);
  const prevRatioRef = useRef(ratio);
  const colorRef = useRef(color);
  colorRef.current = color;
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

  useEffect(() => {
    targetRef.current = Math.max(0, Math.min(1, ratio));

    // Milestone crossing detector — Header.jsx's own milestoneRatio sits at
    // essentially 1 for the render right before a crossing, then drops
    // sharply the next note pours in (the anchor points shift to the next
    // milestone pair). No prop needed for this; it falls straight out of
    // watching the ratio Header already hands down.
    const prev = prevRatioRef.current;
    if (prev >= .96 && ratio < prev - .3) {
      pulseTlRef.current?.kill();
      pulseTlRef.current = gsap.timeline()
        .to(pulseRef.current, { value: 1.4, duration: .14, ease: "power2.in" })
        .to(pulseRef.current, { value: 1, duration: .9, ease: "elastic.out(1.1, .42)" });
    }
    prevRatioRef.current = ratio;
  }, [ratio]);

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

    const clock = new THREE.Clock();
    let raf = null;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t = clock.getElapsedTime();

      currentRef.current += (targetRef.current - currentRef.current) * .05;
      const baseY = VIAL_H - 4 - currentRef.current * (VIAL_H - 10);
      uniforms.uBaseY.value = baseY;

      const pulse = pulseRef.current.value;
      for (let i = 0; i < SURFACE_COUNT; i++) {
        const x = (i / (SURFACE_COUNT - 1)) * VIAL_W;
        // The idle wobble is purely decorative continuous motion, unlike
        // the fill level itself (which tracks a real value) or the
        // milestone pulse (a bounded, occasional flourish) — the only
        // piece reduced motion actually needs to stop here.
        const y = reduceMotionRef.current ? baseY : baseY + Math.sin(t * (1.1 + i * .23) + i * 1.7) * 2.4;
        uniforms.uBalls.value[i].set(x, y, SURFACE_RADIUS * pulse);
      }

      renderer.render(scene, camera);
    };

    const handleVisibility = () => {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = null;
      } else if (!raf) {
        clock.getDelta();
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
