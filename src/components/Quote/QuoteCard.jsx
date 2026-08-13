import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { interpret } from "xstate";
import gsap from "gsap";
import { FaFeather, FaShuffle } from "react-icons/fa6";

import { toggleMachine } from "../Navigation/NavigationState";
import { randomQuote } from "../../utils/data";
import quotes from "../../assets/data/quotes.json";
import { SNAPPY, EXIT_SPRING } from "../Motion";

import "./QuoteCard.css";

const springy = SNAPPY;

// How far a swipe on the card has to travel (plus its own release
// momentum, the same offset+velocity blend CommandPalette's own row swipe
// already uses) before it counts as a real deal rather than a stray drag.
const SWIPE_THRESHOLD = 70;
const SWIPE_RANGE = 100;
const SWIPE_FLING_WEIGHT = .12;

// The reel's own deceleration (see deal() below) — a handful of quick
// intermediate flashes before the real quote lands, each one taking
// REEL_DECAY times longer than the last, the same shape a real spinning
// wheel slows down under friction rather than an arbitrary stagger.
const REEL_STEPS = 4;
const REEL_BASE_INTERVAL = 70; // ms
const REEL_DECAY = 1.55;

// Slides in from the direction the swipe (or a fixed default, for a plain
// button click) implies the NEXT quote is coming from, and the outgoing
// one flies off further in the direction it was actually swiped — the
// same physical read as pulling one card away to reveal the next one
// underneath, rather than a flat cross-fade.
const quoteLineVariants = {
  enter: (direction) => ({ opacity: 0, x: direction * -30, scale: .94 }),
  center: { opacity: 1, x: 0, scale: 1 },
  exit: (direction) => ({ opacity: 0, x: direction * 140, scale: .9, transition: { duration: .28, ease: "easeIn" } }),
};

const reducedLineVariants = {
  enter: { opacity: 0 },
  center: { opacity: 1 },
  exit: { opacity: 0, transition: { duration: .15 } },
};

