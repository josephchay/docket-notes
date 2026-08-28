import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

import { STUDY_TEMPLATES } from "../../utils/study";
import { SETTLE, SNAPPY, squashCollapse } from "../Motion";

import "./StudyTemplatePicker.css";

// A small popover of the study templates — reached off the editor's own
// study toolbar button when the note ISN'T a study yet (a note that
// already is one converts straight back to plain text on that same
// button, no choice to make). Built as close as possible to
// ColorPicker.jsx's own shape (portal/anchor/position-clamp/Escape/
// deferred-outside-pointerdown/squashCollapse-exit) since that's the
// established "small popover off an editor toolbar button" pattern in
// this same folder — not a new popover idiom. Rows come straight from
// STUDY_TEMPLATES, so a future template added there shows up here with
// zero changes.
const POPOVER_WIDTH = 264;
const POPOVER_HEIGHT = 170;

const StudyTemplatePicker = ({ open, colorName, anchorRef, onChange, onClose }) => {
  const [position, setPosition] = useState(null);
  const panelRef = useRef(null);

  // Same synchronous, animation-independent "is this genuinely open right
  // now" signal DueDatePicker/ColorPicker's own identical effects provide
  // — see those files' comments for why a plain DOM-presence check isn't
  // enough (Framer's exit animation keeps the node mounted a beat after
  // `open` already went false). NoteEditor's and ScriptureIndexPanel's own
  // Escape handlers both read this class to defer while this is open.
  useEffect(() => {
    document.body.classList.toggle("study-picker-open", open);
    return () => document.body.classList.remove("study-picker-open");
  }, [open]);

  // Re-anchors off the trigger button every time this is freshly opened.
  useEffect(() => {
    if (!open) return;

    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) {
      setPosition({
        left: Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 12),
        top: Math.min(rect.bottom + 10, window.innerHeight - POPOVER_HEIGHT - 12),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleKey = (e) => { if (e.key === "Escape") onClose(); };
    const handleOutside = (e) => {
      if (panelRef.current?.contains(e.target)) return;
      if (anchorRef.current?.contains(e.target)) return;
      onClose();
    };

    window.addEventListener("keydown", handleKey);
    // Deferred a tick so the very pointerdown that opened this (the trigger
    // button itself) doesn't also count as the outside click that
    // immediately closes it again — same trick ColorPicker's own identical
    // effect uses.
    const timer = setTimeout(() => document.addEventListener("pointerdown", handleOutside), 0);

    return () => {
      window.removeEventListener("keydown", handleKey);
      clearTimeout(timer);
      document.removeEventListener("pointerdown", handleOutside);
    };
  }, [open, onClose, anchorRef]);

  if (!position) return null;

  return createPortal(
    <AnimatePresence>
      {
        open && (
          <motion.div
            ref={ panelRef }
            role="dialog"
            aria-label="Choose a study shape"
            className={ `study-template-picker ${ colorName }-bg` }
            style={{ left: position.left, top: position.top }}
            initial={{ opacity: 0, scale: .8, y: -10, rotate: -3 }}
            animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }}
            exit={ squashCollapse({ scale: .85, y: -8, rotate: 2 }) }
            transition={ SETTLE }
          >
            {
              STUDY_TEMPLATES.map((template) => (
                <motion.button
                  key={ template.id }
                  type="button"
                  aria-label={ `Shape this note as a ${ template.label } study` }
                  className="study-template-row"
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: .96 }}
                  transition={ SNAPPY }
                  onClick={ () => onChange(template.id) }
                >
                  <span className="study-template-label">{ template.label }</span>
                  <span className="study-template-headings">
                    { template.sections.map((s) => s.heading).join(" · ") }
                  </span>
                  <span className="study-template-about">{ template.about }</span>
                </motion.button>
              ))
            }
          </motion.div>
        )
      }
    </AnimatePresence>,
    document.body
  );
};

export default StudyTemplatePicker;
