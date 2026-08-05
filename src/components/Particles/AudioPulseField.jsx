import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { FaMusic, FaPause, FaPlay } from "react-icons/fa6";

import { NOTE_COLORS } from "../../constants/colors";

import "./AudioPulseField.css";

THREE.ColorManagement.enabled = false;

// A local audio file only — chosen by the visitor from their own device via
// a plain <input type="file">, played back through a real <audio> element.
// Nothing is fetched, bundled, or streamed from anywhere; the Web Audio
// graph below (MediaElementSource → AnalyserNode → destination) is the
// standard way to both hear a file and read its live spectrum at the same
// time, not a workaround.
const FFT_SIZE = 1024;
const BIN_COUNT = FFT_SIZE / 2; // AnalyserNode.frequencyBinCount, deterministic from fftSize alone
const SMOOTHING = 0.75; // AnalyserNode's own built-in exponential smoothing between frames — real, browser-implemented, not hand-rolled here

const PARTICLE_COUNT = 64;
const BASE_RADIUS = 3;
const MAX_RADIUS_ADD = 4.5;
const VIEW_EXTENT = 10.5;

// Each particle sits on its own damped radial spring, ω = √(k/m) with m = 1
// → ω = √55 ≈ 7.42 rad/s, ω·dt ≈ 0.12 at 60fps — ~16× under the ω·dt < 2
// stability bound, so no substeps are needed (unlike the N-body/SPH sims,
// every particle here is independent — there's no O(n²) coupling that could
// itself go unstable). Damping ratio ζ = c/(2√(k·m)) = 13.5/14.83 ≈ 0.91,
// just under critical: radius tracks a rapidly-changing FFT target cleanly
// (no runaway ringing on top of already-noisy audio data) while still
// leaving enough underdamped response for a beat impulse to read as a
// genuine outward "pulse" rather than an instant snap.
const SPRING_K = 55;
const SPRING_DAMPING = 13.5;

// A beat is a velocity kick into that same spring, not a new target radius
// — the outward swing and the spring's own pull-back is what makes it read
// as a pulse. Peak displacement from an impulse v0 into a near-critically-
// damped oscillator starting at equilibrium is x_peak ≈ v0/(ω·e) (the
// standard critically-damped impulse-response peak). At v0 = 18,
// ω = 7.42 → x_peak ≈ 18/(7.42·2.718) ≈ 0.89 world units — a clearly
// visible jump relative to BASE_RADIUS = 3, without VIEW_EXTENT needing to
// be much larger than the already-generous spectrum range.
const BEAT_IMPULSE = 18;
const BEAT_FLASH_DURATION = 0.35; // seconds, linear decay — drives the center dot + a small brightness/size lift on every particle

// Energy-based onset detection (the "sound energy" technique common to
// simple real-time beat detectors): keep a short rolling history of the
// bass band's average magnitude, and call it a beat when the *current*
// value spikes well above its own recent local average. BEAT_HISTORY_FRAMES
// ≈ 0.7s at 60fps — long enough to average out normal frame-to-frame
// fluctuation, short enough to track a track's own build-ups/drops rather
// than one fixed threshold for the whole song. MIN_BASS_ENERGY is a floor
// underneath that ratio test alone — during near-silence the rolling
// average is itself near zero, so without a floor a tiny fluctuation could
// clear the ratio test trivially.
const BEAT_HISTORY_FRAMES = 42;
const BEAT_THRESHOLD_MULT = 1.35;
const MIN_BASS_ENERGY = 12;
const BEAT_REFRACTORY_MS = 220; // caps false-retrigger rate at ~270bpm, above any real music tempo

const ROTATE_BASE_SPEED = 0.06; // rad/s, always-on ambient drift
const ROTATE_ENERGY_GAIN = 0.5; // additional rad/s at full-scale overall spectrum energy

const IDLE_SPEED = 0.9;
const IDLE_PHASE = 0.35;
const IDLE_AMOUNT = 0.35; // world units — a gentle "still alive" breathing motion before any file is loaded

const CURSOR_POKE_RADIUS = 2.2;
const CURSOR_POKE_STRENGTH = 45; // an acceleration term, the same units as SPRING_K·displacement — comparable in scale, so a poke reads clearly without overwhelming the spectrum shape

const PHYSICS_DT_MAX = 0.05;

