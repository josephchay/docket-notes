import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { FaPlay, FaPause, FaMusic, FaVolumeHigh, FaVolumeXmark } from "react-icons/fa6";

import { smoothPath } from "../../utils/svgPath";
import { SNAPPY } from "../Motion";

import "./AudioWaveString.css";

// A real vibrating string — not a waveform trace, not a decorative squiggle
// — driven by whatever audio file is actually playing. N point-masses
// (indices 0..N-1) connected by tension into a 1D wave equation, both ends
// clamped to 0 (a real string is fixed at its ends; unlike LiquidMeter's
// vial, which reflects off its walls, a string doesn't — it's held there).
// The 46 interior points each feel a driving force sampled straight from
// the audio's own live time-domain waveform (Web Audio's AnalyserNode),
// so the string's shape at any instant is the music's own signal filtered
// through genuine mass/tension/damping — not a copy of the waveform, a
// physical response to it. Grab and drag any point to pluck it directly,
// audio or no audio.
const N = 48;
const INTERIOR_COUNT = N - 2;
const WAVE_DOMAIN = 100; // logical x-units — matches the SVG viewBox width exactly, so no separate pixel-scale math is needed anywhere in this file
const WAVE_DX = WAVE_DOMAIN / (N - 1);
const VIEW_H = 60; // logical y-units — matches the SVG viewBox height
const CENTER_Y = VIEW_H / 2;

// The same damped 1D wave equation as LiquidMeter.jsx's own meniscus
// (∂²y/∂t² = c²∂²y/∂x² − γ∂y/∂t, explicit central-difference stepper),
// just with fixed rather than reflecting boundaries and many more points.
// Stability re-verified by hand for this file's own constants rather than
// assumed from that one — the Courant number c·dt/dx must stay under 1:
// at the worst-case clamped dt (0.05s) split across 5 substeps, dt/5 = 0.01,
// giving c·dt/dx = 55·0.01/2.128 ≈ 0.259 — under half of LiquidMeter's own
// margin but still comfortably (~3.9×) inside the stable range. At a
// typical 60fps frame the same ratio is ≈0.086, far safer still. The
// damping term (γ·dt) needs to stay under 2 for the same explicit scheme;
// worst case here is 3.2·0.01 = 0.032, nowhere close.
const WAVE_SPEED = 55;
const WAVE_DAMPING = 3.2;
const SUBSTEPS = 5;
const WAVE_DT_MAX = 0.05;

// A hard cap on displacement itself (not just velocity, since this
// leapfrog-style scheme never stores velocity as its own variable — it's
// implicit as (curr-prev)/dt) — a safety net independent of how strongly
// the audio happens to drive the string, so a very loud or clipped source
// can never push a point visually off the string's own display area
// regardless of AUDIO_FORCE_SCALE's exact tuning.
const DISPLACEMENT_CLAMP = 22;

// Web Audio's own AnalyserNode does the actual signal analysis (a real
// FFT/time-domain capture, not anything reimplemented here) — this file
// only decides how to read it. Time-domain rather than frequency-domain
// specifically: a frequency spectrum is magnitude-only (always ≥0), which
// would only ever push the string one direction; the raw time-domain
// samples are a genuine two-sided signal (centered at byte 128), the
// actually-correct source for something meant to wave both up and down.
const AUDIO_FFT_SIZE = 2048;
// How hard the waveform's own signed amplitude drives the string, in
// logical-y-units/s² per unit of normalized signal. This is the one
// constant in this file that's tuning, not physics — exactly how animated
// a given signal amplitude ends up looking depends on how it interacts
// with WAVE_SPEED/WAVE_DAMPING together, which (like FluidField.jsx's own
// honest caveat about SPH's stiffness/viscosity interplay) isn't something
// that reduces to one hand-checkable number the way the stability bounds
// above do. The wave equation's own correctness and stability hold
// regardless of this constant's exact value — DISPLACEMENT_CLAMP above is
// the backstop if it's ever tuned too high.
const AUDIO_FORCE_SCALE = 340;

// A cursor/finger has some real width — plucking a string doesn't move one
// infinitely thin point, it deforms a small neighborhood. PLUCK_SIGMA is
// that neighborhood's width in logical x-units (a gaussian falloff, same
// mathematical shape AmbientField/ParticleCuboid already use for their own
// falloffs elsewhere in this app).
const PLUCK_SIGMA = 5;

