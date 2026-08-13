import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import gsap from "gsap";
import { FaXmark } from "react-icons/fa6";

import { NOTE_COLORS } from "../../constants/colors";
import { smoothPath, smoothAreaPath } from "../../utils/svgPath";
import { resolveCssColor } from "../History/HistoryAmbient";
import SheetPanel from "../Sheet/SheetPanel";

import "./InsightsPanel.css";

// The Starred stat's liquid fill (see the WebGL mount effect further
// down) — a small raw-WebGL canvas layered over the plain CSS bar
// (.insights-stat-fill stays underneath, always correctly sized, so a
// browser that can't get a WebGL context — or a reduced-motion visitor
// who never gets the canvas at all — still sees an accurate ratio, just
// without the liquid). uLevel is driven every frame from statLevelRef,
// itself tweened by the GSAP open sequence rather than the shader
// reading a raw prop directly, so the fill still rises in step with the
// rest of the intro instead of snapping straight to its final level.
const LIQUID_VERT = `
  attribute vec2 aPos;
  void main() {
    gl_Position = vec4(aPos, 0.0, 1.0);
  }
`;

const LIQUID_FRAG = `
  precision mediump float;
  uniform vec2 uResolution;
  uniform float uLevel;
  uniform float uTime;
  uniform vec3 uColor;

  void main() {
    vec2 uv = gl_FragCoord.xy / uResolution;

    // The fill edge isn't a hard vertical line — it wobbles gently over
    // time, the closest a bar this thin can read as a liquid meniscus
    // rather than a progress bar.
    float wobble = sin(uTime * 1.8 + uv.y * 6.0) * 0.01 + sin(uTime * 0.7) * 0.006;
    float edge = uLevel + wobble;

    float fill = smoothstep(edge + 0.006, edge - 0.006, uv.x);
    if (fill < 0.02) discard;

    // A soft specular band drifting across the filled portion — light
    // catching a liquid surface rather than a flat tint.
    float highlightY = smoothstep(0.0, 0.55, uv.y) * smoothstep(1.0, 0.55, uv.y);
    float drift = sin(uv.x * 10.0 - uTime * 0.8) * 0.5 + 0.5;
    float specular = highlightY * drift * 0.35;

    gl_FragColor = vec4(uColor + specular, 1.0) * fill;
  }
`;