// Bass/mid/treble aren't evenly spaced in FFT bin index — 250Hz sits in the
// first handful of *linear* bins while the rest of the spectrum stretches
// across hundreds more. Placing PARTICLE_COUNT particles at *linear* bin
// steps would starve the low end of representation and crowd redundant
// treble detail. Standard fix: sample bin index exponentially, so equal
// steps in particle index correspond to roughly equal fractions of an
// octave (log-frequency), matching how a real spectrum analyzer lays out
// its bars. At i = 0 this is BIN_COUNT^0 = 1 exactly; at the last particle
// it's BIN_COUNT^1 = BIN_COUNT, clamped into [1, BIN_COUNT-1] (bin 0 is the
// DC/0Hz term, not meaningful magnitude). Computed once, module-level — it
// depends only on FFT_SIZE/PARTICLE_COUNT, both fixed constants, never on
// anything read at runtime.
const PARTICLE_BIN_MAP = Array.from({ length: PARTICLE_COUNT }, (_, i) => {
  const bin = Math.floor(Math.pow(BIN_COUNT, i / (PARTICLE_COUNT - 1)));
  return Math.min(BIN_COUNT - 1, Math.max(1, bin));
});

// Same point-sprite technique as GravityField.jsx (gl_PointCoord circular
// falloff, standard alpha blending) — proven there, reused verbatim rather
// than re-derived.
const VERT = `
  attribute float aAlpha;
  attribute float aSize;
  attribute vec3 aColor;

  varying float vAlpha;
  varying vec3 vColor;

  uniform float uPixelRatio;

  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAG = `
  precision mediump float;

  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    float a = smoothstep(0.5, 0.0, d) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

