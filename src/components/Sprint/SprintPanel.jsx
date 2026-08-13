import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { interpret } from "xstate";
import gsap from "gsap";
import { FaPlay, FaPause, FaRotateLeft, FaForward, FaXmark, FaMugHot, FaFeatherPointed } from "react-icons/fa6";

import { sprintMachine, SPRINT_PRESETS } from "./SprintState";
import useInkPulse from "../../hooks/useInkPulse";
import SheetPanel from "../Sheet/SheetPanel";
import { blobPath, createBlobMorph } from "../../utils/blob";

import "./SprintPanel.css";

// The event the command palette's "Start a focus sprint" entry (and the
// quick dock's clock icon) fire to summon this panel from anywhere.
export const SPRINT_EVENT = "docket:sprint";

const RING_R = 70;
const CIRCUMFERENCE = 2 * Math.PI * RING_R;
const BLOB_SIZE = 148; // matches .sprint-blob's own inset: 14px on the 176px ring-wrap

// Dragging the ring itself while idle (see handleRingPointerDown below)
// dials a custom length continuously between these two bounds, snapped to
// the nearest minute — the three presets stay for a quick pick, this is
// for anything in between.
const LENGTH_DRAG_MIN_MINUTES = 5;
const LENGTH_DRAG_MAX_MINUTES = 90;

