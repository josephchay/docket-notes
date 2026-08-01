import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  FaXmark, FaPlus, FaExpand, FaHourglassHalf, FaMagnifyingGlass,
  FaWandMagicSparkles, FaRotateLeft, FaArrowRotateRight, FaArrowsUpDown,
  FaCheck, FaQuestion,
} from "react-icons/fa6";

import useBlobClipMorph from "../../hooks/useBlobClipMorph";
import useFocusTrap from "../../hooks/useFocusTrap";
import useJellyTap from "../../hooks/useJellyTap";

import "./ShortcutsSheet.css";

// The event the command palette's "Show keyboard shortcuts" entry fires to
// summon this sheet from anywhere.
export const SHORTCUTS_EVENT = "docket:shortcuts";

const SHORTCUTS = [
  { keys: ["N"], label: "Pour a new note", icon: FaPlus },
  { keys: ["F"], label: "Toggle focus mode", icon: FaExpand },
  { keys: ["S"], label: "Toggle the focus sprint", icon: FaHourglassHalf },
  { keys: ["/"], label: "Jump to search", icon: FaMagnifyingGlass },
  { keys: ["Ctrl", "K"], label: "Open the command palette", icon: FaWandMagicSparkles },
  { keys: ["Ctrl", "Z"], label: "Undo the last edit", icon: FaRotateLeft },
  { keys: ["Ctrl", "Shift", "Z"], label: "Redo the last undo", icon: FaArrowRotateRight },
  { keys: ["↑", "↓"], label: "Move through a list", icon: FaArrowsUpDown },
  { keys: ["Enter"], label: "Confirm the highlighted row", icon: FaCheck },
  { keys: ["Esc"], label: "Close whatever's open", icon: FaXmark },
  { keys: ["?"], label: "Show this sheet", icon: FaQuestion },
];

// One row: an icon (jelly-squashed on hover, via the same useJellyTap
// recipe every toolbar icon elsewhere already uses), the action it names,
// and its keys — which visually depress like a real keycap being pressed
// (see .shortcuts-row:hover .shortcuts-key) for as long as the row is
// hovered. Its own component (rather than inlined in the map below) since
// useJellyTap needs one controller per row, and hooks can't run in a loop.
const ShortcutRow = ({ row, index }) => {
  const iconJelly = useJellyTap();
  const Icon = row.icon;

  return (
    <motion.div
      className="shortcuts-row"
      initial={{ opacity: 0, translateX: -16 }}
      animate={{ opacity: 1, translateX: 0 }}
      transition={{
        type: "spring",
        stiffness: 340,
        damping: 20,
        delay: .05 + index * .04,
      }}
      onHoverStart={ iconJelly.squash }
    >
      <span className="shortcuts-row-main">
        <motion.span className="shortcuts-row-icon" animate={ iconJelly.jelly }>
          <Icon />
        </motion.span>
        <span className="shortcuts-row-label">{ row.label }</span>
      </span>
      <span className="shortcuts-row-keys">
        {
          row.keys.map((key) => (
            <kbd key={ key } className="shortcuts-key">{ key }</kbd>
          ))
        }
      </span>
    </motion.div>
  );
};

// A quick reference for the desk's keyboard shortcuts. "?" summons it
// (guarded the same way as N and / in Home.jsx — it stands down while any
// field has the caret). Built from the same dot-to-sheet morph recipe as
// the command palette, kept as its own component since this one has no
// casting phase — just a look-up, staggered in row by row.
const ShortcutsSheet = () => {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  // The dot-to-sheet morph clips through a real organic blob stage
  // (utils/blob.js's flubber-powered createBlobMorph) on top of the scale
  // spring below.
  const onBlobUpdate = useBlobClipMorph(panelRef, open, 20);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest("input, textarea")) return;

      if (e.key === "?") {
        e.preventDefault();
        setOpen((prev) => !prev);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(SHORTCUTS_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(SHORTCUTS_EVENT, handleSummon);
    };
  }, []);

  // Traps Tab/Shift+Tab within the sheet while open and returns focus to
  // whatever triggered it once closed — see useFocusTrap.js. Missed in the
  // previous round's sweep across the other five dot-to-sheet panels;
  // same convention, same fix.
  useFocusTrap(panelRef, open);

  return (
    <AnimatePresence>
      {
        open && (
          <div className="shortcuts-layer">
            <motion.div
              className="shortcuts-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: .2 } }}
              onClick={ () => setOpen(false) }
            />
            <motion.div
              ref={ panelRef }
              tabIndex={ -1 }
              className="shortcuts-panel"
              initial={{ opacity: 0, scale: .1, translateY: 90, borderRadius: 60 }}
              onUpdate={ onBlobUpdate }
              animate={{ opacity: 1, scale: 1, translateY: 0, borderRadius: 20 }}
              exit={{
                opacity: 0,
                scale: .24,
                translateY: 60,
                borderRadius: 50,
                transition: { duration: .2, ease: "easeIn" },
              }}
              transition={{ type: "spring", stiffness: 190, damping: 14 }}
            >
              <div className="shortcuts-header">
                <h3>Shortcuts</h3>
                <motion.button
                  type="button"
                  aria-label="Close"
                  className="shortcuts-close"
                  whileHover={{ scale: 1.15, rotate: 90 }}
                  whileTap={{ scale: .9 }}
                  transition={{ type: "spring", stiffness: 420, damping: 16 }}
                  onClick={ () => setOpen(false) }
                >
                  <FaXmark />
                </motion.button>
              </div>
              <div className="shortcuts-list">
                {
                  SHORTCUTS.map((row, index) => (
                    <ShortcutRow key={ row.label } row={ row } index={ index } />
                  ))
                }
              </div>
            </motion.div>
          </div>
        )
      }
    </AnimatePresence>
  );
};

export default ShortcutsSheet;
