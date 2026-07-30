import { useRef, useState } from "react";
import { motion } from "framer-motion";
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

import "./QuickDock.css";

// A floating dock of the desk's most-reached-for actions, magnetized the
// way a real dock is (see useMagnetic.jsx for the shared recipe — Header's
// toolbar icons borrow the same one). A gooey highlight pill (the same
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
  const [hovered, setHovered] = useState(null);
  const dockPulse = useInkPulse(hovered);
  const magnetic = useMagnetic({ range: 96, maxLift: 16, maxScale: 1.55, axis: "x" });

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
            onTapStart={ dockPulse.squash }
            onClick={ item.onRun }
          >
            {
              hovered === index && (
                <motion.span
                  layoutId="dockHighlight"
                  style={{ position: "absolute", inset: 0, zIndex: -1 }}
                  transition={{ type: "spring", stiffness: 500, damping: 20 }}
                >
                  <motion.span className="quick-dock-highlight" animate={ dockPulse.jelly } />
                </motion.span>
              )
            }
            <span
              ref={ magnetic.registerItem(index) }
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
