import { useEffect, useMemo, useRef, useState } from "react";

import { NOTE_COLORS } from "../../constants/colors";

import "./NoteConstellation.css";

// A real force-directed graph layout — Fruchterman & Reingold, "Graph
// Drawing by Force-Directed Placement" (Software: Practice and Experience,
// 1991), the standard algorithm essentially every modern force-directed
// graph tool (d3-force included) descends from — applied here to the whole
// note collection: every note is a node, every pair of notes sharing at
// least one tag is an edge, and the layout itself is the physics, not a
// decoration on top of one. Two real forces, exactly as the paper defines
// them (k is the "ideal" spacing derived below, not a free parameter):
//   repulsive:  fr(d) = k² / d   — between EVERY pair of nodes
//   attractive: fa(d) = d² / k   — between nodes actually joined by an edge
// A node with no shared tags with anything simply never feels an attractive
// force, and drifts wherever the repulsion from everything else and the
// weak center-pull below leave it — which is exactly the honest picture:
// an untagged note has no relationships to show.
//
// The paper's own convergence mechanism is a temperature-cooling schedule
// (bounded per-iteration displacement, shrinking over a fixed iteration
// count) — not what this uses, since this is a live, continuously
// draggable simulation rather than a run-once layout pass. Instead this
// integrates the same two force formulas continuously with velocity
// damping, the same adaptation d3-force and most interactive force-graph
// tools make for exactly this reason: a temperature schedule assumes the
// simulation eventually stops for good, where a draggable one needs to
// keep responding indefinitely.
//
// k = C·√(area/n) (C = 1, the paper's own default): the ideal edge length
// that spaces n nodes evenly across the given area — which is also why
// this needs no per-note-count tuning as the desk grows or shrinks; k
// simply shrinks to keep the same area comfortably packed.
const DOMAIN_W = 160;
const DOMAIN_H = 100;
const FR_CONSTANT = 1;
const MIN_DIST = 3; // softening floor, domain units — avoids the 1/d singularity as two nodes approach
const CENTER_STRENGTH = 0.015; // weak pull toward the domain center, keeps untagged/disconnected notes from drifting to infinity
const DAMPING = 0.9; // per-substep velocity retention
const VELOCITY_CLAMP = 70;
const SUBSTEPS = 2;
// A synchronous pre-settle pass for reduced motion: freezing at the random
// spawn scatter (this file's own honest starting point, chosen to avoid
// the zero-distance singularity every node exactly overlapping would
// cause) would show reduced-motion visitors a meaningless jumble rather
// than the actual layout — running the same step() this many times before
// ever rendering gets a converged, legible graph with no continuous
// animation at all, which is what reduced motion actually asks for.
const SETTLE_ITERATIONS = 220;
const SETTLE_DT = 0.045;
const EDGE_WEIGHT_BONUS = 0.3; // extra attraction per shared tag beyond the first

const NODE_RADIUS_BASE = 13;
const NODE_RADIUS_PER_EDGE = 2;
const NODE_RADIUS_MAX = 26;

const truncateTitle = (title) => {
  const text = (title || "Untitled").trim() || "Untitled";
  return text.length > 20 ? `${ text.slice(0, 19) }…` : text;
};

