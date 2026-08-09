import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import gsap from "gsap";
import { interpret } from "xstate";
import { FaStar } from "react-icons/fa6";

import { NOTE_COLORS } from "../../constants/colors";
import { blobPath, createBlobMorph } from "../../utils/blob";
import { SNAPPY } from "../Motion";
import { constellationMachine, DIVE_DURATION_MS } from "./ConstellationState";

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

// Blob shapes — see utils/blob.js's own blobPath for the actual Catmull-Rom
// construction (the same one every dot-to-sheet panel's own reveal already
// uses via useBlobClipMorph). Both shapes share one box size per node (see
// getShapes below) — deliberately NOT a bigger box for the hover shape,
// since flubber's interpolate() matches raw path coordinates between two
// shapes, and two boxes of different sizes don't share a center; growing
// on hover is instead a plain uniform scale (hoverScale, composed into the
// same transform the tick loop already writes), while the morph itself
// only ever changes the silhouette's own wobble.
const BLOB_POINTS_REST = 8;
const BLOB_IRREGULARITY_REST = 0.28;
const BLOB_POINTS_HOVER = 10;
const BLOB_IRREGULARITY_HOVER = 0.46;
const HOVER_SCALE_BOOST = 0.32; // a fully-hovered node grows to 1.32× its resting size
const HOVER_MORPH_DURATION = 0.45;

// Bloom-in on open — GSAP staggered elastic entrance, the same technique
// HistoryConstellation.jsx's own uReveal sweep uses, just driving a
// per-node scale here instead of a shared shader uniform (this is DOM/SVG,
// not WebGL, so there's no single uniform to sweep).
const BLOOM_DURATION = 0.85;
const BLOOM_STAGGER = 0.028;

const truncateTitle = (title) => {
  const text = (title || "Untitled").trim() || "Untitled";
  return text.length > 20 ? `${ text.slice(0, 19) }…` : text;
};

