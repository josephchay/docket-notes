import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

import useInkPulse from "../../hooks/useInkPulse";
import { NOTE_COLORS } from "../../constants/colors";
import { SETTLE, SNAPPY, squashCollapse } from "../Motion";

import "./ColorPicker.css";

// A small popover of the 7 paint dots — reached off a single trigger button
// in the editor's own header (see NoteEditor.jsx) rather than the dots
// themselves sitting there always-visible. Built as close as possible to
// DueDatePicker.jsx's own shape (portal/anchor/position-clamp/Escape/
// deferred-outside-pointerdown/squashCollapse-exit/colorName-tint) since
// that's the established "small popover off an editor toolbar button"
// pattern in this file's own sibling — not a new popover idiom.
const POPOVER_WIDTH = 234;
const POPOVER_HEIGHT = 66;

const ColorPicker = ({ open, value, anchorRef, onChange, onClose }) => {
  const [position, setPosition] = useState(null);
  const panelRef = useRef(null);

  // Same synchronous, animation-independent "is this genuinely open right
  // now" signal DueDatePicker's own identical effect provides — see that
  // file's own comment for why a plain DOM-presence check isn't enough
  // (Framer's exit animation keeps the node mounted a beat after `open`
  // already went false).
  useEffect(() => {
    document.body.classList.toggle("color-picker-open", open);
    return () => document.body.classList.remove("color-picker-open");
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
    // immediately closes it again — same trick DueDatePicker's own
    // identical effect uses.
    const timer = setTimeout(() => document.addEventListener("pointerdown", handleOutside), 0);

    return () => {
      window.removeEventListener("keydown", handleKey);
      clearTimeout(timer);
      document.removeEventListener("pointerdown", handleOutside);
    };
  }, [open, onClose, anchorRef]);

  // One shared ink ring sliding — and pooling/squashing, via the jelly
  // pulse — from color to color, the same layoutId-ring recipe the header's
  // own (now-removed) always-visible palette used to carry, plus
  // DueDatePicker's own selected-day ring.
  const activePulse = useInkPulse(value);

  if (!position) return null;

  return createPortal(
    <AnimatePresence>
      {
        open && (
          <motion.div
            ref={ panelRef }
            role="dialog"
            aria-label="Choose a note color"
            className={ `color-picker ${ value }-bg` }
            style={{ left: position.left, top: position.top }}
            initial={{ opacity: 0, scale: .8, y: -10, rotate: -3 }}
            animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }}
            exit={ squashCollapse({ scale: .85, y: -8, rotate: 2 }) }
            transition={ SETTLE }
          >
            {
              Object.keys(NOTE_COLORS).map((name) => (
                <motion.button
                  key={ name }
                  type="button"
                  aria-label={ `Paint the note ${ name }` }
                  aria-pressed={ name === value }
                  className={ `color-picker-dot ${ name }-bg ${ name === value ? "active" : "" }` }
                  whileHover={{ scale: 1.2 }}
                  whileTap={{ scale: .85 }}
                  transition={ SNAPPY }
                  onTapStart={ () => { if (name === value) activePulse.squash(); } }
                  onClick={ () => onChange(name) }
                >
                  {
                    name === value && (
                      <motion.span
                        layoutId="colorPickerRing"
                        className="color-picker-dot-ring-wrap"
                        transition={{ type: "spring", stiffness: 450, damping: 17 }}
                      >
                        <motion.span
                          className="color-picker-dot-ring"
                          animate={ activePulse.jelly }
                        />
                      </motion.span>
                    )
                  }
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

export default ColorPicker;
