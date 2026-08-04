import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  FaXmark, FaPlus, FaExpand, FaHourglassHalf, FaMagnifyingGlass,
  FaWandMagicSparkles, FaRotateLeft, FaArrowRotateRight, FaArrowsUpDown,
  FaCheck, FaQuestion,
} from "react-icons/fa6";

import SheetPanel from "../Sheet/SheetPanel";
import useJellyTap from "../../hooks/useJellyTap";
import { LIST_ROW_SPRING, listRowDelay } from "../Motion";

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

// Maps a KeyboardEvent's own `.key` to whatever label this sheet shows for
// it — most keys already match once upper-cased, a handful of named ones
// (arrows, modifiers, Escape) don't.
const KEY_ALIASES = {
  Control: "Ctrl",
  Meta: "Ctrl",
  Shift: "Shift",
  Escape: "Esc",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Enter: "Enter",
};

const labelForKey = (key) => KEY_ALIASES[key] ?? (key.length === 1 ? key.toUpperCase() : key);

// One row: an icon (jelly-squashed on hover, via the same useJellyTap
// recipe every toolbar icon elsewhere already uses), the action it names,
// and its keys — which visually depress like a real keycap being pressed
// (see .shortcuts-row:hover .shortcuts-key) either on hover or, now, for
// real: `pressedKeys` (a Set of key labels currently held, see
// ShortcutsSheet below) lights up any kbd that's actually being pressed
// while this sheet is open, not just decoratively on hover. Its own
// component (rather than inlined in the map below) since useJellyTap needs
// one controller per row, and hooks can't run in a loop.
const ShortcutRow = ({ row, index, pressedKeys }) => {
  const iconJelly = useJellyTap();
  const Icon = row.icon;

  return (
    <motion.div
      className="shortcuts-row"
      initial={{ opacity: 0, translateX: -16 }}
      animate={{ opacity: 1, translateX: 0 }}
      transition={{ ...LIST_ROW_SPRING, delay: listRowDelay(index, { step: .04 }) }}
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
            <kbd
              key={ key }
              className={ `shortcuts-key ${ pressedKeys.has(key) ? "is-pressed" : "" }` }
            >
              { key }
            </kbd>
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

  // While the sheet is actually open, every kbd gets to be honest about
  // whether its own key is physically down — a Set of currently-held key
  // labels, tracked only for this window rather than always-on, so it never
  // adds a global keydown/keyup pair for a feature nobody's looking at.
  // Cleared on close and on window blur (alt-tabbing away mid-hold would
  // otherwise leave a key stuck lit — keyup never fires once focus is gone).
  const [pressedKeys, setPressedKeys] = useState(() => new Set());

  useEffect(() => {
    if (!open) {
      setPressedKeys(new Set());
      return;
    }

    const down = (e) => {
      const label = labelForKey(e.key);
      setPressedKeys((prev) => (prev.has(label) ? prev : new Set(prev).add(label)));
    };
    const up = (e) => {
      const label = labelForKey(e.key);
      setPressedKeys((prev) => {
        if (!prev.has(label)) return prev;
        const next = new Set(prev);
        next.delete(label);
        return next;
      });
    };
    const clear = () => setPressedKeys(new Set());

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, [open]);

  return (
    <SheetPanel
      open={ open }
      onClose={ () => setOpen(false) }
      panelRef={ panelRef }
      radius={ 20 }
      layerClassName="shortcuts-layer"
      backdropClassName="shortcuts-backdrop"
      panelClassName="shortcuts-panel"
      ariaLabel="Keyboard shortcuts"
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
                    <ShortcutRow key={ row.label } row={ row } index={ index } pressedKeys={ pressedKeys } />
                  ))
                }
              </div>
    </SheetPanel>
  );
};

export default ShortcutsSheet;
