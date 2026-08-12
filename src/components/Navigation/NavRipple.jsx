import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import gsap from "gsap";

// A tiny raw-WebGL ripple, live inside the activator button itself — the
// same compile/teardown discipline ThemeWipe.jsx's own ThemeWipeGL
// already uses (raw WebGL rather than three.js, since this is one shape
// on one small canvas), scaled down to button size. Unlike ThemeWipeGL's
// own fullscreen canvas (which needs an explicit origin uniform to place
// its bloom anywhere on the page), this canvas exactly fills the button
// it lives in, so gl_FragCoord/uResolution alone already gives centered,
// button-local UV with nothing else to track.
const VERTEX = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAGMENT = `
precision highp float;
uniform vec2 uResolution;
uniform float uProgress;
uniform vec3 uColor;
uniform float uAlpha;

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p = uv - vec2(0.5);
  float d = length(p) * 2.0;
  // A single expanding ring — uProgress carries it from the center out
  // past the button's own edge (1.25, not 1.0, so it fully exits rather
  // than stopping right at the rim), uAlpha fading the whole thing out
  // over the tail of the tween rather than the ring just vanishing at
  // full radius.
  float ring = smoothstep(0.16, 0.0, abs(d - uProgress * 1.25));
  float a = ring * uAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor * a, a);
}
`;

const NavRipple = forwardRef(({ color = "#ffffff" }, ref) => {
  const canvasRef = useRef(null);
  const drawRef = useRef(null);
  const tweenRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
      depth: false,
      stencil: false,
    });
    if (!gl) return undefined;

    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };

    const vertex = compile(gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vertex || !fragment) return undefined;

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
      resolution: gl.getUniformLocation(program, "uResolution"),
      progress: gl.getUniformLocation(program, "uProgress"),
      color: gl.getUniformLocation(program, "uColor"),
      alpha: gl.getUniformLocation(program, "uAlpha"),
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    const hexToUnit = (hex) => {
      const clean = hex.replace("#", "");
      const value = parseInt(clean, 16);
      return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
    };
    const rgb = hexToUnit(color);

    const draw = (progress, alpha) => {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (alpha <= 0.001) return;
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
      gl.uniform1f(uniforms.progress, progress);
      gl.uniform3f(uniforms.color, rgb[0], rgb[1], rgb[2]);
      gl.uniform1f(uniforms.alpha, alpha);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    drawRef.current = draw;

    return () => {
      resizeObserver.disconnect();
      tweenRef.current?.kill();
      drawRef.current = null;
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.deleteBuffer(buffer);
    };
  }, [color]);

  useImperativeHandle(ref, () => ({
    // Fired from Navigation.jsx's own open()/close() — one ring per
    // toggle, whichever direction. overwrite via kill-then-restart, the
    // same discipline every other GSAP tween in this app already follows
    // when a gesture can retrigger before the last one finished.
    ripple() {
      if (!drawRef.current) return;
      const state = { progress: 0, alpha: 1 };
      tweenRef.current?.kill();
      tweenRef.current = gsap.timeline({
        onUpdate: () => drawRef.current?.(state.progress, state.alpha),
        onComplete: () => drawRef.current?.(0, 0),
      })
        .to(state, { progress: 1, duration: .7, ease: "power2.out" }, 0)
        .to(state, { alpha: 0, duration: .3, ease: "power1.in" }, .45);
    },
  }));

  return <canvas ref={ canvasRef } className="activator-ripple" aria-hidden="true" />;
});

export default NavRipple;
