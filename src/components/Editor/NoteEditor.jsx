import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import { FaStar, FaPen, FaXmark, FaCopy, FaShuffle, FaTag, FaCalendarDay, FaListCheck } from "react-icons/fa6";
import { FaEye } from "react-icons/fa";

import { NOTE_COLORS } from "../../constants/colors";
import useJellyTap from "../../hooks/useJellyTap";
import useInkPulse from "../../hooks/useInkPulse";
import useFocusTrap from "../../hooks/useFocusTrap";
import HistoryAmbient from "../History/HistoryAmbient";
import { EXIT_SPRING, coinFlip } from "../Motion";
import { dueLabel } from "../../utils/date";
import { isChecklistText, toChecklistText, fromChecklistText } from "../../utils/checklist";
import ChecklistBody from "../Note/ChecklistBody";
import DueDatePicker from "./DueDatePicker";

import "./NoteEditor.css";

const debounceTimer = 500;

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

// A thin ink stroke drawing itself on around the title field while it's
// actually focused, rather than an instant CSS border/outline swap — the
// same pathLength draw-on technique TrashPanel's own hold-to-confirm ring
// already uses, just triggered by focus instead of a held press. `rect` is
// measured in the caller (offsetLeft/Top/Width/Height against .note-editor,
// the nearest positioned ancestor) rather than this component reading a
// ref itself.
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
  setNoteDueDate,
  toggleChecklist,
}) => {
  const [draftTitle, setDraftTitle] = useState(note.title);
  const [draftText, setDraftText] = useState(note.text);
  const [size, setSize] = useState("roomy");
  const [copied, setCopied] = useState(false);

  // The body renders as an interactive checklist the moment its own text
  // reads as one — see Note.jsx's identical read for why this is derived
  // rather than a stored mode.
  const isChecklist = isChecklistText(draftText);
  const due = dueLabel(note.dueAt);

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
  const remindTap = useJellyTap();
  const checklistTap = useJellyTap();
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

  // The focus-draw ring (see FocusRing below) — measured via offsetLeft/
  // offsetTop/offsetWidth/offsetHeight rather than wrapping the title
  // field in a new positioning container, since it already sits directly
  // inside .note-editor (itself position: relative), so its own offsets
  // already land in exactly the coordinate space an absolutely-positioned
  // sibling overlay needs. Re-measured whenever the paper's own size
  // changes while the field is focused, so a resize mid-focus doesn't leave
  // the ring sized for stale dimensions.
  const [titleFocused, setTitleFocused] = useState(false);
  const [titleRect, setTitleRect] = useState(null);

  const measureFocusRect = (el, setter) => {
    if (!el) return;
    setter({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight });
  };

  useEffect(() => {
    if (titleFocused) measureFocusRect(titleRef.current, setTitleRect);
  }, [size, titleFocused]);

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
  // focused to Tab from rather than nothing at all. A note that opens
  // straight into checklist mode has no textRef to focus here at all (see
  // the isChecklist branch below) — ChecklistBody handles that case itself
  // via its own `autoFocus` prop, landing on its first row instead.
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

  // Disarms a pending debounced text commit without discarding it — used
  // right before the checklist toggle below, which is handed draftText
  // directly (see toggleChecklist(note.id, draftText)) rather than reading
  // note.text back out of Home's own state, so it always converts exactly
  // what's on screen even mid-keystroke. Left armed, that old timer would
  // still fire ~debounceTimer later and commit the stale PRE-toggle plain
  // text over top of the just-toggled checklist, silently undoing it.
  const cancelPendingText = () => {
    clearTimeout(textTimerRef.current);
    textTimerRef.current = null;
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

  // The reminder button opens DueDatePicker.jsx's own hand-built calendar
  // popover instead of the browser's native date widget — anchored off
  // this button's own rect, which the popover measures itself via this ref.
  const remindBtnRef = useRef(null);
  const [dueCalendarOpen, setDueCalendarOpen] = useState(false);

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
            className={ `note-editor ${ size } ${ note.color }-bg ${ note.lock ? "locked" : "" }` }
            initial={ sizeFor("roomy") }
            animate={ sizeFor(size) }
            transition={{ type: "spring", stiffness: 260, damping: 14, mass: .9 }}
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
                  ref={ remindBtnRef }
                  type="button"
                  aria-label={ note.dueAt ? "Change this note's reminder" : "Set a reminder for this note" }
                  aria-pressed={ dueCalendarOpen }
                  className="note-editor-action dark"
                  whileHover={{ scale: 1.15, rotate: -8 }}
                  whileTap={{ scale: .9 }}
                  transition={ actionSpring }
                  onTapStart={ remindTap.squash }
                  onClick={ () => setDueCalendarOpen((prev) => !prev) }
                >
                  <motion.span animate={ remindTap.jelly } style={{ display: "inline-flex" }}>
                    <FaCalendarDay className="note-editor-action-icon light" />
                  </motion.span>
                </motion.button>
                <motion.button
                  type="button"
                  aria-label={ isChecklist ? "Turn this back into plain text" : "Turn this into a checklist" }
                  aria-pressed={ isChecklist }
                  disabled={ note.lock }
                  className="note-editor-action"
                  style={{
                    backgroundColor: isChecklist ? "var(--black-color)" : "var(--black-even-more-transclucent-color)",
                    opacity: note.lock ? .4 : 1,
                  }}
                  whileHover={ note.lock ? undefined : { scale: 1.15, rotate: 8 } }
                  whileTap={ note.lock ? undefined : { scale: .9 } }
                  transition={ actionSpring }
                  onTapStart={ checklistTap.squash }
                  onClick={ () => {
                    if (note.lock) return;
                    cancelPendingText();
                    // draftText is updated here directly rather than left
                    // to round-trip back down through the note.text prop
                    // (see the sync effect above) — that effect only syncs
                    // while the field it guards against isn't itself
                    // focused, and this toggle can fire with the textarea
                    // still mid-focus (typed something, clicked straight
                    // over to this button without an intervening blur) —
                    // updating locally keeps the toggle instant and
                    // correct regardless of that timing.
                    const nextText = isChecklist ? fromChecklistText(draftText) : toChecklistText(draftText);
                    setDraftText(nextText);
                    toggleChecklist(note.id, draftText);
                  } }
                >
                  <motion.span animate={ checklistTap.jelly } style={{ display: "inline-flex" }}>
                    <FaListCheck className={ `note-editor-action-icon ${ isChecklist ? "light" : "" }` } />
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
            {
              isChecklist ? (
                <ChecklistBody
                  text={ draftText }
                  onChange={ handleText }
                  locked={ note.lock }
                  colorName={ note.color }
                  className="editor-checklist"
                  autoFocus={ !note.lock }
                />
              ) : (
                <textarea
                  ref={ textRef }
                  readOnly={ note.lock }
                  placeholder={ note.placeholder }
                  value={ draftText }
                  onChange={ (e) => handleText(e.target.value) }
                  className={ `note-editor-text custom-scroll ${ note.color }-highlight` }
                ></textarea>
              )
            }
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
                <AnimatePresence>
                  {
                    due && (
                      <motion.span
                        key="dueChip"
                        className={ `note-editor-due-chip ${ due.urgency }` }
                        initial={{ opacity: 0, scale: .7 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: .7 }}
                        transition={{ type: "spring", stiffness: 420, damping: 18 }}
                      >
                        { due.text }
                        <button
                          type="button"
                          aria-label="Clear this reminder"
                          className="note-editor-due-clear"
                          onClick={ () => setNoteDueDate(null, note.id) }
                        >
                          <FaXmark />
                        </button>
                      </motion.span>
                    )
                  }
                </AnimatePresence>
              </div>
              {
                !isChecklist && (
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
                )
              }
            </div>
          </motion.div>
        </motion.div>
      </motion.div>
      <DueDatePicker
        open={ dueCalendarOpen }
        value={ note.dueAt }
        colorName={ note.color }
        anchorRef={ remindBtnRef }
        onChange={ (date) => { setNoteDueDate(date, note.id); setDueCalendarOpen(false); } }
        onClose={ () => setDueCalendarOpen(false) }
      />
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
