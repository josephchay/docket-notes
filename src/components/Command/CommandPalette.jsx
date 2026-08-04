import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { interpret } from "xstate";

import { commandMachine } from "./CommandState";
import useInkPulse from "../../hooks/useInkPulse";
import SheetPanel from "../Sheet/SheetPanel";

import "./CommandPalette.css";

// The event the toolbar's wand fires to summon the palette from anywhere.
export const COMMAND_EVENT = "docket:command";

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
  const filtered = actions.filter((action) =>
    action.label.toLowerCase().includes(trimmedQuery.toLowerCase())
  );

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
        {
          filtered.map((action, index) => (
            <motion.button
              key={ action.key }
              type="button"
              className={ `command-item ${ index === highlight ? "selected" : "" }` }
              initial={{ opacity: 0, translateX: -16 }}
              animate={{ opacity: 1, translateX: 0 }}
              transition={{
                type: "spring",
                stiffness: 340,
                damping: 20,
                delay: .05 + index * .035,
              }}
              onMouseEnter={ () => setSelected(index) }
              onTapStart={ commandPulse.squash }
              onClick={ () => run(action) }
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
                      animate={ commandPulse.jelly }
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
          ))
        }
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
        ↑↓ choose · Enter cast · Esc fold
      </div>
    </SheetPanel>
  );
}

export default CommandPalette;
