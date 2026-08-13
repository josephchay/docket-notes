import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { NOTE_COLORS } from "../../constants/colors";
import { catenaryPath, catenaryBelly } from "../../utils/catenary";

import "./TagThreads.css";

// Which OTHER visible notes should be threaded to a given anchor: every
// note sharing at least one tag with it.
const relatedTo = (notes, id) => {
  const anchor = notes.find((note) => note.id === id);
  if (!anchor?.tags?.length) return { anchor: null, related: [] };

  const related = notes.filter((note) => note.id !== id && note.tags?.some((tag) => anchor.tags.includes(tag)));
  return { anchor, related };
};

// How taut the ink reads as it hangs — the real catenary parameter (see
// utils/catenary.js's own derivation), not a tuning knob dressed up as
// physics.
const CATENARY_K = 1.28;
const CATENARY_SAMPLES = 12;
const MAX_SAG = 70;
const HOP2_MAX_SAG = 46; // a fainter, tauter-reading echo than the real hop-1 relation

// A second hop out — notes sharing a tag with a related note, but not with
// the anchor itself — capped hard per anchor so a densely-tagged desk
// doesn't explode into a wall of ink the instant something's hovered.
const HOP2_MAX_PER_ANCHOR = 10;
const HOP2_STAGGER_S = .07; // each hop-2 thread ripples outward a beat after the last

// The harmonic pluck — the exact modal-decay recipe NoteConstellation.jsx's
// own thread-plucking already established (see its pluckEdge/PLUCK_OMEGA):
// a string struck at fraction p of its span takes mode n with amplitude
// ∝ sin(nπp)/n, the Fourier coefficients of the triangle a real pluck
// leaves — so an anchor-end pluck (p near 1) genuinely wriggles while a
// centered one rings mostly fundamental. catenaryPath was already built to
// take three such modes (wave/wave2/wave3) as standing-wave displacements;
// this file just never fed them anything but a fake idle sine before. Each
// mode gets its own frequency and its own damping (higher modes ring
// faster and die faster, same as a real struck string), so what shows up on
// screen is a genuine ring-down rather than a decorative loop — a resting,
// un-plucked thread now stays honestly still.
const MODE_OMEGA = [9, 18.5, 28]; // rad/s — roughly harmonic (1:2:3), detuned slightly so three plucked threads don't beat in exact sync
const MODE_DECAY = [1.5, 2.6, 3.8]; // 1/s
const PLUCK_MAX_AMP = 24; // px — caps runaway stacking from rapid re-plucks
const REST_EPSILON = .04; // px of combined modal amplitude below which a thread counts as "at rest"

const pluckState = () => ({ amp: [0, 0, 0], phase: [0, 0, 0] });

const pluck = (state, amount, p = .82) => {
  const pp = Math.max(.05, Math.min(.95, p));
  for (let n = 0; n < 3; n++) {
    const coeff = Math.abs(Math.sin((n + 1) * Math.PI * pp)) / (n + 1);
    state.amp[n] = Math.min(PLUCK_MAX_AMP / (n + 1), state.amp[n] + amount * coeff);
    state.phase[n] = 0;
  }
};

const stepState = (state, dt) => {
  let energy = 0;
  for (let n = 0; n < 3; n++) {
    state.phase[n] += MODE_OMEGA[n] * dt;
    state.amp[n] *= Math.exp(-MODE_DECAY[n] * dt);
    energy += state.amp[n] * state.amp[n];
  }
  return Math.sqrt(energy);
};

const waveTerms = (state) => [
  state.amp[0] * Math.cos(state.phase[0]),
  state.amp[1] * Math.cos(state.phase[1]),
  state.amp[2] * Math.cos(state.phase[2]),
];

// A pinned anchor's own marker — a small ring breathing at the note's
// center, the only visible trace of the desk's own click-and-shift gesture
// (see the pointerdown/capture-click effect below) once the pointer has
// moved on elsewhere.
const PIN_RING_R = 15;
const DROP_BASE_R = 3.2;
const DROP_ENERGY_GAIN = .34;
const DROP_MAX_R = 9;

