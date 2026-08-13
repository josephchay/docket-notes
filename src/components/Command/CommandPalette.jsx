import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useTransform } from "framer-motion";
import { interpret } from "xstate";
import { FaThumbtack, FaEyeSlash } from "react-icons/fa6";

import { commandMachine } from "./CommandState";
import useInkPulse from "../../hooks/useInkPulse";
import SheetPanel from "../Sheet/SheetPanel";
import { loadSettings, saveSettings } from "../../utils/storage";
import { LIST_ROW_SPRING, listRowDelay } from "../Motion";

import "./CommandPalette.css";

// The event the toolbar's wand fires to summon the palette from anywhere.
export const COMMAND_EVENT = "docket:command";

// How far a row has to travel before release counts as a real swipe
// rather than a tap that merely wandered — same distance-based intent
// check every drag-to-trigger gesture in this app already uses (the
// pull-strings' own PULL_THRESHOLD, MoveString's HOVER_PADDING). Pin and
// hide share one constraint window (±SWIPE_RANGE) rather than each
// picking its own, so the row's own travel reads as symmetric under the
// hand regardless of which way it's headed.
const SWIPE_THRESHOLD = 90;
const SWIPE_RANGE = 140;
// How much of framer's own reported release velocity (px/s) counts toward
// the pin/hide commit, alongside the plain offset the original check used
// alone — a real flick that barely travels past the threshold before
// release still commits, the same "offset isn't the whole story, momentum
// counts too" reasoning this session's other velocity-aware releases
// (ColorSelector's throw, useMagnetic's own exit fling) already apply,
// just fed here from a value framer already computes rather than a
// hand-rolled pointer-sample history.
const FLING_VELOCITY_WEIGHT = .12;

// How far the casting-gather effect (see CommandRow's own gather math
// below) still reaches from the row that actually fired, and how much
// each step out fades by — the rest of the list visibly yields to the one
// that just ran rather than sitting inert while it does.
const CAST_GATHER_REACH = 3;
const CAST_GATHER_DECAY = .35;

// A single swipeable row — its own component (rather than inline in the
// list below) purely so its drag motion values and the two live icon
// opacities derived from them (useTransform) get a fresh instance per
// row instead of one shared pair every row would otherwise fight over.
const CommandRow = ({ action, index, highlight, pulse, onSelect, onRun, onPin, onHide, renderLabel, casting, castIndex }) => {
  const dragX = useMotionValue(0);
  const pinOpacity = useTransform(dragX, [0, SWIPE_THRESHOLD], [0, 1], { clamp: true });
  const hideOpacity = useTransform(dragX, [0, -SWIPE_THRESHOLD], [0, 1], { clamp: true });

  const handleDragEnd = (e, info) => {
    // The release's own momentum, not just where it happened to land —
    // see FLING_VELOCITY_WEIGHT's own comment.
    const effective = info.offset.x + info.velocity.x * FLING_VELOCITY_WEIGHT;
    if (effective > SWIPE_THRESHOLD) onPin(action.key);
    else if (effective < -SWIPE_THRESHOLD) onHide(action.key);
  };

  // The rest of the list's own brief acknowledgment that one row just
  // fired (see the casting-gather comment on run() below) — a small
  // vertical nudge toward whichever row actually cast, decaying with
  // distance and capped at CAST_GATHER_REACH, plus a slight recede in
  // scale/opacity so the eye reads the cast row as the one thing that
  // still has full weight. translateY rather than translateX so this
  // never reads as the same axis the swipe gesture above already owns.
  const isCastTarget = casting && index === castIndex;
  const castDistance = casting && castIndex != null ? Math.abs(index - castIndex) : Infinity;
  const gather = !isCastTarget && castDistance <= CAST_GATHER_REACH
    ? Math.max(0, 1 - castDistance * CAST_GATHER_DECAY)
    : 0;

  const slotAnimate = casting
    ? {
      opacity: isCastTarget ? 1 : 1 - gather * .5,
      translateY: isCastTarget ? 0 : Math.sign(castIndex - index) * 4 * gather,
      scale: isCastTarget ? 1.03 : 1 - gather * .06,
    }
    : { opacity: 1, translateX: 0, translateY: 0, scale: 1 };

  return (
    // command-row-slot is the static backing every row's own drag reveals
    // rather than travels with — layout, exit, and delay all live here
    // (not on the button below) so AnimatePresence's own popLayout still
    // sees one coherent list item per action, sliding/reflowing as a
    // whole; the button inside is free to carry its OWN independent x
    // without that fighting the slot's layout animation for the same
    // transform.
    <motion.div
      layout
      className="command-row-slot"
      initial={{ opacity: 0, translateX: -16 }}
      animate={ slotAnimate }
      exit={{ opacity: 0, translateX: -16, scale: .96, transition: { duration: .16, ease: "easeIn" } }}
      transition={
        casting
          ? { type: "spring", stiffness: 500, damping: 30 }
          : { ...LIST_ROW_SPRING, delay: listRowDelay(index) }
      }
    >
      {/* The swipe's own live hint — pin to the right, hide to the left —
          fixed here in the static backing rather than inside the button
          that actually carries dragX, so the row sliding away is what
          reveals them rather than the row dragging them along with it.
          Purely opacity-driven off the same dragX the row's own x
          already rides, so they track the gesture with zero lag. */}
      <motion.span className="command-item-hint-pin" style={{ opacity: pinOpacity }} aria-hidden="true">
        <FaThumbtack />
      </motion.span>
      <motion.span className="command-item-hint-hide" style={{ opacity: hideOpacity }} aria-hidden="true">
        <FaEyeSlash />
      </motion.span>
      <motion.button
        type="button"
        className={ `command-item ${ index === highlight ? "selected" : "" }` }
        style={{ x: dragX }}
        drag="x"
        dragConstraints={{ left: -SWIPE_RANGE, right: SWIPE_RANGE }}
        dragElastic={ 0.6 }
        dragSnapToOrigin
        onDragEnd={ handleDragEnd }
        onMouseEnter={ onSelect }
        onTapStart={ pulse.squash }
        onClick={ onRun }
      >
        {
          index === highlight && (
            <motion.span
              layoutId="commandThumb"
              style={{ position: "absolute", inset: 0, borderRadius: 12 }}
              transition={{ type: "spring", stiffness: 520, damping: 20 }}
            >
              <motion.span
                className="command-thumb"
                animate={ pulse.jelly }
                style={{ borderRadius: "inherit" }}
              />
            </motion.span>
          )
        }
        <span className="command-item-icon">{ action.icon }</span>
        <span className="command-item-label">{ renderLabel(action.label) }</span>
        {
          action.hint && (
            <kbd className="command-item-hint">{ action.hint }</kbd>
          )
        }
      </motion.button>
    </motion.div>
  );
};