const NoteConstellation = ({ active, notes, onSelectNote, reduceMotion = false }) => {
  const svgRef = useRef(null);
  const nodeElRefs = useRef({});
  const edgeElRefs = useRef([]);
  const [graph, setGraph] = useState({ nodes: [], edges: [] });
  const [hoveredId, setHoveredId] = useState(null);

  const notesRef = useRef(notes);
  notesRef.current = notes;
  const onSelectRef = useRef(onSelectNote);
  onSelectRef.current = onSelectNote;
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

  // Every note connected to (or, via itself, matching) the hovered one —
  // recomputed only on hover change, not every physics frame, since it
  // drives ordinary React class toggling rather than the imperative
  // per-frame position writes below.
  const connectedIds = useMemo(() => {
    if (!hoveredId) return null;
    const set = new Set([hoveredId]);
    graph.edges.forEach((edge) => {
      if (edge.a === hoveredId) set.add(edge.b);
      if (edge.b === hoveredId) set.add(edge.a);
    });
    return set;
  }, [hoveredId, graph.edges]);

  const degreeById = useMemo(() => {
    const map = new Map();
    graph.edges.forEach((edge) => {
      map.set(edge.a, (map.get(edge.a) || 0) + 1);
      map.set(edge.b, (map.get(edge.b) || 0) + 1);
    });
    return map;
  }, [graph.edges]);

  useEffect(() => {
    const noteList = notesRef.current;
    if (!active || noteList.length === 0) return undefined;

    const svg = svgRef.current;

    const cx = DOMAIN_W / 2;
    const cy = DOMAIN_H / 2;

    // Scattered in a random ring around the center rather than all spawned
    // at one point — every node starting at the exact same position would
    // make every pairwise distance in the repulsion pass below exactly
    // zero, which MIN_DIST softens but which still means the very first
    // substep has no real directional information to push nodes apart
    // with (a normalized zero vector is undefined).
    const byId = new Map();
    noteList.forEach((note) => {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * Math.min(DOMAIN_W, DOMAIN_H) * 0.35;
      byId.set(note.id, {
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        fx: 0,
        fy: 0,
        dragging: false,
      });
    });

    const edgeList = [];
    for (let i = 0; i < noteList.length; i++) {
      const tagsA = noteList[i].tags || [];
      if (tagsA.length === 0) continue;
      for (let j = i + 1; j < noteList.length; j++) {
        const tagsB = noteList[j].tags || [];
        if (tagsB.length === 0) continue;
        const shared = tagsA.filter((t) => tagsB.includes(t)).length;
        if (shared > 0) edgeList.push({ id: `${ noteList[i].id }:${ noteList[j].id }`, a: noteList[i].id, b: noteList[j].id, weight: shared });
      }
    }

    setGraph({ nodes: noteList, edges: edgeList });

    const k = FR_CONSTANT * Math.sqrt((DOMAIN_W * DOMAIN_H) / Math.max(1, noteList.length));

    // One substep — the two Fruchterman-Reingold force formulas from the
    // file header, applied all-pairs for repulsion (O(n²) — fine at the
    // note counts a personal desk realistically reaches; a spatial grid
    // like utils/sphGrid.js's would only start paying for itself well
    // beyond that) and edge-pairs-only for attraction, then a weak center
    // pull and damped-velocity integration.
    const step = (dt) => {
      byId.forEach((node) => { node.fx = 0; node.fy = 0; });

      const ids = Array.from(byId.keys());
      for (let i = 0; i < ids.length; i++) {
        const a = byId.get(ids[i]);
        for (let j = i + 1; j < ids.length; j++) {
          const b = byId.get(ids[j]);
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.max(MIN_DIST, Math.hypot(dx, dy));
          const force = (k * k) / dist;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.fx -= fx; a.fy -= fy;
          b.fx += fx; b.fy += fy;
        }
      }

      for (const edge of edgeList) {
        const a = byId.get(edge.a);
        const b = byId.get(edge.b);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(MIN_DIST, Math.hypot(dx, dy));
        const weightScale = 1 + EDGE_WEIGHT_BONUS * (edge.weight - 1);
        const force = ((dist * dist) / k) * weightScale;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.fx += fx; a.fy += fy;
        b.fx -= fx; b.fy -= fy;
      }

      byId.forEach((node) => {
        if (node.dragging) return;

        node.fx -= (node.x - cx) * CENTER_STRENGTH;
        node.fy -= (node.y - cy) * CENTER_STRENGTH;

        node.vx = (node.vx + node.fx * dt) * DAMPING;
        node.vy = (node.vy + node.fy * dt) * DAMPING;

        const speed = Math.hypot(node.vx, node.vy);
        if (speed > VELOCITY_CLAMP) {
          node.vx = (node.vx / speed) * VELOCITY_CLAMP;
          node.vy = (node.vy / speed) * VELOCITY_CLAMP;
        }

        node.x += node.vx * dt;
        node.y += node.vy * dt;
      });
    };

    if (reduceMotionRef.current) {
      for (let i = 0; i < SETTLE_ITERATIONS; i++) step(SETTLE_DT);
    }

    const domainFromEvent = (e) => {
      const rect = svg.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * DOMAIN_W,
        y: ((e.clientY - rect.top) / rect.height) * DOMAIN_H,
      };
    };

    // Drag state lives here rather than per-node — only one node is ever
    // grabbed at a time, and this needs to track the raw pixel distance
    // (for the click-vs-drag threshold, same convention ClothField.jsx and
    // HistoryConstellation.jsx both already use) separately from the
    // domain-space velocity a release hands back to the node.
    const drag = { id: null, lastClientX: 0, lastClientY: 0, lastDomainX: 0, lastDomainY: 0, lastT: 0, pixelDistance: 0, vx: 0, vy: 0 };

    // Disabled outright under reduced motion — same choice ClothField.jsx
    // makes and for the same reason: a grabbed node doesn't just move
    // itself, it displaces everything the repulsion force still feels it
    // pushing against, which is exactly the kind of cascading motion
    // reduced motion asks this app not to introduce on its own.
    const handleDown = (e) => {
      if (reduceMotionRef.current) return;
      const target = e.target.closest("[data-note-id]");
      if (!target) return;
      const id = target.getAttribute("data-note-id");
      const node = byId.get(id);
      if (!node) return;

      node.dragging = true;
      const { x, y } = domainFromEvent(e);
      drag.id = id;
      drag.pixelDistance = 0;
      drag.lastClientX = e.clientX;
      drag.lastClientY = e.clientY;
      drag.lastDomainX = x;
      drag.lastDomainY = y;
      drag.lastT = performance.now();
      drag.vx = 0;
      drag.vy = 0;
    };

    const handleMove = (e) => {
      if (!drag.id) return;
      const node = byId.get(drag.id);
      if (!node) return;

      drag.pixelDistance += Math.abs(e.clientX - drag.lastClientX) + Math.abs(e.clientY - drag.lastClientY);
      drag.lastClientX = e.clientX;
      drag.lastClientY = e.clientY;

      const now = performance.now();
      const dt = Math.max(0.001, (now - drag.lastT) / 1000);
      const { x, y } = domainFromEvent(e);
      // Implied velocity from this move alone — a little noisy frame to
      // frame, but only the very last of these ever gets used (on
      // release, below), the same "just read the latest instantaneous
      // rate" approach FluidField.jsx's own cursor speedBoost already uses.
      drag.vx = (x - drag.lastDomainX) / dt;
      drag.vy = (y - drag.lastDomainY) / dt;
      drag.lastDomainX = x;
      drag.lastDomainY = y;
      drag.lastT = now;

      node.x = x;
      node.y = y;
    };

    const handleUp = () => {
      if (!drag.id) return;
      const node = byId.get(drag.id);
      if (node) {
        node.dragging = false;
        // Hands off whatever velocity the last drag move implied, rather
        // than dropping the node dead at zero speed — a flung node keeps
        // drifting and gets caught by the same forces as everything else.
        node.vx = drag.vx;
        node.vy = drag.vy;
      }
      if (drag.pixelDistance < 6) onSelectRef.current?.(drag.id);
      drag.id = null;
    };

    svg.addEventListener("pointerdown", handleDown);
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);

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

      const rect = svg.getBoundingClientRect();
      const scaleX = rect.width / DOMAIN_W;
      const scaleY = rect.height / DOMAIN_H;

      byId.forEach((node, id) => {
        const el = nodeElRefs.current[id];
        if (el) el.setAttribute("transform", `translate(${ node.x * scaleX },${ node.y * scaleY })`);
      });

      edgeList.forEach((edge, i) => {
        const el = edgeElRefs.current[i];
        if (!el) return;
        const a = byId.get(edge.a);
        const b = byId.get(edge.b);
        el.setAttribute("x1", a.x * scaleX);
        el.setAttribute("y1", a.y * scaleY);
        el.setAttribute("x2", b.x * scaleX);
        el.setAttribute("y2", b.y * scaleY);
      });
    };

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

    tick();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", handleVisibility);
      svg.removeEventListener("pointerdown", handleDown);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [active]);

  return (
    <svg ref={ svgRef } className="note-constellation-svg" aria-hidden="true">
      <g className="note-constellation-edges">
        {
          graph.edges.map((edge, i) => {
            const dimmed = hoveredId && edge.a !== hoveredId && edge.b !== hoveredId;
            return (
              <line
                key={ edge.id }
                ref={ (el) => { edgeElRefs.current[i] = el; } }
                className={ `note-constellation-edge ${ dimmed ? "dimmed" : "" }` }
              />
            );
          })
        }
      </g>
      <g className="note-constellation-nodes">
        {
          graph.nodes.map((note) => {
            const degree = degreeById.get(note.id) || 0;
            const radius = Math.min(NODE_RADIUS_MAX, NODE_RADIUS_BASE + degree * NODE_RADIUS_PER_EDGE);
            const dimmed = connectedIds && !connectedIds.has(note.id);
            const color = NOTE_COLORS[note.color] || "var(--page-ink-color)";

            return (
              <g
                key={ note.id }
                data-note-id={ note.id }
                ref={ (el) => { nodeElRefs.current[note.id] = el; } }
                className={ `note-constellation-node ${ dimmed ? "dimmed" : "" }` }
                onPointerEnter={ () => setHoveredId(note.id) }
                onPointerLeave={ () => setHoveredId((current) => (current === note.id ? null : current)) }
              >
                <circle r={ radius } fill={ color } />
                <text className="note-constellation-label" y={ radius + 14 }>{ truncateTitle(note.title) }</text>
              </g>
            );
          })
        }
      </g>
    </svg>
  );
};

export default NoteConstellation;
