import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { FaHand, FaScissors } from "react-icons/fa6";

import { NOTE_COLORS } from "../../constants/colors";
import { smoothPath } from "../../utils/svgPath";
import { createPoint, integratePoint, relaxConstraints } from "../../utils/verlet";
import { SNAPPY } from "../Motion";

import "./ClothField.css";

// A real Verlet cloth — a grid of point masses connected by distance
// constraints, integrated and relaxed exactly per utils/verlet.js (see that
// file for the actual technique: Jakobsen-style position-based dynamics,
// not a spring-force simulation). This is a genuinely different kind of
// physics from every other Particles/ demo in this app: GravityField and
// FluidField both integrate *forces* into velocities into positions;
// here, position corrections *are* the physics, which is what lets a
// densely-connected mesh like this stay stable without needing a
// vanishingly small timestep the way an equivalently stiff spring lattice
// would (ParticleCuboid.jsx's own lattice is a spring system, and notably
// runs far fewer connections per point as a result).
//
// Structural constraints only (row/column neighbors) — no diagonal shear
// bracing — which is a real, deliberate choice: shear constraints are what
// make a simulated cloth read as starched canvas; leaving them out is what
// lets this drape and ripple like a loose, unstarched weave instead,
// closer to muslin than sailcloth.
const COLS = 15;
const ROWS = 10;
const SPACING = 6; // domain units between neighboring points at rest

const DOMAIN_W = 100;
const DOMAIN_H = 90;
const GRID_LEFT = (DOMAIN_W - (COLS - 1) * SPACING) / 2;
const GRID_TOP = 8;

const GRAVITY = 45;      // domain units/s²
const DAMPING = 0.985;   // per-substep implied-velocity retention (see integratePoint)
const SUBSTEPS = 2;
const CONSTRAINT_ITERATIONS = 6; // more = stiffer/more taut, fewer = slacker/more elastic

// A real periodic forcing, not noise — each point's own grid position
// phase-shifts it (WIND_ROW_PHASE down each row, WIND_COL_PHASE across
// each column), so a gust reads as a wave actually crossing the cloth
// rather than every point swaying in lockstep.
const WIND_STRENGTH = 22;
const WIND_ROW_PHASE = 0.4;
const WIND_COL_PHASE = 0.25;

const GRAB_RADIUS = 9; // domain units — how close a press needs to land to grab a point

// Aerodynamic billow — each non-anchor point carries a driven, damped
// `bulge` scalar (a lightweight stand-in for true out-of-plane depth, since
// this sim otherwise has none). Its drive term each substep is that point's
// live *slack* — how much shorter its constraints currently are than their
// rest length, accumulated straight from the same `constraints` array
// relaxConstraints just solved (see the slack pass in step() below) — times
// its own local wind phase (the exact windX this substep already computes
// for it, just normalized). That's the real physical intuition: a patch of
// cloth billows where it currently has room to (slack) and is facing the
// gust (positive wind phase), and stays flat where it's taut. Tuning
// constants, not physics, same honest split AudioWaveString.jsx's own
// AUDIO_FORCE_SCALE draws — BULGE_MAX is the backstop regardless of exactly
// how these are tuned.
const BULGE_SLACK_GAIN = 55;
const BULGE_RETURN_STIFFNESS = 35; // spring pulling bulge back toward flat
const BULGE_DAMPING = 7;
const BULGE_MAX = 3.2; // domain units — roughly half a grid spacing at most

// Fold-lit rendering — reads the bulge field above back out as stroke
// width/brightness on the existing thread paths (see the render pass in
// tick()). Weft (colored) threads lighten additively, the same "add a
// specular term to the base color" idiom InsightsPanel.jsx's own liquid
// shader uses; warp (neutral ink) threads only thicken/brighten in place,
// deliberately never tinted — ClothField.css's own comment already commits
// warp to staying hue-neutral, and this reads that as a constraint to
// honor rather than override.
const BULGE_WIDTH_GAIN_WEFT = 0.9;
const BULGE_WIDTH_GAIN_WARP = 0.5;
const BULGE_LIGHTEN_MAX = 90; // max per-channel RGB add at BULGE_MAX
const BULGE_OPACITY_GAIN = 0.15;

// Scissor tear — cutting mode swaps the drag gesture from "grab a point"
// to "sever any structural constraint the stroke crosses," tested via real
// segment intersection (see segmentsIntersect below) against the drag's
// swept segment each pointermove, not just a point-radius hit test — so a
// fast stroke can't skip over a thread between two move events.
const CUT_TRAIL_MAX_POINTS = 10;

