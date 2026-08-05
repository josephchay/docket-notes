import { useEffect, useRef, useState } from "react";
import { FaChevronLeft, FaChevronRight, FaMusic, FaPlus } from "react-icons/fa6";

import "./WavePlayer.css";

// Local files only, chosen by the visitor via a plain multi-file <input> —
// nothing bundled or fetched. Same MediaElementSource → AnalyserNode →
// destination graph AudioPulseField.jsx already uses, read here as
// time-domain (oscilloscope-style) samples instead of frequency bins, since
// the point of this one is the literal waveform shape, not a spectrum.
const FFT_SIZE = 64; // valid AnalyserNode sizes are powers of 2 from 32–32768; time-domain sample count equals fftSize itself (unlike frequency data, which is fftSize/2) — 64 raw points is already dense for a line this size

// getByteTimeDomainData carries no equivalent of frequency data's own
// smoothingTimeConstant — every call returns the raw instantaneous
// waveform. Rather than paper over that with an ad-hoc exponential filter,
// the line itself is a real physical system: FFT_SIZE point masses in a 1D
// chain, each on its own damped spring pulling it toward that instant's
// target height (the live audio sample, or an idle sine when nothing's
// playing), and each also coupled to its two neighbors by a second spring
// — the standard finite-difference discretization of a driven, damped wave
// equation (a plucked/bowed string, structurally). The neighbor coupling is
// what actually smooths and organizes the line (a disturbance at one point
// visibly drags its neighbors with it, the way real tension does) rather
// than a per-point filter faking continuity — real elastic wave
// propagation along the strip, not a decorative squiggle.
//
// Stability: semi-implicit Euler needs ω·dt < 2 for the fastest normal
// mode the system can support (the same bound every spring/N-body/SPH
// stepper in this app is checked against). For a chain of unit masses with
// per-point drive stiffness K_DRIVE and neighbor stiffness TENSION, the
// worst case is an interior point at the spatial Nyquist frequency (its two
// neighbors moving in perfect antiphase), whose effective restoring
// stiffness is K_DRIVE + 4·TENSION — 4, not 2, because the discrete
// Laplacian (y[i-1] - 2y[i] + y[i+1]) hits its own maximum eigenvalue of 4
// at that alternating pattern. At K_DRIVE = 60, TENSION = 40:
// ω_max = √(60 + 4·40) = √220 ≈ 14.83 rad/s. At the clamped worst-case
// dt = PHYSICS_DT_MAX = 0.05, ω_max·dt ≈ 0.74 — comfortably under 2,
// ~2.7× margin even at a dropped-frame dt, ~16× margin at a normal 60fps
// frame.
const K_DRIVE = 60;
const TENSION = 40;
const DAMPING = 12;
const PHYSICS_DT_MAX = 0.05;

const IDLE_SPEED = 1.6;
const IDLE_FREQ = 0.35;
const IDLE_AMP = 0.5; // fraction of full displacement — a gentle breathing drive target, not silence, before anything's loaded or while paused

const WAVE_W = 100;
const WAVE_H = 30;
const AMPLITUDE_SCALE = 0.85; // keeps a full-scale waveform from touching the box's own top/bottom edge
const RENDER_CLAMP = 1.15; // a driven-damped chain can briefly overshoot its own target on a sharp transient (real spring behavior, not a bug) — clamped only at render time so a loud spike can't push the drawn line off the visible box

// Quadratic-bezier midpoint smoothing: for each interior sample, curve to
// the midpoint between it and its neighbor using the sample itself as the
// control point, finishing with a straight segment to the last real point.
// A standard technique for turning a polyline through noisy sampled data
// into a continuously smooth curve, not a decorative flourish — without it,
// 64 raw points read as visibly faceted at this size.
const buildSmoothPath = (xs, ys) => {
  let d = `M ${ xs[0].toFixed(2) } ${ ys[0].toFixed(2) }`;
  for (let i = 1; i < xs.length - 1; i++) {
    const mx = (xs[i] + xs[i + 1]) / 2;
    const my = (ys[i] + ys[i + 1]) / 2;
    d += ` Q ${ xs[i].toFixed(2) } ${ ys[i].toFixed(2) }, ${ mx.toFixed(2) } ${ my.toFixed(2) }`;
  }
  const last = xs.length - 1;
  d += ` L ${ xs[last].toFixed(2) } ${ ys[last].toFixed(2) }`;
  return d;
};