// A ring of particles, one per log-spaced frequency bin, each riding its own
// damped radial spring toward that bin's live magnitude — the silhouette
// traces the actual spectrum in real time, the way a real analyzer bar
// graph does, just polar instead of linear. A genuine energy-threshold beat
// detector (see BEAT_* above) fires a synchronized outward impulse into
// every particle at once on a detected bass hit — a real physical pulse,
// not a scripted animation keyed to nothing. Before any file is loaded, or
// with nothing analyzable yet, the ring idles on a slow shared sine drift
// rather than sitting frozen.
const AudioPulseField = ({ active, reduceMotion = false }) => {
  const canvasRef = useRef(null);
  const audioElRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const freqDataRef = useRef(null);
  const bassBinEndRef = useRef(6);
  const objectUrlRef = useRef(null);
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

  const [fileName, setFileName] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // Lazily builds the Web Audio graph exactly once per <audio> element's
  // lifetime — createMediaElementSource throws if called a second time on
  // the same element, and that element is rendered once, unconditionally,
  // below (not remounted when `active` toggles), so the graph must survive
  // panel close/reopen rather than being torn down and rebuilt with it.
  const ensureAudioGraph = () => {
    if (audioCtxRef.current) return audioCtxRef.current;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx || !audioElRef.current) return null;

    const ctx = new AudioCtx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = SMOOTHING;
    const source = ctx.createMediaElementSource(audioElRef.current);
    source.connect(analyser);
    analyser.connect(ctx.destination);

    // Bin→Hz spacing depends on the real device sample rate (typically
    // 44100 or 48000Hz, not guaranteed), so unlike PARTICLE_BIN_MAP this is
    // computed here, once, against the actual AudioContext rather than
    // assumed.
    const nyquist = ctx.sampleRate / 2;
    const binHz = nyquist / analyser.frequencyBinCount;
    bassBinEndRef.current = Math.max(1, Math.min(analyser.frequencyBinCount - 1, Math.round(250 / binHz)));

    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
    return ctx;
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // A real click on the file input is itself the user gesture browsers
    // require before audio can play — safe to build the graph and resume a
    // suspended context right here.
    ensureAudioGraph();
    audioCtxRef.current?.resume?.();

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;

    const audioEl = audioElRef.current;
    audioEl.src = url;
    audioEl.play().catch(() => {}); // isPlaying itself is driven by the element's own play/pause events below, not this call's outcome
    setFileName(file.name);

    e.target.value = ""; // lets picking the same file again re-fire onChange
  };

  const togglePlay = () => {
    const audioEl = audioElRef.current;
    if (!audioEl?.src) return;
    if (audioEl.paused) {
      audioCtxRef.current?.resume?.();
      audioEl.play().catch(() => {});
    } else {
      audioEl.pause();
    }
  };

  // True unmount-only cleanup — the field component itself stays mounted
  // across panel open/close (see AudioPulseFieldPanel's own comment on that
  // convention), so this rarely fires in practice, but a real AudioContext
  // and object URL still shouldn't leak if it ever does.
  useEffect(() => () => {
    audioCtxRef.current?.close?.();
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  useEffect(() => {
    if (!active) {
      audioElRef.current?.pause();
      return undefined;
    }

    const canvas = canvasRef.current;
    const parent = canvas.parentElement;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-VIEW_EXTENT, VIEW_EXTENT, VIEW_EXTENT, -VIEW_EXTENT, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    const resize = () => {
      const w = parent.clientWidth || 1;
      const h = parent.clientHeight || 1;
      renderer.setSize(w, h, false);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(parent);

    // A 3-stop gradient across the ring — warm at the bass end, through
    // yellow, to cool blue at the treble end — a direct, meaningful mapping
    // (which frequency a particle represents) rather than an arbitrary
    // palette cycle, using only colors already in NOTE_COLORS. Computed once
    // per particle at creation since each particle's position in the ring
    // (and therefore its bin) never changes, only its radius does.
    const colorLow = new THREE.Color(NOTE_COLORS.red);
    const colorMid = new THREE.Color(NOTE_COLORS.yellow);
    const colorHigh = new THREE.Color(NOTE_COLORS.blue);
    const colorAt = (t) => {
      const c = new THREE.Color();
      if (t < 0.5) c.lerpColors(colorLow, colorMid, t / 0.5);
      else c.lerpColors(colorMid, colorHigh, (t - 0.5) / 0.5);
      return c;
    };

    const particles = Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
      radius: BASE_RADIUS,
      radialVel: 0,
      magnitude: 0,
      color: colorAt(i / (PARTICLE_COUNT - 1)),
    }));

    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const alphas = new Float32Array(PARTICLE_COUNT);
    const sizes = new Float32Array(PARTICLE_COUNT);
    const colors = new Float32Array(PARTICLE_COUNT * 3);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: dpr } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    // A single center point that flashes on every detected beat — the
    // "kick" — same shader/material family as the ring, its own tiny
    // geometry (mirrors GravityField.jsx's star-as-separate-Points pattern).
    const kickGeometry = new THREE.BufferGeometry();
    kickGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
    kickGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array([0]), 1));
    kickGeometry.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array([14]), 1));
    const kickColor = new THREE.Color(NOTE_COLORS.orange);
    kickGeometry.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array([kickColor.r, kickColor.g, kickColor.b]), 3));
    const kickMaterial = new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: dpr } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const kickPoint = new THREE.Points(kickGeometry, kickMaterial);
    scene.add(kickPoint);

    // Cursor tracked in world space via the same trusted Camera.unproject
    // GravityField.jsx already leans on for its own flat orthographic scene
    // — no hand-derived projection math for a camera this simple.
    const ndcFromEvent = (e) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: -(((e.clientY - rect.top) / rect.height) * 2 - 1),
      };
    };
    let cursorActive = false;
    const cursorWorld = new THREE.Vector2();
    const handlePointerMove = (e) => {
      const ndc = ndcFromEvent(e);
      const w = new THREE.Vector3(ndc.x, ndc.y, 0).unproject(camera);
      cursorWorld.set(w.x, w.y);
      cursorActive = true;
    };
    const handlePointerLeave = () => { cursorActive = false; };
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerleave", handlePointerLeave);

    let rotation = 0;
    let beatFlash = 0;
    let lastBeatTime = 0;
    const beatHistory = [];
    let lastTime = performance.now();
    let raf = null;

    const tick = () => {
      raf = requestAnimationFrame(tick);

      const now = performance.now();
      const dt = Math.min(PHYSICS_DT_MAX, (now - lastTime) / 1000);
      lastTime = now;

      const analyser = analyserRef.current;
      let overallEnergy = 0;

      if (analyser) {
        if (!freqDataRef.current || freqDataRef.current.length !== analyser.frequencyBinCount) {
          freqDataRef.current = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(freqDataRef.current);
        const freqData = freqDataRef.current;

        let bassSum = 0;
        const bassBinEnd = bassBinEndRef.current;
        for (let b = 1; b <= bassBinEnd; b++) bassSum += freqData[b];
        const bassEnergy = bassSum / bassBinEnd;

        beatHistory.push(bassEnergy);
        if (beatHistory.length > BEAT_HISTORY_FRAMES) beatHistory.shift();
        let histSum = 0;
        for (let h = 0; h < beatHistory.length; h++) histSum += beatHistory[h];
        const historyAvg = histSum / beatHistory.length;

        if (
          !reduceMotionRef.current &&
          bassEnergy > MIN_BASS_ENERGY &&
          bassEnergy > historyAvg * BEAT_THRESHOLD_MULT &&
          now - lastBeatTime > BEAT_REFRACTORY_MS
        ) {
          lastBeatTime = now;
          beatFlash = 1;
          for (let i = 0; i < PARTICLE_COUNT; i++) particles[i].radialVel += BEAT_IMPULSE;
        }

        let total = 0;
        for (let b = 0; b < freqData.length; b++) total += freqData[b];
        overallEnergy = total / freqData.length / 255;
      }

      beatFlash = Math.max(0, beatFlash - dt / BEAT_FLASH_DURATION);

      if (!reduceMotionRef.current) rotation += (ROTATE_BASE_SPEED + overallEnergy * ROTATE_ENERGY_GAIN) * dt;

      const nowSec = now / 1000;

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const particle = particles[i];
        const angle = (i / PARTICLE_COUNT) * Math.PI * 2 + rotation;

        const curX = Math.cos(angle) * particle.radius;
        const curY = Math.sin(angle) * particle.radius;

        let targetRadius;
        if (analyser) {
          const mag = freqDataRef.current[PARTICLE_BIN_MAP[i]];
          targetRadius = BASE_RADIUS + (mag / 255) * MAX_RADIUS_ADD;
          particle.magnitude = mag / 255;
        } else {
          const idle = reduceMotionRef.current ? 0 : Math.sin(nowSec * IDLE_SPEED + i * IDLE_PHASE) * IDLE_AMOUNT;
          targetRadius = BASE_RADIUS + idle;
          particle.magnitude = 0.35;
        }

        let cursorForce = 0;
        if (!reduceMotionRef.current && cursorActive) {
          const dx = curX - cursorWorld.x, dy = curY - cursorWorld.y;
          const dist = Math.max(0.25, Math.hypot(dx, dy));
          if (dist < CURSOR_POKE_RADIUS) cursorForce = CURSOR_POKE_STRENGTH * (1 - dist / CURSOR_POKE_RADIUS);
        }

        const accel = SPRING_K * (targetRadius - particle.radius) - SPRING_DAMPING * particle.radialVel + cursorForce;
        particle.radialVel += accel * dt;
        particle.radius += particle.radialVel * dt;
        if (particle.radius < 0.3) { particle.radius = 0.3; particle.radialVel = Math.max(0, particle.radialVel); }

        const x = Math.cos(angle) * particle.radius;
        const y = Math.sin(angle) * particle.radius;

        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = 0;

        alphas[i] = Math.min(1, 0.55 + particle.magnitude * 0.35 + beatFlash * 0.15);
        sizes[i] = 4 + particle.magnitude * 10 + beatFlash * 4;
        colors[i * 3] = particle.color.r;
        colors[i * 3 + 1] = particle.color.g;
        colors[i * 3 + 2] = particle.color.b;
      }

      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.aAlpha.needsUpdate = true;
      geometry.attributes.aSize.needsUpdate = true;
      geometry.attributes.aColor.needsUpdate = true;

      kickGeometry.attributes.aAlpha.array[0] = beatFlash * 0.6;
      kickGeometry.attributes.aSize.array[0] = 14 + beatFlash * 30;
      kickGeometry.attributes.aAlpha.needsUpdate = true;
      kickGeometry.attributes.aSize.needsUpdate = true;

      renderer.render(scene, camera);
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

    return () => {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", handleVisibility);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
      resizeObserver.disconnect();
      geometry.dispose();
      material.dispose();
      kickGeometry.dispose();
      kickMaterial.dispose();
      renderer.dispose();
    };
  }, [active]);

  return (
    <div className="audio-pulse-field-root">
      <canvas ref={ canvasRef } className="audio-pulse-field-canvas" aria-hidden="true" />
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a visitor's own instrumental/ambient file, captions aren't meaningful here */}
      <audio
        ref={ audioElRef }
        onPlay={ () => setIsPlaying(true) }
        onPause={ () => setIsPlaying(false) }
        style={ { display: "none" } }
      />
      <div className="audio-pulse-field-controls">
        <label className="audio-pulse-field-choose">
          <FaMusic />
          <span>{ fileName || "Choose a track" }</span>
          <input type="file" accept="audio/*" onChange={ handleFileChange } />
        </label>
        <button
          type="button"
          className="audio-pulse-field-play"
          onClick={ togglePlay }
          disabled={ !fileName }
          aria-label={ isPlaying ? "Pause" : "Play" }
        >
          { isPlaying ? <FaPause /> : <FaPlay /> }
        </button>
      </div>
    </div>
  );
};

export default AudioPulseField;
