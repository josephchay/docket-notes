import React, { useEffect, useRef } from "react";

import "./CursorAura.css";

const TRAIL = 22;            // points in the comet trail
const RIPPLES = 6;           // simultaneous click ripples
const RIPPLE_LIFE = 0.9;     // seconds a ripple lives
const RES_SCALE = 0.75;      // render scale — the glow is soft, so undersampling is invisible
const PAD = 190;             // scissor padding around the trail (px), covers ring + mist reach

const INTERACTIVE = "button, a, input, textarea, [role='button'], .star, .edit";

const VERTEX = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAGMENT = `
precision highp float;

const int TRAIL = ${ TRAIL };
const int RIPPLES = ${ RIPPLES };
const float RIPPLE_LIFE = ${ RIPPLE_LIFE };

uniform float uTime;
uniform float uFade;
uniform float uActive;
uniform float uPress;
uniform float uRatio;             // canvas pixels per CSS pixel
uniform vec2 uPoints[TRAIL];      // trail, canvas pixels, y-up, head first
uniform vec4 uRipples[RIPPLES];   // x, y (canvas px), age (s), strength

const vec3 INK = vec3(0.098, 0.098, 0.098);

// A cycling pastel palette tuned to the note colors: yellow, pink, blue, purple.
vec3 palette(float t) {
  return vec3(0.62, 0.58, 0.66) + vec3(0.34, 0.34, 0.30) * cos(6.28318 * (t + vec3(0.02, 0.36, 0.64)));
}

void main() {
  vec2 p = gl_FragCoord.xy;
  vec2 head = uPoints[0];
  float headDist = length(p - head) / uRatio;

  // Comet trail: a soft metaball field over the pointer's recent path.
  float field = 0.0;
  for (int i = 0; i < TRAIL; i++) {
    float w = 1.0 - float(i) / float(TRAIL);
    float r = (10.0 + 26.0 * w) * uRatio;
    vec2 d = p - uPoints[i];
    field += w * exp(-dot(d, d) / (2.0 * r * r));
  }
  float mist = clamp(field * 0.55, 0.0, 1.0) * 0.5;

  float hue = uTime * 0.06 + headDist * 0.0022;
  vec3 col = palette(hue) * mist;
  float a = mist;

  // Liquid ring around the head, swelling over interactive elements and
  // tightening while the pointer is pressed.
  vec2 hd = p - head;
  float ang = atan(hd.y, hd.x);
  float wobble = sin(ang * 3.0 + uTime * 2.4) * 1.3 + sin(ang * 5.0 - uTime * 3.1) * 0.7;
  float ringRadius = 15.0 + uActive * 12.0 - uPress * 5.0 + wobble;
  float ring = smoothstep(2.4, 0.4, abs(headDist - ringRadius)) * (0.5 + uActive * 0.5);
  col += palette(hue + 0.12) * ring;
  a += ring;

  // Click ripples: expanding, fading rings.
  for (int i = 0; i < RIPPLES; i++) {
    vec4 rp = uRipples[i];
    if (rp.z < 0.0 || rp.z > RIPPLE_LIFE) continue;
    float prog = rp.z / RIPPLE_LIFE;
    float radius = 8.0 + prog * 110.0;
    float rd = abs(length(p - rp.xy) / uRatio - radius);
    float band = smoothstep(7.0 + prog * 9.0, 0.0, rd) * (1.0 - prog) * rp.w * 0.8;
    col += palette(hue + 0.3 + prog * 0.25) * band;
    a += band;
  }

  col = min(col, vec3(1.0));
  a = min(a, 1.0);

  // Ink core dot, composited over everything else.
  float core = 1.0 - smoothstep(3.2, 4.6, headDist);
  col = INK * core + col * (1.0 - core);
  a = core + a * (1.0 - core);

  gl_FragColor = vec4(col * uFade, a * uFade);
}
`;

