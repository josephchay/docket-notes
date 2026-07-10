import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { FaStar, FaPen, FaXmark } from "react-icons/fa6";
import { FaEye } from "react-icons/fa";

import { NOTE_COLORS } from "../../constants/colors";

import "./NoteEditor.css";

const debounceTimer = 500;

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
}) => {
  const [draftTitle, setDraftTitle] = useState(note.title);
  const [draftText, setDraftText] = useState(note.text);

  const titleRef = useRef(null);
  const textRef = useRef(null);
  const titleTimerRef = useRef(null);
  const textTimerRef = useRef(null);

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

    const timers = [titleTimerRef, textTimerRef];
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
        className={ `note-editor ${ note.color }-bg ${ note.lock ? "locked" : "" }` }
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
                />
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
          <span className="note-editor-date">{ note.time }</span>
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
    </div>
  );
};

export default NoteEditor;
