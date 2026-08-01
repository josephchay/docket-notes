// A light, self-contained Web Audio layer — raw AudioContext, no npm
// dependency and no audio files. Every cue is synthesized on the fly from
// two primitives (a short enveloped oscillator "tone" and a short enveloped
// filtered-noise burst), tuned soft and organic to match the app's ink/paper
// language rather than reading as electronic beeps. Silent by default —
// see setSoundEnabled below — so nothing plays until a visitor opts in.

let ctx = null;
let master = null;
let noiseBuffer = null;
let enabled = false;

const ensureContext = () => {
  if (ctx) return ctx;

  const AudioCtx = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!AudioCtx) return null;

  ctx = new AudioCtx();
  master = ctx.createGain();
  master.gain.value = .16;
  master.connect(ctx.destination);
  return ctx;
};

// A single cached second of white noise, re-filtered and re-timed per cue
// rather than allocated fresh every call.
const ensureNoiseBuffer = (context) => {
  if (noiseBuffer) return noiseBuffer;

  const length = context.sampleRate;
  noiseBuffer = context.createBuffer(1, length, context.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
};

// A couple of cues below fire from inside a setTimeout (the delete-confirm
// hold, the star burst's own timer) — a deferred callback doesn't count as
// a "user gesture" to the browser's autoplay policy on its own, so this
// grabs the earliest direct click/keydown anywhere on the page instead of
// relying only on resuming inside those specific calls.
if (typeof window !== "undefined") {
  const unlock = () => {
    const context = ensureContext();
    context?.resume?.();
  };
  window.addEventListener("pointerdown", unlock, { once: true, passive: true });
  window.addEventListener("keydown", unlock, { once: true });
}

export const setSoundEnabled = (value) => {
  enabled = !!value;
};

const tone = (context, { freq, duration = .12, type = "sine", peak = .5, delay = 0, glideTo = null }) => {
  const osc = context.createOscillator();
  const gain = context.createGain();
  const t0 = context.currentTime + delay;

  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + duration);

  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + Math.min(.012, duration * .3));
  gain.gain.exponentialRampToValueAtTime(.0001, t0 + duration);

  osc.connect(gain);
  gain.connect(master);
  osc.start(t0);
  osc.stop(t0 + duration + .02);
};

const noise = (context, { duration = .2, freqFrom = 1200, freqTo = 400, peak = .3, delay = 0, filterType = "bandpass", Q = .8 }) => {
  const source = context.createBufferSource();
  source.buffer = ensureNoiseBuffer(context);

  const filter = context.createBiquadFilter();
  filter.type = filterType;
  filter.Q.value = Q;

  const gain = context.createGain();
  const t0 = context.currentTime + delay;

  filter.frequency.setValueAtTime(freqFrom, t0);
  filter.frequency.exponentialRampToValueAtTime(Math.max(60, freqTo), t0 + duration);

  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + Math.min(.02, duration * .2));
  gain.gain.exponentialRampToValueAtTime(.0001, t0 + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  source.start(t0);
  source.stop(t0 + duration + .02);
};

const play = (fn) => {
  if (!enabled) return;

  const context = ensureContext();
  if (!context) return;
  if (context.state === "suspended") context.resume();

  fn(context);
};

// A note being poured — a quick rising plink with a faint splash tail.
export const playSpawn = () => play((context) => {
  tone(context, { freq: 320, glideTo: 540, duration: .09, type: "sine", peak: .34 });
  noise(context, { duration: .12, freqFrom: 2200, freqTo: 900, peak: .1, delay: .03 });
});

// Paper being wiped away — a soft descending filtered-noise swish.
export const playDelete = () => play((context) => {
  noise(context, { duration: .26, freqFrom: 1400, freqTo: 350, peak: .22, Q: .6 });
});

// Two quick bright blips, rising — the star catching light.
export const playStar = () => play((context) => {
  tone(context, { freq: 720, duration: .07, type: "sine", peak: .22 });
  tone(context, { freq: 1040, duration: .09, type: "sine", peak: .26, delay: .06 });
});

// A gentle lowpass swell/release, matching the ink-wash theme transition.
export const playThemeToggle = () => play((context) => {
  noise(context, { duration: .42, freqFrom: 300, freqTo: 1400, peak: .1, filterType: "lowpass", Q: .5 });
});

// A low thud with a tiny high tick on top — the export/import/undo stamp.
export const playStamp = () => play((context) => {
  tone(context, { freq: 130, duration: .1, type: "triangle", peak: .3 });
  noise(context, { duration: .05, freqFrom: 3000, freqTo: 2000, peak: .12, filterType: "highpass" });
});

