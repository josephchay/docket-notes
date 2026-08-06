import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import * as THREE from "three";
import { FaPlay, FaPause, FaMusic } from "react-icons/fa6";

import { NOTE_COLORS } from "../../constants/colors";
import { poly6Coeff, poly6, spikyGradCoeff, spikyGrad, viscLapCoeff, viscLap, particleMassFor } from "../../utils/sph";
import { SNAPPY } from "../Motion";

import "./FluidVisualizer.css";

THREE.ColorManagement.enabled = false;

// A real SPH fluid — the exact same physics as FluidField.jsx (same
// kernels, from utils/sph.js; same REST_DENSITY/STIFFNESS/VISCOSITY/
// SPACING/SMOOTHING_RADIUS/SUBSTEPS, copied verbatim rather than
// re-tuned) — settled into a shallow pool instead of a one-time dam break,
// disturbed from below by real geysers whose strength comes straight from
// a chosen audio file's own frequency spectrum (Web Audio's AnalyserNode,
// real FFT magnitude data, not anything reimplemented here). Frequency-
// domain rather than AudioWaveString.jsx's own time-domain choice, and for
// a different, equally real reason: that file needed a genuinely two-sided
// signal to wave a string both up and down; this one needs the spectrum's
// own per-band decomposition to place bass/mid/treble at different
// positions across the pool — a single time-domain sample stream carries
// no such spatial information, only a real frequency analysis does.
const REST_DENSITY = 1000;
const STIFFNESS = 1200;
const VISCOSITY = 200;
const GRAVITY = 30;
const SPACING = 1.15;
const SMOOTHING_RADIUS = 1.6 * SPACING;
const SUBSTEPS = 3;
const VELOCITY_CLAMP = 40;
const BOUNDARY_RESTITUTION = 0.45;
const PARTICLE_MASS = particleMassFor(REST_DENSITY, SPACING);

// A wide, short "pool" rather than FluidField's tall dam-break box — most
// of the domain's height stays open above the resting fluid so audio-driven
// splashes have real room to arc up into before gravity pulls them back.
const NX = 26;
const NY = 5;
const PARTICLE_COUNT = NX * NY;
const DOMAIN_W = 34;
const DOMAIN_H = 20;
const POOL_MARGIN_X = (DOMAIN_W - (NX - 1) * SPACING) / 2;
const POOL_BASE_Y = 0.6;

const CURSOR_RADIUS = 3.2;
const CURSOR_STRENGTH = 900;

// Real octave-band-style frequency injectors along the pool floor — each
// covers a geometrically (not linearly) spaced range of FFT bins, the same
// log-spacing real spectrum analyzers use to give bass and treble
// comparably-sized bands despite the FFT's own bins being linearly spaced
// in frequency. Verified the same way as every other geometric-interpolation
// mapping this session (TagThreads.jsx's catenary, ParticleCuboid.jsx's
// palette-by-lattice-position): at i=0 the formula gives exactly MIN_BIN,
// at i=INJECTOR_COUNT it gives exactly MAX_BIN, with every step in between
// multiplying by the same ratio.
const AUDIO_FFT_SIZE = 2048;
const MIN_BIN = 2;
const MAX_BIN = 500;
const INJECTOR_COUNT = 18;
// Only particles still near the floor feel a geyser — a real underwater
// jet acts on the body of fluid it's actually submerged in, not on
// droplets already airborne from an earlier splash.
const INJECTOR_ACTIVATION_HEIGHT = 3.4;
// Tuning, not physics — same honest caveat as FluidField.jsx's own: exactly
// how energetic a given spectrum magnitude ends up looking depends on how
// it interacts with STIFFNESS/VISCOSITY/GRAVITY together, which isn't
// something that reduces to one hand-checkable number. VELOCITY_CLAMP
// above (already part of the existing integrator, not something added new
// for this) is what actually keeps this bounded regardless of exactly how
// this is tuned.
const JET_FORCE_SCALE = 5200;

const VERT = `
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`;

