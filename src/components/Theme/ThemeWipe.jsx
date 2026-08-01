import React, { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import gsap from "gsap";

import "./ThemeWipe.css";

const RESTING_DIAMETER = 56; // px, matches the CSS-fallback .theme-wipe

const VERTEX = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// A single organic ink-bloom: a metaball-style distance field whose edge is
// wobbled by a few stacked sine terms (the same "wobbly ring" trick
// CursorAura and InkGoo use for their own rims), so the wipe reads as ink
// spreading through paper rather than a perfect circle scaling up.
const FRAGMENT = `
precision highp float;

uniform vec2 uOrigin;   // canvas px, y-down source flipped to y-up below
uniform float uRadius;  // CSS px
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
uniform float uRatio;   // canvas px per CSS px

void main() {
  vec2 p = gl_FragCoord.xy;
  vec2 d = p - uOrigin;
  float dist = length(d) / uRatio;
  float ang = atan(d.y, d.x);

  float wobble = sin(ang * 3.0 + uTime * 1.6) * 0.035
    + sin(ang * 5.0 - uTime * 2.3) * 0.02
    + sin(ang * 7.0 + uTime * 3.1) * 0.012;
  float r = uRadius * (1.0 + wobble);

  float blur = 22.0;
  float edge = 1.0 - smoothstep(max(r - blur, 0.0), r, dist);
  float a = edge * uAlpha;

  gl_FragColor = vec4(uColor * a, a);
}
`;

const hexToUnit = (hex) => {
  const clean = hex.replace("#", "");
  const value = parseInt(clean, 16);
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ];
};

// The GPU-shaded bloom: a persistent, transparent fullscreen canvas that
// stays inert (nothing drawn) until a `wipe` comes in, then plays one
// elastic expand-and-fade driven by GSAP. Mirrors CursorAura's raw-WebGL
// compile/teardown discipline — no three.js needed for one shape.
const ThemeWipeGL = ({ wipe }) => {
  const canvasRef = useRef(null);
  const drawRef = useRef(null);
  const tweenRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
    });
    if (!gl) return;

    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };

    const vertex = compile(gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vertex || !fragment) return;

    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uniforms = {
      origin: gl.getUniformLocation(program, "uOrigin"),
      radius: gl.getUniformLocation(program, "uRadius"),
      color: gl.getUniformLocation(program, "uColor"),
      alpha: gl.getUniformLocation(program, "uAlpha"),
      time: gl.getUniformLocation(program, "uTime"),
      ratio: gl.getUniformLocation(program, "uRatio"),
    };

    let ratio = 1;
    const resize = () => {
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * ratio);
      canvas.height = Math.round(window.innerHeight * ratio);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();

    const draw = (state) => {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      if (state.alpha <= 0.001) return;

      gl.uniform2f(uniforms.origin, state.originX * ratio, canvas.height - state.originY * ratio);
      gl.uniform1f(uniforms.radius, state.radius);
      gl.uniform3f(uniforms.color, state.color[0], state.color[1], state.color[2]);
      gl.uniform1f(uniforms.alpha, state.alpha);
      gl.uniform1f(uniforms.time, performance.now() / 1000);
      gl.uniform1f(uniforms.ratio, ratio);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    drawRef.current = draw;

    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      tweenRef.current?.kill();
      drawRef.current = null;
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.deleteBuffer(buffer);
    };
  }, []);

  useEffect(() => {
    if (!wipe || !drawRef.current) return;

    const reach = Math.hypot(
      Math.max(wipe.x, window.innerWidth - wipe.x),
      Math.max(wipe.y, window.innerHeight - wipe.y)
    );
    const color = hexToUnit(wipe.color);
    const state = { progress: 0, alpha: 1 };

    tweenRef.current?.kill();
    tweenRef.current = gsap.timeline({
      onUpdate: () => drawRef.current?.({
        originX: wipe.x,
        originY: wipe.y,
        radius: state.progress * reach * 1.06,
        color,
        alpha: state.alpha,
      }),
      onComplete: () => drawRef.current?.({ originX: wipe.x, originY: wipe.y, radius: 0, color, alpha: 0 }),
    })
      .to(state, { progress: 1, duration: .85, ease: "elastic.out(0.65, 0.8)" }, 0)
      .to(state, { alpha: 0, duration: .28, ease: "power1.in" }, .64);
  }, [wipe]);

  return (
    <canvas
      ref={ canvasRef }
      className="theme-wipe-gl"
      aria-hidden="true"
    />
  );
};

// The page doesn't just crossfade between paper and ink — a drop of the new
// page color blooms from wherever the theme button was pressed and washes
// clean over the whole desk. On a capable, motion-friendly browser that
// bloom is a real organic ink shape (ThemeWipeGL, above); otherwise this
// falls back to the original scaling circle, which overshoots into a fat
// bloom before settling. Either way the CSS variables have already swapped
// underneath by the time it's covering everything, so the fade-out at the
// end is seamless — the drop is just cleaning up after itself.
const ThemeWipe = ({ wipe }) => {
  const capableRef = useRef(null);
  if (capableRef.current === null) {
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let webgl = false;
    try {
      const test = document.createElement("canvas");
      webgl = !!(test.getContext("webgl") || test.getContext("experimental-webgl"));
    } catch {
      webgl = false;
    }
    capableRef.current = webgl && !reducedMotion;
  }

  if (capableRef.current) return <ThemeWipeGL wipe={ wipe } />;

  const reach = wipe
    ? Math.hypot(
        Math.max(wipe.x, window.innerWidth - wipe.x),
        Math.max(wipe.y, window.innerHeight - wipe.y)
      )
    : 0;
  const scale = (reach * 2.2) / RESTING_DIAMETER;

  return (
    <AnimatePresence>
      {
        wipe && (
          <motion.span
            key={ wipe.key }
            aria-hidden="true"
            className="theme-wipe"
            style={{
              left: wipe.x,
              top: wipe.y,
              backgroundColor: wipe.color,
            }}
            initial={{ scale: 0, opacity: 1 }}
            animate={{ scale, opacity: [1, 1, 0] }}
            exit={{ opacity: 0 }}
            transition={{
              scale: { type: "spring", stiffness: 85, damping: 13.5, mass: 1 },
              opacity: { duration: .9, times: [0, .72, 1], ease: "easeInOut" },
            }}
          />
        )
      }
    </AnimatePresence>
  );
};

export default ThemeWipe;
