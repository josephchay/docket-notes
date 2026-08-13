import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import { FaStar, FaPen, FaXmark, FaCopy, FaShuffle, FaTag } from "react-icons/fa6";
import { FaEye } from "react-icons/fa";

import { NOTE_COLORS } from "../../constants/colors";
import useJellyTap from "../../hooks/useJellyTap";
import useInkPulse from "../../hooks/useInkPulse";
import useFocusTrap from "../../hooks/useFocusTrap";
import HistoryAmbient from "../History/HistoryAmbient";
import { EXIT_SPRING, coinFlip } from "../Motion";
import { createPoint, integratePoint, satisfyConstraint } from "../../utils/verlet";
import { smoothPath } from "../../utils/svgPath";

import "./NoteEditor.css";

const debounceTimer = 500;

// Drag-to-resize (see handleResizeDown/Move/End below) — continuous
// width/height while held, clamped so the paper can never shrink below a
// usable size or blow past the same viewport-relative ceiling sizeFor's
// own "epic" preset already respects.
const RESIZE_MIN_W = 380;
const RESIZE_MIN_H = 300;

// The bottom edge's own verlet chain while a resize is live (see the drag
// effect further down) — a real rope/cloth integration (utils/verlet.js,
// the same one ClothField/PullString and NoteList's own idle blobs
// already trust), not a decorative wobble: the right end is kinematically
// driven to the actual drag position every frame, the left end stays
// pinned at the paper's own fixed corner, and the points between them
// relax toward straight through ordinary distance constraints — which is
// exactly what gives a fast drag a real trailing whip and a slow one an
// almost-taut line.
const EDGE_SEGMENTS = 7;
const EDGE_DAMPING = .88;
const EDGE_SAG = 60; // px/s² — a light droop while the edge is actively being pulled
const EDGE_RELAX_ITERATIONS = 3;

// The palette dots and every action button (star, lock, copy, resize,
// close) shared this exact spring as a copy-pasted literal six times over
// in this one file — none of the app's cross-file Motion constants happen
// to match this file's own already-tuned 420/16 exactly, so it stays a
// local constant rather than being forced onto a slightly different
// shared one.
const actionSpring = { type: "spring", stiffness: 420, damping: 16 };

// The editor's papers: cozy for a quick line, roomy for writing, grand for
// spreading out, epic for filling the screen.
const EDITOR_SIZES = ["cozy", "roomy", "grand", "epic"];

const sizeFor = (name) => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  switch (name) {
    case "cozy": return { width: Math.min(520, vw * .94), height: Math.min(470, vh * .86) };
    case "grand": return { width: Math.min(1080, vw * .94), height: Math.min(840, vh * .9) };
    case "epic": return { width: Math.min(1440, vw * 0.96), height: Math.min(1080, vh * 0.94) };
    default: return { width: Math.min(720, vw * .94), height: Math.min(600, vh * .86) };
  }
};

// A thin ink stroke drawing itself on around whichever field (title or
// text) is actually focused, rather than an instant CSS border/outline
// swap — the same pathLength draw-on technique TrashPanel's own
// hold-to-confirm ring already uses, just triggered by focus instead of a
// held press. `rect` is measured in the caller (offsetLeft/Top/Width/
// Height against .note-editor, the nearest positioned ancestor) rather
// than this component reading a ref itself, so the same small piece works
// for both fields without needing to know which one it's tracking.
const FocusRing = ({ rect, radius = 8 }) => {
  if (!rect) return null;

  const w = rect.width + 8;
  const h = rect.height + 8;

  return (
    <motion.svg
      className="note-editor-focus-ring"
      style={{ left: rect.left - 4, top: rect.top - 4 }}
      width={ w }
      height={ h }
      aria-hidden="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: .18 } }}
    >
      <motion.rect
        x="2" y="2" width={ rect.width + 4 } height={ rect.height + 4 } rx={ radius }
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: .5, ease: "easeOut" }}
      />
    </motion.svg>
  );
};