// The same multi-color field-weighted metaball blend ParticleCuboid.jsx's
// own shader uses (see that file's own comment on why this is the
// physically apt rendering choice for an implicit density field, not
// merely a reused convenience) — genuinely fitting doubly so here, since
// SPH already represents this fluid as an implicit density field in the
// first place.
const FRAG = `
  precision highp float;

  uniform vec2 uResolution;
  uniform float uDpr;
  uniform vec3 uBalls[${ PARTICLE_COUNT }];
  uniform vec3 uBallColors[${ PARTICLE_COUNT }];
  uniform vec3 uRim;
  uniform vec3 uBg;

  void main() {
    vec2 p = gl_FragCoord.xy / uDpr;
    p.y = uResolution.y - p.y;

    float field = 0.0;
    vec3 colorSum = vec3(0.0);
    for (int i = 0; i < ${ PARTICLE_COUNT }; i++) {
      vec3 b = uBalls[i];
      vec2 d = p - b.xy;
      float contribution = exp(-dot(d, d) / (b.z * b.z));
      field += contribution;
      colorSum += uBallColors[i] * contribution;
    }

    vec3 blended = field > 0.0001 ? colorSum / field : uRim;
    float body = smoothstep(0.5, 0.56, field);
    float rim = smoothstep(0.5, 0.6, field) * (1.0 - smoothstep(0.6, 1.05, field));
    vec3 col = mix(blended, uRim, rim * 0.5);

    if (body < 0.01) discard;
    gl_FragColor = vec4(mix(uBg, col, body), 1.0);
  }
`;

const formatTime = (t) => {
  if (!Number.isFinite(t) || t < 0) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60).toString().padStart(2, "0");
  return `${ m }:${ s }`;
};

