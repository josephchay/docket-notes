import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { interpret } from "xstate";
import { FaFeather, FaShuffle } from "react-icons/fa6";

import { toggleMachine } from "../Navigation/NavigationState";
import { randomQuote } from "../../utils/data";
import quotes from "../../assets/data/quotes.json";

import "./QuoteCard.css";

const springy = {
  type: "spring",
  stiffness: 400,
  damping: 17,
};

// A strip of daily ink for the desk. The same xstate toggle machine that
// drives the nav rail folds it in and out: unfolding morphs a dot of paper
// out of the tab into a full strip with a loose, starchy spring, and dealing
// a new line flips the old one away like a turned page.
const QuoteCard = () => {
  const [open, setOpen] = useState(false);
  const [service] = useState(() => interpret(toggleMachine));
  const [quote, setQuote] = useState(() => randomQuote(quotes));

  useEffect(() => {
    service
      .onTransition((state) => {
        if (state.value === "active") setOpen(true);
        else if (state.value === "inactive") setOpen(false);
      })
      .start();

    return () => service.stop();
  }, [service]);

  // Deal a fresh line, trying a few times not to repeat the last one.
  const deal = () => {
    setQuote((prev) => {
      for (let i = 0; i < 5; i++) {
        const next = randomQuote(quotes);
        if (next !== prev) return next;
      }
      return randomQuote(quotes);
    });
  }

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
              exit={{
                opacity: 0,
                scaleX: .2,
                scaleY: .25,
                translateY: -12,
                borderRadius: 40,
                transition: { duration: .22, ease: "easeIn" },
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
                  key={ quote }
                  className="quote-line"
                  initial={{ opacity: 0, rotateX: -80, translateY: 10 }}
                  animate={{ opacity: 1, rotateX: 0, translateY: 0 }}
                  exit={{
                    opacity: 0,
                    rotateX: 70,
                    translateY: -10,
                    transition: { duration: .18, ease: "easeIn" },
                  }}
                  transition={{ type: "spring", stiffness: 260, damping: 16 }}
                  style={{ transformPerspective: 600 }}
                >
                  “{ quote }”
                </motion.p>
              </AnimatePresence>
              <motion.button
                type="button"
                aria-label="Deal a new line"
                className="quote-deal"
                whileHover={{ scale: 1.12, rotate: 12 }}
                whileTap={{ scale: .85 }}
                transition={ springy }
                onClick={ deal }
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