// A GPU-shaded cursor: a pastel metaball comet trails the pointer, a liquid
// ring swells over anything clickable, and presses fire ripple bursts — all
// drawn by a fragment shader on a transparent fullscreen canvas. Falls back
// to the OS cursor when WebGL is missing or the visitor prefers less motion.
const CursorAura = () => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;

    const showNativeCursor = () => document.body.classList.add("native-cursor");

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    if (reducedMotion || coarsePointer) {
      showNativeCursor();
      return;
    }

    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
    });

    if (!gl) {
      showNativeCursor();
      return;
    }

    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };

    const vertex = compile(gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vertex || !fragment) {
      showNativeCursor();
      return;
    }

    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.useProgram(program);

    // One triangle that covers the whole screen; the scissor rect below keeps
    // the shader from ever running far away from the cursor.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uniforms = {
      time: gl.getUniformLocation(program, "uTime"),
      fade: gl.getUniformLocation(program, "uFade"),
      active: gl.getUniformLocation(program, "uActive"),
      press: gl.getUniformLocation(program, "uPress"),
      ratio: gl.getUniformLocation(program, "uRatio"),
      points: gl.getUniformLocation(program, "uPoints"),
      ripples: gl.getUniformLocation(program, "uRipples"),
    };

    let ratio = 1;
    const resize = () => {
      ratio = Math.min(window.devicePixelRatio || 1, 2) * RES_SCALE;
      canvas.width = Math.round(window.innerWidth * ratio);
      canvas.height = Math.round(window.innerHeight * ratio);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();

    const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const points = Array.from({ length: TRAIL }, () => ({ x: mouse.x, y: mouse.y }));
    const ripples = [];

    let active = 0, activeTarget = 0;
    let press = 0, pressTarget = 0;
    let fade = 0, fadeTarget = 0;

    const pointArray = new Float32Array(TRAIL * 2);
    const rippleArray = new Float32Array(RIPPLES * 4);

    const handleMove = (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      fadeTarget = 1;
    };

    const handleOver = (e) => {
      activeTarget = e.target?.closest?.(INTERACTIVE) ? 1 : 0;
    };

    const handleDown = (e) => {
      pressTarget = 1;
      ripples.push({ x: e.clientX, y: e.clientY, start: performance.now() });
      if (ripples.length > RIPPLES) ripples.shift();
    };

    const handleUp = () => { pressTarget = 0; };
    const handleLeave = () => { fadeTarget = 0; };
    const handleEnter = () => { fadeTarget = 1; };

    let raf = 0;
    let last = performance.now();

    const frame = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      // Frame-rate independent easing, so the feel is identical at any Hz.
      const ease = (k) => 1 - Math.pow(1 - k, dt * 60);

      points[0].x += (mouse.x - points[0].x) * ease(0.5);
      points[0].y += (mouse.y - points[0].y) * ease(0.5);
      for (let i = 1; i < TRAIL; i++) {
        points[i].x += (points[i - 1].x - points[i].x) * ease(0.38);
        points[i].y += (points[i - 1].y - points[i].y) * ease(0.38);
      }

      active += (activeTarget - active) * ease(0.18);
      press += (pressTarget - press) * ease(0.3);
      fade += (fadeTarget - fade) * ease(0.12);

      // Track the bounds of everything visible so only those pixels shade.
      let minX = mouse.x, maxX = mouse.x, minY = mouse.y, maxY = mouse.y;

      for (let i = 0; i < TRAIL; i++) {
        pointArray[i * 2] = points[i].x * ratio;
        pointArray[i * 2 + 1] = canvas.height - points[i].y * ratio;
        minX = Math.min(minX, points[i].x); maxX = Math.max(maxX, points[i].x);
        minY = Math.min(minY, points[i].y); maxY = Math.max(maxY, points[i].y);
      }

      for (let i = 0; i < RIPPLES; i++) {
        const ripple = ripples[i];
        const age = ripple ? (now - ripple.start) / 1000 : -1;
        rippleArray[i * 4] = ripple ? ripple.x * ratio : 0;
        rippleArray[i * 4 + 1] = ripple ? canvas.height - ripple.y * ratio : 0;
        rippleArray[i * 4 + 2] = age;
        rippleArray[i * 4 + 3] = 1;
        if (ripple && age <= RIPPLE_LIFE) {
          minX = Math.min(minX, ripple.x - PAD); maxX = Math.max(maxX, ripple.x + PAD);
          minY = Math.min(minY, ripple.y - PAD); maxY = Math.max(maxY, ripple.y + PAD);
        }
      }

      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      if (fade > 0.004) {
        const sx = Math.max(0, Math.floor((minX - PAD) * ratio));
        const sy = Math.max(0, Math.floor(canvas.height - (maxY + PAD) * ratio));
        const sw = Math.ceil((maxX - minX + PAD * 2) * ratio);
        const sh = Math.ceil((maxY - minY + PAD * 2) * ratio);

        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(sx, sy, sw, sh);

        gl.uniform1f(uniforms.time, now / 1000);
        gl.uniform1f(uniforms.fade, fade);
        gl.uniform1f(uniforms.active, active);
        gl.uniform1f(uniforms.press, press);
        gl.uniform1f(uniforms.ratio, ratio);
        gl.uniform2fv(uniforms.points, pointArray);
        gl.uniform4fv(uniforms.ripples, rippleArray);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }

      raf = requestAnimationFrame(frame);
    };

    const stop = () => cancelAnimationFrame(raf);
    const start = () => {
      stop();
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    const handleVisibility = () => (document.hidden ? stop() : start());
    const handleContextLost = (e) => {
      e.preventDefault();
      stop();
      showNativeCursor();
    };

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", handleMove, { passive: true });
    window.addEventListener("pointerdown", handleDown, { passive: true });
    window.addEventListener("pointerup", handleUp, { passive: true });
    document.addEventListener("pointerover", handleOver, { passive: true });
    document.documentElement.addEventListener("mouseleave", handleLeave);
    document.documentElement.addEventListener("mouseenter", handleEnter);
    document.addEventListener("visibilitychange", handleVisibility);
    canvas.addEventListener("webglcontextlost", handleContextLost);

    start();

    return () => {
      stop();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerdown", handleDown);
      window.removeEventListener("pointerup", handleUp);
      document.removeEventListener("pointerover", handleOver);
      document.documentElement.removeEventListener("mouseleave", handleLeave);
      document.documentElement.removeEventListener("mouseenter", handleEnter);
      document.removeEventListener("visibilitychange", handleVisibility);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      // Release GPU resources without loseContext(): killing the context here
      // would leave the canvas unusable for StrictMode's dev-only re-mount.
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.deleteBuffer(buffer);
      document.body.classList.remove("native-cursor");
    };
  }, []);

  return (
    <canvas
      ref={ canvasRef }
      className="cursor-aura"
      aria-hidden="true"
    />
  );
};

export default CursorAura;