const hexToUnit = (hex) => {
  const clean = (hex || "#191919").replace("#", "");
  const value = parseInt(clean, 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
};

// The color bars' own coupled-spring wave (see the simulation effect
// below) — each bar is a damped spring pulling itself back toward rest,
// coupled to its immediate neighbors so a hover or a pick sends a real
// impulse rippling sideways down the row, rather than the bar's own
// entrance spring (see the GSAP effect above) being the only motion any
// bar ever gets.
const WAVE_STIFFNESS = 90; // pulls each bar back toward its own rest position
const WAVE_DAMPING = 7;
const WAVE_COUPLING = 55; // how strongly each bar drags its immediate neighbors along
const WAVE_IMPULSE = 260; // velocity kick a hover or pick applies
const WAVE_ROTATE_FROM_VEL = 0.03; // deg of lean per unit velocity — a pendulum leaning into its own motion

// The event the command palette's "Show desk insights" entry (and the
// toolbar's chart button) fire to summon this panel from anywhere.
export const INSIGHTS_EVENT = "docket:insights";

// The day-trend chart's own coordinate space — see smoothPath/smoothAreaPath
// (utils/svgPath.js) for how points become the drawn curve.
const TREND_W = 320;
const TREND_H = 80;
const TREND_PAD_TOP = 10;
const TREND_BASELINE = TREND_H - 8;
// The liquid reveal's own clip rect (see the mount effect) only ever
// animates its own `y` — comfortably taller than the viewBox so its
// bottom edge is always off-screen and irrelevant, letting a single
// attribute produce a clean "rises from the baseline" reveal instead of
// a rect growing from both edges toward the middle.
const REVEAL_TALL = TREND_H * 2;

// The open sequence's own real GSAP timeline (see the mount effect below) —
// one orchestrated narrative instead of each element carrying its own
// independent Framer delay: the trend line draws, a liquid fill rises to
// meet it from the baseline, the color bars arrive in a wave weighted by
// their own count, then the stat tiles pop. These durations are shared
// constants (not just baked into the timeline) so the trend marker's own
// idle-loop Framer animation — left as Framer since it repeats forever
// rather than playing once, a poor fit for a one-shot GSAP timeline — can
// still time its first pop to land right as the fill finishes rising.
const LINE_DURATION = .9;
const LINE_TO_FILL_OVERLAP = .5; // the fill starts this far into the still-drawing line
const FILL_DURATION = .55;
const BARS_START = LINE_TO_FILL_OVERLAP + FILL_DURATION + .1;
const BAR_STAGGER = .045;
const BAR_DURATION = .5;
const MARKER_POP_DELAY = LINE_TO_FILL_OVERLAP + FILL_DURATION + .05;

// Real numbers about the desk, not decoration. Two bar charts and two stat
// tiles, opened the same dot-to-sheet way as the command palette. The "by
// day" bars are a single series in the page's own ink — there's no second
// category to tell apart, so no palette decision to make there. The "by
// color" bars reuse the exact identity mapping every other color control in
// the app already uses (NOTE_COLORS), including its click-to-filter
// behavior, so a color picked here narrows the same desk everywhere else.
const InsightsPanel = ({
  totalCount,
  colorCounts,
  days,
  favoriteCount,
  avgChars,
  sortColor,
  setSortColor,
  reduceMotion,
}) => {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  // Which day the trend chart's own scrub gesture is currently sitting
  // on, or null when not scrubbing (see handleTrendScrub) — real state,
  // not a ref, since it decides what the reticle/tooltip actually render
  // rather than driving a per-frame imperative loop.
  const [scrubIndex, setScrubIndex] = useState(null);
  const trendRef = useRef(null);

  // The open sequence's own targets — a plain ref map keyed by color name
  // (same "swatchRefs.current[id] = el" convention TrashPanel already
  // uses) rather than one ref per bar, since the palette is a fixed list
  // mapped in JSX, not individually declared elements.
  const trendLineRef = useRef(null);
  const trendRevealRef = useRef(null);
  const barRefs = useRef({});
  const countRefs = useRef({});
  const waveRefs = useRef({});
  // [{ pos, vel }], one per palette color, same order as paletteNames —
  // rebuilt each open by the simulation effect below, mutated directly
  // by applyWaveImpulse on hover/pick (plain refs, not React state: this
  // is a continuous per-frame simulation, not something that should ever
  // trigger a re-render).
  const waveStateRef = useRef([]);
  const statBigRef = useRef(null);
  const statCanvasRef = useRef(null);
  // The liquid shader's own current fill level — a plain number, not a
  // DOM transform, since a shader-drawn surface can't be meaningfully
  // CSS-scaled the way a flat bar could. Tweened by the GSAP open
  // sequence below; read fresh each frame by the WebGL draw effect
  // further down.
  const statLevelRef = useRef(0);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(INSIGHTS_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(INSIGHTS_EVENT, handleSummon);
    };
  }, []);

  const paletteNames = Object.keys(NOTE_COLORS);
  const maxColorCount = Math.max(1, ...paletteNames.map((name) => colorCounts?.[name] ?? 0));
  const maxDayCount = Math.max(1, ...(days || []).map((day) => day.count));
  const starredRatio = totalCount > 0 ? favoriteCount / totalCount : 0;

  // The day-trend's own points, plus the smoothed line and area built from
  // them — kept as real numbers straight off `days`, no idle wobble on the
  // drawn curve itself, so the shape stays an accurate read of the data
  // (only the draw-on and the latest-point marker animate).
  const trendPoints = useMemo(() => {
    if (!days || days.length === 0) return [];
    const usableH = TREND_BASELINE - TREND_PAD_TOP;

    return days.map((day, index) => ({
      x: days.length === 1 ? TREND_W / 2 : (index / (days.length - 1)) * TREND_W,
      y: TREND_BASELINE - (day.count / maxDayCount) * usableH,
    }));
  }, [days, maxDayCount]);

  const trendLinePath = useMemo(() => smoothPath(trendPoints), [trendPoints]);
  const trendAreaPath = useMemo(() => smoothAreaPath(trendPoints, TREND_BASELINE), [trendPoints]);
  const trendLastPoint = trendPoints[trendPoints.length - 1];

  // The whole open sequence, as one real GSAP timeline rather than each
  // element's own independent Framer delay — fires fresh every open since
  // SheetPanel's AnimatePresence fully unmounts this content on close (so
  // a plain mount-style effect, gated on `open` rather than `[]`, replays
  // it each time rather than only once for this component's entire life).
  useEffect(() => {
    if (!open) return;

    const line = trendLineRef.current;
    const reveal = trendRevealRef.current;

    if (reduceMotion) {
      // Same end state, no draw/rise/wave narrative — reduced motion
      // wants the accurate numbers, not the sustained motion getting
      // there.
      if (line) gsap.set(line, { strokeDasharray: "none", strokeDashoffset: 0 });
      if (reveal) gsap.set(reveal, { attr: { y: -TREND_H } });
      paletteNames.forEach((name) => {
        if (barRefs.current[name]) gsap.set(barRefs.current[name], { scaleY: 1 });
        if (countRefs.current[name]) gsap.set(countRefs.current[name], { opacity: 1, scale: 1 });
      });
      statLevelRef.current = starredRatio;
      if (statBigRef.current) gsap.set(statBigRef.current, { opacity: 1, scale: 1, y: 0 });
      return;
    }

    const tl = gsap.timeline();

    if (line) {
      const length = line.getTotalLength();
      gsap.set(line, { strokeDasharray: length, strokeDashoffset: length });
      tl.to(line, { strokeDashoffset: 0, duration: LINE_DURATION, ease: "power2.inOut" }, 0);
    }

    if (reveal) {
      gsap.set(reveal, { attr: { y: TREND_BASELINE, height: REVEAL_TALL } });
      tl.to(reveal, { attr: { y: -TREND_H }, duration: FILL_DURATION, ease: "power2.out" }, LINE_TO_FILL_OVERLAP);
    }

    // Each bar's own overshoot is scaled by how busy that color actually
    // is — a real read of the data driving the spring's own character,
    // not just its arrival order. back.out's own argument IS the
    // overshoot amount, so the weight plugs straight in rather than
    // needing a separate curve.
    paletteNames.forEach((name, index) => {
      const weight = (colorCounts?.[name] ?? 0) / maxColorCount;
      const barEl = barRefs.current[name];
      const countEl = countRefs.current[name];
      const at = BARS_START + index * BAR_STAGGER;

      if (barEl) {
        gsap.set(barEl, { scaleY: 0 });
        tl.to(barEl, { scaleY: 1, duration: BAR_DURATION, ease: `back.out(${ (1 + weight * 2.2).toFixed(2) })` }, at);
      }
      if (countEl) {
        gsap.set(countEl, { opacity: 0, scale: .5 });
        tl.to(countEl, { opacity: 1, scale: 1, duration: .4, ease: `back.out(${ (1 + weight * 1.6).toFixed(2) })` }, at + .04);
      }
    });

    const statsStart = BARS_START + paletteNames.length * BAR_STAGGER + .3;
    statLevelRef.current = 0;
    const levelState = { v: 0 };
    tl.to(levelState, {
      v: starredRatio,
      duration: .6,
      ease: "power2.out",
      onUpdate: () => { statLevelRef.current = levelState.v; },
    }, statsStart);
    if (statBigRef.current) {
      gsap.set(statBigRef.current, { opacity: 0, scale: .5, y: 6 });
      tl.to(statBigRef.current, { opacity: 1, scale: 1, y: 0, duration: .5, ease: "back.out(1.7)" }, statsStart + .05);
    }

    return () => tl.kill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The Starred stat's liquid canvas — its own small raw-WebGL setup,
  // gated on the SAME open state as the GSAP effect above (this content
  // fully unmounts on close, so the canvas node itself, not just its
  // context, has to be rebuilt each reopen — there's no persistent
  // canvas to keep a context alive across closes the way TrashPhysics's
  // document.body-portaled one can). Skipped entirely under reduced
  // motion, same restraint ThemeWipe's own capability check applies.
  useEffect(() => {
    if (!open || reduceMotion) return;

    const canvas = statCanvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) return;

    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };
    const vertex = compile(gl.VERTEX_SHADER, LIQUID_VERT);
    const fragment = compile(gl.FRAGMENT_SHADER, LIQUID_FRAG);
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
      resolution: gl.getUniformLocation(program, "uResolution"),
      level: gl.getUniformLocation(program, "uLevel"),
      time: gl.getUniformLocation(program, "uTime"),
      color: gl.getUniformLocation(program, "uColor"),
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener("resize", resize);

    // Resolved once at setup rather than tracked live — this panel is a
    // short-lived modal, not something left open across a theme toggle,
    // so re-resolving every reopen (it does, since this whole effect
    // reruns each open) is enough to stay in sync without a live
    // observer for the rare mid-session flip.
    const rgb = hexToUnit(resolveCssColor("var(--page-ink-color)"));
    gl.uniform3f(uniforms.color, rgb[0], rgb[1], rgb[2]);

    const start = performance.now();
    let raf = requestAnimationFrame(draw);

    function draw() {
      raf = requestAnimationFrame(draw);
      gl.uniform1f(uniforms.level, statLevelRef.current);
      gl.uniform1f(uniforms.time, (performance.now() - start) / 1000);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.deleteBuffer(buffer);
    };
  }, [open, reduceMotion]);

  // The color bars' coupled-spring wave — runs continuously while open
  // (the same "no idle-sleep, just run for as long as it's mounted"
  // choice TrashPhysics's own tick loop already makes) rather than
  // waking only around an impulse, since six bars' worth of spring math
  // is cheap enough that the simplicity is worth more than the cycles
  // saved. paletteNames.length, not paletteNames itself, in the deps —
  // the array is a fresh reference every render even though its actual
  // contents never change, and depending on the reference would restart
  // this simulation on every single render instead of once per open.
  useEffect(() => {
    if (!open || reduceMotion) return;

    waveStateRef.current = paletteNames.map(() => ({ pos: 0, vel: 0 }));

    let raf = requestAnimationFrame(tick);
    let last = performance.now();

    function tick(now) {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(1 / 30, (now - last) / 1000);
      last = now;

      const states = waveStateRef.current;
      const n = states.length;

      // Forces first, off last frame's positions throughout, THEN
      // integrate — updating pos in the same pass would let an earlier
      // bar's already-moved position leak into a later bar's coupling
      // force this same frame, biasing the wave toward one direction.
      for (let i = 0; i < n; i++) {
        const s = states[i];
        const left = i > 0 ? states[i - 1].pos : s.pos;
        const right = i < n - 1 ? states[i + 1].pos : s.pos;
        const coupling = WAVE_COUPLING * (left - s.pos + (right - s.pos));
        const spring = -WAVE_STIFFNESS * s.pos;
        s.vel += (spring + coupling - WAVE_DAMPING * s.vel) * dt;
      }
      for (let i = 0; i < n; i++) {
        states[i].pos += states[i].vel * dt;
      }

      paletteNames.forEach((name, index) => {
        const el = waveRefs.current[name];
        const s = states[index];
        if (!el || !s) return;
        el.style.transform = `translateX(${ s.pos.toFixed(2) }px) rotate(${ (s.vel * WAVE_ROTATE_FROM_VEL).toFixed(2) }deg)`;
      });
    }

    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reduceMotion, paletteNames.length]);

  // A hover or a pick sends a real velocity kick into that bar's own
  // spring — plain ref mutation, not state, since applyWaveImpulse fires
  // on fast pointer events that have no business triggering a re-render.
  const applyWaveImpulse = (index) => {
    const state = waveStateRef.current[index];
    if (state) state.vel += WAVE_IMPULSE;
  };

  // Scrub the trend chart like a stock chart: for a mouse, plain
  // pointermove already only fires while the cursor is actually over the
  // container, so hovering alone scrubs; for touch, pointermove only
  // fires during real contact, so the same handler naturally requires a
  // drag there instead — one handler, the right behavior for each input
  // without branching on pointer type.
  const handleTrendScrub = (e) => {
    if (!trendPoints.length) return;
    const rect = trendRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;

    const localX = ((e.clientX - rect.left) / rect.width) * TREND_W;
    let nearest = 0;
    let best = Infinity;
    trendPoints.forEach((point, index) => {
      const d = Math.abs(point.x - localX);
      if (d < best) { best = d; nearest = index; }
    });
    setScrubIndex(nearest);
  };

  const handleTrendRelease = () => setScrubIndex(null);

  return (
    <SheetPanel
      open={ open }
      onClose={ () => setOpen(false) }
      panelRef={ panelRef }
      radius={ 22 }
      layerClassName="insights-layer"
      backdropClassName="insights-backdrop"
      panelClassName="insights-panel"
      ariaLabel="Desk insights"
    >
              <div className="insights-header">
                <h3>Desk insights</h3>
                <motion.button
                  type="button"
                  aria-label="Close"
                  className="insights-close"
                  whileHover={{ scale: 1.15, rotate: 90 }}
                  whileTap={{ scale: .9 }}
                  transition={{ type: "spring", stiffness: 420, damping: 16 }}
                  onClick={ () => setOpen(false) }
                >
                  <FaXmark />
                </motion.button>
              </div>

              <div className="insights-body">
                <section className="insights-section">
                  <h4>Notes by day</h4>
                  {
                    days?.length > 0 ? (
                      <>
                        <div
                          className="insights-trend"
                          ref={ trendRef }
                          onPointerDown={ handleTrendScrub }
                          onPointerMove={ handleTrendScrub }
                          onPointerUp={ handleTrendRelease }
                          onPointerCancel={ handleTrendRelease }
                          onPointerLeave={ handleTrendRelease }
                        >
                          <svg
                            className="insights-trend-svg"
                            viewBox={ `0 0 ${ TREND_W } ${ TREND_H }` }
                            preserveAspectRatio="none"
                            aria-hidden="true"
                          >
                            <defs>
                              <linearGradient id="insights-trend-fill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="var(--page-ink-color)" stopOpacity=".28" />
                                <stop offset="100%" stopColor="var(--page-ink-color)" stopOpacity="0" />
                              </linearGradient>
                              {/* The liquid reveal (see the mount effect above) — a
                                  clip rect whose own `y` rises from the baseline to
                                  cover the whole viewBox, so the area fill reads as
                                  rising to meet the line rather than fading in. */}
                              <clipPath id="insights-trend-reveal">
                                <rect ref={ trendRevealRef } x="0" y={ TREND_BASELINE } width={ TREND_W } height={ REVEAL_TALL } />
                              </clipPath>
                            </defs>
                            <path
                              className="insights-trend-area"
                              d={ trendAreaPath }
                              clipPath="url(#insights-trend-reveal)"
                            />
                            <path
                              ref={ trendLineRef }
                              className="insights-trend-line"
                              d={ trendLinePath }
                            />
                            {
                              trendLastPoint && (
                                <motion.circle
                                  className="insights-trend-marker"
                                  cx={ trendLastPoint.x }
                                  cy={ trendLastPoint.y }
                                  r="3.2"
                                  initial={{ scale: 0 }}
                                  animate={{ scale: [0, 1.5, 1, 1.25, 1] }}
                                  transition={{ duration: 1.2, times: [0, .3, .5, .8, 1], delay: MARKER_POP_DELAY, repeat: Infinity, repeatDelay: 1.6 }}
                                />
                              )
                            }
                            {/* The scrub gesture's own reticle (see handleTrendScrub)
                                — aria-hidden since every day it can land on is already
                                reachable, and announced, through the point buttons
                                below. */}
                            {
                              scrubIndex !== null && trendPoints[scrubIndex] && (
                                <g aria-hidden="true">
                                  <line
                                    className="insights-trend-reticle"
                                    x1={ trendPoints[scrubIndex].x }
                                    y1="0"
                                    x2={ trendPoints[scrubIndex].x }
                                    y2={ TREND_H }
                                  />
                                  <circle
                                    className="insights-trend-scrub-marker"
                                    cx={ trendPoints[scrubIndex].x }
                                    cy={ trendPoints[scrubIndex].y }
                                    r="4.5"
                                  />
                                </g>
                              )
                            }
                          </svg>
                          {
                            trendPoints.map((point, index) => (
                              <button
                                key={ days[index].label }
                                type="button"
                                className="insights-trend-point"
                                style={{ left: `${ (point.x / TREND_W) * 100 }%`, top: `${ (point.y / TREND_H) * 100 }%` }}
                                aria-label={ `${ days[index].count } ${ days[index].count === 1 ? "note" : "notes" } on ${ days[index].label }` }
                              >
                                <span className="insights-tooltip">
                                  { days[index].count } { days[index].count === 1 ? "note" : "notes" } · { days[index].label }
                                </span>
                              </button>
                            ))
                          }
                          {
                            scrubIndex !== null && days[scrubIndex] && (
                              <div
                                className="insights-trend-scrub-tooltip"
                                aria-hidden="true"
                                style={{
                                  left: `${ (trendPoints[scrubIndex].x / TREND_W) * 100 }%`,
                                  top: `${ (trendPoints[scrubIndex].y / TREND_H) * 100 }%`,
                                }}
                              >
                                { days[scrubIndex].count } { days[scrubIndex].count === 1 ? "note" : "notes" } · { days[scrubIndex].label }
                              </div>
                            )
                          }
                        </div>
                        <div className="insights-trend-labels">
                          {
                            days.map((day) => (
                              <span key={ day.label } className="insights-bar-label">
                                { day.label.replace(/, \d{4}$/, "") }
                              </span>
                            ))
                          }
                        </div>
                      </>
                    ) : (
                      <p className="insights-empty">No notes on the desk yet.</p>
                    )
                  }
                </section>

                <section className="insights-section">
                  <h4>Notes by color</h4>
                  <div className="insights-bars">
                    {
                      paletteNames.map((name, index) => {
                        const count = colorCounts?.[name] ?? 0;
                        const label = `${ count } ${ name } ${ count === 1 ? "note" : "notes" }`;

                        return (
                          <button
                            key={ name }
                            type="button"
                            title={ label }
                            aria-label={
                              sortColor === name
                                ? `${ label } — showing only these; press to show every color`
                                : `${ label } — press to show only these`
                            }
                            aria-pressed={ sortColor === name }
                            className={ `insights-bar-column insights-bar-button ${ sortColor === name ? "active" : "" }` }
                            onMouseEnter={ () => applyWaveImpulse(index) }
                            onClick={ () => {
                              setSortColor?.(sortColor === name ? null : name);
                              applyWaveImpulse(index);
                            } }
                          >
                            <span className="insights-tooltip">{ label }</span>
                            <span
                              ref={ (el) => { countRefs.current[name] = el; } }
                              className="insights-bar-count"
                            >
                              { count }
                            </span>
                            {/* The wave's own wrapper (see applyWaveImpulse and the
                                simulation effect above) — a separate node from
                                .insights-bar itself, which the GSAP entrance already
                                scales on its own transform; this one only ever
                                carries the spring's translateX/rotate. */}
                            <span
                              ref={ (el) => { waveRefs.current[name] = el; } }
                              className="insights-bar-wave"
                            >
                              <span
                                ref={ (el) => { barRefs.current[name] = el; } }
                                className={ `insights-bar ${ name }-bg` }
                                style={{ height: 8 + Math.round((count / maxColorCount) * 70) }}
                              />
                            </span>
                            <span className="insights-bar-label">{ name }</span>
                          </button>
                        );
                      })
                    }
                  </div>
                </section>

                <section className="insights-stats">
                  <div className="insights-stat">
                    <span className="insights-stat-label">Starred</span>
                    <div className="insights-stat-track">
                      {/* Always present and always correct — the WebGL
                          canvas below is a pure enhancement layered on
                          top of it. If that canvas can't get a context,
                          or reduced motion skips it entirely, this is
                          what's actually visible. */}
                      <div className="insights-stat-fill" style={{ width: `${ starredRatio * 100 }%` }} />
                      {
                        !reduceMotion && <canvas ref={ statCanvasRef } className="insights-stat-liquid" />
                      }
                    </div>
                    <span className="insights-stat-value">{ favoriteCount } / { totalCount }</span>
                  </div>
                  <div className="insights-stat">
                    <span className="insights-stat-label">Average length</span>
                    <span ref={ statBigRef } className="insights-stat-big">
                      { avgChars }
                    </span>
                    <span className="insights-stat-value">characters / note</span>
                  </div>
                </section>
              </div>
    </SheetPanel>
  );
};

export default InsightsPanel;