const FluidVisualizer = ({ reduceMotion = false }) => {
  const canvasRef = useRef(null);
  const audioRef = useRef(null);
  const fileInputRef = useRef(null);
  const objectUrlRef = useRef(null);
  // Same reason as AudioWaveString.jsx's own audioCtxRef: the gesture
  // handlers below (file pick, play button) live outside the mount
  // effect's closure and need to call resume() on the real AudioContext
  // instance it created — see that file's comment for why resume() is
  // necessary and not implied by audioEl.play() alone.
  const audioCtxRef = useRef(null);
  // Everything the physics tick loop itself needs from the audio graph —
  // see AudioWaveString.jsx's own audioGraphRef for the full reasoning.
  // Populated lazily by ensureAudioGraph() below, read by the tick loop
  // each frame via this ref rather than a value closed over at mount time.
  const audioGraphRef = useRef(null);
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

  const [trackName, setTrackName] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  // Builds the Web Audio graph at most once per component instance, guarded
  // by audioCtxRef itself — see AudioWaveString.jsx's own ensureAudioGraph
  // for the full reasoning on why this can't live in the mount effect
  // below: createMediaElementSource may only be called once per <audio>
  // element ever, and React StrictMode's development-only double-invoke of
  // every effect would throw on the synthetic second mount if this ran
  // there — silently swallowed by the try/catch, leaving the graph null on
  // the real mount, while the first (orphaned) call has already
  // permanently rerouted the element's native output into its own
  // now-closed AudioContext. Calling this from a real user gesture instead
  // (handleFileChange below) means createMediaElementSource only ever
  // genuinely runs once, since React never double-invokes event handlers
  // the way it does effects.
  const ensureAudioGraph = () => {
    if (audioCtxRef.current) return;

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      const audioCtx = new AudioCtx();
      const source = audioCtx.createMediaElementSource(audioRef.current);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = AUDIO_FFT_SIZE;
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
      const freqData = new Uint8Array(analyser.frequencyBinCount);

      const bandEdges = new Array(INJECTOR_COUNT + 1);
      for (let i = 0; i <= INJECTOR_COUNT; i++) {
        bandEdges[i] = Math.round(MIN_BIN * (MAX_BIN / MIN_BIN) ** (i / INJECTOR_COUNT));
      }

      audioCtxRef.current = audioCtx;
      audioGraphRef.current = { analyser, freqData, bandEdges };
    } catch (err) {
      // Web Audio unavailable, blocked, or createMediaElementSource
      // rejected for some other reason — audioGraphRef stays null (the
      // tick loop already checks for that before reading it), but this is
      // logged rather than silently swallowed: a silent catch here was
      // exactly what hid the real StrictMode double-invoke bug during the
      // last round of debugging, and if something is still going wrong,
      // this is the one place in the file most likely to be why.
      console.error("FluidVisualizer: failed to set up the Web Audio graph", err);
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const audioEl = audioRef.current;
    const parent = canvas.parentElement;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);

    const scene = new THREE.Scene();
    const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const dims = { w: 480, h: 320 };
    const resize = () => {
      dims.w = parent.clientWidth || 480;
      dims.h = parent.clientHeight || 320;
      renderer.setSize(dims.w, dims.h, false);
      uniforms.uResolution.value.set(dims.w, dims.h);
    };

    const palette = Object.values(NOTE_COLORS).map((hex) => new THREE.Color(hex));

    const uniforms = {
      uResolution: { value: new THREE.Vector2(dims.w, dims.h) },
      uDpr: { value: dpr },
      uBalls: { value: Array.from({ length: PARTICLE_COUNT }, () => new THREE.Vector3()) },
      uBallColors: { value: Array.from({ length: PARTICLE_COUNT }, () => new THREE.Color()) },
      uRim: { value: new THREE.Color("#fffeff") },
      uBg: { value: new THREE.Color("#fffeff") },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: false,
      depthTest: false,
      depthWrite: false,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(quad);

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(parent);

    const retint = () => {
      const style = getComputedStyle(document.documentElement);
      const bg = style.getPropertyValue("--page-bg-color").trim() || "#fffeff";
      uniforms.uRim.value.set(bg);
      uniforms.uBg.value.set(bg);
    };
    retint();
    const themeObserver = new MutationObserver(retint);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    // The resting pool: a wide, shallow rectangle near the domain floor.
    const particles = [];
    for (let ix = 0; ix < NX; ix++) {
      for (let iy = 0; iy < NY; iy++) {
        particles.push({
          pos: new THREE.Vector2(POOL_MARGIN_X + ix * SPACING, POOL_BASE_Y + iy * SPACING),
          vel: new THREE.Vector2(0, 0),
          density: REST_DENSITY,
          pressure: 0,
          force: new THREE.Vector2(),
        });
      }
    }

    const poly6C = poly6Coeff(SMOOTHING_RADIUS);
    const spikyC = spikyGradCoeff(SMOOTHING_RADIUS);
    const viscC = viscLapCoeff(SMOOTHING_RADIUS);
    const selfDensity = PARTICLE_MASS * poly6(0, SMOOTHING_RADIUS, poly6C);

    const delta = new THREE.Vector2();

    // One normalized (0..1) magnitude per injector band, recomputed once
    // per animation frame (not per substep — the underlying audio signal
    // is oversampled far beyond one frame's worth of substeps anyway,
    // exactly the same reasoning AudioWaveString.jsx's own comment gives
    // for holding its forcing constant across a frame's substeps). Always
    // allocated regardless of whether the audio graph exists yet — it
    // simply stays all-zero (Float32Array's own default) until
    // ensureAudioGraph() has run and tick() starts actually populating it,
    // so step() below can read it unconditionally without its own
    // separate null check.
    const bandMagnitude = new Float32Array(INJECTOR_COUNT);

    const step = (dt) => {
      for (const p of particles) p.density = selfDensity;

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i], b = particles[j];
          delta.copy(b.pos).sub(a.pos);
          const r = delta.length();
          if (r >= SMOOTHING_RADIUS) continue;

          const w = poly6(r, SMOOTHING_RADIUS, poly6C);
          a.density += PARTICLE_MASS * w;
          b.density += PARTICLE_MASS * w;
        }
      }

      for (const p of particles) {
        p.pressure = Math.max(0, STIFFNESS * (p.density - REST_DENSITY));
        p.force.set(0, 0);
      }

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i], b = particles[j];
          delta.copy(b.pos).sub(a.pos);
          const r = delta.length();
          if (r >= SMOOTHING_RADIUS || r <= 0.0001) continue;

          const dirX = delta.x / r, dirY = delta.y / r;

          const gradMag = spikyGrad(r, SMOOTHING_RADIUS, spikyC);
          const pressureTerm = -PARTICLE_MASS * (a.pressure + b.pressure) / (2 * b.density) * gradMag;
          const pfx = -dirX * pressureTerm;
          const pfy = -dirY * pressureTerm;
          a.force.x += pfx; a.force.y += pfy;
          b.force.x -= pfx; b.force.y -= pfy;

          const lap = viscLap(r, SMOOTHING_RADIUS, viscC);
          const viscTerm = VISCOSITY * PARTICLE_MASS * lap / b.density;
          const vfx = (b.vel.x - a.vel.x) * viscTerm;
          const vfy = (b.vel.y - a.vel.y) * viscTerm;
          a.force.x += vfx; a.force.y += vfy;
          b.force.x -= vfx; b.force.y -= vfy;
        }
      }

      for (const p of particles) {
        let ax = p.force.x / p.density;
        let ay = p.force.y / p.density - GRAVITY;

        if (cursor.active) {
          const cdx = p.pos.x - cursor.x;
          const cdy = p.pos.y - cursor.y;
          const cdist = Math.max(0.15, Math.hypot(cdx, cdy));
          if (cdist < CURSOR_RADIUS) {
            const push = (CURSOR_STRENGTH * (1 + cursor.speedBoost)) / (cdist * cdist) * (1 - cdist / CURSOR_RADIUS);
            ax += (cdx / cdist) * push;
            ay += (cdy / cdist) * push;
          }
        }

        // The audio-driven geyser — this particle's own current x decides
        // which injector band it's standing over (particles drift between
        // bands as they move, which is correct: the jet is a fixed
        // position in the pool, not something tied to a particle's
        // identity), and only fires if it's still near the floor. No
        // separate "does the audio graph even exist yet" check needed
        // here — bandMagnitude is always a real, safely-readable array
        // (see its own declaration above), just all zeros until
        // ensureAudioGraph() has run and tick() starts populating it.
        if (p.pos.y < INJECTOR_ACTIVATION_HEIGHT) {
          const bandIndex = Math.max(0, Math.min(INJECTOR_COUNT - 1, Math.floor((p.pos.x / DOMAIN_W) * INJECTOR_COUNT)));
          ay += bandMagnitude[bandIndex] * JET_FORCE_SCALE;
        }

        p.vel.x += ax * dt;
        p.vel.y += ay * dt;

        const speed = p.vel.length();
        if (speed > VELOCITY_CLAMP) p.vel.multiplyScalar(VELOCITY_CLAMP / speed);

        p.pos.x += p.vel.x * dt;
        p.pos.y += p.vel.y * dt;

        if (p.pos.x < 0) { p.pos.x = 0; p.vel.x = -p.vel.x * BOUNDARY_RESTITUTION; }
        else if (p.pos.x > DOMAIN_W) { p.pos.x = DOMAIN_W; p.vel.x = -p.vel.x * BOUNDARY_RESTITUTION; }
        if (p.pos.y < 0) { p.pos.y = 0; p.vel.y = -p.vel.y * BOUNDARY_RESTITUTION; }
        else if (p.pos.y > DOMAIN_H) { p.pos.y = DOMAIN_H; p.vel.y = -p.vel.y * BOUNDARY_RESTITUTION; }
      }
    };

    const cursor = { x: 0, y: 0, active: false, speedBoost: 0 };
    const prevCursor = { x: 0, y: 0, time: performance.now() };

    const simFromEvent = (e) => {
      const rect = canvas.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width;
      const ny = (e.clientY - rect.top) / rect.height;
      return { x: nx * DOMAIN_W, y: (1 - ny) * DOMAIN_H };
    };

    const handlePointerMove = (e) => {
      if (reduceMotionRef.current) return;
      const now = performance.now();
      const { x, y } = simFromEvent(e);
      const dt = Math.max(0.001, (now - prevCursor.time) / 1000);
      const speed = Math.hypot(x - prevCursor.x, y - prevCursor.y) / dt;
      cursor.x = x; cursor.y = y; cursor.active = true;
      cursor.speedBoost = Math.min(3, speed * 0.05);
      prevCursor.x = x; prevCursor.y = y; prevCursor.time = now;
    };
    const handlePointerLeave = () => { cursor.active = false; };
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerleave", handlePointerLeave);

    let lastTime = performance.now();
    let raf = null;

    const tick = () => {
      raf = requestAnimationFrame(tick);

      const now = performance.now();
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const graph = audioGraphRef.current;
      if (graph) {
        graph.analyser.getByteFrequencyData(graph.freqData);
        for (let i = 0; i < INJECTOR_COUNT; i++) {
          const lo = graph.bandEdges[i];
          const hi = Math.max(lo + 1, graph.bandEdges[i + 1]);
          let sum = 0;
          for (let bin = lo; bin < hi; bin++) sum += graph.freqData[bin];
          bandMagnitude[i] = (sum / (hi - lo)) / 255;
        }
      }

      if (!reduceMotionRef.current) {
        const subDt = dt / SUBSTEPS;
        for (let s = 0; s < SUBSTEPS; s++) step(subDt);
      }

      const scaleX = dims.w / DOMAIN_W;
      const scaleY = dims.h / DOMAIN_H;
      const renderScale = Math.min(scaleX, scaleY);
      const renderRadius = SMOOTHING_RADIUS * 0.9 * renderScale;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i].pos;
        const px = p.x * scaleX;
        const py = dims.h - p.y * scaleY;
        uniforms.uBalls.value[i].set(px, py, renderRadius);

        // Color follows each particle's own current injector band — the
        // same spatial mapping driving the physics also drives what's
        // shown, rather than a separate decorative gradient laid on top.
        const bandIndex = Math.max(0, Math.min(INJECTOR_COUNT - 1, Math.floor((p.x / DOMAIN_W) * INJECTOR_COUNT)));
        const paletteT = (bandIndex / (INJECTOR_COUNT - 1)) * (palette.length - 1);
        const lo = Math.floor(paletteT), hi = Math.min(palette.length - 1, lo + 1);
        uniforms.uBallColors.value[i].copy(palette[lo]).lerp(palette[hi], paletteT - lo);
      }

      renderer.render(scene, quadCamera);
    };

    const handleVisibility = () => {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = null;
      } else if (!raf) {
        lastTime = performance.now();
        tick();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    tick();

    // Transport wiring — plain DOM events on the <audio> element, the same
    // safe pattern AudioWaveString.jsx already uses (React state mirrors
    // the element's own events; it never drives playback directly).
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => setIsPlaying(false);
    const handleLoadedMetadata = () => setDuration(audioEl.duration || 0);
    const handleTimeUpdate = () => setCurrentTime(audioEl.currentTime || 0);
    audioEl.addEventListener("play", handlePlay);
    audioEl.addEventListener("pause", handlePause);
    audioEl.addEventListener("ended", handleEnded);
    audioEl.addEventListener("loadedmetadata", handleLoadedMetadata);
    audioEl.addEventListener("timeupdate", handleTimeUpdate);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", handleVisibility);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
      audioEl.removeEventListener("play", handlePlay);
      audioEl.removeEventListener("pause", handlePause);
      audioEl.removeEventListener("ended", handleEnded);
      audioEl.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audioEl.removeEventListener("timeupdate", handleTimeUpdate);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      quad.geometry.dispose();
      material.dispose();
      renderer.dispose();
      audioEl.pause();
      audioEl.removeAttribute("src");
      audioEl.load();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      // Reads the ref's own current value at cleanup time — not a value
      // closed over from setup — since ensureAudioGraph() may have created
      // this well after this effect's own setup ran (or never, if no file
      // was ever chosen, in which case this is simply a no-op).
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
      audioGraphRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChooseFile = () => fileInputRef.current?.click();

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    ensureAudioGraph();

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;

    const audioEl = audioRef.current;
    audioEl.src = url;
    setTrackName(file.name.replace(/\.[^/.]+$/, ""));

    // See AudioWaveString.jsx's own comment on why resume() matters here,
    // not just play(), and why it's properly sequenced (not fired in
    // parallel) and its rejection actually logged now rather than silently
    // swallowed.
    Promise.resolve(audioCtxRef.current?.resume())
      .then(() => audioEl.play())
      .catch((err) => console.error("FluidVisualizer: playback failed to start", err));
  };

  const togglePlay = () => {
    const audioEl = audioRef.current;
    if (!audioEl.src) { handleChooseFile(); return; }
    if (isPlaying) {
      audioEl.pause();
    } else {
      Promise.resolve(audioCtxRef.current?.resume())
        .then(() => audioEl.play())
        .catch((err) => console.error("FluidVisualizer: playback failed to start", err));
    }
  };

  const handleSeek = (e) => {
    const value = Number(e.target.value);
    audioRef.current.currentTime = value;
    setCurrentTime(value);
  };

  return (
    <div className="fluid-visualizer">
      <audio ref={ audioRef } preload="metadata" />
      <input
        ref={ fileInputRef }
        type="file"
        accept="audio/*"
        hidden
        onChange={ handleFileChange }
      />

      <div className="fluid-visualizer-canvas-wrap">
        <canvas ref={ canvasRef } className="fluid-visualizer-canvas" aria-hidden="true" />
        {
          !trackName && (
            <button type="button" className="fluid-visualizer-empty" onClick={ handleChooseFile }>
              <FaMusic />
              Choose a song to fill the pool
            </button>
          )
        }
      </div>

      <div className="fluid-visualizer-transport">
        <motion.button
          type="button"
          className="fluid-visualizer-play"
          aria-label={ isPlaying ? "Pause" : "Play" }
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: .92 }}
          transition={ SNAPPY }
          onClick={ togglePlay }
        >
          { isPlaying ? <FaPause /> : <FaPlay /> }
        </motion.button>

        <span className="fluid-visualizer-time">{ formatTime(currentTime) }</span>
        <input
          type="range"
          className="fluid-visualizer-seek"
          min={ 0 }
          max={ duration || 0 }
          step={ 0.01 }
          value={ currentTime }
          onChange={ handleSeek }
          aria-label="Seek"
        />
        <span className="fluid-visualizer-time">{ formatTime(duration) }</span>

        <button type="button" className="fluid-visualizer-choose" onClick={ handleChooseFile }>
          <FaMusic />
          { trackName || "Choose a song" }
        </button>
      </div>
    </div>
  );
};

export default FluidVisualizer;
