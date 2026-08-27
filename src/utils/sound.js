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

// The last hop into the master bus, optionally through a stereo panner —
// a cue that happens somewhere on screen can now sound like it happened
// there (NoteConstellation.jsx passes pan from each event's own screen
// position). Zero pan skips the panner node entirely, so every existing
// centered cue costs exactly what it did before; browsers without
// createStereoPanner (none current, but the guard is free) just stay
// centered.
const routeOut = (context, gain, pan) => {
  if (pan && context.createStereoPanner) {
    const panner = context.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    gain.connect(panner);
    panner.connect(master);
  } else {
    gain.connect(master);
  }
};

const tone = (context, { freq, duration = .12, type = "sine", peak = .5, delay = 0, glideTo = null, pan = 0 }) => {
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
  routeOut(context, gain, pan);
  osc.start(t0);
  osc.stop(t0 + duration + .02);
};

const noise = (context, { duration = .2, freqFrom = 1200, freqTo = 400, peak = .3, delay = 0, filterType = "bandpass", Q = .8, pan = 0 }) => {
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
  routeOut(context, gain, pan);
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

// The pool's own voice — structurally the one different thing in this
// whole file. Every cue above is a short, self-terminating envelope: call
// it, it plays itself out, done. This is a PERSISTENT node graph — two
// sine partials (a fifth apart, the same "add a quiet upper harmonic"
// trick playThreadPluck already uses for a plucked string) through a
// lowpass filter, left running and continuously re-aimed rather than
// re-triggered — because it's sonifying something that doesn't have
// discrete events to hang cues on: how much the ink surface is moving
// RIGHT NOW, moment to moment (NoteConstellation.jsx's own resonance-
// monitor toggle feeds it the wave field's live RMS energy every frame).
// A calm pool doesn't just go quiet here — the filter's own cutoff drops
// with it too, so stillness reads as the hum going dull and distant, not
// merely fainter, the same way real still water muffles high frequencies
// a choppy surface doesn't.
//
// updatePoolVoice is the ONLY entry point a caller needs while its own
// toggle is on: it lazily starts the graph on first call, silently
// re-aims it on every call after, and self-silences (tearing the graph
// down, not just muting it) the instant `enabled` goes false — so a
// visitor switching sound off mid-session doesn't leave this humming
// on regardless, and switching it back on later resumes with the very
// next call, no separate wake-up the caller needs to remember. The one
// thing a caller MUST still do is call stopPoolVoice() itself once,
// unconditionally, when its own toggle goes off or its component
// unmounts — unlike every cue above, a started oscillator does not stop
// itself, and forgetting this is a genuine leak: a hum playing forever
// in the background of a page that no longer even shows the panel it
// came from.
let poolVoice = null;

export const updatePoolVoice = (energy) => {
  if (!enabled) {
    if (poolVoice) stopPoolVoice();
    return;
  }

  if (!poolVoice) {
    const context = ensureContext();
    if (!context) return;
    if (context.state === "suspended") context.resume();

    const gain = context.createGain();
    gain.gain.value = 0;

    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 140;
    filter.Q.value = .4;

    const osc = context.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 96;

    const osc2 = context.createOscillator();
    osc2.type = "sine";
    osc2.frequency.value = 96 * 1.5; // a fifth above the fundamental

    const gain2 = context.createGain();
    gain2.gain.value = .35; // the upper partial sits quieter than the fundamental

    osc.connect(filter);
    osc2.connect(gain2);
    gain2.connect(filter);
    filter.connect(gain);
    gain.connect(master);

    osc.start();
    osc2.start();

    poolVoice = { osc, osc2, gain, filter };
  }

  // setTargetAtTime rather than a linear/exponential ramp — those need a
  // known END time (every cue above has one, since they're each a fixed-
  // duration envelope); this gets a fresh target every frame instead, the
  // idiomatic Web Audio shape for a continuously-updated live parameter,
  // and its own exponential approach is what keeps a fast-changing energy
  // reading from ever zippering or clicking.
  const e = Math.max(0, Math.min(1, energy));
  const t = ctx.currentTime;
  poolVoice.gain.gain.setTargetAtTime(.02 + e * .05, t, .4);
  poolVoice.filter.frequency.setTargetAtTime(140 + e * 900, t, .3);
};

export const stopPoolVoice = () => {
  if (!poolVoice) return;
  const { osc, osc2, gain } = poolVoice;
  const t = ctx.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setTargetAtTime(0, t, .25);
  osc.stop(t + 1);
  osc2.stop(t + 1);
  poolVoice = null;
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
export const playImpact = (strength = .5, pan = 0) => play((context) => {
  const s = Math.min(1, Math.max(0, strength));
  tone(context, { freq: 70 + (1 - s) * 55, duration: .08 + s * .06, type: "sine", peak: .09 + s * .16, pan });
  noise(context, { duration: .025 + s * .03, freqFrom: 2600, freqTo: 1500, peak: .04 + s * .09, filterType: "highpass", pan });
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
  // archived/unarchived mirror each other the same way restored already
  // mirrors deleted — archived settles from a higher, brighter tone down
  // into a muffled lowpass tail (tucked away), unarchived is that same
  // shape run in reverse (brought back out).
  archived: () => play((context) => {
    tone(context, { freq: 300, glideTo: 170, duration: .16, type: "sine", peak: .18 });
    noise(context, { duration: .14, freqFrom: 700, freqTo: 260, peak: .1, filterType: "lowpass", delay: .02 });
  }),
  unarchived: () => play((context) => {
    tone(context, { freq: 170, glideTo: 300, duration: .16, type: "sine", peak: .2 });
    noise(context, { duration: .12, freqFrom: 260, freqTo: 900, peak: .1, filterType: "lowpass" });
  }),
  // Two soft neutral ticks — a calendar page being flagged, not an alarm.
  reminded: () => play((context) => {
    tone(context, { freq: 500, duration: .05, type: "triangle", peak: .18 });
    tone(context, { freq: 660, duration: .06, type: "triangle", peak: .2, delay: .08 });
  }),
  // A quick pen-tick swish — the same register as tagged, kept distinct so
  // the two categories still read apart in the History rail's own preview.
  checklisted: () => play((context) => {
    noise(context, { duration: .05, freqFrom: 1800, freqTo: 2600, peak: .14, filterType: "highpass" });
    tone(context, { freq: 780, duration: .05, type: "sine", peak: .16, delay: .04 });
  }),
  // Three unhurried, evenly-spaced tones (as opposed to milestone's quick
  // bright run) — the three sections of a study landing in turn, at a
  // steadier, more contemplative pace.
  studied: () => play((context) => {
    tone(context, { freq: 440, duration: .16, type: "sine", peak: .16 });
    tone(context, { freq: 523.25, duration: .16, type: "sine", peak: .18, delay: .14 });
    tone(context, { freq: 587.33, duration: .2, type: "sine", peak: .2, delay: .28 });
  }),
  // Two brief square-wave ticks bracketing a softer sine — literally
  // sonifying the punctuation this action adds (wrapping a selection in
  // parens), kept at a different frequency from tagged (880Hz) so the two
  // still read apart from each other.
  cited: () => play((context) => {
    tone(context, { freq: 900, duration: .03, type: "square", peak: .14 });
    tone(context, { freq: 700, duration: .07, type: "sine", peak: .18, delay: .045 });
    tone(context, { freq: 900, duration: .03, type: "square", peak: .14, delay: .13 });
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

// A constellation thread being plucked (NoteConstellation.jsx computes the
// frequency from the string's own current length — see its pluck-audio
// constants for the physics). Voiced like a soft harp string in the same
// organic register as everything above: the fundamental, a quieter octave
// partial (a real string's second harmonic — one partial is enough to read
// as "string" without turning into a synthesizer patch), and a tiny
// high-passed pick transient for the finger leaving the thread. Intensity
// (0–1, from the pluck's own amplitude) scales level and sustain the way
// pluck energy actually does.
// `brightness` (0–1) is the fraction of the pluck's energy sitting in the
// upper standing-wave modes — NoteConstellation.jsx's pluckEdge computes
// it from where along the span the string was actually plucked, and a
// real string plucked near its end IS brighter (more of its triangle's
// Fourier series lands in high partials). Here it scales the octave
// partial and gates in a third partial that a centered, fundamental-heavy
// pluck barely carries.
export const playThreadPluck = (freq = 320, intensity = .5, pan = 0, brightness = .35) => play((context) => {
  const s = Math.min(1, Math.max(0, intensity));
  const b = Math.min(1, Math.max(0, brightness));
  tone(context, { freq, duration: .28 + s * .14, type: "sine", peak: .05 + s * .12, pan });
  tone(context, { freq: freq * 2, duration: .16 + s * .06, type: "sine", peak: (.02 + s * .05) * (.5 + b), pan });
  tone(context, { freq: freq * 3, duration: .12 + s * .04, type: "sine", peak: (.012 + s * .03) * b, pan });
  noise(context, { duration: .018, freqFrom: 3200, freqTo: 2200, peak: .03 + s * .05, filterType: "highpass", pan });
});

// A droplet meeting the water — the iconic "plip". A real drip's signature
// is a RISING chirp (the cavity the drop punches into the surface shrinks
// as it closes, and its resonant pitch climbs with it — the actual
// acoustics of the sound everyone knows), so this is a short upward sine
// glide with a tiny band-passed splash grain a hair behind it. The caller
// picks the base frequency from the drop itself (NoteConstellation.jsx's
// dew lands smaller drops higher, exactly as a smaller cavity rings
// higher; its snapping liquid bridges reuse the same cue an octave-ish
// down, where it reads as a thicker, wetter pop). Deliberately quiet even
// at full intensity — dew falls on its own schedule, and an ambient sound
// the visitor didn't cause has to sit under everything they did.
// A struck membrane — the Chladni strike's own voice (NoteConstellation.jsx
// passes the struck eigenmode's true relative eigenfrequency, so
// successive strikes climb the drum's actual — famously inharmonic —
// partial ladder; this is why drums aren't melodic, made audible). A long
// soft fundamental, one quieter upper partial at 1.59× (the circular
// membrane's classic first-overtone ratio — close enough for a voice; the
// honest rectangular ratios live in the caller's fundamental), and a
// low-passed mallet thump for the strike itself.
export const playMembrane = (freq = 180, intensity = .6, pan = 0) => play((context) => {
  const s = Math.min(1, Math.max(0, intensity));
  tone(context, { freq, duration: .9 + s * .4, type: "sine", peak: .1 + s * .14, pan });
  tone(context, { freq: freq * 1.59, duration: .5, type: "sine", peak: .04 + s * .05, pan });
  noise(context, { duration: .06, freqFrom: 900, freqTo: 300, peak: .05 + s * .06, filterType: "lowpass", Q: .7, pan });
});

export const playDrip = (freq = 620, intensity = .5, pan = 0) => play((context) => {
  const s = Math.min(1, Math.max(0, intensity));
  tone(context, { freq, glideTo: freq * 1.9, duration: .07 + s * .05, type: "sine", peak: .05 + s * .1, pan });
  noise(context, { duration: .05, freqFrom: 2600, freqTo: 1400, peak: .02 + s * .04, filterType: "bandpass", Q: 1.6, delay: .012, pan });
});
