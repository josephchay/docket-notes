import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useScroll, useSpring, useTransform, useVelocity } from "framer-motion";

import { resolveCssColor } from "../History/HistoryAmbient";

import "./ScrollProgress.css";

const DRIP_CANVAS_SIZE = 24; // CSS px — bigger than the visual dot itself, so it's also a comfortable drag hit-target
const DRIP_BASE_RADIUS = 4.5;

// A real critically-underdamped spring for the drip's own "just stopped"
// sag — the same recipe TrashPhysics' chip-squash and CommandPalette's
// row springs already use (v += (-k·x - c·v)·dt), kicked once the instant
// scrolling actually stops rather than driven by a fixed keyframe.
const SAG_STIFFNESS = 210;
const SAG_DAMPING = 12;
const SAG_KICK = 3.4;
const STOP_VELOCITY = .04;

const hexToUnit = (hex) => {
  const clean = (hex || "#191919").replace("#", "");
  const value = parseInt(clean, 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
};

const DRIP_VERT = `
  attribute vec2 aPos;
  void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// The exact gaussian-metaball/rim formula LiquidMeter.jsx's own vial
// shader (and InkGoo before it) already established, adapted to a single
// ball with independent X/Y radii instead of a wave field of several —
// this drip has no surface to simulate, just one shape that stretches
// with scroll velocity and sags once it stops (see the tick loop below).
const DRIP_FRAG = `
  precision mediump float;
  uniform vec2 uResolution;
  uniform float uDpr;
  uniform vec2 uCenter;
  uniform float uRadiusX;
  uniform float uRadiusY;
  uniform vec3 uInk;
  uniform vec3 uRim;

  void main() {
    vec2 p = gl_FragCoord.xy / uDpr;
    p.y = uResolution.y - p.y;
    vec2 d = p - uCenter;
    d.x /= max(uRadiusX, 0.6);
    d.y /= max(uRadiusY, 0.6);
    float field = exp(-dot(d, d) * 1.4);

    float body = smoothstep(0.5, 0.56, field);
    float rim = smoothstep(0.5, 0.6, field) * (1.0 - smoothstep(0.6, 1.05, field));
    vec3 col = mix(uInk, uRim, rim * 0.5);

    if (body < 0.01) discard;
    gl_FragColor = vec4(col, body);
  }
`;

// A thin ink line tracking how far down the desk you've scrolled — framer's
// useScroll reads the .home container directly, and a spring on top gives
// it a bit of bouncy catch-up lag rather than tracking the scrollbar 1:1.
// A real WebGL metaball droplet (not a plain CSS dot) rides the bar's
// leading tip: it comet-stretches along scroll velocity in flight and sags
// under a real damped spring the instant scrolling actually stops, and it
// can be grabbed directly to scrub the desk rather than only ever clicking
// a marker. `markers` (starred notes' rough positions, see scrollMarkers in
// Home.jsx) render as small clickable ticks along the track — a quick-jump
// aid, not a precise map: notes wrap in a flex grid, so a note's real
// scroll offset isn't a simple function of its list index the way it would
// be in a single column. Both a marker's own placement and where it
// scrolls to on click come from that same index/total ratio, so the two
// always agree with each other even though neither is pixel-exact against
// the real DOM position. Clicking a marker also sends a traveling
// highlight pulse from the current position to the target, timed on its
// own rather than tied to however long the actual smooth-scroll takes, so
// the jump reads as a travel rather than a teleport.
const ScrollProgress = ({ containerRef, markers = [], reduceMotion = false }) => {
  const { scrollYProgress } = useScroll({ container: containerRef });
  const progress = useSpring(scrollYProgress, { stiffness: 280, damping: 32, mass: .4 });
  const dripLeft = useTransform(progress, (v) => `${ v * 100 }%`);

  const rawVelocity = useVelocity(progress);
  const velocity = useSpring(rawVelocity, { stiffness: 300, damping: 40, mass: .3 });

  const trackRef = useRef(null);
  const draggingRef = useRef(false);

  const ratioFromClientX = (clientX) => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  // Direct-manipulation scrubbing — no smooth behavior, since a drag
  // should track the pointer 1:1 the way dragging a real scrollbar thumb
  // does, not ease toward wherever it last was.
  const scrubTo = (ratio) => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: ratio * (el.scrollHeight - el.clientHeight) });
  };

  const handleDripPointerDown = (e) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    scrubTo(ratioFromClientX(e.clientX));
  };
  const handleDripPointerMove = (e) => {
    if (!draggingRef.current) return;
    scrubTo(ratioFromClientX(e.clientX));
  };
  const handleDripPointerUp = (e) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  // The traveling pulse a marker click sends along the track (see jumpTo
  // below) — a separate, purely decorative element from the real
  // scroll-driven progress bar/drip above it.
  const [travelPulse, setTravelPulse] = useState(null);

  const jumpTo = (ratio) => {
    const el = containerRef.current;
    if (!el) return;
    if (!reduceMotion) setTravelPulse({ key: Date.now(), from: scrollYProgress.get(), to: ratio });
    el.scrollTo({ top: ratio * (el.scrollHeight - el.clientHeight), behavior: "smooth" });
  };

  // The drip's own WebGL canvas — a raw GL program rather than three.js
  // (the same "no three.js needed for this" call TrashPhysics' own
  // dissolve shader and ThemeWipeGL/NavRipple already made), since this is
  // one small, always-mounted shape rather than a whole scene. Skipped
  // entirely under reduced motion — the canvas never mounts, and the CSS
  // fallback dot (see .scroll-progress-drip) shows instead.
  const canvasRef = useRef(null);
  const inkColorRef = useRef("#191919");
  const uniformsRef = useRef(null);
  const sagRef = useRef({ value: 0, vel: 0 });
  const wasMovingRef = useRef(false);
  const lastTickRef = useRef(0);

  useEffect(() => {
    if (reduceMotion) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!gl) return undefined;

    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };
    const vertex = compile(gl.VERTEX_SHADER, DRIP_VERT);
    const fragment = compile(gl.FRAGMENT_SHADER, DRIP_FRAG);
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
      dpr: gl.getUniformLocation(program, "uDpr"),
      center: gl.getUniformLocation(program, "uCenter"),
      radiusX: gl.getUniformLocation(program, "uRadiusX"),
      radiusY: gl.getUniformLocation(program, "uRadiusY"),
      ink: gl.getUniformLocation(program, "uInk"),
      rim: gl.getUniformLocation(program, "uRim"),
    };
    uniformsRef.current = uniforms;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(DRIP_CANVAS_SIZE * dpr);
    canvas.height = Math.round(DRIP_CANVAS_SIZE * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uniforms.resolution, DRIP_CANVAS_SIZE, DRIP_CANVAS_SIZE);
    gl.uniform1f(uniforms.dpr, dpr);

    const applyTint = () => {
      const ink = hexToUnit(resolveCssColor(inkColorRef.current));
      const rim = hexToUnit(resolveCssColor("var(--page-bg-color)"));
      gl.uniform3f(uniforms.ink, ink[0], ink[1], ink[2]);
      gl.uniform3f(uniforms.rim, rim[0], rim[1], rim[2]);
    };
    applyTint();
    const themeObserver = new MutationObserver(applyTint);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    lastTickRef.current = performance.now();
    let raf = requestAnimationFrame(tick);

    function tick() {
      raf = requestAnimationFrame(tick);

      const now = performance.now();
      const dt = Math.min(.05, (now - lastTickRef.current) / 1000);
      lastTickRef.current = now;

      const v = velocity.get();
      const absV = Math.min(Math.abs(v), 2.4);

      // Comet-stretch while actually moving — elongated along travel,
      // thinned perpendicular, the same squash-and-stretch language every
      // spring in this app already speaks.
      const scaleX = 1 + absV * 1.35;
      const scaleY = 1 - absV * .28;

      // The instant real motion drops back to near-zero after having been
      // moving, the drip gets struck with a downward impulse — gravity
      // finally catching up with it now that the hand let go — and the
      // spring above carries it through a real droop-and-rebound rather
      // than snapping flat.
      const moving = absV > STOP_VELOCITY;
      if (wasMovingRef.current && !moving) sagRef.current.vel -= SAG_KICK;
      wasMovingRef.current = moving;

      const sag = sagRef.current;
      sag.vel += (-SAG_STIFFNESS * sag.value - SAG_DAMPING * sag.vel) * dt;
      sag.value += sag.vel * dt;

      const radiusX = DRIP_BASE_RADIUS * scaleX;
      const radiusY = DRIP_BASE_RADIUS * scaleY + sag.value;
      const centerY = DRIP_CANVAS_SIZE / 2 + sag.value * 1.6;

      gl.uniform2f(uniforms.center, DRIP_CANVAS_SIZE / 2, centerY);
      gl.uniform1f(uniforms.radiusX, radiusX);
      gl.uniform1f(uniforms.radiusY, radiusY);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    return () => {
      cancelAnimationFrame(raf);
      themeObserver.disconnect();
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.deleteBuffer(buffer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  return (
    <div ref={ trackRef } className="scroll-progress-track" aria-hidden="true">
      {
        markers.map((ratio, index) => (
          <button
            key={ index }
            type="button"
            tabIndex={ -1 }
            className="scroll-progress-marker"
            style={{ left: `${ ratio * 100 }%` }}
            onClick={ () => jumpTo(ratio) }
          />
        ))
      }
      <motion.div className="scroll-progress" style={{ scaleX: progress }} />
      <AnimatePresence>
        {
          travelPulse && (
            <motion.div
              key={ travelPulse.key }
              className="scroll-progress-travel-pulse"
              initial={{ left: `${ travelPulse.from * 100 }%`, opacity: 0 }}
              animate={{ left: `${ travelPulse.to * 100 }%`, opacity: [0, 1, 1, 0] }}
              transition={{ duration: .6, ease: "easeInOut", times: [0, .15, .8, 1] }}
              onAnimationComplete={ () => setTravelPulse((prev) => (prev?.key === travelPulse.key ? null : prev)) }
            />
          )
        }
      </AnimatePresence>
      {
        reduceMotion ? (
          <motion.div className="scroll-progress-drip" style={{ left: dripLeft }} />
        ) : (
          <motion.canvas
            ref={ canvasRef }
            className="scroll-progress-drip-gl"
            style={{ left: dripLeft, width: DRIP_CANVAS_SIZE, height: DRIP_CANVAS_SIZE }}
            onPointerDown={ handleDripPointerDown }
            onPointerMove={ handleDripPointerMove }
            onPointerUp={ handleDripPointerUp }
            onPointerCancel={ handleDripPointerUp }
          />
        )
      }
    </div>
  );
};

export default ScrollProgress;
