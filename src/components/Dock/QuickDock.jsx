import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, Reorder } from "framer-motion";
import gsap from "gsap";
import {
  FaPlus,
  FaShuffle,
  FaExpand,
  FaCompress,
  FaWandMagicSparkles,
  FaHourglassHalf,
  FaCircleNodes,
  FaMoon,
  FaSun,
  FaEllipsis,
} from "react-icons/fa6";

import { NOTE_COLORS } from "../../constants/colors";
import { COMMAND_EVENT } from "../Command/CommandPalette";
import { SPRINT_EVENT } from "../Sprint/SprintPanel";
import { NOTE_CONSTELLATION_EVENT } from "../Constellation/NoteConstellationPanel";
import { loadSettings, saveSettings } from "../../utils/storage";
import useInkPulse from "../../hooks/useInkPulse";
import useMagnetic from "../../hooks/useMagnetic";
import { iconSpin } from "../Motion";

import "./QuickDock.css";

// The dock items land with their own bouncy stagger once the dock itself
// has sprung into place, rather than all popping in as one rigid block —
// the same recipe Header's color-filter row and BulkActionBar's action row
// already use.
const dockRowVariants = {
  hidden: {},
  shown: {
    transition: { delayChildren: .3, staggerChildren: .05 },
  },
};

const dockItemVariants = {
  hidden: { opacity: 0, scale: 0, translateY: 14 },
  shown: {
    opacity: 1,
    scale: 1,
    translateY: 0,
    transition: { type: "spring", stiffness: 420, damping: 14 },
  },
};

// The fixed set of things this dock can run — stable regardless of what
// order the visitor has dragged them into (see the order state below),
// since a drag only ever reshuffles this list, never adds to or removes
// from it.
const ITEM_KEYS = ["new", "shuffle", "constellation", "focus", "sprint", "command", "theme"];

// How far an action's own impact (see runItem/the impact-listener effect
// below) still reaches into the row on either side, and by how much it
// fades per step out.
const IMPACT_REACH = 2;
const IMPACT_DECAY = .28;

// How long a stationary press on an item takes to shelve it (see the hold
// handlers below) — long enough that an ordinary tap or the start of a
// real reorder drag never brushes past it, short enough to still read as
// deliberate rather than sluggish.
const HOLD_MS = 550;
const HOLD_MOVE_CANCEL_PX = 6;