// Gust choreography — an open-panel "snap" impulse and, once idle, a
// recurring transient gust layered on top of the ambient WIND_STRENGTH
// sway and fed into the billow drive above, so an untouched cloth still
// reads as a breeze passing through rather than sitting dead still. Same
// idle-gated-behavior spirit as HistoryConstellation.jsx's own IDLE_MS.
const SNAP_STRENGTH = 14; // domain units of initial implied velocity at the free (bottom) edge
const IDLE_MS = 4500;
const GUST_INTERVAL_MS = 6500;
const GUST_DURATION_S = 1.6;
const GUST_BOOST = 1.4; // multiplier applied to both wind sway and billow drive during a gust

const ClothField = ({ active, reduceMotion = false }) => {
  const svgRef = useRef(null);
  const rowRefs = useRef([]);
  const colRefs = useRef([]);
  const cutTrailRef = useRef(null);
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  const [cutMode, setCutMode] = useState(false);
  const cutModeRef = useRef(cutMode);
  cutModeRef.current = cutMode;

  useEffect(() => {
    if (!active) return undefined;

    const svg = svgRef.current;
    const parent = svg.parentElement;

    const dims = { w: 480, h: 360 };
    const resize = () => {
      dims.w = parent.clientWidth || 480;
      dims.h = parent.clientHeight || 360;
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(parent);

    // The grid: pinned top row hangs from an implied rod, every other row
    // starts perfectly flat and falls into its own natural drape once
    // gravity and the constraint solver below start running — watching a
    // flat grid settle into a hanging curve over the first second or so is
    // itself a demonstration of what this solver is actually doing, not
    // just a spawn artifact to hide.
    const grid = [];
    const points = [];
    for (let row = 0; row < ROWS; row++) {
      const rowPoints = [];
      for (let col = 0; col < COLS; col++) {
        const isAnchor = row === 0;
        const p = createPoint(GRID_LEFT + col * SPACING, GRID_TOP + row * SPACING, isAnchor);
        p.isAnchor = isAnchor;
        p.gridX = col;
        p.gridY = row;
        // Aerodynamic billow state (see BULGE_* above) — bulgeVel is a real
        // integrated velocity for that scalar, windPhase is just a one-frame
        // scratch value the render pass never reads (bulge/step() only).
        p.bulge = 0;
        p.bulgeVel = 0;
        p.slack = 0;
        p.windPhase = 0;
        rowPoints.push(p);
        points.push(p);
      }
      grid.push(rowPoints);
    }

    const constraints = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (col < COLS - 1) constraints.push({ a: grid[row][col], b: grid[row][col + 1], length: SPACING });
        if (row < ROWS - 1) constraints.push({ a: grid[row][col], b: grid[row + 1][col], length: SPACING });
      }
    }

    // The open-panel "snap" — a one-time kinematic impulse, not a separate
    // animation system: offsetting px/py behind x/y before the first
    // integrate step gives the Verlet solver's own implied velocity
    // (vx = x - px, see integratePoint) a real initial kick, which then
    // decays through DAMPING exactly like any other motion in this sim.
    // Scaled by how far a row hangs from the pinned rod (0 at the anchor
    // row, 1 at the free bottom edge) so it reads as a whip-open flick
    // rather than every point snapping by the same amount.
    for (const p of points) {
      if (p.isAnchor) continue;
      const rowFactor = p.gridY / (ROWS - 1);
      p.px = p.x - SNAP_STRENGTH * rowFactor;
      p.py = p.y - SNAP_STRENGTH * rowFactor * 0.3;
    }

    // Idle-gust scheduling (see GUST_* above) — a tiny state machine rather
    // than a separate timer: `active` gates whether a gust envelope is
    // currently being read in step()/tick() below, `startedAt` is when this
    // gust (or the countdown to the next one) began, `nextAt` is when the
    // next one is allowed to start. Any real grab or cut interaction pushes
    // `nextAt` back out (see the pointer handlers below), so a gust never
    // fights an interaction someone's mid-gesture on.
    const idleGust = { active: false, startedAt: 0, nextAt: performance.now() + IDLE_MS };

    let elapsed = 0;
    // The one point currently under the pointer, if any — forced to track
    // the cursor each substep (px lagging one step behind x, same as
    // integratePoint's own implied-velocity bookkeeping) rather than
    // teleported, so releasing it hands off real velocity from the last
    // couple of dragged frames instead of dropping it with zero speed.
    let draggedPoint = null;
    const dragTarget = { x: 0, y: 0 };

    // Scissor tear (see CUT_TRAIL_MAX_POINTS above) — `cutting` mirrors
    // `dragging`'s own role for the grab gesture, just for the cut one;
    // cutPrev is the stroke's last domain point, so each new pointermove
    // can test the *segment* from there to the new point against every
    // remaining constraint (segmentsIntersect below) rather than only ever
    // testing a single point, which would let a fast stroke skip a thread
    // between two move events entirely. cutTrail is the visual echo of the
    // stroke (see the render pass in tick()) — capped at
    // CUT_TRAIL_MAX_POINTS and cleared on release, same "trailing, not
    // persistent" spirit as AudioWaveString's own pluck feedback.
    let cutting = false;
    let cutPrev = null;
    let cutTrail = [];

    const domainFromEvent = (e) => {
      const rect = svg.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width;
      const ny = (e.clientY - rect.top) / rect.height;
      return { x: nx * DOMAIN_W, y: ny * DOMAIN_H };
    };

    const handlePointerDown = (e) => {
      if (reduceMotionRef.current) return;
      const p = domainFromEvent(e);
      idleGust.nextAt = performance.now() + IDLE_MS;
      idleGust.active = false;

      if (cutModeRef.current) {
        cutting = true;
        cutPrev = p;
        cutTrail = [p];
        svg.setPointerCapture?.(e.pointerId);
        return;
      }

      let nearest = null;
      let nearestDist = GRAB_RADIUS;
      for (const point of points) {
        const d = Math.hypot(point.x - p.x, point.y - p.y);
        if (d < nearestDist) { nearest = point; nearestDist = d; }
      }
      if (!nearest) return;

      draggedPoint = nearest;
      draggedPoint.pinned = true;
      dragTarget.x = p.x;
      dragTarget.y = p.y;
    };

    const handlePointerMove = (e) => {
      if (cutting) {
        const p = domainFromEvent(e);
        // Iterated backwards purely so splicing mid-loop never skips the
        // constraint that slides into the index just removed.
        for (let i = constraints.length - 1; i >= 0; i--) {
          const c = constraints[i];
          if (segmentsIntersect(cutPrev, p, c.a, c.b)) constraints.splice(i, 1);
        }
        cutPrev = p;
        cutTrail.push(p);
        if (cutTrail.length > CUT_TRAIL_MAX_POINTS) cutTrail.shift();
        return;
      }

      if (!draggedPoint) return;
      const { x, y } = domainFromEvent(e);
      dragTarget.x = x;
      dragTarget.y = y;
    };

    const handlePointerUp = () => {
      if (cutting) {
        cutting = false;
        cutPrev = null;
        cutTrail = [];
        return;
      }

      if (!draggedPoint) return;
      // Anchors return to being pinned in place (you've re-hung the rod at
      // a new spot); every other point returns to free simulation, carrying
      // whatever velocity the last couple of dragged frames left it with.
      draggedPoint.pinned = draggedPoint.isAnchor;
      draggedPoint = null;
    };

    svg.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    const step = (dt, gustEnvelope) => {
      elapsed += dt;

      if (draggedPoint) {
        draggedPoint.px = draggedPoint.x;
        draggedPoint.py = draggedPoint.y;
        draggedPoint.x = dragTarget.x;
        draggedPoint.y = dragTarget.y;
      }

      for (const p of points) {
        if (p === draggedPoint || p.pinned) continue;

        const windX = Math.sin(elapsed * 0.9 + p.gridY * WIND_ROW_PHASE + p.gridX * WIND_COL_PHASE)
          * WIND_STRENGTH * (1 + gustEnvelope * GUST_BOOST * 0.6);
        integratePoint(p, dt, windX, GRAVITY, DAMPING);

        // A generous domain-edge clamp, same defensive spirit as
        // FluidField's own boundary handling — not a wall this cloth is
        // meant to be felt bouncing off, just a backstop so a hard fling
        // can never draw a point off the visible stage entirely.
        p.x = Math.max(-20, Math.min(DOMAIN_W + 20, p.x));
        p.y = Math.max(-20, Math.min(DOMAIN_H + 20, p.y));

        // Stashed for the billow pass below, purely to avoid recomputing
        // the same sin() a second time — normalized so that pass can read
        // "how much is the gust hitting this point right now" independent
        // of WIND_STRENGTH's own exact magnitude.
        p.windPhase = windX / WIND_STRENGTH;
      }

      relaxConstraints(constraints, CONSTRAINT_ITERATIONS);

      // Aerodynamic billow (see BULGE_* above) — slack has to be
      // recomputed fresh every substep, straight from the constraints
      // relaxConstraints just solved: a point's live slack is exactly what
      // scissor tears change (a severed constraint simply stops
      // contributing to either endpoint's slack, no separate bookkeeping
      // needed), and what a taut pull tightens back toward zero.
      for (const p of points) p.slack = 0;
      for (const c of constraints) {
        const dist = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y);
        const slack = Math.max(0, c.length - dist);
        c.a.slack += slack;
        c.b.slack += slack;
      }
      for (const p of points) {
        if (p.isAnchor) continue;
        const drive = BULGE_SLACK_GAIN * p.slack * Math.max(0, p.windPhase) * (1 + gustEnvelope * GUST_BOOST);
        p.bulgeVel += (drive - BULGE_RETURN_STIFFNESS * p.bulge - BULGE_DAMPING * p.bulgeVel) * dt;
        p.bulge = Math.max(0, Math.min(BULGE_MAX, p.bulge + p.bulgeVel * dt));
      }
    };

    let lastTime = performance.now();
    let raf = null;

    const tick = () => {
      raf = requestAnimationFrame(tick);

      const now = performance.now();
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      // Idle-gust envelope — a plain 0→1→0 sine bump over GUST_DURATION_S
      // once a gust starts (sin(0)=0, sin(π/2)=1 at the midpoint, sin(π)=0
      // at the end), read by step() above for both wind sway and billow
      // drive. Never starts while a real grab or cut is in progress
      // (handlePointerDown already pushes idleGust.nextAt out on every
      // press), and any interaction that starts mid-gust simply lets the
      // envelope keep decaying on its own rather than snapping it off.
      let gustEnvelope = 0;
      if (!draggedPoint && !cutting) {
        if (!idleGust.active && now >= idleGust.nextAt) {
          idleGust.active = true;
          idleGust.startedAt = now;
        }
        if (idleGust.active) {
          const t = (now - idleGust.startedAt) / 1000 / GUST_DURATION_S;
          if (t >= 1) {
            idleGust.active = false;
            idleGust.nextAt = now + GUST_INTERVAL_MS;
          } else {
            gustEnvelope = Math.sin(Math.PI * t);
          }
        }
      }

      if (!reduceMotionRef.current) {
        const subDt = dt / SUBSTEPS;
        for (let s = 0; s < SUBSTEPS; s++) step(subDt, gustEnvelope);
      }

      const scaleX = dims.w / DOMAIN_W;
      const scaleY = dims.h / DOMAIN_H;

      for (let row = 0; row < ROWS; row++) {
        const el = rowRefs.current[row];
        if (!el) continue;
        const rowPixels = grid[row].map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }));
        el.setAttribute("d", smoothPath(rowPixels));

        // Fold-lit weft (see BULGE_* above) — the row's own peak bulge
        // (not an average: a single raised point should light the whole
        // thread it's woven through) drives both a width and a color
        // lighten, the same "add a specular term to the base color" idiom
        // InsightsPanel.jsx's liquid shader uses, just on a stroke color
        // instead of a fragment color.
        const rowBulge = Math.max(...grid[row].map((p) => p.bulge));
        const t = rowBulge / BULGE_MAX;
        el.style.strokeWidth = `${ 2.4 + t * BULGE_WIDTH_GAIN_WEFT }px`;
        el.style.stroke = lightenHex(rowPaletteColor(row), t * BULGE_LIGHTEN_MAX);
        el.style.opacity = .8 + t * BULGE_OPACITY_GAIN;
      }

      for (let col = 0; col < COLS; col++) {
        const el = colRefs.current[col];
        if (!el) continue;
        const colPixels = [];
        let colBulge = 0;
        for (let row = 0; row < ROWS; row++) {
          const p = grid[row][col];
          colPixels.push({ x: p.x * scaleX, y: p.y * scaleY });
          if (p.bulge > colBulge) colBulge = p.bulge;
        }
        el.setAttribute("d", smoothPath(colPixels));

        // Warp stays hue-neutral on purpose (see BULGE_WIDTH_GAIN_WARP
        // above) — only width/opacity respond to bulge, never stroke color.
        const t = colBulge / BULGE_MAX;
        el.style.strokeWidth = `${ 1.4 + t * BULGE_WIDTH_GAIN_WARP }px`;
        el.style.opacity = .3 + t * BULGE_OPACITY_GAIN;
      }

      const trailEl = cutTrailRef.current;
      if (trailEl) {
        const trailPixels = cutTrail.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }));
        trailEl.setAttribute("d", smoothPath(trailPixels));
      }
    };

    tick();

    const handleVisibility = () => {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = null;
      } else if (!raf) {
        lastTime = performance.now();
        tick();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", handleVisibility);
      svg.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      resizeObserver.disconnect();
    };
  }, [active]);

  return (
    <>
      <svg ref={ svgRef } className="cloth-field-svg" aria-hidden="true">
        {/* The implied rod the anchor row hangs from — purely decorative,
            reinforces the "hanging cloth" read before anything has moved. */}
        <line className="cloth-field-rod" x1="4%" y1="8.5%" x2="96%" y2="8.5%" />
        {
          Array.from({ length: ROWS }, (_, row) => (
            <path
              key={ `row-${ row }` }
              ref={ (el) => { rowRefs.current[row] = el; } }
              className="cloth-field-thread cloth-field-weft"
              stroke={ rowPaletteColor(row) }
            />
          ))
        }
        {
          Array.from({ length: COLS }, (_, col) => (
            <path
              key={ `col-${ col }` }
              ref={ (el) => { colRefs.current[col] = el; } }
              className="cloth-field-thread cloth-field-warp"
            />
          ))
        }
        {/* The scissors' own trailing echo — see cutTrail in the mount
            effect above. Empty (smoothPath("") ) whenever no cut stroke is
            in progress. */}
        <path ref={ cutTrailRef } className="cloth-field-cut-trail" />
      </svg>

      <motion.button
        type="button"
        className={ `cloth-field-mode-toggle${ cutMode ? " is-active" : "" }` }
        aria-label={ cutMode ? "Cutting — click to grab instead" : "Grabbing — click to cut instead" }
        aria-pressed={ cutMode }
        whileHover={ reduceMotion ? undefined : { scale: 1.08 } }
        whileTap={ reduceMotion ? undefined : { scale: .92 } }
        transition={ SNAPPY }
        onClick={ () => setCutMode((m) => !m) }
      >
        { cutMode ? <FaScissors /> : <FaHand /> }
      </motion.button>
    </>
  );
};