const NoteConstellation = ({ active, notes, onSelectNote, reduceMotion = false }) => {
  const svgRef = useRef(null);
  const nodeElRefs = useRef({});
  const edgeElRefs = useRef([]);
  const blobPathElRefs = useRef({});
  const cardElRef = useRef(null);
  const shapeCacheRef = useRef(new Map());
  const morphControllerRef = useRef(null);

  const [graph, setGraph] = useState({ nodes: [], edges: [] });
  const [hoveredId, setHoveredId] = useState(null);
  const [phase, setPhase] = useState("idle");
  const [selectedId, setSelectedId] = useState(null);
  // A stable service instance for this component's whole lifetime — same
  // useState-initializer convention SprintPanel.jsx's own interpret() call
  // already uses, so it isn't recreated every render.
  const [service] = useState(() => interpret(constellationMachine));

  const notesRef = useRef(notes);
  notesRef.current = notes;
  const onSelectRef = useRef(onSelectNote);
  onSelectRef.current = onSelectNote;
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  const hoveredIdRef = useRef(hoveredId);
  hoveredIdRef.current = hoveredId;

  // See ConstellationState.js's own header comment for why onSelectNote is
  // only ever called from here, once the machine reaches "done" — never
  // directly from the pointerup handler further down.
  useEffect(() => {
    service.onTransition((state) => {
      setPhase(String(state.value));
      setSelectedId(state.context.selectedId);
      if (state.value === "done") onSelectRef.current?.(state.context.selectedId);
    }).start();
    return () => service.stop();
  }, [service]);

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

  const hoveredNote = useMemo(
    () => (hoveredId ? graph.nodes.find((note) => note.id === hoveredId) || null : null),
    [hoveredId, graph.nodes]
  );

  // Cached per-note, keyed on radius too — regenerated only when a note's
  // own degree actually changes (which only happens when the panel reopens
  // and rebuilds the whole graph), not on every render.
  const getShapes = (id, radius) => {
    const cached = shapeCacheRef.current.get(id);
    if (cached && cached.radius === radius) return cached;

    const size = radius * 2;
    const entry = {
      radius,
      offset: -radius,
      rest: blobPath(size, size, BLOB_POINTS_REST, BLOB_IRREGULARITY_REST),
      hover: blobPath(size, size, BLOB_POINTS_HOVER, BLOB_IRREGULARITY_HOVER),
    };
    shapeCacheRef.current.set(id, entry);
    return entry;
  };

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
        revealScale: reduceMotionRef.current ? 1 : 0,
        hoverScale: 1,
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
    } else {
      // GSAP staggered bloom — tweens each node's own revealScale from 0→1
      // with an elastic overshoot; the tick loop below folds it into the
      // transform it already writes every frame, so this needs no special
      // rendering path of its own.
      gsap.to(Array.from(byId.values()), {
        revealScale: 1,
        duration: BLOOM_DURATION,
        ease: "elastic.out(1, 0.55)",
        stagger: { each: BLOOM_STAGGER, from: "random" },
      });
    }

    // Hover-blob morphing — a real flubber shape interpolation between each
    // node's resting and hover silhouettes (see the file header on why both
    // share one box size), built lazily the first time a given node is
    // actually hovered rather than upfront for all of them, since most
    // nodes on a large desk are never hovered in a given session.
    const blobMorphers = new Map();
    const getMorpher = (id) => {
      let entry = blobMorphers.get(id);
      if (entry) return entry;

      const pathEl = blobPathElRefs.current[id];
      const shapes = shapeCacheRef.current.get(id);
      if (!pathEl || !shapes) return null;

      const morph = createBlobMorph(pathEl, [shapes.rest, shapes.hover]);
      morph.set(0);
      entry = { morph, drive: { t: 0 } };
      blobMorphers.set(id, entry);
      return entry;
    };

    const morphTo = (id, target) => {
      const entry = getMorpher(id);
      if (!entry) return;
      const node = byId.get(id);

      const apply = (t) => {
        entry.morph.set(t);
        if (node) node.hoverScale = 1 + t * HOVER_SCALE_BOOST;
      };

      if (reduceMotionRef.current) {
        entry.drive.t = target;
        apply(target);
        return;
      }

      gsap.to(entry.drive, {
        t: target,
        duration: HOVER_MORPH_DURATION,
        ease: "elastic.out(1, .55)",
        overwrite: "auto",
        onUpdate: () => apply(entry.drive.t),
      });
    };

    morphControllerRef.current = {
      enter: (id) => morphTo(id, 1),
      leave: (id) => morphTo(id, 0),
    };

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

    // The physics-displacing part of a drag (node.dragging = true, and
    // handleMove below actually repositioning it) is disabled under
    // reduced motion — same choice ClothField.jsx makes and for the same
    // reason: a grabbed node doesn't just move itself, it displaces
    // everything the repulsion force still feels it pushing against, which
    // is exactly the kind of cascading motion reduced motion asks this app
    // not to introduce on its own. Click-to-select still has to work
    // though — this still tracks pixelDistance either way, purely so
    // handleUp below can tell a stationary click from a drag attempt.
    const handleDown = (e) => {
      const target = e.target.closest("[data-note-id]");
      if (!target) return;
      const id = target.getAttribute("data-note-id");
      const node = byId.get(id);
      if (!node) return;

      if (!reduceMotionRef.current) node.dragging = true;
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

      if (reduceMotionRef.current) return;

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
      // A confirmed click (not a drag) hands off to the xstate machine
      // rather than calling onSelectNote directly — see
      // ConstellationState.js for why the actual callback only ever fires
      // once the "diving" flourish this triggers has finished playing.
      if (drag.pixelDistance < 6) service.send({ type: "SELECT", id: drag.id });
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
        if (el) {
          const scale = (node.revealScale ?? 1) * (node.hoverScale ?? 1);
          el.setAttribute("transform", `translate(${ node.x * scaleX },${ node.y * scaleY }) scale(${ scale })`);
        }
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

      // The hover card follows its node every frame, since the graph keeps
      // moving underneath it — clamped to the stage's own bounds the same
      // way HistoryConstellation.jsx's own hover label already is.
      if (hoveredIdRef.current) {
        const node = byId.get(hoveredIdRef.current);
        const card = cardElRef.current;
        if (node && card) {
          const px = Math.min(Math.max(node.x * scaleX, 90), rect.width - 90);
          const py = Math.max(node.y * scaleY, 70);
          card.style.transform = `translate(${ px }px, ${ py }px) translate(-50%, -125%)`;
        }
      }
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
      gsap.killTweensOf(Array.from(byId.values()));
      blobMorphers.forEach(({ drive }) => gsap.killTweensOf(drive));
      morphControllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // The "dive into the note" flourish — zooms the whole graph toward the
  // selected node and fades its threads, timed to finish right as
  // ConstellationState.js's own DIVE_DURATION_MS elapses and the machine
  // reaches "done" (which is what actually fires onSelectNote). See that
  // file for why this lives behind a real state machine rather than a
  // plain boolean flag.
  useEffect(() => {
    if (phase !== "diving" || !selectedId) return undefined;

    const svg = svgRef.current;
    const nodeEl = nodeElRefs.current[selectedId];
    const edgesGroup = svg?.querySelector(".note-constellation-edges");
    if (!svg || !nodeEl) return undefined;

    const nodeRect = nodeEl.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    const originX = nodeRect.left + nodeRect.width / 2 - svgRect.left;
    const originY = nodeRect.top + nodeRect.height / 2 - svgRect.top;
    svg.style.transformOrigin = `${ originX }px ${ originY }px`;

    // A little short of the machine's own DIVE_DURATION_MS so the zoom
    // visibly finishes (rather than getting cut mid-tween) before the
    // panel closes and hands off to the editor.
    const duration = DIVE_DURATION_MS / 1000 - 0.04;
    const tweenFn = reduceMotionRef.current ? gsap.set : gsap.to;
    tweenFn(svg, { scale: 3.2, duration, ease: "power3.in" });
    if (edgesGroup) tweenFn(edgesGroup, { opacity: 0, duration: duration * 0.6, ease: "power1.in" });

    return () => {
      gsap.killTweensOf(svg);
      if (edgesGroup) gsap.killTweensOf(edgesGroup);
    };
  }, [phase, selectedId]);

  return (
    <>
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
              const shapes = getShapes(note.id, radius);

              return (
                <g
                  key={ note.id }
                  data-note-id={ note.id }
                  ref={ (el) => { nodeElRefs.current[note.id] = el; } }
                  className={ `note-constellation-node ${ dimmed ? "dimmed" : "" }` }
                  onPointerEnter={ () => { setHoveredId(note.id); morphControllerRef.current?.enter(note.id); } }
                  onPointerLeave={ () => { setHoveredId((c) => (c === note.id ? null : c)); morphControllerRef.current?.leave(note.id); } }
                >
                  <path
                    ref={ (el) => { blobPathElRefs.current[note.id] = el; } }
                    className="note-constellation-blob"
                    transform={ `translate(${ shapes.offset },${ shapes.offset })` }
                    d={ shapes.rest }
                    fill={ color }
                  />
                  <text className="note-constellation-label" y={ radius + 16 }>{ truncateTitle(note.title) }</text>
                </g>
              );
            })
          }
        </g>
      </svg>
      <AnimatePresence>
        {
          hoveredNote && phase !== "diving" && (
            <motion.div
              ref={ cardElRef }
              className="note-constellation-card"
              initial={{ opacity: 0, scale: .85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: .85, transition: { duration: .15 } }}
              transition={ SNAPPY }
            >
              <span
                className="note-constellation-card-swatch"
                style={{ backgroundColor: NOTE_COLORS[hoveredNote.color] || "var(--page-ink-color)" }}
              />
              <div className="note-constellation-card-body">
                <div className="note-constellation-card-title-row">
                  <span className="note-constellation-card-title">{ hoveredNote.title || "Untitled" }</span>
                  { hoveredNote.favorite && <FaStar className="note-constellation-card-favorite" /> }
                </div>
                {
                  hoveredNote.tags?.length > 0 && (
                    <div className="note-constellation-card-tags">
                      { hoveredNote.tags.map((tag) => <span key={ tag } className="note-constellation-card-tag">#{ tag }</span>) }
                    </div>
                  )
                }
              </div>
            </motion.div>
          )
        }
      </AnimatePresence>
    </>
  );
};

export default NoteConstellation;