// Purely decorative — never fed into curr[]/prev[], the same "ambient
// wobble is a render-only overlay, not part of the real physics" split
// LiquidMeter.jsx's own comments already establish — so an idle string
// (no audio, nothing recently plucked) still reads as alive rather than a
// dead flat line, without compromising the honesty of the driven physics
// itself (a real lightly-damped string with nothing driving it does
// genuinely settle flat — the decorative ripple is layered on top of that
// correct behavior, not a replacement for it).
const IDLE_RIPPLE_AMPLITUDE = 0.6;

const formatTime = (t) => {
  if (!Number.isFinite(t) || t < 0) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60).toString().padStart(2, "0");
  return `${ m }:${ s }`;
};

const AudioWaveString = ({ reduceMotion = false }) => {
  const svgRef = useRef(null);
  const pathRef = useRef(null);
  const audioRef = useRef(null);
  const fileInputRef = useRef(null);
  const objectUrlRef = useRef(null);
  // Populated by ensureAudioGraph() below, on demand — see that function's
  // own comment for why this can't be created eagerly in the mount effect.
  // Used both by the gesture handlers (to resume() it — browsers create a
  // new AudioContext suspended by default, and resuming the connected
  // <audio> element does NOT implicitly resume a separately-suspended
  // AudioContext it's routed through; they're independent objects with
  // independent state) and read by the tick loop's own cleanup.
  const audioCtxRef = useRef(null);
  // Everything the physics tick loop itself needs from the audio graph —
  // a single ref (rather than three separate ones) since these three are
  // always created and destroyed together. Read by the tick loop each
  // frame via this ref, never a value closed over once at mount time,
  // since it starts null and is only populated later, whenever a visitor
  // actually picks a file (possibly long after this component mounted).
  const audioGraphRef = useRef(null);
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

  const [trackName, setTrackName] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [muted, setMuted] = useState(false);

  // Builds the Web Audio graph at most once per component instance, guarded
  // by audioCtxRef itself rather than a separate flag — calling this again
  // later (a visitor picking a second, different file) is always a safe
  // no-op past the first real call. Deliberately NOT called from the mount
  // effect below, and this is a correctness fix, not a style preference:
  // createMediaElementSource may only ever be called once per <audio>
  // element for its entire lifetime, and React StrictMode's development-
  // only double-invoke of every effect (mount → cleanup → mount again, to
  // surface exactly this class of non-idempotent setup) means an eager
  // call here would throw on the synthetic second mount — silently
  // swallowed by the try/catch below, leaving audioGraphRef null on the
  // real, final mount. Worse, the FIRST call already permanently reroutes
  // that <audio> element's native output into its own (now-closed)
  // AudioContext, a change closing the context does not undo — so eager
  // creation didn't just break the audio-driven forcing, it silently broke
  // playback itself. Calling this from a real user gesture (handleFileChange
  // below) instead sidesteps the problem entirely: React never double-
  // invokes a plain event handler the way it does effects, so
  // createMediaElementSource only ever genuinely runs once.
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
      const timeData = new Uint8Array(analyser.fftSize);

      // A linear map from each interior string point to a sample index
      // across the analyser's own time-domain buffer — linear rather
      // than the logarithmic spacing a frequency-axis mapping would
      // need, since time itself (unlike pitch) has no perceptual reason
      // to be spaced any other way.
      const lastSample = analyser.fftSize - 1;
      const sampleIndexFor = (k) => Math.round((k / (INTERIOR_COUNT - 1)) * lastSample);

      audioCtxRef.current = audioCtx;
      audioGraphRef.current = { analyser, timeData, sampleIndexFor };
    } catch (err) {
      // Web Audio unavailable, blocked, or createMediaElementSource
      // rejected for some other reason — audioGraphRef stays null (the
      // tick loop already checks for that before reading it), but this is
      // logged rather than silently swallowed: a silent catch here was
      // exactly what hid the real StrictMode double-invoke bug during the
      // last round of debugging, and if something is still going wrong,
      // this is the one place in the file most likely to be why.
      console.error("AudioWaveString: failed to set up the Web Audio graph", err);
    }
  };

  useEffect(() => {
    const audioEl = audioRef.current;
    const svg = svgRef.current;
    const path = pathRef.current;

    // Three flat buffers, rotated in place each substep — the exact same
    // pattern LiquidMeter.jsx's own wave stepper uses, for the same reason
    // (no per-frame allocation).
    let curr = new Float32Array(N);
    let prev = new Float32Array(N);
    let next = new Float32Array(N);

    // Drag-to-pluck: press near a point, drag, release. Overrides curr[]
    // directly at the dragged neighborhood each frame (after the physics
    // step, before render) rather than fighting the stepper with an extra
    // force term — releasing leaves whatever velocity the last couple of
    // frames' worth of dragging implied (curr/prev's own difference),
    // exactly like a real pluck continuing to ring after the finger lets go.
    let dragging = false;
    let dragX = 0, dragY = 0;

    const svgPointFromEvent = (e) => {
      const rect = svg.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * WAVE_DOMAIN,
        y: ((e.clientY - rect.top) / rect.height) * VIEW_H,
      };
    };

    const handlePointerDown = (e) => {
      dragging = true;
      const p = svgPointFromEvent(e);
      dragX = p.x; dragY = p.y;
      svg.setPointerCapture?.(e.pointerId);
    };
    const handlePointerMoveDrag = (e) => {
      if (!dragging) return;
      const p = svgPointFromEvent(e);
      dragX = p.x; dragY = p.y;
    };
    const handlePointerUp = () => { dragging = false; };
    svg.addEventListener("pointerdown", handlePointerDown);
    svg.addEventListener("pointermove", handlePointerMoveDrag);
    window.addEventListener("pointerup", handlePointerUp);

    let angle = 0; // idle-ripple phase accumulator, decorative only (see IDLE_RIPPLE_AMPLITUDE)
    let lastTime = performance.now();
    let raf = null;

    const step = (dt, graph) => {
      const r2 = ((WAVE_SPEED * dt) / WAVE_DX) ** 2;
      const dampTerm = WAVE_DAMPING * dt;
      const forceTerm = dt * dt;

      // Interior points only — index 0 and N-1 stay pinned at 0 for the
      // string's entire lifetime, simply by never being written to.
      for (let i = 1; i < N - 1; i++) {
        const laplacian = curr[i - 1] - 2 * curr[i] + curr[i + 1];

        let forced = 0;
        if (graph) {
          const sample = graph.timeData[graph.sampleIndexFor(i - 1)];
          const signed = (sample - 128) / 128; // Web Audio's own byte format: 128 is silence, the signal is centered there
          forced = AUDIO_FORCE_SCALE * signed;
        }

        let value = (2 - dampTerm) * curr[i] - (1 - dampTerm) * prev[i] + r2 * laplacian + forced * forceTerm;
        value = Math.max(-DISPLACEMENT_CLAMP, Math.min(DISPLACEMENT_CLAMP, value));
        next[i] = value;
      }

      const rotatedPrev = curr;
      curr = next;
      next = rotatedPrev;
      // No explicit re-pinning needed at the ends — indices 0 and N-1 are
      // never written by this loop (i runs 1..N-2) or by the drag-pluck
      // block below (clamped to the same range), in any of the three
      // rotating buffers, ever. Each buffer starts life as a zero-filled
      // Float32Array, so those two indices simply stay 0 for the entire
      // lifetime of the simulation without any code needing to enforce it
      // — verified by hand by tracing which indices each buffer's rotation
      // slot actually gets written to across several calls, not assumed.
    };

    const tick = () => {
      raf = requestAnimationFrame(tick);

      const now = performance.now();
      const dt = Math.min(WAVE_DT_MAX, (now - lastTime) / 1000);
      lastTime = now;

      // Read once per frame (not once per substep, which would be a
      // pointless repeat of the exact same ref lookup) — this is either
      // null (no file chosen yet, or ensureAudioGraph() never succeeded) or
      // the same live { analyser, timeData, sampleIndexFor } for the whole
      // frame, however many substeps that frame ends up taking.
      const graph = audioGraphRef.current;
      if (graph) graph.analyser.getByteTimeDomainData(graph.timeData);

      const subDt = dt / SUBSTEPS;
      for (let s = 0; s < SUBSTEPS; s++) step(subDt, graph);

      if (dragging) {
        const centerIndex = dragX / WAVE_DX;
        const targetY = CENTER_Y - dragY; // screen y grows downward; physics y grows upward
        const lo = Math.max(1, Math.floor(centerIndex - PLUCK_SIGMA * 3));
        const hi = Math.min(N - 2, Math.ceil(centerIndex + PLUCK_SIGMA * 3));
        for (let i = lo; i <= hi; i++) {
          const offset = i - centerIndex;
          const falloff = Math.exp(-(offset * offset) / (2 * PLUCK_SIGMA * PLUCK_SIGMA));
          curr[i] = curr[i] * (1 - falloff) + targetY * falloff;
        }
      }

      if (!reduceMotionRef.current) angle += dt * 2.4;

      const points = new Array(N);
      for (let i = 0; i < N; i++) {
        const x = i * WAVE_DX;
        const idle = (!reduceMotionRef.current && !dragging)
          ? Math.sin(angle + i * 0.5) * IDLE_RIPPLE_AMPLITUDE * (1 - Math.abs(i - (N - 1) / 2) / ((N - 1) / 2))
          : 0;
        points[i] = { x, y: CENTER_Y - curr[i] - idle };
      }
      path.setAttribute("d", smoothPath(points));
    };

    tick();

    // Transport wiring — plain DOM events on the <audio> element rather
    // than a fully React-controlled media element, the standard safe
    // pattern for custom audio players (React state mirrors the element's
    // own events; it never drives playback directly).
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
      cancelAnimationFrame(raf);
      svg.removeEventListener("pointerdown", handlePointerDown);
      svg.removeEventListener("pointermove", handlePointerMoveDrag);
      window.removeEventListener("pointerup", handlePointerUp);
      audioEl.removeEventListener("play", handlePlay);
      audioEl.removeEventListener("pause", handlePause);
      audioEl.removeEventListener("ended", handleEnded);
      audioEl.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audioEl.removeEventListener("timeupdate", handleTimeUpdate);
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

    // The file input's own change event is itself gesture-derived, so both
    // resuming the AudioContext (suspended by default until a user gesture
    // unlocks it — the same policy utils/sound.js already works around for
    // its own synthesized cues) and starting playback here are allowed. The
    // resume() call matters, not just play(): the two are independent
    // objects, and playing the element alone would leave the graph
    // downstream of it (the analyser, the actual speaker output) silent if
    // its AudioContext were still suspended. Now properly sequenced (via
    // Promise.resolve(...).then(...), not a bare un-awaited call followed
    // immediately by play()) rather than assumed to race safely, and the
    // rejection is logged instead of silently swallowed — reported not
    // to be working, twice, with the previous version of this file, so
    // this is deliberately more defensive/observable than "should be fine"
    // reasoning alone.
    Promise.resolve(audioCtxRef.current?.resume())
      .then(() => audioEl.play())
      .catch((err) => console.error("AudioWaveString: playback failed to start", err));
  };

  const togglePlay = () => {
    const audioEl = audioRef.current;
    if (!audioEl.src) { handleChooseFile(); return; }
    if (isPlaying) {
      audioEl.pause();
    } else {
      Promise.resolve(audioCtxRef.current?.resume())
        .then(() => audioEl.play())
        .catch((err) => console.error("AudioWaveString: playback failed to start", err));
    }
  };

  const handleSeek = (e) => {
    const value = Number(e.target.value);
    audioRef.current.currentTime = value;
    setCurrentTime(value);
  };

  const toggleMute = () => {
    const audioEl = audioRef.current;
    audioEl.muted = !audioEl.muted;
    setMuted(audioEl.muted);
  };

  return (
    <div className="audio-wave-string">
      <audio ref={ audioRef } preload="metadata" />
      <input
        ref={ fileInputRef }
        type="file"
        accept="audio/*"
        hidden
        onChange={ handleFileChange }
      />

      <svg
        ref={ svgRef }
        className="audio-wave-svg"
        viewBox={ `0 0 ${ WAVE_DOMAIN } ${ VIEW_H }` }
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <line
          className="audio-wave-baseline"
          x1="0" y1={ CENTER_Y } x2={ WAVE_DOMAIN } y2={ CENTER_Y }
        />
        <path ref={ pathRef } className="audio-wave-path" />
      </svg>

      {
        !trackName && (
          <button type="button" className="audio-wave-empty" onClick={ handleChooseFile }>
            <FaMusic />
            Choose a song, or pluck the string
          </button>
        )
      }

      <div className="audio-wave-transport">
        <motion.button
          type="button"
          className="audio-wave-play"
          aria-label={ isPlaying ? "Pause" : "Play" }
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: .92 }}
          transition={ SNAPPY }
          onClick={ togglePlay }
        >
          { isPlaying ? <FaPause /> : <FaPlay /> }
        </motion.button>

        <span className="audio-wave-time">{ formatTime(currentTime) }</span>
        <input
          type="range"
          className="audio-wave-seek"
          min={ 0 }
          max={ duration || 0 }
          step={ 0.01 }
          value={ currentTime }
          onChange={ handleSeek }
          aria-label="Seek"
        />
        <span className="audio-wave-time">{ formatTime(duration) }</span>

        <motion.button
          type="button"
          className="audio-wave-mute"
          aria-label={ muted ? "Unmute" : "Mute" }
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: .9 }}
          transition={ SNAPPY }
          onClick={ toggleMute }
        >
          { muted ? <FaVolumeXmark /> : <FaVolumeHigh /> }
        </motion.button>

        <button type="button" className="audio-wave-choose" onClick={ handleChooseFile }>
          <FaMusic />
          { trackName || "Choose a song" }
        </button>
      </div>
    </div>
  );
};

export default AudioWaveString;
