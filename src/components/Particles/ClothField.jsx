import { useEffect, useRef } from "react";

import { NOTE_COLORS } from "../../constants/colors";
import { smoothPath } from "../../utils/svgPath";
import { createPoint, integratePoint, relaxConstraints } from "../../utils/verlet";

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

const ClothField = ({ active, reduceMotion = false }) => {
  const svgRef = useRef(null);
  const rowRefs = useRef([]);
  const colRefs = useRef([]);
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

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

    let elapsed = 0;
    // The one point currently under the pointer, if any — forced to track
    // the cursor each substep (px lagging one step behind x, same as
    // integratePoint's own implied-velocity bookkeeping) rather than
    // teleported, so releasing it hands off real velocity from the last
    // couple of dragged frames instead of dropping it with zero speed.
    let draggedPoint = null;
    const dragTarget = { x: 0, y: 0 };

    const domainFromEvent = (e) => {
      const rect = svg.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width;
      const ny = (e.clientY - rect.top) / rect.height;
      return { x: nx * DOMAIN_W, y: ny * DOMAIN_H };
    };

    const handlePointerDown = (e) => {
      if (reduceMotionRef.current) return;
      const { x, y } = domainFromEvent(e);

      let nearest = null;
      let nearestDist = GRAB_RADIUS;
      for (const p of points) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < nearestDist) { nearest = p; nearestDist = d; }
      }
      if (!nearest) return;

      draggedPoint = nearest;
      draggedPoint.pinned = true;
      dragTarget.x = x;
      dragTarget.y = y;
    };

    const handlePointerMove = (e) => {
      if (!draggedPoint) return;
      const { x, y } = domainFromEvent(e);
      dragTarget.x = x;
      dragTarget.y = y;
    };

    const handlePointerUp = () => {
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

    const step = (dt) => {
      elapsed += dt;

      if (draggedPoint) {
        draggedPoint.px = draggedPoint.x;
        draggedPoint.py = draggedPoint.y;
        draggedPoint.x = dragTarget.x;
        draggedPoint.y = dragTarget.y;
      }

      for (const p of points) {
        if (p === draggedPoint || p.pinned) continue;

        const windX = Math.sin(elapsed * 0.9 + p.gridY * WIND_ROW_PHASE + p.gridX * WIND_COL_PHASE) * WIND_STRENGTH;
        integratePoint(p, dt, windX, GRAVITY, DAMPING);

        // A generous domain-edge clamp, same defensive spirit as
        // FluidField's own boundary handling — not a wall this cloth is
        // meant to be felt bouncing off, just a backstop so a hard fling
        // can never draw a point off the visible stage entirely.
        p.x = Math.max(-20, Math.min(DOMAIN_W + 20, p.x));
        p.y = Math.max(-20, Math.min(DOMAIN_H + 20, p.y));
      }

      relaxConstraints(constraints, CONSTRAINT_ITERATIONS);
    };

    let lastTime = performance.now();
    let raf = null;

    const tick = () => {
      raf = requestAnimationFrame(tick);

      const now = performance.now();
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      if (!reduceMotionRef.current) {
        const subDt = dt / SUBSTEPS;
        for (let s = 0; s < SUBSTEPS; s++) step(subDt);
      }

      const scaleX = dims.w / DOMAIN_W;
      const scaleY = dims.h / DOMAIN_H;

      for (let row = 0; row < ROWS; row++) {
        const el = rowRefs.current[row];
        if (!el) continue;
        const rowPixels = grid[row].map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }));
        el.setAttribute("d", smoothPath(rowPixels));
      }

      for (let col = 0; col < COLS; col++) {
        const el = colRefs.current[col];
        if (!el) continue;
        const colPixels = [];
        for (let row = 0; row < ROWS; row++) colPixels.push({ x: grid[row][col].x * scaleX, y: grid[row][col].y * scaleY });
        el.setAttribute("d", smoothPath(colPixels));
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
    </svg>
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

export default ClothField;
