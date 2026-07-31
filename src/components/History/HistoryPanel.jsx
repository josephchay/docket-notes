import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { interpret } from "xstate";
import {
  FaXmark, FaClockRotateLeft, FaPlus, FaTrash, FaArrowRotateLeft, FaTrashCan,
  FaBoxArchive, FaFileArrowUp, FaCopy, FaPalette, FaUpDownLeftRight, FaStar,
  FaLock, FaTag, FaShuffle, FaPlay, FaPause, FaChevronLeft, FaChevronRight,
  FaBackwardStep, FaGaugeHigh, FaMagnifyingGlass, FaFileArrowDown,
} from "react-icons/fa6";

import { timeAgo } from "../../utils/date";
import { smoothPath } from "../../utils/svgPath";
import { NOTE_COLORS } from "../../constants/colors";
import { playbackMachine, PLAYBACK_SPEEDS } from "./HistoryPlaybackState";
import useBlobClipMorph from "../../hooks/useBlobClipMorph";

import "./HistoryPanel.css";

// The event the command palette's "Show edit history" entry fires to
// summon this panel from anywhere.
export const HISTORY_EVENT = "docket:history";

// The waveform's own coordinate space — see smoothPath (utils/svgPath.js).
const WAVE_W = 400;
const WAVE_H = 40;

