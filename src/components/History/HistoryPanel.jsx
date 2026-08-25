import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { interpret } from "xstate";
import gsap from "gsap";
import Lenis from "lenis";
import {
  FaXmark, FaClockRotateLeft, FaPlus, FaTrash, FaArrowRotateLeft, FaTrashCan,
  FaBoxArchive, FaFileArrowUp, FaCopy, FaPalette, FaUpDownLeftRight, FaStar,
  FaLock, FaTag, FaShuffle, FaPlay, FaPause, FaChevronLeft, FaChevronRight,
  FaBackwardStep, FaGaugeHigh, FaMagnifyingGlass, FaFileArrowDown,
  FaUpRightAndDownLeftFromCenter, FaDownLeftAndUpRightToCenter, FaThumbtack,
  FaCodeBranch, FaCircleNodes,
} from "react-icons/fa6";

import { timeAgo } from "../../utils/date";
import { smoothPath } from "../../utils/svgPath";
import { NOTE_COLORS } from "../../constants/colors";
import { playbackMachine, PLAYBACK_SPEEDS } from "./HistoryPlaybackState";
import SheetPanel from "../Sheet/SheetPanel";
import HistoryAmbient from "./HistoryAmbient";
import HistoryConstellation from "./HistoryConstellation";
import LiquidMeter from "../Meter/LiquidMeter";
import useOdometer from "../../hooks/useOdometer";
import { playHistoryAction, playTick } from "../../utils/sound";

import "./HistoryPanel.css";

// The event the command palette's "Show edit history" entry fires to
// summon this panel from anywhere.
export const HISTORY_EVENT = "docket:history";

// The waveform's own coordinate space — see smoothPath (utils/svgPath.js).
const WAVE_W = 400;
const WAVE_H = 40;

// Past this many tracked edits, ticks packed into a fixed-width rail sit
// only a few px apart — the rail becomes horizontally scrollable instead
// (see isLongSession below) with a zoomed-out minimap for overview/nav.
const LONG_SESSION_TICKS = 14;

// Shared by every top-level view .history-body can show (empty state,
// constellation, the linear timeline) — the outgoing one recedes before
// the incoming one expands in (see the AnimatePresence mode="wait" this
// feeds below), rather than the instant hard cut those three used to
// swap with.
const VIEW_TRANSITION = {
  initial: { opacity: 0, scale: .92, filter: "blur(6px)" },
  animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
  exit: { opacity: 0, scale: .94, filter: "blur(6px)", transition: { duration: .22 } },
  transition: { type: "spring", stiffness: 300, damping: 28 },
};

// Total title+text length across a set of notes — shared by the waveform's
// own magnitude below and both diff lines (step-over-step and vs-pinned).
const textSum = (notes) => notes.reduce(
  (sum, note) => sum + (note.title?.length || 0) + (note.text?.length || 0),
  0
);

// A cheap, honest proxy for "how much changed" at a given step — total
// text length across every note, differenced against the step before it, a
// flat weight per note gained or lost, and a smaller one for the trash
// gaining or losing entries (shredding/restoring/emptying don't touch the
// desk's own notes, so without this they'd read as flat).
export const magnitudeOf = (prev, next) => {
  const textDelta = Math.abs(textSum(next.notes) - textSum(prev.notes));
  const countDelta = Math.abs(next.notes.length - prev.notes.length) * 40;
  const trashDelta = Math.abs((next.deletedNotes?.length || 0) - (prev.deletedNotes?.length || 0)) * 15;
  return textDelta + countDelta + trashDelta;
};

// What actually happened, at a glance — every pushUndo label Home.jsx casts
// matched to its own icon and ink, so the rail tells the session's story in
// color before you ever read a word of it. `key`/`chipLabel` are only used
// by the activity list's filter chips (see availableCategories below) — the
// rail/preview/list all key off `test` alone.
const ACTION_STYLES = [
  { key: "poured", chipLabel: "Pours", test: (l) => l.startsWith("poured"), icon: FaPlus, color: "var(--green-color)" },
  { key: "deleted", chipLabel: "Deletes", test: (l) => l.startsWith("deleted"), icon: FaTrash, color: "var(--red-color)" },
  { key: "restored", chipLabel: "Restores", test: (l) => l.startsWith("restored"), icon: FaArrowRotateLeft, color: "var(--blue-color)" },
  { key: "shredded", chipLabel: "Shreds", test: (l) => l.startsWith("shredded"), icon: FaTrashCan, color: "var(--black-color)" },
  { key: "emptied", chipLabel: "Trash emptied", test: (l) => l.startsWith("emptied"), icon: FaBoxArchive, color: "var(--black-color)" },
  { key: "imported", chipLabel: "Imports", test: (l) => l.startsWith("imported"), icon: FaFileArrowUp, color: "var(--orange-color)" },
  { key: "duplicated", chipLabel: "Duplicates", test: (l) => l.startsWith("duplicated"), icon: FaCopy, color: "var(--blue-color)" },
  { key: "recolored", chipLabel: "Recolors", test: (l) => l.startsWith("recolored"), icon: FaPalette, color: "var(--purple-color)" },
  { key: "moved", chipLabel: "Moves", test: (l) => l.startsWith("moved"), icon: FaUpDownLeftRight, color: "var(--blue-color)" },
  { key: "starred", chipLabel: "Stars", test: (l) => l.startsWith("starred"), icon: FaStar, color: "var(--yellow-color)" },
  { key: "locked", chipLabel: "Locks", test: (l) => l.startsWith("locked"), icon: FaLock, color: "var(--gray-color)" },
  { key: "tagged", chipLabel: "Tags", test: (l) => l.startsWith("edited a tag"), icon: FaTag, color: "var(--purple-color)" },
  { key: "shuffled", chipLabel: "Shuffles", test: (l) => l.startsWith("shuffled"), icon: FaShuffle, color: "var(--gray-color)" },
];
export const DEFAULT_STYLE = { icon: FaClockRotateLeft, color: "var(--page-ink-color)" };

export const styleFor = (label) => ACTION_STYLES.find((s) => s.test(label)) || DEFAULT_STYLE;

// How many notes of each ink a given historical desk held — the hover
// preview's compact minimap.
const composeColors = (notes) => {
  const counts = {};
  notes.forEach((note) => { counts[note.color] = (counts[note.color] || 0) + 1; });
  return Object.keys(NOTE_COLORS)
    .map((name) => ({ name, count: counts[name] || 0 }))
    .filter((c) => c.count > 0);
};

export const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// The label shown wherever an "arrival" is described (a row, a tick's
// hover preview, a pinned chip, a constellation node). The synthetic "now"
// marker — timeline[cursor], freshly injected on every render in Home.jsx's
// own timeline useMemo — never carries a real edit label, since "now" isn't
// a pushUndo'd entry; the tick immediately after the live cursor always
// reads it as its own arrival whenever there's any redo history at all.
// Bare capitalize("now") read as "Now", easy to misread as marking the
// live position (which is a different tick entirely, one step back) —
// naming it "Redo point" instead says what it actually is: exactly where
// you were live before you started undoing.
export const arrivalLabel = (arrival) => {
  if (!arrival) return "The very start";
  return arrival.label === "now" ? "Redo point" : capitalize(arrival.label);
};

// Which individual notes changed between two moments — not just the
// aggregate +/- counts previewDiff/compareDiff already give. Also what the
// single-note history filter below tests a step against.
const diffNotes = (beforeNotes, afterNotes) => {
  const beforeMap = new Map(beforeNotes.map((n) => [n.id, n]));
  const afterMap = new Map(afterNotes.map((n) => [n.id, n]));
  const added = new Set();
  const removed = new Set();
  const changed = new Set();

  afterMap.forEach((note, noteId) => {
    const prev = beforeMap.get(noteId);
    if (!prev) added.add(noteId);
    else if (
      prev.color !== note.color || prev.title !== note.title || prev.text !== note.text ||
      prev.favorite !== note.favorite || prev.lock !== note.lock
    ) changed.add(noteId);
  });
  beforeMap.forEach((_note, noteId) => { if (!afterMap.has(noteId)) removed.add(noteId); });

  return { added, removed, changed };
};