// The blob's own morph speed reacts to how little time is actually left
// (see the ring-drain effect below) — once remainingRatio drops under
// this fraction of the current phase's total, the loop starts playing
// back faster, peaking at URGENCY_MAX_SPEED right at zero. A real
// feedback loop (rate of visual change as a function of state), not a
// fixed wobble regardless of how close the sprint actually is to done.
const URGENCY_RATIO = .15;
const URGENCY_MAX_SPEED = 2.4;

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

  const totalForPhase = context.phase === "break" ? context.breakSeconds : context.sprintSeconds;
  // Idle reads the ring differently than every other phase: secondsLeft
  // and sprintSeconds are always equal at rest (SET_LENGTH sets both
  // together), so a plain secondsLeft/total ratio would just be a
  // permanent 1 regardless of the chosen length. Instead this maps the
  // CHOSEN length itself onto the [MIN,MAX] drag range (see
  // LENGTH_DRAG_MIN/MAX_MINUTES) — the fill becomes "how long a sprint
  // you're about to start," which is what dragging the ring below is
  // actually dialing in.
  const remainingRatio = phase === "idle"
    ? Math.max(0, Math.min(1,
      (context.sprintSeconds / 60 - LENGTH_DRAG_MIN_MINUTES) / (LENGTH_DRAG_MAX_MINUTES - LENGTH_DRAG_MIN_MINUTES),
    ))
    : totalForPhase > 0 ? context.secondsLeft / totalForPhase : 0;

  // The ring itself — a GSAP tween per tick rather than a declarative
  // target, so the drain reads as one continuous pour rather than a
  // once-a-second jump cut. Idle's own duration stays 0 (an instant
  // update) — that's what makes dragging the ring below read as live
  // rather than lagging a tween behind the pointer.
  const ringRef = useRef(null);

  useEffect(() => {
    if (!ringRef.current) return;

    gsap.to(ringRef.current, {
      strokeDashoffset: CIRCUMFERENCE * (1 - remainingRatio),
      duration: phase === "idle" ? 0 : 0.92,
      ease: "power1.out",
      overwrite: "auto",
    });

    // The blob's own morph speed reacts to the same remainingRatio this
    // ring just drained by — see URGENCY_RATIO's own comment.
    if (blobTweenRef.current) {
      const urgent = phase !== "idle" && remainingRatio < URGENCY_RATIO;
      const timeScale = urgent ? 1 + (1 - remainingRatio / URGENCY_RATIO) * (URGENCY_MAX_SPEED - 1) : 1;
      blobTweenRef.current.timeScale(timeScale);
    }
  }, [remainingRatio, phase]);

  // The blob sitting behind the ring wobbles through a loose loop of organic
  // shapes the whole time a sprint or break is actually counting down, and
  // freezes mid-shape (rather than snapping back to a circle) the moment it
  // is paused — the same "soaking in" quality Note.jsx's delete-blob has.
  // A real flubber shape morph now (utils/blob.js — the exact machinery
  // useBlobClipMorph.js already established for panel entrances) rather
  // than the CSS border-radius percentage-string approximation this used
  // to animate: an actual hand-drawn silhouette interpolating between real
  // organic outlines, not four corner-radii faking one. An infinite loop
  // (repeat: -1) is exactly the large, continuous motion reduceMotion gates
  // everywhere else in this app — and this one can run for the length of
  // an entire focus sprint, not just a few seconds — so under it the tween
  // never starts at all; the blob just sits at its default resting shape.
  const blobRef = useRef(null);
  const blobPathRef = useRef(null);
  const blobMorphRef = useRef(null);
  const blobProgressRef = useRef({ t: 0 });
  const blobTweenRef = useRef(null);

  useEffect(() => {
    if (!blobPathRef.current) return;
    const shapes = [
      blobPath(BLOB_SIZE, BLOB_SIZE, 9, .3),
      blobPath(BLOB_SIZE, BLOB_SIZE, 9, .4),
      blobPath(BLOB_SIZE, BLOB_SIZE, 9, .32),
    ];
    blobMorphRef.current = createBlobMorph(blobPathRef.current, shapes);
    blobMorphRef.current.set(0);
  }, []);

  useEffect(() => {
    if (!blobRef.current || !blobMorphRef.current || reduceMotion) return;
    const active = phase === "running" || phase === "break";

    if (active && !blobTweenRef.current) {
      blobTweenRef.current = gsap.to(blobProgressRef.current, {
        t: blobMorphRef.current.stageCount,
        duration: 4.5,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
        onUpdate: () => blobMorphRef.current?.set(blobProgressRef.current.t),
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
  // read as a distinct little jolt rather than a flat state swap. A
  // running→break transition specifically — a sprint actually finished,
  // not paused or reset — gets a bigger version of that same jolt plus a
  // quick scale-bloom on the blob itself, the ink visibly breathing out in
  // relief. Reuses only the ring/blob's own existing elastic language
  // (bigger amplitude, not a new effect) — no confetti/particle burst, the
  // same restraint InkCelebration.jsx already commits this app to for
  // every other milestone moment.
  const ringGroupRef = useRef(null);
  const mountedRef = useRef(false);
  const prevPhaseRef = useRef(phase);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      prevPhaseRef.current = phase;
      return;
    }
    if (!ringGroupRef.current) return;

    const completedSprint = prevPhaseRef.current === "running" && phase === "break";
    prevPhaseRef.current = phase;

    gsap.fromTo(
      ringGroupRef.current,
      { scale: completedSprint ? .82 : 0.86, rotate: phase === "break" ? -4 : 4 },
      {
        scale: 1, rotate: 0,
        duration: completedSprint ? .9 : .7,
        ease: completedSprint ? "elastic.out(1, .4)" : "elastic.out(1, 0.45)",
      }
    );

    if (completedSprint && blobRef.current && !reduceMotion) {
      gsap.fromTo(blobRef.current, { scale: 1 }, { scale: 1.4, duration: .3, ease: "power2.out", yoyo: true, repeat: 1 });
    }
  }, [phase, reduceMotion]);

  const start = () => {
    service.send("START");
    setOpen(true);
  };
  const pause = () => service.send("PAUSE");
  const resume = () => service.send("RESUME");
  const reset = () => service.send("RESET");
  const skip = () => service.send("SKIP");
  const setLength = (seconds) => service.send({ type: "SET_LENGTH", seconds });

  // Grab the ring itself while idle and drag around it to dial in a custom
  // length, rather than only ever tapping the three fixed presets — the
  // angle from ring-center to pointer maps directly onto
  // [LENGTH_DRAG_MIN_MINUTES, LENGTH_DRAG_MAX_MINUTES], snapped to the
  // nearest minute. Every SET_LENGTH this dispatches sets secondsLeft
  // alongside sprintSeconds (same reducer the presets already use), so the
  // digital clock and the ring's own fill (see remainingRatio's idle
  // branch above) both update live as the pointer moves, not just on
  // release.
  const ringDragRef = useRef(false);

  const angleToMinutes = (clientX, clientY, rect) => {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let angle = Math.atan2(clientY - cy, clientX - cx) + Math.PI / 2;
    if (angle < 0) angle += Math.PI * 2;
    const t = angle / (Math.PI * 2);
    return Math.round(LENGTH_DRAG_MIN_MINUTES + t * (LENGTH_DRAG_MAX_MINUTES - LENGTH_DRAG_MIN_MINUTES));
  };

  const handleRingPointerDown = (e) => {
    if (phase !== "idle") return;
    ringDragRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setLength(angleToMinutes(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect()) * 60);
  };

  const handleRingPointerMove = (e) => {
    if (!ringDragRef.current) return;
    setLength(angleToMinutes(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect()) * 60);
  };

  const handleRingPointerUp = (e) => {
    if (!ringDragRef.current) return;
    ringDragRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const idle = phase === "idle";
  const running = phase === "running";
  const paused = phase === "paused";
  const onBreak = phase === "break";
  const active = !idle;

  return (
    <>
      <SheetPanel
        open={ open }
        onClose={ () => setOpen(false) }
        panelRef={ panelRef }
        radius={ 26 }
        layerClassName="sprint-layer"
        backdropClassName="sprint-backdrop"
        panelClassName={ `sprint-panel ${ onBreak ? "on-break" : "" }` }
        ariaLabel={ onBreak ? "Ink break" : "Focus sprint" }
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
                  <span ref={ blobRef } className={ `sprint-blob ${ onBreak ? "break" : "sprint" }` } aria-hidden="true">
                    <svg viewBox={ `0 0 ${ BLOB_SIZE } ${ BLOB_SIZE }` }>
                      <path ref={ blobPathRef } className="sprint-blob-path" />
                    </svg>
                  </span>
                  <svg
                    className={ `sprint-ring ${ idle ? "draggable" : "" }` }
                    viewBox="0 0 160 160"
                    onPointerDown={ handleRingPointerDown }
                    onPointerMove={ handleRingPointerMove }
                    onPointerUp={ handleRingPointerUp }
                    onPointerCancel={ handleRingPointerUp }
                    style={{ touchAction: "none" }}
                  >
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
      </SheetPanel>
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
