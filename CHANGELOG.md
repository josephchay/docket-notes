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

- Focus trap propagation — extracted History's proven pattern into a shared src/hooks/useFocusTrap.js (and refactored History itself to use it, so there's now exactly one implementation instead of a copy that could drift), then applied it to all five remaining dot-to-sheet panels:
    - Insights, Trash, Sprint, Settings — a one-line useFocusTrap(panelRef, open) each, plus tabIndex={-1} and outline: none on their panel roots.
    - Command Palette — adapted with { focusOnOpen: false }, since its search input already has autoFocus (core to a command palette's "start typing immediately" UX), which the hook's usual focus-the-panel-root step would otherwise fight a frame later.

- Temporary music 
- Cloth field animation effect in Command Ink
- Added initial Note constellation feature
- View Panning for the Note constellation
- Double clicking to the Note constellation to reset the view
- wheel-zoom for Note constellation
- Added Spin — blobs finally rotate
    Every node now carries real angular state (rot, omega), driven by two honest torques and rendered as a genuine rotation of its own irregular silhouette (which is exactly what makes spin legible — a perfect circle turning is invisible):

    - Contact friction: when two surfaces rub past each other, the tangential slip at the contact drags both silhouettes with it (same sign both sides — friction drags, gears mesh), through 1/mass like every impulse. A glancing collision leaves both notes visibly turning; a hard fling through a crowd sets the whole lane spinning.
    - Ambient vorticity: the curl-noise current is a velocity field, and a body suspended in flow turns with the flow's local rotation — ζ = ∂v_y/∂x − ∂v_x/∂y, measured by central differences over four extra field samples per node per frame (a deliberate spend, stated in the comment: it's what makes the idle desk read as leaves turning in eddies instead of decals sliding on glass).

    One relaxation does two jobs — the angular velocity chases the local vorticity on a slow ease, which doubles as the contact kicks' ring-down. The contact dimples stay world-honest: a dent is material, it turns with the body, so the pressure field folds the current rotation into its anchor angles and re-finds whichever anchors now face the neighbor. The collision-side kick is gated against reduced motion at the source, so the settle pass can't bank up spin that would burst out if the preference ever flipped.

    Long exposure — the constellation photographing itself

    A new Exposure pill develops film under the graph: every frame, every note deposits a faint dot of its own color into a world-space canvas (accumulated at zoom-1 resolution, blitted each frame through the live camera transform — so the developed image pans and zooms with the world), while a slow destination-out wash fades old light on a ~20-second clock. What develops is the physics' history, star-trail style: orbits draw their ellipses and comets their conics in Orrery, a throw draws its arc, the reshuffle blooms a chrysanthemum, the ambient drift writes its eddies — and a note that sits still burns a dark pool, exactly as a long exposure treats anything that doesn't move. The wash runs every 10th frame at real strength rather than every frame at a micro-alpha, because 8-bit canvas alpha quantizes washes under 1/255 to zero and the film would never clear. Toggling on loads fresh film; a resize rewinds it (stretching an old exposure would lie about where things had been); the dive tween carries the film along with the pool; reduced motion hides the pill entirely.

    To see it: npm start → switch to Orrery, toggle Exposure, and give it thirty seconds — the systems literally draw their own orbital diagrams. Then fling a note through a crowd and watch the survivors spin from the grazing contacts while the throw's arc develops on the film. Verification is yours as usual.

### Changed

- History Panel
    1. Rail hover thumbnails — hovering a tick now floats a mini note-grid popup above the rail.
    2. WebGL ambient wash — new HistoryAmbient.jsx, a scoped Three.js dust cloud in the right pane that smoothly re-tints to whichever action's color is being previewed.
    3. Redo-segment styling — the rail past the playhead renders dashed/orange, and those ticks become hollow dashed rings instead of solid dots.
    4. Branch stash — pushUndo no longer silently discards a forked-away redo branch; it's saved (up to 10) and restorable from a new list in the rail controls, landing you back exactly at the fork with that branch reattached as live redo. (I scoped this down from a literal branch-tree UI to this — reasoning is in the plan file's Context section.)

    All four files balance their braces cleanly (HistoryPanel.jsx, HistoryAmbient.jsx, Home.jsx, HistoryPanel.css). Per your standing preference I haven't run npm start/npm run build — worth checking in-browser:
    - Hover rail ticks → thumbnail popup appears/positions correctly.
    - Scrub between different action types → right-pane wash re-tints smoothly.
    - Undo a few steps → dashed rail segment + hollow ticks past the playhead.
    - Undo then make a new edit → "1 stashed branch" appears; Restore jumps back with the old redo branch intact, and that restore itself undoes with Ctrl+Z.

- Audit (Reviewed) on Settings, LiquidMeter, ScrollProgress, ErrorBoundary/ErrorSpill, and the CursorAura wiring for the same classes of gaps found in History (theme-reactivity, cleanup, mobile). Found and fixed one real, concrete issue: SettingsToggle.jsx's anime.js tween had no cleanup on unmount, unlike useOdometer.js's identical anime.js pattern which correctly pauses. Verified LiquidMeter's GSAP pulse timeline was already correctly cleaned up, and didn't find further issues worth flagging as genuine gaps rather than pre-existing, out-of-scope behavior.
- Updated animation for Note constellation feature

### Fixed

- One real bug I caught and fixed mid-build: the history banner's "current state" label would have always read the same generic text regardless of where you'd scrubbed to, since edit labels describe transitions between states, not the states themselves — fixed to show the label of whatever transition led to the current position.