// A strip of daily ink for the desk. The same xstate toggle machine that
// drives the nav rail folds it in and out: unfolding morphs a dot of paper
// out of the tab into a full strip with a loose, starchy spring, and
// dealing a new line flips the old one away like a turned page. Dealing
// itself is now a real gesture, not just a button: drag the card
// horizontally (the same elastic swipe-with-fling-velocity recipe
// CommandPalette's own rows use) to deal in whichever direction you
// swiped, or tap the shuffle button for a fixed default. Either way, the
// new line doesn't just appear — it spins through REEL_STEPS quick
// candidates on a real decelerating clock before settling, and the settled
// line itself reveals word by word, each one unblurring in from the last,
// like ink actually soaking into the paper rather than a flat fade.
const QuoteCard = ({ reduceMotion = false }) => {
  const [open, setOpen] = useState(false);
  const [service] = useState(() => interpret(toggleMachine));
  const [quote, setQuote] = useState(() => randomQuote(quotes));
  const [dealDirection, setDealDirection] = useState(-1);
  const [settled, setSettled] = useState(true);

  const reelTimeoutsRef = useRef([]);
  const dealIconRef = useRef(null);

  useEffect(() => {
    service
      .onTransition((state) => {
        if (state.value === "active") setOpen(true);
        else if (state.value === "inactive") setOpen(false);
      })
      .start();

    return () => service.stop();
  }, [service]);

  useEffect(() => () => reelTimeoutsRef.current.forEach(clearTimeout), []);

  const pickNext = (prev) => {
    for (let i = 0; i < 5; i++) {
      const next = randomQuote(quotes);
      if (next !== prev) return next;
    }
    return randomQuote(quotes);
  };

  // Deal a fresh line — direction is which way it should read as having
  // been swiped (see quoteLineVariants above), defaulting to a fixed turn
  // for the plain button/keyboard path, which has no gesture of its own to
  // read a direction from.
  const deal = (direction = -1) => {
    setDealDirection(direction);

    if (reduceMotion) {
      setQuote(pickNext);
      return;
    }

    setSettled(false);
    reelTimeoutsRef.current.forEach(clearTimeout);
    reelTimeoutsRef.current = [];

    let delay = 0;
    for (let i = 0; i < REEL_STEPS; i++) {
      delay += REEL_BASE_INTERVAL * (REEL_DECAY ** i);
      const isFinal = i === REEL_STEPS - 1;
      const timeoutId = setTimeout(() => {
        setQuote((prev) => (isFinal ? pickNext(prev) : randomQuote(quotes)));
        if (isFinal) setSettled(true);
      }, delay);
      reelTimeoutsRef.current.push(timeoutId);
    }

    // The shuffle icon spins down in step with the exact same decaying
    // intervals driving the reel above — each leg of the spin taking
    // longer than the last, then a small elastic overshoot once it's
    // actually caught up with the settled line, the same "brief overshoot
    // past rest" every other spring in this app already reads as jelly
    // rather than a flat stop.
    if (dealIconRef.current) {
      gsap.killTweensOf(dealIconRef.current);
      const timeline = gsap.timeline();
      let elapsed = 0;
      for (let i = 0; i < REEL_STEPS; i++) {
        const stepDuration = (REEL_BASE_INTERVAL * (REEL_DECAY ** i)) / 1000;
        timeline.to(dealIconRef.current, { rotate: "+=160", duration: stepDuration, ease: "none" }, elapsed);
        elapsed += stepDuration;
      }
      timeline.to(dealIconRef.current, { rotate: "+=30", duration: .35, ease: "elastic.out(1, .5)" });
    }
  };

  const handleSwipeEnd = (e, info) => {
    const effective = info.offset.x + info.velocity.x * SWIPE_FLING_WEIGHT;
    if (Math.abs(effective) > SWIPE_THRESHOLD) deal(effective > 0 ? 1 : -1);
  };

  const words = quote.split(" ");
  const showWordReveal = settled && !reduceMotion;

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
              {/* The card's own fold transform lives on the wrapper above;
                  this inner layer is what actually carries the swipe drag,
                  the same split CommandPalette's own row-slot/row pairing
                  uses so the two transform channels never fight over the
                  same element. dragSnapToOrigin always returns it to x: 0
                  on release regardless of whether the swipe committed — a
                  deal is a state change (the quote itself), not a resting
                  drag position. */}
              <motion.div
                className="quote-card-drag"
                drag={ reduceMotion ? false : "x" }
                dragConstraints={{ left: -SWIPE_RANGE, right: SWIPE_RANGE }}
                dragElastic={ .6 }
                dragSnapToOrigin
                onDragEnd={ handleSwipeEnd }
              >
                <AnimatePresence mode="wait" initial={ false } custom={ dealDirection }>
                  <motion.p
                    key={ quote }
                    custom={ dealDirection }
                    className="quote-line"
                    variants={ reduceMotion ? reducedLineVariants : quoteLineVariants }
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={ reduceMotion ? { duration: .2 } : { type: "spring", stiffness: 260, damping: 20 } }
                  >
                    “
                    {
                      showWordReveal
                        ? words.map((word, index) => (
                          <motion.span
                            key={ index }
                            className="quote-word"
                            initial={{ opacity: 0, filter: "blur(6px)", translateY: 4 }}
                            animate={{ opacity: 1, filter: "blur(0px)", translateY: 0 }}
                            transition={{ duration: .4, delay: index * .035, ease: "easeOut" }}
                          >
                            { word }{ " " }
                          </motion.span>
                        ))
                        : quote
                    }
                    ”
                  </motion.p>
                </AnimatePresence>
                <motion.button
                  type="button"
                  aria-label="Deal a new line"
                  className="quote-deal"
                  whileHover={{ scale: 1.12 }}
                  whileTap={{ scale: .85 }}
                  transition={ springy }
                  onClick={ () => deal(-1) }
                >
                  <span ref={ dealIconRef } style={{ display: "flex" }}>
                    <FaShuffle />
                  </span>
                </motion.button>
              </motion.div>
            </motion.div>
          )
        }
      </AnimatePresence>
    </div>
  );
}

export default QuoteCard;
