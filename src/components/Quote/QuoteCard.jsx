import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { interpret } from "xstate";
import { FaFeather, FaShuffle } from "react-icons/fa6";

import { toggleMachine } from "../Navigation/NavigationState";
import { dealRandomVerseParts, FALLBACK_VERSES } from "../../utils/randomVerse";
import { SNAPPY, EXIT_SPRING } from "../Motion";

import "./QuoteCard.css";

const springy = SNAPPY;

// A strip of daily ink for the desk — now dealt from scripture itself
// rather than the old bundled quotes.json: each line is a random KJV verse
// from bible-api.com (see utils/randomVerse.js), shown with its own
// reference the way every other verse in this app is. The same xstate
// toggle machine that drives the nav rail folds it in and out: unfolding
// morphs a dot of paper out of the tab into a full strip with a loose,
// starchy spring, and dealing a new line flips the old one away like a
// turned page.
const QuoteCard = () => {
  const [open, setOpen] = useState(false);
  const [service] = useState(() => interpret(toggleMachine));

  // Starts on a local fallback so the strip is never blank — the first
  // real deal happens on the first unfold (see the effect below), never
  // eagerly on mount: this card spends the same rate-limited request
  // budget everything else does (utils/bibleApi.js), and most sessions
  // never unfold it at all.
  const [verse, setVerse] = useState(() => FALLBACK_VERSES[Math.floor(Math.random() * FALLBACK_VERSES.length)]);

  // Guards a slow deal landing after a faster later one (or after several
  // rapid taps of the deal button) — only the LATEST requested deal is
  // allowed to set the line, the same monotonic-request-id pattern the
  // editor's own verse previews use.
  const dealRequestRef = useRef(0);
  const dealtOnceRef = useRef(false);

  const deal = ({ background } = {}) => {
    const requestId = ++dealRequestRef.current;
    dealRandomVerseParts({ background }).then((next) => {
      if (dealRequestRef.current !== requestId) return;
      // A deal that lands on the line already showing reads as the button
      // doing nothing — realistic only on the offline fallback path (7
      // local verses; the live endpoint repeating is a ~1-in-31,000
      // fluke), where one re-draw from the remaining six restores the
      // page-turn the old quotes.json deal always guaranteed.
      setVerse((prev) => {
        if (next.reference !== prev.reference || next.text !== prev.text) return next;
        const others = FALLBACK_VERSES.filter((v) => v.reference !== prev.reference);
        return others[Math.floor(Math.random() * others.length)] ?? next;
      });
    });
  };

  useEffect(() => {
    service
      .onTransition((state) => {
        if (state.value === "active") setOpen(true);
        else if (state.value === "inactive") setOpen(false);
      })
      .start();

    return () => service.stop();
  }, [service]);

  // The first unfold trades the seeded fallback for a genuinely dealt
  // verse — background tier, since it's ambient flavor the visitor didn't
  // explicitly ask for, and must never make a deliberate lookup elsewhere
  // in the app wait its turn.
  useEffect(() => {
    if (!open || dealtOnceRef.current) return;
    dealtOnceRef.current = true;
    deal({ background: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className="quote-card-slot">
      <motion.button
        type="button"
        aria-expanded={ open }
        aria-label="Fold the daily ink in or out"
        className={ `quote-tab ${ open ? "open" : "" }` }
        initial={{ opacity: 0, translateY: 30 }}
        animate={{ opacity: 1, translateY: 0 }}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: .9 }}
        transition={{ ...springy, delay: .9 }}
        onClick={ () => service.send("TOGGLE") }
      >
        <FaFeather className="quote-tab-icon" />
        daily ink
      </motion.button>
      <AnimatePresence>
        {
          open && (
            <motion.div
              key="quoteCard"
              className="quote-card"
              style={{ originX: 0, originY: 0 }}
              initial={{ opacity: 0, scaleX: .08, scaleY: .3, translateY: -14, borderRadius: 40 }}
              animate={{ opacity: 1, scaleX: 1, scaleY: 1, translateY: 0, borderRadius: 14 }}
              /* Unfolded via a loose starchy spring — folding away used to
                 just be a flat linear shrink. A small swell before it
                 collapses back toward the tab it grew from, on the same
                 spring, echoes the unfold instead of just reversing it
                 mechanically. */
              exit={{
                opacity: 0,
                scaleX: [1, 1.08, .16],
                scaleY: [1, .94, .22],
                translateY: -12,
                borderRadius: 40,
                transition: EXIT_SPRING,
              }}
              transition={{
                type: "spring",
                stiffness: 170,
                damping: 13,
                mass: 1,
              }}
            >
              <AnimatePresence mode="wait" initial={ false }>
                <motion.p
                  key={ verse.reference + verse.text }
                  className="quote-line"
                  initial={{ opacity: 0, rotateX: -80, translateY: 10 }}
                  animate={{ opacity: 1, rotateX: 0, translateY: 0 }}
                  exit={{
                    opacity: 0,
                    rotateX: 70,
                    translateY: -10,
                    transition: EXIT_SPRING,
                  }}
                  transition={{ type: "spring", stiffness: 260, damping: 16 }}
                  style={{ transformPerspective: 600 }}
                >
                  “{ verse.text }”
                  <span className="quote-line-reference">{ verse.reference }</span>
                </motion.p>
              </AnimatePresence>
              <motion.button
                type="button"
                aria-label="Deal a new verse"
                className="quote-deal"
                whileHover={{ scale: 1.12, rotate: 12 }}
                whileTap={{ scale: .85 }}
                transition={ springy }
                onClick={ () => deal() }
              >
                <FaShuffle />
              </motion.button>
            </motion.div>
          )
        }
      </AnimatePresence>
    </div>
  );
}

export default QuoteCard;
