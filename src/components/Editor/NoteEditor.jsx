import React, { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import { FaStar, FaPen, FaXmark, FaCopy, FaShuffle } from "react-icons/fa6";
import { FaEye } from "react-icons/fa";

import { NOTE_COLORS } from "../../constants/colors";

import "./NoteEditor.css";

const debounceTimer = 500;

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
}) => {
  const [draftTitle, setDraftTitle] = useState(note.title);
  const [draftText, setDraftText] = useState(note.text);
  const [size, setSize] = useState("roomy");
  const [copied, setCopied] = useState(false);

  // The gluey wobble: whenever the paper opens or changes size it squashes
  // and stretches like jelly while the bouncy size spring overshoots.
  const jelly = useAnimationControls();

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
  const titleTimerRef = useRef(null);
  const textTimerRef = useRef(null);
  const copiedTimerRef = useRef(null);

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

  // Drop the caret at the end of the body so writing continues immediately.
  useEffect(() => {
    const field = textRef.current;
    if (!field || note.lock) return;

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

  // Copy the whole note as plain text, with a small sparkle of confirmation.
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
        className="note-editor-shell"
        initial={{ opacity: 0, scale: .8, y: 90, rotate: -1.5 }}
        animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }}
        exit={{
          opacity: 0,
          scale: .86,
          y: 60,
          transition: { duration: .22, ease: "easeIn" },
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
            transition={{
              type: "spring",
              stiffness: 260,
              damping: 14,
              mass: .9,
            }}
          >
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
                      transition={{ type: "spring", stiffness: 420, damping: 16 }}
                      onClick={ () => setNoteColor(name, note.id) }
                    >
                      {
                        name === note.color && (
                          <motion.span
                            layoutId="editorPaletteRing"
                            className="note-editor-dot-ring"
                            style={{ borderRadius: "50%" }}
                            transition={{ type: "spring", stiffness: 450, damping: 24 }}
                          />
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
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: .9 }}
                  transition={{ type: "spring", stiffness: 420, damping: 16 }}
                  style={{
                    backgroundColor: note.favorite ? "var(--black-color)" : "var(--black-even-more-transclucent-color)",
                  }}
                  onClick={ () => updateFavorite(note.id) }
                >
                  <FaStar className={ `note-editor-action-icon ${ note.color }` } />
                </motion.button>
                <motion.button
                  type="button"
                  aria-label={ note.lock ? "Unlock this note for editing" : "Lock this note" }
                  className="note-editor-action dark"
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: .9 }}
                  transition={{ type: "spring", stiffness: 420, damping: 16 }}
                  onClick={ () => updateLock(note.id) }
                >
                  {
                    note.lock
                      ? <FaPen className="note-editor-action-icon light" />
                      : <FaEye className="note-editor-action-icon light" />
                  }
                </motion.button>
                <motion.button
                  type="button"
                  aria-label="Copy the note to the clipboard"
                  className="note-editor-action dark"
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: .9 }}
                  transition={{ type: "spring", stiffness: 420, damping: 16 }}
                  onClick={ handleCopy }
                >
                  <FaCopy className="note-editor-action-icon light" />
                </motion.button>
                <motion.button
                  type="button"
                  aria-label={ `Resize the paper (now ${ size })` }
                  className="note-editor-action"
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: .8 }}
                  transition={{ type: "spring", stiffness: 420, damping: 16 }}
                  onClick={ () => setSize(EDITOR_SIZES[(EDITOR_SIZES.indexOf(size) + 1) % EDITOR_SIZES.length]) }
                >
                  <span className={ `note-editor-size-box s${ EDITOR_SIZES.indexOf(size) }` } />
                </motion.button>
                <motion.button
                  type="button"
                  aria-label="Close the editor"
                  className="note-editor-action dark"
                  whileHover={{ scale: 1.15, rotate: 90 }}
                  whileTap={{ scale: .9 }}
                  transition={{ type: "spring", stiffness: 420, damping: 16 }}
                  onClick={ onClose }
                >
                  <FaXmark className="note-editor-action-icon light" />
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
              className={ `note-editor-title ${ note.color }-highlight` }
            />
            <textarea
              ref={ textRef }
              readOnly={ note.lock }
              placeholder={ note.placeholder }
              value={ draftText }
              onChange={ (e) => handleText(e.target.value) }
              className={ `note-editor-text custom-scroll ${ note.color }-highlight` }
            ></textarea>
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
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default NoteEditor;