// Cycles the note palette down the rows (the colorful weft threads),
// outside the component so it isn't recreated every render — the warp
// threads stay a flat ink color (see ClothField.css), the same
// warp-in-ink/weft-in-color split a real woven textile's own two thread
// systems would read as.
const rowPaletteColor = (row) => {
  const palette = Object.values(NOTE_COLORS);
  return palette[row % palette.length];
};

// Standard orientation-based proper segment intersection (do p1→p2 and
// p3→p4 actually cross, not just share a bounding box) — cross() is twice
// the signed area of the triangle its three points form, so its sign alone
// says which side of the p3→p4 line p1 falls on; the two segments cross
// exactly when p1/p2 fall on opposite sides of p3→p4 AND p3/p4 fall on
// opposite sides of p1→p2. Scoped to this file rather than utils/verlet.js
// — that module is the generic solver, this is specific to the scissors
// gesture's own hit-testing.
const cross = (ox, oy, ax, ay, bx, by) => (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);

const segmentsIntersect = (p1, p2, p3, p4) => {
  const d1 = cross(p3.x, p3.y, p4.x, p4.y, p1.x, p1.y);
  const d2 = cross(p3.x, p3.y, p4.x, p4.y, p2.x, p2.y);
  const d3 = cross(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
  const d4 = cross(p1.x, p1.y, p2.x, p2.y, p4.x, p4.y);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
};

// Additive channel brighten, same "add a specular term to the base color"
// idiom InsightsPanel.jsx's own liquid shader applies in float RGB — this
// is the plain-hex/DOM-style equivalent, clamped to 255 per channel.
const lightenHex = (hex, amount) => {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) + amount);
  const g = Math.min(255, ((n >> 8) & 255) + amount);
  const b = Math.min(255, (n & 255) + amount);
  return `rgb(${ r }, ${ g }, ${ b })`;
};

export default ClothField;
