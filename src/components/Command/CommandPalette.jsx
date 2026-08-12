import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useTransform } from "framer-motion";
import { interpret } from "xstate";
import { FaThumbtack, FaEyeSlash } from "react-icons/fa6";

import { commandMachine } from "./CommandState";
import useInkPulse from "../../hooks/useInkPulse";
import SheetPanel from "../Sheet/SheetPanel";
import { loadSettings, saveSettings } from "../../utils/storage";
import { LIST_ROW_SPRING, listRowDelay } from "../Motion";

import "./CommandPalette.css";

// The event the toolbar's wand fires to summon the palette from anywhere.
export const COMMAND_EVENT = "docket:command";

// How far a row has to travel before release counts as a real swipe
// rather than a tap that merely wandered — same distance-based intent
// check every drag-to-trigger gesture in this app already uses (the
// pull-strings' own PULL_THRESHOLD, MoveString's HOVER_PADDING). Pin and
// hide share one constraint window (±SWIPE_RANGE) rather than each
// picking its own, so the row's own travel reads as symmetric under the
// hand regardless of which way it's headed.
const SWIPE_THRESHOLD = 90;
const SWIPE_RANGE = 140;

// A single swipeable row — its own component (rather than inline in the
// list below) purely so its drag motion values and the two live icon
// opacities derived from them (useTransform) get a fresh instance per
// row instead of one shared pair every row would otherwise fight over.
const CommandRow = ({ action, index, highlight, pulse, onSelect, onRun, onPin, onHide, renderLabel }) => {
  const dragX = useMotionValue(0);
  const pinOpacity = useTransform(dragX, [0, SWIPE_THRESHOLD], [0, 1], { clamp: true });
  const hideOpacity = useTransform(dragX, [0, -SWIPE_THRESHOLD], [0, 1], { clamp: true });

  const handleDragEnd = (e, info) => {
    if (info.offset.x > SWIPE_THRESHOLD) onPin(action.key);
    else if (info.offset.x < -SWIPE_THRESHOLD) onHide(action.key);
  };

  return (
    // command-row-slot is the static backing every row's own drag reveals
    // rather than travels with — layout, exit, and delay all live here
    // (not on the button below) so AnimatePresence's own popLayout still
    // sees one coherent list item per action, sliding/reflowing as a
    // whole; the button inside is free to carry its OWN independent x
    // without that fighting the slot's layout animation for the same
    // transform.
    <motion.div
      layout
      className="command-row-slot"
      initial={{ opacity: 0, translateX: -16 }}
      animate={{ opacity: 1, translateX: 0 }}
      exit={{ opacity: 0, translateX: -16, scale: .96, transition: { duration: .16, ease: "easeIn" } }}
      transition={{ ...LIST_ROW_SPRING, delay: listRowDelay(index) }}
    >
      {/* The swipe's own live hint — pin to the right, hide to the left —
          fixed here in the static backing rather than inside the button
          that actually carries dragX, so the row sliding away is what
          reveals them rather than the row dragging them along with it.
          Purely opacity-driven off the same dragX the row's own x
          already rides, so they track the gesture with zero lag. */}
      <motion.span className="command-item-hint-pin" style={{ opacity: pinOpacity }} aria-hidden="true">
        <FaThumbtack />
      </motion.span>
      <motion.span className="command-item-hint-hide" style={{ opacity: hideOpacity }} aria-hidden="true">
        <FaEyeSlash />
      </motion.span>
      <motion.button
        type="button"
        className={ `command-item ${ index === highlight ? "selected" : "" }` }
        style={{ x: dragX }}
        drag="x"
        dragConstraints={{ left: -SWIPE_RANGE, right: SWIPE_RANGE }}
        dragElastic={ 0.6 }
        dragSnapToOrigin
        onDragEnd={ handleDragEnd }
        onMouseEnter={ onSelect }
        onTapStart={ pulse.squash }
        onClick={ onRun }
      >
        {
          index === highlight && (
            <motion.span
              layoutId="commandThumb"
              style={{ position: "absolute", inset: 0, borderRadius: 12 }}
              transition={{ type: "spring", stiffness: 520, damping: 20 }}
            >
              <motion.span
                className="command-thumb"
                animate={ pulse.jelly }
                style={{ borderRadius: "inherit" }}
              />
            </motion.span>
          )
        }
        <span className="command-item-icon">{ action.icon }</span>
        <span className="command-item-label">{ renderLabel(action.label) }</span>
        {
          action.hint && (
            <kbd className="command-item-hint">{ action.hint }</kbd>
          )
        }
      </motion.button>
    </motion.div>
  );
};

