# Changelog

## [0.0.0] - 2026-07-30

### Added

- Persistent storage toggle — storage.js now routes every read/write through either sessionStorage (default, unchanged behavior) or localStorage, based on a preference flag that always lives in localStorage itself (so it survives the very tab-close it's deciding about). A lock/unlock icon next to the theme toggle in the header flips it, carries the current session's notes over immediately, and confirms via the existing stamp mechanism. Also in the command palette.

- Trash panel — deletedNotes (previously capped at 4 entries, 5-second auto-expiry) is now the single source of truth for everything deleted this session, uncapped. The toast deck still only shows the freshest few via a dismissed flag rather than deleting entries outright. New TrashPanel (dot-to-sheet bloom, matching InsightsPanel's established convention) lists everything, with restore (peels back toward the grid) and shred (crumples away) getting genuinely different exit animations. Trigger is a header icon with a live badge count.

- History panel — the undo/redo stacks moved from refs to state and now merge into one timeline + cursor, with a single jumpTo(index) replacing the old one-step-at-a-time-only logic. performUndo/performRedo (and the existing Ctrl+Z/Y, command palette entries) are now just jumpTo(cursor ± 1). The new panel is a horizontal scrub rail — dragging anywhere calls onJump live via Framer's onPan, which reports pointer movement without Framer applying its own transform, so the playhead's position stays a single ordinary React value the whole time rather than two systems fighting over it.

- Magnetic buttons everywhere — extracted QuickDock's magnetic-pull recipe into src/hooks/useMagnetic.jsx, refactored QuickDock onto it, and applied it to every Header toolbar icon (star, ink chart, insights, trash, command, focus, theme, persist).
    - Cinematic first-load intro (src/components/Intro/LoadIntro.jsx) — plays once per browser (new hasSeenIntro/markIntroSeen in storage.js): an ink bloom, the "Docket" wordmark springing up letter-by-letter with a liquid wobble, then a fade-reveal into the app.
    - Ambient WebGL desk layer (src/components/Ambient/AmbientField.jsx) — a faint raw-Three.js dust/star field drifting behind the note grid, parallaxing toward the cursor, re-tinting with theme.
    - Physics-based trash (src/components/Trash/TrashPhysics.jsx, new matter-js dep) — shredding a note or emptying the trash now tumbles real physics bodies off each item's swatch position before they settle and fade.
    - Smooth inertia scroll (src/hooks/useLenisScroll.jsx, new lenis dep) — Lenis now drives .home's scroll, with a velocity-skew tilt on the note grid and a GSAP ScrollTrigger parallax on the daily-ink QuoteCard.
    - Liquid SVG text (src/components/Svg/LiquidTextFilter.jsx) — applied to empty-state headings and the intro wordmark.
    - To verify: npm install (already done), then npm start and check: clear localStorage + reload for the intro; hover header/dock icons for the magnetic pull; scroll the desk for the inertia/skew/QuoteCard drift; delete a note → open Trash → shred + "Empty trash" for the physics tumble; toggle themes/focus mode to make sure nothing fights the existing .receded/grid-collapse states.

## Fixed

- One real bug I caught and fixed mid-build: the history banner's "current state" label would have always read the same generic text regardless of where you'd scrubbed to, since edit labels describe transitions between states, not the states themselves — fixed to show the label of whatever transition led to the current position.
