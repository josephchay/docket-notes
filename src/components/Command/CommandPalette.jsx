import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { interpret } from "xstate";

import { commandMachine } from "./CommandState";

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

  const filtered = actions.filter((action) =>
    action.label.toLowerCase().includes(query.trim().toLowerCase())
  );

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

  return (
    <AnimatePresence>
      {
        open && (
          <div className="command-layer">
            <motion.div
              className="command-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: .2 } }}
              onClick={ () => service.send("CLOSE") }
            />
            <motion.div
              className="command-panel"
              initial={{ opacity: 0, scale: .1, translateY: 90, borderRadius: 60 }}
              animate={
                phase === "casting" ? {
                  opacity: 1,
                  scale: [1, .93, 1.04],
                  translateY: 0,
                  borderRadius: 24,
                  transition: { duration: .24, times: [0, .5, 1], ease: "easeInOut" },
                } : {
                  opacity: 1,
                  scale: 1,
                  translateY: 0,
                  borderRadius: 18,
                  transition: { type: "spring", stiffness: 200, damping: 13.5 },
                }
              }
              exit={{
                opacity: 0,
                scale: .24,
                translateY: 60,
                borderRadius: 50,
                transition: { duration: .2, ease: "easeIn" },
              }}
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
                      onClick={ () => run(action) }
                    >
                      {
                        index === highlight && (
                          <motion.span
                            layoutId="commandThumb"
                            className="command-thumb"
                            style={{ borderRadius: 12 }}
                            transition={{ type: "spring", stiffness: 520, damping: 32 }}
                          />
                        )
                      }
                      <span className="command-item-icon">{ action.icon }</span>
                      <span className="command-item-label">{ action.label }</span>
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
            </motion.div>
          </div>
        )
      }
    </AnimatePresence>
  );
}

export default CommandPalette;