// A soft paper-on-paper thud, its pitch and weight scaled by `strength`
// (0–1) — a real note landing in the physics pile (Pile/NotePile.jsx),
// louder and lower the harder it actually hit. Deliberately quieter than
// every other cue here at strength 0, since a session can drop dozens of
// these within a couple of seconds during the initial toss-in.
export const playImpact = (strength = .5) => play((context) => {
  const s = Math.min(1, Math.max(0, strength));
  tone(context, { freq: 70 + (1 - s) * 55, duration: .08 + s * .06, type: "sine", peak: .09 + s * .16 });
  noise(context, { duration: .025 + s * .03, freqFrom: 2600, freqTo: 1500, peak: .04 + s * .09, filterType: "highpass" });
});

// A soft three-note ascending chime — celebratory, not a game jingle.
export const playMilestone = () => play((context) => {
  tone(context, { freq: 523.25, duration: .22, peak: .22 });
  tone(context, { freq: 659.25, duration: .22, peak: .22, delay: .09 });
  tone(context, { freq: 783.99, duration: .3, peak: .24, delay: .18 });
});

// One cue per History-panel action category (see ACTION_STYLES in
// HistoryPanel.jsx) — narrates a time-lapse replay with the same sound each
// action already earns live, plus a handful of categories that have no
// live equivalent of their own (restored, shredded, emptied, duplicated,
// recolored, moved, locked, tagged, shuffled). Reuses the existing cues
// where the action really is the same thing (a poured/deleted/starred step
// sounds exactly like pouring/deleting/starring a note live), and composes
// small new ones from the same tone/noise primitives everywhere else, kept
// in the same soft/organic register rather than reaching for a bigger
// palette. restored is deliberately delete's noise sweep played in
// reverse (rising instead of falling) — the two actions already read as
// opposites, so their sounds do too.
const HISTORY_ACTION_SOUNDS = {
  poured: playSpawn,
  deleted: playDelete,
  starred: playStar,
  imported: playStamp,
  restored: () => play((context) => {
    noise(context, { duration: .22, freqFrom: 350, freqTo: 1300, peak: .18, Q: .6 });
  }),
  shredded: () => play((context) => {
    noise(context, { duration: .3, freqFrom: 900, freqTo: 200, peak: .26, Q: .5 });
    tone(context, { freq: 90, duration: .12, type: "triangle", peak: .18, delay: .02 });
  }),
  emptied: () => play((context) => {
    tone(context, { freq: 80, duration: .16, type: "triangle", peak: .3 });
    noise(context, { duration: .34, freqFrom: 1000, freqTo: 180, peak: .22, delay: .02 });
  }),
  duplicated: () => play((context) => {
    tone(context, { freq: 620, duration: .06, type: "sine", peak: .22 });
    tone(context, { freq: 620, duration: .06, type: "sine", peak: .2, delay: .09 });
  }),
  recolored: () => play((context) => {
    noise(context, { duration: .2, freqFrom: 500, freqTo: 2200, peak: .14, filterType: "bandpass", Q: 1.4 });
  }),
  moved: () => play((context) => {
    tone(context, { freq: 420, glideTo: 260, duration: .16, type: "sine", peak: .2 });
  }),
  locked: () => play((context) => {
    noise(context, { duration: .04, freqFrom: 2500, freqTo: 1800, peak: .18, filterType: "highpass" });
    tone(context, { freq: 200, duration: .05, type: "square", peak: .1, delay: .01 });
  }),
  tagged: () => play((context) => {
    tone(context, { freq: 880, duration: .06, type: "triangle", peak: .2 });
  }),
  shuffled: () => play((context) => {
    for (let i = 0; i < 4; i++) {
      noise(context, { duration: .05, freqFrom: 2000, freqTo: 1200, peak: .1, delay: i * .045, filterType: "bandpass", Q: 2 });
    }
  }),
};

export const playHistoryAction = (key) => {
  HISTORY_ACTION_SOUNDS[key]?.();
};

// A very light acknowledgment for pinning/unpinning a moment to compare —
// deliberately smaller and flatter than every cue above, since it fires on
// a fiddly, repeatable UI action rather than a real desk-changing edit.
export const playTick = () => play((context) => {
  noise(context, { duration: .04, freqFrom: 1800, freqTo: 1200, peak: .12, filterType: "bandpass", Q: 2 });
});