// A floating dock of the desk's most-reached-for actions, magnetized the
// way a real dock is (see useMagnetic.jsx for the shared recipe — Header's
// toolbar icons borrow the same one, including its own velocity-aware
// release now). The highlight is properly gooey now rather than just a
// sliding pill: a slow-chasing "trail" blob and a fast-snapping "core" blob
// share the same layoutId-driven target (whichever icon has the pointer)
// but ride different spring speeds, so mid-travel the core arrives first
// and the trail is still catching up a few pixels behind it — the same
// shared #gooey-effect filter (see Svg/GooeyEffectSvg, mounted once near
// Home's root) every other merging blob in the app already uses fuses the
// two overlapping, offset shapes into one stretched drip instead of two
// crisp rounded rects. The trail's own inner fill (not the layoutId shell
// itself — see the stretch effect below) now also smears along whatever
// direction the highlight is actually traveling, proportional to how far
// the jump was, so a fast sweep across several icons reads as the ink
// dragging between them rather than two blobs quietly re-targeting.
const QuickDock = ({
  addNote,
  shuffleNotes,
  focusMode,
  toggleFocusMode,
  theme,
  toggleTheme,
  reduceMotion,
}) => {
  const dockRef = useRef(null);
  const [hovered, setHovered] = useState(null);
  const dockPulse = useInkPulse(hovered);
  const magnetic = useMagnetic({ range: 96, maxLift: 16, maxScale: 1.55, axis: "x", tilt: true, maxTilt: 7, reduceMotion });

  // Drag-to-reorder (see the Reorder.Group/Reorder.Item below) — persisted
  // through the exact same loadSettings/saveSettings pair CommandPalette's
  // own pin/hide already uses, rather than a bespoke storage key, so it
  // rides the same session-vs-local persist toggle every other stored
  // preference already answers to. Any key missing from a stale stored
  // order (an older save from before an item existed) is appended at the
  // end rather than dropped.
  const [order, setOrder] = useState(() => {
    const stored = loadSettings();
    const hiddenStored = Array.isArray(stored.dockHidden) ? stored.dockHidden.filter((key) => ITEM_KEYS.includes(key)) : [];
    const valid = Array.isArray(stored.dockOrder)
      ? stored.dockOrder.filter((key) => ITEM_KEYS.includes(key) && !hiddenStored.includes(key))
      : [];
    const missing = ITEM_KEYS.filter((key) => !valid.includes(key) && !hiddenStored.includes(key));
    return [...valid, ...missing];
  });

  // Shelved items — see the long-press handlers below. Kept as a fully
  // separate array (not filtered out of `order` at render time) so
  // Reorder.Group's own `values` prop always matches its rendered
  // children 1:1, the invariant framer's Reorder expects.
  const [hidden, setHidden] = useState(() => {
    const stored = loadSettings().dockHidden;
    return Array.isArray(stored) ? stored.filter((key) => ITEM_KEYS.includes(key)) : [];
  });
  const [shelfOpen, setShelfOpen] = useState(false);

  const handleReorder = (nextOrder) => {
    setOrder(nextOrder);
    saveSettings({ dockOrder: nextOrder, dockHidden: hidden });
  };

  // Long-press (not drag) to shelve an item out of the row entirely —
  // dragging already means "reorder," so this deliberately keys off a
  // stationary hold instead, the same threshold-timer idiom the History
  // round's own touch-peek used, just universal here (mouse or touch)
  // rather than touch-only. `justShelved` swallows the click that still
  // follows the eventual pointerup even though the item's already gone by
  // then, since AnimatePresence keeps it mounted for its own exit tween.
  const holdRef = useRef({ key: null, timer: null, justShelved: false, startX: 0, startY: 0 });

  const clearHold = () => {
    clearTimeout(holdRef.current.timer);
    holdRef.current.timer = null;
  };

  const shelveItem = (key) => {
    const nextOrder = order.filter((k) => k !== key);
    const nextHidden = [...hidden, key];
    setOrder(nextOrder);
    setHidden(nextHidden);
    setHovered((prev) => (order[prev] === key ? null : prev));
    saveSettings({ dockOrder: nextOrder, dockHidden: nextHidden });
  };

  const restoreItem = (key) => {
    const nextHidden = hidden.filter((k) => k !== key);
    const nextOrder = [...order, key];
    setHidden(nextHidden);
    setOrder(nextOrder);
    saveSettings({ dockOrder: nextOrder, dockHidden: nextHidden });
    if (nextHidden.length === 0) setShelfOpen(false);
  };

  const handleItemPointerDown = (item, e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    holdRef.current.key = item.key;
    holdRef.current.startX = e.clientX;
    holdRef.current.startY = e.clientY;
    clearTimeout(holdRef.current.timer);
    holdRef.current.timer = setTimeout(() => {
      holdRef.current.justShelved = true;
      shelveItem(item.key);
    }, HOLD_MS);
  };

  const handleItemPointerMove = (e) => {
    if (!holdRef.current.timer) return;
    const dx = e.clientX - holdRef.current.startX;
    const dy = e.clientY - holdRef.current.startY;
    // Real movement past a small threshold means this is becoming a
    // reorder drag instead — let go of the shelve timer and hand off to
    // Reorder's own gesture (also cancelled authoritatively via
    // onDragStart below, this is just the fast local guard).
    if (Math.hypot(dx, dy) > HOLD_MOVE_CANCEL_PX) clearHold();
  };

  const handleItemClick = (item, index) => {
    if (holdRef.current.justShelved && holdRef.current.key === item.key) {
      holdRef.current.justShelved = false;
      return;
    }
    runItem(item, index);
  };

  // The reorder drag's own settle — a real squash-stretch landing (the
  // same beat Note.jsx's own spawn "landing jelly" already gives a poured
  // note, applied here to a dropped dock icon instead) rather than
  // framer's own reorder spring being the only thing you feel. Reuses
  // impactRefs as its transform host — the dedicated layer already split
  // out from icon-wrap specifically so a recoil tween here never fights
  // magnetic's own continuous quickTo scale/y/rotateZ.
  const handleItemDragStart = () => clearHold();

  const handleItemDragEnd = (index) => {
    clearHold();
    if (reduceMotion) return;
    const el = impactRefs.current[index];
    if (!el) return;

    gsap.killTweensOf(el);
    gsap.timeline()
      .to(el, { scaleY: .7, scaleX: 1.18, y: 3, duration: .09, ease: "power2.out" })
      .to(el, { scaleY: 1, scaleX: 1, y: 0, duration: .55, ease: "elastic.out(1, .5)" });
  };

  useEffect(() => () => clearHold(), []);

  const handleThemeToggle = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    toggleTheme?.({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  };

  const itemsByKey = {
    new: {
      key: "new",
      label: "Pour a new note",
      icon: <FaPlus />,
      onRun: () => {
        const palette = Object.keys(NOTE_COLORS);
        addNote?.(palette[Math.floor(Math.random() * palette.length)]);
      },
    },
    shuffle: { key: "shuffle", label: "Shuffle the desk", icon: <FaShuffle />, onRun: () => shuffleNotes?.() },
    constellation: {
      key: "constellation",
      label: "Map your notes",
      icon: <FaCircleNodes />,
      onRun: () => window.dispatchEvent(new CustomEvent(NOTE_CONSTELLATION_EVENT)),
    },
    focus: {
      key: "focus",
      label: focusMode ? "Exit focus mode" : "Enter focus mode",
      icon: focusMode ? <FaCompress /> : <FaExpand />,
      iconKey: focusMode ? "compress" : "expand",
      onRun: () => toggleFocusMode?.(),
    },
    sprint: {
      key: "sprint",
      label: "Focus sprint",
      icon: <FaHourglassHalf />,
      onRun: () => window.dispatchEvent(new CustomEvent(SPRINT_EVENT)),
    },
    command: {
      key: "command",
      label: "Command ink",
      icon: <FaWandMagicSparkles />,
      onRun: () => window.dispatchEvent(new CustomEvent(COMMAND_EVENT)),
    },
    theme: {
      key: "theme",
      label: theme === "dark" ? "Switch to fresh paper" : "Switch to Ink",
      icon: theme === "dark" ? <FaSun /> : <FaMoon />,
      iconKey: theme,
      onRun: handleThemeToggle,
    },
  };

  const orderedItems = order.map((key) => itemsByKey[key]).filter(Boolean);

  // Positions of every dock button's own outer element — kept separate
  // from magnetic's own itemRefs (which track the inner icon-wrap, not the
  // button) purely to measure travel distance for the stretch effect below.
  const itemBoxRefs = useRef([]);
  const impactRefs = useRef([]);
  const itemCountRef = useRef(orderedItems.length);
  itemCountRef.current = orderedItems.length;

  // The trail blob's own inner fill (see quick-dock-blob-trail in the JSX
  // below) — a real DOM ref rather than framer state, since this needs to
  // reach in and GSAP-tween a transform the instant the hovered index
  // changes, independent of whatever spring framer's own layoutId
  // projection is running on the shell around it.
  const trailFillRef = useRef(null);
  const prevHoveredRef = useRef(null);

  useEffect(() => {
    const prevIndex = prevHoveredRef.current;
    prevHoveredRef.current = hovered;
    if (reduceMotion || hovered == null || prevIndex == null || prevIndex === hovered) return;

    const prevEl = itemBoxRefs.current[prevIndex];
    const nextEl = itemBoxRefs.current[hovered];
    const fillEl = trailFillRef.current;
    if (!prevEl || !nextEl || !fillEl) return;

    const prevRect = prevEl.getBoundingClientRect();
    const nextRect = nextEl.getBoundingClientRect();
    const dx = (nextRect.left + nextRect.width / 2) - (prevRect.left + prevRect.width / 2);
    const travel = Math.abs(dx);

    // How elongated the ink reads mid-travel, and which way — capped so a
    // sweep clear across the dock doesn't stretch it into a sliver.
    const stretch = Math.min(1 + travel / 90, 2.4);
    const skew = Math.max(-18, Math.min(18, dx / 6));

    gsap.killTweensOf(fillEl);
    gsap.fromTo(fillEl,
      { scaleX: stretch, skewX: skew },
      { scaleX: 1, skewX: 0, duration: .45, ease: "power2.out" },
    );
  }, [hovered, reduceMotion]);

  // Every fired action sends a small felt "impact" rippling outward through
  // its immediate neighbors — the same window-event ripple technique
  // ColorSelector.jsx's own pour uses for its column of ink pots, applied
  // here to the dock's row instead. Distance is read off the CURRENT order
  // (itemCountRef), so a drag-to-reorder naturally changes who counts as a
  // "neighbor" for the next impact — exactly the right reading, since the
  // ripple is about physical adjacency in the row, not a fixed identity.
  useEffect(() => {
    if (reduceMotion) return undefined;

    const onImpact = (e) => {
      const from = e.detail?.index;
      if (from == null) return;

      for (let index = 0; index < itemCountRef.current; index++) {
        if (index === from) continue;
        const distance = Math.abs(index - from);
        if (distance > IMPACT_REACH) continue;

        const amount = 1 - distance * IMPACT_DECAY;
        const delay = distance * 55;

        setTimeout(() => {
          const el = impactRefs.current[index];
          if (!el) return;

          gsap.killTweensOf(el);
          gsap.timeline()
            .to(el, { y: 5 * amount, scale: 1 - .06 * amount, duration: .08, ease: "power1.out" })
            .to(el, { y: 0, scale: 1, duration: .5, ease: "elastic.out(1, 0.5)" });
        }, delay);
      }
    };

    window.addEventListener("quick-dock-impact", onImpact);
    return () => window.removeEventListener("quick-dock-impact", onImpact);
  }, [reduceMotion]);

  // A brief shiver across the dock's own background — the ink well
  // trembling, not another gooey blob (the hover highlight already spends
  // that idiom) — reusing History's own feTurbulence/feDisplacementMap
  // "boil" technique against this dock's flat surface instead of a note
  // grid. Needs an actual textured surface behind it to distort (see
  // quick-dock-splash-surface's own gradient in the CSS) — a perfectly
  // flat single color gives the filter nothing to warp.
  const splashDisplaceRef = useRef(null);
  const splashTweenRef = useRef(null);

  const triggerSplash = () => {
    if (reduceMotion || !splashDisplaceRef.current) return;
    splashTweenRef.current?.kill();
    splashTweenRef.current = gsap.fromTo(
      splashDisplaceRef.current,
      { attr: { scale: 22 } },
      { attr: { scale: 0 }, duration: .5, ease: "power3.out", overwrite: "auto" }
    );
  };

  useEffect(() => () => splashTweenRef.current?.kill(), []);

  const runItem = (item, index) => {
    item.onRun();
    triggerSplash();
    if (!reduceMotion) window.dispatchEvent(new CustomEvent("quick-dock-impact", { detail: { index } }));
  };

  return (
    <motion.div
      ref={ dockRef }
      className="quick-dock"
      role="toolbar"
      aria-label="Quick actions"
      onMouseMove={ magnetic.handleMove }
      onMouseLeave={ magnetic.handleLeave }
      initial={{ opacity: 0, scale: .3, translateY: 70 }}
      animate={{ opacity: 1, scale: 1, translateY: 0 }}
      /* Retracting (focus mode) used to just be the entrance in flat
         reverse. The shared #gooey-effect filter (every hover highlight on
         this dock already drips through it) isn't used here — it's tuned
         for flat single-color blobs, and this shell carries its own
         border/box-shadow that the filter's contrast matrix would mangle.
         Instead the stretch itself does the work: a brief vertical pull
         before it collapses, the same "gathering before it lets go" beat
         real ink shows leaving a surface, without touching rendering that
         isn't built for the filter. */
      exit={{
        opacity: 0,
        /* scaleX/scaleY rather than a shared `scale` — the two diverge
           mid-transition (a taller, narrower pull) but land on the same
           value at the end, so this settles into a plain uniform shrink
           rather than compounding into an oddly flattened sliver. */
        scaleX: [1, 1.05, .82, .3],
        scaleY: [1, 1.22, .55, .3],
        translateY: [0, 3, 36, 70],
        transition: { duration: .38, times: [0, .3, .7, 1], ease: "easeIn" },
      }}
      transition={{ type: "spring", stiffness: 220, damping: 16, delay: .2 }}
    >
      <svg className="quick-dock-splash-defs" aria-hidden="true">
        <defs>
          <filter id="quick-dock-splash" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="7" result="noise" />
            <feDisplacementMap ref={ splashDisplaceRef } in="SourceGraphic" in2="noise" scale="0" />
          </filter>
        </defs>
      </svg>
      <span className="quick-dock-splash-surface" aria-hidden="true" />
      {/* Reorder.Group in place of the old plain motion.div — axis="x"
          matches the row's own single-line layout (and useMagnetic's own
          axis: "x" above), `as="div"` so this stays a plain flex row rather
          than the ul/li framer defaults to. Still carries the exact same
          stagger-in variants context the row always has. */}
      <Reorder.Group
        as="div"
        axis="x"
        className="quick-dock-items"
        values={ order }
        onReorder={ handleReorder }
        variants={ dockRowVariants }
        initial="hidden"
        animate="shown"
      >
      {/* AnimatePresence around the mapped items — Reorder.Group/Item alone
          only own the drag-to-reorder transform, not mount/unmount; without
          this, shelving an item (see shelveItem above) would just vanish it
          instantly rather than letting its own exit play. */}
      <AnimatePresence initial={ false }>
        {
        orderedItems.map((item, index) => (
          <Reorder.Item
            key={ item.key }
            value={ item.key }
            as="div"
            className="quick-dock-slot"
            variants={ dockItemVariants }
            whileDrag={{ scale: 1.18, zIndex: 5, cursor: "grabbing" }}
            /* Lifts and dissolves up and away — reads as being picked up
               and put on the shelf, deliberately not the same downward
               entrance variants reversed. */
            exit={{ opacity: 0, scale: .4, translateY: -26, transition: { duration: .3, ease: "easeIn" } }}
            onDragStart={ handleItemDragStart }
            onDragEnd={ () => handleItemDragEnd(index) }
          >
            <motion.button
              ref={ (el) => { itemBoxRefs.current[index] = el; } }
              type="button"
              aria-label={ item.label }
              title={ item.label }
              className="quick-dock-item"
              whileTap={{ scale: .84 }}
              transition={{ type: "spring", stiffness: 420, damping: 17 }}
              onMouseEnter={ () => setHovered(index) }
              onMouseLeave={ () => setHovered((prev) => (prev === index ? null : prev)) }
              onTapStart={ dockPulse.squash }
              onClick={ () => handleItemClick(item, index) }
              onPointerDown={ (e) => handleItemPointerDown(item, e) }
              onPointerMove={ handleItemPointerMove }
              onPointerUp={ clearHold }
              onPointerLeave={ clearHold }
            >
              {
                hovered === index && (
                  <span className="quick-dock-goo" style={{ position: "absolute", inset: 0, zIndex: -1 }}>
                    <motion.span
                      layoutId="dockHighlightTrail"
                      className="quick-dock-blob quick-dock-blob-trail"
                      transition={{ type: "spring", stiffness: 170, damping: 15 }}
                    >
                      <span ref={ trailFillRef } className="quick-dock-trail-fill" />
                    </motion.span>
                    <motion.span
                      layoutId="dockHighlightCore"
                      className="quick-dock-blob quick-dock-blob-core"
                      transition={{ type: "spring", stiffness: 520, damping: 24 }}
                    >
                      <motion.span className="quick-dock-highlight" animate={ dockPulse.jelly } />
                    </motion.span>
                  </span>
                )
              }
              <span ref={ (el) => { impactRefs.current[index] = el; } } className="quick-dock-impact-wrap">
                <span
                  ref={ magnetic.registerItem(index) }
                  className="quick-dock-icon-wrap"
                >
                  <span className="quick-dock-icon">
                    {/* focus/theme are the only two items whose icon actually
                        changes under the visitor — everything else keeps a
                        fixed icon, so only those two carry the AnimatePresence
                        cost of a real spin-swap (the same iconSpin recipe
                        Header/Settings' own toggles use) instead of the flat
                        instant snap this used to be. */}
                    {
                      item.iconKey ? (
                        <AnimatePresence mode="wait" initial={ false }>
                          <motion.span
                            key={ item.iconKey }
                            style={{ display: "flex" }}
                            { ...iconSpin({ type: "spring", stiffness: 420, damping: 16 }) }
                          >
                            { item.icon }
                          </motion.span>
                        </AnimatePresence>
                      ) : item.icon
                    }
                  </span>
                </span>
              </span>
            </motion.button>
          </Reorder.Item>
        ))
        }
      </AnimatePresence>
      </Reorder.Group>
      {
        hidden.length > 0 && (
          <div className="quick-dock-shelf-wrap">
            <motion.button
              type="button"
              className="quick-dock-shelf-toggle"
              aria-label={ `${ hidden.length } hidden ${ hidden.length === 1 ? "action" : "actions" } — tap to restore` }
              title="Hidden actions"
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: .9 }}
              transition={{ type: "spring", stiffness: 420, damping: 16 }}
              onClick={ () => setShelfOpen((v) => !v) }
            >
              <FaEllipsis />
              <span className="quick-dock-shelf-count">{ hidden.length }</span>
            </motion.button>
            <AnimatePresence>
              {
                shelfOpen && (
                  <motion.div
                    className="quick-dock-shelf-popover"
                    role="menu"
                    aria-label="Hidden dock actions"
                    initial={{ opacity: 0, scale: .6, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: .6, y: 10 }}
                    transition={{ type: "spring", stiffness: 420, damping: 22 }}
                  >
                    <AnimatePresence initial={ false }>
                      {
                        hidden.map((key) => {
                          const item = itemsByKey[key];
                          if (!item) return null;

                          return (
                            <motion.button
                              key={ key }
                              type="button"
                              role="menuitem"
                              className="quick-dock-shelf-chip"
                              aria-label={ `Restore ${ item.label }` }
                              title={ `Restore ${ item.label }` }
                              layout
                              initial={{ opacity: 0, scale: .4 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: .4 }}
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: .9 }}
                              transition={{ type: "spring", stiffness: 420, damping: 18 }}
                              onClick={ () => restoreItem(key) }
                            >
                              { item.icon }
                            </motion.button>
                          );
                        })
                      }
                    </AnimatePresence>
                  </motion.div>
                )
              }
            </AnimatePresence>
          </div>
        )
      }
    </motion.div>
  );
};

export default QuickDock;
