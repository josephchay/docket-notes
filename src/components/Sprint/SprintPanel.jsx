import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { interpret } from "xstate";
import gsap from "gsap";
import { FaPlay, FaPause, FaRotateLeft, FaForward, FaXmark, FaMugHot, FaFeatherPointed } from "react-icons/fa6";

import { sprintMachine, SPRINT_PRESETS } from "./SprintState";
import useInkPulse from "../../hooks/useInkPulse";
import useBlobClipMorph from "../../hooks/useBlobClipMorph";
import useFocusTrap from "../../hooks/useFocusTrap";

import "./SprintPanel.css";

// The event the command palette's "Start a focus sprint" entry (and the
// quick dock's clock icon) fire to summon this panel from anywhere.
export const SPRINT_EVENT = "docket:sprint";

const RING_R = 70;
const CIRCUMFERENCE = 2 * Math.PI * RING_R;

const formatClock = (totalSeconds) => {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${ m }:${ String(s).padStart(2, "0") }`;
};

// A writing sprint for the desk, run by its own xstate machine — the same
// recipe the command palette's machine uses, just with a ticking context
// instead of a flat open/closed toggle. The ink-ring drains with a real
// GSAP tween each second (rather than snapping frame to frame), and every
// phase change — starting, pausing, tipping into a break — throws the same
// starchy elastic squash the rest of the desk uses for its own overshoots.
// Closing the panel never stops the sprint; it just folds the ring away
// into a small ticking capsule so a sprint keeps counting down quietly in
// the background until it's reopened.
const SprintPanel = ({ reduceMotion }) => {
  const [service] = useState(() => interpret(sprintMachine));
  const [phase, setPhase] = useState("idle");
  const [context, setContext] = useState(sprintMachine.context);
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  // The dot-to-sheet morph clips through a real organic blob stage
  // (utils/blob.js's flubber-powered createBlobMorph) on top of the scale
  // spring below.
  const onBlobUpdate = useBlobClipMorph(panelRef, open, 26);

  // The sprint-length thumb borrows the free cursor's own press pulse and
  // idle pool (see useInkPulse) so it carries the same elastic personality
  // as it slides between presets.
  const lengthPulse = useInkPulse(context.sprintSeconds);

  useEffect(() => {
    service
      .onTransition((state) => {
        setPhase(String(state.value));
        setContext(state.context);
      })
      .start();

    return () => service.stop();
  }, [service]);

  // The one-second heartbeat — always ticking, harmlessly ignored by the
  // machine whenever it isn't in "running" or "break".
  useEffect(() => {
    const timer = setInterval(() => service.send("TICK"), 1000);
    return () => clearInterval(timer);
  }, [service]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest("input, textarea")) return;

      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        setOpen((prev) => !prev);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(SPRINT_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(SPRINT_EVENT, handleSummon);
    };
  }, []);

  // Traps Tab/Shift+Tab within the panel while open and returns focus to
  // whatever triggered it once closed — see useFocusTrap.js. Keyed off
  // this same plain boolean `open`, independent of the sprint machine's
  // own phase/context (which tracks the countdown itself, not panel
  // visibility) — closing the panel doesn't stop a running sprint, it just
  // folds into the small capsule below, so the trap only ever cares about
  // whether the full sheet is on screen.
  useFocusTrap(panelRef, open);

  const totalForPhase = context.phase === "break" ? context.breakSeconds : context.sprintSeconds;
  const remainingRatio = totalForPhase > 0 ? context.secondsLeft / totalForPhase : 0;

  // The ring itself — a GSAP tween per tick rather than a declarative
  // target, so the drain reads as one continuous pour rather than a
  // once-a-second jump cut.
  const ringRef = useRef(null);

  useEffect(() => {
    if (!ringRef.current) return;

    gsap.to(ringRef.current, {
      strokeDashoffset: CIRCUMFERENCE * (1 - remainingRatio),
      duration: phase === "idle" ? 0 : 0.92,
      ease: "power1.out",
      overwrite: "auto",
    });
  }, [remainingRatio, phase]);

  // The blob sitting behind the ring wobbles through a loose loop of organic
  // shapes the whole time a sprint or break is actually counting down, and
  // freezes mid-shape (rather than snapping back to a circle) the moment it
  // is paused — the same "soaking in" quality Note.jsx's delete-blob has.
  // An infinite loop (repeat: -1) is exactly the large, continuous motion
  // reduceMotion gates everywhere else in this app — and this one can run
  // for the length of an entire focus sprint, not just a few seconds — so
  // under it the tween never starts at all; the blob just sits at its
  // default resting shape instead.
  const blobRef = useRef(null);
  const blobTweenRef = useRef(null);

  useEffect(() => {
    if (!blobRef.current || reduceMotion) return;
    const active = phase === "running" || phase === "break";

    if (active && !blobTweenRef.current) {
      blobTweenRef.current = gsap.to(blobRef.current, {
        duration: 4.5,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
        borderRadius: "38% 62% 58% 42% / 48% 40% 60% 52%",
      });
    } else if (!active && blobTweenRef.current) {
      blobTweenRef.current.pause();
    } else if (active && blobTweenRef.current) {
      blobTweenRef.current.play();
    }
  }, [phase, reduceMotion]);

  useEffect(() => () => blobTweenRef.current?.kill(), []);

  // Every phase change throws one starchy squash-and-stretch across the
  // whole ring group, so starting, pausing, and tipping into a break each
  // read as a distinct little jolt rather than a flat state swap.
  const ringGroupRef = useRef(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (!ringGroupRef.current) return;

    gsap.fromTo(
      ringGroupRef.current,
      { scale: 0.86, rotate: phase === "break" ? -4 : 4 },
      { scale: 1, rotate: 0, duration: 0.7, ease: "elastic.out(1, 0.45)" }
    );
  }, [phase]);

  const start = () => {
    service.send("START");
    setOpen(true);
  };
  const pause = () => service.send("PAUSE");
  const resume = () => service.send("RESUME");
  const reset = () => service.send("RESET");
  const skip = () => service.send("SKIP");
  const setLength = (seconds) => service.send({ type: "SET_LENGTH", seconds });

  const idle = phase === "idle";
  const running = phase === "running";
  const paused = phase === "paused";
  const onBreak = phase === "break";
  const active = !idle;

  return (
    <>
      <AnimatePresence>
        {
          open && (
            <div className="sprint-layer">
              <motion.div
                className="sprint-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: .2 } }}
                onClick={ () => setOpen(false) }
              />
              <motion.div
                ref={ panelRef }
                tabIndex={ -1 }
                className={ `sprint-panel ${ onBreak ? "on-break" : "" }` }
                initial={{ opacity: 0, scale: .1, translateY: 90, borderRadius: 60 }}
                onUpdate={ onBlobUpdate }
                animate={{ opacity: 1, scale: 1, translateY: 0, borderRadius: 26 }}
                exit={{
                  opacity: 0,
                  scale: .24,
                  translateY: 60,
                  borderRadius: 50,
                  transition: { duration: .2, ease: "easeIn" },
                }}
                transition={{ type: "spring", stiffness: 190, damping: 14 }}
              >
                <div className="sprint-header">
                  <h3>{ onBreak ? "Ink break" : "Focus sprint" }</h3>
                  <motion.button
                    type="button"
                    aria-label="Close"
                    className="sprint-close"
                    whileHover={{ scale: 1.15, rotate: 90 }}
                    whileTap={{ scale: .9 }}
                    transition={{ type: "spring", stiffness: 420, damping: 16 }}
                    onClick={ () => setOpen(false) }
                  >
                    <FaXmark />
                  </motion.button>
                </div>

                <div className="sprint-ring-wrap" ref={ ringGroupRef }>
                  <span ref={ blobRef } className={ `sprint-blob ${ onBreak ? "break" : "sprint" }` } aria-hidden="true" />
                  <svg className="sprint-ring" viewBox="0 0 160 160">
                    <circle className="sprint-ring-track" cx="80" cy="80" r={ RING_R } />
                    <circle
                      ref={ ringRef }
                      className={ `sprint-ring-fill ${ onBreak ? "break" : "sprint" }` }
                      cx="80"
                      cy="80"
                      r={ RING_R }
                      strokeDasharray={ CIRCUMFERENCE }
                      strokeDashoffset={ CIRCUMFERENCE }
                      transform="rotate(-90 80 80)"
                    />
                  </svg>
                  <div className="sprint-ring-center">
                    <AnimatePresence mode="wait" initial={ false }>
                      <motion.span
                        key={ onBreak ? "break-icon" : "sprint-icon" }
                        className="sprint-phase-icon"
                        initial={{ scale: 0, rotate: -30, opacity: 0 }}
                        animate={{ scale: 1, rotate: 0, opacity: 1 }}
                        exit={{ scale: 0, rotate: 30, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 420, damping: 16 }}
                      >
                        { onBreak ? <FaMugHot /> : <FaFeatherPointed /> }
                      </motion.span>
                    </AnimatePresence>
                    <span className="sprint-clock">{ formatClock(context.secondsLeft) }</span>
                    <span className="sprint-phase-label">
                      { idle ? "Ready" : onBreak ? "Breathe a beat" : paused ? "Paused" : "Writing" }
                    </span>
                  </div>
                </div>

                {
                  idle && (
                    <div className="sprint-lengths">
                      {
                        SPRINT_PRESETS.map((preset) => (
                          <motion.button
                            key={ preset.key }
                            type="button"
                            aria-pressed={ context.sprintSeconds === preset.seconds }
                            className={ `sprint-length ${ context.sprintSeconds === preset.seconds ? "active" : "" }` }
                            whileHover={{ scale: 1.08 }}
                            whileTap={{ scale: .92 }}
                            transition={{ type: "spring", stiffness: 400, damping: 17 }}
                            onTapStart={ lengthPulse.squash }
                            onClick={ () => setLength(preset.seconds) }
                          >
                            {
                              context.sprintSeconds === preset.seconds && (
                                <motion.span
                                  layoutId="sprintLengthThumb"
                                  style={{ position: "absolute", inset: 0, borderRadius: 999 }}
                                  transition={{ type: "spring", stiffness: 480, damping: 19 }}
                                >
                                  <motion.span
                                    className="sprint-length-thumb"
                                    animate={ lengthPulse.jelly }
                                    style={{ borderRadius: "inherit" }}
                                  />
                                </motion.span>
                              )
                            }
                            <span>{ preset.label }m</span>
                          </motion.button>
                        ))
                      }
                    </div>
                  )
                }

                <div className="sprint-controls">
                  {
                    idle && (
                      <motion.button
                        type="button"
                        className="sprint-primary"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: .92 }}
                        transition={{ type: "spring", stiffness: 360, damping: 16 }}
                        onClick={ start }
                      >
                        <FaPlay /> Start writing
                      </motion.button>
                    )
                  }
                  {
                    running && (
                      <>
                        <motion.button
                          type="button"
                          className="sprint-primary"
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: .92 }}
                          transition={{ type: "spring", stiffness: 360, damping: 16 }}
                          onClick={ pause }
                        >
                          <FaPause /> Pause
                        </motion.button>
                        <motion.button
                          type="button"
                          className="sprint-secondary"
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: .9 }}
                          transition={{ type: "spring", stiffness: 400, damping: 17 }}
                          onClick={ reset }
                          aria-label="Reset the sprint"
                          title="Reset"
                        >
                          <FaRotateLeft />
                        </motion.button>
                      </>
                    )
                  }
                  {
                    paused && (
                      <>
                        <motion.button
                          type="button"
                          className="sprint-primary"
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: .92 }}
                          transition={{ type: "spring", stiffness: 360, damping: 16 }}
                          onClick={ resume }
                        >
                          <FaPlay /> Resume
                        </motion.button>
                        <motion.button
                          type="button"
                          className="sprint-secondary"
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: .9 }}
                          transition={{ type: "spring", stiffness: 400, damping: 17 }}
                          onClick={ reset }
                          aria-label="Reset the sprint"
                          title="Reset"
                        >
                          <FaRotateLeft />
                        </motion.button>
                      </>
                    )
                  }
                  {
                    onBreak && (
                      <motion.button
                        type="button"
                        className="sprint-primary"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: .92 }}
                        transition={{ type: "spring", stiffness: 360, damping: 16 }}
                        onClick={ skip }
                      >
                        <FaForward /> Skip break
                      </motion.button>
                    )
                  }
                </div>
              </motion.div>
            </div>
          )
        }
      </AnimatePresence>
      {/* A sprint left running behind a closed panel keeps a small ticking
          capsule on the desk — tapping it re-opens the full ring rather
          than losing the sprint's progress entirely. */}
      <AnimatePresence>
        {
          active && !open && (
            <motion.button
              type="button"
              className={ `sprint-capsule ${ onBreak ? "break" : "sprint" }` }
              aria-label="Reopen the focus sprint"
              title={ `${ onBreak ? "Break" : "Sprint" } · ${ formatClock(context.secondsLeft) }` }
              initial={{ opacity: 0, scale: 0, translateY: 30 }}
              animate={{ opacity: 1, scale: 1, translateY: 0 }}
              exit={{ opacity: 0, scale: 0, translateY: 30 }}
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: .92 }}
              transition={{ type: "spring", stiffness: 320, damping: 16 }}
              onClick={ () => setOpen(true) }
            >
              <span className="sprint-capsule-dot" />
              { formatClock(context.secondsLeft) }
            </motion.button>
          )
        }
      </AnimatePresence>
    </>
  );
};

export default SprintPanel;
