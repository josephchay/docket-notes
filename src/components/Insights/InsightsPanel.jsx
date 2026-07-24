import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FaXmark } from "react-icons/fa6";

import { NOTE_COLORS } from "../../constants/colors";

import "./InsightsPanel.css";

// The event the command palette's "Show desk insights" entry (and the
// toolbar's chart button) fire to summon this panel from anywhere.
export const INSIGHTS_EVENT = "docket:insights";

// Real numbers about the desk, not decoration. Two bar charts and two stat
// tiles, opened the same dot-to-sheet way as the command palette. The "by
// day" bars are a single series in the page's own ink — there's no second
// category to tell apart, so no palette decision to make there. The "by
// color" bars reuse the exact identity mapping every other color control in
// the app already uses (NOTE_COLORS), including its click-to-filter
// behavior, so a color picked here narrows the same desk everywhere else.
const InsightsPanel = ({
  totalCount,
  colorCounts,
  days,
  favoriteCount,
  avgChars,
  sortColor,
  setSortColor,
}) => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(INSIGHTS_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(INSIGHTS_EVENT, handleSummon);
    };
  }, []);

  const paletteNames = Object.keys(NOTE_COLORS);
  const maxColorCount = Math.max(1, ...paletteNames.map((name) => colorCounts?.[name] ?? 0));
  const maxDayCount = Math.max(1, ...(days || []).map((day) => day.count));
  const starredRatio = totalCount > 0 ? favoriteCount / totalCount : 0;

  return (
    <AnimatePresence>
      {
        open && (
          <div className="insights-layer">
            <motion.div
              className="insights-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: .2 } }}
              onClick={ () => setOpen(false) }
            />
            <motion.div
              className="insights-panel"
              initial={{ opacity: 0, scale: .1, translateY: 90, borderRadius: 60 }}
              animate={{ opacity: 1, scale: 1, translateY: 0, borderRadius: 22 }}
              exit={{
                opacity: 0,
                scale: .24,
                translateY: 60,
                borderRadius: 50,
                transition: { duration: .2, ease: "easeIn" },
              }}
              transition={{ type: "spring", stiffness: 190, damping: 14 }}
            >
              <div className="insights-header">
                <h3>Desk insights</h3>
                <motion.button
                  type="button"
                  aria-label="Close"
                  className="insights-close"
                  whileHover={{ scale: 1.15, rotate: 90 }}
                  whileTap={{ scale: .9 }}
                  transition={{ type: "spring", stiffness: 420, damping: 16 }}
                  onClick={ () => setOpen(false) }
                >
                  <FaXmark />
                </motion.button>
              </div>

              <div className="insights-body custom-scroll">
                <section className="insights-section">
                  <h4>Notes by day</h4>
                  {
                    days?.length > 0 ? (
                      <div className="insights-bars">
                        {
                          days.map((day, index) => (
                            <div
                              key={ day.label }
                              className="insights-bar-column"
                              title={ `${ day.count } ${ day.count === 1 ? "note" : "notes" } on ${ day.label }` }
                            >
                              <motion.span
                                className="insights-bar-count"
                                initial={{ opacity: 0, scale: .5 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ type: "spring", stiffness: 500, damping: 20, delay: .05 + index * .04 }}
                              >
                                { day.count }
                              </motion.span>
                              <motion.span
                                className="insights-bar insights-bar-ink"
                                style={{
                                  height: 8 + Math.round((day.count / maxDayCount) * 70),
                                  originY: 1,
                                }}
                                initial={{ scaleY: 0 }}
                                animate={{ scaleY: 1 }}
                                transition={{ type: "spring", stiffness: 300, damping: 13, delay: index * .04 }}
                              />
                              <span className="insights-bar-label">{ day.label.replace(/, \d{4}$/, "") }</span>
                            </div>
                          ))
                        }
                      </div>
                    ) : (
                      <p className="insights-empty">No notes on the desk yet.</p>
                    )
                  }
                </section>

                <section className="insights-section">
                  <h4>Notes by color</h4>
                  <div className="insights-bars">
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
                            className={ `insights-bar-column insights-bar-button ${ sortColor === name ? "active" : "" }` }
                            onClick={ () => setSortColor?.(sortColor === name ? null : name) }
                          >
                            <motion.span
                              key={ `${ name }-${ count }` }
                              className="insights-bar-count"
                              initial={{ opacity: 0, scale: .5 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={{ type: "spring", stiffness: 500, damping: 20, delay: .05 + index * .04 }}
                            >
                              { count }
                            </motion.span>
                            <motion.span
                              className={ `insights-bar ${ name }-bg` }
                              style={{
                                height: 8 + Math.round((count / maxColorCount) * 70),
                                originY: 1,
                              }}
                              initial={{ scaleY: 0 }}
                              animate={{ scaleY: 1 }}
                              transition={{ type: "spring", stiffness: 300, damping: 13, delay: index * .04 }}
                            />
                            <span className="insights-bar-label">{ name }</span>
                          </button>
                        );
                      })
                    }
                  </div>
                </section>

                <section className="insights-stats">
                  <div className="insights-stat">
                    <span className="insights-stat-label">Starred</span>
                    <div className="insights-stat-track">
                      <motion.div
                        className="insights-stat-fill"
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: starredRatio }}
                        style={{ originX: 0 }}
                        transition={{ type: "spring", stiffness: 220, damping: 20, delay: .15 }}
                      />
                    </div>
                    <span className="insights-stat-value">{ favoriteCount } / { totalCount }</span>
                  </div>
                  <div className="insights-stat">
                    <span className="insights-stat-label">Average length</span>
                    <motion.span
                      className="insights-stat-big"
                      initial={{ opacity: 0, scale: .5, translateY: 6 }}
                      animate={{ opacity: 1, scale: 1, translateY: 0 }}
                      transition={{ type: "spring", stiffness: 320, damping: 16, delay: .2 }}
                    >
                      { avgChars }
                    </motion.span>
                    <span className="insights-stat-value">characters / note</span>
                  </div>
                </section>
              </div>
            </motion.div>
          </div>
        )
      }
    </AnimatePresence>
  );
};

export default InsightsPanel;
