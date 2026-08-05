import { useEffect, useRef } from "react";
import * as THREE from "three";

import "./AmbientField.css";

// Raw shader colors go to the canvas untouched — same reasoning as
// InkGoo.jsx's tour creature: keep THREE from converting hex inks into
// linear space on the way in.
THREE.ColorManagement.enabled = false;

const COUNT = 50;

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

  varying float vAlpha;

  void main() {
    vec2 drift = vec2(
      sin(uTime * aSeed.z + aSeed.x) * aSeed.y,
      cos(uTime * aSeed.z * 0.8 + aSeed.x * 1.3) * aSeed.y
    );
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
    repel *= 0.00035;
    // A hard cap on top of that near-field guard — belt and suspenders —
    // so no random initial scatter can ever push a mote meaningfully off
    // its own patch of the field regardless of how the 50 points happened
    // to land.
    float repelLen = length(repel);
    if (repelLen > 0.06) {
      repel = repel / repelLen * 0.06;
    }

    vec2 p = position.xy + drift + parallax + repel;
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

// A faint field of drifting dust behind the desk — barely-there specks in
// the page's own ink, so it reads as dust motes on fresh paper in light
// mode and faint stars in the Ink theme, without changing anything but
// which color they're drawn in (see the theme effect below). Same
// low-level raw-Three.js + custom ShaderMaterial style as InkGoo.jsx rather
// than a heavier scene-graph abstraction — one THREE.Points cloud, driven
// entirely by uniforms so there's no per-frame JS work beyond updating a
// clock and a smoothed pointer position.
const AmbientField = () => {
  const canvasRef = useRef(null);

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
    const uniforms = {
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(0, 0) },
      uColor: { value: new THREE.Color(ink || "#191919") },
      uOpacity: { value: 0.16 },
      uBasePositions: { value: basePositions },
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
    };
    window.addEventListener("pointermove", handlePointerMove);

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

    tick();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (colorRaf) cancelAnimationFrame(colorRaf);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", handlePointerMove);
      themeObserver.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, []);

  return <canvas ref={ canvasRef } className="ambient-field" aria-hidden="true" />;
};

export default AmbientField;
