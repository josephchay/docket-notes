import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, Reorder, useDragControls, useMotionValue, useTransform } from "framer-motion";
import { interpret } from "xstate";
import { FaThumbtack, FaEyeSlash, FaGripLinesVertical } from "react-icons/fa6";

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
// that just ran rather than sitting inert while it does. Still governs the
// opacity/scale recede (a cheap, static falloff is fine for that); the
// actual MOTION is the real chain below.
const CAST_GATHER_REACH = 3;
const CAST_GATHER_DECAY = .35;

// The cast's own nudge used to be a static, pre-shaped falloff — every row
// within reach started easing toward its final offset in the same instant,
// just by different amounts. This replaces that with a genuine damped
// chain: the row that actually fired gets a real velocity kick, and every
// other row only starts moving once its NEIGHBOR'S displacement pulls it
// along, frame by frame — the same discretized-second-order-ODE family
// utils/waveField.js's own 2D membrane and every critically-damped spring
// elsewhere in this app already integrate (accel = coupling + restoring −
// damping·v), just a 1D chain of list rows rather than a grid of height
// samples or a single isolated point. A real disturbance TRAVELS down the
// list and rings, instead of every row within reach flinching at once.
const CHAIN_KICK = 150; // px/s — the cast row's own initial velocity
const CHAIN_SELF_K = 170; // 1/s² — pulls each row back toward its own rest
const CHAIN_COUPLE_K = 55; // 1/s² — how hard each row pulls its immediate neighbors along
const CHAIN_DAMPING = 11; // 1/s

// The reverse-stagger drain (see the 'closing' xstate state in
// CommandState.js) — capped at CLOSE_STAGGER_MAX rows out regardless of
// how long the actual filtered list is, so a long list still closes
// promptly instead of the tail end waiting through a proportionally longer
// stagger.
const CLOSE_STAGGER_STEP = .022;
const CLOSE_STAGGER_MAX = 4;