// The undo/redo stack Home.jsx keeps, made visible — and, since every
// desk-changing action (pouring, editing, deleting, restoring, shredding,
// importing, the works) now pushes its own snapshot there, a complete one:
// one tick per tracked edit, oldest on the left, "now" marked, redone-away-
// from states (if any) trailing off to the right. Dragging anywhere on the
// rail scrubs live across the whole session — no stepping one Ctrl+Z at a
// time — landing wherever you let go; a transport bar underneath adds
// single-step buttons and a time-lapse autoplay for watching the session
// unfold hands-free. onPan reports pointer movement without framer laying
// a transform of its own onto the rail, so the playhead's rendered
// position stays a single, ordinary React value (cursor) the whole time;
// nothing here fights over who owns it.
const HistoryPanel = ({ timeline, cursor, onJump, branchStash = [], onRestoreBranch, reduceMotion }) => {
  const [open, setOpen] = useState(false);
  // User-controlled sizing rather than another fixed bump to the panel's
  // own dimensions — deliberately persists across closing/reopening within
  // the session, the same way a maximized window stays maximized, rather
  // than resetting every time like the search/filter state below does.
  const [maximized, setMaximized] = useState(false);
  // A fullscreen data-viz alternative to the two-pane rail/list/preview
  // below — every tracked edit as a node in a slowly-rotating spiral (see
  // HistoryConstellation.jsx), rather than more decoration on top of the
  // linear view. Resets on close, unlike `maximized`.
  const [constellation, setConstellation] = useState(false);
  const trackRef = useRef(null);
  const panelRef = useRef(null);

  // `reduceMotion` is now a prop — owned by Home.jsx alongside every other
  // real preference (theme, persistNotes) and surfaced in SettingsPanel.jsx,
  // rather than computed locally here. Still gates the same four largest/
  // most continuous motions this panel has grown across rounds 1–9: the
  // constellation's ambient spin, its cinematic tour's camera flight, its
  // gravity well, and the rail's elastic stretch (see each site below).

  // Hovering (or keyboard-focusing) any tick previews that moment in the
  // "now" readout above the rail — its label, time, and color makeup —
  // without actually jumping there; null falls back to the real cursor.
  const [hovered, setHovered] = useState(null);

  const [playbackService] = useState(() => interpret(playbackMachine));
  const [playPhase, setPlayPhase] = useState("idle");
  const [speedIndex, setSpeedIndex] = useState(playbackMachine.context.speedIndex);

  useEffect(() => {
    playbackService
      .onTransition((state) => {
        setPlayPhase(String(state.value));
        setSpeedIndex(state.context.speedIndex);
      })
      .start();

    return () => playbackService.stop();
  }, [playbackService]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(HISTORY_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(HISTORY_EVENT, handleSummon);
    };
  }, []);

  // Closing the panel mid-playback shouldn't leave it quietly stepping the
  // desk through history unseen.
  useEffect(() => {
    if (!open) playbackService.send("STOP");
  }, [open, playbackService]);

  // The constellation view resets on close (unlike `maximized`, which
  // persists) — reopening the panel always lands back on the familiar
  // rail/list view first.
  useEffect(() => {
    if (!open) setConstellation(false);
  }, [open]);

  const stopPlayback = () => playbackService.send("STOP");

  // Reads scrollWidth/scrollLeft rather than just the visible rect, so this
  // keeps working unchanged once the track becomes horizontally scrollable
  // past LONG_SESSION_TICKS below — when nothing overflows, scrollWidth
  // equals the visible width and scrollLeft is 0, so the math is identical
  // to before.
  const indexFromPoint = (x) => {
    const el = trackRef.current;
    if (!el || timeline.length < 2) return cursor;

    const rect = el.getBoundingClientRect();
    const contentWidth = el.scrollWidth || rect.width;
    if (contentWidth === 0) return cursor;

    const localX = x - rect.left + el.scrollLeft;
    const ratio = Math.min(Math.max(localX / contentWidth, 0), 1);
    return Math.round(ratio * (timeline.length - 1));
  };

  // Elastic rail stretch — the playhead visibly elongates (and squashes
  // vertically, the standard squash-and-stretch pairing) in the drag
  // direction while it's dragged fast, snapping back round the instant the
  // drag ends. info.velocity.x is already reported by framer's own pan
  // gesture; the spring is what turns that raw, jumpy per-event number
  // into something smooth to actually render from.
  const stretchMV = useMotionValue(0);
  const stretchSpring = useSpring(stretchMV, { stiffness: 300, damping: 20 });
  const playheadScaleX = useTransform(stretchSpring, (v) => 1 + Math.min(Math.abs(v), 1) * .6);
  const playheadScaleY = useTransform(stretchSpring, (v) => 1 - Math.min(Math.abs(v), 1) * .25);

  // Time-lapse playback narrates every step (see playHistoryAction above);
  // a manual scrub had no sound at all despite crossing the exact same
  // tracked steps. One playTick per step actually crossed — not per pan
  // event, which fires many times a second during a fast drag — reusing
  // the same small, flat acknowledgment pin/unpin already uses rather than
  // narrating with a full category cue, since a fast scrub can blow past
  // several steps in one drag and firing a distinct cue per one would just
  // be noise.
  const lastScrubIndexRef = useRef(cursor);

  const handlePanStart = () => {
    stopPlayback();
    lastScrubIndexRef.current = cursor;
  };

  const handlePan = (_e, info) => {
    const nextIndex = indexFromPoint(info.point.x);
    if (nextIndex !== lastScrubIndexRef.current) {
      lastScrubIndexRef.current = nextIndex;
      playTick();
    }
    onJump(nextIndex);
    if (!reduceMotion) stretchMV.set(Math.max(-1, Math.min(1, info.velocity.x / 900)));
  };
  const handleTrackClick = (e) => { stopPlayback(); onJump(indexFromPoint(e.clientX)); };

  // Touch has no hover, so a rail tick's own onMouseEnter/onFocus preview
  // below is unreachable by tap — and tapping a tick already jumps straight
  // there via its onClick, with no way to peek first the way a mouse user
  // gets for free by just hovering. Same gap the note-grid chips' own
  // tapChipPreview already closed elsewhere in this file; this is the same
  // fix applied to the rail instead of the grid — a touch hold past a short
  // threshold previews the tick (without jumping) rather than committing,
  // auto-dismissing itself the same way that chip preview already does
  // rather than needing a "tap elsewhere to close" listener. A quick tap
  // (released before the hold threshold) still jumps immediately, exactly
  // as it always has — this only ever adds a path, never removes the old
  // one, and mouse/keyboard users never touch any of it (gated on
  // e.pointerType === "touch").
  const touchPeekRef = useRef({ index: null, holdTimer: null, dismissTimer: null, longPress: false });

  const clearTouchPeek = () => {
    clearTimeout(touchPeekRef.current.holdTimer);
    clearTimeout(touchPeekRef.current.dismissTimer);
    touchPeekRef.current = { index: null, holdTimer: null, dismissTimer: null, longPress: false };
  };

  const handleTickPointerDown = (index, e) => {
    if (e.pointerType !== "touch") return;
    clearTouchPeek();
    touchPeekRef.current.index = index;
    touchPeekRef.current.holdTimer = setTimeout(() => {
      touchPeekRef.current.longPress = true;
      setHovered(index);
      touchPeekRef.current.dismissTimer = setTimeout(() => {
        setHovered((h) => (h === index ? null : h));
        touchPeekRef.current.longPress = false;
      }, 2600);
    }, 200);
  };

  const handleTickClick = (index, e) => {
    e.stopPropagation();
    // A long hold still fires exactly one click the instant the finger
    // lifts (release-without-moving is a click regardless of how long the
    // hold was) — so this is what tells a genuine long-press-then-release
    // apart from a genuine quick tap, both of which reach this same
    // handler. The former just dismisses the peek back to the live cursor;
    // it takes a second, separate tap afterward (a fresh pointerdown, by
    // which point longPress has already been reset below) to actually jump.
    const wasPeeking = touchPeekRef.current.longPress && touchPeekRef.current.index === index;
    clearTouchPeek();
    if (wasPeeking) {
      setHovered((h) => (h === index ? null : h));
      return;
    }
    stopPlayback();
    onJump(index);
  };

  useEffect(() => () => clearTouchPeek(), []);

  // The constellation's own branch restore (see graftBranch in
  // HistoryConstellation.jsx) already flies the branch node along its own
  // connecting line to the fork point it forked from, shrinking away as it
  // arrives, before actually restoring — this linear view's own "Restore"
  // button just called onRestoreBranch instantly with nothing to watch,
  // the one asymmetry left between the two views doing the exact same
  // thing. Mirrors that flight here instead of inventing a second
  // mechanism: a small ghost pill measured off the button itself (plain
  // getBoundingClientRect — a manual FLIP, not framer's layout animation,
  // since the ghost has to travel to a *different* element entirely) flies
  // to the rail tick it forked from and shrinks to a dot, landing tick
  // getting the same elastic "just arrived" bump HistoryConstellation's own
  // active-node glow already uses, before onRestoreBranch actually fires.
  const branchFlightTweenRef = useRef(null);
  const branchFlightGhostRef = useRef(null);

  const restoreBranch = (stash, e) => {
    stopPlayback();

    if (reduceMotion) {
      onRestoreBranch(stash.id);
      return;
    }

    const forkIndex = Math.min(stash.undoStack?.length ?? 0, timeline.length - 1);
    const tickEl = trackRef.current?.querySelector(`[data-tick-index="${ forkIndex }"]`);
    const fromRect = e.currentTarget.getBoundingClientRect();

    if (!tickEl) {
      onRestoreBranch(stash.id);
      return;
    }
    const toRect = tickEl.getBoundingClientRect();

    branchFlightTweenRef.current?.kill();
    branchFlightGhostRef.current?.remove();

    const ghost = document.createElement("div");
    ghost.className = "history-branch-flight-ghost";
    ghost.style.left = `${ fromRect.left }px`;
    ghost.style.top = `${ fromRect.top }px`;
    ghost.style.width = `${ fromRect.width }px`;
    ghost.style.height = `${ fromRect.height }px`;
    document.body.appendChild(ghost);
    branchFlightGhostRef.current = ghost;

    branchFlightTweenRef.current = gsap.to(ghost, {
      left: toRect.left + toRect.width / 2 - 5,
      top: toRect.top + toRect.height / 2 - 5,
      width: 10,
      height: 10,
      borderRadius: 999,
      opacity: 0,
      duration: .5,
      ease: "power2.in",
      onComplete: () => {
        ghost.remove();
        branchFlightGhostRef.current = null;
        gsap.fromTo(
          tickEl,
          { scale: 1 },
          { scale: 1.6, duration: .5, ease: "elastic.out(1, .55)", onComplete: () => gsap.set(tickEl, { clearProps: "transform" }) }
        );
        onRestoreBranch(stash.id);
      },
    });
  };

  useEffect(() => () => {
    branchFlightTweenRef.current?.kill();
    branchFlightGhostRef.current?.remove();
  }, []);

  // Every OTHER entry's label describes the edit that turned it into the
  // next one, so the entry right before a given index is the one whose
  // label describes how the desk arrived there; nothing before index 0
  // means there's nowhere further back to have arrived from. Generalized
  // over any index (not just the live cursor) so the hover preview can
  // reuse the exact same reading.
  const describedArrival = (index) => (index > 0 ? timeline[index - 1] : null);

  const pct = timeline.length > 1 ? (cursor / (timeline.length - 1)) * 100 : 0;
  const stepsAhead = timeline.length > 0 ? timeline.length - 1 - cursor : 0;

  // Past the threshold, the rail below scrolls horizontally instead of
  // compressing every tick into a fixed width — this minimap is the
  // zoomed-out overview + quick-nav for that scrolled state.
  const isLongSession = timeline.length > LONG_SESSION_TICKS;
  const [minimapViewport, setMinimapViewport] = useState({ left: 0, width: 100 });

  // Real momentum scrolling for the rail once it's actually a horizontal
  // scroller (see isLongSession above) — .history-track sets touch-action:
  // none (so the playhead's own framer pan gesture below doesn't fight the
  // browser's native touch scroll underneath it), which as a side effect
  // silently blocks native touch flicking on the rail too. Lenis drives
  // scrollLeft itself off its own pointer handling rather than the
  // browser's native touch-scroll path, so it works fine despite that, and
  // (per Lenis's own scroll-event contract, the same one useLenisScroll.jsx
  // already relies on for the vertical desk) keeps dispatching real native
  // `scroll` events the whole time — nothing downstream (the minimap
  // viewport effect right below) needs to know it's there.
  const lenisRef = useRef(null);

  useEffect(() => {
    // Gated on `open` too, not just isLongSession — this file's other
    // panel-lifetime effects (playbackService/constellation resets) already
    // keep the same convention. Without it a session past 14 tracked edits
    // would leave Lenis attached the entire time the app is open, panel
    // closed or not.
    if (!open || !isLongSession || reduceMotion) return;
    const el = trackRef.current;
    const content = el?.firstElementChild;
    if (!el || !content) return;

    const lenis = new Lenis({
      wrapper: el,
      content,
      // eventsTarget defaults to `window` — without pinning it to the rail
      // itself, this would capture wheel/touch input for the whole page
      // the instant a long session made isLongSession true, not just input
      // actually over the rail.
      eventsTarget: el,
      orientation: "horizontal",
      // "horizontal" (rather than "both") would only ever look at
      // deltaX, silently ignoring a plain vertical mouse-wheel scroll
      // (deltaY) entirely — the overwhelmingly common case. "both" reads
      // whichever axis actually has the bigger delta each event, so an
      // ordinary wheel drives the rail exactly like a horizontal trackpad
      // swipe or a touch drag already would.
      gestureOrientation: "both",
      smoothWheel: true,
    });
    lenisRef.current = lenis;

    const raf = (time) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);

    return () => {
      gsap.ticker.remove(raf);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, [open, isLongSession, reduceMotion]);

  useEffect(() => {
    if (!isLongSession) return;
    const el = trackRef.current;
    if (!el) return;

    const update = () => {
      const contentWidth = el.scrollWidth || 1;
      setMinimapViewport({
        left: (el.scrollLeft / contentWidth) * 100,
        width: Math.min(100, (el.clientWidth / contentWidth) * 100),
      });
    };

    update();
    el.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [isLongSession, timeline.length]);

  const handleMinimapClick = (e) => {
    const el = trackRef.current;
    if (!el) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    const target = ratio * el.scrollWidth - el.clientWidth / 2;
    // Lenis owns scrollLeft frame-to-frame while it's active — a plain
    // el.scrollTo would just get overwritten the next tick, the same
    // "route position writes through Lenis" reasoning useLenisScroll.jsx's
    // own ScrollTrigger.scrollerProxy already applies to the vertical desk.
    if (lenisRef.current) lenisRef.current.scrollTo(target, { immediate: false });
    else el.scrollTo({ left: target, behavior: "smooth" });
  };

  const previewIndex = hovered ?? cursor;
  const previewEntry = timeline[previewIndex];
  const previewArrival = previewEntry ? describedArrival(previewIndex) : null;
  const previewStyle = previewArrival ? styleFor(previewArrival.label) : DEFAULT_STYLE;
  const PreviewIcon = previewStyle.icon;
  const previewColors = previewEntry ? composeColors(previewEntry.notes) : [];

  // A brief liquid ripple over the note-grid every time the previewed
  // moment changes — GSAP driving an SVG feDisplacementMap's own `scale`
  // attribute (the #history-liquid filter defined further down), the same
  // feTurbulence-based "boiling" technique SketchRing.jsx's tour ring and
  // LiquidTextFilter.jsx already use elsewhere, just animated directly
  // through GSAP here instead of a continuous seed-reroll.
  const liquidDisplaceRef = useRef(null);

  useEffect(() => {
    if (!liquidDisplaceRef.current) return;

    gsap.fromTo(
      liquidDisplaceRef.current,
      { attr: { scale: 26 } },
      { attr: { scale: 0 }, duration: .45, ease: "power3.out", overwrite: "auto" }
    );
  }, [previewIndex]);

  // What that one step actually changed — real arithmetic against the step
  // right before it, surfaced as a readable line instead of folded into one
  // opacity value like the waveform does. null for index 0, which has
  // nothing to diff.
  const previewDiff = useMemo(() => {
    if (previewIndex <= 0 || !timeline[previewIndex - 1]) return null;

    const before = timeline[previewIndex - 1].notes;
    const after = previewEntry.notes;

    return {
      countDelta: after.length - before.length,
      textDelta: textSum(after) - textSum(before),
    };
  }, [timeline, previewIndex, previewEntry]);

  // Pin & compare: any moment from the list can be pinned independent of
  // the live hover/cursor preview above, so the right pane can show a diff
  // between two arbitrary points in the session rather than only ever
  // consecutive ones.
  const [pinned, setPinned] = useState(null);

  const pinnedEntry = pinned !== null ? timeline[pinned] : null;
  const pinnedArrival = pinnedEntry ? describedArrival(pinned) : null;
  const pinnedStyle = pinnedArrival ? styleFor(pinnedArrival.label) : DEFAULT_STYLE;
  const PinnedIcon = pinnedStyle.icon;
  const pinnedLabel = arrivalLabel(pinnedArrival);

  // A second, independent pin — `pinned` above stays "the anchor" of the
  // comparison (it's left alone once set), this is whichever moment got
  // pinned after it. Kept as a fully parallel, additive slot rather than
  // reshaping `pinned` into an array, so none of the code already reading
  // `pinned`/`pinnedEntry`/`compareDiff` above needs to change.
  const [secondPinned, setSecondPinned] = useState(null);

  const secondPinnedEntry = secondPinned !== null ? timeline[secondPinned] : null;
  const secondPinnedArrival = secondPinnedEntry ? describedArrival(secondPinned) : null;
  const secondPinnedStyle = secondPinnedArrival ? styleFor(secondPinnedArrival.label) : DEFAULT_STYLE;
  const SecondPinnedIcon = secondPinnedStyle.icon;
  const secondPinnedLabel = arrivalLabel(secondPinnedArrival);

  const secondCompareDiff = useMemo(() => {
    if (!secondPinnedEntry || !previewEntry) return null;

    return {
      countDelta: previewEntry.notes.length - secondPinnedEntry.notes.length,
      textDelta: textSum(previewEntry.notes) - textSum(secondPinnedEntry.notes),
    };
  }, [secondPinnedEntry, previewEntry]);

  // Toggles whichever slot makes sense for a given row: already pinned
  // (either slot) unpins it; otherwise it fills `pinned` first, then
  // `secondPinned`, then replaces `secondPinned` (the more recently added
  // of the two) once both are full.
  const togglePin = (index) => {
    playTick();
    if (pinned === index) { setPinned(null); return; }
    if (secondPinned === index) { setSecondPinned(null); return; }
    if (pinned === null) { setPinned(index); return; }
    setSecondPinned(index);
  };

  const compareDiff = useMemo(() => {
    if (!pinnedEntry || !previewEntry) return null;

    return {
      countDelta: previewEntry.notes.length - pinnedEntry.notes.length,
      textDelta: textSum(previewEntry.notes) - textSum(pinnedEntry.notes),
    };
  }, [pinnedEntry, previewEntry]);

  // Rolled via anime.js rather than snapped straight to the new figure —
  // see useOdometer. Called unconditionally (hooks can't be conditional);
  // the ?? 0 fallback is harmless since the chips it feeds stay gated
  // behind `previewDiff &&`/`compareDiff &&` below regardless.
  const displayedEditCount = useOdometer(timeline.length - 1);
  const displayedPreviewCountDelta = useOdometer(previewDiff?.countDelta ?? 0);
  const displayedCompareCountDelta = useOdometer(compareDiff?.countDelta ?? 0);
  const displayedSecondCompareCountDelta = useOdometer(secondCompareDiff?.countDelta ?? 0);

  // Which individual notes actually changed, not just the aggregate counts
  // above — vs the step right before, or vs the pin when one's set. The
  // live grid below reads whichever of these is active to ring added/
  // changed chips and surface ghost chips for anything removed.
  const previewNoteDiff = useMemo(() => {
    // Same convention as previewDiff above: index 0 has nothing before it
    // to diff against, so this is "no diff" (null), not "everything in it
    // just got added" — diffing against [] here instead would ring every
    // note on the desk at that point as newly added, which it wasn't.
    if (!previewEntry || previewIndex <= 0 || !timeline[previewIndex - 1]) return null;
    return diffNotes(timeline[previewIndex - 1].notes, previewEntry.notes);
  }, [timeline, previewIndex, previewEntry]);

  const compareNoteDiff = useMemo(() => {
    if (!pinnedEntry || !previewEntry) return null;
    return diffNotes(pinnedEntry.notes, previewEntry.notes);
  }, [pinnedEntry, previewEntry]);

  const activeNoteDiff = pinnedEntry ? compareNoteDiff : previewNoteDiff;
  const activeBeforeNotes = pinnedEntry
    ? pinnedEntry.notes
    : (previewIndex > 0 && timeline[previewIndex - 1] ? timeline[previewIndex - 1].notes : []);
  const removedNotes = activeNoteDiff
    ? activeBeforeNotes.filter((note) => activeNoteDiff.removed.has(note.id))
    : [];

  // Isolating one note's own story: clicking any chip (in either grid)
  // filters the activity list below to only the steps that actually
  // touched it. Reset alongside query/activeFilter/pinned on open (see the
  // effect further down).
  const [focusNoteId, setFocusNoteId] = useState(null);
  const toggleFocusNote = (noteId) => setFocusNoteId((prev) => (prev === noteId ? null : noteId));

  // A richer floating preview replacing the plain browser tooltip on note
  // chips — fixed positioning (rather than a portal) is what keeps it from
  // ever being clipped by .history-right-pane's or .history-list's own
  // scroll/overflow, regardless of which grid triggered it.
  const [hoveredChip, setHoveredChip] = useState(null);

  // Keeps the popover's own box (200px wide, CSS's own translate(14px,
  // 14px) offset baked in here rather than duplicated in CSS) fully
  // within the viewport rather than following the raw pointer position —
  // otherwise a chip hovered near the right or bottom edge (routine on a
  // narrow/phone-width window) would render it partly or fully off-screen.
  const clampChipPreview = (x, y) => ({
    x: Math.min(x, Math.max(0, window.innerWidth - 214)),
    y: Math.min(y, Math.max(0, window.innerHeight - 150)),
  });

  const showChipPreview = (note, e) => {
    const p = clampChipPreview(e.clientX, e.clientY);
    setHoveredChip({ note, x: p.x, y: p.y });
  };
  const moveChipPreview = (e) => setHoveredChip((prev) => {
    if (!prev) return prev;
    const p = clampChipPreview(e.clientX, e.clientY);
    return { ...prev, x: p.x, y: p.y };
  });
  const hideChipPreview = () => setHoveredChip(null);

  // Touch has no hover state, so the popover above — the only way left to
  // see a chip's title/text/color since the plain title= tooltip was
  // replaced by it — would otherwise be completely unreachable by tap.
  // Tapping now shows it too, auto-dismissing itself shortly after rather
  // than needing a "tap elsewhere to close" listener; harmless for mouse
  // users, who've typically already seen it via hover before the click
  // lands anyway.
  const chipPreviewTimeoutRef = useRef(null);
  const tapChipPreview = (note, e) => {
    showChipPreview(note, e);
    if (chipPreviewTimeoutRef.current) clearTimeout(chipPreviewTimeoutRef.current);
    // Only clears the popover if it's still showing the same chip that was
    // tapped — on a hybrid touch+mouse device, a mouse hover over a
    // *different* chip landing inside this 3.2s window would otherwise get
    // wiped out by a stale timeout left over from the earlier tap.
    const tappedId = note.id;
    chipPreviewTimeoutRef.current = setTimeout(() => {
      setHoveredChip((current) => (current?.note?.id === tappedId ? null : current));
    }, 3200);
  };

  useEffect(() => () => {
    if (chipPreviewTimeoutRef.current) clearTimeout(chipPreviewTimeoutRef.current);
  }, []);

  // The focused note can drop out of whatever moment is currently
  // previewed while scrubbing elsewhere — scan the whole timeline, newest
  // first, for the last place it's still known.
  const focusNoteLabel = useMemo(() => {
    if (!focusNoteId) return null;
    for (let i = timeline.length - 1; i >= 0; i--) {
      const note = timeline[i].notes.find((n) => n.id === focusNoteId);
      if (note) return { color: note.color, text: note.title?.trim() || note.text?.trim()?.slice(0, 40) || "Untitled note" };
    }
    return null;
  }, [focusNoteId, timeline]);

  // How much each tracked step actually changed — shared by the waveform
  // below and the right pane's own liquid magnitude gauge (see
  // previewMagnitudeRatio further down), so both read "how big was this
  // step" off the exact same numbers rather than two separate passes.
  const magnitudes = useMemo(() => (
    timeline.map((entry, index) => (index === 0 ? 0 : magnitudeOf(timeline[index - 1], entry)))
  ), [timeline]);
  const maxSessionMagnitude = Math.max(1, ...magnitudes);

  const wavePath = useMemo(() => {
    if (timeline.length < 2) return "";

    const baselineY = WAVE_H - 6;
    const usableH = baselineY - 6;

    const points = magnitudes.map((magnitude, index) => ({
      x: (index / (timeline.length - 1)) * WAVE_W,
      y: baselineY - (magnitude / maxSessionMagnitude) * usableH,
    }));

    return smoothPath(points);
  }, [timeline, magnitudes, maxSessionMagnitude]);

  // "How big was this step," as an actual fill level rather than another
  // number — reuses LiquidMeter.jsx (until now only ever mounted in
  // Header's ink-levels popover) off the exact same magnitudes/
  // maxSessionMagnitude the waveform above already computes, so the two
  // stay honest about what "big" means at a glance instead of drifting.
  // Fires the meter's own milestone pulse whenever the previewed step
  // happens to be the single largest one this session actually had — a
  // literal splash for the biggest edit you've made, not a synthetic one.
  const previewMagnitudeRatio = previewIndex > 0 ? magnitudes[previewIndex] / maxSessionMagnitude : 0;
  const isBiggestStep = previewIndex > 0 && magnitudes[previewIndex] === maxSessionMagnitude;

  // The activity list: every timeline entry, newest first, read the exact
  // same way the rail's ticks and the "now" preview already are — the
  // entry right before a given index names the edit that arrived at it.
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState(null); // null = "All"

  // A fresh search/filter/pin every time the panel opens, the same "fresh
  // sheet" reasoning CommandPalette.jsx already applies to its own query —
  // unlike `maximized` above, which deliberately persists.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveFilter(null);
      setPinned(null);
      setSecondPinned(null);
      setFocusNoteId(null);
    }
  }, [open]);

  const rows = useMemo(() => {
    return timeline
      .map((entry, index) => {
        const arrival = describedArrival(index);
        const style = arrival ? styleFor(arrival.label) : DEFAULT_STYLE;
        const category = arrival ? ACTION_STYLES.find((s) => s.test(arrival.label)) : null;

        return {
          index,
          entry,
          style,
          categoryKey: category?.key ?? null,
          label: arrivalLabel(arrival),
          time: arrival ? timeAgo(arrival.at) : "session start",
        };
      })
      .reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline]);

  // Only chips for categories this session actually contains — a short
  // session might only ever show three or four, not all thirteen.
  const availableCategories = useMemo(() => {
    const present = new Set(rows.map((row) => row.categoryKey).filter(Boolean));
    return ACTION_STYLES.filter((s) => present.has(s.key));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();

    return rows.filter((row) => {
      if (activeFilter && row.categoryKey !== activeFilter) return false;
      if (q && !row.label.toLowerCase().includes(q)) return false;

      if (focusNoteId) {
        const before = row.index > 0 ? timeline[row.index - 1].notes : [];
        const stepDiff = diffNotes(before, row.entry.notes);
        if (!stepDiff.added.has(focusNoteId) && !stepDiff.removed.has(focusNoteId) && !stepDiff.changed.has(focusNoteId)) {
          return false;
        }
      }

      return true;
    });
  }, [rows, activeFilter, query, focusNoteId, timeline]);

  // Lets the constellation view dim nodes that don't match the same
  // search/category filter the activity list already applies — null (no
  // dimming) when neither is active, rather than every node reading as
  // "matched." Deliberately independent of focusNoteId above — a single-
  // note focus is its own, separate lens, not folded into this one.
  const visibleIndices = useMemo(() => {
    if (!query.trim() && !activeFilter) return null;
    return new Set(
      rows
        .filter((row) => {
          if (activeFilter && row.categoryKey !== activeFilter) return false;
          const q = query.trim().toLowerCase();
          if (q && !row.label.toLowerCase().includes(q)) return false;
          return true;
        })
        .map((row) => row.index)
    );
  }, [rows, activeFilter, query]);

  // Time-lapse: one tracked step forward per tick of the current speed
  // while playing, stopping itself the instant it reaches "now" — the
  // advance is just another onJump, so it rides the exact same spring,
  // waveform, and preview reactions a manual scrub already gets for free.
  // Narrated by sound (see utils/sound.js's playHistoryAction): whichever
  // action's own cue matches the step being landed on, right as it lands —
  // this single effect is what actually drives `cursor` forward whether the
  // constellation or the linear rail is the one currently on screen, so one
  // call here narrates a time-lapse in either view without a second, only
  // half-distinct cue layered on top from the constellation's own tour
  // effect. Reads timeline[cursor+1] — the destination itself — not
  // timeline[cursor]: that position is always the synthetic "now" marker
  // (see the timeline useMemo above; it sits at exactly index `cursor` on
  // every render, unconditionally), which never matches any ACTION_STYLES
  // category, so a step's real label lives on the entry actually being
  // advanced onto, the same place performRedo's own stamp message
  // ("Redid: …") already reads it from.
  useEffect(() => {
    if (playPhase !== "playing") return;

    if (cursor >= timeline.length - 1) {
      playbackService.send("DONE");
      return;
    }

    const ms = PLAYBACK_SPEEDS[speedIndex].ms;
    const timer = setTimeout(() => {
      const arrival = timeline[cursor + 1];
      const category = arrival ? ACTION_STYLES.find((s) => s.test(arrival.label)) : null;
      playHistoryAction(category?.key);
      onJump(cursor + 1);
    }, ms);
    return () => clearTimeout(timer);
    // timeline's own reference is deliberately left out — only .length is
    // watched, same as before this effect read timeline[cursor] too; the
    // undo stack this reads from only ever grows, so .length alone is
    // already a reliable proxy for "the array actually changed."
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playPhase, cursor, timeline.length, speedIndex, onJump, playbackService]);

  const togglePlay = () => {
    if (playPhase === "playing") {
      playbackService.send("STOP");
    } else {
      if (cursor >= timeline.length - 1) onJump(0); // caught up — replay from the top
      playbackService.send("PLAY");
    }
  };

  const restart = () => { stopPlayback(); onJump(0); };
  const stepBack = () => { stopPlayback(); onJump(cursor - 1); };
  const stepForward = () => { stopPlayback(); onJump(cursor + 1); };

  // Downloads the tracked session as a JSON file — the same Blob + anchor-
  // click pattern Home.jsx's own exportNotes/bulkExport already use, built
  // entirely off the timeline prop this panel already has.
  const exportHistory = () => {
    const payload = timeline.map((entry, index) => {
      const arrival = describedArrival(index);
      return {
        step: index,
        label: arrival ? arrival.label : "session start",
        at: arrival ? new Date(arrival.at).toISOString() : null,
        noteCount: entry.notes.length,
        trashCount: entry.deletedNotes?.length ?? 0,
      };
    });

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `docket-history-${ new Date().toISOString().slice(0, 10) }.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const jumpToLatest = () => { stopPlayback(); onJump(timeline.length - 1); };

  // Keyboard navigation, active only while open — a separate effect from
  // the Escape-handling one above (which keeps its own empty deps array)
  // since this one's handlers genuinely change every render. Guarded the
  // same way ShortcutsSheet.jsx's own global shortcuts are, so typing (or
  // arrowing through text) in the search box above is never hijacked.
  useEffect(() => {
    if (!open) return;

    const handleKey = (e) => {
      if (e.target instanceof Element && e.target.closest("input, textarea")) return;
      if (timeline.length < 2) return;

      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        stepBack();
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        stepForward();
      } else if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "Home") {
        e.preventDefault();
        restart();
      } else if (e.key === "End") {
        e.preventDefault();
        jumpToLatest();
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, timeline.length, stepBack, stepForward, togglePlay, restart, jumpToLatest]);

  return (
    <SheetPanel
      open={ open }
      onClose={ () => setOpen(false) }
      panelRef={ panelRef }
      radius={ 22 }
      layerClassName="history-layer"
      backdropClassName="history-backdrop"
      panelClassName={ `history-panel ${ maximized ? "maximized" : "" }` }
      ariaLabel="Edit history"
    >
              <svg className="history-liquid-defs" aria-hidden="true">
                <defs>
                  <filter id="history-liquid" x="-20%" y="-20%" width="140%" height="140%">
                    <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="4" result="noise" />
                    <feDisplacementMap ref={ liquidDisplaceRef } in="SourceGraphic" in2="noise" scale="0" />
                  </filter>
                </defs>
              </svg>
              <div className="history-header">
                <div className="history-header-title">
                  <h3>Edit history</h3>
                  {
                    timeline.length > 1 && (
                      <span className="history-header-count">
                        { displayedEditCount } edit{ displayedEditCount === 1 ? "" : "s" }
                      </span>
                    )
                  }
                </div>
                <div className="history-header-actions">
                  {
                    timeline.length > 1 && (
                      <motion.button
                        type="button"
                        aria-label={ constellation ? "Back to the timeline view" : "View the session as a constellation" }
                        title={ constellation ? "Back to timeline" : "Constellation view" }
                        className={ `history-constellation-toggle ${ constellation ? "active" : "" }` }
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: .9 }}
                        transition={{ type: "spring", stiffness: 420, damping: 16 }}
                        onClick={ () => setConstellation((prev) => !prev) }
                      >
                        <FaCircleNodes />
                      </motion.button>
                    )
                  }
                  <motion.button
                    type="button"
                    aria-label={ maximized ? "Restore the panel to its normal size" : "Maximize the panel" }
                    title={ maximized ? "Restore" : "Maximize" }
                    className="history-maximize"
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: .9 }}
                    transition={{ type: "spring", stiffness: 420, damping: 16 }}
                    onClick={ () => setMaximized((prev) => !prev) }
                  >
                    <AnimatePresence mode="wait" initial={ false }>
                      <motion.span
                        key={ maximized ? "restore" : "grow" }
                        initial={{ scale: 0, rotate: -30, opacity: 0 }}
                        animate={{ scale: 1, rotate: 0, opacity: 1 }}
                        exit={{ scale: 0, rotate: 30, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 420, damping: 16 }}
                        style={{ display: "flex" }}
                      >
                        { maximized ? <FaDownLeftAndUpRightToCenter /> : <FaUpRightAndDownLeftFromCenter /> }
                      </motion.span>
                    </AnimatePresence>
                  </motion.button>
                  {
                    timeline.length > 1 && (
                      <motion.button
                        type="button"
                        aria-label="Download the session's edit history as a JSON file"
                        title="Export history"
                        className="history-export"
                        whileHover={{ scale: 1.06 }}
                        whileTap={{ scale: .94 }}
                        transition={{ type: "spring", stiffness: 420, damping: 16 }}
                        onClick={ exportHistory }
                      >
                        <FaFileArrowDown className="history-export-icon" />
                        <span className="history-export-label">Export</span>
                      </motion.button>
                    )
                  }
                  <motion.button
                    type="button"
                    aria-label="Close"
                    className="history-close"
                    whileHover={{ scale: 1.15, rotate: 90 }}
                    whileTap={{ scale: .9 }}
                    transition={{ type: "spring", stiffness: 420, damping: 16 }}
                    onClick={ () => setOpen(false) }
                  >
                    <FaXmark />
                  </motion.button>
                </div>
              </div>

              <div className="history-body">
                <AnimatePresence mode="wait">
                {
                  timeline.length < 2 ? (
                    <motion.div key="empty" className="history-empty" { ...VIEW_TRANSITION }>
                      <FaClockRotateLeft className="history-empty-icon" />
                      <p>Nothing tracked yet this session — edit a note or two.</p>
                    </motion.div>
                  ) : constellation ? (
                    <motion.div key="constellation" className="history-constellation-wrap" { ...VIEW_TRANSITION }>
                      <motion.button
                        type="button"
                        className="history-constellation-back"
                        whileHover={{ scale: 1.04 }}
                        whileTap={{ scale: .96 }}
                        transition={{ type: "spring", stiffness: 420, damping: 16 }}
                        onClick={ () => setConstellation(false) }
                      >
                        <FaChevronLeft /> Back to timeline
                      </motion.button>
                      <motion.button
                        type="button"
                        aria-label={ playPhase === "playing" ? "Pause the tour" : "Play a cinematic tour" }
                        title={ playPhase === "playing" ? "Pause the tour" : "Play a cinematic tour" }
                        className="history-constellation-play"
                        whileHover={{ scale: 1.08 }}
                        whileTap={{ scale: .92 }}
                        transition={{ type: "spring", stiffness: 380, damping: 16 }}
                        onClick={ togglePlay }
                      >
                        <AnimatePresence mode="wait" initial={ false }>
                          <motion.span
                            key={ playPhase }
                            initial={{ scale: 0, rotate: -30, opacity: 0 }}
                            animate={{ scale: 1, rotate: 0, opacity: 1 }}
                            exit={{ scale: 0, rotate: 30, opacity: 0 }}
                            transition={{ type: "spring", stiffness: 420, damping: 16 }}
                            style={{ display: "flex" }}
                          >
                            { playPhase === "playing" ? <FaPause /> : <FaPlay /> }
                          </motion.span>
                        </AnimatePresence>
                      </motion.button>
                      <HistoryConstellation
                        timeline={ timeline }
                        cursor={ cursor }
                        branchStash={ branchStash }
                        onJump={ (index) => { stopPlayback(); onJump(index); } }
                        onRestoreBranch={ onRestoreBranch }
                        touring={ playPhase === "playing" }
                        visibleIndices={ visibleIndices }
                        reduceMotion={ reduceMotion }
                      />
                    </motion.div>
                  ) : (
                    <motion.div key="timeline" className="history-timeline-view" { ...VIEW_TRANSITION }>
                    <div className="history-left-rail">
                    <div className="history-controls">
                      <motion.div
                        key={ `${ previewIndex }-${ hovered !== null ? "preview" : "live" }` }
                        className={ `history-now ${ hovered !== null ? "previewing" : "" }` }
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ type: "spring", stiffness: 500, damping: 26 }}
                      >
                        <span className="history-now-icon" style={{ "--action-color": previewStyle.color }}>
                          <PreviewIcon />
                        </span>
                        <span className="history-now-text">
                          <span className="history-now-label">
                            { arrivalLabel(previewArrival) }
                          </span>
                          <span className="history-now-time">
                            { previewArrival ? timeAgo(previewArrival.at) : "session start" }
                          </span>
                        </span>
                        {
                          previewEntry && (
                            <span className="history-now-swatches">
                              {
                                previewColors.length > 0
                                  ? previewColors.map((c) => (
                                    <span
                                      key={ c.name }
                                      className={ `history-now-swatch ${ c.name }-bg` }
                                      title={ `${ c.count } ${ c.name }` }
                                    >
                                      { c.count }
                                    </span>
                                  ))
                                  : <span className="history-now-swatch-empty">Empty desk</span>
                              }
                            </span>
                          )
                        }
                      </motion.div>

                      <div className="history-transport">
                        <motion.button
                          type="button"
                          aria-label="Jump to the very start"
                          className="history-transport-btn"
                          disabled={ cursor === 0 }
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: .88 }}
                          transition={{ type: "spring", stiffness: 420, damping: 17 }}
                          onClick={ restart }
                        >
                          <FaBackwardStep />
                        </motion.button>
                        <motion.button
                          type="button"
                          aria-label="Step back one edit"
                          className="history-transport-btn"
                          disabled={ cursor === 0 }
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: .88 }}
                          transition={{ type: "spring", stiffness: 420, damping: 17 }}
                          onClick={ stepBack }
                        >
                          <FaChevronLeft />
                        </motion.button>
                        <motion.button
                          type="button"
                          aria-label={ playPhase === "playing" ? "Pause the time-lapse" : "Play the session as a time-lapse" }
                          className="history-play"
                          whileHover={{ scale: 1.08 }}
                          whileTap={{ scale: .9 }}
                          transition={{ type: "spring", stiffness: 380, damping: 16 }}
                          onClick={ togglePlay }
                        >
                          <AnimatePresence mode="wait" initial={ false }>
                            <motion.span
                              key={ playPhase }
                              initial={{ scale: 0, rotate: -30, opacity: 0 }}
                              animate={{ scale: 1, rotate: 0, opacity: 1 }}
                              exit={{ scale: 0, rotate: 30, opacity: 0 }}
                              transition={{ type: "spring", stiffness: 420, damping: 16 }}
                            >
                              { playPhase === "playing" ? <FaPause /> : <FaPlay /> }
                            </motion.span>
                          </AnimatePresence>
                        </motion.button>
                        <motion.button
                          type="button"
                          aria-label="Step forward one edit"
                          className="history-transport-btn"
                          disabled={ cursor >= timeline.length - 1 }
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: .88 }}
                          transition={{ type: "spring", stiffness: 420, damping: 17 }}
                          onClick={ stepForward }
                        >
                          <FaChevronRight />
                        </motion.button>
                        <motion.button
                          type="button"
                          aria-label={ `Time-lapse speed: ${ PLAYBACK_SPEEDS[speedIndex].label } — press to change` }
                          className="history-speed"
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: .92 }}
                          transition={{ type: "spring", stiffness: 420, damping: 17 }}
                          onClick={ () => playbackService.send("CYCLE_SPEED") }
                        >
                          <FaGaugeHigh />
                          { PLAYBACK_SPEEDS[speedIndex].label }
                        </motion.button>
                      </div>

                      <div
                        ref={ trackRef }
                        className="history-track"
                        onClick={ handleTrackClick }
                      >
                        <div
                          className="history-track-content"
                          style={ isLongSession ? { minWidth: `${ timeline.length * 26 }px` } : undefined }
                        >
                          <div className="history-track-rail" />
                          {
                            stepsAhead > 0 && (
                              <div className="history-track-rail-ahead" style={{ left: `${ pct }%` }} />
                            )
                          }
                          <svg
                            className="history-wave"
                            viewBox={ `0 0 ${ WAVE_W } ${ WAVE_H }` }
                            preserveAspectRatio="none"
                            aria-hidden="true"
                          >
                            <motion.path
                              className="history-wave-line"
                              d={ wavePath }
                              initial={{ pathLength: 0, opacity: 0 }}
                              animate={{ pathLength: 1, opacity: .22 }}
                              transition={{ duration: .7, ease: "easeInOut" }}
                            />
                          </svg>
                          {
                            timeline.map((entry, index) => {
                              const style = styleFor(describedArrival(index)?.label ?? "");

                              return (
                                <button
                                  key={ index }
                                  type="button"
                                  data-tick-index={ index }
                                  className={ `history-tick ${ index === cursor ? "active" : "" } ${ entry.label === "now" ? "is-now" : "" } ${ index > cursor ? "redoable" : "" }` }
                                  style={{ left: `${ timeline.length > 1 ? (index / (timeline.length - 1)) * 100 : 0 }%`, "--tick-color": style.color }}
                                  title={ entry.label === "now" ? "Right now" : entry.label }
                                  onClick={ (e) => handleTickClick(index, e) }
                                  onPointerDown={ (e) => handleTickPointerDown(index, e) }
                                  onMouseEnter={ () => setHovered(index) }
                                  onMouseLeave={ () => setHovered((h) => (h === index ? null : h)) }
                                  onFocus={ () => setHovered(index) }
                                  onBlur={ () => setHovered((h) => (h === index ? null : h)) }
                                />
                              );
                            })
                          }
                          <motion.div
                            className="history-playhead"
                            animate={{ left: `${ pct }%` }}
                            style={{ scaleX: playheadScaleX, scaleY: playheadScaleY }}
                            transition={{ type: "spring", stiffness: 500, damping: 32 }}
                            onPanStart={ handlePanStart }
                            onPan={ handlePan }
                            onPanEnd={ () => stretchMV.set(0) }
                          />
                          <AnimatePresence>
                            {
                              hovered !== null && timeline[hovered] && (
                                <motion.div
                                  className="history-rail-thumb"
                                  style={{ left: `${ timeline.length > 1 ? (hovered / (timeline.length - 1)) * 100 : 0 }%` }}
                                  initial={{ opacity: 0, y: 6, scale: .85 }}
                                  animate={{ opacity: 1, y: 0, scale: 1 }}
                                  exit={{ opacity: 0, y: 6, scale: .85 }}
                                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                >
                                  <div className="history-rail-thumb-grid">
                                    {
                                      timeline[hovered].notes.length > 0 ? (
                                        timeline[hovered].notes.map((note) => (
                                          <span
                                            key={ note.id }
                                            className={ `history-rail-thumb-chip ${ note.color }-bg` }
                                          />
                                        ))
                                      ) : (
                                        <span className="history-rail-thumb-empty">Empty</span>
                                      )
                                    }
                                  </div>
                                  <div className="history-rail-thumb-count">
                                    { timeline[hovered].notes.length } { timeline[hovered].notes.length === 1 ? "note" : "notes" }
                                  </div>
                                </motion.div>
                              )
                            }
                          </AnimatePresence>
                        </div>
                      </div>

                      {
                        isLongSession && (
                          <div className="history-minimap" onClick={ handleMinimapClick }>
                            {
                              timeline.map((entry, index) => {
                                const style = styleFor(describedArrival(index)?.label ?? "");
                                return (
                                  <span
                                    key={ index }
                                    className="history-minimap-tick"
                                    style={{ left: `${ timeline.length > 1 ? (index / (timeline.length - 1)) * 100 : 0 }%`, "--tick-color": style.color }}
                                  />
                                );
                              })
                            }
                            <div
                              className="history-minimap-viewport"
                              style={{ left: `${ minimapViewport.left }%`, width: `${ minimapViewport.width }%` }}
                            />
                          </div>
                        )
                      }

                      <div className="history-track-labels">
                        <span>Oldest</span>
                        <AnimatePresence mode="wait" initial={ false }>
                          {
                            stepsAhead > 0 ? (
                              <motion.span
                                key="ahead"
                                className="history-branch-pill"
                                initial={{ opacity: 0, scale: .6 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: .6 }}
                                transition={{ type: "spring", stiffness: 460, damping: 18 }}
                              >
                                { stepsAhead } step{ stepsAhead === 1 ? "" : "s" } ahead
                              </motion.span>
                            ) : (
                              <motion.span
                                key="now"
                                initial={{ opacity: 0, scale: .6 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: .6 }}
                                transition={{ type: "spring", stiffness: 460, damping: 18 }}
                              >
                                Now
                              </motion.span>
                            )
                          }
                        </AnimatePresence>
                      </div>

                      {
                        branchStash.length > 0 && (
                          <div className="history-branches">
                            <div className="history-branches-label">
                              <FaCodeBranch />
                              { branchStash.length } stashed { branchStash.length === 1 ? "branch" : "branches" }
                            </div>
                            <div className="history-branches-list">
                              {
                                [...branchStash].reverse().map((stash) => (
                                  <div key={ stash.id } className="history-branch-row">
                                    <span className="history-branch-row-text">
                                      <span className="history-branch-row-label">{ capitalize(stash.label) }</span>
                                      <span className="history-branch-row-time">
                                        { timeAgo(stash.at) } · { stash.redoStack.length } step{ stash.redoStack.length === 1 ? "" : "s" }
                                      </span>
                                    </span>
                                    <motion.button
                                      type="button"
                                      className="history-branch-restore"
                                      whileHover={{ scale: 1.06 }}
                                      whileTap={{ scale: .94 }}
                                      transition={{ type: "spring", stiffness: 420, damping: 16 }}
                                      onClick={ (e) => restoreBranch(stash, e) }
                                    >
                                      Restore
                                    </motion.button>
                                  </div>
                                ))
                              }
                            </div>
                          </div>
                        )
                      }
                    </div>

                    <div className="history-list-region">
                      <AnimatePresence>
                        {
                          focusNoteId && focusNoteLabel && (
                            <motion.div
                              className="history-focus-banner"
                              initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                              animate={{ opacity: 1, height: "auto", marginBottom: 10 }}
                              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                              transition={{ type: "spring", stiffness: 420, damping: 32 }}
                            >
                              <span className="history-focus-chip">
                                <span className={ `history-focus-swatch ${ focusNoteLabel.color }-bg` } />
                                Showing history for "{ focusNoteLabel.text }"
                              </span>
                              <motion.button
                                type="button"
                                className="history-focus-clear"
                                aria-label="Clear this note's history filter"
                                whileHover={{ scale: 1.15 }}
                                whileTap={{ scale: .9 }}
                                transition={{ type: "spring", stiffness: 420, damping: 16 }}
                                onClick={ () => setFocusNoteId(null) }
                              >
                                <FaXmark />
                              </motion.button>
                            </motion.div>
                          )
                        }
                      </AnimatePresence>
                      <div className="history-filter-row">
                        <div className="history-search">
                          <FaMagnifyingGlass className="history-search-icon" />
                          <input
                            type="text"
                            placeholder="Search edits…"
                            value={ query }
                            onChange={ (e) => setQuery(e.target.value) }
                          />
                        </div>
                        {
                          availableCategories.length > 0 && (
                            <div className="history-chips">
                              <button
                                type="button"
                                className={ `history-chip ${ activeFilter === null ? "active" : "" }` }
                                onClick={ () => setActiveFilter(null) }
                              >
                                {
                                  activeFilter === null && (
                                    <motion.span
                                      layoutId="historyChipThumb"
                                      className="history-chip-thumb"
                                      transition={{ type: "spring", stiffness: 480, damping: 19 }}
                                    />
                                  )
                                }
                                <span>All</span>
                              </button>
                              {
                                availableCategories.map((category) => (
                                  <button
                                    key={ category.key }
                                    type="button"
                                    className={ `history-chip ${ activeFilter === category.key ? "active" : "" }` }
                                    onClick={ () => setActiveFilter(activeFilter === category.key ? null : category.key) }
                                  >
                                    {
                                      activeFilter === category.key && (
                                        <motion.span
                                          layoutId="historyChipThumb"
                                          className="history-chip-thumb"
                                          transition={{ type: "spring", stiffness: 480, damping: 19 }}
                                        />
                                      )
                                    }
                                    <category.icon className="history-chip-icon" />
                                    <span>{ category.chipLabel }</span>
                                  </button>
                                ))
                              }
                            </div>
                          )
                        }
                      </div>

                      <div className="history-list">
                        <AnimatePresence initial={ false }>
                          {
                            filteredRows.length > 0 ? (
                              filteredRows.map((row) => (
                                <motion.div
                                  key={ row.index }
                                  role="button"
                                  tabIndex={ 0 }
                                  layout
                                  className={ `history-row ${ row.index === cursor ? "active" : "" }` }
                                  style={{ "--row-color": row.style.color }}
                                  initial={{ opacity: 0, x: -10 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  exit={{ opacity: 0, scale: .92 }}
                                  transition={{ type: "spring", stiffness: 420, damping: 32 }}
                                  onClick={ () => { stopPlayback(); onJump(row.index); } }
                                  onKeyDown={ (e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      stopPlayback();
                                      onJump(row.index);
                                    }
                                  } }
                                  onMouseEnter={ () => setHovered(row.index) }
                                  onMouseLeave={ () => setHovered((h) => (h === row.index ? null : h)) }
                                >
                                  <span className="history-row-icon">
                                    <row.style.icon />
                                  </span>
                                  <span className="history-row-text">
                                    <span className="history-row-label">{ row.label }</span>
                                    <span className="history-row-time">{ row.time }</span>
                                  </span>
                                  <span className="history-row-swatches">
                                    {
                                      composeColors(row.entry.notes).slice(0, 6).map((c) => (
                                        <span
                                          key={ c.name }
                                          className={ `history-row-swatch ${ c.name }-bg` }
                                          title={ `${ c.count } ${ c.name }` }
                                        />
                                      ))
                                    }
                                  </span>
                                  <motion.button
                                    type="button"
                                    className={ `history-row-pin ${ pinned === row.index ? "active" : "" } ${ secondPinned === row.index ? "active-secondary" : "" }` }
                                    aria-label={ pinned === row.index || secondPinned === row.index ? "Unpin this moment" : "Pin this moment to compare" }
                                    title={ pinned === row.index || secondPinned === row.index ? "Unpin" : "Pin to compare" }
                                    whileHover={{ scale: 1.2 }}
                                    whileTap={{ scale: .85 }}
                                    transition={{ type: "spring", stiffness: 420, damping: 16 }}
                                    onClick={ (e) => { e.stopPropagation(); togglePin(row.index); } }
                                  >
                                    {/* A real push-pin gesture rather than a plain bounce: pinning
                                        springs the thumbtack down from a lifted, tilted angle with a
                                        bouncy overshoot, like it's actually being pushed in; unpinning
                                        flicks it back up and out the same way it'd be plucked free. */}
                                    <AnimatePresence mode="wait" initial={ false }>
                                      <motion.span
                                        key={ pinned === row.index || secondPinned === row.index ? "pinned" : "unpinned" }
                                        initial={{ rotate: -55, y: -6, scale: .4, opacity: 0 }}
                                        animate={{ rotate: 0, y: 0, scale: 1, opacity: 1 }}
                                        exit={{ rotate: 45, y: -5, scale: .5, opacity: 0, transition: { duration: .12, ease: "easeIn" } }}
                                        transition={{ type: "spring", stiffness: 480, damping: 13 }}
                                        style={{ display: "flex" }}
                                      >
                                        <FaThumbtack />
                                      </motion.span>
                                    </AnimatePresence>
                                  </motion.button>
                                </motion.div>
                              ))
                            ) : (
                              <div className="history-row-empty">Nothing matches that search</div>
                            )
                          }
                        </AnimatePresence>
                      </div>
                    </div>
                    </div>

                    <div className="history-right-pane">
                      {
                        previewEntry ? (
                          <>
                            <HistoryAmbient color={ previewStyle.color } reduceMotion={ reduceMotion } />
                            <div className="history-preview-header">
                              <span className="history-preview-icon" style={{ "--action-color": previewStyle.color }}>
                                <PreviewIcon />
                              </span>
                              <span className="history-preview-text">
                                <span className="history-preview-label">
                                  { arrivalLabel(previewArrival) }
                                </span>
                                <span className="history-preview-time">
                                  { previewArrival ? timeAgo(previewArrival.at) : "session start" }
                                </span>
                              </span>
                              {
                                previewIndex > 0 && (
                                  <div className="history-preview-magnitude">
                                    <LiquidMeter
                                      ratio={ previewMagnitudeRatio }
                                      color={ previewStyle.color }
                                      label="This step"
                                      reduceMotion={ reduceMotion }
                                      celebration={ isBiggestStep ? { key: `biggest-${ previewIndex }` } : null }
                                    />
                                  </div>
                                )
                              }
                            </div>

                            {
                              previewDiff && (
                                <div className="history-preview-diff">
                                  <span
                                    className={ `history-preview-diff-chip ${ previewDiff.countDelta > 0 ? "positive" : previewDiff.countDelta < 0 ? "negative" : "" }` }
                                  >
                                    { displayedPreviewCountDelta > 0 ? `+${ displayedPreviewCountDelta }` : displayedPreviewCountDelta } note{ Math.abs(displayedPreviewCountDelta) === 1 ? "" : "s" }
                                  </span>
                                  <span className="history-preview-diff-chip">
                                    text { previewDiff.textDelta > 0 ? `+${ previewDiff.textDelta }` : previewDiff.textDelta } chars
                                  </span>
                                </div>
                              )
                            }

                            {
                              pinnedEntry && (
                                <>
                                  <div className="history-pin-banner">
                                    <span className="history-pin-chip">
                                      <span className="history-pin-chip-icon" style={{ "--action-color": pinnedStyle.color }}>
                                        <PinnedIcon />
                                      </span>
                                      Pinned: { pinnedLabel }
                                    </span>
                                    <motion.button
                                      type="button"
                                      className="history-pin-clear"
                                      aria-label="Unpin"
                                      whileHover={{ scale: 1.15 }}
                                      whileTap={{ scale: .9 }}
                                      transition={{ type: "spring", stiffness: 420, damping: 16 }}
                                      onClick={ () => setPinned(null) }
                                    >
                                      <FaXmark />
                                    </motion.button>
                                  </div>

                                  {
                                    compareDiff && (
                                      <div className="history-preview-diff">
                                        <span
                                          className={ `history-preview-diff-chip ${ compareDiff.countDelta > 0 ? "positive" : compareDiff.countDelta < 0 ? "negative" : "" }` }
                                        >
                                          { displayedCompareCountDelta > 0 ? `+${ displayedCompareCountDelta }` : displayedCompareCountDelta } note{ Math.abs(displayedCompareCountDelta) === 1 ? "" : "s" } vs pinned
                                        </span>
                                        <span className="history-preview-diff-chip">
                                          text { compareDiff.textDelta > 0 ? `+${ compareDiff.textDelta }` : compareDiff.textDelta } chars vs pinned
                                        </span>
                                      </div>
                                    )
                                  }

                                  <div className="history-preview-grid-label">
                                    Pinned — { pinnedEntry.notes.length } { pinnedEntry.notes.length === 1 ? "note" : "notes" }
                                  </div>

                                  <div className="history-note-grid">
                                    {
                                      pinnedEntry.notes.length > 0 ? (
                                        pinnedEntry.notes.map((note) => (
                                          <motion.span
                                            key={ note.id }
                                            role="button"
                                            tabIndex={ 0 }
                                            layout
                                            className={ `history-note-chip ${ note.color }-bg ${ note.id === focusNoteId ? "focused" : "" }` }
                                            onClick={ (e) => { toggleFocusNote(note.id); tapChipPreview(note, e); } }
                                            onKeyDown={ (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleFocusNote(note.id); } } }
                                            onMouseEnter={ (e) => showChipPreview(note, e) }
                                            onMouseMove={ moveChipPreview }
                                            onMouseLeave={ hideChipPreview }
                                          />
                                        ))
                                      ) : (
                                        <span className="history-row-empty">Nothing on the desk yet</span>
                                      )
                                    }
                                  </div>
                                </>
                              )
                            }

                            {
                              secondPinnedEntry && (
                                <>
                                  <div className="history-pin-banner history-pin-banner-secondary">
                                    <span className="history-pin-chip">
                                      <span className="history-pin-chip-icon" style={{ "--action-color": secondPinnedStyle.color }}>
                                        <SecondPinnedIcon />
                                      </span>
                                      Pinned: { secondPinnedLabel }
                                    </span>
                                    <motion.button
                                      type="button"
                                      className="history-pin-clear"
                                      aria-label="Unpin"
                                      whileHover={{ scale: 1.15 }}
                                      whileTap={{ scale: .9 }}
                                      transition={{ type: "spring", stiffness: 420, damping: 16 }}
                                      onClick={ () => setSecondPinned(null) }
                                    >
                                      <FaXmark />
                                    </motion.button>
                                  </div>

                                  {
                                    secondCompareDiff && (
                                      <div className="history-preview-diff">
                                        <span
                                          className={ `history-preview-diff-chip ${ secondCompareDiff.countDelta > 0 ? "positive" : secondCompareDiff.countDelta < 0 ? "negative" : "" }` }
                                        >
                                          { displayedSecondCompareCountDelta > 0 ? `+${ displayedSecondCompareCountDelta }` : displayedSecondCompareCountDelta } note{ Math.abs(displayedSecondCompareCountDelta) === 1 ? "" : "s" } vs pinned
                                        </span>
                                        <span className="history-preview-diff-chip">
                                          text { secondCompareDiff.textDelta > 0 ? `+${ secondCompareDiff.textDelta }` : secondCompareDiff.textDelta } chars vs pinned
                                        </span>
                                      </div>
                                    )
                                  }

                                  <div className="history-preview-grid-label">
                                    Pinned — { secondPinnedEntry.notes.length } { secondPinnedEntry.notes.length === 1 ? "note" : "notes" }
                                  </div>

                                  <div className="history-note-grid">
                                    {
                                      secondPinnedEntry.notes.length > 0 ? (
                                        secondPinnedEntry.notes.map((note) => (
                                          <motion.span
                                            key={ note.id }
                                            role="button"
                                            tabIndex={ 0 }
                                            layout
                                            className={ `history-note-chip ${ note.color }-bg ${ note.id === focusNoteId ? "focused" : "" }` }
                                            onClick={ (e) => { toggleFocusNote(note.id); tapChipPreview(note, e); } }
                                            onKeyDown={ (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleFocusNote(note.id); } } }
                                            onMouseEnter={ (e) => showChipPreview(note, e) }
                                            onMouseMove={ moveChipPreview }
                                            onMouseLeave={ hideChipPreview }
                                          />
                                        ))
                                      ) : (
                                        <span className="history-row-empty">Nothing on the desk yet</span>
                                      )
                                    }
                                  </div>
                                </>
                              )
                            }

                            <div className="history-preview-grid-label">
                              {
                                previewEntry.notes.length > 0
                                  ? `${ pinned !== null || secondPinned !== null ? "Now previewing" : "The desk" } — ${ previewEntry.notes.length } ${ previewEntry.notes.length === 1 ? "note" : "notes" }`
                                  : (pinned !== null || secondPinned !== null ? "Now previewing" : "The desk")
                              }
                            </div>

                            <div className="history-note-grid">
                              <AnimatePresence initial={ false }>
                                {
                                  previewEntry.notes.length > 0 || removedNotes.length > 0 ? (
                                    <>
                                      {
                                        previewEntry.notes.map((note, i) => {
                                          const diffClass = activeNoteDiff?.added.has(note.id)
                                            ? "diff-added"
                                            : activeNoteDiff?.changed.has(note.id) ? "diff-changed" : "";

                                          return (
                                            <motion.span
                                              key={ note.id }
                                              role="button"
                                              tabIndex={ 0 }
                                              layout
                                              className={ `history-note-chip ${ note.color }-bg ${ diffClass } ${ note.id === focusNoteId ? "focused" : "" }` }
                                              initial={{ opacity: 0, scale: .4 }}
                                              animate={{ opacity: 1, scale: 1 }}
                                              exit={{ opacity: 0, scale: .4 }}
                                              transition={{ type: "spring", stiffness: 460, damping: 20, delay: Math.min(i * .012, .3) }}
                                              onClick={ (e) => { toggleFocusNote(note.id); tapChipPreview(note, e); } }
                                              onKeyDown={ (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleFocusNote(note.id); } } }
                                              onMouseEnter={ (e) => showChipPreview(note, e) }
                                              onMouseMove={ moveChipPreview }
                                              onMouseLeave={ hideChipPreview }
                                            />
                                          );
                                        })
                                      }
                                      {
                                        removedNotes.map((note) => (
                                          <motion.span
                                            key={ `removed-${ note.id }` }
                                            role="button"
                                            tabIndex={ 0 }
                                            layout
                                            className={ `history-note-chip diff-removed ${ note.color }-bg ${ note.id === focusNoteId ? "focused" : "" }` }
                                            initial={{ opacity: 0, scale: .4 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            exit={{ opacity: 0, scale: .4 }}
                                            transition={{ type: "spring", stiffness: 460, damping: 20 }}
                                            onClick={ (e) => { toggleFocusNote(note.id); tapChipPreview({ ...note, removed: true }, e); } }
                                            onKeyDown={ (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleFocusNote(note.id); } } }
                                            onMouseEnter={ (e) => showChipPreview({ ...note, removed: true }, e) }
                                            onMouseMove={ moveChipPreview }
                                            onMouseLeave={ hideChipPreview }
                                          />
                                        ))
                                      }
                                    </>
                                  ) : (
                                    <span className="history-row-empty">Nothing on the desk yet</span>
                                  )
                                }
                              </AnimatePresence>
                            </div>
                          </>
                        ) : (
                          <div className="history-preview-empty">
                            <FaClockRotateLeft className="history-preview-empty-icon" />
                            <p>Hover or scrub the rail to preview a moment</p>
                          </div>
                        )
                      }
                    </div>
                    </motion.div>
                  )
                }
                </AnimatePresence>
              </div>
              {
                createPortal(
                  <AnimatePresence>
                    {
                      hoveredChip && (
                        <motion.div
                          className="history-chip-preview"
                          style={{ left: hoveredChip.x, top: hoveredChip.y }}
                          initial={{ opacity: 0, scale: .85, y: 6 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: .85, y: 6 }}
                          transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        >
                          <div className="history-chip-preview-header">
                            <span className={ `history-chip-preview-swatch ${ hoveredChip.note.color }-bg` } />
                            {
                              hoveredChip.note.favorite && <FaStar className="history-chip-preview-icon" />
                            }
                            {
                              hoveredChip.note.lock && <FaLock className="history-chip-preview-icon" />
                            }
                            {
                              hoveredChip.note.removed && <span className="history-chip-preview-tag">Removed</span>
                            }
                          </div>
                          <div className="history-chip-preview-title">
                            { hoveredChip.note.title?.trim() || "Untitled note" }
                          </div>
                          {
                            hoveredChip.note.text?.trim() && (
                              <div className="history-chip-preview-text">
                                { hoveredChip.note.text.trim().slice(0, 160) }
                              </div>
                            )
                          }
                        </motion.div>
                      )
                    }
                  </AnimatePresence>,
                  document.body
                )
              }
    </SheetPanel>
  );
};

export default HistoryPanel;
