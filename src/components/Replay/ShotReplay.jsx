import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { interpret } from "xstate";
import gsap from "gsap";

import { replayMachine } from "./ReplayState";

import "./ShotReplay.css";

// Fired (by the command palette, or anyone) to start the show.
export const REPLAY_EVENT = "docket:replay-shot";

// Fired once the show has genuinely run its course — reaching "bow" on its
// own timers, not cut short by Escape — so anything wanting to chain off
// the end of the origin story (see TOUR_EVENT in TourGuide.jsx, which
// follows this with a fresh walk of the desk) has something to listen for.
export const REPLAY_DONE_EVENT = "docket:replay-shot-done";

// What the newborn note says in the original film.
const NOTE_LINE = "This is a Docket note.";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// React owns the textarea, so its value can't just be assigned — write it
// through the native setter and let a bubbled input event carry it into the
// note's own onChange, exactly as if fingers were on the keys.
const typeIntoTextarea = (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  if (!setter) return;

  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

// A live recreation of the Dribbble shot the whole desk descends from
// (src/assets/miscellaneous/dribbble-14037848-…mp4) — not footage, a
// performance. An xstate shot list (ReplayState.js) walks the scenes; gsap
// plays the camera, dollying the real .home container in on the rail and
// back out; and a little ghost of ink — three drops melting through the
// same gooey filter as the pots — walks the pointer's part, really
// clicking the real + activator and the real orange pot, so the rail's own
// pour timeline and the note's own pot-to-paper morph perform themselves.
// Nothing here is mocked: when the scene ends, the note it poured is a
// real note on the real desk, reading the same line as the film's.
const ShotReplay = () => {
  const [service] = useState(() => interpret(replayMachine));
  const [phase, setPhase] = useState("idle");
  const [ripples, setRipples] = useState([]);

  // The ghost's three drops, lead to tail — chased with staggered tweens so
  // the trio stretches into a comet on every glide and melts back into one
  // blob on arrival.
  const dotRefs = useRef([]);
  const runTokenRef = useRef(0);
  const timeoutsRef = useRef([]);
  const typerRef = useRef(null);

  // Tracks whether this run actually got going (set in "curtain") and
  // whether it was cut short by Escape (set in the keydown handler below)
  // — together, what tells the "idle" case whether to fire
  // REPLAY_DONE_EVENT. A show that never really started (mount's own
  // initial "idle") or one the visitor deliberately walked out of
  // shouldn't drag the tutorial along behind it.
  const hasPlayedRef = useRef(false);
  const stoppedManuallyRef = useRef(false);

  useEffect(() => {
    service
      .onTransition((state) => setPhase(String(state.value)))
      .start();

    return () => service.stop();
  }, [service]);

  // The palette (or anything else) raises the curtain with one event.
  useEffect(() => {
    const play = () => service.send("PLAY");

    window.addEventListener(REPLAY_EVENT, play);
    return () => window.removeEventListener(REPLAY_EVENT, play);
  }, [service]);

  // Escape drops the production from any scene.
  useEffect(() => {
    if (phase === "idle") return;

    const handleKey = (e) => {
      if (e.key === "Escape") {
        stoppedManuallyRef.current = true;
        service.send("STOP");
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [phase, service]);

  const later = (ms, fn) => {
    const token = runTokenRef.current;
    const id = setTimeout(() => {
      if (runTokenRef.current === token) fn();
    }, ms);
    timeoutsRef.current.push(id);
  };

  const dots = () => dotRefs.current.filter(Boolean);

  // Send the ghost somewhere. The three drops share the target but not the
  // clock, which is where the stretch comes from.
  const glide = (x, y, duration = .55, ease = "power3.out") => {
    dots().forEach((el, index) => {
      gsap.to(el, {
        x,
        y,
        duration: duration + index * .13,
        ease,
        overwrite: "auto",
      });
    });
  };

  const jumpTo = (x, y) => {
    dots().forEach((el) => gsap.set(el, { x, y }));
  };

  // A press: the whole ghost squashes and recovers while a ripple ring
  // blooms off the point of contact.
  const press = (x, y) => {
    dots().forEach((el) => {
      gsap.timeline()
        .to(el, { scale: .62, duration: .12, ease: "power2.in" })
        .to(el, { scale: 1, duration: .55, ease: "elastic.out(1, .45)" });
    });

    const id = `${Date.now()}-${Math.random()}`;
    setRipples((prev) => [...prev, { id, x, y }]);
    later(700, () => setRipples((prev) => prev.filter((r) => r.id !== id)));
  };

  const centerOf = (el) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };

  const homeEl = () => document.querySelector(".home");

  const releaseCamera = (settle) => {
    const home = homeEl();
    if (!home) return;

    gsap.killTweensOf(home);
    if (settle) {
      gsap.to(home, {
        scale: 1,
        x: 0,
        y: 0,
        duration: .45,
        ease: "power2.out",
        onComplete: () => gsap.set(home, { clearProps: "transform,transformOrigin" }),
      });
    } else {
      gsap.set(home, { clearProps: "transform,transformOrigin" });
    }
  };

  const cleanup = (settleCamera) => {
    runTokenRef.current += 1;
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    clearInterval(typerRef.current);
    releaseCamera(settleCamera);
    document.body.classList.remove("replay-active");
    setRipples([]);
  };

  // Each scene's stage directions. The machine keeps time; this just acts.
  useEffect(() => {
    const reduced = prefersReducedMotion();

    switch (phase) {
      case "curtain": {
        runTokenRef.current += 1;
        hasPlayedRef.current = true;
        document.body.classList.add("replay-active");
        homeEl()?.scrollTo({ top: 0, behavior: "smooth" });

        // The ghost wakes mid-desk and gathers itself.
        jumpTo(window.innerWidth * .58, window.innerHeight * .55);
        dots().forEach((el) => gsap.fromTo(el, { opacity: 0, scale: .4 }, {
          opacity: 1,
          scale: 1,
          duration: .5,
          ease: "back.out(2)",
        }));
        break;
      }

      case "dollyIn": {
        const activator = document.getElementById("navActivator");
        const home = homeEl();
        if (!activator || !home) {
          service.send("STOP");
          break;
        }

        if (!reduced) {
          // Frame the shot like the film: the + in the upper left, the pour
          // lane below it, the first column of paper on the right. C is the
          // point of interest; the translate carries C to screen centre
          // while the scale pushes in around it.
          const a = centerOf(activator);
          const homeRect = home.getBoundingClientRect();
          const scale = Math.min(
            Math.max(Math.min(window.innerHeight / 640, window.innerWidth / 900), 1.4),
            2
          );
          const cx = a.x + 320;
          const cy = a.y + 200;

          gsap.to(home, {
            scale,
            x: window.innerWidth / 2 - cx,
            y: window.innerHeight / 2 - cy,
            transformOrigin: `${cx - homeRect.left}px ${cy - homeRect.top}px`,
            duration: 1.55,
            ease: "power3.inOut",
          });
        }

        // The ghost drifts rail-ward while the camera moves.
        glide(window.innerWidth * .34, window.innerHeight * .42, 1.3, "power2.inOut");
        break;
      }

      case "reachActivator": {
        const activator = document.getElementById("navActivator");
        if (!activator) {
          service.send("STOP");
          break;
        }

        const { x, y } = centerOf(activator);
        glide(x, y, .58, "back.out(1.3)");
        break;
      }

      case "pressActivator": {
        const activator = document.getElementById("navActivator");
        if (!activator) {
          service.send("STOP");
          break;
        }

        const { x, y } = centerOf(activator);
        press(x, y);
        later(200, () => activator.click());
        break;
      }

      case "pouring": {
        // Trail the falling pots a little way down the rail.
        const activator = document.getElementById("navActivator");
        if (activator) {
          const { x, y } = centerOf(activator);
          glide(x + 6, y + 130, 2.4, "power1.inOut");
        }
        break;
      }

      case "reachPot": {
        const pot = document.querySelector(".color-selectors .orange-bg");
        if (!pot) {
          service.send("STOP");
          break;
        }

        const { x, y } = centerOf(pot);
        glide(x, y, .6, "back.out(1.3)");
        break;
      }

      case "pressPot": {
        const pot = document.querySelector(".color-selectors .orange-bg");
        if (!pot) {
          service.send("STOP");
          break;
        }

        const { x, y } = centerOf(pot);
        press(x, y);
        later(200, () => pot.click());
        break;
      }

      case "birth": {
        // Step aside and let the paper have the frame.
        const pot = document.querySelector(".color-selectors .orange-bg");
        if (pot) {
          const { x, y } = centerOf(pot);
          glide(x + 60, y - 40, .8, "power2.inOut");
        }
        break;
      }

      case "dollyOut": {
        if (!prefersReducedMotion()) {
          const home = homeEl();
          if (home) {
            gsap.to(home, {
              scale: 1,
              x: 0,
              y: 0,
              duration: 1.65,
              ease: "power3.inOut",
            });
          }
        }

        // The ghost's part is done — it thins out mid-glide.
        dots().forEach((el) => gsap.to(el, {
          opacity: 0,
          scale: .3,
          duration: .8,
          delay: .5,
          ease: "power2.in",
        }));
        break;
      }

      case "inscribe": {
        // The newest note leads the grid; write the film's line onto it,
        // one keystroke at a time, through its real controlled input.
        const textarea = document.querySelector("[data-note-id] textarea");
        if (!textarea) break;

        textarea.focus();
        let upTo = 0;
        typerRef.current = setInterval(() => {
          upTo += 1;
          typeIntoTextarea(textarea, NOTE_LINE.slice(0, upTo));
          if (upTo >= NOTE_LINE.length) {
            clearInterval(typerRef.current);
            textarea.blur();
          }
        }, 48);
        break;
      }

      case "bow": {
        document.body.classList.remove("replay-active");
        releaseCamera(false);
        break;
      }

      case "idle": {
        // Whether the film ran out or Escape cut it, hand the desk back.
        cleanup(true);

        // Only a genuine, uninterrupted run hands off to the tutorial —
        // not the component's own initial "idle" on mount, and not a run
        // the visitor deliberately walked out of with Escape.
        if (hasPlayedRef.current && !stoppedManuallyRef.current) {
          window.dispatchEvent(new CustomEvent(REPLAY_DONE_EVENT));
        }
        hasPlayedRef.current = false;
        stoppedManuallyRef.current = false;
        break;
      }

      default:
        break;
    }
    // The scenes read the live DOM on entry; phase is the only real input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => () => cleanup(false), []);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AnimatePresence>
      {
        phase !== "idle" && (
          <motion.div
            className="replay-layer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: .3, ease: "easeIn" } }}
          >
            <div className="replay-goo" aria-hidden="true">
              <span ref={ (el) => { dotRefs.current[0] = el; } } className="replay-dot lead" />
              <span ref={ (el) => { dotRefs.current[1] = el; } } className="replay-dot mid" />
              <span ref={ (el) => { dotRefs.current[2] = el; } } className="replay-dot tail" />
            </div>
            {
              ripples.map((ripple) => (
                <motion.span
                  key={ ripple.id }
                  className="replay-ripple"
                  style={{ left: ripple.x, top: ripple.y }}
                  initial={{ scale: .2, opacity: .55 }}
                  animate={{ scale: 2.4, opacity: 0 }}
                  transition={{ duration: .65, ease: "easeOut" }}
                />
              ))
            }
          </motion.div>
        )
      }
    </AnimatePresence>
  );
};

export default ShotReplay;
