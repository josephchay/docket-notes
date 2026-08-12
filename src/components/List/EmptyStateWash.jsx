import { useEffect, useRef } from "react";

import { WaveField } from "../../utils/waveField";

// A real ripple behind the empty desk's own gooey blobs — the same
// hand-verified wave-equation solver NoteConstellation's ink pool and
// Header's own InkVial already run, at a fixed logical grid (no need to
// track the container's own aspect ratio precisely — this is a soft,
// low-detail wash, not a precision instrument) rendered through a raw
// WebGL fragment shader rather than three.js, the same "no scene graph
// needed for one fullscreen quad" reasoning ThemeWipeGL and NavRipple
// already settled on. Unlike InkSurface.js (which the pool actually
// uses), there's no pannable/zoomable camera here to invert per pixel —
// this canvas IS the whole domain, so gl_FragCoord/uResolution alone
// already gives correct UV with nothing else to track.
const GRID_COLS = 40;
const GRID_ROWS = 30;
const WAVE_SPEED = 22;
const WAVE_DAMPING = 0.982;
const EXCITE_MIN_MOVE = 10; // px of mouse movement before a fresh splash is worth exciting
const EXCITE_AMOUNT = 0.4;

const VERT = `
  attribute vec2 aPos;
  void main() {
    gl_Position = vec4(aPos, 0.0, 1.0);
  }
`;

const FRAG = `
  precision mediump float;
  uniform sampler2D uHeight;
  uniform vec2 uResolution;
  uniform vec2 uTexel;
  uniform vec3 uColor;

  float heightAt(vec2 uv) {
    return texture2D(uHeight, uv).r * 2.0 - 1.0;
  }

  void main() {
    // Flipped once here — gl_FragCoord's own origin is bottom-left, the
    // DOM pointer coordinates this canvas is excited from are top-left —
    // so a ripple actually renders under wherever the mouse struck it,
    // not mirrored above.
    vec2 uv = vec2(gl_FragCoord.x / uResolution.x, 1.0 - gl_FragCoord.y / uResolution.y);

    float h = heightAt(uv);
    float hx = heightAt(uv + vec2(uTexel.x, 0.0));
    float hy = heightAt(uv + vec2(0.0, uTexel.y));
    vec2 grad = vec2(hx - h, hy - h);

    // Same two-term shading language InkSurface.js's own pool uses: |h|
    // pools ink, the gradient catches a sheen along the moving front.
    float body = smoothstep(0.01, 0.4, abs(h));
    float sheen = smoothstep(0.015, 0.25, length(grad));
    float alpha = body * 0.14 + sheen * 0.09;
    if (alpha < 0.003) discard;

    gl_FragColor = vec4(uColor * alpha, alpha);
  }
`;

const hexToUnit = (hex) => {
  const clean = hex.replace("#", "");
  const value = parseInt(clean, 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
};

const EmptyStateWash = ({ reduceMotion, color = "#191919" }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (reduceMotion) return undefined;

    const canvas = canvasRef.current;
    const parent = canvas.parentElement;
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) return undefined;

    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };

    const vertex = compile(gl.VERTEX_SHADER, VERT);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAG);
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

    const wave = new WaveField(GRID_COLS, GRID_ROWS, 1, { waveSpeed: WAVE_SPEED, damping: WAVE_DAMPING });
    const texData = new Uint8Array(GRID_COLS * GRID_ROWS * 4);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const uniforms = {
      height: gl.getUniformLocation(program, "uHeight"),
      resolution: gl.getUniformLocation(program, "uResolution"),
      texel: gl.getUniformLocation(program, "uTexel"),
      color: gl.getUniformLocation(program, "uColor"),
    };
    gl.uniform2f(uniforms.texel, 1 / GRID_COLS, 1 / GRID_ROWS);
    gl.uniform3fv(uniforms.color, hexToUnit(color));

    let width = 1;
    let height = 1;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = parent.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width * dpr));
      height = Math.max(1, Math.round(rect.height * dpr));
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      gl.uniform2f(uniforms.resolution, width, height);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(parent);

    // The pointer's own excite — position mapped from CSS pixels within
    // the container straight into the wave's own [0, cols]×[0, rows] grid
    // space (WaveField.excite already expects "the same domain-unit
    // coordinate space the caller's own pool uses," which here is simply
    // the grid itself, cellSize having been left at 1 above for exactly
    // this reason: no separate world-to-domain scale to track).
    let lastX = -9999;
    let lastY = -9999;
    const handleMove = (e) => {
      const rect = parent.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      if (Math.hypot(px - lastX, py - lastY) < EXCITE_MIN_MOVE) return;
      lastX = px;
      lastY = py;
      if (px < 0 || py < 0 || px > rect.width || py > rect.height) return;
      wave.excite((px / rect.width) * GRID_COLS, (py / rect.height) * GRID_ROWS, EXCITE_AMOUNT);
    };
    parent.addEventListener("pointermove", handleMove);

    let raf;
    let last = performance.now();
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      wave.step(dt);

      const heights = wave.height;
      for (let i = 0; i < heights.length; i++) {
        const packed = Math.max(0, Math.min(255, Math.round(heights[i] * 127 + 128)));
        texData[i * 4] = packed;
        texData[i * 4 + 3] = 255;
      }
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GRID_COLS, GRID_ROWS, 0, gl.RGBA, gl.UNSIGNED_BYTE, texData);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(uniforms.height, 0);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      parent.removeEventListener("pointermove", handleMove);
      gl.deleteTexture(texture);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.deleteBuffer(buffer);
    };
  }, [reduceMotion, color]);

  if (reduceMotion) return null;

  return <canvas ref={ canvasRef } className="empty-state-wash" aria-hidden="true" />;
};

export default EmptyStateWash;