// The focus editor. Pulling a note's "open" string stretches the card into
// this full writing surface — same paper, same color, far more room. Edits
// flow back into the card as you type (debounced, like the card's own
// fields), the palette repaints the note directly, and Escape, the backdrop,
// or the close button snap it shut again.
const NoteEditor = ({
  note,
  onClose,
  updateTitle,
  updateText,
  updateFavorite,
  updateLock,
  setNoteColor,
  updateQuote,
  updateTags,
}) => {
  const [draftTitle, setDraftTitle] = useState(note.title);
  const [draftText, setDraftText] = useState(note.text);
  const [size, setSize] = useState("roomy");
  const [copied, setCopied] = useState(false);

  // Drag-to-resize's own live dimensions — non-null only while a drag is
  // actually held, overriding the size spring below with a direct,
  // duration:0 target so the paper tracks the pointer 1:1 rather than
  // lagging a spring behind it. dragSizeRef mirrors the same value for the
  // edge-chain effect to read fresh every frame without depending on a
  // stale closure over this render's own state.
  const [dragSize, setDragSize] = useState(null);
  const dragSizeRef = useRef(null);
  const resizeStartRef = useRef(null);
  const paperRef = useRef(null);

  const updateDragSize = (next) => {
    dragSizeRef.current = next;
    setDragSize(next);
  };

  // Tags pop in bouncy, shrink away when removed. Notes from before this
  // feature existed simply have none yet.
  const tags = note.tags || [];
  const [tagDraft, setTagDraft] = useState("");
  const tagInputRef = useRef(null);

  const addTag = () => {
    const clean = tagDraft.trim().toLowerCase().replace(/\s+/g, "-");
    setTagDraft("");
    if (!clean || tags.includes(clean)) return;

    updateTags([...tags, clean], note.id);
  };

  const handleTagKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag();
    } else if (e.key === "Backspace" && !tagDraft && tags.length > 0) {
      updateTags(tags.slice(0, -1), note.id);
    }
  };

  const removeTag = (tag) => {
    updateTags(tags.filter((t) => t !== tag), note.id);
  };

  // The gluey wobble: whenever the paper opens or changes size it squashes
  // and stretches like jelly while the bouncy size spring overshoots.
  const jelly = useAnimationControls();

  // The header's action row was the editor's one flat corner — plain
  // hover/tap scale with no give in it. Each icon gets its own tap jelly
  // now, played on its own inner span so it never fights the button's own
  // whileHover/whileTap, or (for lock) the coin-flip already swapping
  // pen/eye on the span inside it.
  const starTap = useJellyTap();
  const lockTap = useJellyTap();
  const copyTap = useJellyTap();
  const resizeTap = useJellyTap();

  // The palette's ring borrows the free cursor's own press pulse and idle
  // pool (see useInkPulse) so it carries the same elastic personality as
  // it slides between colors.
  const paletteRingPulse = useInkPulse(note.color);
  const closeTap = useJellyTap();

  const wobble = useCallback(() => {
    jelly.start({
      scaleX: [1, 1.05, .96, 1.02, 1],
      scaleY: [1, .94, 1.06, .98, 1],
      transition: { duration: .6, times: [0, .25, .5, .75, 1], ease: "easeInOut" },
    });
  }, [jelly]);

  useEffect(() => {
    wobble();
  }, [size, wobble]);

  const titleRef = useRef(null);
  const textRef = useRef(null);
  const editorRef = useRef(null);
  const titleTimerRef = useRef(null);
  const textTimerRef = useRef(null);
  const copiedTimerRef = useRef(null);

  // Which preset the paper's own current box is actually closest to (by
  // straight-line distance in width/height space) — what a released drag
  // snaps `size` to, so the discrete preset classes (.cozy/.grand/.epic —
  // padding, border-radius, type scale) still take over cleanly once the
  // continuous part of the resize is done.
  const nearestPreset = (width, height) => {
    let best = EDITOR_SIZES[0];
    let bestDist = Infinity;
    EDITOR_SIZES.forEach((name) => {
      const preset = sizeFor(name);
      const dist = Math.hypot(preset.width - width, preset.height - height);
      if (dist < bestDist) {
        bestDist = dist;
        best = name;
      }
    });
    return best;
  };

  const handleResizeDown = (e) => {
    const rect = paperRef.current?.getBoundingClientRect();
    if (!rect) return;

    e.preventDefault();
    resizeStartRef.current = { x: e.clientX, y: e.clientY, w: rect.width, h: rect.height };
    updateDragSize({ width: rect.width, height: rect.height });
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handleResizeMove = (e) => {
    const start = resizeStartRef.current;
    if (!start) return;

    const maxW = Math.min(1440, window.innerWidth * .96);
    const maxH = Math.min(1080, window.innerHeight * .94);
    const width = Math.max(RESIZE_MIN_W, Math.min(maxW, start.w + (e.clientX - start.x)));
    const height = Math.max(RESIZE_MIN_H, Math.min(maxH, start.h + (e.clientY - start.y)));
    updateDragSize({ width, height });
  };

  // Named to match the drag-resize this CSS file's own .note-editor
  // comment already describes: the continuous part ends here, and only
  // now does `size` (and with it, the preset classes' own CSS-transitioned
  // padding/border-radius) actually change.
  const handleResizeEnd = (e) => {
    const start = resizeStartRef.current;
    if (!start) return;

    resizeStartRef.current = null;
    e.currentTarget?.releasePointerCapture?.(e.pointerId);

    const final = dragSizeRef.current;
    updateDragSize(null);
    if (final) setSize(nearestPreset(final.width, final.height));
  };

  // The bottom edge's own verlet chain, live only while a resize is
  // actually held — see EDGE_SEGMENTS' own comment for the physics. Keyed
  // on whether a drag is active at all (not on dragSize's own values), so
  // this starts and stops exactly once per drag rather than restarting on
  // every pixel of movement; the loop itself reads the live width straight
  // off dragSizeRef every frame.
  const edgeChainRef = useRef(null);
  const edgePathRef = useRef(null);
  const edgeRafRef = useRef(null);

  useEffect(() => {
    if (!dragSize) return undefined;

    edgeChainRef.current = Array.from({ length: EDGE_SEGMENTS }, (_, i) =>
      createPoint((i / (EDGE_SEGMENTS - 1)) * dragSize.width, 0, i === 0),
    );

    let lastT = performance.now();

    const tick = (now) => {
      edgeRafRef.current = requestAnimationFrame(tick);
      const dt = Math.min(.032, (now - lastT) / 1000);
      lastT = now;

      const chain = edgeChainRef.current;
      const width = dragSizeRef.current?.width ?? dragSize.width;

      // The right end is kinematically driven straight to the live drag
      // position every frame (a moving anchor, not a free point) — px is
      // reset alongside it so it never itself accumulates an implied
      // velocity; only the free points between the two ends actually get
      // integrated and feel the chain's own tension.
      const driven = chain[chain.length - 1];
      driven.x = width;
      driven.y = 0;
      driven.px = driven.x;
      driven.py = driven.y;

      for (let i = 1; i < chain.length - 1; i++) {
        integratePoint(chain[i], dt, 0, EDGE_SAG, EDGE_DAMPING);
      }

      const restLength = width / (EDGE_SEGMENTS - 1);
      for (let pass = 0; pass < EDGE_RELAX_ITERATIONS; pass++) {
        for (let i = 0; i < chain.length - 1; i++) {
          satisfyConstraint(chain[i], chain[i + 1], restLength);
        }
      }

      if (edgePathRef.current) {
        edgePathRef.current.setAttribute("d", smoothPath(chain.map((p) => ({ x: p.x, y: p.y }))));
      }
    };

    edgeRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (edgeRafRef.current) cancelAnimationFrame(edgeRafRef.current);
      edgeRafRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!dragSize]);

  // The focus-draw ring (see FocusRing below) — measured via offsetLeft/
  // offsetTop/offsetWidth/offsetHeight rather than wrapping the title/text
  // fields in new positioning containers, since both already sit directly
  // inside .note-editor (itself position: relative), so their own offsets
  // already land in exactly the coordinate space an absolutely-positioned
  // sibling overlay needs. Re-measured whenever the paper's own size
  // changes while a field is focused, so a resize mid-focus doesn't leave
  // the ring sized for stale dimensions.
  const [titleFocused, setTitleFocused] = useState(false);
  const [textFocused, setTextFocused] = useState(false);
  const [titleRect, setTitleRect] = useState(null);
  const [textRect, setTextRect] = useState(null);

  const measureFocusRect = (el, setter) => {
    if (!el) return;
    setter({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight });
  };

  useEffect(() => {
    if (titleFocused) measureFocusRect(titleRef.current, setTitleRect);
    if (textFocused) measureFocusRect(textRef.current, setTextRect);
  }, [size, dragSize, titleFocused, textFocused]);

  // The copy action's own ghost scrap (see handleCopy below) — page-space
  // coordinates, portaled straight to document.body the same way every
  // other cross-element travel effect in this app already is (Note.jsx's
  // radial menu, ColorSelector's drag ghost), since it has to fly from the
  // textarea to the copy button regardless of whatever transform the
  // editor's own entrance/jelly wrappers currently carry.
  const [copyGhost, setCopyGhost] = useState(null);
  const copyBtnRef = useRef(null);

  // Traps Tab/Shift+Tab within the editor and returns focus to whatever
  // triggered it once closed — see useFocusTrap.js. `open` is a constant
  // `true` here (unlike every other panel using this hook) since this
  // component only ever exists while actively editing — Home.jsx mounts
  // and unmounts it entirely rather than toggling an internal open flag,
  // and the hook's restore-on-close step lives in its effect's own
  // cleanup specifically so that still fires correctly on unmount.
  // focusOnOpen is off: the effect below already puts the caret in the
  // text field itself (or, for a locked note, on the editor shell) — a
  // more specific target than the hook's own generic "focus the panel
  // root" fallback.
  useFocusTrap(editorRef, true, { focusOnOpen: false });

  // Adopt outside changes to the note unless that field is being typed in
  // right now — a self-made edit round-trips as the same value anyway.
  useEffect(() => {
    if (document.activeElement !== titleRef.current) setDraftTitle(note.title);
  }, [note.title]);

  useEffect(() => {
    if (document.activeElement !== textRef.current) setDraftText(note.text);
  }, [note.text]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKey);

    const timers = [titleTimerRef, textTimerRef, copiedTimerRef];
    return () => {
      window.removeEventListener("keydown", handleKey);
      timers.forEach((timer) => clearTimeout(timer.current));
    };
  }, [onClose]);

  // Drop the caret at the end of the body so writing continues immediately
  // — or, for a locked note (nothing to type into), land on the editor
  // shell itself instead, so a keyboard user still has *something*
  // focused to Tab from rather than nothing at all.
  useEffect(() => {
    if (note.lock) {
      editorRef.current?.focus({ preventScroll: true });
      return;
    }

    const field = textRef.current;
    if (!field) return;

    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
  }, [note.lock]);

  const handleTitle = (value) => {
    setDraftTitle(value);
    clearTimeout(titleTimerRef.current);
    titleTimerRef.current = setTimeout(() => updateTitle(value, note.id), debounceTimer);
  };

  const handleText = (value) => {
    setDraftText(value);
    clearTimeout(textTimerRef.current);
    textTimerRef.current = setTimeout(() => updateText(value, note.id), debounceTimer);
  };

  // Copy the whole note as plain text, with a small sparkle of confirmation
  // — and now a scrap of the paper itself visibly lifting off the text and
  // flying to the button that just fired, rather than only the flat
  // "Copied ✦" label popping in place.
  const handleCopy = async () => {
    const body = draftText?.trim() ? draftText : note.placeholder;
    const content = `${ draftTitle?.trim() || "Untitled note" }\n\n${ body }`;

    try {
      await navigator.clipboard.writeText(content);
    } catch {
      return;
    }

    setCopied(true);
    clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), 1400);

    const textRect = textRef.current?.getBoundingClientRect();
    const btnRect = copyBtnRef.current?.getBoundingClientRect();
    if (textRect && btnRect) {
      setCopyGhost({
        key: Date.now(),
        fromX: textRect.left + textRect.width / 2,
        fromY: textRect.top + 30,
        toX: btnRect.left + btnRect.width / 2,
        toY: btnRect.top + btnRect.height / 2,
      });
    }
  };

  const words = draftText.trim() ? draftText.trim().split(/\s+/).length : 0;

  return (
    <div className="note-editor-layer">
      <motion.div
        className="note-editor-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{
          opacity: 0,
          transition: { duration: .25, ease: "easeIn" },
        }}
        onClick={ onClose }
      />
      <motion.div
        ref={ editorRef }
        tabIndex={ -1 }
        className="note-editor-shell"
        initial={{ opacity: 0, scale: .8, y: 90, rotate: -1.5 }}
        animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }}
        /* The entrance is a real spring with a slight rotate settle; the
           exit used to be a flat linear fade-shrink with none of that
           character. Now it reverses the same spring, tipping back the
           way it came in instead of just shrinking straight down. */
        exit={{
          opacity: 0,
          scale: .86,
          y: 60,
          rotate: 1.5,
          transition: EXIT_SPRING,
        }}
        transition={{
          type: "spring",
          stiffness: 300,
          damping: 24,
        }}
      >
        <motion.div
          className="note-editor-jelly"
          animate={ jelly }
        >
          <motion.div
            ref={ paperRef }
            className={ `note-editor ${ size } ${ note.color }-bg ${ note.lock ? "locked" : "" }` }
            initial={ sizeFor("roomy") }
            /* A held drag overrides the preset spring entirely with a
               duration:0 target — the paper tracks the pointer 1:1 rather
               than lagging a spring behind it; handleResizeEnd hands back
               to the ordinary preset spring below the instant it lets go. */
            animate={ dragSize || sizeFor(size) }
            transition={
              dragSize
                ? { duration: 0 }
                : { type: "spring", stiffness: 260, damping: 14, mass: .9 }
            }
          >
            {/* A faint drift of actual ink specks behind the paper — the
                exact same raw-Three.js dust technique History's own preview
                pane and the Settings panel already reuse (see
                HistoryAmbient.jsx). Tinted to the page's own ink rather than
                the note's color: the paper itself already *is* that color
                (note-editor's own background), so dust in the same shade
                would all but disappear into it — ink motes read clearly
                against any of the seven paper colors instead. */}
            <HistoryAmbient color="var(--page-ink-color)" />
            <div className="note-editor-header">
              <div className="note-editor-palette">
                {
                  Object.keys(NOTE_COLORS).map((name) => (
                    <motion.button
                      key={ name }
                      type="button"
                      aria-label={ `Paint the note ${ name }` }
                      className={ `note-editor-dot ${ name }-bg ${ name === note.color ? "active" : "" }` }
                      whileHover={{ scale: 1.25 }}
                      whileTap={{ scale: .85 }}
                      transition={ actionSpring }
                      onTapStart={ paletteRingPulse.squash }
                      onClick={ () => setNoteColor(name, note.id) }
                    >
                      {
                        name === note.color && (
                          <motion.span
                            layoutId="editorPaletteRing"
                            style={{ position: "absolute", inset: -3, borderRadius: "50%" }}
                            transition={{ type: "spring", stiffness: 450, damping: 17 }}
                          >
                            <motion.span
                              className="note-editor-dot-ring"
                              animate={ paletteRingPulse.jelly }
                              style={{ position: "absolute", inset: 0, borderRadius: "inherit" }}
                            />
                          </motion.span>
                        )
                      }
                    </motion.button>
                  ))
                }
              </div>
              <div className="note-editor-actions">
                <motion.button
                  type="button"
                  aria-label={ note.favorite ? "Unstar this note" : "Star this note" }
                  className="note-editor-action"
                  whileHover={{ scale: 1.15, rotate: -10 }}
                  whileTap={{ scale: .9 }}
                  transition={ actionSpring }
                  style={{
                    backgroundColor: note.favorite ? "var(--black-color)" : "var(--black-even-more-transclucent-color)",
                  }}
                  onTapStart={ starTap.squash }
                  onClick={ () => updateFavorite(note.id) }
                >
                  <motion.span animate={ starTap.jelly } style={{ display: "inline-flex" }}>
                    <FaStar className={ `note-editor-action-icon ${ note.color }` } />
                  </motion.span>
                </motion.button>
                <motion.button
                  type="button"
                  aria-label={ note.lock ? "Unlock this note for editing" : "Lock this note" }
                  className="note-editor-action dark"
                  style={{ transformPerspective: 300 }}
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: .9 }}
                  transition={ actionSpring }
                  onTapStart={ lockTap.squash }
                  onClick={ () => updateLock(note.id) }
                >
                  <motion.span animate={ lockTap.jelly } style={{ display: "inline-flex" }}>
                    <AnimatePresence mode="wait" initial={ false }>
                      <motion.span
                        key={ note.lock ? "pen" : "eye" }
                        className="note-editor-action-icon-wrap"
                        { ...coinFlip({ type: "spring", stiffness: 420, damping: 17 }) }
                      >
                        {
                          note.lock
                            ? <FaPen className="note-editor-action-icon light" />
                            : <FaEye className="note-editor-action-icon light" />
                        }
                      </motion.span>
                    </AnimatePresence>
                  </motion.span>
                </motion.button>
                <motion.button
                  ref={ copyBtnRef }
                  type="button"
                  aria-label="Copy the note to the clipboard"
                  className="note-editor-action dark"
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: .9 }}
                  transition={ actionSpring }
                  onTapStart={ copyTap.squash }
                  onClick={ handleCopy }
                >
                  <motion.span animate={ copyTap.jelly } style={{ display: "inline-flex" }}>
                    <FaCopy className="note-editor-action-icon light" />
                  </motion.span>
                </motion.button>
                <motion.button
                  type="button"
                  aria-label={ `Resize the paper (now ${ size })` }
                  className="note-editor-action"
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: .8 }}
                  transition={ actionSpring }
                  onTapStart={ resizeTap.squash }
                  onClick={ () => setSize(EDITOR_SIZES[(EDITOR_SIZES.indexOf(size) + 1) % EDITOR_SIZES.length]) }
                >
                  <motion.span animate={ resizeTap.jelly } style={{ display: "inline-flex" }}>
                    <span className={ `note-editor-size-box s${ EDITOR_SIZES.indexOf(size) }` } />
                  </motion.span>
                </motion.button>
                <motion.button
                  type="button"
                  aria-label="Close the editor"
                  className="note-editor-action dark"
                  whileHover={{ scale: 1.15, rotate: 90 }}
                  whileTap={{ scale: .9 }}
                  transition={ actionSpring }
                  onTapStart={ closeTap.squash }
                  onClick={ onClose }
                >
                  <motion.span animate={ closeTap.jelly } style={{ display: "inline-flex" }}>
                    <FaXmark className="note-editor-action-icon light" />
                  </motion.span>
                </motion.button>
              </div>
              <AnimatePresence>
                {
                  copied && (
                    <motion.span
                      className="note-editor-copied"
                      initial={{ opacity: 0, scale: .8, y: -6 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: .8, y: -6 }}
                      transition={{ type: "spring", stiffness: 380, damping: 20 }}
                    >
                      Copied ✦
                    </motion.span>
                  )
                }
              </AnimatePresence>
            </div>
            <input
              ref={ titleRef }
              readOnly={ note.lock }
              placeholder="Title"
              value={ draftTitle }
              onChange={ (e) => handleTitle(e.target.value) }
              onFocus={ () => { setTitleFocused(true); measureFocusRect(titleRef.current, setTitleRect); } }
              onBlur={ () => setTitleFocused(false) }
              className={ `note-editor-title ${ note.color }-highlight` }
            />
            <AnimatePresence>
              { titleFocused && <FocusRing key="title-ring" rect={ titleRect } radius={ 4 } /> }
            </AnimatePresence>
            {/* A little rack of tags — each pops in with an overshoot when
                pinned on, shrinks away when pulled off. Enter or a comma
                pins the current word; Backspace on an empty field pulls the
                last one back off. */}
            {
              !note.lock && (
                <div className="note-editor-tags">
                  <AnimatePresence initial={ false }>
                    {
                      tags.map((tag) => (
                        <motion.button
                          key={ tag }
                          type="button"
                          aria-label={ `Remove the ${ tag } tag` }
                          className="note-editor-tag"
                          layout
                          initial={{ opacity: 0, scale: 0, translateY: 8 }}
                          animate={{ opacity: 1, scale: 1, translateY: 0 }}
                          exit={{ opacity: 0, scale: .4, transition: { duration: .16, ease: "easeIn" } }}
                          whileHover={{ scale: 1.06 }}
                          whileTap={{ scale: .9 }}
                          transition={{ type: "spring", stiffness: 420, damping: 17 }}
                          onClick={ () => removeTag(tag) }
                        >
                          <FaTag className="note-editor-tag-icon" />
                          { tag }
                          <FaXmark className="note-editor-tag-remove" />
                        </motion.button>
                      ))
                    }
                  </AnimatePresence>
                  <input
                    ref={ tagInputRef }
                    type="text"
                    placeholder={ tags.length ? "Add another…" : "Add a tag…" }
                    value={ tagDraft }
                    onChange={ (e) => setTagDraft(e.target.value) }
                    onKeyDown={ handleTagKeyDown }
                    onBlur={ addTag }
                    className="note-editor-tag-input"
                  />
                </div>
              )
            }
            <textarea
              ref={ textRef }
              readOnly={ note.lock }
              placeholder={ note.placeholder }
              value={ draftText }
              onChange={ (e) => handleText(e.target.value) }
              onFocus={ () => { setTextFocused(true); measureFocusRect(textRef.current, setTextRect); } }
              onBlur={ () => setTextFocused(false) }
              className={ `note-editor-text custom-scroll ${ note.color }-highlight` }
            ></textarea>
            <AnimatePresence>
              { textFocused && <FocusRing key="text-ring" rect={ textRect } radius={ 10 } /> }
            </AnimatePresence>
            <div className="note-editor-footer">
              <div className="note-editor-footer-left">
                <span className="note-editor-date">{ note.time }</span>
                <AnimatePresence>
                  {
                    !draftText.trim() && (
                      <motion.button
                        key="quote"
                        type="button"
                        aria-label="Deal a new inspiration quote"
                        className="note-editor-quote"
                        initial={{ opacity: 0, scale: .8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: .8 }}
                        whileHover={{ scale: 1.08 }}
                        whileTap={{ scale: .92 }}
                        transition={{ type: "spring", stiffness: 420, damping: 18 }}
                        onClick={ () => updateQuote(note.id) }
                      >
                        <FaShuffle className="note-editor-quote-icon" />
                        new quote
                      </motion.button>
                    )
                  }
                </AnimatePresence>
              </div>
              <div className="note-editor-meta">
                <motion.span
                  key={ words }
                  className="note-editor-count"
                  initial={{ scale: .75, y: 2 }}
                  animate={{ scale: 1, y: 0 }}
                  transition={{ type: "spring", stiffness: 500, damping: 18 }}
                >
                  { words } { words === 1 ? "word" : "words" }
                </motion.span>
                <span className="note-editor-count muted">{ draftText.length } chars</span>
              </div>
            </div>
            {/* The bottom edge's own verlet chain (see the drag effect
                above) — only actually mounted while a resize is live, so
                it costs nothing the rest of the time. */}
            {
              dragSize && (
                <svg className="note-editor-edge-chain" aria-hidden="true">
                  <path ref={ edgePathRef } />
                </svg>
              )
            }
            {/* The corner grip — a direct-manipulation companion to the
                click-to-cycle resize button above, not a replacement for
                it. touch-action: none so a touch drag doesn't also try to
                scroll the page underneath it. */}
            {
              !note.lock && (
                <span
                  className="note-editor-resize-handle"
                  role="presentation"
                  style={{ touchAction: "none" }}
                  onPointerDown={ handleResizeDown }
                  onPointerMove={ handleResizeMove }
                  onPointerUp={ handleResizeEnd }
                  onPointerCancel={ handleResizeEnd }
                />
              )
            }
          </motion.div>
        </motion.div>
      </motion.div>
      {
        createPortal(
          <AnimatePresence>
            {
              copyGhost && (
                <motion.span
                  key={ copyGhost.key }
                  className={ `note-editor-copy-ghost ${ note.color }-bg` }
                  initial={{ x: copyGhost.fromX, y: copyGhost.fromY, opacity: .95, scale: 1, rotate: 0 }}
                  animate={{ x: copyGhost.toX, y: copyGhost.toY, opacity: 0, scale: .3, rotate: 18 }}
                  transition={{ duration: .55, ease: "easeIn" }}
                  onAnimationComplete={ () => setCopyGhost((prev) => (prev?.key === copyGhost.key ? null : prev)) }
                />
              )
            }
          </AnimatePresence>,
          document.body,
        )
      }
    </div>
  );
};

export default NoteEditor;
