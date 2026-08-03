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
import {
  FaArrowLeft,
  FaArrowRight,
  FaArrowUpWideShort,
  FaChartLine,
  FaChartSimple,
  FaClockRotateLeft,
  FaDroplet,
  FaExpand,
  FaFileArrowDown,
  FaGear,
  FaGrip,
  FaLayerGroup,
  FaLock,
  FaLockOpen,
  FaMagnifyingGlass,
  FaMoon,
  FaShuffle,
  FaSquareCheck,
  FaStar,
  FaSun,
  FaWandMagicSparkles,
} from "react-icons/fa6";

import { tourMachine } from "./TourState";
import { hasSeenTour, markTourSeen } from "../../utils/storage";
import { REPLAY_DONE_EVENT } from "../Replay/ShotReplay";
import { resolveCssColor } from "../History/HistoryAmbient";
import { playMilestone, playSpawn, playTick } from "../../utils/sound";
import InkGoo from "./InkGoo";
import SketchRing from "./SketchRing";

import "./TourGuide.css";

// Fired to walk the desk again on demand, regardless of hasSeenTour() —
// the command palette's own "Show me around again" entry uses this
// directly; "Replay the original shot" reaches the same place indirectly,
// via REPLAY_DONE_EVENT below, once the cinematic actually finishes.
export const TOUR_EVENT = "docket:tour";