// A cheap, honest proxy for "how much changed" at a given step — total
// title+text length across every note, differenced against the step
// before it, a flat weight per note gained or lost, and a smaller one for
// the trash gaining or losing entries (shredding/restoring/emptying don't
// touch the desk's own notes, so without this they'd read as flat).
const magnitudeOf = (prev, next) => {
  const textSum = (notes) => notes.reduce(
    (sum, note) => sum + (note.title?.length || 0) + (note.text?.length || 0),
    0
  );

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
const DEFAULT_STYLE = { icon: FaClockRotateLeft, color: "var(--page-ink-color)" };

const styleFor = (label) => ACTION_STYLES.find((s) => s.test(label)) || DEFAULT_STYLE;

// How many notes of each ink a given historical desk held — the hover
// preview's compact minimap.
const composeColors = (notes) => {
  const counts = {};
  notes.forEach((note) => { counts[note.color] = (counts[note.color] || 0) + 1; });
  return Object.keys(NOTE_COLORS)
    .map((name) => ({ name, count: counts[name] || 0 }))
    .filter((c) => c.count > 0);
};

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

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
const HistoryPanel = ({ timeline, cursor, onJump }) => {
  const [open, setOpen] = useState(false);
  const trackRef = useRef(null);
  const panelRef = useRef(null);

  // The dot-to-sheet morph clips through a real organic blob stage
  // (utils/blob.js's flubber-powered createBlobMorph) on top of the scale
  // spring below.
  const onBlobUpdate = useBlobClipMorph(panelRef, open, 22);

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

  const stopPlayback = () => playbackService.send("STOP");

  const indexFromPoint = (x) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || timeline.length < 2) return cursor;

    const ratio = Math.min(Math.max((x - rect.left) / rect.width, 0), 1);
    return Math.round(ratio * (timeline.length - 1));
  };

  const handlePan = (_e, info) => { stopPlayback(); onJump(indexFromPoint(info.point.x)); };
  const handleTrackClick = (e) => { stopPlayback(); onJump(indexFromPoint(e.clientX)); };

  // Every OTHER entry's label describes the edit that turned it into the
  // next one, so the entry right before a given index is the one whose
  // label describes how the desk arrived there; nothing before index 0
  // means there's nowhere further back to have arrived from. Generalized
  // over any index (not just the live cursor) so the hover preview can
  // reuse the exact same reading.
  const describedArrival = (index) => (index > 0 ? timeline[index - 1] : null);

  const pct = timeline.length > 1 ? (cursor / (timeline.length - 1)) * 100 : 0;
  const stepsAhead = timeline.length > 0 ? timeline.length - 1 - cursor : 0;

  const previewIndex = hovered ?? cursor;
  const previewEntry = timeline[previewIndex];
  const previewArrival = previewEntry ? describedArrival(previewIndex) : null;
  const previewStyle = previewArrival ? styleFor(previewArrival.label) : DEFAULT_STYLE;
  const PreviewIcon = previewStyle.icon;
  const previewColors = previewEntry ? composeColors(previewEntry.notes) : [];

  // What that one step actually changed — real arithmetic against the step
  // right before it (the same textSum reasoning magnitudeOf already uses
  // for the waveform, surfaced here as a readable line instead of folded
  // into one opacity value). null for index 0, which has nothing to diff.
  const previewDiff = useMemo(() => {
    if (previewIndex <= 0 || !timeline[previewIndex - 1]) return null;

    const textSum = (notes) => notes.reduce(
      (sum, note) => sum + (note.title?.length || 0) + (note.text?.length || 0),
      0
    );

    const before = timeline[previewIndex - 1].notes;
    const after = previewEntry.notes;

    return {
      countDelta: after.length - before.length,
      textDelta: textSum(after) - textSum(before),
    };
  }, [timeline, previewIndex, previewEntry]);

  const wavePath = useMemo(() => {
    if (timeline.length < 2) return "";

    const magnitudes = timeline.map((entry, index) =>
      index === 0 ? 0 : magnitudeOf(timeline[index - 1], entry)
    );
    const maxMagnitude = Math.max(1, ...magnitudes);
    const baselineY = WAVE_H - 6;
    const usableH = baselineY - 6;

    const points = magnitudes.map((magnitude, index) => ({
      x: (index / (timeline.length - 1)) * WAVE_W,
      y: baselineY - (magnitude / maxMagnitude) * usableH,
    }));

    return smoothPath(points);
  }, [timeline]);

  // The activity list: every timeline entry, newest first, read the exact
  // same way the rail's ticks and the "now" preview already are — the
  // entry right before a given index names the edit that arrived at it.
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState(null); // null = "All"

  // A fresh search/filter every time the panel opens, the same "fresh sheet"
  // reasoning CommandPalette.jsx already applies to its own query.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveFilter(null);
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
          label: arrival ? capitalize(arrival.label) : "The very start",
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
      return true;
    });
  }, [rows, activeFilter, query]);

  // Time-lapse: one tracked step forward per tick of the current speed
  // while playing, stopping itself the instant it reaches "now" — the
  // advance is just another onJump, so it rides the exact same spring,
  // waveform, and preview reactions a manual scrub already gets for free.
  useEffect(() => {
    if (playPhase !== "playing") return;

    if (cursor >= timeline.length - 1) {
      playbackService.send("DONE");
      return;
    }

    const ms = PLAYBACK_SPEEDS[speedIndex].ms;
    const timer = setTimeout(() => onJump(cursor + 1), ms);
    return () => clearTimeout(timer);
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

  return (
    <AnimatePresence>
      {
        open && (
          <div className="history-layer">
            <motion.div
              className="history-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: .2 } }}
              onClick={ () => setOpen(false) }
            />
            <motion.div
              ref={ panelRef }
              className="history-panel"
              initial={{ opacity: 0, scale: .1, translateY: 90, borderRadius: 60 }}
              onUpdate={ onBlobUpdate }
              animate={{ opacity: 1, scale: 1, translateY: 0, borderRadius: 22 }}
              exit={{
                opacity: 0,
                scale: .24,
                translateY: 60,
                borderRadius: 50,
                transition: { duration: .2, ease: "easeIn" },
              }}
              transition={{ type: "spring", stiffness: 190, damping: 14 }}
            >
              <div className="history-header">
                <div className="history-header-title">
                  <h3>Edit history</h3>
                  {
                    timeline.length > 1 && (
                      <span className="history-header-count">
                        { timeline.length - 1 } edit{ timeline.length - 1 === 1 ? "" : "s" }
                      </span>
                    )
                  }
                </div>
                <div className="history-header-actions">
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
                        Export
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
                {
                  timeline.length < 2 ? (
                    <div className="history-empty">
                      <FaClockRotateLeft className="history-empty-icon" />
                      <p>Nothing tracked yet this session — edit a note or two.</p>
                    </div>
                  ) : (
                    <>
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
                            { previewArrival ? capitalize(previewArrival.label) : "The very start" }
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
                        <div className="history-track-rail" />
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
                                className={ `history-tick ${ index === cursor ? "active" : "" } ${ entry.label === "now" ? "is-now" : "" }` }
                                style={{ left: `${ timeline.length > 1 ? (index / (timeline.length - 1)) * 100 : 0 }%`, "--tick-color": style.color }}
                                title={ entry.label === "now" ? "Right now" : entry.label }
                                onClick={ (e) => { e.stopPropagation(); stopPlayback(); onJump(index); } }
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
                          transition={{ type: "spring", stiffness: 500, damping: 32 }}
                          onPanStart={ stopPlayback }
                          onPan={ handlePan }
                        />
                      </div>

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
                    </div>

                    <div className="history-list-region">
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
                                <motion.button
                                  key={ row.index }
                                  type="button"
                                  layout
                                  className={ `history-row ${ row.index === cursor ? "active" : "" }` }
                                  style={{ "--row-color": row.style.color }}
                                  initial={{ opacity: 0, x: -10 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  exit={{ opacity: 0, scale: .92 }}
                                  transition={{ type: "spring", stiffness: 420, damping: 32 }}
                                  onClick={ () => { stopPlayback(); onJump(row.index); } }
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
                                </motion.button>
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
                            <div className="history-preview-header">
                              <span className="history-preview-icon" style={{ "--action-color": previewStyle.color }}>
                                <PreviewIcon />
                              </span>
                              <span className="history-preview-text">
                                <span className="history-preview-label">
                                  { previewArrival ? capitalize(previewArrival.label) : "The very start" }
                                </span>
                                <span className="history-preview-time">
                                  { previewArrival ? timeAgo(previewArrival.at) : "session start" }
                                </span>
                              </span>
                            </div>

                            {
                              previewDiff && (
                                <div className="history-preview-diff">
                                  <span
                                    className={ `history-preview-diff-chip ${ previewDiff.countDelta > 0 ? "positive" : previewDiff.countDelta < 0 ? "negative" : "" }` }
                                  >
                                    { previewDiff.countDelta > 0 ? `+${ previewDiff.countDelta }` : previewDiff.countDelta } note{ Math.abs(previewDiff.countDelta) === 1 ? "" : "s" }
                                  </span>
                                  <span className="history-preview-diff-chip">
                                    text { previewDiff.textDelta > 0 ? `+${ previewDiff.textDelta }` : previewDiff.textDelta } chars
                                  </span>
                                </div>
                              )
                            }

                            <div className="history-preview-grid-label">
                              {
                                previewEntry.notes.length > 0
                                  ? `The desk — ${ previewEntry.notes.length } ${ previewEntry.notes.length === 1 ? "note" : "notes" }`
                                  : "The desk"
                              }
                            </div>

                            <div className="history-note-grid">
                              <AnimatePresence initial={ false }>
                                {
                                  previewEntry.notes.length > 0 ? (
                                    previewEntry.notes.map((note, i) => (
                                      <motion.span
                                        key={ note.id }
                                        className={ `history-note-chip ${ note.color }-bg` }
                                        title={ note.title?.trim() || note.text?.trim()?.slice(0, 40) || "Untitled note" }
                                        initial={{ opacity: 0, scale: .4 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: .4 }}
                                        transition={{ type: "spring", stiffness: 460, damping: 20, delay: Math.min(i * .012, .3) }}
                                      />
                                    ))
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
                    </>
                  )
                }
              </div>
            </motion.div>
          </div>
        )
      }
    </AnimatePresence>
  );
};

export default HistoryPanel;
