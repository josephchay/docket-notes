import { useEffect, useRef } from "react";
import * as THREE from "three";

// Same reasoning as AmbientField.jsx: keep THREE from converting hex inks
// into linear space on the way in.
THREE.ColorManagement.enabled = false;

const COUNT = 20;

const VERT = `
  attribute vec3 aSeed;   // x: phase, y: drift radius (NDC units), z: speed
  attribute float aSize;  // point size, px

  uniform float uTime;

  varying float vAlpha;

  void main() {
    vec2 drift = vec2(
      sin(uTime * aSeed.z + aSeed.x) * aSeed.y,
      cos(uTime * aSeed.z * 0.8 + aSeed.x * 1.3) * aSeed.y
    );

    vec2 p = position.xy + drift;
    gl_Position = vec4(p, 0.0, 1.0);
    gl_PointSize = aSize;
    vAlpha = 0.45 + 0.55 * sin(uTime * aSeed.z * 1.7 + aSeed.x * 2.0);
  }
`;

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

// Resolves a CSS color value down to something THREE.Color can parse — the
// action-color styles in HistoryPanel.jsx hand this a raw `var(--x-color)`
// reference (see ACTION_STYLES), which THREE has no idea what to do with on
// its own.
const resolveCssColor = (value) => {
  if (!value) return "#191919";

  const match = /var\((--[\w-]+)\)/.exec(value);
  if (!match) return value;

  const resolved = getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim();
  return resolved || "#191919";
};

// A faint drifting-dust wash behind the right pane's preview, re-tinted to
// whichever action's color is currently previewed — the same raw-Three.js
// Points-cloud technique AmbientField.jsx already uses for the page's own
// background, just scoped to this one pane (sized off its own parent via
// ResizeObserver rather than the window) and driven by a `color` prop
// instead of the light/dark theme.
const HistoryAmbient = ({ color }) => {
  const canvasRef = useRef(null);
  const uniformsRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas.parentElement;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const positions = new Float32Array(COUNT * 3);
    const seeds = new Float32Array(COUNT * 3);
    const sizes = new Float32Array(COUNT);

    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = (Math.random() * 2 - 1) * 1.05;
      positions[i * 3 + 1] = (Math.random() * 2 - 1) * 1.05;
      positions[i * 3 + 2] = 0;

      seeds[i * 3] = Math.random() * Math.PI * 2;
      seeds[i * 3 + 1] = 0.02 + Math.random() * 0.06;
      seeds[i * 3 + 2] = 0.15 + Math.random() * 0.35;

      sizes[i] = (3 + Math.random() * 7) * dpr;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));

    const uniforms = {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(resolveCssColor(color)) },
      uOpacity: { value: 0.3 },
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

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    const resize = () => {
      const width = parent.clientWidth || 1;
      const height = parent.clientHeight || 1;
      renderer.setSize(width, height, false);
    };
    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(parent);

    const clock = new THREE.Clock();
    let raf = null;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      uniforms.uTime.value = clock.getElapsedTime();
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

    tick();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", handleVisibility);
      resizeObserver.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-tints smoothly toward whatever action is currently previewed rather
  // than snapping — the same manual RAF-lerp AmbientField.jsx's own
  // light/dark theme-flip observer already does.
  useEffect(() => {
    const uniforms = uniformsRef.current;
    if (!uniforms) return;

    const target = new THREE.Color(resolveCssColor(color));
    const start = {
      r: uniforms.uColor.value.r,
      g: uniforms.uColor.value.g,
      b: uniforms.uColor.value.b,
    };
    const duration = 500;
    const startTime = performance.now();
    let raf = null;

    const step = (now) => {
      const t = Math.min(1, (now - startTime) / duration);
      uniforms.uColor.value.setRGB(
        start.r + (target.r - start.r) * t,
        start.g + (target.g - start.g) * t,
        start.b + (target.b - start.b) * t,
      );
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [color]);

  return <canvas ref={ canvasRef } className="history-ambient" aria-hidden="true" />;
};

export default HistoryAmbient;
