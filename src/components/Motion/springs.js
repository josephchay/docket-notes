// Named spring configs mirroring the literals already tuned and playing
// across the desk — Header's toolbar, Navigation's rail, SheetPanel's
// dot-to-sheet grow, QuickDock's goo, InkCelebration's pill — collected
// here so new work reads from one place instead of re-typing the same
// numbers a little differently each time.

// The toolbar-icon spring: Header's `whileHover`/`whileTap` on every wand,
// Navigation's export/import buttons.
export const SNAPPY = { type: "spring", stiffness: 400, damping: 17 };

// A count/badge/chip popping into place: Header's notes tally, the
// color-filter ring, the trash badge.
export const POP = { type: "spring", stiffness: 500, damping: 20 };
export const POP_TIGHT = { type: "spring", stiffness: 500, damping: 13 };

// A panel or pill settling in after a bigger entrance: SheetPanel's default
// transition, InkCelebration's pill.
export const SETTLE = { type: "spring", stiffness: 190, damping: 14 };
export const SETTLE_ALT = { type: "spring", stiffness: 190, damping: 13 };

// An icon spinning out and its replacement springing in: Header's
// theme/persist toggles.
export const ICON_SWAP = { type: "spring", stiffness: 380, damping: 16 };
export const ICON_SWAP_ALT = { type: "spring", stiffness: 420, damping: 15 };

// QuickDock's own three-speed goo system — kept distinct on purpose, not
// merged into one, since the trail is meant to lag behind the core.
export const DOCK_ITEM = { type: "spring", stiffness: 420, damping: 14 };
export const DOCK_CORE = { type: "spring", stiffness: 520, damping: 24 };
export const DOCK_TRAIL = { type: "spring", stiffness: 170, damping: 15 };

// The rope-tug `dragTransition` bounce (a distinct shape from a regular
// spring — `bounceStiffness`/`bounceDamping`, not `stiffness`/`damping`)
// duplicated verbatim between PullString and MoveString's own drag rigs.
export const DRAG_SNAP = { bounceStiffness: 340, bounceDamping: 13 };

// The exit-side counterpart nothing had a name for yet — a touch snappier
// than SETTLE, since a squash-collapse exit should read as quicker than the
// entrance it mirrors.
export const EXIT_SPRING = { type: "spring", stiffness: 260, damping: 20 };

// The one bezier shared, until now only by a code comment, across Header's
// toolbar slide, Navigation's rail slide, and .home's own grid-track
// collapse (see Home.css) — all three land on the same beat. The CSS site
// can't import this directly; it keeps its own literal, tagged with this
// constant's name so the two stay discoverable as the same curve.
export const RAIL_SLIDE = { duration: .5, ease: [0.34, 1.56, 0.64, 1] };
