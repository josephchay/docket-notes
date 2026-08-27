import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import gsap from "gsap";
import { FaXmark, FaArrowRotateLeft, FaTrash, FaBoxArchive } from "react-icons/fa6";

import { timeAgo } from "../../utils/date";
import { notePreviewText } from "../../utils/notePreview";
import TrashPhysics from "./TrashPhysics";
import SheetPanel from "../Sheet/SheetPanel";
import SparkBurst from "../Spark/SparkBurst";

import "./TrashPanel.css";

// The event the command palette's "Open the trash" entry (and the
// toolbar's trash button) fire to summon this panel from anywhere.
export const TRASH_EVENT = "docket:trash";

// A press on a swatch has to clear this many px before it counts as a
// real drag-to-toss rather than a stray click — the same pixel-threshold
// discipline NotePile.jsx's own toss gesture uses to tell "picked up and
// thrown" apart from "just tapped."
const DRAG_THRESHOLD = 6;

// Every note deleted this session, not just the last few the toast deck had
// room for — opened the same dot-to-sheet way as the command palette and
// desk insights. Restoring peels a note back out toward the grid it came
// from; shredding crumples it away for good instead — two different exits
// off the one list, so the panel reads the difference even without text.
const TrashPanel = ({ entries, onRestore, onShred, onEmpty, reduceMotion }) => {
  const [open, setOpen] = useState(false);
  const [pendingExit, setPendingExit] = useState({});

  // A small handful of ink sparks off the restore button — shred already
  // gets a real physics handoff (see dropPhysics below); restore had
  // nothing of its own, just a plain slide-and-fade indistinguishable in
  // spirit from any other exit. Same spark-burst recipe the star toggle
  // already uses in Header.jsx/Note.jsx, reused here for the same reason:
  // a quick, satisfying "yes, that landed" pop for a positive action.
  const [restoreBurst, setRestoreBurst] = useState(null);
  const burstTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(burstTimerRef.current), []);

  // Every shred/empty hands its swatch's own current spot off to
  // TrashPhysics.jsx, so the piece that takes over visually starts exactly
  // where the list item was, not wherever the panel happens to sit.
  const physicsRef = useRef(null);
  const panelRef = useRef(null);
  const swatchRefs = useRef({});
  // Empty-trash's own shake (see shakeEmpty below) — a SEPARATE node from
  // panelRef on purpose: panelRef is SheetPanel's own motion.div, already
  // carrying Framer's own scaleX/scaleY/translateY/rotateX for the
  // dot-to-sheet entrance/exit plus useBlobClipMorph's clip-path — GSAP
  // shaking that exact node would mean two systems fighting over the same
  // transform every frame, the same conflict this session already hit
  // (and worked around the same way) in ColorSelector.jsx's drag-to-pour.
  // This wraps the panel's own content instead, one layer further in,
  // where nothing else has ever claimed the transform.
  const shakeRef = useRef(null);
  // The pile's own last-known lean (see handlePileTilt) — shakeEmpty's own
  // final settle keyframe below returns to THIS rather than a hardcoded 0,
  // so a shake decays back into whatever the pile's actual resting lean
  // already is instead of snapping the bin artificially flat.
  const lastTiltRef = useRef(0);
  // The one live drag-to-toss in flight, if any — { note, startX, startY,
  // active }. `active` flips true only once the press clears
  // DRAG_THRESHOLD, the same "don't hand off to physics for a plain
  // click" gate dropPhysics's own button path never needed since a
  // button click is unambiguous already.
  const dragStateRef = useRef(null);

  const shakeEmpty = () => {
    if (reduceMotion || !shakeRef.current) return;

    gsap.killTweensOf(shakeRef.current);
    gsap.timeline()
      .to(shakeRef.current, { x: -7, rotate: -1.4, duration: .06, ease: "power1.out" })
      .to(shakeRef.current, { x: 6, rotate: 1.1, duration: .08, ease: "power1.inOut" })
      .to(shakeRef.current, { x: -5, rotate: -.8, duration: .08, ease: "power1.inOut" })
      .to(shakeRef.current, { x: 3, rotate: .4, duration: .09, ease: "power1.inOut" })
      .to(shakeRef.current, { x: 0, rotate: lastTiltRef.current, duration: .16, ease: "power2.out" });
  };

  // The bin's own real center-of-mass read (see TrashPhysics.jsx's tick
  // loop) — an uneven pile visibly leans it toward whichever side is
  // actually heavier, eased onto shakeRef rather than panelRef for the
  // same reason shakeEmpty already avoids panelRef: that node is
  // SheetPanel's own, already carrying framer's entrance/exit transform
  // plus useBlobClipMorph's clip-path.
  const handlePileTilt = (deg) => {
    lastTiltRef.current = deg;
    if (reduceMotion || !shakeRef.current) return;

    gsap.to(shakeRef.current, { rotate: deg, duration: .5, ease: "power2.out", overwrite: "auto" });
  };

  const dropPhysics = (note) => {
    const swatch = swatchRefs.current[note.id];
    const panelRect = panelRef.current?.getBoundingClientRect();
    if (!swatch || !panelRect) return;

    const rect = swatch.getBoundingClientRect();
    physicsRef.current?.drop({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      width: rect.width,
      height: rect.height,
      color: note.color,
      panelRect,
    });
  };

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(TRASH_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(TRASH_EVENT, handleSummon);
    };
  }, []);

  // The shared tail end of a restore/shred, however it was triggered —
  // a button click or a live toss release both land here, so the drag
  // gesture below doesn't have to re-derive the same bookkeeping the
  // buttons already handle correctly.
  const finishRestore = (noteId) => {
    setPendingExit((prev) => ({ ...prev, [noteId]: "restore" }));
    setRestoreBurst(noteId);
    clearTimeout(burstTimerRef.current);
    burstTimerRef.current = setTimeout(() => setRestoreBurst(null), 600);
    onRestore(noteId);
  };

  const finishShred = (noteId) => {
    setPendingExit((prev) => ({ ...prev, [noteId]: "shred" }));
    onShred(noteId);
  };

  const handleShred = (note) => {
    dropPhysics(note);
    finishShred(note.id);
  };

  // Live drag-to-toss: pressing a row's swatch and dragging it hands the
  // note off to TrashPhysics.jsx as a real physics body the instant the
  // press clears DRAG_THRESHOLD — toss it up past RESTORE_VELOCITY_THRESHOLD
  // and releaseGrabbed reads that as thrown back, anything else reads as
  // let go and shreds right where it lands. The buttons stay exactly as
  // they were: a full, keyboard-reachable path to the same two outcomes
  // for anyone not reaching for the gesture.
  const handleSwatchDown = (e, note) => {
    if (reduceMotion) return;
    dragStateRef.current = { note, startX: e.clientX, startY: e.clientY, active: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handleSwatchMove = (e) => {
    const state = dragStateRef.current;
    if (!state) return;

    if (!state.active) {
      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      state.active = true;

      // Grabbed right from the swatch's own current rect — the same
      // origin dropPhysics already reads for the button path, so a
      // toss picks up exactly where the list's own swatch was sitting.
      const swatch = swatchRefs.current[state.note.id];
      const panelRect = panelRef.current?.getBoundingClientRect();
      const rect = swatch?.getBoundingClientRect();
      if (!rect) { dragStateRef.current = null; return; }

      physicsRef.current?.grab({
        id: state.note.id,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        width: rect.width,
        height: rect.height,
        color: state.note.color,
        panelRect,
      });
      // The physics piece takes over the visual from here — the list's
      // own swatch hides rather than doubling it up. Never restored to
      // visible on release: the row is about to exit either way.
      if (swatch) swatch.style.opacity = "0";
    }

    physicsRef.current?.moveGrabbed(state.note.id, e.clientX, e.clientY);
  };

  const handleSwatchUp = (e) => {
    const state = dragStateRef.current;
    dragStateRef.current = null;
    if (!state) return;

    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (!state.active) return; // never crossed the threshold — a plain click on the swatch, nothing to release

    const result = physicsRef.current?.releaseGrabbed(state.note.id);
    if (result?.restored) finishRestore(state.note.id);
    else finishShred(state.note.id);
  };

  const handleEmptyAll = () => {
    setPendingExit((prev) => {
      const next = { ...prev };
      entries.forEach((entry) => { next[entry.note.id] = "shred"; });
      return next;
    });

    // Every swatch's rect has to be read now, while the list is still
    // mounted — onEmpty() below clears the entries this same tick, so a
    // deferred read would land on an already-unmounted (or reused) node.
    // Only the actual physics drop is staggered, off this pre-captured data.
    const panelRect = panelRef.current?.getBoundingClientRect();
    const drops = panelRect
      ? entries
        .map((entry) => {
          const swatch = swatchRefs.current[entry.note.id];
          if (!swatch) return null;

          const rect = swatch.getBoundingClientRect();
          return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            width: rect.width,
            height: rect.height,
            color: entry.note.color,
            panelRect,
          };
        })
        .filter(Boolean)
      : [];

    // A staggered volley rather than one flat instant — same 18-22ms beat
    // Home.jsx's selectAllVisible uses for its own wave — so a big trash
    // doesn't just spawn every piece stacked on frame one.
    drops.forEach((drop, index) => {
      setTimeout(() => physicsRef.current?.drop(drop), index * 20);
    });

    // The panel's own shake rides right alongside the drop volley rather
    // than waiting for it — the physical read is "the bin got upended and
    // everything's still tumbling out," not "the bin shook, then
    // separately, things fell."
    shakeEmpty();

    onEmpty();
  };

  // Most recently trashed first, same as any trash view — entries itself
  // arrives oldest-first (deletion order), this just flips the display.
  const sorted = [...entries].reverse();

  const labelFor = (note) => {
    const title = note.title?.trim();
    if (title) return title;

    const text = notePreviewText(note.text).trim();
    if (text) return text.length > 60 ? `${ text.slice(0, 60) }…` : text;

    return "Untitled note";
  };

  return (
    <>
      {/* Mounted unconditionally (not gated on `open`) so pieces already
          tumbling keep settling and fading even if the panel closes
          mid-shred, rather than being yanked away with it. */}
      <TrashPhysics ref={ physicsRef } reduceMotion={ reduceMotion } onPileTilt={ handlePileTilt } />
      <SheetPanel
        open={ open }
        onClose={ () => setOpen(false) }
        panelRef={ panelRef }
        radius={ 22 }
        layerClassName="trash-layer"
        backdropClassName="trash-backdrop"
        panelClassName="trash-panel"
        ariaLabel="Trash"
      >
        <div ref={ shakeRef } className="trash-shake-wrap">
              <div className="trash-header">
                <h3>Trash</h3>
                <div className="trash-header-actions">
                  {
                    entries.length > 0 && (
                      <motion.button
                        type="button"
                        className="trash-empty-all"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: .94 }}
                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        onClick={ handleEmptyAll }
                      >
                        Empty trash
                      </motion.button>
                    )
                  }
                  <motion.button
                    type="button"
                    aria-label="Close"
                    className="trash-close"
                    whileHover={{ scale: 1.15, rotate: 90 }}
                    whileTap={{ scale: .9 }}
                    transition={{ type: "spring", stiffness: 420, damping: 16 }}
                    onClick={ () => setOpen(false) }
                  >
                    <FaXmark />
                  </motion.button>
                </div>
              </div>

              <div className="trash-body">
                {
                  entries.length === 0 ? (
                    <motion.div
                      className="trash-empty"
                      initial={{ opacity: 0, scale: .7, translateY: 14 }}
                      animate={{ opacity: 1, scale: 1, translateY: 0 }}
                      transition={{ type: "spring", stiffness: 260, damping: 18 }}
                    >
                      <motion.span
                        initial={{ rotate: -18, scale: .6 }}
                        animate={{ rotate: 0, scale: 1 }}
                        transition={{ type: "spring", stiffness: 300, damping: 14, delay: .08 }}
                      >
                        <FaBoxArchive className="trash-empty-icon" />
                      </motion.span>
                      <p>Nothing in the trash this session.</p>
                    </motion.div>
                  ) : (
                    <ul className="trash-list">
                      <AnimatePresence initial={ false }>
                        {
                          sorted.map((entry) => (
                            <motion.li
                              key={ entry.note.id }
                              className="trash-item"
                              layout
                              initial={{ opacity: 0, y: -10, scale: .92 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={
                                pendingExit[entry.note.id] === "shred"
                                  ? {
                                    opacity: 0,
                                    scale: .4,
                                    rotate: 14,
                                    x: 50,
                                    transition: { duration: .32, ease: "easeIn" },
                                  }
                                  // Lifts up and away — back toward the desk
                                  // above, rather than shred's decisive
                                  // sideways tumble — with a bouncy pop
                                  // instead of a flat ease-out, so restoring
                                  // reads as genuinely different in spirit.
                                  : {
                                    opacity: 0,
                                    scale: .4,
                                    y: -80,
                                    rotate: -10,
                                    transition: { type: "spring", stiffness: 320, damping: 16 },
                                  }
                              }
                              transition={{ type: "spring", stiffness: 380, damping: 26 }}
                            >
                              <span
                                ref={ (el) => {
                                  if (el) swatchRefs.current[entry.note.id] = el;
                                  else delete swatchRefs.current[entry.note.id];
                                } }
                                className={ `trash-item-swatch ${ entry.note.color }-bg` }
                                style={{ touchAction: "none" }}
                                onPointerDown={ (e) => handleSwatchDown(e, entry.note) }
                                onPointerMove={ handleSwatchMove }
                                onPointerUp={ handleSwatchUp }
                                onPointerCancel={ handleSwatchUp }
                              />
                              <div className="trash-item-body">
                                <span className="trash-item-title">{ labelFor(entry.note) }</span>
                                <span className="trash-item-time">{ timeAgo(entry.deletedAt) }</span>
                              </div>
                              <motion.button
                                type="button"
                                className="trash-item-restore"
                                aria-label="Restore this note"
                                title="Restore"
                                whileHover={{ scale: 1.12 }}
                                whileTap={{ scale: .88 }}
                                transition={{ type: "spring", stiffness: 420, damping: 16 }}
                                onClick={ () => finishRestore(entry.note.id) }
                              >
                                <FaArrowRotateLeft />
                                <SparkBurst
                                  active={ restoreBurst === entry.note.id }
                                  count={ 5 }
                                  angleOffset={ -Math.PI / 2 }
                                  radius={ 20 }
                                  duration={ .5 }
                                  className="trash-restore-burst"
                                />
                              </motion.button>
                              <motion.button
                                type="button"
                                className="trash-item-shred"
                                aria-label="Delete this note forever"
                                title="Delete forever"
                                whileHover={{ scale: 1.12, rotate: -10 }}
                                whileTap={{ scale: .88 }}
                                transition={{ type: "spring", stiffness: 420, damping: 16 }}
                                onClick={ () => handleShred(entry.note) }
                              >
                                <FaTrash />
                              </motion.button>
                            </motion.li>
                          ))
                        }
                      </AnimatePresence>
                    </ul>
                  )
                }
              </div>
        </div>
      </SheetPanel>
    </>
  );
};

export default TrashPanel;
