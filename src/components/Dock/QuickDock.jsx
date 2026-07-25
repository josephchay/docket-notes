import { useRef, useState } from "react";
import { motion } from "framer-motion";
import gsap from "gsap";
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

import "./QuickDock.css";

const MAGNET_RANGE = 96;   // px either side of an icon's own center that still feels the pointer's pull
const MAX_LIFT = 16;       // px an icon rises at full magnification
const MAX_SCALE = 1.55;

// A floating dock of the desk's most-reached-for actions, magnetized the
// way a real dock is: every icon feels the pointer's distance continuously
// (not just its own hover), rising and swelling more the closer it gets,
// via GSAP quickTo tweens on each icon's own inner wrapper — kept separate
// from the outer button's framer-driven tap bounce so the two never fight
// over the same transform. Leaving the dock lets every icon spring back
// with one shared elastic release. A gooey highlight pill (the same
// shared-layout recipe as the sort/tag/color thumbs elsewhere in the app)
// slides and squashes between whichever icon currently has the pointer.
const QuickDock = ({
  addNote,
  shuffleNotes,
  focusMode,
  toggleFocusMode,
  theme,
  toggleTheme,
}) => {
  const dockRef = useRef(null);
  const itemRefs = useRef([]);
  const quickTweens = useRef([]);
  const [hovered, setHovered] = useState(null);

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
      onRun: handleThemeToggle,
    },
  ];

  const ensureTween = (index) => {
    if (!quickTweens.current[index] && itemRefs.current[index]) {
      quickTweens.current[index] = {
        scale: gsap.quickTo(itemRefs.current[index], "scale", { duration: .35, ease: "power3.out" }),
        y: gsap.quickTo(itemRefs.current[index], "y", { duration: .35, ease: "power3.out" }),
      };
    }
    return quickTweens.current[index];
  };

  const handleMove = (e) => {
    itemRefs.current.forEach((el, index) => {
      if (!el) return;

      const itemRect = el.getBoundingClientRect();
      const centerX = itemRect.left + itemRect.width / 2;
      const distance = Math.abs(e.clientX - centerX);
      const falloff = Math.max(0, 1 - distance / MAGNET_RANGE);
      const eased = falloff * falloff * (3 - 2 * falloff); // smoothstep — a rounder peak than a linear falloff

      const tween = ensureTween(index);
      if (!tween) return;
      tween.scale(1 + (MAX_SCALE - 1) * eased);
      tween.y(-MAX_LIFT * eased);
    });
  };

  const handleLeave = () => {
    itemRefs.current.forEach((el, index) => {
      if (!el) return;
      quickTweens.current[index] = null;
      gsap.to(el, { scale: 1, y: 0, duration: .6, ease: "elastic.out(1, 0.45)" });
    });
  };

  return (
    <motion.div
      ref={ dockRef }
      className="quick-dock"
      role="toolbar"
      aria-label="Quick actions"
      onMouseMove={ handleMove }
      onMouseLeave={ handleLeave }
      initial={{ opacity: 0, scale: .3, translateY: 70 }}
      animate={{ opacity: 1, scale: 1, translateY: 0 }}
      exit={{ opacity: 0, scale: .3, translateY: 70 }}
      transition={{ type: "spring", stiffness: 220, damping: 16, delay: .2 }}
    >
      {
        items.map((item, index) => (
          <motion.button
            key={ item.key }
            type="button"
            aria-label={ item.label }
            title={ item.label }
            className="quick-dock-item"
            whileTap={{ scale: .84 }}
            transition={{ type: "spring", stiffness: 420, damping: 17 }}
            onMouseEnter={ () => setHovered(index) }
            onMouseLeave={ () => setHovered((prev) => (prev === index ? null : prev)) }
            onClick={ item.onRun }
          >
            {
              hovered === index && (
                <motion.span
                  layoutId="dockHighlight"
                  className="quick-dock-highlight"
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                />
              )
            }
            <span
              ref={ (el) => { itemRefs.current[index] = el; } }
              className="quick-dock-icon-wrap"
            >
              <span className="quick-dock-icon">{ item.icon }</span>
            </span>
          </motion.button>
        ))
      }
    </motion.div>
  );
};

export default QuickDock;
