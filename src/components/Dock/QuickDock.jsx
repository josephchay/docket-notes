import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  FaPlus,
  FaShuffle,
  FaExpand,
  FaCompress,
  FaWandMagicSparkles,
  FaHourglassHalf,
  FaMoon,
  FaSun,
} from "react-icons/fa6";

import { NOTE_COLORS } from "../../constants/colors";
import { COMMAND_EVENT } from "../Command/CommandPalette";
import { SPRINT_EVENT } from "../Sprint/SprintPanel";
import useInkPulse from "../../hooks/useInkPulse";
import useMagnetic from "../../hooks/useMagnetic";
import { iconSpin } from "../Motion";
import WavePlayer from "./WavePlayer";

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

// A floating dock of the desk's most-reached-for actions, magnetized the
// way a real dock is (see useMagnetic.jsx for the shared recipe — Header's
// toolbar icons borrow the same one). The highlight is properly gooey now
// rather than just a sliding pill: a slow-chasing "trail" blob and a
// fast-snapping "core" blob share the same layoutId-driven target (whichever
// icon has the pointer) but ride different spring speeds, so mid-travel the
// core arrives first and the trail is still catching up a few pixels behind
// it — the same shared #gooey-effect filter (see Svg/GooeyEffectSvg,
// mounted once near Home's root) every other merging blob in the app already
// uses fuses the two overlapping, offset shapes into one stretched drip
// instead of two crisp rounded rects.
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
  const magnetic = useMagnetic({ range: 96, maxLift: 16, maxScale: 1.55, axis: "x", reduceMotion });

  const handleThemeToggle = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    toggleTheme?.({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  };

  const items = [
    {
      key: "new",
      label: "Pour a new note",
      icon: <FaPlus />,
      onRun: () => {
        const palette = Object.keys(NOTE_COLORS);
        addNote?.(palette[Math.floor(Math.random() * palette.length)]);
      },
    },
    { key: "shuffle", label: "Shuffle the desk", icon: <FaShuffle />, onRun: () => shuffleNotes?.() },
    {
      key: "focus",
      label: focusMode ? "Exit focus mode" : "Enter focus mode",
      icon: focusMode ? <FaCompress /> : <FaExpand />,
      iconKey: focusMode ? "compress" : "expand",
      onRun: () => toggleFocusMode?.(),
    },
    {
      key: "sprint",
      label: "Focus sprint",
      icon: <FaHourglassHalf />,
      onRun: () => window.dispatchEvent(new CustomEvent(SPRINT_EVENT)),
    },
    {
      key: "command",
      label: "Command ink",
      icon: <FaWandMagicSparkles />,
      onRun: () => window.dispatchEvent(new CustomEvent(COMMAND_EVENT)),
    },
    {
      key: "theme",
      label: theme === "dark" ? "Switch to fresh paper" : "Switch to Ink",
      icon: theme === "dark" ? <FaSun /> : <FaMoon />,
      iconKey: theme,
      onRun: handleThemeToggle,
    },
  ];

  // Split around the wave player rather than appended after it, so it sits
  // at the dock's actual visual center (3 items — divider — player —
  // divider — 3 items) instead of tacked onto one end. Index is threaded
  // through explicitly (not each half's own local map index) since
  // `hovered`/`magnetic.registerItem` both key off a single 0..items.length
  // numbering shared across both halves — useMagnetic itself doesn't care
  // about DOM order (its magnetism is purely getBoundingClientRect-based),
  // so splitting the render in two changes nothing about how it feels.
  const renderItem = (item, index) => (
    <motion.button
      key={ item.key }
      type="button"
      aria-label={ item.label }
      title={ item.label }
      className="quick-dock-item"
      variants={ dockItemVariants }
      whileTap={{ scale: .84 }}
      transition={{ type: "spring", stiffness: 420, damping: 17 }}
      onMouseEnter={ () => setHovered(index) }
      onMouseLeave={ () => setHovered((prev) => (prev === index ? null : prev)) }
      onTapStart={ dockPulse.squash }
      onClick={ item.onRun }
    >
      {
        hovered === index && (
          <span className="quick-dock-goo" style={{ position: "absolute", inset: 0, zIndex: -1 }}>
            <motion.span
              layoutId="dockHighlightTrail"
              className="quick-dock-blob quick-dock-blob-trail"
              transition={{ type: "spring", stiffness: 170, damping: 15 }}
            />
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
    </motion.button>
  );

  const splitAt = Math.ceil(items.length / 2);
  const leftItems = items.slice(0, splitAt);
  const rightItems = items.slice(splitAt);

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
      {/* display:contents keeps these buttons as .quick-dock's own direct
          flex items for layout, while giving each half its own variants
          context (separate from the dock shell's own raw-object spring
          above) so staggerChildren has a labeled "shown" state to key off —
          the same two-layer split Header's toolbar/.color-filters uses. */}
      <motion.div className="quick-dock-items" variants={ dockRowVariants } initial="hidden" animate="shown">
        { leftItems.map((item, i) => renderItem(item, i)) }
      </motion.div>
      {/* A real audio player, not another dock action — flanked by its own
          dividers and its own later entrance delay so it reads as a
          distinct module riding at the capsule's center rather than just
          another dock item. Shares this dock's own magnetic instance (see
          useMagnetic.jsx) via magneticBaseIndex — its three controls
          (prev/wave/next) register as items.length..items.length+2, past
          the icon row's own 0..items.length-1, so hovering it feels like
          the same floating dock rather than a static block sitting
          between two magnetized halves. */}
      <motion.div
        className="quick-dock-wave-group"
        initial={{ opacity: 0, scale: .85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 22, delay: .5 }}
      >
        <span className="quick-dock-divider" aria-hidden="true" />
        <WavePlayer reduceMotion={ reduceMotion } magnetic={ magnetic } magneticBaseIndex={ items.length } />
        <span className="quick-dock-divider" aria-hidden="true" />
      </motion.div>
      <motion.div className="quick-dock-items" variants={ dockRowVariants } initial="hidden" animate="shown">
        { rightItems.map((item, i) => renderItem(item, i + splitAt)) }
      </motion.div>
    </motion.div>
  );
};

export default QuickDock;