// A command palette for the desk, run by its own xstate machine. Ctrl/Cmd+K
// (or the toolbar wand) summons it: the panel morphs up out of a drop —
// tiny, round, and starchy — into a full sheet of paper. Typing filters the
// commands, the selection thumb slides stickily between rows, and casting a
// command squashes the panel like pressed jelly before it folds away.
const CommandPalette = ({ actions, reduceMotion }) => {
  const [service] = useState(() => interpret(commandMachine));
  const [phase, setPhase] = useState("closed");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  // Which row actually fired, for the casting-gather effect (see
  // CommandRow's own gather math and run() below) — stale outside the
  // brief casting window is harmless since every row only ever reads it
  // gated on phase === "casting".
  const [castIndex, setCastIndex] = useState(null);

  // Which commands have been swiped pinned or hidden (see CommandRow's own
  // onPin/onHide below) — routed through the exact same loadSettings/
  // saveSettings pair the theme preference already uses, rather than a
  // dedicated storage key of its own, so this automatically respects the
  // same session-vs-local persist toggle every other stored preference in
  // the app already answers to.
  const [pinned, setPinned] = useState(() => loadSettings().pinnedCommands || []);
  const [hidden, setHidden] = useState(() => loadSettings().hiddenCommands || []);

  const pinAction = (key) => {
    setPinned((prev) => {
      const next = [key, ...prev.filter((k) => k !== key)];
      saveSettings({ pinnedCommands: next });
      return next;
    });
    // A pin only ever means something once it isn't also hidden.
    setHidden((prev) => {
      if (!prev.includes(key)) return prev;
      const next = prev.filter((k) => k !== key);
      saveSettings({ hiddenCommands: next });
      return next;
    });
  };

  const hideAction = (key) => {
    setHidden((prev) => {
      if (prev.includes(key)) return prev;
      const next = [...prev, key];
      saveSettings({ hiddenCommands: next });
      return next;
    });
  };

  const restoreHidden = () => {
    setHidden([]);
    saveSettings({ hiddenCommands: [] });
  };

  const open = phase !== "closed";

  useEffect(() => {
    service
      .onTransition((state) => setPhase(String(state.value)))
      .start();

    return () => service.stop();
  }, [service]);

  useEffect(() => {
    const handleKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        service.send("TOGGLE");
      } else if (e.key === "Escape") {
        service.send("CLOSE");
      }
    };
    const handleSummon = () => service.send("OPEN");

    window.addEventListener("keydown", handleKey);
    window.addEventListener(COMMAND_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(COMMAND_EVENT, handleSummon);
    };
  }, [service]);

  // A fresh sheet every time it opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
    }
  }, [open]);

  const trimmedQuery = query.trim();

  // How well a label matches the current query, once it's already cleared
  // the plain substring filter below — earlier in the label ranks higher,
  // and matching right at a word boundary ("Focus sprint" for "sprint")
  // ranks higher still than the same substring landing mid-word, the same
  // relevance a real fuzzy-finder rewards. Purely a SORT signal, not a
  // second filter — the substring test below stays the only thing that
  // decides whether a row appears at all, so renderLabel's own contiguous
  // <mark> highlight (built on that same indexOf) never has to reconcile
  // with a looser, non-contiguous match.
  const scoreMatch = (label, q) => {
    const lower = label.toLowerCase();
    const idx = lower.indexOf(q);
    if (idx === -1) return -Infinity;
    const wordBoundary = idx === 0 || /\s/.test(label[idx - 1]);
    return (wordBoundary ? 100 : 0) - idx;
  };

  // Hidden commands drop out entirely; pinned ones float to the top, in
  // the order they were pinned (most recent pin first — see pinAction's
  // own [key, ...prev] unshift). Among the rest, an active query actively
  // re-ranks by real relevance (scoreMatch above) rather than sitting in
  // whatever order `actions` happened to declare them — command-row-slot's
  // own `layout` prop (plus the list's popLayout AnimatePresence) is what
  // turns that re-rank into rows physically springing into their new
  // positions as you type, not just an instant re-sort.
  const lowerQuery = trimmedQuery.toLowerCase();
  const filtered = actions
    .filter((action) => !hidden.includes(action.key))
    .filter((action) => action.label.toLowerCase().includes(lowerQuery))
    .sort((a, b) => {
      const pa = pinned.indexOf(a.key);
      const pb = pinned.indexOf(b.key);
      if (pa === -1 && pb === -1) {
        if (!trimmedQuery) return 0;
        return scoreMatch(b.label, lowerQuery) - scoreMatch(a.label, lowerQuery);
      }
      if (pa === -1) return 1;
      if (pb === -1) return -1;
      return pa - pb;
    });

  // Marks the matched stretch of a label with a little pop of ink, instead
  // of leaving the visitor to guess why a row surfaced.
  const renderLabel = (label) => {
    if (!trimmedQuery) return label;

    const start = label.toLowerCase().indexOf(trimmedQuery.toLowerCase());
    if (start === -1) return label;

    const end = start + trimmedQuery.length;

    return (
      <>
        { label.slice(0, start) }
        <motion.mark
          key={ trimmedQuery }
          initial={{ opacity: 0, scale: .5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 20 }}
        >
          { label.slice(start, end) }
        </motion.mark>
        { label.slice(end) }
      </>
    );
  };

  const run = (action) => {
    if (phase !== "open") return;
    // Looked up fresh rather than trusting `highlight` — a click can land
    // on a row that was never hovered (touch, or a fast move straight to
    // the target), so `highlight` isn't guaranteed to already agree with
    // whichever row is actually casting.
    const index = filtered.findIndex((a) => a.key === action.key);
    setCastIndex(index === -1 ? null : index);
    action.perform();
    service.send("RUN");
  };

  const handleListKeys = (e) => {
    if (filtered.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => (s + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => (s - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter" && filtered[Math.min(selected, filtered.length - 1)]) {
      run(filtered[Math.min(selected, filtered.length - 1)]);
    }
  };

  const highlight = Math.min(selected, Math.max(filtered.length - 1, 0));
  const commandPulse = useInkPulse(highlight);

  const panelRef = useRef(null);

  // The backdrop's own slow boil (see the SVG filter in the JSX below) —
  // the same feTurbulence/feDisplacementMap "re-roll the seed a few times
  // a second" trick the tour's own SketchRing uses to keep a still line
  // reading as freshly sketched, applied here to an ambient radial wash
  // instead of a stroked path. Only runs while the palette is actually
  // open, and not at all under reduced motion.
  const backdropTurbRef = useRef(null);
  useEffect(() => {
    if (!open || reduceMotion) return undefined;

    const interval = setInterval(() => {
      backdropTurbRef.current?.setAttribute("seed", String((Math.random() * 100) | 0));
    }, 220);
    return () => clearInterval(interval);
  }, [open, reduceMotion]);

  // Casting a command still gets its own quick squash pulse rather than the
  // shared entrance shape — a distinct micro-interaction (confirming a cast
  // landed), not a second way to open the palette. Command is the one
  // SheetPanel caller whose `animate` target actually flips back and forth
  // while mounted (casting <-> open), so — unlike the other six, which
  // never re-target `animate` at all and can safely leave this undefined
  // to fall through to SheetPanel's own keyframe entrance — this always
  // passes an explicit override, even for the "settled" case. Falling
  // through here would mean flipping *back* to SheetPanel's default after
  // a cast retriggers its entrance keyframes (which start at scaleX/scaleY
  // .08) from the current ~1, visibly shrinking the panel to 8% and
  // reblooming it on every single cast — a real bug, not a style choice.
  const panelAnimate = phase === "casting" ? {
    opacity: 1,
    scale: [1, .93, 1.04],
    translateY: 0,
    borderRadius: 24,
    transition: { duration: .24, times: [0, .5, 1], ease: "easeInOut" },
  } : {
    opacity: 1,
    scaleX: 1,
    scaleY: 1,
    translateY: 0,
    rotateX: 0,
    borderRadius: 18,
    transition: { type: "spring", stiffness: 200, damping: 13.5 },
  };

  return (
    <>
      {/* The backdrop boil's own filter def — a hidden 0x0 SVG rather than
          inline styles, since CSS `filter: url(#id)` needs a real <filter>
          element to reference somewhere in the document, the same setup
          SketchRing.jsx uses for its own boiling line. */}
      {
        !reduceMotion && (
          <svg style={{ position: "absolute", width: 0, height: 0 }} aria-hidden="true">
            <defs>
              <filter id="command-backdrop-boil" x="-20%" y="-20%" width="140%" height="140%">
                <feTurbulence
                  ref={ backdropTurbRef }
                  type="fractalNoise"
                  baseFrequency="0.012"
                  numOctaves="2"
                  seed="1"
                  result="noise"
                />
                <feDisplacementMap in="SourceGraphic" in2="noise" scale="10" />
              </filter>
            </defs>
          </svg>
        )
      }
      <SheetPanel
        open={ open }
        onClose={ () => service.send("CLOSE") }
        panelRef={ panelRef }
        radius={ 18 }
        layerClassName="command-layer"
        backdropClassName={ `command-backdrop ${ reduceMotion ? "" : "command-backdrop-boil" }` }
        panelClassName="command-panel"
        ariaLabel="Command palette"
        animate={ panelAnimate }
        // The search input has its own autoFocus below (so typing works the
        // instant the palette opens, core to a command palette's whole
        // point) — SheetPanel's usual focus-the-panel-root step would just
        // steal that back a frame later.
        focusOnOpen={ false }
      >
      <input
        autoFocus
        type="text"
        className="command-input"
        placeholder="Cast a command…"
        value={ query }
        onChange={ (e) => { setQuery(e.target.value); setSelected(0); } }
        onKeyDown={ handleListKeys }
      />
      <div className="command-list custom-scroll">
        {/* mode="popLayout" pulls a filtered-out row out of document flow the
            instant it starts exiting, so the rows below it can immediately
            reflow up into its place while it fades out on top — a real
            leave transition instead of narrowing the query just snapping
            rows away. */}
        <AnimatePresence mode="popLayout" initial={ false }>
          {
            filtered.map((action, index) => (
              <CommandRow
                key={ action.key }
                action={ action }
                index={ index }
                highlight={ highlight }
                pulse={ commandPulse }
                onSelect={ () => setSelected(index) }
                onRun={ () => run(action) }
                onPin={ pinAction }
                onHide={ hideAction }
                renderLabel={ renderLabel }
                casting={ phase === "casting" }
                castIndex={ castIndex }
              />
            ))
          }
        </AnimatePresence>
        {
          filtered.length === 0 && (
            <motion.p
              className="command-empty"
              initial={{ opacity: 0, scale: .8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 18 }}
            >
              Nothing casts like that
            </motion.p>
          )
        }
      </div>
      <div className="command-footer">
        <span>↑↓ choose · Enter cast · Esc fold · drag a row to pin/hide it</span>
        {
          hidden.length > 0 && (
            <button type="button" className="command-restore" onClick={ restoreHidden }>
              Restore { hidden.length } hidden
            </button>
          )
        }
      </div>
      </SheetPanel>
    </>
  );
}

export default CommandPalette;