// The walk's script: what each stop points at, what the card says there,
// and which of the desk's own inks tints that stop's halo and details.
const SCRIPT = {
  greeting: {
    title: "Welcome to the desk",
    body: "This desk has a few tricks folded into it. Give it a minute and it'll walk you past the ones worth knowing.",
    accent: "var(--yellow-color)",
    width: 340,
  },
  activator: {
    selector: "#navActivator",
    title: "Pour a note",
    body: "Tap any ink pot here — or just press N — to drop a fresh note onto the desk.",
    accent: "var(--orange-color)",
    icon: FaDroplet,
    width: 312,
  },
  backup: {
    selector: ".nav-tool.export-trigger",
    title: "Keep a copy",
    body: "Export saves the whole desk as a file you can keep — the button beside it brings a backup back in.",
    accent: "var(--blue-color)",
    icon: FaFileArrowDown,
    width: 312,
  },
  ink: {
    selector: ".ink-levels .ink-button",
    title: "How much ink you've used",
    body: "A little vial and a bar for every color — tap here to see the whole desk's ink levels at a glance.",
    accent: "var(--purple-color)",
    icon: FaChartSimple,
    width: 312,
  },
  search: {
    selector: ".header .search",
    title: "Find anything",
    body: "Search titles and text as you type, or press / to jump straight here.",
    accent: "var(--blue-color)",
    icon: FaMagnifyingGlass,
    width: 312,
  },
  star: {
    selector: ".header .search .star",
    title: "Star the ones that matter",
    body: "Tap the star on any note to keep it close, then tap this one to see only your starred notes.",
    accent: "var(--yellow-color)",
    icon: FaStar,
    width: 312,
  },
  pile: {
    selector: ".header .pile-toggle",
    title: "Toss it all in a pile",
    body: "Tired of the grid? This tosses every note into a real physics pile you can drag your hand through — tap it again to pour the grid back.",
    accent: "var(--red-color)",
    icon: FaLayerGroup,
    width: 320,
  },
  shuffle: {
    selector: ".shuffle",
    title: "Give it a riffle",
    body: "Shuffle tosses the order into the air — the same trick lives in the quick dock if your hand's already down there.",
    accent: "var(--pink-color)",
    icon: FaShuffle,
    width: 312,
  },
  sort: {
    selector: ".sort-modes",
    title: "Sort it your way",
    body: "Freshest first, grouped by ink, or starred to the front — three ways to read the same desk.",
    accent: "var(--green-color)",
    icon: FaArrowUpWideShort,
    width: 312,
  },
  select: {
    selector: ".select-toggle",
    title: "Grab a handful",
    body: "Check off a few notes to star, recolor, export, or delete the whole batch in one go.",
    accent: "var(--purple-color)",
    icon: FaSquareCheck,
    width: 312,
  },
  dock: {
    selector: ".quick-dock",
    title: "The quick dock",
    body: "A floating tray for whatever you reach for most — a fresh note, a shuffle, focus mode, a sprint — parked wherever your hand already is.",
    accent: "var(--gray-color)",
    icon: FaGrip,
    width: 320,
  },
  focus: {
    selector: ".header .focus-trigger",
    title: "Zero in",
    body: "Focus mode clears away everything but the grid itself — press F, or tap here, whenever the chrome gets in the way.",
    accent: "var(--green-color)",
    icon: FaExpand,
    width: 312,
  },
  insights: {
    selector: ".header .insights-trigger",
    title: "See the shape of it",
    body: "A quick read on the whole desk — how many notes, which colors you reach for most, how long you've been at it.",
    accent: "var(--pink-color)",
    icon: FaChartLine,
    width: 312,
  },
  history: {
    selector: ".header .history-trigger",
    title: "Every edit, kept",
    body: "Scrub back through everything you've done — undo, redo, or jump straight to any moment on the timeline.",
    accent: "var(--orange-color)",
    icon: FaClockRotateLeft,
    width: 312,
  },
  theme: {
    selector: ".header .theme",
    title: "Flip the page",
    body: "Switch between fresh paper and the Ink theme whenever the light changes.",
    accent: "var(--purple-color)",
    // No static icon — this one flips between sun/moon with the theme
    // itself, resolved in CardContent the same way Header.jsx's own
    // toolbar icon is.
    width: 312,
  },
  persist: {
    selector: ".header .persist",
    title: "Remember, or forget",
    body: "Notes clear when you close this tab by default — lock this to keep them waiting for you next time.",
    accent: "var(--gray-color)",
    // Also flips its own icon live — locked or open — same pattern as theme.
    width: 312,
  },
  settings: {
    selector: ".header .settings-trigger",
    title: "Tune the desk",
    body: "Sound, motion, and the notebook's other quiet preferences all live behind this gear.",
    accent: "var(--red-color)",
    icon: FaGear,
    width: 312,
  },
  // The one stop that stands in for everything else this walk doesn't have
  // room for — trash, sprints, replay, all of it lives behind this single
  // wand rather than needing its own separate stop apiece.
  command: {
    selector: ".header .command-trigger",
    title: "Find anything else",
    body: "Ctrl+K (or this wand) opens a command palette for everything the desk can do — trash, focus sprints, replaying the intro, all of it.",
    accent: "var(--green-color)",
    icon: FaWandMagicSparkles,
    width: 320,
  },
  // No selector — like the bookends, this one holds centre stage. Unlike
  // them it's still a numbered stop in the walk (it belongs in WALK, just
  // without a control to point at), since it's teaching something real
  // rather than framing the walk itself.
  shortcuts: {
    title: "Or just press ?",
    body: "A full cheat sheet of every shortcut this desk answers to, one keystroke away whenever you forget.",
    accent: "var(--blue-color)",
    width: 300,
  },
  farewell: {
    title: "The desk is yours",
    body: "Pour freely — the ink remembers this session.",
    accent: "var(--pink-color)",
    width: 300,
  },
};

const WALK = ["activator", "backup", "ink", "search", "star", "pile", "shuffle", "sort", "select", "dock", "focus", "insights", "history", "theme", "persist", "settings", "command", "shortcuts"];

const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);

