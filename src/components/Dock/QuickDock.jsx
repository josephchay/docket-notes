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
          flex items for layout, while giving the row its own variants
          context (separate from the dock shell's own raw-object spring
          above) so staggerChildren has a labeled "shown" state to key off —
          the same two-layer split Header's toolbar/.color-filters uses. */}
      <motion.div className="quick-dock-items" variants={ dockRowVariants } initial="hidden" animate="shown">
      {
        items.map((item, index) => (
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
        ))
      }
      </motion.div>
    </motion.div>
  );
};

export default QuickDock;