const SAMPLE_X = Array.from({ length: FFT_SIZE }, (_, i) => (i / (FFT_SIZE - 1)) * WAVE_W);

// A compact "now playing" strip for the quick dock: a genuine live waveform
// (not a decorative squiggle) that doubles as the play/pause control, with
// a small playlist behind it. Entirely self-contained — its own <audio>
// element, its own Web Audio graph, its own file selection — independent of
// the bigger AudioPulseField showcase panel, which is a separate feature
// with its own separate audio session by design.
const WavePlayer = ({ reduceMotion = false }) => {
  const pathRef = useRef(null);
  const audioElRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const timeDataRef = useRef(null);
  // The chain's own physical state — displacement and velocity per point,
  // both starting at rest (0) — plus a scratch acceleration buffer reused
  // every frame rather than reallocated.
  const yRef = useRef(new Float32Array(FFT_SIZE));
  const vRef = useRef(new Float32Array(FFT_SIZE));
  const accelRef = useRef(new Float32Array(FFT_SIZE));
  const objectUrlsRef = useRef([]);
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

  const [playlist, setPlaylist] = useState([]); // [{ name, url }]
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const playlistRef = useRef([]);
  playlistRef.current = playlist;
  const currentIndexRef = useRef(0);
  currentIndexRef.current = currentIndex;

  // Lazily built once, same reasoning as AudioPulseField.jsx's own
  // ensureAudioGraph — createMediaElementSource throws on a second call
  // against the same <audio> element, and that element is rendered once,
  // unconditionally, below.
  const ensureAudioGraph = () => {
    if (audioCtxRef.current) return audioCtxRef.current;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx || !audioElRef.current) return null;

    const ctx = new AudioCtx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    const source = ctx.createMediaElementSource(audioElRef.current);
    source.connect(analyser);
    analyser.connect(ctx.destination);

    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
    timeDataRef.current = new Uint8Array(analyser.fftSize);
    return ctx;
  };

  const playTrack = (index, list = playlistRef.current) => {
    const track = list[index];
    const audioEl = audioElRef.current;
    if (!track || !audioEl) return;

    ensureAudioGraph();
    audioCtxRef.current?.resume?.();
    setCurrentIndex(index);
    audioEl.src = track.url;
    audioEl.play().catch(() => {});
  };

  // Picking files is itself the user gesture browsers require before audio
  // can play — safe to build the graph, resume, and start playback right
  // from this handler. Adding more tracks to an already-playing list just
  // appends; only an empty-to-non-empty transition auto-starts the first one.
  const handleAddFiles = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const additions = files.map((file) => ({ name: file.name, url: URL.createObjectURL(file) }));
    for (const a of additions) objectUrlsRef.current.push(a.url);

    const wasEmpty = playlistRef.current.length === 0;
    const nextList = [...playlistRef.current, ...additions];
    setPlaylist(nextList);
    if (wasEmpty) playTrack(0, nextList);

    e.target.value = ""; // lets choosing the same file(s) again re-fire onChange
  };

  const handleTogglePlay = () => {
    const audioEl = audioElRef.current;
    if (!audioEl?.src) return;
    if (audioEl.paused) {
      ensureAudioGraph();
      audioCtxRef.current?.resume?.();
      audioEl.play().catch(() => {});
    } else {
      audioEl.pause();
    }
  };

  const handlePrev = () => {
    const list = playlistRef.current;
    if (list.length < 2) return;
    playTrack((currentIndexRef.current - 1 + list.length) % list.length, list);
  };
  const handleNext = () => {
    const list = playlistRef.current;
    if (list.length === 0) return;
    playTrack((currentIndexRef.current + 1) % list.length, list);
  };

  // True unmount-only cleanup — see AudioPulseField.jsx's identical comment
  // on why this rarely fires (QuickDock, and everything in it, stays
  // mounted for the app's whole lifetime) but is still correct to have.
  useEffect(() => () => {
    audioCtxRef.current?.close?.();
    for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
  }, []);

  // The draw loop — always running while the dock exists (there's no
  // "panel closed" state here), gated only by reduceMotion for the purely
  // decorative idle sine, the same split AudioPulseField.jsx draws between
  // its own core spectrum-follow motion (never suppressed) and its ambient
  // extras (rotation, cursor poke — suppressed under reduceMotion).
  useEffect(() => {
    let raf = null;
    let lastTime = performance.now();
    const t0 = lastTime;

    const tick = () => {
      raf = requestAnimationFrame(tick);

      const now = performance.now();
      const dt = Math.min(PHYSICS_DT_MAX, (now - lastTime) / 1000);
      lastTime = now;

      const elapsed = (now - t0) / 1000;
      const y = yRef.current;
      const v = vRef.current;
      const accel = accelRef.current;
      const analyser = analyserRef.current;
      const audioEl = audioElRef.current;
      const live = !!(analyser && audioEl && !audioEl.paused);

      if (live) analyser.getByteTimeDomainData(timeDataRef.current);
      const raw = timeDataRef.current;

      // Pass 1 — every acceleration computed from the chain's current
      // (not-yet-updated) state, so a point's own update this frame never
      // leaks into its neighbor's force calculation within the same step.
      // Free/Neumann boundary at both ends: the missing neighbor is treated
      // as equal to the point's own value, which drops that side's tension
      // term to zero rather than pinning the endpoints in place — the two
      // ends of the strip stay free to move with the audio, just with
      // half the interior's neighbor coupling.
      for (let i = 0; i < FFT_SIZE; i++) {
        let target;
        if (live) target = (raw[i] - 128) / 128;
        else if (!reduceMotionRef.current) target = Math.sin(elapsed * IDLE_SPEED + i * IDLE_FREQ) * IDLE_AMP;
        else target = 0;

        const left = i > 0 ? y[i - 1] : y[i];
        const right = i < FFT_SIZE - 1 ? y[i + 1] : y[i];
        const waveForce = TENSION * (left - 2 * y[i] + right);
        const driveForce = K_DRIVE * (target - y[i]);
        accel[i] = waveForce + driveForce - DAMPING * v[i];
      }

      // Pass 2 — semi-implicit Euler: velocity from this step's forces,
      // then position from the updated velocity (symplectic, the same
      // integrator every other spring/orbit system in this app uses).
      for (let i = 0; i < FFT_SIZE; i++) {
        v[i] += accel[i] * dt;
        y[i] += v[i] * dt;
      }

      const ys = new Array(FFT_SIZE);
      for (let i = 0; i < FFT_SIZE; i++) {
        const clamped = Math.max(-RENDER_CLAMP, Math.min(RENDER_CLAMP, y[i]));
        ys[i] = WAVE_H / 2 - clamped * (WAVE_H / 2) * AMPLITUDE_SCALE;
      }

      if (pathRef.current) pathRef.current.setAttribute("d", buildSmoothPath(SAMPLE_X, ys));
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
    };
  }, []);

  const hasTracks = playlist.length > 0;
  const currentTrack = playlist[currentIndex];

  return (
    <div className="wave-player">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a visitor's own file, captions aren't meaningful here */}
      <audio
        ref={ audioElRef }
        onPlay={ () => setIsPlaying(true) }
        onPause={ () => setIsPlaying(false) }
        onEnded={ handleNext }
        style={{ display: "none" }}
      />

      {
        hasTracks && (
          <button
            type="button"
            className="wave-player-chevron"
            aria-label="Previous track"
            onClick={ handlePrev }
            disabled={ playlist.length < 2 }
          >
            <FaChevronLeft />
          </button>
        )
      }

      {
        hasTracks ? (
          <button
            type="button"
            className="wave-player-wave"
            onClick={ handleTogglePlay }
            aria-label={ (isPlaying ? "Pause " : "Play ") + (currentTrack?.name || "track") }
            title={ currentTrack?.name }
          >
            <svg viewBox={ `0 0 ${ WAVE_W } ${ WAVE_H }` } className="wave-player-svg" preserveAspectRatio="none">
              <path ref={ pathRef } className={ `wave-player-path${ isPlaying ? " is-playing" : "" }` } fill="none" />
            </svg>
          </button>
        ) : (
          <label className="wave-player-add" title="Add tracks">
            <FaMusic />
            <span>Add tracks</span>
            <input type="file" accept="audio/*" multiple onChange={ handleAddFiles } />
          </label>
        )
      }

      {
        hasTracks && (
          <button
            type="button"
            className="wave-player-chevron"
            aria-label="Next track"
            onClick={ handleNext }
            disabled={ playlist.length < 2 }
          >
            <FaChevronRight />
          </button>
        )
      }

      {
        hasTracks && (
          <label className="wave-player-plus" aria-label="Add more tracks" title="Add more tracks">
            <FaPlus />
            <input type="file" accept="audio/*" multiple onChange={ handleAddFiles } />
          </label>
        )
      }
    </div>
  );
};

export default WavePlayer;
