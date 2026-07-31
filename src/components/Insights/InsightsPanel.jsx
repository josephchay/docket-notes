import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FaXmark } from "react-icons/fa6";

import { NOTE_COLORS } from "../../constants/colors";
import { smoothPath, smoothAreaPath } from "../../utils/svgPath";
import useBlobClipMorph from "../../hooks/useBlobClipMorph";

import "./InsightsPanel.css";

// The event the command palette's "Show desk insights" entry (and the
// toolbar's chart button) fire to summon this panel from anywhere.
export const INSIGHTS_EVENT = "docket:insights";

// The day-trend chart's own coordinate space — see smoothPath/smoothAreaPath
// (utils/svgPath.js) for how points become the drawn curve.
const TREND_W = 320;
const TREND_H = 80;
const TREND_PAD_TOP = 10;
const TREND_BASELINE = TREND_H - 8;

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
  const panelRef = useRef(null);

  // The dot-to-sheet morph clips through a real organic blob stage
  // (utils/blob.js's flubber-powered createBlobMorph) on top of the scale
  // spring below.
  const onBlobUpdate = useBlobClipMorph(panelRef, open, 22);

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

  // The day-trend's own points, plus the smoothed line and area built from
  // them — kept as real numbers straight off `days`, no idle wobble on the
  // drawn curve itself, so the shape stays an accurate read of the data
  // (only the draw-on and the latest-point marker animate).
  const trendPoints = useMemo(() => {
    if (!days || days.length === 0) return [];
    const usableH = TREND_BASELINE - TREND_PAD_TOP;

    return days.map((day, index) => ({
      x: days.length === 1 ? TREND_W / 2 : (index / (days.length - 1)) * TREND_W,
      y: TREND_BASELINE - (day.count / maxDayCount) * usableH,
    }));
  }, [days, maxDayCount]);

  const trendLinePath = useMemo(() => smoothPath(trendPoints), [trendPoints]);
  const trendAreaPath = useMemo(() => smoothAreaPath(trendPoints, TREND_BASELINE), [trendPoints]);
  const trendLastPoint = trendPoints[trendPoints.length - 1];

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
              ref={ panelRef }
              className="insights-panel"
              initial={{ opacity: 0, scale: .1, translateY: 90, borderRadius: 60 }}
              onUpdate={ onBlobUpdate }
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

              <div className="insights-body">
                <section className="insights-section">
                  <h4>Notes by day</h4>
                  {
                    days?.length > 0 ? (
                      <>
                        <div className="insights-trend">
                          <svg
                            className="insights-trend-svg"
                            viewBox={ `0 0 ${ TREND_W } ${ TREND_H }` }
                            preserveAspectRatio="none"
                            aria-hidden="true"
                          >
                            <defs>
                              <linearGradient id="insights-trend-fill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="var(--page-ink-color)" stopOpacity=".28" />
                                <stop offset="100%" stopColor="var(--page-ink-color)" stopOpacity="0" />
                              </linearGradient>
                            </defs>
                            <motion.path
                              className="insights-trend-area"
                              d={ trendAreaPath }
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              transition={{ duration: .5, delay: .3 }}
                            />
                            <motion.path
                              className="insights-trend-line"
                              d={ trendLinePath }
                              initial={{ pathLength: 0 }}
                              animate={{ pathLength: 1 }}
                              transition={{ duration: .9, ease: "easeInOut", delay: .05 }}
                            />
                            {
                              trendLastPoint && (
                                <motion.circle
                                  className="insights-trend-marker"
                                  cx={ trendLastPoint.x }
                                  cy={ trendLastPoint.y }
                                  r="3.2"
                                  initial={{ scale: 0 }}
                                  animate={{ scale: [0, 1.5, 1, 1.25, 1] }}
                                  transition={{ duration: 1.2, times: [0, .3, .5, .8, 1], delay: 1, repeat: Infinity, repeatDelay: 1.6 }}
                                />
                              )
                            }
                          </svg>
                          {
                            trendPoints.map((point, index) => (
                              <button
                                key={ days[index].label }
                                type="button"
                                className="insights-trend-point"
                                style={{ left: `${ (point.x / TREND_W) * 100 }%`, top: `${ (point.y / TREND_H) * 100 }%` }}
                                aria-label={ `${ days[index].count } ${ days[index].count === 1 ? "note" : "notes" } on ${ days[index].label }` }
                              >
                                <span className="insights-tooltip">
                                  { days[index].count } { days[index].count === 1 ? "note" : "notes" } · { days[index].label }
                                </span>
                              </button>
                            ))
                          }
                        </div>
                        <div className="insights-trend-labels">
                          {
                            days.map((day) => (
                              <span key={ day.label } className="insights-bar-label">
                                { day.label.replace(/, \d{4}$/, "") }
                              </span>
                            ))
                          }
                        </div>
                      </>
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
                            <span className="insights-tooltip">{ label }</span>
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