// A single swipeable row — its own component (rather than inline in the
// list below) purely so its drag motion values and the two live icon
// opacities derived from them (useTransform) get a fresh instance per
// row instead of one shared pair every row would otherwise fight over.
// `reorderable` rows (the pinned block, see the split below) render as a
// Reorder.Item instead of a plain motion.div, dragged only from their own
// grip handle (dragListener={false} + a manually-started dragControls) so
// the grip's vertical drag never fights the row's own horizontal
// swipe-to-pin/hide, or the row's plain click-to-run.
const CommandRow = ({
  action, index, highlight, pulse, onSelect, onRun, onPin, onHide, renderLabel,
  casting, castIndex, closing, closeDelay, reduceMotion, reorderable, registerRipple,
}) => {
  const dragX = useMotionValue(0);
  const pinOpacity = useTransform(dragX, [0, SWIPE_THRESHOLD], [0, 1], { clamp: true });
  const hideOpacity = useTransform(dragX, [0, -SWIPE_THRESHOLD], [0, 1], { clamp: true });
  const dragControls = useDragControls();

  const handleDragEnd = (e, info) => {
    // The release's own momentum, not just where it happened to land —
    // see FLING_VELOCITY_WEIGHT's own comment.
    const effective = info.offset.x + info.velocity.x * FLING_VELOCITY_WEIGHT;
    if (effective > SWIPE_THRESHOLD) onPin(action.key);
    else if (effective < -SWIPE_THRESHOLD) onHide(action.key);
  };

  // The rest of the list's own brief acknowledgment that one row just
  // fired — a slight recede in scale/opacity so the eye reads the cast row
  // as the one thing that still has full weight. Just a cheap static
  // falloff by distance (unlike the real per-frame chain the parent now
  // drives for the actual MOTION — see registerRipple/the ripple effect in
  // CommandPalette below), since a subtle dim doesn't need to travel.
  const isCastTarget = casting && index === castIndex;
  const castDistance = casting && castIndex != null ? Math.abs(index - castIndex) : Infinity;
  const gather = !isCastTarget && castDistance <= CAST_GATHER_REACH
    ? Math.max(0, 1 - castDistance * CAST_GATHER_DECAY)
    : 0;

  const slotAnimate = casting
    ? { opacity: isCastTarget ? 1 : 1 - gather * .5, scale: isCastTarget ? 1.03 : 1 - gather * .06 }
    // 'closing' plays the same shape the old plain exit used, just staggered
    // in reverse (see closeDelay) and via `animate` rather than `exit` —
    // the row isn't actually leaving `filtered` yet, only the panel around
    // it is about to fold, so AnimatePresence's own exit never fires here.
    : closing
      ? { opacity: 0, translateX: -16, scale: .96 }
      : { opacity: 1, translateX: 0, scale: 1 };

  const slotTransition = casting
    ? { type: "spring", stiffness: 500, damping: 30 }
    : closing
      ? (reduceMotion ? { duration: 0 } : { duration: .22, ease: "easeIn", delay: closeDelay })
      : { ...LIST_ROW_SPRING, delay: listRowDelay(index) };

  // Reorder.Item in place of the plain motion.div for pinned rows only —
  // it takes the exact same layout/initial/animate/exit/transition props,
  // so swapping which one renders costs nothing else in this component.
  const RowRoot = reorderable ? Reorder.Item : motion.div;
  const rootProps = reorderable ? { value: action.key, dragListener: false, dragControls } : {};

  return (
    // command-row-slot is the static backing every row's own drag reveals
    // rather than travels with — layout, exit, and delay all live here
    // (not on the button below) so AnimatePresence's own popLayout still
    // sees one coherent list item per action, sliding/reflowing as a
    // whole; the button inside is free to carry its OWN independent x
    // without that fighting the slot's layout animation for the same
    // transform.
    <RowRoot
      layout
      className="command-row-slot"
      initial={{ opacity: 0, translateX: -16 }}
      animate={ slotAnimate }
      exit={{ opacity: 0, translateX: -16, scale: .96, transition: { duration: .16, ease: "easeIn" } }}
      transition={ slotTransition }
      { ...rootProps }
    >
      {
        reorderable && (
          <span
            className="command-row-grip"
            role="presentation"
            style={{ touchAction: "none" }}
            onPointerDown={ (e) => dragControls.start(e) }
          >
            <FaGripLinesVertical />
          </span>
        )
      }
      {/* The real per-frame ripple (see CommandPalette's own casting
          effect) writes translateY straight to this inner wrapper's style
          every frame — kept on its own element, separate from this slot's
          own framer-driven opacity/scale/layout above, so the two never
          fight over the same transform. */}
      <div className="command-row-ripple" ref={ registerRipple }>
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
      </div>
    </RowRoot>
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
  // of leaving the visitor to guess why a row surfaced. `.liquid-text`
  // (LiquidTextFilter.jsx, mounted once near Home's root — the same shared
  // #liquid-text filter ShortcutsSheet/NoteConstellation's own headings
  // already wear) gives just that matched stretch a living, never-quite-
  // still wobble, distinct from the rest of the label, which stays flat and
  // legible for actually scanning the list.
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
          className={ reduceMotion ? "" : "liquid-text" }
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

  const closing = phase === "closing";

  // The pinned block renders inside its own Reorder.Group (drag-to-reorder
  // via CommandRow's own grip handle) whenever there's no active query —
  // `filtered`'s own sort already puts pinned rows first, so this is a
  // straight split of an already-ordered array, not a second re-sort of
  // its own. Search deliberately skips the split: re-ranking a filtered,
  // temporary view by hand wouldn't mean anything once the query clears.
  const pinnedFiltered = trimmedQuery ? [] : filtered.filter((action) => pinned.includes(action.key));
  const restFiltered = trimmedQuery ? filtered : filtered.filter((action) => !pinned.includes(action.key));

  const handlePinnedReorder = (nextKeys) => {
    setPinned(nextKeys);
    saveSettings({ pinnedCommands: nextKeys });
  };

  const highlight = Math.min(selected, Math.max(filtered.length - 1, 0));
  const commandPulse = useInkPulse(highlight);

  const panelRef = useRef(null);

  // The cast ripple's own live state — a plain ref rather than React state,
  // since it's advanced and read every animation frame (see the effect
  // below); rowRefs hands that loop a direct DOM node per row to write
  // translateY onto, the same refs-map-plus-imperative-rAF pattern
  // TagThreads.jsx's own thread ring-down and NotePile's per-tick body sync
  // already use.
  const rowRefs = useRef({});
  const registerRow = (key, el) => {
    if (el) rowRefs.current[key] = el; else delete rowRefs.current[key];
  };
  const chainRef = useRef({});

  // The cast's own real ripple — see CHAIN_KICK/CHAIN_SELF_K/CHAIN_COUPLE_K/
  // CHAIN_DAMPING's own comment for the physics. Keyed on the casting phase
  // itself (not on `filtered`, which mustn't retrigger this mid-ring), so
  // it starts fresh exactly once per cast and runs for the same ~260ms
  // window the panel's own squash already budgets. Free (Neumann) ends —
  // the first/last row simply has one fewer neighbor to couple with, not a
  // wall it bounces off — since the list doesn't have solid edges the way
  // TrashPhysics' own floor/walls do.
  useEffect(() => {
    if (phase !== "casting" || reduceMotion) return undefined;

    const order = filtered.map((action) => action.key);
    chainRef.current = {};
    order.forEach((key) => { chainRef.current[key] = { y: 0, v: 0 }; });

    const castKey = castIndex != null ? order[castIndex] : null;
    if (castKey && chainRef.current[castKey]) chainRef.current[castKey].v = CHAIN_KICK;

    let last = performance.now();
    let raf;

    const tick = (now) => {
      const dt = Math.min(.032, (now - last) / 1000);
      last = now;

      const ys = order.map((key) => chainRef.current[key]?.y || 0);

      order.forEach((key, i) => {
        const state = chainRef.current[key];
        if (!state) return;

        const left = i > 0 ? ys[i - 1] : state.y;
        const right = i < ys.length - 1 ? ys[i + 1] : state.y;
        const coupling = CHAIN_COUPLE_K * (left + right - 2 * state.y);
        const accel = coupling - CHAIN_SELF_K * state.y - CHAIN_DAMPING * state.v;
        state.v += accel * dt;
        state.y += state.v * dt;

        const el = rowRefs.current[key];
        if (el) el.style.transform = state.y ? `translateY(${ state.y.toFixed(2) }px)` : "";
      });

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      order.forEach((key) => {
        const el = rowRefs.current[key];
        if (el) el.style.transform = "";
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, castIndex, reduceMotion]);

  const renderRow = (action, index, reorderable) => (
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
      closing={ closing }
      closeDelay={ Math.min(filtered.length - 1 - index, CLOSE_STAGGER_MAX) * CLOSE_STAGGER_STEP }
      reduceMotion={ reduceMotion }
      reorderable={ reorderable }
      registerRipple={ (el) => registerRow(action.key, el) }
    />
  );

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
            rows away. Search renders the one flat list exactly as before;
            browsing (no query) splits off the pinned prefix into its own
            Reorder.Group so it can be dragged into a new order (see
            handlePinnedReorder) without touching the rest of the list. */}
        {
          trimmedQuery ? (
            <AnimatePresence mode="popLayout" initial={ false }>
              { filtered.map((action, index) => renderRow(action, index, false)) }
            </AnimatePresence>
          ) : (
            <>
              {
                pinnedFiltered.length > 0 && (
                  <Reorder.Group
                    as="div"
                    axis="y"
                    className="command-pinned-group"
                    values={ pinnedFiltered.map((action) => action.key) }
                    onReorder={ handlePinnedReorder }
                  >
                    <AnimatePresence mode="popLayout" initial={ false }>
                      {
                        // Always reorderable, even with only one pinned row —
                        // dragging a lone item is a harmless no-op, and it
                        // keeps this row's rendered component type stable
                        // (Reorder.Item, not a conditional swap back to a
                        // plain motion.div) as the pinned count crosses 1↔2,
                        // so it never has to remount mid-list.
                        pinnedFiltered.map((action, index) => renderRow(action, index, true))
                      }
                    </AnimatePresence>
                  </Reorder.Group>
                )
              }
              <AnimatePresence mode="popLayout" initial={ false }>
                {
                  restFiltered.map((action, i) =>
                    renderRow(action, pinnedFiltered.length + i, false))
                }
              </AnimatePresence>
            </>
          )
        }
        {
          filtered.length === 0 && (
            <motion.p
              className="command-empty"
              initial={{ opacity: 0, scale: .8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 18 }}
            >
              <span className={ reduceMotion ? "" : "liquid-text" }>Nothing casts like that</span>
            </motion.p>
          )
        }
      </div>
      <div className="command-footer">
        <span>↑↓ choose · Enter cast · Esc fold · drag a row to pin/hide it · grip a pin to reorder it</span>
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
