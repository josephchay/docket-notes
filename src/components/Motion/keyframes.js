import { EASE_IN_OUT } from "./easings";
import { EXIT_SPRING } from "./springs";

// The starchy squash-and-stretch a tap leaves on an icon (useJellyTap) or a
// shared highlight (useInkPulse) — the same recipe, two different scale
// shapes: a matched scaleX/scaleY pair for something that can stretch on
// either axis, or one uniform `scale` for a highlight that shouldn't skew.
// Returns a ready `.start(...)` argument.
export const jellySquash = (axis = "xy") => {
  const times = [0, .18, .42, .64, .84, 1];

  if (axis === "xy") {
    return {
      scaleX: [1, .74, 1.18, .93, 1.04, 1],
      scaleY: [1, 1.28, .84, 1.08, .97, 1],
      transition: { duration: .55, times, ease: EASE_IN_OUT },
    };
  }

  return {
    scale: [1, .82, 1.12, .96, 1.02, 1],
    transition: { duration: .5, times, ease: EASE_IN_OUT },
  };
};

// The soft elastic pool a pinned highlight settles into once left alone —
// useInkPulse's idle beat.
export const idlePool = {
  scale: [1, 1.14, .97, 1.03, 1],
  transition: { duration: .9, times: [0, .4, .68, .86, 1], ease: EASE_IN_OUT },
};

// The `hidden -> shown` stagger-parent pattern duplicated across Header's
// filterRowVariants and QuickDock's dockRowVariants — a labeled variants
// pair so a row of children can stagger in behind their own parent's own
// entrance, rather than each caller retyping the same two-key object.
export const enterExitStagger = (delayChildren = 0, staggerChildren = .05) => ({
  hidden: {},
  shown: { transition: { delayChildren, staggerChildren } },
});

// The staggered-row spring duplicated verbatim between CommandPalette's
// list items and ShortcutsSheet's rows (only the per-row step differed) —
// one shared spring plus a small delay helper so both read from the same
// place instead of hand-typing the same {stiffness:340, damping:20} pair.
export const LIST_ROW_SPRING = { type: "spring", stiffness: 340, damping: 20 };

export const listRowDelay = (index, { base = .05, step = .035 } = {}) => base + index * step;

// The "flip like a coin" icon changeover — rotateY through the coin's edge,
// a squeeze down through scale, and a fade — used for pen/eye, lock/open,
// theme, and sound-icon swaps across Note, NoteEditor, SettingsPanel, all
// with the same shape but each its own already-tuned spring (kept as a
// parameter rather than forced to match each other). What every one of
// them was actually missing wasn't a shared spring — it was a real exit;
// each had the same spring entrance paired with a flat `duration:.15-ish,
// ease:"easeIn"` fade on the way out. This gives the exit the entrance's
// own spring instead, so the flip reads as one continuous motion reversed,
// not a bounce in and a fade out.
export const coinFlip = (spring, { angle = 130 } = {}) => ({
  initial: { rotateY: -angle, scale: .3, opacity: 0 },
  animate: { rotateY: 0, scale: 1, opacity: 1 },
  exit: { rotateY: angle, scale: .3, opacity: 0, transition: spring },
  transition: spring,
});

// The flat, 2D sibling of coinFlip — a spin-swap (plain `rotate`, not
// `rotateY`) used for theme/persist/sound icon toggles across Header and
// SettingsPanel. Same story as coinFlip: each caller's spring already
// differs slightly and stays a parameter, what was missing everywhere was
// a real spring exit instead of a flat `duration:.15, ease:"easeIn"` fade.
export const iconSpin = (spring, { angle = 140 } = {}) => ({
  initial: { rotate: -angle, scale: 0, opacity: 0 },
  animate: { rotate: 0, scale: 1, opacity: 1 },
  exit: { rotate: angle, scale: 0, opacity: 0, transition: spring },
  transition: spring,
});

// A squash-collapse exit — the mirror of a squash-stretch entrance, so
// something that arrived with a jelly landing leaves with an echo of the
// same in reverse (flattening back toward wherever it grew from) instead of
// the flat linear fade nearly every panel/pill/card in the app defaulted to.
// Pass only the fields the matching entrance itself animated — opacity and
// a transition are the only two this ever supplies on its own.
export const squashCollapse = ({ transition = EXIT_SPRING, ...values }) => ({
  opacity: 0,
  ...values,
  transition,
});
