import React, { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useMotionTemplate,
  useSpring,
} from "framer-motion";
import { interpret } from "xstate";
import { FaArrowRight } from "react-icons/fa6";

import { tourMachine } from "./TourState";
import { hasSeenTour, markTourSeen } from "../../utils/storage";

import "./TourGuide.css";

// One spotlighted control per tour state, in walk order.
const STEPS = {
  activator: {
    selector: "#navActivator",
    title: "Pour a note",
    body: "Tap any ink pot here — or just press N — to drop a fresh note onto the desk.",
  },
  search: {
    selector: ".header .search",
    title: "Find anything",
    body: "Search titles and text as you type, or press / to jump straight here.",
  },
  theme: {
    selector: ".header .theme",
    title: "Flip the page",
    body: "Switch between fresh paper and the Ink theme whenever the light changes.",
  },
};

const BUBBLE_WIDTH = 300;

// A first-run tour of the desk. The whole thing is one xstate machine
// (TourState.js) — each state is a control worth spotlighting, walked
// through with NEXT or abandoned with SKIP, always ending in "done". The
// spotlight is a single dim layer with a soft-edged hole cut by a live CSS
// mask built from three springs (via useMotionTemplate), so between steps
// it doesn't cut from target to target — it physically slides and resizes
// to the next one. Plays once per session, gated in sessionStorage.
const TourGuide = () => {
  const [service] = useState(() => interpret(tourMachine));
  const [step, setStep] = useState("closed");

  // Three springs feeding a live CSS mask (via useMotionTemplate) — the
  // spotlight is one dim layer with a hole cut in it, and moving between
  // steps just means giving these springs a new target. .jump() primes the
  // very first position instantly so it doesn't sweep in from a corner.
  const springX = useSpring(0, { stiffness: 170, damping: 20, mass: .8 });
  const springY = useSpring(0, { stiffness: 170, damping: 20, mass: .8 });
  const springR = useSpring(0, { stiffness: 130, damping: 15, mass: .9 });
  const maskImage = useMotionTemplate`radial-gradient(circle ${ springR }px at ${ springX }px ${ springY }px, transparent 0, transparent calc(${ springR }px - 4px), black calc(${ springR }px + 22px))`;

  const [bubble, setBubble] = useState({ left: 0, top: 0 });
  const primedRef = useRef(false);

  useEffect(() => {
    service
      .onTransition((state) => setStep(String(state.value)))
      .start();

    return () => service.stop();
  }, [service]);

  // Wait for the desk's own entrance springs to settle before butting in.
  useEffect(() => {
    if (hasSeenTour()) return;

    const timer = setTimeout(() => service.send("START"), 1600);
    return () => clearTimeout(timer);
  }, [service]);

  useEffect(() => {
    if (step === "done") markTourSeen();
  }, [step]);

  // Point the spotlight and the callout at the current step's target,
  // re-measuring on resize/scroll so it never drifts off its mark.
  useEffect(() => {
    const config = STEPS[step];
    if (!config) return;

    const place = () => {
      const el = document.querySelector(config.selector);
      if (!el) {
        service.send("NEXT");
        return;
      }

      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const radius = Math.max(rect.width, rect.height) / 2 + 10;

      if (!primedRef.current) {
        primedRef.current = true;
        springX.jump(cx);
        springY.jump(cy);
        springR.jump(0);
      }

      springX.set(cx);
      springY.set(cy);
      springR.set(radius);

      setBubble({
        left: Math.min(Math.max(cx - BUBBLE_WIDTH / 2, 16), window.innerWidth - BUBBLE_WIDTH - 16),
        top: Math.min(rect.bottom + 22, window.innerHeight - 180),
      });
    };

    place();

    const scroller = document.querySelector(".home");
    window.addEventListener("resize", place);
    scroller?.addEventListener("scroll", place, { passive: true });
    return () => {
      window.removeEventListener("resize", place);
      scroller?.removeEventListener("scroll", place);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const open = step !== "closed" && step !== "done";
  const config = STEPS[step];

  return (
    <AnimatePresence>
      {
        open && (
          <div className="tour-layer">
            <motion.div
              className="tour-dim"
              style={{ WebkitMaskImage: maskImage, maskImage }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: .25, ease: "easeIn" } }}
              onClick={ () => service.send("SKIP") }
            />
            <AnimatePresence mode="wait">
              {
                config && (
                  <motion.div
                    key={ step }
                    className="tour-bubble"
                    style={{ left: bubble.left, top: bubble.top, width: BUBBLE_WIDTH }}
                    initial={{ opacity: 0, scale: .2, borderRadius: 44 }}
                    animate={{ opacity: 1, scale: 1, borderRadius: 16 }}
                    exit={{ opacity: 0, scale: .3, borderRadius: 44, transition: { duration: .16, ease: "easeIn" } }}
                    transition={{ type: "spring", stiffness: 220, damping: 15 }}
                  >
                    <h4>{ config.title }</h4>
                    <p>{ config.body }</p>
                    <div className="tour-bubble-actions">
                      <button
                        type="button"
                        className="tour-skip"
                        onClick={ () => service.send("SKIP") }
                      >
                        Skip
                      </button>
                      <motion.button
                        type="button"
                        className="tour-next"
                        whileHover={{ scale: 1.06 }}
                        whileTap={{ scale: .92 }}
                        transition={{ type: "spring", stiffness: 420, damping: 16 }}
                        onClick={ () => service.send("NEXT") }
                      >
                        { step === "theme" ? "Got it" : "Next" }
                        <FaArrowRight className="tour-next-icon" />
                      </motion.button>
                    </div>
                  </motion.div>
                )
              }
            </AnimatePresence>
          </div>
        )
      }
    </AnimatePresence>
  );
};

export default TourGuide;