// The discussed control's own landing, in place of the old "grow and hold
// a bigger scale for the whole stop" camera zoom: a z-index pop (so it
// always draws above its own siblings while it's the one being talked
// about, and never clips under a neighbor mid-wobble) plus one bouncy jelly
// squash-and-stretch on arrival. The squash/stretch keyframes are the
// project's own established jelly signature — the exact values useJellyTap
// already plays on every toolbar icon's tap — reused verbatim here on the
// raw DOM node (useJellyTap itself only works on mounted framer components,
// not an arbitrary querySelector hit) so this reads as the same physical
// material as the rest of the toolbar, not a new invented wobble. Scale
// always settles back to 1 on its own within the tween; nothing is held
// afterward except the z-index bump itself.
const DISCUSSED_Z = 40;

const bounceElement = (el) => {
  if (window.getComputedStyle(el).position === "static") {
    el.dataset.tourStaticPos = "1";
    gsap.set(el, { position: "relative" });
  }
  gsap.set(el, { zIndex: DISCUSSED_Z, transformOrigin: "50% 50%", scaleX: 1, scaleY: 1 });

  return gsap.to(el, {
    keyframes: {
      "0%": { scaleX: 1, scaleY: 1 },
      "18%": { scaleX: .74, scaleY: 1.28 },
      "42%": { scaleX: 1.18, scaleY: .84 },
      "64%": { scaleX: .93, scaleY: 1.08 },
      "84%": { scaleX: 1.04, scaleY: .97 },
      "100%": { scaleX: 1, scaleY: 1 },
    },
    duration: .55,
    ease: "power1.inOut",
  });
};

// Undoes bounceElement's own marks — the z-index bump, the transform, and
// the position override if this element didn't already have one of its
// own. No easing needed: by the time anything calls this, the jelly tween
// has long since settled itself back to scaleX/scaleY 1 on its own.
const releaseElement = (el) => {
  gsap.killTweensOf(el);
  gsap.set(el, { clearProps: "scaleX,scaleY,zIndex,transformOrigin" });
  if (el.dataset.tourStaticPos) {
    gsap.set(el, { clearProps: "position" });
    delete el.dataset.tourStaticPos;
  }
};

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
//
// The content itself arrives through a growing ink-blot: a circular
// clip-path opening from roughly where the icon badge sits, out past the
// card's own corners — the same idea as a drop of ink spreading to soak a
// whole sheet, done as one clean CSS mask rather than a WebGL/SVG blur
// filter (a goo-style blur filter reads beautifully on a large blob shape
// like InkGoo's creature, but turns a paragraph of small text into an
// illegible smear — clip-path keeps every letter crisp throughout, exactly
// where a mask belongs and a filter doesn't). The outer AnimatePresence
// wrapper (see TourGuide's render below) no longer plays its own
// scale/y entrance for this reason — the reveal below already carries
// that job — and only handles the outgoing stop's exit fade.
const CardContent = ({ step, config, walkIndex, reduced, send, onJump, theme, persistNotes }) => {
  const rootRef = useRef(null);
  const revealMv = useMotionValue(reduced ? 150 : 0);
  const clipPath = useTransform(revealMv, (r) => `circle(${ r }% at 27px 27px)`);

  useEffect(() => {
    if (reduced) return;

    const controls = animate(revealMv, 150, {
      duration: .64,
      ease: [.22, 1, .36, 1],
    });

    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

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

  // Every real stop echoes the actual control it's discussing with a small
  // badge of that control's own icon. Two exceptions flip live instead of
  // holding still, each mirroring its real button's own logic exactly:
  // theme shows the destination icon (what tapping it switches TO, same as
  // Header.jsx's toolbar button), while persist shows the current-state
  // icon (locked while remembering, open while not — Header.jsx's own
  // persist button reads the same way, not a destination).
  const StopIcon = step === "theme" ? (theme === "dark" ? FaSun : FaMoon)
    : step === "persist" ? (persistNotes ? FaLock : FaLockOpen)
    : config.icon;

  return (
    <motion.div
      ref={ rootRef }
      className={ `tour-card-inner ${ isFarewell ? "centered" : "" }` }
      style={{ clipPath }}
    >
      {
        StopIcon && (
          <motion.span
            className="tour-card-icon"
            initial={{ scale: 0, rotate: -60, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 320, damping: 11, delay: .05 }}
          >
            <StopIcon />
          </motion.span>
        )
      }
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
                  <button
                    key={ name }
                    type="button"
                    className={ `tour-dot ${ index < walkIndex ? "past" : "" } ${ index === walkIndex ? "live" : "" }` }
                    aria-label={ `Jump to ${ SCRIPT[name]?.title || name }` }
                    aria-current={ index === walkIndex ? "step" : undefined }
                    onPointerDown={ (e) => e.stopPropagation() }
                    onClick={ () => onJump(index) }
                  >
                    {
                      !reduced && index === walkIndex && (
                        <motion.span
                          layoutId="tourDotLive"
                          className="tour-dot-ring"
                          transition={{ type: "spring", stiffness: 380, damping: 16 }}
                        />
                      )
                    }
                  </button>
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
            <motion.button
              type="button"
              className="tour-skip"
              whileHover={{ opacity: .8 }}
              whileTap={{ scale: .94 }}
              transition={{ type: "spring", stiffness: 700, damping: 35 }}
              onPointerDown={ (e) => e.stopPropagation() }
              onClick={ () => send("SKIP") }
            >
              { isGreeting ? "I'll wander" : "Skip" }
            </motion.button>
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
                    onPointerDown={ (e) => e.stopPropagation() }
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
                onPointerDown={ (e) => e.stopPropagation() }
                onClick={ () => send("NEXT") }
              >
                { isGreeting ? "Show me around" : step === "shortcuts" ? "Got it" : "Next" }
                <FaArrowRight className="tour-next-icon" />
              </motion.button>
            </div>
          </motion.div>
        )
      }
    </motion.div>
  );
};

