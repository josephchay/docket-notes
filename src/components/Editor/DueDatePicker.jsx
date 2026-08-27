import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { FaChevronLeft, FaChevronRight } from "react-icons/fa6";

import useInkPulse from "../../hooks/useInkPulse";
import useJellyTap from "../../hooks/useJellyTap";
import { SETTLE, SNAPPY, squashCollapse, enterExitStagger } from "../Motion";

import "./DueDatePicker.css";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

// "YYYY-MM-DD" built from LOCAL calendar fields — matches exactly how
// utils/date.js's dueLabel parses dueAt back (`${dueAt}T00:00:00`, local
// midnight), so a round trip through this picker never drifts a day the
// way toISOString()'s UTC conversion could near a timezone boundary.
const toDateKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${ y }-${ m }-${ d }`;
};

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// A calendar month as a flat, always-7-wide grid of real Date objects —
// leading/trailing cells simply come from JS's own month-overflow
// normalization (new Date(y, m, 0) or day > daysInMonth both roll into the
// neighboring month correctly on their own), so there's no separate
// "which month does this padding cell belong to" bookkeeping to get wrong.
const buildMonthGrid = (year, month) => {
  const startWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;

  return Array.from({ length: totalCells }, (_, i) => new Date(year, month, i - startWeekday + 1));
};

const QUICK_PICKS = [
  { label: "Today", offset: 0 },
  { label: "Tomorrow", offset: 1 },
  { label: "Next week", offset: 7 },
];

// A small hand-built calendar page, not the browser's own native date
// picker — this app draws its own controls everywhere else (the palette
// dots, the sort-mode thumb, the tag strip), and a system date widget was
// the one control left that looked like it belonged to a different app.
// Positioned as a light popover off the reminder button (not a full
// SheetPanel modal — a date pick is a quick in-and-out, not a destination),
// closing the exact same way the note's own right-click radial menu
// already does: Escape, or a capture-phase pointerdown outside it.
const DueDatePicker = ({ open, value, colorName, anchorRef, onChange, onClose }) => {
  const today = useMemo(() => new Date(), []);
  const selected = value ? new Date(`${ value }T00:00:00`) : null;

  const [view, setView] = useState(() => {
    const base = selected || today;
    return { year: base.getFullYear(), month: base.getMonth() };
  });
  // Which way the month just turned — purely cosmetic, feeds the header
  // label's own slide direction so paging forward/back reads as a page
  // turning that way rather than an identical fade every time.
  const [direction, setDirection] = useState(0);
  const [position, setPosition] = useState(null);
  const panelRef = useRef(null);

  // Re-anchors to wherever the current value (or today, if none yet) sits
  // every time the popover is freshly opened, and measures a fresh
  // position off the trigger button — rather than carrying over whatever
  // month was last left showing.
  useEffect(() => {
    if (!open) return;

    const base = selected ? new Date(`${ value }T00:00:00`) : today;
    setView({ year: base.getFullYear(), month: base.getMonth() });
    setDirection(0);

    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) {
      setPosition({
        left: Math.min(rect.left, window.innerWidth - 268),
        top: Math.min(rect.bottom + 10, window.innerHeight - 360),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleKey = (e) => { if (e.key === "Escape") onClose(); };
    const handleOutside = (e) => {
      if (panelRef.current?.contains(e.target)) return;
      if (anchorRef.current?.contains(e.target)) return;
      onClose();
    };

    window.addEventListener("keydown", handleKey);
    // Deferred a tick so the very pointerdown that opened this (the
    // reminder button itself) doesn't also count as the outside click that
    // immediately closes it again — same trick Note.jsx's own radial menu
    // and NoteList's grid radial menu already use.
    const timer = setTimeout(() => document.addEventListener("pointerdown", handleOutside), 0);

    return () => {
      window.removeEventListener("keydown", handleKey);
      clearTimeout(timer);
      document.removeEventListener("pointerdown", handleOutside);
    };
  }, [open, onClose, anchorRef]);

  const grid = useMemo(() => buildMonthGrid(view.year, view.month), [view.year, view.month]);

  const goMonth = (delta) => {
    setDirection(delta);
    setView((prev) => {
      const next = new Date(prev.year, prev.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  };

  const pickOffset = (days) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    onChange(toDateKey(date));
  };

  // The selected day's own ring borrows the free cursor's press pulse and
  // idle pool (see useInkPulse) so it carries the same elastic personality
  // sliding between days the header's color-filter ring already has
  // sliding between colors.
  const selectedPulse = useInkPulse(value);
  const prevJelly = useJellyTap();
  const nextJelly = useJellyTap();

  if (!position) return null;

  const monthLabel = new Date(view.year, view.month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return createPortal(
    <AnimatePresence>
      {
        open && (
          <motion.div
            ref={ panelRef }
            role="dialog"
            aria-label="Choose a reminder date"
            className={ `due-picker ${ colorName }-bg` }
            style={{ left: position.left, top: position.top }}
            initial={{ opacity: 0, scale: .8, y: -10, rotate: -3 }}
            animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }}
            exit={ squashCollapse({ scale: .85, y: -8, rotate: 2 }) }
            transition={ SETTLE }
          >
            <div className="due-picker-header">
              <motion.button
                type="button"
                aria-label="Previous month"
                className="due-picker-nav"
                whileHover={{ scale: 1.15 }}
                whileTap={{ scale: .88 }}
                transition={ SNAPPY }
                onTapStart={ prevJelly.squash }
                onClick={ () => goMonth(-1) }
              >
                <motion.span animate={ prevJelly.jelly } style={{ display: "inline-flex" }}>
                  <FaChevronLeft />
                </motion.span>
              </motion.button>
              <div className="due-picker-month-wrap">
                <AnimatePresence mode="popLayout" initial={ false }>
                  <motion.span
                    key={ `${ view.year }-${ view.month }` }
                    className="due-picker-month"
                    initial={{ opacity: 0, x: direction * 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -direction * 16, position: "absolute" }}
                    transition={{ duration: .2, ease: "easeOut" }}
                  >
                    { monthLabel }
                  </motion.span>
                </AnimatePresence>
              </div>
              <motion.button
                type="button"
                aria-label="Next month"
                className="due-picker-nav"
                whileHover={{ scale: 1.15 }}
                whileTap={{ scale: .88 }}
                transition={ SNAPPY }
                onTapStart={ nextJelly.squash }
                onClick={ () => goMonth(1) }
              >
                <motion.span animate={ nextJelly.jelly } style={{ display: "inline-flex" }}>
                  <FaChevronRight />
                </motion.span>
              </motion.button>
            </div>
            <div className="due-picker-weekdays">
              { WEEKDAYS.map((w, i) => <span key={ i }>{ w }</span>) }
            </div>
            <motion.div
              className="due-picker-grid"
              key={ `${ view.year }-${ view.month }-grid` }
              variants={ enterExitStagger(0, .012) }
              initial="hidden"
              animate="shown"
            >
              {
                grid.map((date) => {
                  const key = toDateKey(date);
                  const isSelected = value === key;
                  const isToday = sameDay(date, today);
                  const outside = date.getMonth() !== view.month;

                  return (
                    <motion.button
                      key={ key }
                      type="button"
                      aria-label={ date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) }
                      aria-pressed={ isSelected }
                      className={ `due-picker-day ${ outside ? "outside" : "" } ${ isToday ? "today" : "" }` }
                      variants={{ hidden: { opacity: 0, scale: .4 }, shown: { opacity: 1, scale: 1, transition: SNAPPY } }}
                      whileHover={{ scale: 1.16 }}
                      whileTap={{ scale: .86 }}
                      transition={ SNAPPY }
                      onTapStart={ () => { if (isSelected) selectedPulse.squash(); } }
                      onClick={ () => onChange(key) }
                    >
                      {
                        isSelected && (
                          <motion.span
                            layoutId="dueDayRing"
                            className="due-picker-day-ring"
                            transition={{ type: "spring", stiffness: 480, damping: 19 }}
                          >
                            <motion.span
                              className="due-picker-day-fill"
                              animate={ selectedPulse.jelly }
                            />
                          </motion.span>
                        )
                      }
                      <span className="due-picker-day-num">{ date.getDate() }</span>
                    </motion.button>
                  );
                })
              }
            </motion.div>
            <div className="due-picker-quick">
              {
                QUICK_PICKS.map((q) => (
                  <button
                    key={ q.label }
                    type="button"
                    className="due-picker-quick-pill"
                    onClick={ () => pickOffset(q.offset) }
                  >
                    { q.label }
                  </button>
                ))
              }
              {
                value && (
                  <button
                    type="button"
                    className="due-picker-quick-pill clear"
                    onClick={ () => onChange(null) }
                  >
                    Clear
                  </button>
                )
              }
            </div>
          </motion.div>
        )
      }
    </AnimatePresence>,
    document.body
  );
};

export default DueDatePicker;