// A command palette for the desk, run by its own xstate machine. Ctrl/Cmd+K
// (or the toolbar wand) summons it: the panel morphs up out of a drop —
// tiny, round, and starchy — into a full sheet of paper. Typing filters the
// commands, the selection thumb slides stickily between rows, and casting a
// command squashes the panel like pressed jelly before it folds away.
const CommandPalette = ({ actions }) => {
  const [service] = useState(() => interpret(commandMachine));
  const [phase, setPhase] = useState("closed");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  // Which commands have been swiped pinned or hidden (see CommandRow's own
  // onPin/onHide below) — routed through the exact same loadSettings/
  // saveSettings pair the theme preference already uses, rather than a
  // dedicated storage key of its own, so this automatically respects the
  // same session-vs-local persist toggle every other stored preference in
  // the app already answers to.
  const [pinned, setPinned] = useState(() => loadSettings().pinnedCommands || []);
  const [hidden, setHidden] = useState(() => loadSettings().hiddenCommands || []);

  const pinAction = (key) => {
    setPinned((prev) => {
      const next = [key, ...prev.filter((k) => k !== key)];
      saveSettings({ pinnedCommands: next });
      return next;
    });
    // A pin only ever means something once it isn't also hidden.
    setHidden((prev) => {
      if (!prev.includes(key)) return prev;
      const next = prev.filter((k) => k !== key);
      saveSettings({ hiddenCommands: next });
      return next;
    });
  };

  const hideAction = (key) => {
    setHidden((prev) => {
      if (prev.includes(key)) return prev;
      const next = [...prev, key];
      saveSettings({ hiddenCommands: next });
      return next;
    });
  };

  const restoreHidden = () => {
    setHidden([]);
    saveSettings({ hiddenCommands: [] });
  };

  const open = phase !== "closed";

  useEffect(() => {
    service
      .onTransition((state) => setPhase(String(state.value)))
      .start();

    return () => service.stop();
  }, [service]);

  useEffect(() => {
    const handleKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        service.send("TOGGLE");
      } else if (e.key === "Escape") {
        service.send("CLOSE");
      }
    };
    const handleSummon = () => service.send("OPEN");

    window.addEventListener("keydown", handleKey);
    window.addEventListener(COMMAND_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(COMMAND_EVENT, handleSummon);
    };
  }, [service]);

  // A fresh sheet every time it opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
    }
  }, [open]);

  const trimmedQuery = query.trim();
  // Hidden commands drop out entirely; pinned ones float to the top, in
  // the order they were pinned (most recent pin first — see pinAction's
  // own [key, ...prev] unshift), everything else keeping its original
  // order after them.
  const filtered = actions
    .filter((action) => !hidden.includes(action.key))
    .filter((action) => action.label.toLowerCase().includes(trimmedQuery.toLowerCase()))
    .sort((a, b) => {
      const pa = pinned.indexOf(a.key);
      const pb = pinned.indexOf(b.key);
      if (pa === -1 && pb === -1) return 0;
      if (pa === -1) return 1;
      if (pb === -1) return -1;
      return pa - pb;
    });

  // Marks the matched stretch of a label with a little pop of ink, instead
  // of leaving the visitor to guess why a row surfaced.
  const renderLabel = (label) => {
    if (!trimmedQuery) return label;

    const start = label.toLowerCase().indexOf(trimmedQuery.toLowerCase());
    if (start === -1) return label;

    const end = start + trimmedQuery.length;

    return (
      <>
        { label.slice(0, start) }
        <motion.mark
          key={ trimmedQuery }
          initial={{ opacity: 0, scale: .5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 20 }}
        >
          { label.slice(start, end) }
        </motion.mark>
        { label.slice(end) }
      </>
    );
  };

  const run = (action) => {
    if (phase !== "open") return;
    action.perform();
    service.send("RUN");
  };

  const handleListKeys = (e) => {
    if (filtered.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => (s + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => (s - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter" && filtered[Math.min(selected, filtered.length - 1)]) {
      run(filtered[Math.min(selected, filtered.length - 1)]);
    }
  };

  const highlight = Math.min(selected, Math.max(filtered.length - 1, 0));
  const commandPulse = useInkPulse(highlight);

  const panelRef = useRef(null);

  // Casting a command still gets its own quick squash pulse rather than the
  // shared entrance shape — a distinct micro-interaction (confirming a cast
  // landed), not a second way to open the palette. Command is the one
  // SheetPanel caller whose `animate` target actually flips back and forth
  // while mounted (casting <-> open), so — unlike the other six, which
  // never re-target `animate` at all and can safely leave this undefined
  // to fall through to SheetPanel's own keyframe entrance — this always
  // passes an explicit override, even for the "settled" case. Falling
  // through here would mean flipping *back* to SheetPanel's default after
  // a cast retriggers its entrance keyframes (which start at scaleX/scaleY
  // .08) from the current ~1, visibly shrinking the panel to 8% and
  // reblooming it on every single cast — a real bug, not a style choice.
  const panelAnimate = phase === "casting" ? {
    opacity: 1,
    scale: [1, .93, 1.04],
    translateY: 0,
    borderRadius: 24,
    transition: { duration: .24, times: [0, .5, 1], ease: "easeInOut" },
  } : {
    opacity: 1,
    scaleX: 1,
    scaleY: 1,
    translateY: 0,
    rotateX: 0,
    borderRadius: 18,
    transition: { type: "spring", stiffness: 200, damping: 13.5 },
  };

  return (
    <SheetPanel
      open={ open }
      onClose={ () => service.send("CLOSE") }
      panelRef={ panelRef }
      radius={ 18 }
      layerClassName="command-layer"
      backdropClassName="command-backdrop"
      panelClassName="command-panel"
      ariaLabel="Command palette"
      animate={ panelAnimate }
      // The search input has its own autoFocus below (so typing works the
      // instant the palette opens, core to a command palette's whole
      // point) — SheetPanel's usual focus-the-panel-root step would just
      // steal that back a frame later.
      focusOnOpen={ false }
    >
      <input
        autoFocus
        type="text"
        className="command-input"
        placeholder="Cast a command…"
        value={ query }
        onChange={ (e) => { setQuery(e.target.value); setSelected(0); } }
        onKeyDown={ handleListKeys }
      />
      <div className="command-list custom-scroll">
        {/* mode="popLayout" pulls a filtered-out row out of document flow the
            instant it starts exiting, so the rows below it can immediately
            reflow up into its place while it fades out on top — a real
            leave transition instead of narrowing the query just snapping
            rows away. */}
        <AnimatePresence mode="popLayout" initial={ false }>
          {
            filtered.map((action, index) => (
              <CommandRow
                key={ action.key }
                action={ action }
                index={ index }
                highlight={ highlight }
                pulse={ commandPulse }
                onSelect={ () => setSelected(index) }
                onRun={ () => run(action) }
                onPin={ pinAction }
                onHide={ hideAction }
                renderLabel={ renderLabel }
              />
            ))
          }
        </AnimatePresence>
        {
          filtered.length === 0 && (
            <motion.p
              className="command-empty"
              initial={{ opacity: 0, scale: .8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 18 }}
            >
              Nothing casts like that
            </motion.p>
          )
        }
      </div>
      <div className="command-footer">
        <span>↑↓ choose · Enter cast · Esc fold · drag a row to pin/hide it</span>
        {
          hidden.length > 0 && (
            <button type="button" className="command-restore" onClick={ restoreHidden }>
              Restore { hidden.length } hidden
            </button>
          )
        }
      </div>
    </SheetPanel>
  );
}

export default CommandPalette;