// The first-run walk of the desk, without its old spotlight — nothing is
// dimmed, nothing is blocked, and nothing is painted over the target.
// The control under discussion answers for itself: InkGoo's own mark()
// pools a ring of liquid ink around it in the stop's own accent (see
// InkGoo.jsx) — a second metaball field entirely decoupled from the
// control's own DOM transform — while the one paper card blooms up out of
// a drop the same dot-to-sheet way the command palette and every other
// panel does, then rides loose springs from stop to stop — wobbling
// upright and jelly-squashing on landing exactly the way a freshly poured
// note does. At each stop the control itself reacts too: aimCamera below
// pops it forward in stacking order and plays one bouncy jelly squash-and-
// stretch (see bounceElement) — never a held, grown-in-place zoom — and
// releases the z-index pop the moment the walk moves to a different
// control (or to a bookend scene, which has nothing to pop). The card's
// own content arrives the same ink-native way: CardContent's clip-path
// reveal opens a circle from roughly the icon badge outward, soaking the
// new stop's title/body/actions into view the way a drop spreads across
// paper, rather than the flat crossfade every other panel in the app
// already uses — the one place this walk allows itself something neither
// InkGoo nor SketchRing nor any other panel already does, since here it's
// a genuine improvement (a mask keeps small text crisp; the metaball/goo
// techniques used elsewhere are for blob-sized shapes and would smear
// text) rather than novelty for its own sake. The walk itself is still one
// xstate machine (TourState.js); this component just measures the desk
// and points.
const TourGuide = ({ theme, persistNotes }) => {
  const [service] = useState(() => interpret(tourMachine));
  const [step, setStep] = useState("closed");
  const [reduced] = useState(prefersReducedMotion);
  const [ringRect, setRingRect] = useState(null);

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

  // The card is also a swipeable deck — flick it left or right (mouse or
  // touch, framer's drag gesture answers both) to pace the walk the same
  // way the arrow buttons and arrow keys already do, riding the same
  // elastic-fling-then-spring-back recipe as UndoToast.jsx's swipe-to-
  // dismiss. dragX is a separate motion value laid on top of the shell's
  // own spring position, not a replacement for it.
  const dragX = useMotionValue(0);
  const dragRotate = useTransform(dragX, [-160, 0, 160], [-9, 0, 9]);

  const primedRef = useRef(false);
  const cameraRef = useRef(null);
  const zoomedElRef = useRef(null); // whichever control the camera is currently (or was last) leaning into
  const gooRef = useRef(null);
  const cardRef = useRef(null);
  const wasOpenRef = useRef(false);
  const dragResetRef = useRef(null);

  const send = useCallback((event) => service.send(event), [service]);

  useEffect(() => () => clearTimeout(dragResetRef.current), []);

  // A swipe past the threshold flings the card off in that direction and
  // paces the walk exactly as the matching button would; short of that,
  // it springs back to rest. The card itself never unmounts between stops
  // (only its inner content crossfades), so — unlike UndoToast, where the
  // dismissed card is simply gone — the fling has to be reset back to 0 by
  // hand once the new stop's content has had a beat to swap in.
  const handleCardDragEnd = useCallback((_e, info) => {
    const goingBack = info.offset.x > 0;
    const past = Math.abs(info.offset.x) > 90 || Math.abs(info.velocity.x) > 650;
    const blocked = !past || (goingBack && WALK.indexOf(step) <= 0);

    clearTimeout(dragResetRef.current);

    if (blocked) {
      animate(dragX, 0, { type: "spring", stiffness: 420, damping: 26 });
      return;
    }

    animate(dragX, goingBack ? 320 : -320, { duration: .2, ease: "easeIn" });
    send(goingBack ? "BACK" : "NEXT");
    // A bouncy boomerang back to center, timed to land right as the new
    // stop's content is settling in underneath — not an instant snap.
    dragResetRef.current = setTimeout(() => {
      animate(dragX, 0, { type: "spring", stiffness: 260, damping: 22 });
    }, 160);
  }, [step, send, dragX]);

  // The progress dots double as a stepper: jump straight to any stop,
  // forward or back. The machine only knows NEXT/BACK, not "go to index N"
  // — so a jump is just however many of those fired in a row, synchronously,
  // which xstate and React both collapse into a single landing (only the
  // final step's arrival effect ever runs, same as any other transition).
  const jumpTo = useCallback((targetIndex) => {
    const currentIndex = WALK.indexOf(step);
    if (currentIndex < 0 || targetIndex === currentIndex) return;

    const event = targetIndex > currentIndex ? "NEXT" : "BACK";
    const hops = Math.abs(targetIndex - currentIndex);
    for (let i = 0; i < hops; i++) service.send(event);
  }, [step, service]);

  // The live top-center of the rendered card, read fresh every frame by
  // InkGoo's own RAF loop (see cardTip in InkGoo.jsx) — getBoundingClientRect
  // already folds in the card's spring position, scale and jelly squash, so
  // the creature's stem always reaches exactly where the card currently is
  // rather than where it was aimed.
  const cardTip = useCallback(() => {
    const el = cardRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top };
  }, []);

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

  // A manual replay — either directly (TOUR_EVENT) or chained on right
  // after the origin-story cinematic finishes (REPLAY_DONE_EVENT, see
  // ShotReplay.jsx) — sends START regardless of hasSeenTour(); TourState.js
  // gives "done" its own way back to "greeting" specifically for this.
  // The short delay after a chained start lets the cinematic's own camera
  // actually finish settling (ShotReplay's cleanup eases it back over
  // .45s) before the guide's card blooms in over it.
  useEffect(() => {
    let chainTimer = null;
    // A replay's first "greeting" seat should jump straight to center, the
    // same clean landing the very first walk gets — not spring-slide in
    // from wherever the card happened to be sitting (still near the last
    // stop of a PREVIOUS walk) the moment this one starts.
    const startNow = () => {
      primedRef.current = false;
      service.send("START");
    };
    const startAfterReplay = () => {
      clearTimeout(chainTimer);
      chainTimer = setTimeout(startNow, 700);
    };

    window.addEventListener(TOUR_EVENT, startNow);
    window.addEventListener(REPLAY_DONE_EVENT, startAfterReplay);
    return () => {
      clearTimeout(chainTimer);
      window.removeEventListener(TOUR_EVENT, startNow);
      window.removeEventListener(REPLAY_DONE_EVENT, startAfterReplay);
    };
  }, [service]);

  useEffect(() => {
    if (step === "done") markTourSeen();
  }, [step]);

  const open = step !== "closed" && step !== "done";

  // Hand the last discussed control's z-index and transform back to the
  // stylesheet. Runs whenever the walk ends, and again on unmount in case
  // the app is torn down mid-bounce.
  const releaseCamera = useCallback(() => {
    cameraRef.current?.kill();
    cameraRef.current = null;

    const target = zoomedElRef.current;
    zoomedElRef.current = null;
    if (!target) return;

    releaseElement(target);
  }, []);

  useEffect(() => {
    if (!open) releaseCamera();
  }, [open, releaseCamera]);

  useEffect(() => () => releaseCamera(), [releaseCamera]);

  // The ink guide bows out the moment the walk actually closes (SKIP, or
  // the farewell timing out to "done") — not on every stop-to-stop hop,
  // which only ever nudges or re-splats it. InkGoo is mounted for the
  // component's whole lifetime (see the render below) so its own soak-away
  // has time to finish without the canvas disappearing mid-animation.
  useEffect(() => {
    if (!reduced && !open && wasOpenRef.current) {
      gooRef.current?.dismiss();
    }
    wasOpenRef.current = open;
  }, [open, reduced]);

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

      // The sketch ring only has a target for stops with a real selector;
      // greeting/farewell hold centre stage with no control to circle.
      setRingRect(focus ? { cx: focus.cx, cy: focus.cy, width: focus.width, height: focus.height } : null);

      // A light sound arc across the whole walk, reusing existing cues
      // rather than composing new ones: the opening beat reads as the same
      // "something new arriving" moment a poured note gets, each stop in
      // between gets the small repeatable tick already used for fiddly,
      // non-desk-changing UI steps, and the close gets the one genuinely
      // celebratory chime in the palette. Independent of reduced motion —
      // this is gated by the sound setting itself (play() in sound.js),
      // not by the animation preference.
      if (travel) {
        if (step === "farewell") playMilestone();
        else if (step === "greeting") playSpawn();
        else playTick();
      }

      if (!reduced) {
        // The creature's own perch: nestled just under the control (between
        // it and the card) for a targeted stop, or just above the card
        // itself for the bookend scenes — either way close enough that its
        // two stem drops always have a short, natural reach up to the
        // card's live top edge. A fresh arrival (travel) earns the full
        // splat-and-retint landing; an ambient reposition (resize, scroll,
        // mid-zoom re-measure) just nudges the perch without replaying it.
        const anchor = focus
          ? { x: focus.cx, y: focus.bottom + 14 }
          : { x: vw / 2, y: top - 34 };

        if (travel) {
          // InkGoo hands the accent straight to THREE.Color, which has no
          // idea what to do with a raw "var(--x)" string — resolve it to
          // the computed color first, the same way HistoryAmbient/
          // LiquidMeter already do for every other WebGL retint in the app.
          gooRef.current?.moveTo({ x: anchor.x, y: anchor.y, accent: resolveCssColor(config.accent), stem: true });
        } else {
          gooRef.current?.nudge(anchor);
        }

        // The discussed control's own mark: a ring of liquid ink pooling
        // just outside it, rendered by the same WebGL canvas (see mark()/
        // unmark() in InkGoo.jsx). Called on every seat(), not just travel,
        // so it keeps pace with aimCamera's own live-growing rect during
        // the zoom — a bookend scene (no focus) has nothing to mark.
        if (focus) {
          gooRef.current?.mark({ rect: focus, accent: resolveCssColor(config.accent) });
        } else {
          gooRef.current?.unmark();
        }
      }
    };

    // The camera: pop this stop's own control forward in stacking order and
    // give it one bouncy jelly wobble — never a held, grown-in-place scale
    // (that was the old "lean in and stay bigger" version; this one always
    // settles back to its everyday size). Whatever the previous stop had
    // popped releases first if this one is a different control (or none at
    // all, for the bookend scenes).
    const aimCamera = () => {
      const el = config.selector && document.querySelector(config.selector);

      cameraRef.current?.kill();

      const previouslyZoomed = zoomedElRef.current;
      if (previouslyZoomed && previouslyZoomed !== el) {
        releaseElement(previouslyZoomed);
      }
      zoomedElRef.current = el || null;

      if (!el) return; // Bookend scenes: nothing to pop.

      cameraRef.current = bounceElement(el);
    };

    seat(true);

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
  // The bookends hold centre stage on their own timers/buttons rather than
  // a direction to flick toward — greeting has nothing behind it to swipe
  // back to, farewell is already on its way out.
  const swipeable = walkIndex >= 0;

  return (
    <>
      {
        // The guide's own body: a WebGL ink creature that perches beside
        // whatever the walk is pointing at and hangs the card off itself
        // by a gooey stem (see InkGoo.jsx). Mounted for the component's
        // whole lifetime, not just while open — it drives its own
        // visibility (born/soak-away) through moveTo/dismiss, and staying
        // mounted is what lets the soak-away actually finish instead of
        // being cut off by the card layer unmounting under it. Skipped
        // entirely under reduced motion, the same fallback CursorAura uses
        // for its own always-on WebGL layer.
        !reduced && <InkGoo ref={ gooRef } theme={ theme } cardTip={ cardTip } />
      }
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
                // The hand-drawn spotlight: a sketchy ring circling whichever
                // control the current stop targets. Nothing to circle at the
                // bookend scenes, so ringRect stays null there.
                ringRect && (
                  <AnimatePresence mode="wait">
                    <SketchRing key={ step } rect={ ringRect } accent={ config?.accent } reduced={ reduced } />
                  </AnimatePresence>
                )
              }
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
                      ref={ cardRef }
                      className={ `tour-card ${ swipeable ? "swipeable" : "" }` }
                      role="dialog"
                      aria-live="polite"
                      aria-label={ config.title }
                      style={{ originY: 0, "--tour-accent": config.accent, x: dragX, rotate: dragRotate }}
                      initial={{ opacity: 0, scale: .2, borderRadius: 44 }}
                      animate={{ opacity: 1, scale: 1, borderRadius: 16, width: config.width }}
                      exit={{ opacity: 0, scale: .3, borderRadius: 44, transition: { duration: .16, ease: "easeIn" } }}
                      transition={{
                        type: "spring",
                        stiffness: 230,
                        damping: 12,
                        width: { type: "spring", stiffness: 170, damping: 14 },
                      }}
                      drag={ swipeable ? "x" : false }
                      whileDrag={{ scale: 1.02, cursor: "grabbing" }}
                      onDragEnd={ handleCardDragEnd }
                    >
                      {/* The entrance itself now belongs to CardContent's own
                          ink-blot clip-path reveal (see there) — this wrapper
                          only needs to handle the outgoing stop's exit, a
                          quick plain fade so it gets out of the way fast
                          without competing with the incoming stop's own
                          reveal for attention. */}
                      <AnimatePresence mode="wait" initial={ false }>
                        <motion.div
                          key={ step }
                          exit={{ opacity: 0, transition: { duration: .13, ease: "easeIn" } }}
                        >
                          <CardContent
                            step={ step }
                            config={ config }
                            walkIndex={ walkIndex }
                            reduced={ reduced }
                            send={ send }
                            onJump={ jumpTo }
                            theme={ theme }
                            persistNotes={ persistNotes }
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
    </>
  );
};

export default TourGuide;
