import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { FaXmark } from "react-icons/fa6";

import { NOTE_COLORS } from "../../constants/colors";
import { MILESTONES } from "../../constants/milestones";
import SheetPanel from "../Sheet/SheetPanel";
import LiquidMeter from "../Meter/LiquidMeter";
import InkVial from "./InkVial";

import "./InkLevelsPanel.css";

// The event the toolbar's ink-levels button fires to summon this panel
// from anywhere — same convention as INSIGHTS_EVENT/TRASH_EVENT/etc.
export const INK_LEVELS_EVENT = "docket:inkLevels";

// How much of each ink the desk holds, dressed in the exact same
// chrome as the desk insights panel (SheetPanel dot-to-sheet, sectioned
// body, ink-tab tooltips) — this used to be a small corner popover with
// its own bespoke styling; now it's the same kind of panel Insights is,
// just with a different two sections: overall progress toward the next
// milestone, and a per-color breakdown. The per-color chart keeps its
// own liquid-vial identity (InkVial's real wave-equation surface) rather
// than switching to Insights' flat bars — a vial full of ink is already
// the more literal shape for "how much ink," it just now sits inside
// the same tooltip/spacing/typography language Insights' own bars do.
const InkLevelsPanel = ({
  totalCount,
  colorCounts,
  sortColor,
  setSortColor,
  reduceMotion,
  celebration,
}) => {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(INK_LEVELS_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(INK_LEVELS_EVENT, handleSummon);
    };
  }, []);

  const paletteNames = Object.keys(NOTE_COLORS);
  const maxCount = Math.max(1, ...paletteNames.map((name) => colorCounts?.[name] ?? 0));

  // The vial's fill: how far the desk has come from the last milestone
  // toward the next one (not just totalCount/nextMilestone from zero —
  // that would look nearly full for most of the app's life once a few
  // milestones have passed). Maxed out once every milestone is behind it.
  const nextMilestone = MILESTONES.find((m) => m > totalCount) ?? null;
  const prevMilestone = [...MILESTONES].reverse().find((m) => m <= totalCount) ?? 0;
  const milestoneRatio = nextMilestone
    ? (totalCount - prevMilestone) / (nextMilestone - prevMilestone)
    : 1;
  const milestoneLabel = nextMilestone
    ? `${ totalCount } / ${ nextMilestone } to the next milestone`
    : `${ totalCount } notes — every milestone reached`;

  return (
    <SheetPanel
      open={ open }
      onClose={ () => setOpen(false) }
      panelRef={ panelRef }
      radius={ 22 }
      layerClassName="ink-levels-layer"
      backdropClassName="ink-levels-backdrop"
      panelClassName="ink-levels-panel"
      ariaLabel="Ink levels"
    >
      <div className="ink-levels-header">
        <h3>Ink levels</h3>
        <motion.button
          type="button"
          aria-label="Close"
          className="ink-levels-close"
          whileHover={{ scale: 1.15, rotate: 90 }}
          whileTap={{ scale: .9 }}
          transition={{ type: "spring", stiffness: 420, damping: 16 }}
          onClick={ () => setOpen(false) }
        >
          <FaXmark />
        </motion.button>
      </div>

      <div className="ink-levels-body">
        <section className="ink-levels-section">
          <h4>Progress to next milestone</h4>
          <LiquidMeter
            ratio={ milestoneRatio }
            color="var(--page-ink-color)"
            label={ milestoneLabel }
            reduceMotion={ reduceMotion }
            celebration={ celebration }
          />
        </section>

        <section className="ink-levels-section">
          <h4>Ink by color</h4>
          <div className="ink-levels-bars">
            {
              paletteNames.map((name, index) => {
                const count = colorCounts?.[name] ?? 0;
                const label = `${ count } ${ name } ${ count === 1 ? "note" : "notes" }`;

                return (
                  <button
                    key={ name }
                    type="button"
                    title={ label }
                    aria-label={
                      sortColor === name
                        ? `${ label } — showing only these; press to show every color`
                        : `${ label } — press to show only these`
                    }
                    aria-pressed={ sortColor === name }
                    className={ `ink-levels-column ink-levels-button ${ sortColor === name ? "active" : "" }` }
                    onClick={ () => setSortColor?.(sortColor === name ? null : name) }
                  >
                    <span className="ink-levels-tooltip">{ label }</span>
                    <motion.span
                      key={ `${ name }-${ count }` }
                      className="ink-levels-count"
                      initial={{ opacity: 0, scale: .5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ type: "spring", stiffness: 500, damping: 20, delay: .05 + index * .04 }}
                    >
                      { count }
                    </motion.span>
                    <motion.span
                      className="ink-levels-vial-wrap"
                      style={{ originY: 1 }}
                      initial={{ scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={{ type: "spring", stiffness: 300, damping: 13, delay: index * .04 }}
                    >
                      <InkVial
                        count={ count }
                        height={ 8 + Math.round((count / maxCount) * 56) }
                        colorName={ name }
                        open={ open }
                        reduceMotion={ reduceMotion }
                      />
                    </motion.span>
                    <span className="ink-levels-label">{ name }</span>
                  </button>
                );
              })
            }
          </div>
        </section>
      </div>
    </SheetPanel>
  );
};

export default InkLevelsPanel;
