import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useVelocity,
} from "framer-motion";
import { interpret } from "xstate";
import anime from "animejs";
import gsap from "gsap";
import { FaArrowLeft, FaArrowRight } from "react-icons/fa6";

import { tourMachine } from "./TourState";
import { hasSeenTour, markTourSeen } from "../../utils/storage";

import "./TourGuide.css";

// The walk's script: what each stop points at, what the card says there,
// and which of the desk's own inks tints that stop's halo and details.
const SCRIPT = {
  greeting: {
    title: "Welcome to the desk",
    body: "This desk has a few tricks folded into it. Give it a minute and it'll walk you past the three worth knowing.",
    accent: "var(--yellow-color)",
    width: 340,
  },
  activator: {
    selector: "#navActivator",
    title: "Pour a note",
    body: "Tap any ink pot here — or just press N — to drop a fresh note onto the desk.",
    accent: "var(--orange-color)",
    width: 312,
  },
  search: {
    selector: ".header .search",
    title: "Find anything",
    body: "Search titles and text as you type, or press / to jump straight here.",
    accent: "var(--blue-color)",
    width: 312,
  },
  theme: {
    selector: ".header .theme",
    title: "Flip the page",
    body: "Switch between fresh paper and the Ink theme whenever the light changes.",
    accent: "var(--purple-color)",
    width: 312,
  },
  farewell: {
    title: "The desk is yours",
    body: "Pour freely — the ink remembers this session.",
    accent: "var(--pink-color)",
    width: 300,
  },
};

const WALK = ["activator", "search", "theme"];

const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Split a title into per-character spans for anime's stagger to lift — the
// same letter-by-letter elastic rise the nav wordmark plays on arrival.
const Chars = ({ text }) => (
  <>
    {
      text.split("").map((ch, index) => (
        ch === " " ? " " : <span key={ index } className="tour-char">{ ch }</span>
      ))
    }
  </>
);

// One stop's worth of card. Its own component so AnimatePresence mounts a
// fresh instance per stop and the character stagger runs exactly when the
// new content lands, not while the old is still leaving.
const CardContent = ({ step, config, walkIndex, reduced, send }) => {
  const rootRef = useRef(null);

  useEffect(() => {
    if (reduced) return;

    const chars = rootRef.current?.querySelectorAll(".tour-char");
    if (!chars || chars.length === 0) return;

    const targets = Array.from(chars);
    anime({
      targets,
      translateY: [22, 0],
      rotate: ["-8deg", "0deg"],
      opacity: [0, 1],
      duration: 950,
      delay: anime.stagger(26, { start: 110 }),
      easing: "easeOutElastic(1, .5)",
    });

    return () => anime.remove(targets);
  }, [reduced]);

  const isGreeting = step === "greeting";
  const isFarewell = step === "farewell";

  return (
    <div ref={ rootRef } className={ `tour-card-inner ${ isFarewell ? "centered" : "" }` }>
      <div className="tour-card-topline">
        <span className="tour-card-eyebrow">
          {
            isGreeting ? "first visit"
              : isFarewell ? "until next time"
              : `stop ${ walkIndex + 1 } of ${ WALK.length }`
          }
        </span>
        {
          walkIndex >= 0 && (
            <span className="tour-dots">
              {
                WALK.map((name, index) => (
                  <i
                    key={ name }
                    className={ `tour-dot ${ index < walkIndex ? "past" : "" } ${ index === walkIndex ? "live" : "" }` }
                  />
                ))
              }
            </span>
          )
        }
      </div>
      <h4 className="tour-card-title">
        { reduced ? config.title : <Chars text={ config.title } /> }
      </h4>
      <motion.p
        className="tour-card-body"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: .16, type: "spring", stiffness: 300, damping: 15 }}
      >
        { config.body }
      </motion.p>
      {
        isFarewell ? (
          <motion.span
            className="tour-farewell-star"
            initial={{ opacity: 0, scale: 0, rotate: -120 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ delay: .3, type: "spring", stiffness: 260, damping: 10 }}
          >
            ✦
          </motion.span>
        ) : (
          <motion.div
            className="tour-card-actions"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: .24, type: "spring", stiffness: 300, damping: 14 }}
          >
            <button
              type="button"
              className="tour-skip"
              onClick={ () => send("SKIP") }
            >
              { isGreeting ? "I'll wander" : "Skip" }
            </button>
            <div className="tour-actions-right">
              {
                walkIndex > 0 && (
                  <motion.button
                    type="button"
                    className="tour-back"
                    aria-label="Back a stop"
                    initial={{ scale: 0, rotate: -90 }}
                    animate={{ scale: 1, rotate: 0 }}
                    whileHover={{ scale: 1.12 }}
                    whileTap={{ scale: .86 }}
                    transition={{ type: "spring", stiffness: 420, damping: 13 }}
                    onClick={ () => send("BACK") }
                  >
                    <FaArrowLeft />
                  </motion.button>
                )
              }
              <motion.button
                type="button"
                className="tour-next"
                whileHover={{ scale: 1.08, rotate: -1.5 }}
                whileTap={{ scale: .9 }}
                transition={{ type: "spring", stiffness: 420, damping: 12 }}
                onClick={ () => send("NEXT") }
              >
                { isGreeting ? "Show me around" : step === "theme" ? "Got it" : "Next" }
                <FaArrowRight className="tour-next-icon" />
              </motion.button>
            </div>
          </motion.div>
        )
      }
    </div>
  );
};