// The gooey ink capillaries that bloom between a hovered (or pinned) note
// and every other visible note sharing a tag, out to a faint second hop —
// the same shared gooey-merge filter every other blob in the app already
// reuses (see Svg/GooeyEffectSvg, mounted once near the top of Home's
// tree), so each thread visually melts into a small drop at both ends
// rather than just terminating in a bare line. Shift-click a note to pin
// its whole web in place (Escape releases every pin at once); each thread
// only actually moves when something plucks it — a fresh bloom, another
// note reflowing past it, or a hop-2 ripple arriving from its own hop-1
// parent — and rings down like a real struck string rather than idling on
// a loop.
const TagThreads = ({ notes, hoveredId, containerRef, reduceMotion }) => {
  const [pinnedIds, setPinnedIds] = useState(() => new Set());
  const [pairs, setPairs] = useState([]);
  const [pinMarkers, setPinMarkers] = useState([]);

  const pathRefs = useRef({});
  const dropRefs = useRef({});
  const vibRef = useRef({});
  const prevEndRef = useRef({});
  const rafRef = useRef(0);

  // A note deleted out from under a pin shouldn't linger in the set forever.
  useEffect(() => {
    setPinnedIds((prev) => {
      const next = new Set([...prev].filter((id) => notes.some((note) => note.id === id)));
      return next.size === prev.size ? prev : next;
    });
  }, [notes]);

  // Shift-click a note to pin its web — a document-level CAPTURE listener
  // so this can veto the note's own click (open the editor) before it ever
  // reaches the note, rather than racing it in the bubble phase. Scoped to
  // notes actually inside this container, so it never reaches into other
  // views (pile, constellation) mounted elsewhere.
  useEffect(() => {
    const handleClick = (e) => {
      if (!e.shiftKey || !(e.target instanceof Element)) return;
      const container = containerRef.current;
      if (!container) return;

      const noteEl = e.target.closest("[data-note-id]");
      if (!noteEl || !container.contains(noteEl)) return;

      const id = noteEl.getAttribute("data-note-id");
      if (!id) return;

      e.preventDefault();
      e.stopPropagation();

      setPinnedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    };

    document.addEventListener("click", handleClick, { capture: true });
    return () => document.removeEventListener("click", handleClick, { capture: true });
  }, [containerRef]);

  // Escape releases every pin at once — deliberately no stopPropagation, so
  // whatever else on the desk also answers Escape this same keystroke still
  // gets to.
  useEffect(() => {
    if (pinnedIds.size === 0) return undefined;

    const handleKey = (e) => {
      if (e.key === "Escape") setPinnedIds(new Set());
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [pinnedIds.size]);

  const anchorIds = useMemo(() => {
    const ids = new Set(pinnedIds);
    if (hoveredId != null) ids.add(hoveredId);
    return [...ids].filter((id) => notes.some((note) => note.id === id));
  }, [hoveredId, pinnedIds, notes]);

  const anchorKey = anchorIds.join(",");

  // Rects are read straight off the DOM (the same [data-note-id] lookup the
  // rest of the desk already relies on for click/drag hit-testing) and
  // recomputed on resize/scroll/reflow for as long as any web is actually
  // showing.
  useEffect(() => {
    if (anchorIds.length === 0) {
      setPairs([]);
      setPinMarkers([]);
      vibRef.current = {};
      prevEndRef.current = {};
      return undefined;
    }

    const compute = (isReflow) => {
      const container = containerRef.current;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const centerOf = (id) => {
        const el = container.querySelector(`[data-note-id="${ id }"]`);
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2 - containerRect.left, y: rect.top + rect.height / 2 - containerRect.top };
      };

      const nextPairs = [];
      const nextMarkers = [];
      const seenAnchorMarkers = new Set();

      anchorIds.forEach((anchorId) => {
        const { anchor, related: hop1 } = relatedTo(notes, anchorId);
        const anchorCenter = centerOf(anchorId);
        if (!anchor || !anchorCenter) return;

        if (pinnedIds.has(anchorId) && !seenAnchorMarkers.has(anchorId)) {
          seenAnchorMarkers.add(anchorId);
          nextMarkers.push({ id: anchorId, x: anchorCenter.x, y: anchorCenter.y, color: anchor.color });
        }

        const hop1Ids = new Set(hop1.map((note) => note.id));

        hop1.forEach((note) => {
          const c = centerOf(note.id);
          if (!c) return;
          nextPairs.push({
            key: `${ anchorId }:${ note.id }`, gradId: `${ anchorId }-${ note.id }`, hop: 1,
            x1: anchorCenter.x, y1: anchorCenter.y, x2: c.x, y2: c.y,
            colorA: anchor.color, colorB: note.color, delay: 0,
          });
        });

        let hop2Count = 0;
        hop1.forEach((h1note) => {
          if (hop2Count >= HOP2_MAX_PER_ANCHOR) return;
          const h1Center = centerOf(h1note.id);
          if (!h1Center) return;

          const { related: hop2 } = relatedTo(notes, h1note.id);
          hop2
            .filter((note) => note.id !== anchorId && !hop1Ids.has(note.id))
            .forEach((h2note) => {
              if (hop2Count >= HOP2_MAX_PER_ANCHOR) return;
              const c2 = centerOf(h2note.id);
              if (!c2) return;

              hop2Count += 1;
              nextPairs.push({
                key: `${ anchorId }:${ h1note.id }:${ h2note.id }`, gradId: `${ anchorId }-${ h1note.id }-${ h2note.id }`, hop: 2,
                x1: h1Center.x, y1: h1Center.y, x2: c2.x, y2: c2.y,
                colorA: h1note.color, colorB: h2note.color, delay: hop2Count * HOP2_STAGGER_S,
              });
            });
        });
      });

      // Diff against what was already ringing: a pair that's genuinely new
      // gets plucked from its own anchor end (hop 1) or centered as an
      // arriving pulse (hop 2, matching the same p=0.5 "signal arrived from
      // elsewhere" convention NoteConstellation's own propagated pings
      // use); a pair that already existed but whose far end moved a real
      // distance (a note reflowing past it) gets a small centered pluck too
      // — a thread jostled by the desk reshuffling around it, not a fresh
      // relationship forming.
      const prevEnd = prevEndRef.current;
      const nextEnd = {};

      nextPairs.forEach((pair) => {
        let state = vibRef.current[pair.key];
        const isNew = !state;
        if (isNew) {
          state = pluckState();
          vibRef.current[pair.key] = state;
        }

        nextEnd[pair.key] = { x: pair.x2, y: pair.y2 };

        if (!reduceMotion) {
          if (isNew) {
            if (pair.hop === 1) {
              pluck(state, 10, .82);
            } else {
              const fire = () => pluck(state, 5, .5);
              if (pair.delay > 0) setTimeout(fire, pair.delay * 1000);
              else fire();
            }
          } else if (isReflow) {
            const prev = prevEnd[pair.key];
            if (prev) {
              const moved = Math.hypot(pair.x2 - prev.x, pair.y2 - prev.y);
              if (moved > 5) pluck(state, Math.min(6, moved * .18), .5);
            }
          }
        }
      });

      // Threads that no longer exist stop being tracked (rather than
      // leaking forever as the anchor set/tags change over a long session).
      Object.keys(vibRef.current).forEach((key) => {
        if (!nextPairs.some((pair) => pair.key === key)) delete vibRef.current[key];
      });
      prevEndRef.current = nextEnd;

      setPairs(nextPairs);
      setPinMarkers(nextMarkers);
    };

    compute(false);

    document.addEventListener("scroll", compute, { capture: true, passive: true });
    window.addEventListener("resize", compute);

    let settleTimer = null;
    const mutationObserver = new MutationObserver(() => {
      compute(false);
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => compute(true), 400);
    });
    mutationObserver.observe(containerRef.current, { childList: true, subtree: true });

    return () => {
      document.removeEventListener("scroll", compute, { capture: true });
      window.removeEventListener("resize", compute);
      mutationObserver.disconnect();
      clearTimeout(settleTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey, notes, reduceMotion]);

  // The per-frame ring-down — direct attribute writes (the same imperative,
  // no-React-state-per-frame technique Trash/TrashPhysics uses for its own
  // body sync), so this costs nothing while every thread is at rest and
  // never re-renders 60 times a second while one is actually ringing.
  useEffect(() => {
    if (reduceMotion || pairs.length === 0) return undefined;

    let last = performance.now();

    const tick = (now) => {
      const dt = Math.min(.05, (now - last) / 1000);
      last = now;

      pairs.forEach((pair) => {
        const state = vibRef.current[pair.key];
        if (!state) return;

        const energy = stepState(state, dt);
        const [w1, w2, w3] = waveTerms(state);
        const maxSag = pair.hop === 1 ? MAX_SAG : HOP2_MAX_SAG;

        const pathEl = pathRefs.current[pair.key];
        if (pathEl) {
          pathEl.setAttribute("d", catenaryPath(pair.x1, pair.y1, pair.x2, pair.y2, {
            k: CATENARY_K, samples: CATENARY_SAMPLES, maxSag, wave: w1, wave2: w2, wave3: w3,
          }));
        }

        const dropEl = dropRefs.current[pair.key];
        if (dropEl) {
          const belly = catenaryBelly(pair.x1, pair.y1, pair.x2, pair.y2, { k: CATENARY_K, maxSag, wave: w1, wave3: w3 });
          const r = energy < REST_EPSILON ? 0 : Math.min(DROP_MAX_R, DROP_BASE_R + energy * DROP_ENERGY_GAIN);
          dropEl.setAttribute("cx", belly.x);
          dropEl.setAttribute("cy", belly.y);
          dropEl.setAttribute("r", r);
        }
      });

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [pairs, reduceMotion]);

  return (
    <svg className="tag-threads" aria-hidden="true">
      <defs>
        {
          pairs.map((pair) => (
            <linearGradient
              key={ `grad-${ pair.key }` }
              id={ `tagThreadGradient-${ pair.gradId }` }
              x1={ pair.x1 } y1={ pair.y1 } x2={ pair.x2 } y2={ pair.y2 }
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor={ NOTE_COLORS[pair.colorA] || "var(--page-ink-color)" } />
              <stop offset="100%" stopColor={ NOTE_COLORS[pair.colorB] || "var(--page-ink-color)" } />
            </linearGradient>
          ))
        }
      </defs>
      <AnimatePresence>
        {
          pairs.filter((pair) => pair.hop === 2).map((pair) => (
            <motion.g
              key={ pair.key }
              className="tag-thread hop2"
              style={{ filter: "url(#gooey-effect)" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: .18 } }}
              transition={{ delay: pair.delay }}
            >
              <motion.path
                ref={ (el) => { if (el) pathRefs.current[pair.key] = el; else delete pathRefs.current[pair.key]; } }
                className="tag-thread-line hop2"
                d={ catenaryPath(pair.x1, pair.y1, pair.x2, pair.y2, { k: CATENARY_K, samples: CATENARY_SAMPLES, maxSag: HOP2_MAX_SAG }) }
                stroke={ `url(#tagThreadGradient-${ pair.gradId })` }
                initial={{ pathLength: reduceMotion ? 1 : 0 }}
                animate={{ pathLength: 1 }}
                transition={{ type: "spring", stiffness: 130, damping: 20, delay: pair.delay }}
              />
            </motion.g>
          ))
        }
      </AnimatePresence>
      <AnimatePresence>
        {
          pairs.filter((pair) => pair.hop === 1).map((pair, index) => (
            <motion.g
              key={ pair.key }
              className="tag-thread"
              style={{ filter: "url(#gooey-effect)" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: .18 } }}
            >
              <motion.path
                ref={ (el) => { if (el) pathRefs.current[pair.key] = el; else delete pathRefs.current[pair.key]; } }
                className="tag-thread-line"
                d={ catenaryPath(pair.x1, pair.y1, pair.x2, pair.y2, { k: CATENARY_K, samples: CATENARY_SAMPLES, maxSag: MAX_SAG }) }
                stroke={ `url(#tagThreadGradient-${ pair.gradId })` }
                initial={{ pathLength: reduceMotion ? 1 : 0 }}
                animate={{ pathLength: 1 }}
                transition={{ type: "spring", stiffness: 140, damping: 18, delay: index * .03 }}
              />
              <circle className="tag-thread-node" cx={ pair.x1 } cy={ pair.y1 } r="5" fill={ NOTE_COLORS[pair.colorA] } />
              <circle className="tag-thread-node" cx={ pair.x2 } cy={ pair.y2 } r="5" fill={ NOTE_COLORS[pair.colorB] } />
              <circle
                ref={ (el) => { if (el) dropRefs.current[pair.key] = el; else delete dropRefs.current[pair.key]; } }
                className="tag-thread-drop"
                cx={ pair.x2 } cy={ pair.y2 } r="0"
                fill={ `url(#tagThreadGradient-${ pair.gradId })` }
              />
            </motion.g>
          ))
        }
      </AnimatePresence>
      <AnimatePresence>
        {
          pinMarkers.map((marker) => (
            <motion.circle
              key={ `pin-${ marker.id }` }
              className="tag-thread-pin-ring"
              cx={ marker.x } cy={ marker.y } r={ PIN_RING_R }
              stroke={ NOTE_COLORS[marker.color] || "var(--page-ink-color)" }
              initial={{ opacity: 0, scale: .5 }}
              animate={{ opacity: [.55, .2, .55], scale: 1 }}
              exit={{ opacity: 0, scale: .5, transition: { duration: .2 } }}
              transition={ reduceMotion
                ? { duration: 0 }
                : { opacity: { duration: 1.8, repeat: Infinity, ease: "easeInOut" }, scale: { type: "spring", stiffness: 260, damping: 18 } } }
            />
          ))
        }
      </AnimatePresence>
    </svg>
  );
};

export default TagThreads;