// The first-run walk of the desk, without its old spotlight — nothing is
// dimmed, nothing is blocked, and nothing is painted over the target.
// The control under discussion answers for itself: it gets the .tour-poke
// class and does a looping jelly wobble in place, while the one paper
// card blooms up out of a drop the same dot-to-sheet way the command
// palette and every other panel does, then rides loose springs from stop
// to stop — wobbling upright and jelly-squashing on landing exactly the
// way a freshly poured note does. At each stop the desk itself leans in
// too: gsap pushes the whole .home page in toward the spotlit control
// with a bouncy overshoot, and eases it back out for the bookend scenes.
// The walk itself is still one xstate machine (TourState.js); this
// component just measures the desk and points.
const TourGuide = () => {
  const [service] = useState(() => interpret(tourMachine));
  const [step, setStep] = useState("closed");
  const [reduced] = useState(prefersReducedMotion);

  // The card hangs from deliberately under-damped springs, so every hop
  // between stops overshoots and settles with a visible bounce. Tilt is
  // read off the x spring's velocity — a long hop banks harder than a
  // nudge — and each arrival adds a wiggle on top through wiggleMv, plus
  // the same landing jelly a poured note plays, through jellyX/jellyY.
  const springX = useSpring(0, { stiffness: 170, damping: 13, mass: .9 });
  const springY = useSpring(0, { stiffness: 170, damping: 14, mass: .9 });
  const velocityX = useVelocity(springX);
  const tiltRaw = useTransform(velocityX, [-1500, 1500], [-5.5, 5.5]);
  const tilt = useSpring(tiltRaw, { stiffness: 260, damping: 18 });
  const wiggleMv = useMotionValue(0);
  const rotate = useTransform([tilt, wiggleMv], ([t, w]) => t + w);
  const jellyX = useMotionValue(1);
  const jellyY = useMotionValue(1);

  const primedRef = useRef(false);
  const cameraRef = useRef(null);
  const pokeRef = useRef(null);

  const send = useCallback((event) => service.send(event), [service]);

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

  const open = step !== "closed" && step !== "done";

  // While the walk is on, the camera owns .home — the body class suppresses
  // .home's own transform transition so gsap's zoom isn't smeared by it.
  useEffect(() => {
    document.body.classList.toggle("tour-active", open);
    return () => document.body.classList.remove("tour-active");
  }, [open]);

  // Ease the camera home and hand the page's transform back to the
  // stylesheet. Runs whenever the walk ends, and again on unmount in case
  // the app is torn down mid-zoom.
  const releaseCamera = useCallback((instant) => {
    const home = document.querySelector(".home");
    if (!home) return;

    cameraRef.current?.kill();
    cameraRef.current = null;

    if (instant) {
      gsap.set(home, { clearProps: "transform,transformOrigin" });
      return;
    }

    cameraRef.current = gsap.to(home, {
      x: 0,
      y: 0,
      scale: 1,
      duration: .8,
      ease: "back.out(1.2)",
      onComplete: () => gsap.set(home, { clearProps: "transform,transformOrigin" }),
    });
  }, []);

  useEffect(() => {
    if (!open) releaseCamera(false);
  }, [open, releaseCamera]);

  useEffect(() => () => releaseCamera(true), [releaseCamera]);

  // Measure the current stop and seat everything: the card under the
  // target, the camera leaning in over it. Re-measured on resize/scroll —
  // and on every frame of the zoom, so the card tracks the page while it
  // grows under it.
  useEffect(() => {
    const config = SCRIPT[step];
    if (!config) return;

    const seat = (travel) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let focus = null;
      if (config.selector) {
        const el = document.querySelector(config.selector);
        if (!el) {
          if (travel) service.send("NEXT");
          return;
        }
        const rect = el.getBoundingClientRect();
        focus = {
          cx: rect.left + rect.width / 2,
          cy: rect.top + rect.height / 2,
          width: rect.width,
          height: rect.height,
          bottom: rect.bottom,
        };
      }

      const width = config.width;
      let left;
      let top;

      if (focus) {
        left = clamp(focus.cx - width / 2, 16, vw - width - 16);
        top = Math.min(focus.bottom + 26, vh - 220);
      } else {
        // Greeting and farewell hold centre stage.
        left = vw / 2 - width / 2;
        top = vh * .36;
      }

      if (!primedRef.current || reduced) {
        primedRef.current = true;
        springX.jump(left);
        springY.jump(top);
      } else {
        springX.set(left);
        springY.set(top);
      }
    };

    // The camera: push the page in toward this stop's control with a
    // bouncy overshoot. Working with transform-origin pinned at 0,0 keeps
    // the arithmetic honest across stops — the current translate/scale can
    // always be read back and re-aimed without a visible jump.
    const aimCamera = () => {
      const home = document.querySelector(".home");
      const el = config.selector && document.querySelector(config.selector);
      if (!home) return;

      cameraRef.current?.kill();

      if (!el) {
        // Bookend scenes watch from the armchair.
        cameraRef.current = gsap.to(home, {
          x: 0,
          y: 0,
          scale: 1,
          duration: .9,
          ease: "back.out(1.2)",
        });
        return;
      }

      gsap.set(home, { transformOrigin: "0 0" });

      const rect = el.getBoundingClientRect();
      const scale = clamp(1.6 - rect.width / 700, 1.25, 1.5);
      const curScale = Number(gsap.getProperty(home, "scaleX")) || 1;
      const curX = Number(gsap.getProperty(home, "x")) || 0;
      const curY = Number(gsap.getProperty(home, "y")) || 0;

      // The control's current screen position, its position in the page's
      // own untransformed coordinates, and where on screen it should end
      // up — nudged a third of the way toward centre stage.
      const fx = rect.left + rect.width / 2;
      const fy = rect.top + rect.height / 2;
      const lx = (fx - curX) / curScale;
      const ly = (fy - curY) / curScale;
      const dx = fx + (window.innerWidth / 2 - fx) * .3;
      const dy = fy + (window.innerHeight / 2 - fy) * .3;

      cameraRef.current = gsap.to(home, {
        x: dx - scale * lx,
        y: dy - scale * ly,
        scale,
        duration: 1.15,
        ease: "back.out(1.4)",
        onUpdate: () => seat(false),
        onComplete: () => seat(false),
      });
    };

    seat(true);

    // The item under discussion does its own talking: the .tour-poke class
    // loops a jelly wobble on the real control. It animates the standalone
    // scale/rotate properties rather than transform, so the browser
    // composes it with whatever transforms the control already wears, and
    // taking the class off leaves no trace behind.
    if (config.selector) {
      const target = document.querySelector(config.selector);
      if (target) {
        target.classList.add("tour-poke");
        pokeRef.current = target;
      }
    }

    if (!reduced) {
      aimCamera();

      // Arrival theatrics: an upright wiggle plus the exact squash-and-
      // stretch a fresh note plays as its paper weight settles.
      animate(wiggleMv, [0, -3.2, 2.4, -1.4, 0], {
        duration: .8,
        delay: .15,
        times: [0, .25, .5, .75, 1],
        ease: "easeOut",
      });
      animate(jellyX, [1, 1.06, .97, 1.015, 1], {
        duration: .6,
        delay: .2,
        times: [0, .3, .55, .8, 1],
        ease: "easeInOut",
      });
      animate(jellyY, [1, .94, 1.05, .99, 1], {
        duration: .6,
        delay: .2,
        times: [0, .3, .55, .8, 1],
        ease: "easeInOut",
      });
    }

    const replace = () => seat(false);
    const scroller = document.querySelector(".home");
    window.addEventListener("resize", replace);
    scroller?.addEventListener("scroll", replace, { passive: true });
    return () => {
      pokeRef.current?.classList.remove("tour-poke");
      pokeRef.current = null;
      window.removeEventListener("resize", replace);
      scroller?.removeEventListener("scroll", replace);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // The walk answers the keyboard too: arrows pace it, Escape leaves.
  useEffect(() => {
    if (!open) return;

    const handleKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest("input, textarea")) return;

      if (e.key === "Escape") {
        e.preventDefault();
        send("SKIP");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        send("NEXT");
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        send("BACK");
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, send]);

  const config = SCRIPT[step];
  const walkIndex = WALK.indexOf(step);

  return (
    <AnimatePresence>
      {
        open && (
          <motion.div
            className="tour-layer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: .25, ease: "easeIn" } }}
          >
            {
              config && (
                <motion.div
                  className="tour-card-shell"
                  style={{
                    x: springX,
                    y: springY,
                    rotate,
                    scaleX: jellyX,
                    scaleY: jellyY,
                    originY: 0,
                  }}
                >
                  <motion.div
                    className="tour-card"
                    role="dialog"
                    aria-live="polite"
                    aria-label={ config.title }
                    style={{ originY: 0, "--tour-accent": config.accent }}
                    initial={{ opacity: 0, scale: .2, borderRadius: 44 }}
                    animate={{ opacity: 1, scale: 1, borderRadius: 16, width: config.width }}
                    exit={{ opacity: 0, scale: .3, borderRadius: 44, transition: { duration: .16, ease: "easeIn" } }}
                    transition={{
                      type: "spring",
                      stiffness: 230,
                      damping: 12,
                      width: { type: "spring", stiffness: 170, damping: 14 },
                    }}
                  >
                    <AnimatePresence mode="wait" initial={ false }>
                      <motion.div
                        key={ step }
                        initial={{ opacity: 0, y: 16, scale: .88 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: .96, transition: { duration: .13, ease: "easeIn" } }}
                        transition={{ type: "spring", stiffness: 480, damping: 14 }}
                      >
                        <CardContent
                          step={ step }
                          config={ config }
                          walkIndex={ walkIndex }
                          reduced={ reduced }
                          send={ send }
                        />
                      </motion.div>
                    </AnimatePresence>
                  </motion.div>
                </motion.div>
              )
            }
          </motion.div>
        )
      }
    </AnimatePresence>
  );
};

export default TourGuide;
