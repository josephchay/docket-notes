import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import gsap from "gsap";
import Matter from "matter-js";
import { interpret } from "xstate";
import { FaArrowsRotate, FaCamera, FaCircleNodes, FaCircleQuestion, FaDice, FaDove, FaEarListen, FaImagePortrait, FaLayerGroup, FaMagnifyingGlass, FaMagnifyingGlassLocation, FaPalette, FaShareNodes, FaStar, FaSun, FaTableCells, FaXmark } from "react-icons/fa6";

import { NOTE_COLORS } from "../../constants/colors";
import { blobPath, closedCatmullRomPath, createBlobMorph } from "../../utils/blob";
import { catenaryBelly, catenaryPath } from "../../utils/catenary";
import { convexHull, expandHull, pointInPolygon } from "../../utils/hull";
import { InkSurface } from "../../utils/inkSurface";
import { metaballBridge } from "../../utils/metaball";
import { curlNoise2 } from "../../utils/noise";
import { Quadtree } from "../../utils/quadtree";
import { playDrip, playImpact, playMembrane, playStamp, playThreadPluck, playTick, stopPoolVoice, updatePoolVoice } from "../../utils/sound";
import { voronoiCells } from "../../utils/voronoi";
import { smoothPath } from "../../utils/svgPath";
import { createPoint, integratePoint, satisfyConstraint } from "../../utils/verlet";
import { SNAPPY, SETTLE, POP } from "../Motion";
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
//
// Repulsion (the all-pairs half — attraction is edge-pairs-only, already
// far cheaper) now runs through utils/quadtree.js's own Barnes-Hut
// approximation rather than a direct O(n²) double loop: every substep, the
// current positions get bucketed into a fresh quadtree, and each node's
// own repulsion total is accumulated by walking that tree rather than
// visiting every other node individually — see BARNES_HUT_THETA below for
// the accuracy/speed tradeoff that walk makes. The physics themselves are
// unchanged (this approximates the exact same fr(d) = k²/d sum, not a
// different force), and at the note counts a personal desk realistically
// reaches, the two are close enough in raw runtime that the honest reason
// to still do this is complexity, not a measured bottleneck — O(n log n)
// is what keeps this from becoming one as a desk's own collection grows
// well past what anyone would actually sit and watch an O(n²) version of
// this struggle with.
const DOMAIN_W = 160;
const DOMAIN_H = 100;
const FR_CONSTANT = 1;
const MIN_DIST = 3; // softening floor, domain units — avoids the 1/d singularity as two nodes approach
// Barnes-Hut's own accuracy/speed knob (see Quadtree.accumulateForce's own
// comment for the full reasoning) — 0.8 rather than the 0.5 more common in
// scientific N-body work, since this only ever needs to look structurally
// right, not carry a precise force value anywhere.
const BARNES_HUT_THETA = 0.8;
const CENTER_STRENGTH = 0.015; // weak pull toward the domain center, keeps untagged/disconnected notes from drifting to infinity
// An ambient force toward wherever the cursor currently sits over the
// graph — ever-present, not just felt while actually grabbing a node —
// the same "gravity well around the pointer" idea HistoryConstellation.jsx
// already uses, but a genuinely different implementation of it: that
// file's own version is a shader-side vertex offset (a rendering trick
// with no mass or momentum behind it); this is a real force, accumulated
// into node.fx/fy alongside repulsion/attraction/center-pull and
// integrated through the exact same damped system, so a node the cursor
// passes near actually picks up real velocity and coasts rather than
// snapping to a rendering-only offset. Smoothstep falloff (0 at
// CURSOR_FIELD_RADIUS, full strength at the cursor itself) rather than a
// hard cutoff, so nodes entering/leaving the field's own reach do so
// smoothly instead of catching a force discontinuity.
const CURSOR_FIELD_RADIUS = 24;
const CURSOR_FIELD_STRENGTH = 6;
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

// A pure function rather than the inline Math.min JSX used to compute
// directly — the physics effect now needs this exact same formula too
// (see the byId radiusPx assignment further down, for collision
// resolution), and a second independently-drifting copy of it is exactly
// what this codebase already avoids elsewhere (utils/sph.js's own reason
// for existing, e.g.).
const radiusForDegree = (degree) => Math.min(NODE_RADIUS_MAX, NODE_RADIUS_BASE + degree * NODE_RADIUS_PER_EDGE);

// The breathing silhouette at time t (see the BREATH_AMP constant block) —
// the same box coordinates blobPath itself uses (a size×size box with the
// shape centered at radius,radius), so it drops into the existing
// translate(offset,offset) rendering unchanged. t = 0 IS the rest shape:
// the static path cached in getShapes, the hover morph's own endpoint, and
// what reduced motion shows are all this exact function at zero.
// `dents` (optional, local px per anchor — see the DIMPLE constants) pulls
// individual anchors inward: the contact dimples' per-anchor flattening,
// clamped so no dent can push an anchor through the blob's own middle.
const breathingBlobPath = (radius, anchors, t, dents = null) =>
  closedCatmullRomPath(anchors.map(({ angle, wobble, phase, speed }, i) => {
    let r = radius * wobble * (1 + BREATH_AMP * Math.sin(BREATH_OMEGA * t * speed + phase));
    if (dents) r = Math.max(radius * 0.45, r - dents[i]);
    return [radius + Math.cos(angle) * r, radius + Math.sin(angle) * r];
  }));

// Chord length → pitch (see the PLUCK_SOUND constants for why this is
// linear rather than the literal 1/L).
const pluckFrequency = (spanPx) =>
  PLUCK_FREQ_MAX - (PLUCK_FREQ_MAX - PLUCK_FREQ_MIN) * Math.min(1, spanPx / PLUCK_SPAN_REF);

// The harmonic pluck — every thread now rings in its first three
// standing-wave modes, and WHERE it was plucked decides the mix. A string
// plucked at fraction p of its span takes mode n with amplitude
// ∝ sin(nπp)/n — the Fourier coefficients of the triangular shape a real
// pluck actually leaves (the exact 1/n² law rings too politely at three
// modes; 1/n keeps the physics' shape with a visible upper end). So a
// mid-pluck is nearly pure fundamental (sin(2π/2) = 0 — mode 2 has a
// node under the finger), an end-pluck genuinely wriggles, and the
// returned brightness (the upper modes' share of the total) hands the
// same fact to playThreadPluck's own timbre. One funnel for every
// excitation — sweep, fling, tow, ping, sonar, keyboard — each of which
// now reports its own honest pluck point. Phases reset together so the
// thread departs rest as one shape, and each mode's cap scales down by
// its own 1/n, matching the amplitudes it can honestly reach.
const pluckEdge = (edge, amp, p = 0.5) => {
  const pp = Math.max(0.05, Math.min(0.95, p));
  const a1 = amp * Math.abs(Math.sin(Math.PI * pp));
  const a2 = (amp * Math.abs(Math.sin(2 * Math.PI * pp))) / 2;
  const a3 = (amp * Math.abs(Math.sin(3 * Math.PI * pp))) / 3;
  edge.vibAmp = Math.min(PLUCK_MAX_AMP, edge.vibAmp + a1);
  edge.vibAmp2 = Math.min(PLUCK_MAX_AMP / 2, edge.vibAmp2 + a2);
  edge.vibAmp3 = Math.min(PLUCK_MAX_AMP / 3, edge.vibAmp3 + a3);
  edge.vibPhase = 0;
  edge.vibPhase2 = 0;
  edge.vibPhase3 = 0;
  const total = a1 + a2 + a3;
  return total > 0 ? (a2 + a3) / total : 0;
};

// Collision resolution — a real distance constraint (the same "push both
// circles apart until their surfaces no longer overlap" idea
// utils/verlet.js's own satisfyConstraint already applies to cloth edges,
// just with a MINIMUM separation instead of an exact target length) run as
// a position correction after the FR forces have already integrated, not
// another force — repulsion alone has no notion of a node's own rendered
// radius (a purely abstract k-based spacing), so two low-degree
// (small-radius) nodes can still end up rendered close enough to visually
// overlap even sitting at FR equilibrium. All-pairs rather than routed
// through the Barnes-Hut tree: a plain distance compare and occasional
// small push is cheap enough per pair that the tree's own setup cost
// wouldn't pay for itself here the way it does for repulsion's own
// heavier force math (see the file header's own note on that same
// complexity-vs-measured-bottleneck tradeoff).
const COLLISION_ITERATIONS = 2;
const COLLISION_PADDING = 2; // extra breathing room, domain units, beyond bare surface contact

// Bounce — the position correction above stops two notes overlapping;
// this is what makes a hard collision actually READ as an impact rather
// than a gentle cessation. A real 1D impulse along the contact normal
// (the standard elastic-collision resolution every simple physics engine
// uses — Box2D's own "sequential impulses" solver is this same formula
// applied per-contact): reflect the CONVERGING component of the two
// notes' relative velocity into a diverging one, scaled by restitution,
// split by inverse mass exactly like the position correction just above
// already splits by aFree/bFree — pinned or dragged notes have zero
// inverse mass, so they still deal a bounce without ever taking one,
// same story collision's own weighting already tells. Restitution is
// deliberately low: this is paper meeting paper, not rubber balls — a
// soft, weighty rebound, not a ping-pong ricochet. Self-limiting by
// construction (the standard reason this class of solver never needs
// separate "already resolved" bookkeeping): reflecting the converging
// velocity makes it diverging, so the very same convergence test simply
// won't re-fire for this pair next substep unless something else pushes
// them back together — no per-pair state to track, no risk of
// double-counting one impact.
//
// Gated under reduced motion for the exact reason the spin kick right
// below already is: the settle pass runs this same collision code 220
// times against a freshly-scattered (often heavily overlapping) initial
// layout, and an impulse — unlike the position correction, which only
// ever changes what's rendered, never anything hidden — writes into
// node.vx/vy, which reduced motion never spends (step() only ever runs
// as one-shot settle bursts there, never the continuous per-frame loop
// that would actually integrate a lingering velocity into visible
// motion). Left ungated, a pair still being pushed back together after
// every rebound (a strong attractor, a crowded orrery shell) could bank
// real velocity across all 220 iterations with nowhere to spend it —
// dormant until reduced motion is later switched off mid-session, at
// which point it would all cash out at once as an unrequested lurch.
const BOUNCE_RESTITUTION = 0.4; // 0 = no bounce, 1 = perfectly elastic; paper is closer to 0 than 1
const BOUNCE_MIN_CLOSING_SPEED = 6; // domain units/s of approach before a touch counts as a hit worth rebounding

// Edges as real hanging threads (utils/catenary.js — the exact same math
// TagThreads.jsx's own hover connectors use) rather than straight lines,
// sag driven by each edge's own live tension rather than a fixed constant
// — a physically honest readout of the simulation's own state, not
// decoration laid on top of it. Modeled as a thread with a fixed "rest
// length" of k·EDGE_REST_LENGTH_FACTOR (a little longer than the FR
// layout's own ideal spacing k, so even a resting edge still carries some
// visible slack): tension is how much of that rest length the edge's
// actual current distance is already using up, 0 (endpoints on top of
// each other, all slack) to 1 (stretched taut or beyond). See
// utils/catenary.js's own comment for why a *bigger* k value is what
// makes a catenary sag *harder* — counter-intuitive from the name, but
// the real physical relationship.
const EDGE_REST_LENGTH_FACTOR = 1.15;
const EDGE_K_SLACK = 2.2; // low tension → sags hard
const EDGE_K_TAUT = 0.55; // high tension → pulls toward straight
// 14 rather than the 10 the fundamental alone needed — the third
// standing-wave mode (see pluckEdge) fits three half-waves into the span,
// and under ~4 samples per half-wave the Catmull-Rom smoothing starts
// inventing its own shape instead of drawing sin(3πs)'s.
const EDGE_CATENARY_SAMPLES = 14;
const EDGE_MAX_SAG = 42; // pixels — caps how far even a fully slack edge can droop
// The displayed catenary k lags its own target by this fraction each
// frame (a simple exponential smoothing, not a real second-order spring)
// rather than snapping to whatever the current distance implies —
// exactly enough of a catch-up delay for an edge's own sag to read as
// carrying a little weight of its own, without a full damped-oscillator's
// worth of state and tuning to get there.
const EDGE_SAG_SMOOTHING = 0.12;

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

// The pour — bloom handles VISIBILITY (revealScale, above); this is what
// makes the opening read as poured ink rather than notes simply fading
// into existence wherever they'll end up. Every note's own construction
// below spawns it at this one shared point near the top edge (jittered —
// see POUR_JITTER for why exact coincidence would matter) with an
// outward-and-down velocity kick, INSTEAD of the old scattered-near-center
// start — no separate animation system of its own, no release-gating, no
// second physics pass: the ordinary step() forces this file already runs
// every frame (repulsion, attraction, whichever law is active) simply
// take over from there exactly as they always have, carrying each note the
// rest of the way to wherever it actually belongs. That's also why this
// needs no reduced-motion branch: the synchronous settle pass just
// resolves the SAME forces from a different (more clustered) starting
// configuration, the same way it already handles today's scattered one.
// Real collisions along the way (and the impact/thud/splash they already
// trigger) are consequently free — they were never a separate system to
// wire up, just what this graph's own physics already does to any two
// notes that get close.
const POUR_POINT_Y = DOMAIN_H * 0.06; // domain units — near the top edge, the one shared source
const POUR_JITTER = 4; // domain units — keeps freshly poured notes from spawning EXACTLY coincident, which would leave repulsion with a zero-length (dx, dy) and so no direction to push them apart in at all
const POUR_KICK_VX = 14; // domain units/s — horizontal scatter range, ± half this per note
const POUR_KICK_VY_MIN = 30; // domain units/s — downward kick floor: poured, not merely dropped
const POUR_KICK_VY_SPAN = 22; // + up to this much more, randomized

// The camera — a plain translate+scale on a wrapping <g> (see
// worldGroupRef below), separate from the physics/layout itself, which
// stays in the same fixed domain space regardless of how the viewport is
// currently framing it. Panning tracks the pointer 1:1 while actively
// dragging (direct manipulation shouldn't lag), then hands off to a real
// velocity-decay coast on release — the same exponential-damping idea
// FoamPool's own drag already uses, just applied to the view instead of a
// particle. Wheel-zoom is anchored to the cursor (the same point on the
// graph stays under the pointer as the zoom changes) and applied directly
// per wheel event rather than eased — real wheel/trackpad input already
// arrives as a sequence of many small deltas during an actual gesture, so
// there's no separate smoothing layer to add on top without just fighting
// the input's own natural granularity.
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 3.5;
const WHEEL_SENSITIVITY = 0.0018;
const PAN_MOMENTUM_DAMPING = 0.92; // per-frame velocity retention once coasting
const PAN_MOMENTUM_STOP = 4; // px/s — below this, momentum just stops rather than drifting imperceptibly forever

// Two-finger rotate — the pinch gesture's other axis. camera.rot (radians)
// joins x/y/zoom in the same plain translate+scale(+now rotate) transform;
// the pivot is always the viewport's own center in world-pixel space
// (rect.width/2, rect.height/2 — where the domain's own center necessarily
// lands, since scaleX/scaleY are defined as rect.width/DOMAIN_W and
// rect.height/DOMAIN_H respectively), so a twist spins the whole desk in
// place rather than around some arbitrary corner. Deliberately NOT a
// persistent orientation: every "precise framing" camera move this file
// already has (fit-to-cluster, the search fly-to, the minimap jump, the
// idle-drift cruise, the boundary spring's own "ideal" position) solves
// its target in plain unrotated world-pixel space, the same way it always
// has — teaching all of those rotation math would be real surgery across
// a lot of independently-tuned camera code for a tilt that's meant to be
// playful, not a standing map orientation. So instead camera.rot only
// ever moves while a live two-finger twist is actively driving it (see
// the pinch block in handleMove); the instant that gesture ends, this
// same damped spring — same shape the boundary spring above already
// uses, pull proportional to displacement, velocity retained and eased —
// relaxes it back to level, same as the pinch's own zoom/pan already
// hands off NO momentum on release (see the pinch declaration below):
// consistent restraint, not an oversight.
const ROTATE_SPRING_STIFFNESS = 10; // rad/s² of pull-back per rad of current tilt
const ROTATE_SPRING_DAMPING = 0.82; // per-frame angular-velocity retention while springing back
const ROTATE_SNAP_EPS = 0.002; // rad, and rad/s — below both, the spring just snaps flush to level
const VIEW_RESET_DURATION = 0.6;

// The elastic pan boundary — a real damped spring (semi-implicit Euler,
// the same "v = (v + a·dt)·damping" scheme every physics loop in this file
// already uses, just applied to the camera instead of a node), not a hard
// clamp. "Ideal" is whatever camera position would perfectly center the
// graph's own content in the current viewport at the current zoom — camera
// (0,0,1) works out to exactly that at zoom 1 by construction (scaleX/Y
// are defined so the domain always spans the full viewport there), so this
// needs no separate "what does centered even mean" case for the common
// case. BOUNDARY_FREE_RANGE is how far (as a fraction of the viewport's
// own larger dimension) the camera can drift from ideal with zero
// resistance — real direct-manipulation panning shouldn't fight back
// mid-drag, so the spring only ever engages once a pan drag has actually
// released (or after a wheel-zoom leaves the camera stranded out of
// range), the same "free while dragging, corrects after" rubber-band most
// scrollable UIs already use. BOUNDARY_STIFFNESS combined with the same
// PAN_MOMENTUM_DAMPING the coast above already uses leaves this
// underdamped enough to visibly overshoot back past the boundary once
// before settling — the actual "elastic" of it, not just a smooth glide
// home.
const BOUNDARY_FREE_RANGE = 0.55;
const BOUNDARY_STIFFNESS = 6;

// The minimap — a second, tiny rendering of the exact same node positions
// (no separate simulation of its own), using an SVG viewBox rather than
// the main view's own explicit scaleX/scaleY multiplication: since the
// viewBox spans exactly the domain (0,0)–(DOMAIN_W,DOMAIN_H), a node's own
// domain-space x/y can be written straight to cx/cy with no conversion —
// the right, simpler tool here specifically because this view (unlike the
// main one) has no independent camera of its own layered on top, just a
// fixed fit-to-box. Its own viewport rectangle is the inverse of that: the
// main view's current camera state, mapped back into domain space.
const MINIMAP_WIDTH = 150;
const MINIMAP_HEIGHT = MINIMAP_WIDTH * (DOMAIN_H / DOMAIN_W);
const MINIMAP_DOT_RADIUS = 1.6;
const MINIMAP_JUMP_DURATION = 0.5;

// Cluster ink pools — each connected component of the tag graph (found
// once at build time with a plain BFS flood fill over the same edge list
// the forces use; components can't change while the panel is open, since
// edges don't either) gets a soft pool of ink pooled behind it: the convex
// hull of its members' live positions (utils/hull.js — Andrew's monotone
// chain, recomputed every frame since the members never stop moving),
// padded out past the largest member's own rendered radius, smoothed
// closed with the exact same Catmull-Rom ring construction the node blobs
// themselves are built from, and blurred down to a stain rather than a
// shape (see the CSS). This is the graph's own macrostructure made
// legible — "these notes are one cluster" currently has to be inferred
// edge by edge — using only geometry the simulation already computes.
// Components need 3+ members to earn a pool: a 2-note component IS its own
// single visible edge already, and a pool behind it would just restate it.
const HULL_MIN_MEMBERS = 3;
const HULL_PADDING = 16; // px beyond the largest member's own radius

// Plucked edges — a thread the cursor sweeps across (or that a flung
// node's release jerks) rings like a plucked string: the catenary gets the
// fundamental fixed-ends standing-wave mode superimposed on it (see
// utils/catenary.js's own `wave` comment for the spatial half), while the
// time half lives here as a damped harmonic oscillation, A·e^(−λt)·sin(ωt)
// — the actual closed-form solution for an underdamped string mode, not an
// eased tween approximating one. Sweep detection is a plain
// segment-segment orientation test between the cursor's own last movement
// and each edge's chord — one cheap cross-product predicate per edge per
// pointer move, which is strictly less work than the catenary redraw every
// edge already does every frame regardless.
const PLUCK_OMEGA = 26; // rad/s — ~4 Hz, a visibly musical wobble rather than a buzz
const PLUCK_DECAY = 2.6; // 1/s — rings for around a second before dying out
const PLUCK_MAX_AMP = 12; // px — cap, so violent sweeps don't fling the thread absurdly
const PLUCK_MIN_AMP = 0.15; // px — below this the vibration just stops rather than decaying imperceptibly forever
const PLUCK_SWEEP_GAIN = 0.35; // amplitude per pixel of cursor sweep
const PLUCK_FLING_GAIN = 0.02; // amplitude per px/s of a released node's own speed

// Pinning — alt-click fixes a node exactly where it sits: the layout's
// forces still push everything else around it, but the pinned node itself
// stops integrating, becoming a fixed boundary condition the rest of the
// simulation solves around (the same role a dragged node already plays,
// minus the pointer). The one honest way to curate this layout by hand —
// dragging alone can't hold a node anywhere, since the forces reclaim it
// the moment it's released. Alt-click rather than double-click because a
// plain click already commits to the dive-and-open flourish on pointer up
// — there is no second click to wait for.

// Reshuffle — the temperature-cooling schedule from the same Fruchterman &
// Reingold paper the layout's forces come from (see the file header),
// which the live simulation deliberately does NOT use for its normal
// running (a draggable graph must keep responding forever), brought back
// as a one-shot deliberate action: kick every free node with a random
// impulse, then cap per-substep speed by a temperature that cools
// geometrically until it stops mattering — the paper's own bounded-
// displacement annealing, letting the layout tunnel out of whatever local
// minimum it settled into and find a better arrangement. Pinned nodes are
// respected (a pin is a promise), and under reduced motion this re-runs
// the synchronous settle pass instead: a new layout, no animation.
const REHEAT_TEMPERATURE = 55; // domain units/s — the speed cap's starting value
const REHEAT_COOLING = 0.98; // per substep — ≈2% cooler each; dies out over roughly two seconds
const REHEAT_MIN_TEMPERATURE = 0.8; // below this, annealing is over and the cap comes off
const REHEAT_KICK = 40; // domain units/s of random impulse per free node

// The toss — matter-js applied to this file's own bodies for the one
// thing its hand-rolled physics genuinely isn't built for: TRUE rigid-
// body collision, with real restitution, rather than the soft position-
// correction step()'s own COLLISION_ITERATIONS pass already does.
// Reshuffle's own annealing sibling, but with a completely different
// physical texture — not a re-settle into the SAME force field, an
// actual throw-in-the-air-and-let-it-bounce, handed to a real rigid-
// body engine for a few seconds and then handed straight back.
//
// Runs in WORLD-PIXEL space — the same scaleX/scaleY-converted space
// node.radiusPx already lives in — not the small 160×100 domain this
// file's own hand-rolled physics uses directly. This isn't an arbitrary
// choice: Pile/NotePile.jsx already proves matter-js out, working, in
// this exact codebase, and it operates at real CSS-pixel scale (a
// GRAVITY of 1, toss velocities in the 2–4 px/tick range) — matter-js's
// own internal solver tolerances (contact slop, its default iteration
// counts) are tuned assuming roughly that scale. Running it directly at
// the domain's own tiny numbers instead would be untested, riskier
// territory for no real benefit, when converting in and back out at the
// boundary (exactly once, when a toss starts and every frame it's read
// back) costs nothing this file doesn't already pay to draw a node in
// the first place.
//
// Every body is tagged with its own note id so collisions can feed the
// EXISTING jelly-wobble/thud pipeline (see node.impact throughout this
// file) — a toss bounce rings and knocks exactly like an ordinary
// collision already does, no second sound or visual system built for
// it. Pinned and currently-dragged notes sit out (a pin is a promise
// even mid-toss), marked via node.tossed the same way node.pinned/
// node.dragging already tell step() to leave a node's own integration
// alone. The whole thing hands back to the active layout law's own
// step() physics once every body has settled (or after a fixed
// ceiling) — orbit, shelf, or web, whichever is current, reclaims
// exactly wherever the bounce left each note. Hidden under reduced
// motion like Magnify/Exposure: this is autonomous, large-amplitude
// motion by definition, with no reduced rendition worth offering.
const TOSS_GRAVITY = 1.4;
const TOSS_DURATION = 3.2; // s — the ceiling; an early settle can end it sooner
const TOSS_SETTLE_SPEED = 0.6; // world-px/tick average speed below which the toss counts as done
const TOSS_KICK_VX = 5; // px/tick horizontal scatter, ± half this per body
const TOSS_KICK_VY_MIN = 6; // px/tick upward kick range
const TOSS_KICK_VY_SPAN = 6;
const TOSS_RESTITUTION = 0.55;
const TOSS_FRICTION = 0.25;
const TOSS_FRICTION_AIR = 0.012;
const TOSS_WALL_THICKNESS = 60;
const TOSS_IMPACT_MIN_SPEED = 1.2; // world-px/tick of collision speed before a bounce is worth ringing
// Calibrated against THUD_REF_IMPACT (the ordinary collision system's own
// "full-strength landing" reference, 3): a typical mid-bounce speed
// (~3–4 world-px/tick) should read as a clear but modest thud, and only
// the hardest opening bounces (~10 world-px/tick, right after the kick)
// should approach full strength — so tosses have real dynamic range
// instead of every bounce instantly pegging the meter.
const TOSS_IMPACT_GAIN = 0.3; // node.impact per world-px/tick of collision speed

// Ink comet trails — a node moving fast enough (a fling, or being whipped
// around mid-drag) smears a short trail of its own ink behind it: a ring
// buffer of its last few rendered positions, drawn through the same
// Catmull-Rom smoothing every other curve here uses, fading via an
// exponential ease on its own amplitude rather than a hard on/off (a trail
// that snaps into existence reads as a glitch; one that condenses does
// not). The buffer holds real trajectory, so the trail bends exactly the
// way the node actually traveled — physics leaving a visible wake, not a
// motion-blur imitation of one.
const TRAIL_LENGTH = 9; // positions ≈ 150ms of history at 60fps
const TRAIL_MIN_SPEED = 25; // domain units/s before a trail starts condensing
const TRAIL_ATTACK = 0.35; // amplitude ease per frame while fast
const TRAIL_RELEASE = 0.12; // amplitude ease per frame while slowing — trails linger a beat after the speed does
const TRAIL_MAX_OPACITY = 0.4;

// Favorite moons — a favorited note carries a small droplet of ink in
// orbit, on a real Kepler ellipse with the note at one focus: position
// from the polar conic r(θ) = a(1−e²)/(1+e·cosθ), angular speed from the
// equal-area law (r²·θ̇ = constant, Kepler's second law — so θ̇ ∝ 1/r²,
// and the droplet genuinely whips through perihelion and lingers at
// aphelion rather than ticking around a circle at constant rate). The
// orbit plane is drawn foreshortened (the y-component squashed) so it
// reads as inclined rather than as a flat ring. This is the one place the
// graph currently says nothing the hover card already knows — favorite
// status — surfaced as motion instead of an icon.
const MOON_RADIUS = 2.6; // px
const MOON_ECCENTRICITY = 0.38;
const MOON_ORBIT_MARGIN = 9; // px beyond the node's own radius, to the orbit's semi-major axis
const MOON_TILT = 0.5; // y-squash — the inclined orbit plane's own foreshortening
const MOON_MEAN_RATE = 2.2; // rad/s at r = a; faster inside, slower outside, per the equal-area law

// Mass — a node's inertia comes from its note's actual content length,
// integrated as a real a = F/m: every force in the layout (repulsion,
// attraction, center pull, cursor field, ambient current) moves a heavy
// note proportionally less. Deliberately logarithmic — note lengths span
// orders of magnitude, and a linear map would make one long note
// effectively immovable — and deliberately NOT fed into the rendered
// radius, which stays degree-based: size says "connected", sluggishness
// says "substantial", and conflating the two would say neither. Forces
// were tuned before mass existed, so mass 1 (an empty note) reproduces the
// old dynamics exactly; equilibria are untouched either way, since where
// net force is zero, dividing it by anything is still zero.
const MASS_MAX_BONUS = 2.2; // heaviest possible note ≈ 3.2× an empty one's inertia
const MASS_LENGTH_SCALE = 160; // characters per doubling step in the log

// Jelly squash & stretch — the classic animation principle, grounded in
// the physics that motivated it: a moving blob of liquid elongates along
// its velocity and thins across it, conserving area. scale(S, 1/S) along
// the motion axis has determinant exactly 1, so the deformation never
// changes a node's area, only its shape — stretch is honest kinematics,
// not a size change. Two contributions share the same axis: a smoothed
// velocity term (fast = long, eased so the shape lags the speed the way
// real viscosity would), and an impact wobble — collision overlaps
// resolved by the position constraint accumulate into a damped harmonic
// oscillation, A·e^(−λt)·sin(ωt), the same closed-form ring-down the
// plucked edges use — so two nodes that bump visibly jiggle like jelly
// instead of stopping dead. Heavier notes (see mass above) deform less
// for the same speed, exactly as a denser droplet would.
const SQUASH_GAIN = 0.008; // stretch per (domain unit/s) of speed, at mass 1
const SQUASH_MAX = 0.32; // velocity stretch cap — top speed reads as 1.32 : 0.76
const SQUASH_EASE = 0.18; // per-frame ease toward the target stretch
const WOBBLE_OMEGA = 18; // rad/s — the jelly ring-down's own frequency
const WOBBLE_DECAY = 5.5; // 1/s — dies out in about half a second
const WOBBLE_GAIN = 0.09; // wobble amplitude per domain unit of resolved overlap
const WOBBLE_MAX = 0.22;
const WOBBLE_MIN = 0.002; // below this the oscillator just stops

// The ambient current — a weak, slowly-evolving, divergence-free flow
// (utils/noise.js's curlNoise2; see that file for why taking the curl of a
// noise field guarantees incompressibility) that every free node drifts
// in. This is what keeps the settled graph reading as ink suspended in
// water rather than a diagram that has finished: equilibrium never quite
// arrives, but because the field is solenoidal the drift only ever swirls
// — it can't herd nodes into a corner or inflate the layout, and the FR
// forces stay in charge of the actual structure. Felt through the same
// a = F/m integration as everything else, so light notes ride the current
// visibly more than heavy ones.
const CURRENT_STRENGTH = 2.4; // force units — an order under the layout's own forces
const CURRENT_SCALE = 26; // domain units per noise cell — swirls span a few nodes, not the whole graph
const CURRENT_TIME_SCALE = 0.07; // noise-cells per second along the time axis

// Pluck resonance — a plucked thread hands a small perpendicular impulse
// to both endpoint nodes (through 1/mass, like every other influence),
// so plucking is physically consequential: the string and its anchors
// exchange energy instead of the vibration being a purely cosmetic
// overlay on a frozen chord.
const PLUCK_NODE_IMPULSE = 0.55; // domain units/s of endpoint velocity per px of pluck amplitude, at mass 1

// The liquid ink surface — utils/inkSurface.js (the wave-equation pool +
// shader; see that file's own header for the physics and the CFL
// numbers). Everything energetic the simulation does splashes it: a fast
// node drags a wake, a pluck taps it, a reshuffle detonates a ring from
// the center that reads as the annealing shockwave it is, and the dive
// splashes down right where the selected note submerges. Skipped entirely
// (no WebGL context, no wave stepping) under reduced motion — it is
// continuous ambient motion by definition.
const INK_WAKE_MIN_SPEED = 12; // domain units/s before a node's motion starts splashing
const INK_WAKE_GAIN = 0.22; // splash amount per (domain unit/s · s) of node travel
const INK_WAKE_MAX = 0.3; // per-frame per-node splash cap
const INK_PLUCK_GAIN = 0.025; // splash amount per px of pluck amplitude
const INK_RESHUFFLE_SPLASH = 1.4; // the annealing shockwave's center detonation
const INK_DIVE_SPLASH = 1.1; // the selected note's own splash-down
const INK_POUR_SPLASH = 1.6; // the opening pour's own first-impression detonation, at POUR_POINT_Y

// Pendulum labels — each title hangs from its node as a real point mass on
// a rigid tether: utils/verlet.js's own position-based integration
// (gravity as the only acceleration, the tether as a distance constraint
// with the node's rendered position as its pinned anchor). Follow-through
// and settle fall out of the physics for free — a node that stops leaves
// its label swinging through a few damped pendulum periods, secondary
// motion in the classical-animation sense, produced by an actual pendulum
// rather than an easing curve imitating one. The label's tilt is read
// straight off the tether's own angle from vertical.
const LABEL_HANG = 16; // px of tether beyond the node's radius — matches the old static offset exactly
const LABEL_GRAVITY = 2400; // px/s² — scaled for pixel space; heavier than 9.8 reads right at UI size
const LABEL_DAMPING = 0.9; // per-step implied-velocity retention — a few visible swings, then rest
const LABEL_CURRENT_GAIN = 70; // px/s² of lateral push per unit of the ambient current (see CURRENT_STRENGTH) — a light fraction of LABEL_GRAVITY, enough to sway a hanging tag without ever fighting the tether's own taut hang

// Parallax depth — the graph gets a depth axis read from structure: a
// node's degree maps to how near the focal plane's front it floats, and
// the pointer acts as the viewer's head. Centered on the mid-plane
// (depthFactor spans −0.5…+0.5), so hubs shift with the pointer while
// leaves shift against it — the differential motion that actually sells
// parallax, with typical offsets half what a one-sided mapping would
// need. Purely a rendering-level offset, the same honest label
// HistoryConstellation.jsx's shader gravity well carries: physics,
// hit-testing, and the minimap all keep working in true positions, and
// the display offset rides on top. Every drawn element reads the same
// displaced position (blobs, threads, hulls, trails, hover card), so
// nothing ever detaches from anything.
const PARALLAX_GAIN = 15; // px of shift at full pointer offset, per unit of depthFactor
const PARALLAX_VERTICAL = 0.6; // vertical parallax runs shallower — screens are wider than tall
const PARALLAX_EASE = 0.06; // per-frame ease toward the pointer's current offset

// Breathing blobs — no silhouette is ever perfectly still: each node's
// resting outline is built from a fixed ring of anchors (see getShapes)
// whose radii each carry their own slow sine oscillator, slightly
// detuned in rate and phase per anchor so the shape genuinely undulates
// rather than pulsing in sync. The static rest path is the same
// construction sampled at t = 0, which is also exactly what reduced
// motion (and the hover morph's own endpoints) see — one geometry, two
// temperatures. The hover morph owns the path element while it's
// mid-flight (its own drive.t > 0); breathing stands down for exactly
// that window rather than fighting flubber over the d attribute.
const BREATH_AMP = 0.04; // ±4% of each anchor's own radius
const BREATH_OMEGA = 0.8; // rad/s — a calm, tidal rate, well below every other motion here

// Cluster dive — double-clicking inside a cluster's own ink pool fits the
// camera to that cluster (point-in-polygon against the pool's current
// padded hull, utils/hull.js's ray-casting test, then a fit-to-bounds
// tween); double-clicking genuinely empty space still resets the view
// exactly as before. The zoom hierarchy this creates — overview,
// cluster, then click a note to dive all the way in — is the standard
// three-level navigation every map UI teaches, assembled from parts this
// file already had.
const CLUSTER_FIT_PADDING = 70; // px of breathing room around the fitted cluster
const CLUSTER_FIT_DURATION = 0.7;

// Audible plucks — the threads sound like what they already look like.
// A real string's fundamental is f = (1/2L)·√(T/μ): frequency falls as
// length grows, which is the half of the formula the graph can honestly
// express (chord length is right there; tension and density have no
// physical analog worth pretending to). Mapped linearly onto a soft
// harp-like register rather than through a literal 1/L (whose range at
// these chord lengths would run shrill), through utils/sound.js's own
// opt-in gate — silent unless the visitor has sounds on, entirely
// independent of reduced motion, which governs motion, not audio.
const PLUCK_SOUND_MIN_AMP = 1.2; // px of fresh amplitude before a pluck is worth hearing
const PLUCK_FREQ_MAX = 560; // Hz — the shortest thread's pitch
const PLUCK_FREQ_MIN = 170; // Hz — the pitch floor long threads sink toward
const PLUCK_SPAN_REF = 420; // px — the span at which pitch reaches its floor

// The signal ping — setting a fresh path anchor (shift-click) launches a
// wavefront from that note through the tag graph itself: a BFS from the
// source assigns every reachable note its hop distance, and the front then
// visits hop shell after hop shell on a fixed beat. Each thread the front
// enters gets the exact same treatment a cursor sweep already gives it
// (vibAmp ring-down, midpoint splash, pitched pluck through the sound
// gate), each note it reaches takes a jelly pulse and taps the pool —
// nothing new is drawn, the ping is played entirely on instruments this
// file already owns. Timing is hop-based rather than geometric-distance-
// based on purpose: hops are the graph-theoretic truth the ping reports
// (the same unit the path-status pill already counts in), where geometric
// length here is just wherever the layout happens to sit this second.
// Energy decays geometrically per hop, so a ping dies out naturally the
// way a real disturbance spreading through a medium does — and since each
// shell's plucks land together, a well-connected note answers with a
// cascade of strummed chords receding in loudness. Skipped entirely under
// reduced motion: an autonomous cascade is exactly what that opts out of.
const PING_HOP_INTERVAL = 0.16; // s per hop shell — a readable ripple, not a flash
const PING_EDGE_AMP = 7; // px of pluck amplitude entering a hop-0 thread
const PING_NODE_PULSE = 0.26; // scale bump on arrival, before per-hop decay
const PING_PULSE_RELEASE = 4; // 1/s — the pulse's own exponential ring-down
const PING_DECAY = 0.72; // per hop — each shell carries ~72% of the last one's energy
const PING_MIN_FACTOR = 0.05; // below this the front has died; stop scheduling
const PING_NODE_SPLASH = 0.3; // pool tap per arrival, at full energy

// The tag lens — a rail of chips listing the desk's tags (plurality-first),
// each one a togglable spotlight: with a lens active, only notes carrying
// that tag hold their full ink, and only threads whose own shared-tag list
// includes it stay lit — which is a strictly narrower statement than "both
// endpoints have the tag", since two notes can each carry the lens tag yet
// be joined by an entirely different shared tag; the thread honestly
// reports what the edge is actually made of. Dimming priority runs
// path > search > lens > hover (see the SEARCH_FIT_PADDING constant
// block for why a typed query outranks a standing lens tag): a traced
// path is the most deliberate statement on screen, search the next, a
// lens the next, a transient pointer position last — the four never
// disagree about what's dimmed at once. Activating a lens taps the pool
// once under every member, so the spotlight lands as a scatter of rings
// across exactly the notes it names.
const LENS_MAX_TAGS = 14; // chips shown — plurality-first; a desk with more tags shows its top ones
const LENS_SPLASH = 0.45; // per-member pool tap when a lens switches on

// Cluster region names — each ink pool now carries its own name: the
// plurality tag among its members (alphabetical between ties, same
// stable-order discipline the chip rail keeps), set at the pool's live
// centroid in the quiet, letterspaced register of a map's region
// lettering. Counter-scaled by 1/zoom every frame so the name holds a
// constant screen size while the world zooms underneath it — exactly how
// real map labels behave — and faded out entirely once the camera closes
// past the overview scales where a region name is the useful level of
// description (the notes' own pendulum labels take over from there).
// Drawn inside the hulls layer, so they sit behind all actual content and
// step back with the pools whenever a path or lens takes priority.
const CLUSTER_LABEL_OPACITY = 0.42;
const CLUSTER_LABEL_FADE_START = 1.6; // zoom where the fade begins
const CLUSTER_LABEL_FADE_END = 2.4; // zoom past which region names are fully gone

// The magnifier — a real graphical fisheye (Sarkar & Brown, "Graphical
// Fisheye Views of Graphs", CHI '92: the standard focus+context
// distortion for graph browsing): within the lens radius R around the
// cursor, a point at normalized distance t = r/R moves out to
// r' = R·(d+1)·t / (d·t + 1) — magnified (d+1)× at the very center,
// pinned exactly at the rim (t = 1 maps to itself), context beyond R
// untouched. Applied to dispX/dispY in the render pass, the exact
// rendering-level-displacement contract parallax already established:
// physics, hit-testing and the minimap keep true positions, and every
// drawn element (threads, hulls, trails, hover card, pendulum labels)
// follows automatically because they all read the same displaced
// coordinates. Blobs inside the lens also scale by the local
// magnification — √ of the radial derivative m(t) = (d+1)/(d·t+1)²,
// tempered by FISHEYE_NODE_GAIN, since the full m at the focus reads
// cartoonish where a hint of it reads optical. Toggled by its own pill
// button, eased in/out rather than snapped, and hidden under reduced
// motion — a cursor-tracking whole-scene distortion is the same class of
// pointer-driven motion the parallax head already stands down for there.
const FISHEYE_RADIUS = 170; // px, screen space — the lens's reach
const FISHEYE_D = 2.6; // distortion strength — (d+1)× magnification at the focus
const FISHEYE_NODE_GAIN = 0.5; // how much of √m a blob's own scale actually takes
const FISHEYE_EASE = 0.1; // per-frame ease toward on/off
const FISHEYE_RING_OPACITY = 0.25; // the lens boundary's own faint ink ring

// Idle drift — leave the graph alone long enough and the camera slips
// into a slow cruise: eased toward a Lissajous path around the content's
// own center (three incommensurate frequencies, so the figure never
// visibly repeats) with a gentle breathing zoom anchored at the viewport
// center, so the breath reads as leaning in and back rather than sliding
// toward a corner. Any input — a move, a press, a wheel tick — ends it
// instantly; the ease factor is glacial on purpose, so control never has
// to be "handed back", the cruise just stops adding its own drift and
// the boundary spring/momentum machinery is back in sole charge. A
// museum installation's attract loop, built entirely from the camera
// this file already has — and skipped under reduced motion, being the
// definition of autonomous ambient motion.
const IDLE_DELAY_MS = 14000;
const DRIFT_EASE = 0.006; // per frame — glacial approach, never a takeover
const DRIFT_AMP = 0.055; // Lissajous amplitude, as a fraction of the viewport dimension
const DRIFT_ZOOM = 1.07; // the cruise's home zoom — leaned just inside the graph
const DRIFT_ZOOM_AMP = 0.06; // breathing depth around it

// Thread weight made visible — stroke width from each edge's own
// shared-tag count, the one attribute of an edge the rendering didn't yet
// state (weight already strengthens the attractive force; now the eye
// gets the same fact the physics does). A presentation attribute rather
// than an inline style on purpose: stylesheet rules beat presentation
// attributes, so the traced path's own .on-path width still wins
// unchanged while a path is active. Weight 1 lands at 1.75px — right
// where the old uniform width sat — and the cap keeps a heavily-bonded
// pair from reading as a bar.
const EDGE_WIDTH_BASE = 1.2;
const EDGE_WIDTH_PER_TAG = 0.55;
const EDGE_WIDTH_MAX = 3.4;

// Liquid bridges — two blobs pressed close enough grow a real gooey neck
// between them (utils/metaball.js — the classic two-circle metaball
// construction), stretched thinner as they part and snapped once they're
// genuinely torn apart: a splash at the neck's last midpoint, an impact
// wobble through both endpoints (fed into the same node.impact channel
// collisions already ring the jelly through), and a low wet pop through
// the sound gate. This is surface tension made visible — the collision
// constraint already stops blobs at a fixed floor gap, and at typical
// stage sizes that floor sits just inside BRIDGE_REACH, so a squeezed
// pair (a drag pressing one note into another, a crowded cluster's own
// compression) coheres while ordinary FR spacing never does. The neck is
// filled by a per-bridge userSpaceOnUse gradient running note color to
// note color, and attaches at BRIDGE_ATTACH of each rendered radius —
// deliberately inside the blob's own wobbly silhouette (whose anchors
// swing ±28% of radius), so the neck emerges from under ink that's
// already the same color rather than trying to kiss a moving edge.
// Drawn over the nodes layer for the same reason: the attachment zone
// covers the blob's paper-colored outline stroke, which would otherwise
// slice a hairline across every neck.
const BRIDGE_REACH = 24; // px of surface gap within which a neck condenses
const BRIDGE_SNAP_DIST = 34; // px of gap past which it tears — the hysteresis band keeps a pair hovering at the threshold from machine-gunning pops
const BRIDGE_POOL = 6; // simultaneous necks — contact is rare enough that more would never draw
const BRIDGE_ATTACH = 0.85; // fraction of rendered radius the neck grips
const BRIDGE_OPACITY = 0.85;
const BRIDGE_ATTACK = 0.25; // per-frame ease toward fully condensed
const BRIDGE_SNAP_IMPACT = 1.2; // impact units per endpoint — reuses the collision jelly's own scale
const BRIDGE_SNAP_SPLASH = 0.35;
const BRIDGE_SNAP_FREQ = 240; // Hz — playDrip an octave-ish under the dew's plip: a thicker pop

// Thread dew — a slack thread condenses a droplet at its catenary belly
// (utils/catenary.js's catenaryBelly — the exact drawn midpoint, so the
// drop rides the same sag and standing wave the thread itself shows),
// swelling until it detaches, falling under real gravity, and landing in
// the liquid ink surface with a splash and a pitched plip. Condensation is
// honest about where water collects: only threads carrying real slack
// (tension below 1 − DEW_MIN_SLACK) and actually hanging below their own
// chord gather anything — a taut or upward-bowed thread sheds. The supply
// is a fixed GLOBAL rate split across the edge list (with per-edge jitter
// so drips never sync up): a desk with three threads and a desk with three
// hundred both drip somewhere every few seconds, rather than the graph
// turning into rainfall as it grows. Plucking a charged thread shakes its
// drop off early — the ring-down amplitude doubles as the shake — which
// makes the dew a witness to every sweep, fling, and signal ping without
// any of them needing to know it exists. Drop area grows linearly with
// collected charge (radius by √charge), and a drop about to fall elongates
// the way a real pendant drop necks before it lets go. Skipped entirely
// under reduced motion — autonomous ambient motion by definition.
const DEW_GLOBAL_RATE = 0.22; // full drops per second, summed across the whole graph
const DEW_MIN_SLACK = 0.22; // tension slack below which a thread stays dry
const DEW_MAX_RADIUS = 2.4; // px — a full drop
const DEW_SHAKE_AMP = 3; // px of pluck amplitude that shakes a drop loose
const DEW_SHAKE_MIN_CHARGE = 0.3; // too small a droplet just clings through the shake
const DEW_FALL_GRAVITY = 380; // px/s² — reads right at UI scale, same reasoning as LABEL_GRAVITY
const DEW_FALL_DISTANCE = 34; // px of fall before the drop meets the pool's surface
const DEW_POOL = 10; // falling drops in flight at once
const DEW_RESIDUE = 0.12; // a just-dripped thread keeps a random film up to this much charge
const DEW_SPLASH = 0.28; // pool splash at full drop size
const DEW_DRIP_FREQ_BASE = 880; // Hz — the smallest drop's plip
const DEW_DRIP_FREQ_SPAN = 320; // big drops land this much lower — a bigger cavity rings deeper

// Stirring the pool — right-drag turns the cursor into a paddle drawn
// through the medium every node is suspended in: nodes near the rod pick
// up its own velocity (force ∝ paddle speed, smoothstep falloff over
// STIR_RADIUS, through 1/mass like every other influence), so circling
// the cursor genuinely swirls the neighborhood and a straight sweep
// shoves a wake through it — momentum injection along the rod's motion,
// which is what a real stir does, rather than a synthetic vortex spinning
// around a stationary point. The paddle's velocity is eased from the
// pointer's own instantaneous rate and decays on a short time constant,
// so holding the rod still mid-drag stops stirring immediately instead of
// ghost-pushing from stale speed. The ink surface streaks under the rod
// as it moves — the pool showing the stir is the whole feedback, no extra
// chrome. Left-drag on empty space still pans exactly as before; the two
// gestures share nothing but the empty-space start. Disabled under
// reduced motion (a force field flinging nodes into coasting motion is
// precisely the cascade that setting opts out of), in which case
// right-click keeps its ordinary context menu instead of being a dead
// gesture.
const STIR_RADIUS = 30; // domain units — a wider reach than the passive cursor field
const STIR_GAIN = 0.14; // force per (domain unit/s) of paddle speed
const STIR_MAX_SPEED = 400; // domain units/s — cap on how hard the rod can push
const STIR_SMOOTHING = 0.35; // per-move ease toward the pointer's instantaneous rate
const STIR_DECAY_TAU = 0.12; // s — paddle speed's decay constant once the pointer rests
const STIR_WAKE_GAIN = 0.02; // pool splash per (domain unit/s · s) of rod travel
const STIR_WAKE_MAX = 0.4; // per-frame cap, same discipline as INK_WAKE_MAX

// Stirring spins things up, not just along — the leaf-in-a-whirlpool
// picture stirring has always half-promised but never delivered: a note
// near the rod felt only a push in the rod's OWN direction of travel
// (the translational force just above), never a torque, so circling the
// rod tightly around a note pushed it around bodily without ever making
// it visibly turn. This reads the TANGENTIAL component of the rod's
// velocity relative to each note's own radius vector from it — near-zero
// when the rod moves radially toward or away (a straight poke shouldn't
// spin anything), largest when the rod's motion is purely tangential (an
// actual circle traced around the note, which is exactly the gesture
// that spins something up in real water). Same smoothstep falloff and
// same additive-kick-into-omega shape the collision contact spin already
// uses (see SPIN_CONTACT_GAIN) — the ambient vorticity ease in tick()
// already relaxes whatever lands in node.omega back down regardless of
// source, so this needs no decay logic of its own, and SPIN_MAX's own
// clamp there catches any total this or any other source could reach.
// Lives inside the exact same `stir.vx !== 0` block the translational
// force already does, for the same reason that block needs no separate
// reduced-motion check: stir speed is only ever nonzero when the gesture
// itself was allowed to engage in the first place (see handleDown).
const STIR_SPIN_GAIN = 0.12; // rad/s of kick per (domain unit/s) of the rod's own tangential speed, at mass 1

// ————————————————————————————————————————————————————————————————————
// The layout modes — the redesign's spine. The constellation is no longer
// one arrangement but an instrument with three laws the same desk can flow
// between, each an honest reading of a different attribute the notes
// actually carry:
//
//   web    — the FR tag graph this file has always been (see the header).
//   orrery — RELATION AS GRAVITY: each connected component becomes a
//            planetary system. Its highest-degree member anchors as the
//            primary; every other member rides a real Kepler ellipse
//            around it — position from the polar conic r(θ) =
//            a(1−e²)/(1+e·cosθ), angular speed from the equal-area law
//            (θ̇ ∝ (a/r)², so planets whip through perihelion), and
//            per-orbit rates from Kepler's third law (T² ∝ a³, so rate ∝
//            (a₀/a)^1.5 — outer shells genuinely lumber while inner ones
//            hurry, no per-shell tuning). Orbit radii come from BFS hop
//            distance to the primary: the graph-theoretic shell structure
//            the signal ping already reads, made spatial. Notes with no
//            tags — the web layout's honest drifters — become comets:
//            high-eccentricity ellipses around the domain's own center,
//            slow at aphelion out past every system, diving through the
//            middle of the map at perihelion exactly the way real comets
//            cross planetary orbits. Systems are placed on a Vogel spiral
//            (r ∝ √n at the golden angle — sunflower packing, the
//            evenest known way to scatter n points over a disc).
//   strata — TIME AS SEDIMENT: every note settles onto the shelf of its
//            own creation month, oldest at the bottom — the way strata
//            actually deposit — with undated notes as the bedrock layer
//            beneath everything. Repulsion keeps acting along x only, so
//            each shelf spreads into an even row while the springs own y.
//
// Only the FORCE FIELD changes per mode. The integrator, damping, mass,
// collision, jelly, dew, bridges, plucks, trails, stir, ink surface,
// camera, and minimap are all mode-blind — which is what makes a mode
// switch a real event: the whole population swims from one law to the
// other under a brief annealing temperature (the same bounded-speed
// schedule the reshuffle uses, here taming the first lurch into a staged
// migration), with a center detonation in the pool to mark the moment.
// Under reduced motion a switch re-runs the synchronous settle pass
// instead: the new arrangement, no journey. The mode persists across
// panel close/reopen like the lens and pins do — which law you read the
// desk by is a standing question about the desk.
const LAYOUT_MODES = [
  { id: "web", label: "Web", Icon: FaCircleNodes },
  { id: "orrery", label: "Orrery", Icon: FaSun },
  { id: "strata", label: "Strata", Icon: FaLayerGroup },
  { id: "spectrum", label: "Spectrum", Icon: FaPalette },
  { id: "flock", label: "Flock", Icon: FaDove },
];
const MODE_TEMPERATURE = 42; // domain units/s — the migration's opening speed cap

const ORRERY_SPREAD = 34; // Vogel spiral's outer radius, domain units (y foreshortened by the domain's own H/W)
const ORRERY_BASE_A = 9; // hop-1 shell's semi-major axis
const ORRERY_SHELL_GAP = 8; // domain units per further hop
const ORRERY_TILT = 0.55; // every orbit plane's foreshortening — same idea as MOON_TILT, shallower
const ORRERY_RATE = 0.55; // rad/s at a = ORRERY_BASE_A; Kepler's third law scales every other orbit from here
const ORRERY_ECC_MIN = 0.12; // planet eccentricity range — visibly elliptical, never comet-wild
const ORRERY_ECC_SPAN = 0.2;
const ORRERY_SPRING = 3.2; // orbiter pull toward its moving Kepler target
const ORRERY_PRIMARY_SPRING = 2.6; // primaries hold their system anchor a little more loosely
const ORRERY_COMET_A = 46; // comet semi-major axis floor, + jitter
const ORRERY_COMET_ECC_MIN = 0.55; // comets: properly eccentric
const ORRERY_COMET_ECC_SPAN = 0.2;

const STRATA_TOP_Y = DOMAIN_H * 0.14; // newest shelf
const STRATA_BOTTOM_Y = DOMAIN_H * 0.86; // oldest shelf (deposition order — see the mode comment)
const STRATA_SPRING = 5.5; // pull toward the note's own shelf
const STRATA_CENTER_X = 0.035; // weak x centering — CENTER_STRENGTH's job, split to the one axis strata leave free
const STRATA_BAND_MAX_HALF = 5; // a wash band's half-height cap, domain units

// Spectrum — COLOR AS PHYSICS, the fourth law: web reads tags, orrery reads
// relation, strata reads time, and color is the one attribute of a note
// this graph has only ever used for paint, never for arrangement — until
// now. The wheel is fixed furniture (see SPECTRUM_SECTORS below, a plain
// module-level constant: unlike the other three laws' own per-note
// assignments, sector boundaries don't depend on which notes exist, only
// on how many colors NOTE_COLORS defines), ordered by actual hue around
// the color wheel rather than object-key order, with one extra sector for
// uncolored notes. Each note gets a stable target point within its own
// color's wedge — a fixed angle (sector center plus a per-note jitter
// narrower than the sector itself, so neighboring wedges never bleed into
// each other) at a fixed radius (jittered too, so a wedge fills as an
// area rather than lining up on one spoke) — assigned once at build time
// exactly like strataY, then chased by an ordinary spring every frame
// exactly like the strata shelf spring. Full 2D repulsion stays on here
// (unlike strata's x-only or orrery's none): nothing else declumps notes
// within their own wedge, and repulsion is exactly the tool the web
// itself already uses for that job. The y-component of every angle here
// carries the same DOMAIN_H/DOMAIN_W foreshortening the orrery's own
// Vogel-spiral anchor placement already uses, for the same reason: it
// keeps a geometrically circular wheel from overflowing the domain's own
// shorter (vertical) axis.
const SPECTRUM_COLOR_ORDER = ["red", "orange", "yellow", "green", "blue", "purple", "pink"]; // hue order, not object-key order
const SPECTRUM_RADIUS = 36; // domain units — the wheel's own base radius
const SPECTRUM_RADIUS_JITTER = 11; // per-note radius scatter, fills the wedge as an area
const SPECTRUM_SECTOR_FRACTION = 0.72; // how much of a sector's own angular width a note's jitter can reach — the rest is the gap that keeps wedges visually distinct
const SPECTRUM_SPRING = 3.4; // pull toward the note's own target point
const SPECTRUM_INNER_RADIUS = SPECTRUM_RADIUS * 0.32; // the wedge guides' own inner cut — see SPECTRUM_SECTORS
const SPECTRUM_OUTER_PAD = 6; // domain units beyond the outermost jittered note a wedge guide still reaches (summed pre-scale, unlike LASSO_HALO_PAD's post-scale px — so this one's own screen size rides the camera zoom)
const SPECTRUM_WEDGE_SAMPLES = 10; // arc segments per wedge edge — plenty smooth at this radius

// The wheel's own fixed sectors — one per named color plus one for
// uncolored notes, evenly spaced, computed once at module load since
// nothing about it depends on live note data. `color` falls back to the
// page's own line color for the uncolored sector, the same neutral this
// file already reaches for whenever a cluster pool has no dominant tint.
const SPECTRUM_SECTORS = [...SPECTRUM_COLOR_ORDER, null].map((colorKey, i, arr) => ({
  key: colorKey || "none",
  color: colorKey ? NOTE_COLORS[colorKey] : "var(--page-line-color)",
  label: colorKey || "Uncolored",
  centerAngle: (i / arr.length) * Math.PI * 2,
  startAngle: (i / arr.length) * Math.PI * 2 - Math.PI / arr.length,
  endAngle: (i / arr.length) * Math.PI * 2 + Math.PI / arr.length,
}));

// A wedge as a sampled ring sector (inner and outer arcs joined into one
// closed ring) — the same point-sample-then-join idiom every curve in
// this file already uses (catenaryPath, breathingBlobPath), rather than
// reaching for SVG's own arc command, which nothing else here does
// either. Takes explicit x/y semi-axes rather than one radius plus an
// aspect multiplier: the caller is folding together TWO independent
// distortions (the domain's own DOMAIN_H/DOMAIN_W foreshortening — see
// the per-note target-point math this mirrors — and the viewport's own
// generally-non-uniform scaleX/scaleY), and pre-multiplying both into a
// single (rx, ry) pair before calling keeps this function a plain
// ellipse-sector sampler with no unit ambiguity of its own, the same way
// every catenaryPath call site already hands in final world-pixel
// coordinates rather than raw domain ones.
const spectrumWedgePath = (cx, cy, innerRx, innerRy, outerRx, outerRy, startAngle, endAngle) => {
  const pts = [];
  for (let i = 0; i <= SPECTRUM_WEDGE_SAMPLES; i++) {
    const a = startAngle + (endAngle - startAngle) * (i / SPECTRUM_WEDGE_SAMPLES);
    pts.push(`${ cx + Math.cos(a) * outerRx } ${ cy + Math.sin(a) * outerRy }`);
  }
  for (let i = SPECTRUM_WEDGE_SAMPLES; i >= 0; i--) {
    const a = startAngle + (endAngle - startAngle) * (i / SPECTRUM_WEDGE_SAMPLES);
    pts.push(`${ cx + Math.cos(a) * innerRx } ${ cy + Math.sin(a) * innerRy }`);
  }
  return `M ${ pts.join(" L ") } Z`;
};

// Flock — the fifth law, and the first that reads velocity rather than
// just position: web/orrery/strata/spectrum all place a note by chasing a
// TARGET POINT (an edge sum, a Kepler conic, a shelf, a wedge); nothing in
// any of them ever makes one note's own HEADING answer to another's. This
// is real Craig Reynolds boids (Reynolds, "Flocks, Herds, and Schools: A
// Distributed Behavioral Model," SIGGRAPH 1987) — the same three local
// rules every flocking sim since has descended from, run here over the
// desk itself:
//   separation: steer away from whatever's crowding your own personal
//     space (FLOCK_SEPARATION_RADIUS) — pure repulsion, but short-range
//     and neighbor-limited, unlike the web's own all-domain repulsion.
//   alignment:  steer your own velocity toward the AVERAGE velocity of
//     everything within FLOCK_NEIGHBOR_RADIUS — the one genuinely new
//     ingredient; no other law here ever reads a neighbor's vx/vy.
//   cohesion:   steer toward the average POSITION of that same
//     neighborhood, so a loose scatter still reads as one body, not a gas.
// Tag-sharing gets a say the way it always does in this file — not as a
// separate fourth rule, but as extra WEIGHT inside alignment/cohesion's
// own averages (see FLOCK_KIN_BONUS): kin swim as a tighter school inside
// the larger flock, the same "attraction reads the edges" idea the web
// law's own attraction already stands for, reinterpreted as steering
// instead of a spring. flockKin (built once alongside edgeList) is what
// answers "are these two kin" in O(1) inside the O(n²) neighbor scan
// step() runs for this law — see the flockKin construction near edgeList.
// Deliberately O(n²) rather than routed through the Barnes-Hut quadtree
// the web's own repulsion already uses: that tree approximates ONE force
// law (inverse-distance, every pair) that never changes shape; a boid's
// three rules only even apply within a hard radius and need each
// candidate's live velocity, not just its position, so reusing that tree
// would mean rebuilding the exact machinery it exists to avoid. At the
// note counts a personal desk realistically reaches (the same honest
// ceiling the quadtree's own module comment already names), a
// distance-squared early reject before any of the three rules touches a
// candidate keeps this well clear of a real bottleneck.
const FLOCK_NEIGHBOR_RADIUS = 30; // domain units — alignment/cohesion's own sensing range
const FLOCK_SEPARATION_RADIUS = 10; // domain units — inside this, separation alone speaks
const FLOCK_SEPARATION_GAIN = 5.5; // force per domain unit of penetration past the separation radius
const FLOCK_ALIGN_GAIN = 0.7; // fraction of the velocity gap toward the neighborhood average, per second
const FLOCK_COHESION_GAIN = 0.35; // force per domain unit toward the neighborhood's own centroid
const FLOCK_KIN_BONUS = 2.5; // extra weight a tag-sharing neighbor's own vx/vy/x/y carry inside the averages
const FLOCK_EDGE_MARGIN = 22; // domain units from the boundary where the edge-avoid steer engages
const FLOCK_EDGE_GAIN = 0.4; // steer-back force per domain unit of penetration past that margin
// A boid that ever actually reaches rest has nothing left to align or cohere
// WITH — alignment's own target is the neighborhood's average velocity,
// which is zero once everyone's stopped, a still point every other law here
// is honestly happy to settle into but this one isn't: a flock reads as
// alive by cruising, not by arriving. This is the standard fix real boids
// implementations use — a soft floor under a boid's own speed, expressed as
// a forward thrust rather than a velocity clamp so it still integrates
// through mass like every other force in this file — using the CURRENT
// heading once one exists, and each node's own stable flockHeading (set at
// spawn, see byId's own construction) only as the one-time fallback for a
// boid that has never yet had a velocity to hold a heading from.
const FLOCK_SPEED_MIN = 6; // domain units/s — the cruising floor
const FLOCK_THRUST_GAIN = 3; // force per (domain unit/s) of shortfall below that floor

// The weighted grip — dragging a note is no longer teleportation. The
// grabbed note hangs from the cursor through a real spring (target = the
// pointer, offset by wherever on the blob the pinch actually landed, so
// nothing jumps at grab time), integrated through the note's own mass
// like every other force: ω = √(K/m), so an empty note snaps to the hand
// while a long essay visibly lags, swings wide on turns, and has to be
// HAULED — mass, which until now only shaped how notes yield to the
// layout, finally felt in the hand itself. The hand keeps authority two
// ways: the spring replaces (rather than adds to) the accumulated layout
// forces for the held note, and collision still treats it as immovable —
// a held note shoves, it is not shoved. Release keeps the note's own
// integrated velocity, which makes flinging MORE honest than before: the
// throw is whatever momentum the spring actually built up, not a rate
// read off the pointer. Reduced motion keeps its existing story — the
// grip never engages because dragging itself never does.
const GRIP_K = 90; // spring stiffness — snappy at mass 1, laggy by mass 3
const GRIP_DAMPING = 0.82; // per-substep — heavier than the ambient DAMPING, near critical for the spring above

// Thread towing — a drag that starts ON a thread (within TOW_GRAB_PX of
// its chord) grabs the thread itself instead of panning: the thread
// routes through the hand as two taut catenary halves, and once the two
// halves' combined length exceeds the thread's own rest length, real
// tension hauls BOTH anchor notes toward the hand (force along each
// endpoint's line to the hand, ∝ the stretch — how a rope through a
// pulled midpoint actually loads its ends). Release plucks the freed
// thread with an amplitude sized by the stretch it was released under —
// the snap-back is the energy the tow actually stored — through the same
// ring-down, splash, and pitched voice every other pluck uses. Sweeping
// a towed thread across the rigging still strums whatever it crosses
// (the glissando is real); only the towed thread itself is excluded from
// the sweep test, since the cursor riding its own midpoint would
// self-pluck it every frame. Disabled under reduced motion (it displaces
// nodes exactly the way node-dragging does, which is already disabled
// there) — the grab simply falls through to the pan it would otherwise
// have been.
const TOW_GRAB_PX = 14; // screen px around a chord that counts as grabbing the thread
const TOW_K = 3; // force per domain unit of stretch, into each anchor
const TOW_SLACK_FACTOR = 1.05; // the tow engages just past the thread's own rest length — a lax first inch
const TOW_HALF_K = 0.8; // catenary k for each towed half — pulled threads run taut
const TOW_RELEASE_PLUCK = 0.3; // px of vibAmp per screen px of stretch at release

// Sonar taps — a plain click on open water (a pan that never moved)
// sends a circular wavefront out through the pool: an expanding ring at
// a fixed wave speed that plucks every thread it crosses (point-to-chord
// distance, crossed exactly when the front passes it) and pulses every
// note it reaches, energy fading linearly to the rim. The geometric
// cousin of the shift-click signal ping: the ping's wave travels the
// GRAPH (hop shells, the topology's own truth), this one travels the
// WATER (true distance, the layout's current truth) — the same desk
// answering in graph time versus space time, and with sounds on, a
// radial arpeggio ordered by how far each thread actually sits from the
// tap. Skipped under reduced motion like the ping — an autonomous
// cascade is exactly what that opts out of.
// Contact dimples — real local deformation at last. Every deformation so
// far has been whole-shape (the jelly's affine squash, the hover morph's
// global silhouette swap); this dents each blob's outline PER ANCHOR on
// whichever side actually faces a pressing neighbor, by running the
// breathing ring's own anchors through a pressure field: any neighbor
// whose surface sits within DIMPLE_RANGE pushes each anchor inward by how
// deep that anchor sits in the neighbor's inflated disc — nothing dents
// the far side, and the dent's width falls out of the geometry rather
// than a falloff curve. Composed with the liquid bridges this completes
// the droplet story: press two notes together and their necks goo, their
// facing sides flatten, and their far sides stay round — how droplets
// actually meet. Keyed to the same near-contact band as the bridges
// (rendered surfaces at the collision floor never truly overlap — see
// the BRIDGE_REACH comment), eased with a fast attack and slower release
// so a dent relaxes like pressed flesh rather than snapping. Dent
// targets are written by the contact pass and consumed by the next
// frame's breathing rebuild — one frame of lag, invisible at contact
// timescales, in exchange for zero reordering of the render loop.
const DIMPLE_RANGE = 18; // px of surface gap within which the pressure field engages
const DIMPLE_DEPTH = 0.55; // px of dent per px of penetration into the inflated disc
const DIMPLE_MAX = 0.4; // fraction of the blob's radius a dent can reach
const DIMPLE_ATTACK = 0.35; // per-frame ease while denting
const DIMPLE_RELEASE = 0.12; // per-frame ease while relaxing — pressed flesh, not a snap

// Current streamlines — the ambient current (see CURRENT_STRENGTH) has
// shaped every idle drift in this graph since it was built, and has been
// completely invisible the whole time. These are tracer filaments
// advected by the exact same curlNoise2 field at the exact same scales
// and clock, each dragging a short fading trail — the standard particle
// visualization of any vector field (every wind map works this way),
// which makes them an honest instrument reading, not decoration: where a
// filament swirls, notes really do drift. The stirring rod's velocity
// field bends them through the same smoothstep reach the nodes feel, so
// a stir shows its own wake in the water's texture. Tracers respawn
// wherever the domain is quiet about it (uniform random) on staggered
// lifetimes, and the whole system is skipped — and cleared, if the
// preference flips mid-session — under reduced motion.
const STREAM_COUNT = 36;
const STREAM_SPEED = 14; // domain units/s per unit of field strength
const STREAM_TRAIL = 10; // positions of trail history
const STREAM_LIFE_MIN = 4; // s
const STREAM_LIFE_SPAN = 4; // + up to this much, randomized
const STREAM_OPACITY = 0.14; // at full life — a texture in the water, never a diagram
const STREAM_STIR_GAIN = 0.5; // how much of the rod's own velocity a tracer takes

// Chladni strikes — a shift-tap on open water strikes the pool like a
// drumhead instead of tapping it: utils/waveField.js's exciteMode injects
// a pure eigenmode of the rectangular membrane, sin(mπx/W)·sin(nπy/H),
// which under the field's own fixed-edge boundary doesn't travel anywhere
// — it STANDS, ringing in place as a Chladni figure until damping takes
// it. Successive strikes climb the mode ladder below, and each one sounds
// its own eigenfrequency through the audio gate: ω_mn ∝ √((m/W)²+(n/H)²),
// passed as a true frequency RATIO against the (1,1) fundamental — so
// striking up the ladder plays the rectangular drum's actual, famously
// inharmonic partial series (the mathematical reason drums aren't
// melodic, made audible). And because the buoyancy coupling reads the
// pool's slope every substep, the notes physically ride the standing
// pattern — the classic Chladni demonstration, with notes for sand.
// Under reduced motion the surface doesn't exist, so the strike (and its
// voice — a sound announcing an invisible event would be a lie) simply
// never fires.
const CHLADNI_MODES = [[1, 1], [2, 1], [2, 2], [3, 2], [3, 3]];
const CHLADNI_AMP = 0.5; // mode amplitude per strike
const CHLADNI_FREQ_BASE = 150; // Hz — the (1,1) fundamental's pitch

// Voronoi territories — a toggleable tessellation of the desk into each
// note's nearest-point cell (utils/voronoi.js — literal half-plane
// clipping, the diagram's own definition executed per frame), drawn as
// crisp hairline borders with a whisper of each note's color filling its
// cell. This is the one honest answer to "which note owns this part of
// the desk," recomputed live because the answer never stops moving —
// walls slide as nodes drift, pinch as neighbors approach, and the whole
// map re-tiles itself around a dragged note. Straight walls on purpose,
// against everything else here being a curve: a Voronoi wall IS a
// straight line (the perpendicular bisector), and bending it would trade
// the mathematics away for house style.
const VORONOI_FILL_OPACITY = 0.05;

// Search — the one way to find a specific note on a large desk that
// wasn't hover, a tag, or a traced path. Title/body text match, dimming
// the graph down to what matched (priority path > search > lens > hover
// — a typed query is a fresher, more specific statement than a
// previously-toggled tag, so it outranks the lens exactly the way a
// traced path already outranks both), and Enter fits the camera to
// every match at once via the same flyToWorldBox the cluster dive uses.
// The pill blooms open on click or "/" (the app's own established
// search shortcut, reused here since the graph is itself a search
// surface once a query is typed) rather than mounting a permanent input
// — most sessions in this panel never search at all.
const SEARCH_FIT_PADDING = 90; // px of breathing room around the matched box
const SEARCH_FIT_DURATION = 0.6;

// The lasso — the one way to mark a GROUP of notes at once, rather than
// one at a time (path anchors take exactly two, a lens takes a tag, a
// pin takes one note under the pointer). Ctrl/Cmd-drag over open water —
// this file's own established "ask a bigger question" modifier language
// (shift asks the graph for a path, alt asks a note to hold still, this
// asks the desk for a group) — sketches a freeform loop, closed straight
// back to its own start for the live preview; release resolves it into a
// set with the exact same primitive the cluster dive's own hit-test
// already uses (utils/hull.js's pointInPolygon), tested against each
// note's TRUE domain position, not its displayed one — a selection is a
// fact about the graph, not about what the eye currently sees through
// parallax or the fisheye. Selected notes carry a soft blue halo (this
// file's own established "you did this on purpose" color, the same one
// the path anchors wear), and P pins or unpins the WHOLE group at once —
// a real use for selecting more than one note, reusing the exact
// togglePin every single-note pin already calls: all-pin if any member
// is unpinned, else all-unpin, so one press never leaves the group in a
// mixed state. A trivial ctrl-click (too few recorded points to be a
// real drag) resolves to nothing and leaves whatever selection already
// existed alone, rather than wiping it from an accidental tap. Genuinely
// motion-safe by nature — marking notes and freezing them in place moves
// nothing on its own, the opposite of what reduced motion opts out of —
// so unlike node-dragging and thread-towing this needs no reduced-motion
// gate at all; only the drawn stroke's own liveness is direct
// manipulation, exactly like panning already is. Deliberately transient
// rather than added to the persistedX family above: a selection is a
// question about right now, not a standing curated fact about the desk.
const LASSO_POINT_GAP = 1.5; // domain units between recorded points — fine enough for tight loops, coarse enough not to flood the array
const LASSO_MIN_POINTS = 4; // fewer than this and release resolves to nothing — an accidental ctrl-click, not a drag
// A hard ceiling on the recorded stroke — every other transient buffer in
// this file (trails, dew, bridges, sonar) is a fixed-size pool; the lasso
// was the one exception, growing without bound for as long as a drag
// stayed open. A held or rapidly re-traced loop would otherwise make the
// live preview's own smoothPath (paid every frame while dragging) and the
// release's pointInPolygon scan (paid once, but over every note) both
// grow with elapsed drag time rather than actual loop complexity. Past
// the cap, new points simply stop recording — the drawn loop holds its
// last shape rather than snapping or dropping earlier points, which would
// make an already-closed-feeling loop visibly change shape underhand.
const LASSO_MAX_POINTS = 400;
const LASSO_HALO_PAD = 8; // px beyond the blob's own radius
const LASSO_HALO_OPACITY = 0.22;
const LASSO_SPLASH = 0.4; // per-member pool tap when a lasso closes — the same confirmation LENS_SPLASH already gives a tag click, since a hand-drawn loop is at least as deliberate
const PIN_SPLASH = 0.35; // a single note's own quieter tap when it's freshly pinned — never on unpinning, which reads as a release, not an arrival
const SEARCH_SPLASH = 0.4; // per-match tap when a search actually flies to its results, same tier as LASSO_SPLASH

// The portrait — a keepsake, not another physics system. Every round so
// far has added a way to STIR the desk; this is the one way to WALK AWAY
// with something from it — a PNG of the constellation exactly as it
// currently sits, ink pool and all. The technique is the standard
// browser-native SVG-to-canvas rasterization (no library needed): the
// live <svg> is cloned, every element that carries its visual identity
// through an external CSS class (rather than an already-inline
// fill/strokeWidth prop) gets that identity resolved to its CURRENT
// computed value and written back as an inline style — the isolated
// image context a serialized SVG renders in has no access to this app's
// own stylesheet or its `var(--page-ink-color)`-style custom properties,
// so without this step edges and hulls would rasterize as browser-default
// black fills instead of the thin colored lines and soft stains they
// actually are. getComputedStyle does the var() resolution either way
// (a class rule, an inline var(), or an already-hex attribute all read
// out the same finished value), which is what keeps this from needing a
// hand-maintained shadow copy of NoteConstellation.css that could drift
// from the real one. The rasterized graph is then composited over the
// page's own paper color with the live WebGL ink pool (and the long-
// exposure film, if it's on) painted in first, straight from their own
// <canvas> elements — no serialization needed for those, a canvas is
// already just pixels. A brief ink-colored flash (skipped to a near-
// instant blink under reduced motion) and the same stamp cue export/
// import/undo already use are the whole ceremony; the file itself is
// the payoff.
const PORTRAIT_STYLED_SELECTOR = [
  ".note-constellation-edge", ".note-constellation-blob", ".note-constellation-hull",
  ".note-constellation-label", ".note-constellation-cluster-label", ".note-constellation-moon",
  ".note-constellation-moon-orbit",
  ".note-constellation-pin-ring", ".note-constellation-anchor-ring", ".note-constellation-trail",
  ".note-constellation-dew-drop", ".note-constellation-bridge", ".note-constellation-orbit-guide",
  ".note-constellation-strata-band", ".note-constellation-strata-label", ".note-constellation-voronoi-cell",
  ".note-constellation-spectrum-wedge", ".note-constellation-spectrum-label",
  ".note-constellation-focus-ring", ".note-constellation-lasso-ring", ".note-constellation-stream",
  ".note-constellation-sonar-ring", ".note-constellation-aim",
].join(", ");
const PORTRAIT_STYLE_PROPS = ["fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity", "fill-opacity", "filter"];
const PORTRAIT_FLASH_DURATION = 0.5;
const PORTRAIT_FLASH_OPACITY = 0.85;

// The focus swimmer — keyboard navigation as physics. Arrow keys walk
// the graph edge by edge: from the focused note, the neighbor whose
// thread best matches the pressed direction wins (unit-vector dot
// product against the arrow's own axis, with a floor so "right" never
// lurches to a note that's essentially straight up), Enter dives into
// the focused note through the exact same state machine a click uses,
// Escape lets go. The focus indicator is no static outline: an ink ring
// that SWIMS to each newly focused note on an underdamped spring,
// squashing along its own travel direction like everything else that
// moves here, and plucking the thread it just swam along — the same
// ring-down, splash, and pitched voice, because traveling a thread is
// traveling a thread whether a cursor sweep or a keystroke did it. The
// first arrow press with nothing focused seeds at the desk's own hub
// (highest degree, ties by id — the same crowning rule the orrery
// uses). Focus arrival also raises the hover card and silhouette morph,
// so keyboard visitors get every reading a pointer hover gives. Under
// reduced motion the ring appears and moves instantly (a focus
// indicator is accessibility, not ornament — it must exist there), and
// the traversal plucks stand down with every other keyboard-cascaded
// motion.
const FOCUS_SPRING = 55; // the swimmer's chase stiffness
const FOCUS_DAMPING = 0.86; // per-frame velocity retention — underdamped, arrives with a little life
const FOCUS_RING_PAD = 8; // px beyond the focused blob's radius
const FOCUS_PLUCK_AMP = 5; // px of vibAmp handed to each thread the swimmer travels
const FOCUS_MIN_ALIGNMENT = 0.25; // dot-product floor before an arrow claims a neighbor

// Spin — the one rigid-body degree of freedom the blobs never had.
// Every node now carries an angular velocity, driven by two honest
// torques and rendered as a real rotation of its own irregular
// silhouette (which is what makes spin legible at all — a perfect
// circle turning is invisible):
//   contact friction — when two surfaces rub past each other, the
//   tangential relative velocity at the contact drags both silhouettes
//   along with it (same sign both sides: friction drags, gears mesh),
//   through 1/mass like every impulse here; a glancing collision leaves
//   both notes visibly turning.
//   ambient vorticity — the curl-noise current is a velocity field, and
//   a small body suspended in a flow turns with the flow's own local
//   rotation, ζ = ∂v_y/∂x − ∂v_x/∂y, measured here by central
//   differences over four extra field samples per node per frame (a
//   deliberate spend: it is exactly what makes the idle desk read as
//   leaves turning in eddies rather than decals sliding on glass).
// The angular velocity chases the local vorticity on a slow ease — which
// doubles as the ring-down for contact kicks, one relaxation doing both
// jobs — and the contact dimples stay world-honest by folding the
// current rotation into their anchor angles: a dent is material, it
// turns with the body, and the pressure field re-finds whichever anchors
// NOW face the neighbor. Skipped wholesale under reduced motion:
// autonomous rotation is ambient motion by definition, and the static
// transform from the JSX simply remains.
const SPIN_CONTACT_GAIN = 0.4; // rad/s of kick per (domain unit/s) of contact slip, at mass 1
const SPIN_VORTICITY_GAIN = 1.1; // rad/s per unit of local curl
const SPIN_VORTICITY_EASE = 0.03; // per-frame chase toward the flow's rotation — also the contact kicks' own decay
const SPIN_VORTICITY_STEP = 2; // domain units — the finite-difference half-step
const SPIN_MAX = 3.5; // rad/s — a blob turns, it never becomes a fan

// Long exposure — the constellation photographing itself. A toggleable
// film under the graph: every frame, every note deposits a faint dot of
// its own ink at its position into a WORLD-space canvas (accumulated at
// zoom-1 resolution, then blitted through the live camera transform, so
// panning and zooming move the developed image exactly like everything
// else in the world), while a slow destination-out wash fades old light
// away. What develops is the physics' own history, star-trail style:
// orbits draw their ellipses, comets their conics, a throw its arc, the
// reshuffle its chrysanthemum, the ambient drift its eddies — and a note
// that sits still burns a dark pool, exactly as a long exposure treats
// anything that doesn't move. The fade runs every Nth frame with a
// non-tiny alpha rather than every frame with a minuscule one, because
// 8-bit canvas alpha quantizes washes below 1/255 to zero and the film
// would never fully clear. Toggling on starts fresh film; a resize wipes
// it (the world canvas must be rebuilt, and stretching an old exposure
// would be a lie about where things had been). Hidden and inert under
// reduced motion — a long exposure of a still scene is just a smudge.
const EXPOSURE_DEPOSIT_ALPHA = 0.045; // per frame, per note
const EXPOSURE_DOT_FACTOR = 0.12; // dot radius as a fraction of the node's rendered radius
const EXPOSURE_FADE_EVERY = 10; // frames between washes…
const EXPOSURE_FADE_ALPHA = 0.014; // …at this strength — ≈20s to darkness-free film

// The aim line — while a gripped note is moving fast enough to be a
// throw in progress, its future appears: the same force laws run AHEAD
// in time (repulsion by the same k²/d, the active law's own springs or
// attraction, the same damping and a = F/m) from the note's live
// position and velocity, and the resulting trajectory draws as a faint
// dotted filament. In the web it bends around the crowd's repulsion; in
// the orrery it visibly curves toward capture by its own conic; in the
// strata it arcs home to its shelf — billiards aiming, granted by
// honest integration rather than a guess. The one admitted
// approximation, stated rather than hidden: the rest of the world is
// FROZEN for the lookahead (nothing else moves, orbits hold this
// instant's phase, the pool's slope and the ambient current's clock stay
// put, collisions don't resolve) — a prediction of the throw, not of
// the whole desk's future, which is exactly what an aim line is for.
// Appears only above a real working speed (a held-still note needs no
// oracle), eases in and out rather than flickering, and never exists
// under reduced motion since the grip itself doesn't displace there.
const AIM_STEPS = 44; // lookahead integration steps…
const AIM_DT = 0.035; // …of this much simulated time each — ≈1.5s of future
const AIM_MIN_SPEED = 8; // domain units/s of hand speed before the oracle speaks
const AIM_OPACITY = 0.4;

// Impact shake — a collision hard enough to hear (the thud threshold)
// also kicks the view itself: a small damped tremor added to the world
// transform at render time only. Two incommensurate frequencies so the
// shake never reads as a loop, amplitude capped low enough to feel like
// the desk being knocked rather than an earthquake, and strictly
// render-level — the camera's own math, the minimap, and every
// unprojection keep reading the true, unshaken camera, the same honest
// split the parallax established. Fed only outside reduced motion.
const SHAKE_GAIN = 0.9; // px of tremor per impact unit past the thud threshold
const SHAKE_MAX = 5; // px — the hardest knock stays a knock
const SHAKE_DECAY = 7; // 1/s — over in a third of a second

// The pointer's own wake — the bare cursor moving quickly over the pool
// leaves a faint ripple behind it, an order under the stirring rod's
// deliberate streak: the water is simply always there, and a hand moved
// through it says so. Gated off during pans (the world moves, not the
// hand), node drags (the node's own wake already speaks), and stirring
// (the rod's wake IS this, louder).
const POINTER_WAKE_MIN_PX = 6; // px of motion per event before the water notices
const POINTER_WAKE_GAIN = 0.0012; // splash per px of pointer travel
const POINTER_WAKE_MAX = 0.06; // per-event cap — a passing hand, never a paddle

// The stereo pool — every positioned cue pans to where its event
// actually sits on screen right now (through the camera, so panning the
// view genuinely re-seats the orchestra): plucks voice from their
// thread, drips from their splash, thuds from their collision. A sonar
// tap's arpeggio sweeps across the stereo field as its front expands —
// which is the whole point. Width stops short of hard left/right; full
// ±1 reads as headphone ping-pong, not a pool in front of you.
const STEREO_WIDTH = 0.7;

// Hard collisions squirt ink — the visual half of the contact thuds,
// through the pool: a landing worth hearing is worth a splash at the
// point of contact, and through the buoyancy coupling that splash then
// genuinely shoves the neighborhood. Same impact channel, no extra
// bookkeeping.
const IMPACT_SPLASH_GAIN = 0.08; // splash per domain unit of resolved overlap
const IMPACT_SPLASH_MAX = 0.25;

// The pool pushing back — two-way coupling, the loop this file had been
// running half-open: every energetic thing the graph does already
// splashes the ink surface (wakes, plucks, dew, taps, detonations, the
// dive), but until now the pool never answered. Now every node reads the
// surface slope under itself each substep (utils/waveField.js's
// gradientAt — the read-side mirror of the splash) and surfs downhill,
// −∇h, through the same a = F/m as every other force. What falls out for
// free is the whole catalog: a sonar front physically shoves notes as it
// passes, the reshuffle's center detonation is a real shockwave that
// scatters the desk outward, a dive splashes hard enough to rock the
// selected note's neighbors, a fast drag's wake makes bystanders bob,
// and a dew drop landing nudges whatever floats nearby — none of it
// scripted, all of it the one wave equation answering. The force is
// capped so the biggest detonation shoves rather than launches, and the
// gain is tuned an order under the layout's own forces: the pool
// perturbs arrangements, it never argues with them. Never active under
// reduced motion, by construction — the surface itself is never built
// there, and no surface means no slope to feel.
const BUOYANCY_GAIN = 45; // force per unit of surface slope
const BUOYANCY_MAX = 14; // cap — a detonation shoves, it doesn't launch

// Mass wells — mass finishes the physical story buoyancy started. Every
// note has had real Newtonian INERTIA since MASS_MAX_BONUS (a=F/m: heavy
// notes yield less to every force); this gives it real Newtonian GRAVITY
// too, the other half of what mass does in an actual universe. Every
// frame, every note presses a small continuous depression into the ink
// surface at wherever it currently sits — re-applied each frame rather
// than stamped once, so the well genuinely tracks its note like a real
// dimple in a rubber sheet would, not a footprint left behind — scaled
// by how far its own mass sits above the lightest possible note (an
// empty one, mass exactly 1), so a bare note presses essentially nothing
// and only a genuinely substantial one visibly loads the surface. This
// is not a new force in its own right: it's read back entirely through
// the buoyancy coupling that already exists two blocks below — a light
// note drifting near a heavy one's well simply feels a stronger downhill
// pull toward it, the classic "marble deflecting into a bowling ball's
// dent in a rubber sheet" picture, produced here by composing two
// systems this file already had rather than adding a third. No new
// rendering either: the ink shader already shades by |h|, so a heavy
// note's own well shows up as a standing pool beneath it for free.
// Negative amount (a trough, not a crest) is what makes buoyancy's own
// −∇h actually point downhill TOWARD the well from outside it. Gated
// implicitly by `ink` itself being null under reduced motion, the same
// as every other splash call already is.
const WELL_GAIN = 0.55; // trough depth per second per unit of (mass − 1)

// Contact thuds — collisions become audible through utils/sound.js's own
// playImpact, the exact paper-on-paper landing voice the note pile
// already uses (a collision here IS two notes landing against each
// other; same event, same sound). Strength comes from the frame's
// resolved overlap — the same impact channel that rings the jelly — so a
// graze whispers and a hard fling knocks. Two cooldowns keep a crowded
// desk from drumrolling: per-node (a note can't re-thud while it's still
// visibly wobbling from the last one) and global (the desk as a whole
// stays under a rate any real pile of paper would). Muted during
// annealing (mode switches and reshuffles resolve dozens of overlaps a
// frame — a migration is one event, not fifty landings) and through the
// opening bloom, the same restraint the bridge snaps already learned.
const THUD_MIN_IMPACT = 0.9; // domain units of resolved overlap before a hit is worth hearing
const THUD_REF_IMPACT = 3; // the overlap that reads as a full-strength landing
const THUD_COOLDOWN = 0.3; // s, per node
const THUD_GLOBAL_GAP = 0.07; // s, across the whole desk
const THUD_LEVEL = 0.7; // scales playImpact's own strength curve down to ambient register

// The family lean — while a note is held in the grip, every note sharing
// a tag with it leans toward the hand: a weak capped spring toward the
// held note itself, on top of whatever law currently runs the layout.
// Picking a note up literally makes its family stir and reach — relation
// answered by touch rather than by looking at threads — and setting it
// down lets the current law reclaim them. Deliberately mode-blind (in
// the orrery the lean visibly strains against orbits; in the strata,
// against shelves — the tension between "belongs with this" and "belongs
// here" made physical) and deliberately weaker than any law it rides on:
// the family leans, it does not come loose. Gated on reduced motion —
// drag.id is set there for click detection even though displacement
// isn't, and a press must not set the neighborhood swaying.
const LEAN_K = 0.4; // force per domain unit of separation from the held note
const LEAN_MAX = 11; // cap — distant family leans no harder than near

// Path tension — a traced shortest path has been a purely visual
// statement until now (a bold flowing stroke, drawn over whatever the
// layout already decided): once a path has real interior hops (3+
// members — a direct 2-note path has no interior to straighten), every
// member BETWEEN the two anchors feels a weak spring toward its own
// perpendicular foot on the straight segment joining the two anchors'
// live positions — clamped to the segment itself (t ∈ [0,1]), so a member
// that happens to sit off to the side of the line is pulled toward the
// line, never past either anchor. The two anchors themselves are exempt
// (they're the line; nothing pulls an endpoint toward itself) and so is
// every note NOT on the path — this rides on top of whatever law is
// active exactly like the family lean, weak enough to visibly strain
// against a law's own forces rather than override them (an orrery member
// mid-path still answers to its orbit first). The readable effect: trace
// a path and its own interior hops visibly draw taut, the graph
// physically favoring the route just asked about. Recomputed by hand
// each step() call from shortestPathRef (a plain array, short by
// construction — the same O(path length) a plain edge-scan already costs
// elsewhere) rather than folded into the main per-node loop, so nodes
// that aren't on the path pay nothing for this at all.
const PATH_TENSION_GAIN = 0.55; // force per domain unit of perpendicular distance from the anchor-to-anchor line
const PATH_TENSION_MAX = 9; // cap, the same restraint discipline the family lean already keeps

const SONAR_SPEED = 55; // domain units/s — the front's wave speed
const SONAR_MAX_R = 46; // domain units — where the front dies out
const SONAR_POOL = 4; // concurrent fronts; further taps just miss until a slot frees
const SONAR_PLUCK_AMP = 6; // px of vibAmp at zero range, before the linear fade
const SONAR_NODE_PULSE = 0.2; // jelly pulse on nodes the front passes
const SONAR_SPLASH = 0.5; // the tap's own emit splash
const SONAR_NODE_SPLASH = 0.12; // per passed node, at full energy
const SONAR_RING_OPACITY = 0.3; // the visible front's opacity at zero range

// The field guide's catalog (see the guide JSX) — every gesture this
// stage answers to, grouped by which hands it asks for. Rows flagged
// `motion` describe gestures that stand down under reduced motion and
// are filtered out rather than shown as dead promises. This list is the
// discoverability debt of everything above paid in one place: the stage
// accumulated a musician's worth of technique, and technique nobody can
// find is decoration.
const GUIDE_SECTIONS = [
  {
    title: "One hand",
    rows: [
      { keys: ["Click"], text: "Open a note — the dive." },
      { keys: ["Drag a note"], text: "Haul it — mass is real; release to fling.", motion: true },
      { keys: ["Drag a thread"], text: "Tow both its notes by real tension.", motion: true },
      { keys: ["Drag open water"], text: "Pan the camera." },
      { keys: ["Right-drag"], text: "Stir the pool.", motion: true },
      { keys: ["Tap open water"], text: "Sonar — the front strums what it crosses.", motion: true },
      { keys: ["Shift", "Tap water"], text: "Strike the pool's own drum modes.", motion: true },
      { keys: ["Shift", "Click note"], text: "Path anchor — two trace the shortest route." },
      { keys: ["Alt", "Click note"], text: "Pin a note where it sits." },
      { keys: ["Ctrl/Cmd", "Drag water"], text: "Lasso-select notes — P pins the whole group." },
      { keys: ["Double-click"], text: "Dive to a cluster, or reset the view." },
      { keys: ["Wheel"], text: "Zoom at the cursor." },
    ],
  },
  {
    title: "No hands",
    rows: [
      { keys: ["↑↓←→"], text: "Swim focus along the threads." },
      { keys: ["Enter"], text: "Open the focused note." },
      { keys: ["Space"], text: "Ping outward from the focused note.", motion: true },
      { keys: ["P"], text: "Pin the focused note." },
      { keys: ["1", "2", "3", "4", "5"], text: "Web · Orrery · Strata · Spectrum · Flock." },
      { keys: ["/"], text: "Find a note by title or text." },
      { keys: ["?"], text: "This guide." },
      { keys: ["Esc"], text: "Release focus, then close the panel." },
    ],
  },
  {
    title: "Two fingers",
    rows: [
      { keys: ["Pinch"], text: "Zoom and pan by touch." },
      { keys: ["Twist"], text: "Tilt the desk — it springs back level on release.", motion: true },
    ],
  },
];

const truncateTitle = (title) => {
  const text = (title || "Untitled").trim() || "Untitled";
  return text.length > 20 ? `${ text.slice(0, 19) }…` : text;
};

// A normalized, order-independent key for a pair of note ids — used to
// check whether a given rendered edge is one of the specific consecutive
// pairs a shortest path actually walks (see pathEdgeIds below), not just
// "connects two notes that both happen to be somewhere on the path" — two
// path-member notes can easily share an edge that the path itself never
// used.
const pairKey = (x, y) => (x < y ? `${ x }|${ y }` : `${ y }|${ x }`);

// Strict segment-segment intersection via the standard orientation
// (cross-product sign) predicate — two segments properly cross exactly
// when each one's endpoints fall on opposite sides of the other's own
// line. Strict (< 0, not <= 0) on purpose: a cursor path that merely
// grazes an edge's endpoint shouldn't count as sweeping across the
// thread, and the degenerate collinear cases the non-strict version
// would have to arbitrate simply don't qualify.
const orient = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
const segmentsCross = (p1x, p1y, p2x, p2y, p3x, p3y, p4x, p4y) =>
  orient(p1x, p1y, p2x, p2y, p3x, p3y) * orient(p1x, p1y, p2x, p2y, p4x, p4y) < 0
  && orient(p3x, p3y, p4x, p4y, p1x, p1y) * orient(p3x, p3y, p4x, p4y, p2x, p2y) < 0;

// Point-to-segment distance — the standard clamped-projection form (project
// the point onto the segment's own line, clamp the parameter to [0,1] so
// endpoints answer for everything past them, measure to that closest
// point). The thread tow's grab test and the sonar's crossing test both
// ask exactly this question of every edge's chord.
const pointSegDist = (px, py, x1, y1, x2, y2) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq)) : 0;
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
};

// Connected components of the tag graph — a plain BFS flood fill (the same
// head-index queue discipline findShortestPath below uses, and for the
// same O(n + e) reason), run once at build time to give each cluster ink
// pool its member list. Only components with an actual interior
// (HULL_MIN_MEMBERS+) come back — see the HULL_MIN_MEMBERS comment.
const findComponents = (nodeIds, edges) => {
  const adjacency = new Map();
  edges.forEach((edge) => {
    if (!adjacency.has(edge.a)) adjacency.set(edge.a, []);
    if (!adjacency.has(edge.b)) adjacency.set(edge.b, []);
    adjacency.get(edge.a).push(edge.b);
    adjacency.get(edge.b).push(edge.a);
  });

  const visited = new Set();
  const components = [];

  for (const id of nodeIds) {
    if (visited.has(id) || !adjacency.has(id)) continue;
    visited.add(id);
    const members = [id];
    for (let head = 0; head < members.length; head++) {
      for (const neighbor of adjacency.get(members[head]) || []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        members.push(neighbor);
      }
    }
    if (members.length >= HULL_MIN_MEMBERS) components.push(members);
  }

  return components;
};

// Breadth-first search — the standard, correct algorithm for shortest path
// in an unweighted graph (every edge costs exactly one hop; BFS explores
// in strictly increasing hop-distance order from the start, so the first
// time it reaches `endId` is provably via the fewest possible edges,
// unlike a plain DFS which offers no such guarantee). `queue` is walked
// with a plain head index rather than `Array.prototype.shift()` — shift()
// is O(n) per call (it has to renumber every remaining element), which
// would make this whole search O(n²) instead of the O(n + e) BFS is
// supposed to be; an index pointer costs nothing extra to read and avoids
// that entirely.
const findShortestPath = (edges, startId, endId) => {
  if (startId === endId) return [startId];

  const adjacency = new Map();
  edges.forEach((edge) => {
    if (!adjacency.has(edge.a)) adjacency.set(edge.a, []);
    if (!adjacency.has(edge.b)) adjacency.set(edge.b, []);
    adjacency.get(edge.a).push(edge.b);
    adjacency.get(edge.b).push(edge.a);
  });

  const visited = new Set([startId]);
  const prev = new Map();
  const queue = [startId];

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (current === endId) {
      const path = [];
      for (let node = endId; node !== undefined; node = prev.get(node)) path.unshift(node);
      return path;
    }

    for (const neighbor of adjacency.get(current) || []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      prev.set(neighbor, current);
      queue.push(neighbor);
    }
  }

  return null; // no path — startId and endId sit in different connected components
};

// Module-level, not component state — the one thing that actually makes
// "persists across the panel closing and reopening" true for pins, the
// tag lens, and the chosen layout law. NoteConstellationPanel.jsx nests
// this component INSIDE SheetPanel's own children, and SheetPanel wraps
// its whole subtree in an `{ open && (...) }` gate of its own; the
// instant `open` goes false, NoteConstellationPanel's very next render
// already stops including this component in what it hands SheetPanel,
// and SheetPanel's own AnimatePresence exit (a few hundred milliseconds)
// only delays the actual removal — it doesn't prevent it. So this
// component GENUINELY unmounts every time the panel closes, discarding
// every ordinary useState it owns, well before any realistic "closed it,
// did something else, came back" reopen. A plain variable at module
// scope sidesteps that entirely: it isn't tied to any component
// instance, so it survives exactly as long as the page itself does — a
// session-scoped cache, the same "gone on a hard reload, nothing else"
// lifetime already ordinary about everything in this app that isn't
// explicitly written to utils/storage.js. Read once as each state's own
// initial value below, and written back on every render via the same
// plain-assignment-in-the-render-body trick this file already leans on
// for every ref sync (see pinnedIdsRef's own line right below) —
// deliberately NOT full localStorage persistence,
// since these comments' own original intent ("a standing question about
// the desk," "the same desk always crowns the same sun") reads as
// per-visit, not something that ought to survive a closed browser tab.
let persistedPinnedIds = [];
let persistedActiveTag = null;
let persistedMode = "web";

const NoteConstellation = ({ active, notes, onSelectNote, reduceMotion = false }) => {
  const svgRef = useRef(null);
  const worldGroupRef = useRef(null);
  const nodeElRefs = useRef({});
  const edgeElRefs = useRef([]);
  const blobPathElRefs = useRef({});
  const cardElRef = useRef(null);
  const shapeCacheRef = useRef(new Map());
  const morphControllerRef = useRef(null);
  const minimapDotRefs = useRef({});
  const minimapViewportRef = useRef(null);
  const minimapControllerRef = useRef(null);
  // True while a pointer is scrubbing across the minimap (see its own
  // pointer handlers) — a plain ref, since nothing renders from it.
  const minimapScrubRef = useRef(false);
  const hullElRefs = useRef({});
  const clusterLabelRefs = useRef({});
  const trailElRefs = useRef({});
  const moonElRefs = useRef({});
  // The fisheye boundary's own faint ring — lives in screen space (outside
  // worldGroupRef), positioned every frame by the tick loop.
  const lensRingRef = useRef(null);
  const reheatControllerRef = useRef(null);
  // The toss's own bridge into the physics closure (see the TOSS_GRAVITY
  // constant block) — same controller-ref pattern as reheat/mode.
  const tossControllerRef = useRef(null);
  // The search fly-to's own bridge into the physics closure (see
  // flyToWorldBox and the search JSX further down) — same controller-ref
  // pattern as morph/minimap/reheat.
  const searchControllerRef = useRef(null);
  const searchInputRef = useRef(null);
  const inkCanvasRef = useRef(null);
  // The dive effect's bridge to the ink surface living inside the physics
  // effect's closure — same controller-ref pattern as morph/minimap/reheat.
  const inkControllerRef = useRef(null);
  const labelElRefs = useRef({});
  // Thread dew (see the DEW_GLOBAL_RATE constant block) — one forming
  // droplet per edge (by the same index edgeElRefs uses) plus a small
  // fixed pool of falling drops, recycled by slot.
  const dewElRefs = useRef([]);
  const dewFallRefs = useRef([]);
  // Liquid bridges (see the BRIDGE_REACH constant block) — a fixed pool of
  // neck paths, each with its own two-stop userSpaceOnUse gradient.
  const bridgePathRefs = useRef([]);
  const bridgeGradRefs = useRef([]);
  const bridgeStopARefs = useRef([]);
  const bridgeStopBRefs = useRef([]);
  // The orrery's orbit guides and the strata's shelf furniture (see the
  // LAYOUT_MODES block) — static geometry from the build, transforms
  // written per frame by the tick loop while their mode is the active law.
  const orbitGuideRefs = useRef({});
  const strataBandRefs = useRef([]);
  const strataLabelRefs = useRef([]);
  // The spectrum wheel's own furniture (see the SPECTRUM_COLOR_ORDER
  // constant block) — fixed-count (SPECTRUM_SECTORS.length), same
  // index-keyed pattern as the strata bands/labels above.
  const spectrumWedgeRefs = useRef([]);
  const spectrumLabelRefs = useRef([]);
  // The mode switch's bridge into the physics closure (annealing kick,
  // center splash, reduced-motion re-settle) — same controller-ref
  // pattern as morph/minimap/reheat/ink.
  const modeControllerRef = useRef(null);
  // The sonar fronts' fixed ring pool (see the SONAR_SPEED constant
  // block) — ellipses, since a circle in domain space renders through
  // the domain's own anisotropic scale.
  const sonarRingRefs = useRef([]);
  // The current streamlines' filament pool (see the STREAM_COUNT
  // constant block) — geometry and fade written per frame by tick().
  const streamElRefs = useRef([]);
  // The focus swimmer's ring (see the FOCUS_SPRING constant block) —
  // topmost world element, chased into place every frame by tick().
  const focusRingRef = useRef(null);
  // The Voronoi territories' cell paths, by note id (see the VORONOI
  // constant block) — geometry written per frame while the overlay is on.
  const voronoiElRefs = useRef({});
  // The aim line's path (see the AIM_STEPS constant block) — geometry
  // and fade written per frame while a throw is in progress.
  const aimPathRef = useRef(null);
  // The long-exposure film's display canvas (see the EXPOSURE constants)
  // — the world-space accumulation canvas lives inside the physics
  // effect's closure; this is only where it gets blitted through the
  // camera.
  const exposureCanvasRef = useRef(null);
  // The lasso's own in-progress stroke (see the LASSO_POINT_GAP constant
  // block) — geometry written per frame by tick() while a ctrl-drag is
  // live.
  const lassoPathRef = useRef(null);
  // The field guide's own toggle button (see the guide JSX) — the guide
  // closing (via its X or its own local Escape handler) refocuses this,
  // the standard "return focus to the invoking control" dialog pattern.
  // Needed because the button lives outside the svg's own DOM subtree:
  // clicking it to OPEN the guide leaves focus sitting on the button
  // itself, not on the svg, so the svg-scoped handleKey never sees a
  // subsequent Escape at all — it would otherwise bubble straight past
  // this component to the panel's own window-level Escape and close the
  // whole sheet instead of just the guide. The guide's own onKeyDown
  // (see its JSX) plus autoFocus on its close button are the other half
  // of this fix, mirroring exactly how the search pill already moves
  // focus into its input when opened by a click for the same reason.
  const guideToggleRef = useRef(null);
  // The portrait's own flash overlay (see the PORTRAIT_FLASH_DURATION
  // constant block) — a plain sibling div, deliberately OUTSIDE the
  // <svg> being captured, driven by a direct GSAP tween inside
  // capturePortrait rather than React state (the same one-off-moment
  // discipline the dive effect's own imperative tweens already follow).
  const portraitFlashRef = useRef(null);
  // True for the duration of an in-flight capture — capturePortrait is
  // async (one real await, the SVG rasterizing into an <img>), and a
  // second click landing in that window would otherwise start an
  // entirely independent second pipeline: harmless on its own (nothing
  // shared mutates unsafely), but two competing downloads for one click
  // is a rough edge worth just not having.
  const capturingPortraitRef = useRef(false);

  const [graph, setGraph] = useState({ nodes: [], edges: [], clusters: [], orbits: [], strata: [] });
  const [hoveredId, setHoveredId] = useState(null);
  const [phase, setPhase] = useState("idle");
  const [selectedId, setSelectedId] = useState(null);
  // Up to two note ids, set by shift-clicking a node (see handleDown
  // further down) — deliberately a different gesture from a plain click,
  // which still opens the note exactly as it always has. A third
  // shift-click rolls the older anchor out rather than growing past two,
  // since a "path" only ever means something between exactly two notes.
  const [pathAnchors, setPathAnchors] = useState([]);
  // Alt-clicked pin anchors (see the pinning constant-block comment above)
  // — React state for the ring visuals, mirrored per-node as a plain
  // `pinned` flag on the physics side (see handleDown's own alt-click
  // branch), the same two-representation split hover already lives with
  // (hoveredId state for class toggling, hoveredIdRef for the tick loop).
  // Seeded from persistedPinnedIds (see that module-level variable's own
  // comment for why a plain useState default can't carry this across a
  // panel close/reopen on its own) and written back below.
  const [pinnedIds, setPinnedIds] = useState(persistedPinnedIds);
  // The tag lens's current tag, or null (see the LENS_MAX_TAGS constant
  // block) — persisted across panel close/reopen the same way pins are,
  // since a lens is a standing question about the desk, not about one
  // mount of the graph (see persistedActiveTag).
  const [activeTag, setActiveTag] = useState(persistedActiveTag);
  // The fisheye magnifier's on/off state (see the FISHEYE constants) —
  // React state for the button visual, mirrored as a ref for the tick loop,
  // the same two-representation split hover and pins already live with.
  // Deliberately NOT in the persistedX family below: a whole-scene
  // cursor-tracking distortion left silently on from a previous visit
  // would be a stranger thing to inherit than a curated layout is.
  const [magnify, setMagnify] = useState(false);
  // The pool's own voice (see utils/sound.js's own updatePoolVoice) — a
  // fresh useState(false) rather than a persistedX module variable on
  // purpose: unlike a curated layout or a standing lens, a visitor
  // probably doesn't want ambient sound resuming un-asked on a later
  // visit just because a past one turned it on.
  const [poolVoiceOn, setPoolVoiceOn] = useState(false);
  // The current layout law (see the LAYOUT_MODES block) — React state for
  // the switcher and the mode-gated layers, mirrored as a ref for step()
  // and tick(). Persists across close/reopen like the lens and pins (see
  // persistedMode).
  const [mode, setMode] = useState(persistedMode);
  // Keyboard focus (see the FOCUS_SPRING constant block) — React state
  // for the aria-live announcement, mirrored as a ref for the keydown
  // handler and the swimmer's tick chase.
  const [focusId, setFocusId] = useState(null);
  // The Voronoi territories overlay (see the VORONOI constant block) —
  // React state for the pill and the layer's fade class, mirrored as a
  // ref for the tick loop's per-frame tessellation.
  const [territories, setTerritories] = useState(false);
  // The skeleton reading (see the Kruskal block in the build effect) —
  // pure class toggling, so React state alone suffices.
  const [skeleton, setSkeleton] = useState(false);
  // The long-exposure film (see the EXPOSURE constants) — React state
  // for the pill and the canvas's fade class, mirrored as a ref for the
  // tick loop's develop/blit pass.
  const [exposure, setExposure] = useState(false);
  // The field guide (see GUIDE_SECTIONS) — mirrored as a ref for the
  // keydown handler's own Escape layering.
  const [guideOpen, setGuideOpen] = useState(false);
  // Search (see the SEARCH_FIT_PADDING constant block) — searchOpen owns
  // the pill's bloom, searchQuery the live filter text. Neither needs a
  // ref into the physics closure: the search input lives outside the
  // svg's own DOM subtree, so its keystrokes never reach handleKey, and
  // handleKey's own "/" branch only ever needs to set state, never read
  // it back.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // The lasso's current selection (see the LASSO_POINT_GAP constant
  // block) — React state for the per-note halo rings and the status
  // pill's own count, mirrored as a ref for the physics closure's own
  // handleKey (Escape clears it, P group-pins it).
  const [lassoIds, setLassoIds] = useState([]);
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
  // Read at graph build time (see the byId construction below) so pins
  // survive the panel closing and reopening — note ids are stable across
  // rebuilds, so a pin set last visit still names a real node.
  const pinnedIdsRef = useRef(pinnedIds);
  pinnedIdsRef.current = pinnedIds;
  // Written back on every render, the same plain-assignment-in-the-body
  // pattern the ref line above already uses (safe for the same reason:
  // idempotent, not read by anything else during THIS render, and this
  // file already leans on the identical trick everywhere it mirrors
  // state into a ref) — see persistedPinnedIds's own comment for why a
  // module-level variable is what actually needs the value, not a ref.
  persistedPinnedIds = pinnedIds;
  persistedActiveTag = activeTag;
  // Read by handleDown's shift-click branch inside the [active]-only
  // physics effect (which never re-runs on pathAnchors changes) to tell a
  // fresh anchor from a removal — only a fresh one launches a signal ping.
  const pathAnchorsRef = useRef(pathAnchors);
  pathAnchorsRef.current = pathAnchors;
  // Mirrors shortestPath (see that useMemo further down) for the path
  // tension force — declared here with the rest of this render's ref
  // bridges, but only assigned once shortestPath itself is actually
  // computed below, the same order every other value-dependent ref
  // assignment in this block already respects.
  const shortestPathRef = useRef(null);
  const magnifyRef = useRef(magnify);
  magnifyRef.current = magnify;
  const poolVoiceOnRef = useRef(poolVoiceOn);
  poolVoiceOnRef.current = poolVoiceOn;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  persistedMode = mode;
  const focusIdRef = useRef(focusId);
  focusIdRef.current = focusId;
  const territoriesRef = useRef(territories);
  territoriesRef.current = territories;
  const exposureRef = useRef(exposure);
  exposureRef.current = exposure;
  const guideOpenRef = useRef(guideOpen);
  guideOpenRef.current = guideOpen;
  const lassoIdsRef = useRef(lassoIds);
  lassoIdsRef.current = lassoIds;

  const togglePathAnchor = (id) => {
    setPathAnchors((prev) => {
      if (prev.includes(id)) return prev.filter((anchorId) => anchorId !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  // The tag lens toggle — playTick is the right register (a fiddly,
  // repeatable UI acknowledgment, exactly what that cue exists for), and
  // like every cue it stays silent unless the visitor has sounds on.
  const toggleLens = (tag) => {
    playTick();
    setActiveTag((prev) => (prev === tag ? null : tag));
  };

  // Switching layout law (see the LAYOUT_MODES block). modeRef is written
  // by hand BEFORE the controller call rather than waiting for the render
  // to sync it — the controller may run the reduced-motion settle pass
  // synchronously, and that pass has to solve under the law being switched
  // TO, not the one still sitting in the ref from the previous render.
  // Compared against modeRef rather than the `mode` closure on purpose:
  // the physics effect's own keydown handler (1/2/3 — see handleKey)
  // captures this function once at mount, and the ref is the only
  // version of "current mode" that capture can't stale. Every other
  // reference here is already capture-safe (setState and refs are
  // stable), which is what makes the capture legal at all.
  const switchMode = (next) => {
    if (next === modeRef.current) return;
    playTick();
    modeRef.current = next;
    setMode(next);
    modeControllerRef.current?.transition();
  };

  // The portrait (see the PORTRAIT_STYLED_SELECTOR constant block) — a
  // plain component-level function rather than another controller-ref
  // bridge into the physics effect: everything it needs (the svg, the
  // ink/exposure canvases, whether exposure is on) is already a public
  // ref or piece of state up here, with nothing private to the physics
  // closure required.
  const capturePortrait = async () => {
    const svg = svgRef.current;
    if (!svg || capturingPortraitRef.current) return;
    capturingPortraitRef.current = true;

    // The WHOLE pipeline lives inside this one try — not just its async
    // tail — specifically so the finally below is the one, unconditional
    // place capturingPortraitRef gets released. A throw anywhere in the
    // synchronous setup (getComputedStyle, cloneNode, XMLSerializer) left
    // OUTSIDE the try would skip the finally entirely, leaving the guard
    // stuck at true and silently disabling every future click for the
    // rest of the session.
    try {
      playStamp();
      if (portraitFlashRef.current) {
        gsap.killTweensOf(portraitFlashRef.current);
        gsap.fromTo(
          portraitFlashRef.current,
          { opacity: reduceMotion ? PORTRAIT_FLASH_OPACITY * 0.5 : PORTRAIT_FLASH_OPACITY },
          { opacity: 0, duration: reduceMotion ? 0.15 : PORTRAIT_FLASH_DURATION, ease: "power2.out" }
        );
      }

      const rect = svg.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));

      // Every element that carries its visual identity through an
      // external CSS class — rather than a prop already baked in as a
      // literal fill/strokeWidth attribute — gets that identity resolved
      // to its CURRENT computed value and written back onto the clone as
      // an inline style, since the isolated context a serialized SVG
      // rasterizes in has no access to this app's own stylesheet (see
      // the constant block's own comment for why getComputedStyle
      // rather than a hand-copied shadow stylesheet). Walked on a
      // targeted selector, not the whole tree — skips the hundreds of
      // currently-inert pooled elements (unused dew/bridge/sonar/stream
      // slots sitting at opacity:0) a blind recursive walk would waste
      // time resolving.
      const svgClone = svg.cloneNode(true);
      svgClone.setAttribute("width", width);
      svgClone.setAttribute("height", height);
      svgClone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      const liveStyled = svg.querySelectorAll(PORTRAIT_STYLED_SELECTOR);
      const cloneStyled = svgClone.querySelectorAll(PORTRAIT_STYLED_SELECTOR);
      liveStyled.forEach((liveEl, i) => {
        const cloneEl = cloneStyled[i];
        if (!cloneEl) return;
        const computed = getComputedStyle(liveEl);
        cloneEl.setAttribute("style", PORTRAIT_STYLE_PROPS.map((prop) => `${ prop }:${ computed.getPropertyValue(prop) }`).join(";"));
      });

      const bg = getComputedStyle(document.documentElement).getPropertyValue("--page-bg-color").trim() || "#fffeff";
      const svgString = new XMLSerializer().serializeToString(svgClone);
      const svgDataUri = `data:image/svg+xml;charset=utf-8,${ encodeURIComponent(svgString) }`;

      const graphImg = new Image();
      const graphLoaded = new Promise((resolve, reject) => {
        graphImg.onload = resolve;
        graphImg.onerror = reject;
      });
      graphImg.src = svgDataUri;
      await graphLoaded;

      // Everything from here on is synchronous on purpose, with no
      // further await between the ink's own forceRender and the
      // drawImage that reads it — see inkControllerRef's own forceRender
      // comment for why that gap is exactly what would let the browser
      // clear the buffer out from under this capture.
      inkControllerRef.current?.forceRender();

      const canvas = document.createElement("canvas");
      // Capped the same way InkSurface itself already caps its own pixel
      // ratio — sharp on a retina screen without an unbounded canvas size
      // on the highest-density displays.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      const ctx = canvas.getContext("2d");
      ctx.scale(dpr, dpr);

      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      // The ink pool and the long-exposure film, when it's on, are
      // already real <canvas> elements — drawImage reads their current
      // pixels directly, no serialization needed for those the way the
      // SVG graph itself needs one.
      if (inkCanvasRef.current) ctx.drawImage(inkCanvasRef.current, 0, 0, width, height);
      if (exposure && exposureCanvasRef.current) ctx.drawImage(exposureCanvasRef.current, 0, 0, width, height);
      ctx.drawImage(graphImg, 0, 0, width, height);

      const now = new Date();
      const stamp = `${ now.getFullYear() }-${ String(now.getMonth() + 1).padStart(2, "0") }-${ String(now.getDate()).padStart(2, "0") }-${ String(now.getHours()).padStart(2, "0") }${ String(now.getMinutes()).padStart(2, "0") }`;
      const link = document.createElement("a");
      link.download = `note-constellation-${ stamp }.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch {
      // A capture that fails (an unsupported browser, a transient canvas
      // security restriction) is a missed keepsake, not a broken app —
      // the stamp cue and flash already played, so failing silently here
      // rather than surfacing an error is the honest choice: nothing
      // else about the desk was at risk.
    } finally {
      capturingPortraitRef.current = false;
    }
  };

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

  // Real BFS (see findShortestPath's own comment) over the current tag
  // graph — only recomputed when the two anchors or the edge set actually
  // change, not every physics frame; the path itself is geometry-free (a
  // sequence of note ids), so it stays correct regardless of how the
  // layout keeps moving underneath it.
  const shortestPath = useMemo(() => {
    if (pathAnchors.length !== 2) return null;
    return findShortestPath(graph.edges, pathAnchors[0], pathAnchors[1]);
  }, [pathAnchors, graph.edges]);
  // Read by step()'s own path-tension force (see the PATH_TENSION_GAIN
  // constant block) — this [active]-only physics effect never re-runs
  // when a path is traced/cleared, so it reads the live value through
  // this ref instead, the same bridge pathAnchorsRef already is.
  shortestPathRef.current = shortestPath;

  const pathNodeIds = useMemo(() => (shortestPath ? new Set(shortestPath) : null), [shortestPath]);

  const pathEdgeIds = useMemo(() => {
    if (!shortestPath) return null;
    const set = new Set();
    for (let i = 0; i < shortestPath.length - 1; i++) set.add(pairKey(shortestPath[i], shortestPath[i + 1]));
    return set;
  }, [shortestPath]);

  // Which endpoint each path edge is traversed FROM — the ink-flow
  // animation (see the CSS's own note-constellation-flow comment) marches
  // dashes along each on-path thread, but catenaryPath always draws in the
  // edge's own stored a→b order regardless of which way the path actually
  // walks it; an edge walked b→a gets its animation direction flipped so
  // the stream reads as one continuous current from anchor to anchor.
  const pathEdgeFrom = useMemo(() => {
    if (!shortestPath) return null;
    const map = new Map();
    for (let i = 0; i < shortestPath.length - 1; i++) map.set(pairKey(shortestPath[i], shortestPath[i + 1]), shortestPath[i]);
    return map;
  }, [shortestPath]);

  // The tag lens's own chip rail (see the LENS_MAX_TAGS constant block) —
  // every tag on the desk with how many notes carry it, plurality-first
  // (alphabetical between ties, so the rail's order is stable across
  // rebuilds rather than shuffling with Map iteration luck).
  const tagCatalog = useMemo(() => {
    const counts = new Map();
    graph.nodes.forEach((note) => (note.tags || []).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1)));
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, LENS_MAX_TAGS)
      .map(([tag, count]) => ({ tag, count }));
  }, [graph.nodes]);

  // The lens only counts as active while its tag still exists on the desk
  // — activeTag persists across close/reopen (deliberately, see its own
  // useState comment), but the desk may have dropped the tag in between,
  // and a lens naming a tag no note carries would just dim everything.
  const lensTag = useMemo(
    () => (activeTag && tagCatalog.some(({ tag }) => tag === activeTag) ? activeTag : null),
    [activeTag, tagCatalog]
  );

  const lensNodeIds = useMemo(() => {
    if (!lensTag) return null;
    const set = new Set();
    graph.nodes.forEach((note) => { if ((note.tags || []).includes(lensTag)) set.add(note.id); });
    return set;
  }, [lensTag, graph.nodes]);

  // The search's own match set (see the SEARCH_FIT_PADDING constant
  // block) — title or body text, case-insensitive substring, null when
  // the query is empty so the dimming chain below can fall straight
  // through to the lens exactly like lensNodeIds already does.
  const searchNodeIds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    const set = new Set();
    graph.nodes.forEach((note) => {
      const title = (note.title || "").toLowerCase();
      const text = (note.text || "").toLowerCase();
      if (title.includes(q) || text.includes(q)) set.add(note.id);
    });
    return set;
  }, [searchQuery, graph.nodes]);

  // A fresh lens taps the pool once under every member note (see the
  // LENS_SPLASH constant block) — splashNote already no-ops by
  // construction under reduced motion (the ink surface was never created)
  // and before the physics effect has mounted, so this needs no guards of
  // its own. lensNodeIds is deliberately in the deps: a graph rebuild
  // (panel reopen) with a persisted lens re-announces its members, which
  // is exactly when the reminder of where they sit is worth having.
  useEffect(() => {
    if (!lensTag || !lensNodeIds) return;
    lensNodeIds.forEach((id) => inkControllerRef.current?.splashNote(id, LENS_SPLASH));
  }, [lensTag, lensNodeIds]);

  const hoveredNote = useMemo(
    () => (hoveredId ? graph.nodes.find((note) => note.id === hoveredId) || null : null),
    [hoveredId, graph.nodes]
  );

  // The hover card's structural line — how many threads this note holds
  // and which region pool it belongs to: the two facts the graph knows
  // about a note that the note itself doesn't say.
  const hoveredMeta = useMemo(() => {
    if (!hoveredNote) return null;
    const degree = degreeById.get(hoveredNote.id) || 0;
    const region = graph.clusters.find((cluster) => cluster.members.includes(hoveredNote.id))?.label || "";
    return { degree, region };
  }, [hoveredNote, degreeById, graph.clusters]);

  // Cached per-note, keyed on radius too — regenerated only when a note's
  // own degree actually changes (which only happens when the panel reopens
  // and rebuilds the whole graph), not on every render. The rest shape is
  // no longer a one-shot blobPath: its anchors persist in the cache entry
  // (angle/wobble fixed, per-anchor breath phase and rate — see the
  // BREATH_AMP constant block), and the cached `rest` string is that same
  // anchor ring sampled at t = 0, which the tick loop's live breathing
  // then continues from seamlessly.
  const getShapes = (id, radius) => {
    const cached = shapeCacheRef.current.get(id);
    if (cached && cached.radius === radius) return cached;

    const size = radius * 2;
    const anchors = Array.from({ length: BLOB_POINTS_REST }, (_, i) => ({
      angle: (i / BLOB_POINTS_REST) * Math.PI * 2,
      // The same 1 − irr + rng·2irr wobble formula blobPath itself uses,
      // so a breathing rest shape is statistically the exact silhouette
      // family the old static one came from.
      wobble: 1 - BLOB_IRREGULARITY_REST + Math.random() * BLOB_IRREGULARITY_REST * 2,
      phase: Math.random() * Math.PI * 2,
      speed: 0.75 + Math.random() * 0.5,
    }));
    const entry = {
      radius,
      offset: -radius,
      anchors,
      rest: breathingBlobPath(radius, anchors, 0),
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
      // The pour (see POUR_POINT_Y) — every note starts clustered at one
      // shared point near the top edge, jittered just enough that no two
      // ever spawn EXACTLY coincident (see POUR_JITTER), with an
      // outward-and-down velocity kick already in hand. From here on it's
      // an ordinary note to step() — the very same repulsion/attraction/
      // whichever-law-is-active forces that run every frame regardless
      // carry it the rest of the way to wherever it actually belongs, so
      // the "pour" is nothing but these two lines' worth of different
      // initial conditions, not a separate animation system.
      const pourAngle = Math.random() * Math.PI * 2;
      const pourJitter = Math.random() * POUR_JITTER;
      byId.set(note.id, {
        x: cx + Math.cos(pourAngle) * pourJitter,
        y: POUR_POINT_Y + Math.sin(pourAngle) * pourJitter,
        vx: (Math.random() - 0.5) * POUR_KICK_VX,
        vy: POUR_KICK_VY_MIN + Math.random() * POUR_KICK_VY_SPAN,
        fx: 0,
        fy: 0,
        dragging: false,
        // Pins persist across panel close/reopen — see pinnedIdsRef above.
        pinned: pinnedIdsRef.current.includes(note.id),
        revealScale: reduceMotionRef.current ? 1 : 0,
        hoverScale: 1,
        // Inertia from content length — see the MASS_MAX_BONUS constant
        // block. log2(1 + len/scale): an empty note sits at exactly 1.
        mass: 1 + Math.min(MASS_MAX_BONUS, Math.log2(1 + (note.text?.length || 0) / MASS_LENGTH_SCALE)),
        // Jelly deformation state — see the SQUASH_GAIN constant block.
        stretch: 1,
        stretchAngle: 0,
        wobbleAmp: 0,
        wobblePhase: 0,
        impact: 0,
        // Ink comet trail state — see the TRAIL_LENGTH constant block.
        trail: [],
        trailAmp: 0,
        // Kepler moon state — only ever advanced for favorites (see the
        // MOON_RADIUS constant block), but cheap enough to init uniformly.
        favorite: !!note.favorite,
        moonAngle: Math.random() * Math.PI * 2,
        // Flock's own one-time fallback heading (see FLOCK_SPEED_MIN) — a
        // boid spawns at rest, so the thrust that keeps it cruising needs
        // SOME direction to push in before it has ever had a real velocity
        // of its own to hold a heading from.
        flockHeading: Math.random() * Math.PI * 2,
        // Signal-ping arrival pulse (see the PING_HOP_INTERVAL constant
        // block) — folded into the render scale, rung down in tick().
        pingPulse: 0,
        // Last audible collision, in simTime (see the THUD constants).
        lastThud: -1,
        // Rigid-body spin (see the SPIN constants) — angle and angular
        // velocity, advanced in tick(), kicked by contact friction in
        // step().
        rot: 0,
        omega: 0,
        // Resolved once here so the liquid bridges (see the BRIDGE_REACH
        // constant block) can write gradient stops without re-deriving
        // the note's color per frame.
        colorCss: NOTE_COLORS[note.color] || "var(--page-ink-color)",
        // True for the duration of a toss (see the TOSS_GRAVITY constant
        // block) — step() reads this exactly like node.pinned, a signal
        // to leave this node's own integration alone because something
        // else (matter-js, for the toss's own brief window) is driving
        // its position instead.
        tossed: false,
      });
    });

    const edgeList = [];
    for (let i = 0; i < noteList.length; i++) {
      const tagsA = noteList[i].tags || [];
      if (tagsA.length === 0) continue;
      for (let j = i + 1; j < noteList.length; j++) {
        const tagsB = noteList[j].tags || [];
        if (tagsB.length === 0) continue;
        const shared = tagsA.filter((t) => tagsB.includes(t));
        if (shared.length > 0) {
          edgeList.push({
            id: `${ noteList[i].id }:${ noteList[j].id }`,
            a: noteList[i].id,
            b: noteList[j].id,
            weight: shared.length,
            // The actual tags this edge is made of — the tag lens (see the
            // LENS_MAX_TAGS constant block) highlights a thread only if
            // the lens tag is genuinely among them, not merely carried by
            // both endpoints for unrelated reasons.
            sharedTags: shared,
            // Starts at the slack/taut midpoint and settles toward its
            // real target over the first few frames via the same
            // EDGE_SAG_SMOOTHING lag every subsequent frame uses — no
            // special-cased "first frame" logic needed.
            displayK: (EDGE_K_SLACK + EDGE_K_TAUT) / 2,
            // Plucked-string state (see the PLUCK_OMEGA constant block
            // and pluckEdge) — amplitude in px and phase in radians per
            // standing-wave mode, all advanced in tick(). vibAmp stays
            // the fundamental's own name because every threshold in this
            // file (dew shake, sound gates, headroom caps) reads it, and
            // the fundamental is the honest "how excited is this thread"
            // number — the upper modes are timbre.
            vibAmp: 0,
            vibPhase: 0,
            vibAmp2: 0,
            vibPhase2: 0,
            vibAmp3: 0,
            vibPhase3: 0,
            // Dew charge, 0–1 of a full drop (see the DEW_GLOBAL_RATE
            // constant block) — seeded part-way at random so the graph's
            // first drips stagger instead of landing as one downpour.
            // dewRate is set in the second pass just below, once the
            // final edge count it divides by is known.
            dewCharge: Math.random() * 0.5,
            dewRate: 0,
          });
        }
      }
    }

    // The dew supply's own split (see the DEW_GLOBAL_RATE constant block)
    // — a fixed global humidity divided across however many threads exist,
    // jittered per edge so no two ever fall into lockstep.
    edgeList.forEach((edge) => {
      edge.dewRate = (DEW_GLOBAL_RATE / edgeList.length) * (0.6 + Math.random() * 0.8);
    });

    // Flock kinship (see the FLOCK_NEIGHBOR_RADIUS constant block) — a
    // plain adjacency set built once alongside edgeList, since the graph's
    // own edges don't change shape after mount. O(1) "are these two kin"
    // inside step()'s own O(n²) boid neighbor scan.
    const flockKin = new Map();
    edgeList.forEach((edge) => {
      if (!flockKin.has(edge.a)) flockKin.set(edge.a, new Set());
      if (!flockKin.has(edge.b)) flockKin.set(edge.b, new Set());
      flockKin.get(edge.a).add(edge.b);
      flockKin.get(edge.b).add(edge.a);
    });

    // The skeleton — each cluster's maximum-weight spanning tree: Kruskal
    // with union-find (path-halving find) over the edges sorted by
    // shared-tag count, strongest ties first, alphabetical between ties
    // so the same desk always keeps the same skeleton. Computed once at
    // build since the graph is fixed per mount. Toggled on (see the
    // Skeleton pill in the JSX), every redundant thread recedes and what
    // remains is the strongest set of ties that still reaches every note
    // a cluster has — the minimal honest summary the full web
    // necessarily buries. A reading, not a filter: the physics still
    // runs every edge (attraction doesn't care what's visible), only
    // the ink recedes.
    {
      const parent = new Map();
      noteList.forEach((note) => parent.set(note.id, note.id));
      const find = (start) => {
        let x = start;
        while (parent.get(x) !== x) {
          parent.set(x, parent.get(parent.get(x)));
          x = parent.get(x);
        }
        return x;
      };
      [...edgeList]
        .sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : 1))
        .forEach((edge) => {
          const rootA = find(edge.a);
          const rootB = find(edge.b);
          if (rootA === rootB) {
            edge.mst = false;
            return;
          }
          parent.set(rootA, rootB);
          edge.mst = true;
        });
    }

    // Each node's own rendered radius, in CSS pixels — computed locally
    // from edgeList rather than waiting on the React-level degreeById
    // memo (which lags a render behind at this exact point, since
    // setGraph's own update below hasn't committed yet), and fixed for
    // the lifetime of this mount the same way degree itself is (edges
    // don't change after the graph is built). Needed for collision
    // resolution below, which has to compare real distance against real
    // rendered size, not the FR layout's own abstract k-based spacing.
    const localDegree = new Map();
    edgeList.forEach((edge) => {
      localDegree.set(edge.a, (localDegree.get(edge.a) || 0) + 1);
      localDegree.set(edge.b, (localDegree.get(edge.b) || 0) + 1);
    });
    const maxDegree = Math.max(1, ...Array.from(localDegree.values()));
    byId.forEach((node, id) => {
      node.radiusPx = radiusForDegree(localDegree.get(id) || 0);
      // Depth from structure (see the PARALLAX_GAIN constant block) —
      // hubs float nearest, untagged leaves furthest, mid-plane at 0.
      node.depthFactor = (localDegree.get(id) || 0) / maxDegree - 0.5;
    });

    // The cluster ink pools' own member lists (see the HULL_MIN_MEMBERS
    // constant block) — components are fixed for this mount (edges are),
    // so only positions need recomputing per frame, never membership.
    // Each pool is tinted by its own plurality note color: the honest
    // single-color summary of a cluster that may well mix several.
    const clusterList = findComponents(noteList.map((note) => note.id), edgeList).map((members, i) => {
      const colorVotes = new Map();
      const tagVotes = new Map();
      let maxRadius = 0;
      members.forEach((id) => {
        const note = noteList.find((n) => n.id === id);
        const color = NOTE_COLORS[note?.color] || null;
        if (color) colorVotes.set(color, (colorVotes.get(color) || 0) + 1);
        (note?.tags || []).forEach((tag) => tagVotes.set(tag, (tagVotes.get(tag) || 0) + 1));
        maxRadius = Math.max(maxRadius, byId.get(id).radiusPx);
      });
      let dominant = "var(--page-line-color)";
      let best = 0;
      colorVotes.forEach((count, color) => {
        if (count > best) { best = count; dominant = color; }
      });
      // The pool's region name (see the CLUSTER_LABEL constants) — its
      // plurality tag, alphabetical between ties so the name is stable
      // across rebuilds rather than hostage to Map iteration order.
      let topTag = "";
      let topCount = 0;
      tagVotes.forEach((count, tag) => {
        if (count > topCount || (count === topCount && tag < topTag)) { topCount = count; topTag = tag; }
      });
      return {
        id: `cluster-${ i }`,
        members,
        color: dominant,
        pad: maxRadius + HULL_PADDING,
        label: topTag ? `#${ topTag }` : "",
      };
    });

    // ————— Orrery assignments (see the LAYOUT_MODES block) —————
    // A full component partition this time — findComponents deliberately
    // filters to pool-worthy sizes (3+), but every connected pair is a
    // system in the orrery, and every unconnected note a comet.
    const orbitAdjacency = new Map();
    edgeList.forEach((edge) => {
      if (!orbitAdjacency.has(edge.a)) orbitAdjacency.set(edge.a, []);
      if (!orbitAdjacency.has(edge.b)) orbitAdjacency.set(edge.b, []);
      orbitAdjacency.get(edge.a).push(edge.b);
      orbitAdjacency.get(edge.b).push(edge.a);
    });

    const orbitVisited = new Set();
    const systems = [];
    noteList.forEach((note) => {
      if (!orbitAdjacency.has(note.id) || orbitVisited.has(note.id)) return;
      orbitVisited.add(note.id);
      const members = [note.id];
      for (let head = 0; head < members.length; head++) {
        for (const neighbor of orbitAdjacency.get(members[head]) || []) {
          if (orbitVisited.has(neighbor)) continue;
          orbitVisited.add(neighbor);
          members.push(neighbor);
        }
      }
      systems.push(members);
    });
    // Largest systems first, so the Vogel spiral below seats them nearest
    // the center — the same biggest-gets-the-middle instinct every solar
    // map follows, and it keeps a big system's outer shells from being
    // flung past the domain edge.
    systems.sort((a, b) => b.length - a.length);

    const orbitsForState = [];
    const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
    systems.forEach((members, sysIndex) => {
      // Vogel's model: r ∝ √((i+0.5)/n) at the golden angle — sunflower
      // packing, y foreshortened by the domain's own aspect so the spiral
      // fills the stage's actual shape, not a circle poking past it.
      const anchorR = systems.length === 1 ? 0 : ORRERY_SPREAD * Math.sqrt((sysIndex + 0.5) / systems.length);
      const anchorAngle = sysIndex * GOLDEN_ANGLE;
      const anchorX = cx + Math.cos(anchorAngle) * anchorR;
      const anchorY = cy + Math.sin(anchorAngle) * anchorR * (DOMAIN_H / DOMAIN_W);

      // The primary: highest degree, ties broken by id so the same desk
      // always crowns the same sun.
      let primaryId = members[0];
      members.forEach((id) => {
        const d = localDegree.get(id) || 0;
        const best = localDegree.get(primaryId) || 0;
        if (d > best || (d === best && id < primaryId)) primaryId = id;
      });

      // Hop shells from the primary — the same BFS distance field the
      // signal ping computes, here frozen into orbital radii.
      const hop = new Map([[primaryId, 0]]);
      const queue = [primaryId];
      for (let head = 0; head < queue.length; head++) {
        for (const neighbor of orbitAdjacency.get(queue[head]) || []) {
          if (hop.has(neighbor)) continue;
          hop.set(neighbor, hop.get(queue[head]) + 1);
          queue.push(neighbor);
        }
      }
      const shells = new Map();
      members.forEach((id) => {
        if (id === primaryId) return;
        const h = hop.get(id) || 1;
        if (!shells.has(h)) shells.set(h, []);
        shells.get(h).push(id);
      });

      // One ecliptic per system — every orbit in it shares the plane
      // angle (real systems are roughly coplanar), successive systems
      // rotated apart by the same golden angle so no two read parallel.
      const plane = sysIndex * GOLDEN_ANGLE + (Math.random() - 0.5) * 0.6;
      const planeCos = Math.cos(plane);
      const planeSin = Math.sin(plane);

      byId.get(primaryId).orbit = { isPrimary: true, anchorX, anchorY };

      shells.forEach((ids, h) => {
        const a = ORRERY_BASE_A + (h - 1) * ORRERY_SHELL_GAP;
        // Kepler's third law — see the LAYOUT_MODES block.
        const rate = ORRERY_RATE * Math.pow(ORRERY_BASE_A / a, 1.5);
        ids.forEach((id, j) => {
          const e = ORRERY_ECC_MIN + Math.random() * ORRERY_ECC_SPAN;
          byId.get(id).orbit = {
            isPrimary: false,
            primaryId,
            a,
            e,
            rate,
            // Phases spread evenly around each shell, jittered — a shell
            // sharing one ring shouldn't launch as a queue.
            theta: (j / ids.length) * Math.PI * 2 + Math.random() * 0.4,
            planeCos,
            planeSin,
          };
          orbitsForState.push({
            id,
            a,
            e,
            guideCx: -a * e,
            guideRy: a * Math.sqrt(1 - e * e) * ORRERY_TILT,
            planeDeg: (plane * 180) / Math.PI,
            comet: false,
          });
        });
      });
    });

    // Comets — see the LAYOUT_MODES block. The focus is the domain center
    // (primaryId null), aphelion out past every system, perihelion diving
    // through the middle of the map.
    noteList.filter((note) => !orbitAdjacency.has(note.id)).forEach((note, i) => {
      const a = ORRERY_COMET_A + Math.random() * 8;
      const e = ORRERY_COMET_ECC_MIN + Math.random() * ORRERY_COMET_ECC_SPAN;
      const plane = i * GOLDEN_ANGLE + Math.random() * 0.5;
      byId.get(note.id).orbit = {
        isPrimary: false,
        primaryId: null,
        a,
        e,
        rate: ORRERY_RATE * Math.pow(ORRERY_BASE_A / a, 1.5),
        theta: Math.random() * Math.PI * 2,
        planeCos: Math.cos(plane),
        planeSin: Math.sin(plane),
      };
      orbitsForState.push({
        id: note.id,
        a,
        e,
        guideCx: -a * e,
        guideRy: a * Math.sqrt(1 - e * e) * ORRERY_TILT,
        planeDeg: (plane * 180) / Math.PI,
        comet: true,
      });
    });

    // ————— Strata assignments (see the LAYOUT_MODES block) —————
    // note.time is the app's own "Aug 11, 2026"-style stamp (utils/
    // date.js's formattedDateNow) — parseable, but never assumed valid:
    // anything Date.parse can't read lands in the bedrock layer.
    const monthKeyOf = (time) => {
      const t = Date.parse(time || "");
      if (!Number.isFinite(t)) return null;
      const d = new Date(t);
      return d.getFullYear() * 12 + d.getMonth();
    };

    const monthKeys = new Set();
    let hasUndated = false;
    noteList.forEach((note) => {
      const key = monthKeyOf(note.time);
      if (key === null) hasUndated = true;
      else monthKeys.add(key);
    });
    // Bottom row first: bedrock (undated), then months oldest → newest —
    // deposition order, the honest geology of the desk.
    const strataRows = [
      ...(hasUndated ? [null] : []),
      ...Array.from(monthKeys).sort((a, b) => a - b),
    ];
    const rowIndexByKey = new Map(strataRows.map((key, i) => [key, i]));
    const rowGap = strataRows.length > 1 ? (STRATA_BOTTOM_Y - STRATA_TOP_Y) / (strataRows.length - 1) : 0;
    const strataYForIndex = (i) => (
      strataRows.length === 1 ? DOMAIN_H / 2 : STRATA_BOTTOM_Y - i * rowGap
    );
    noteList.forEach((note) => {
      byId.get(note.id).strataY = strataYForIndex(rowIndexByKey.get(monthKeyOf(note.time)));
    });

    // ————— Spectrum assignments (see the SPECTRUM_COLOR_ORDER constant
    // block) — each note's own target point within its color's wedge,
    // fixed for this mount exactly like strataY above: a stable per-note
    // jitter, not re-rolled per frame, so a note settles at one place in
    // its wedge rather than drifting around inside it forever.
    {
      const sectorWidth = (Math.PI * 2) / SPECTRUM_SECTORS.length;
      noteList.forEach((note) => {
        const sector = SPECTRUM_SECTORS.find((s) => s.key === (note.color || "none")) || SPECTRUM_SECTORS[SPECTRUM_SECTORS.length - 1];
        const node = byId.get(note.id);
        node.spectrumAngle = sector.centerAngle + (Math.random() - 0.5) * sectorWidth * SPECTRUM_SECTOR_FRACTION;
        node.spectrumRadius = SPECTRUM_RADIUS + Math.random() * SPECTRUM_RADIUS_JITTER;
      });
    }

    const strataForState = strataRows.map((key, i) => ({
      key: key === null ? "undated" : String(key),
      label: key === null
        ? "Undated"
        : new Date(Math.floor(key / 12), key % 12, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      y: strataYForIndex(i),
      halfH: strataRows.length > 1 ? Math.min(STRATA_BAND_MAX_HALF, rowGap * 0.42) : STRATA_BAND_MAX_HALF,
    }));

    setGraph({ nodes: noteList, edges: edgeList, clusters: clusterList, orbits: orbitsForState, strata: strataForState });

    const k = FR_CONSTANT * Math.sqrt((DOMAIN_W * DOMAIN_H) / Math.max(1, noteList.length));

    // CSS pixels per domain unit, at the smaller of the two axis scales
    // (matching how render radii elsewhere in this app already avoid
    // non-uniform stretching) — updated once per frame in tick() below
    // rather than every substep; step() always runs against whatever
    // value tick() last computed, one frame stale at worst, which only
    // ever matters in the instant right after a resize.
    let renderScale = 1;

    // The cursor's own current position in domain space, and whether it's
    // actually over the SVG at all right now — see the CURSOR_FIELD_RADIUS
    // module comment for the force itself. Declared here (ahead of
    // domainFromEvent/the pointer handlers further down that actually
    // update it) since step() below reads it, and step() can run
    // synchronously during this same effect's reduced-motion settle pass —
    // a plain `const` declared later would still be in its temporal dead
    // zone at that point.
    const cursorField = { x: 0, y: 0, active: false, prevX: 0, prevY: 0, hasPrev: false };

    // The stirring rod (see the STIR_RADIUS constant block) — position in
    // domain space, velocity eased from the pointer's own rate. Declared
    // up here with cursorField for the same temporal-dead-zone reason:
    // step() reads it.
    const stir = { active: false, x: 0, y: 0, vx: 0, vy: 0, lastT: 0 };

    // Dew in flight (see the DEW_GLOBAL_RATE constant block) — drops that
    // have detached and are falling, each holding a slot in the fixed
    // element pool; slots recycle through the free list on landing.
    const fallingDrops = [];
    const dewFreeSlots = Array.from({ length: DEW_POOL }, (_, i) => i);

    // Live liquid bridges (see the BRIDGE_REACH constant block), keyed by
    // the same order-independent pairKey the traced path already uses —
    // each entry owns a pool slot and remembers its neck's last midpoint,
    // which is where the snap's own splash lands.
    const bridges = new Map();
    const bridgeFreeSlots = Array.from({ length: BRIDGE_POOL }, (_, i) => i);

    // The towed thread (see the TOW_GRAB_PX constant block) — at most one,
    // holding the grabbed edge, the hand's domain position, and the
    // current stretch (read at release for the snap-back pluck's energy).
    // Up here with cursorField/stir for the same reason: step() reads it.
    const tow = { edge: null, x: 0, y: 0, stretch: 0 };

    // Sonar fronts in flight (see the SONAR_SPEED constant block) — each
    // holds a ring-pool slot plus its radius last frame, which is what
    // makes "the front crossed this thread THIS frame" a one-line test.
    const sonars = [];
    const sonarFreeSlots = Array.from({ length: SONAR_POOL }, (_, i) => i);

    // The current streamlines' tracers (see the STREAM_COUNT constant
    // block) — spawned mid-life at random so the field reads as already
    // flowing on arrival rather than blooming from nothing.
    const tracers = Array.from({ length: STREAM_COUNT }, () => ({
      x: Math.random() * DOMAIN_W,
      y: Math.random() * DOMAIN_H,
      life: Math.random() * STREAM_LIFE_MIN,
      maxLife: STREAM_LIFE_MIN + Math.random() * STREAM_LIFE_SPAN,
      trail: [],
    }));

    // Drag state lives here rather than per-node — only one node is ever
    // grabbed at a time, and this needs to track the raw pixel distance
    // (for the click-vs-drag threshold, same convention ClothField.jsx and
    // HistoryConstellation.jsx both already use) separately from the
    // domain-space velocity a release hands back to the node. Declared up
    // here with cursorField/stir/tow rather than down by the handlers,
    // and for the same temporal-dead-zone reason as all three: step()
    // reads it (the grip spring and the family lean), and step() can run
    // synchronously during this effect's own reduced-motion settle pass.
    const drag = { id: null, lastClientX: 0, lastClientY: 0, lastDomainX: 0, lastDomainY: 0, lastT: 0, pixelDistance: 0, vx: 0, vy: 0, targetX: 0, targetY: 0, offsetX: 0, offsetY: 0 };

    // The annealing temperature (see the REHEAT_TEMPERATURE constant
    // block) — 0 means "not annealing", which is every moment except the
    // couple of seconds after a reshuffle, a mode switch, OR right now:
    // every note the pour just spawned (see POUR_POINT_Y) starts crammed
    // within POUR_JITTER of the very same point, which without a cap would
    // hand the very first substep's repulsion an implausible, all-at-once
    // burst of speed. Reusing the exact same mechanism a reshuffle's own
    // "first lurch into a staged migration" already relies on rather than
    // inventing a pour-specific one — step() below both applies it as a
    // speed cap and cools it, so this needs nothing further here.
    let temperature = REHEAT_TEMPERATURE;

    // The ambient current's own clock (see the CURRENT_STRENGTH constant
    // block) — advanced once per frame in tick(), read by step(); the
    // current evolves too slowly for substep resolution to matter.
    let simTime = 0;

    // The desk-wide half of the contact thuds' two cooldowns (see the
    // THUD constants) — per-node lives on each node as lastThud.
    let lastThudTime = -1;

    // The parallax "head position" (see the PARALLAX_GAIN constant block)
    // — tx/ty are the pointer's normalized offset from stage center,
    // x/y the eased value the render actually uses; leaving the stage
    // eases back to dead-on rather than freezing mid-tilt.
    const parallax = { x: 0, y: 0, tx: 0, ty: 0 };

    // The fisheye's engagement, 0–1 (see the FISHEYE constants) — eased
    // toward on/off in tick() so toggling swells rather than snaps.
    const fisheye = { amp: 0 };

    // Idle-drift clock (see the IDLE_DELAY_MS constant block) — every
    // input handler below stamps lastInputTime; driftT only ever advances
    // while the cruise is actually running, so re-entering idle resumes
    // the Lissajous from where it left off rather than jumping phase.
    let lastInputTime = performance.now();
    let driftT = 0;

    // The pendulum labels' shared anchor scratch (see the LABEL_HANG
    // constant block) — one reused pinned point rather than an allocation
    // per label per frame; satisfyConstraint only ever reads it.
    const labelAnchor = { x: 0, y: 0, pinned: true };

    // The liquid ink surface (see the INK_WAKE constants and utils/
    // inkSurface.js's own header) — never even constructed under reduced
    // motion: no WebGL context, no wave stepping, and every splash call
    // below is optional-chained against its absence. The ink color tracks
    // the live theme via the same data-theme attribute
    // HistoryConstellation.jsx's own MutationObserver watches; here a
    // cheap per-frame attribute compare in tick() does the job without a
    // second observer.
    let ink = null;
    let inkTheme = null;
    const resolveInkColor = () =>
      getComputedStyle(document.documentElement).getPropertyValue("--page-ink-color").trim() || "#191919";
    // The resolved ink color as a real CSS value — canvas 2D fillStyle
    // (the long-exposure film's) can't read var() the way SVG can, so
    // the exposure pass reads this instead; refreshed wherever inkTheme
    // itself is.
    let inkCssColor = resolveInkColor();
    if (!reduceMotionRef.current && inkCanvasRef.current) {
      ink = new InkSurface(inkCanvasRef.current, DOMAIN_W, DOMAIN_H);
      inkTheme = document.documentElement.getAttribute("data-theme");
      ink.setInk(inkCssColor);
    }

    // The long-exposure film's own state (see the EXPOSURE constants) —
    // the world-space canvas is created (and wiped) lazily by the tick
    // pass whenever the film turns on or the stage resizes.
    let exposureWorld = null;
    let exposureWctx = null;
    let exposureCtx = null;
    let exposureW = 0;
    let exposureH = 0;
    let exposureFrame = 0;
    let exposureLive = false;
    inkControllerRef.current = {
      splashNote: (id, amount) => {
        const node = byId.get(id);
        if (node) ink?.splash(node.x, node.y, amount);
      },
      // Renders one fresh frame right now rather than waiting for the
      // next tick() — see the portrait's own PORTRAIT_STYLED_SELECTOR
      // constant block for why: the WebGL context is deliberately built
      // WITHOUT preserveDrawingBuffer (keeping the app's own continuous
      // 60fps ink rendering cheap — that flag forces an extra GPU copy
      // EVERY frame, a real cost this file pays nowhere else), which
      // means the browser is free to clear the canvas immediately after
      // any render call, well before a user's own click on the Portrait
      // button gets around to reading it with drawImage. Rendering
      // again, synchronously, in the same moment as that read,
      // sidesteps the problem without paying the preserveDrawingBuffer
      // cost every other frame of every session for one occasional
      // export. No shake offset (see the SHAKE constants) — a portrait
      // shouldn't accidentally freeze mid-tremor from a collision that
      // happened to land right before the click.
      forceRender: () => {
        if (!ink) return;
        const rect = svg.getBoundingClientRect();
        ink.render({
          width: rect.width,
          height: rect.height,
          cameraX: camera.x,
          cameraY: camera.y,
          zoom: camera.zoom,
          scaleX: rect.width / DOMAIN_W,
          scaleY: rect.height / DOMAIN_H,
          time: simTime,
        });
      },
    };

    // One substep — repulsion (see the file header for the Barnes-Hut
    // reasoning) and edge-pairs-only attraction, then a weak center pull
    // and damped-velocity integration.
    const step = (dt) => {
      byId.forEach((node) => { node.fx = 0; node.fy = 0; });

      // Which law this substep solves under (see the LAYOUT_MODES block)
      // — read once at the top so a mode flip mid-frame can't split a
      // single integration between two laws.
      const layoutMode = modeRef.current;

      // Repulsion serves most of the laws: the web takes it in full, the
      // strata keep only its x-component (the shelf springs own y there,
      // and vertical repulsion would just fight them). The orrery skips it
      // entirely — the Kepler springs place everything, the collision pass
      // below still guarantees separation. Flock skips it too, but for a
      // different reason: its own separation rule (see the
      // FLOCK_NEIGHBOR_RADIUS constant block) already does this job,
      // short-range and neighbor-limited rather than all-domain — running
      // both would just be two repulsions fighting over the same job.
      // Skipping here also skips paying for the tree build at all.
      if (layoutMode !== "orrery" && layoutMode !== "flock") {
        // A fresh quadtree every substep, since every node's position
        // moved last substep — sized to the graph's own current extent
        // (padded a little) rather than the fixed DOMAIN_W×DOMAIN_H,
        // since a flung or dragged node can briefly sit outside that
        // nominal domain and the tree's own root box needs to actually
        // contain every point.
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        byId.forEach((node) => {
          if (node.x < minX) minX = node.x;
          if (node.x > maxX) maxX = node.x;
          if (node.y < minY) minY = node.y;
          if (node.y > maxY) maxY = node.y;
        });
        const pad = 5;
        const extent = Math.max(maxX - minX, maxY - minY, 1) + pad * 2;
        const treeOriginX = (minX + maxX) / 2 - extent / 2;
        const treeOriginY = (minY + maxY) / 2 - extent / 2;

        const tree = new Quadtree(treeOriginX, treeOriginY, extent);
        const points = [];
        byId.forEach((node) => {
          const point = { x: node.x, y: node.y };
          points.push({ point, node });
          tree.insert(point);
        });
        tree.finalize();

        // The exact same fr(d) = k²/d formula the old all-pairs loop used —
        // dx/dy point from the query toward the other mass (Quadtree's own
        // convention), so the force itself is negated to point away, which
        // is what makes this repulsive.
        const repel = (dx, dy, dist, weight) => {
          const d = Math.max(MIN_DIST, dist);
          const magnitude = (k * k * weight) / d;
          return { fx: -(dx / d) * magnitude, fy: -(dy / d) * magnitude };
        };

        for (const { point, node } of points) {
          const { fx, fy } = tree.accumulateForce(point.x, point.y, point, BARNES_HUT_THETA, repel);
          node.fx += fx;
          // Full 2D repulsion — web needs it to fill the whole domain,
          // spectrum needs it to fill its own wedge (see the
          // SPECTRUM_COLOR_ORDER constant block); strata keeps x only
          // (its own shelf spring owns y), orrery skips this block
          // entirely (see the outer guard above).
          if (layoutMode === "web" || layoutMode === "spectrum") node.fy += fy;
        }
      }

      // Attraction is the web's own statement — "sharing tags pulls you
      // together" — and stays out of the other two laws on purpose: the
      // orrery already encodes relation as orbit structure, and time
      // shelves would buckle under it.
      if (layoutMode === "web") {
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
      }

      // Flock is boids' own statement (see the FLOCK_NEIGHBOR_RADIUS
      // constant block) — one O(n²) neighbor scan standing in for the
      // quadtree repulsion this law skipped above, since separation,
      // alignment, and cohesion all need each candidate's live velocity,
      // not just its position, and only ever apply inside a hard radius.
      // i visits every j (not just j > i) — a boid's own three rules are
      // fundamentally one-directional per pair (what I feel from you isn't
      // what you feel from me, since MY neighborhood average isn't
      // necessarily yours), unlike repulsion/attraction above, which are
      // reciprocal by the physics itself and so get to halve their own
      // work; boids don't share that symmetry to exploit.
      if (layoutMode === "flock") {
        const flockNodes = Array.from(byId, ([id, node]) => ({ id, node }));
        const neighborRadiusSq = FLOCK_NEIGHBOR_RADIUS * FLOCK_NEIGHBOR_RADIUS;
        for (let i = 0; i < flockNodes.length; i++) {
          const a = flockNodes[i].node;
          const aKin = flockKin.get(flockNodes[i].id);
          let sumVx = 0, sumVy = 0, sumX = 0, sumY = 0, weight = 0;
          for (let j = 0; j < flockNodes.length; j++) {
            if (i === j) continue;
            const bEntry = flockNodes[j];
            const b = bEntry.node;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const distSq = dx * dx + dy * dy;
            if (distSq > neighborRadiusSq) continue;
            const dist = Math.max(MIN_DIST, Math.sqrt(distSq));

            // Separation — short-range and immediate, applied straight
            // into a.fx/fy rather than folded into the averages below.
            if (dist < FLOCK_SEPARATION_RADIUS) {
              const push = (FLOCK_SEPARATION_RADIUS - dist) * FLOCK_SEPARATION_GAIN;
              a.fx -= (dx / dist) * push;
              a.fy -= (dy / dist) * push;
            }

            // Alignment + cohesion's shared averaging pass — a tag-sharing
            // neighbor (see the flockKin constant block) counts for
            // FLOCK_KIN_BONUS instead of 1, so kin pull the average
            // harder without ever excluding the rest of the neighborhood.
            const kinWeight = aKin && aKin.has(bEntry.id) ? FLOCK_KIN_BONUS : 1;
            sumVx += b.vx * kinWeight;
            sumVy += b.vy * kinWeight;
            sumX += b.x * kinWeight;
            sumY += b.y * kinWeight;
            weight += kinWeight;
          }

          if (weight > 0) {
            // Steering-force shape, not a velocity clamp — (target -
            // current) fed through F = ma downstream like every other
            // force here, so a heavier note still turns more sluggishly
            // (see GRIP_K's own comment for why that felt inertia matters
            // to this file), rather than every mass snapping its heading
            // equally fast.
            a.fx += (sumVx / weight - a.vx) * FLOCK_ALIGN_GAIN;
            a.fy += (sumVy / weight - a.vy) * FLOCK_ALIGN_GAIN;
            a.fx += (sumX / weight - a.x) * FLOCK_COHESION_GAIN;
            a.fy += (sumY / weight - a.y) * FLOCK_COHESION_GAIN;
          }
        }
      }

      // The towed thread's tension (see the TOW_GRAB_PX constant block) —
      // a rope routed through a held midpoint loads each end along its
      // own line to the hand, and only once the two halves together
      // exceed the rope's rest length: slack tows nothing, which is why
      // gently lifting a thread just drapes it over the cursor while
      // hauling on it drags both notes in. Mode-blind on purpose — towing
      // an orrery thread genuinely fights the orbit springs for its
      // anchors, and wins exactly as much as the stretch says it should.
      if (tow.edge) {
        const a = byId.get(tow.edge.a);
        const b = byId.get(tow.edge.b);
        const da = Math.max(0.001, Math.hypot(a.x - tow.x, a.y - tow.y));
        const db = Math.max(0.001, Math.hypot(b.x - tow.x, b.y - tow.y));
        const rest = k * EDGE_REST_LENGTH_FACTOR * TOW_SLACK_FACTOR;
        tow.stretch = Math.max(0, da + db - rest);
        if (tow.stretch > 0) {
          const pull = tow.stretch * TOW_K;
          a.fx += ((tow.x - a.x) / da) * pull;
          a.fy += ((tow.y - a.y) / da) * pull;
          b.fx += ((tow.x - b.x) / db) * pull;
          b.fy += ((tow.y - b.y) / db) * pull;
        }
      }

      // The family lean (see the LEAN_K constant block) — every note
      // sharing an edge with the held one reaches weakly toward the held
      // note's own live position. Edge-scan rather than an adjacency
      // lookup on purpose: it's one held note per gesture, and the scan
      // is the same O(e) the attraction loop above already pays.
      if (drag.id && !reduceMotionRef.current) {
        const held = byId.get(drag.id);
        if (held) {
          for (const edge of edgeList) {
            if (edge.a !== drag.id && edge.b !== drag.id) continue;
            const other = byId.get(edge.a === drag.id ? edge.b : edge.a);
            if (other.dragging || other.pinned) continue;
            const dx = held.x - other.x;
            const dy = held.y - other.y;
            const dist = Math.hypot(dx, dy);
            if (dist < 0.001) continue;
            const pull = Math.min(LEAN_MAX, dist * LEAN_K);
            other.fx += (dx / dist) * pull;
            other.fy += (dy / dist) * pull;
          }
        }
      }

      // Path tension (see the PATH_TENSION_GAIN constant block) — every
      // interior member of a traced path leans toward its own foot on
      // the straight line between the two anchors' live positions. Own
      // short loop over the path array rather than folded into the main
      // per-node forEach below, so notes that aren't on the path (almost
      // always most of them) pay nothing for this at all. No reduced-
      // motion gate: unlike the family lean just above (whose own gate
      // exists because a mere press sets drag.id before a gesture is
      // known to be a completed drag), a traced path only ever exists
      // after two FULLY completed shift-clicks — there's no in-progress
      // ambiguity to guard against — and step() itself only ever runs
      // continuously when motion isn't reduced; under reduced motion
      // this can only run inside a one-shot settle pass that converges
      // before anything paints, so there is no swaying to prevent, only
      // a final position to get right. Gating it anyway would just mean
      // a reduced-motion visitor who traces a path and then reshuffles
      // or switches modes gets a different, non-tensioned convergence
      // than a full-motion visitor doing the same thing — the same
      // "settle to a physically-informed final picture" contract strata,
      // orrery, and spectrum's own center-pull branches already keep
      // with no gate of their own.
      const tensionPath = shortestPathRef.current;
      if (tensionPath && tensionPath.length > 2) {
        const start = byId.get(tensionPath[0]);
        const end = byId.get(tensionPath[tensionPath.length - 1]);
        const segX = end.x - start.x;
        const segY = end.y - start.y;
        const segLenSq = segX * segX + segY * segY;
        if (segLenSq > 0.0001) {
          for (let i = 1; i < tensionPath.length - 1; i++) {
            const member = byId.get(tensionPath[i]);
            if (!member || member.dragging || member.pinned) continue;
            const t = Math.max(0, Math.min(1, ((member.x - start.x) * segX + (member.y - start.y) * segY) / segLenSq));
            const footX = start.x + segX * t;
            const footY = start.y + segY * t;
            const pullX = (footX - member.x) * PATH_TENSION_GAIN;
            const pullY = (footY - member.y) * PATH_TENSION_GAIN;
            const pullMag = Math.hypot(pullX, pullY);
            if (pullMag > PATH_TENSION_MAX) {
              member.fx += (pullX / pullMag) * PATH_TENSION_MAX;
              member.fy += (pullY / pullMag) * PATH_TENSION_MAX;
            } else {
              member.fx += pullX;
              member.fy += pullY;
            }
          }
        }
      }

      // Bounded per-substep movement while annealing (see the
      // REHEAT_TEMPERATURE constant block) — the paper's own displacement
      // cap, expressed as a speed limit since this integration is
      // velocity-based; once cooled below the running clamp it's just the
      // ordinary VELOCITY_CLAMP again.
      const speedCap = temperature > 0 ? Math.min(VELOCITY_CLAMP, temperature) : VELOCITY_CLAMP;

      byId.forEach((node) => {
        // The weighted grip (see the GRIP_K constant block) — a held note
        // integrates under the hand's spring ALONE: the layout forces
        // accumulated above still pushed its neighbors around through it,
        // but the hand replaces them for the note itself, and the spring
        // runs through a = F/m like everything else — which is the whole
        // point: mass, felt. Checked before pinned, so dragging a pinned
        // note still relocates its anchor exactly as it always has.
        if (node.dragging) {
          node.fx = (drag.targetX - node.x) * GRIP_K;
          node.fy = (drag.targetY - node.y) * GRIP_K;
          node.vx = (node.vx + (node.fx / node.mass) * dt) * GRIP_DAMPING;
          node.vy = (node.vy + (node.fy / node.mass) * dt) * GRIP_DAMPING;
          node.x += node.vx * dt;
          node.y += node.vy * dt;
          return;
        }

        // A pinned node is a fixed boundary condition — forces were still
        // accumulated against it above (its neighbors need to feel it),
        // it just never integrates them. A tossed node (see the
        // TOSS_GRAVITY constant block) is the same story for a different
        // reason: matter-js owns its position for the toss's own brief
        // window, and tick() reads that back directly — the accumulated
        // fx/fy above is simply discarded for it, same as a pinned
        // node's own.
        if (node.pinned || node.tossed) return;

        // Center pull, per law: the web needs it whole (its drifters have
        // nothing else holding them), the strata only along the axis
        // their shelves leave free, the orrery not at all — every one of
        // its nodes already answers to an anchor, a focus, or the domain
        // center itself.
        if (layoutMode === "web") {
          node.fx -= (node.x - cx) * CENTER_STRENGTH;
          node.fy -= (node.y - cy) * CENTER_STRENGTH;
        } else if (layoutMode === "spectrum") {
          // The spectrum law (see the SPECTRUM_COLOR_ORDER constant
          // block) — an ordinary spring toward the note's own fixed
          // target point in its color's wedge, exactly the strata shelf
          // spring's own shape, just aimed at a polar point instead of a
          // horizontal shelf.
          const targetX = cx + Math.cos(node.spectrumAngle) * node.spectrumRadius;
          const targetY = cy + Math.sin(node.spectrumAngle) * node.spectrumRadius * (DOMAIN_H / DOMAIN_W);
          node.fx += (targetX - node.x) * SPECTRUM_SPRING;
          node.fy += (targetY - node.y) * SPECTRUM_SPRING;
        } else if (layoutMode === "strata") {
          node.fx -= (node.x - cx) * STRATA_CENTER_X;
          // The shelf spring — the strata law itself (see the
          // LAYOUT_MODES block): y answers to the note's own creation
          // month, x to nothing but repulsion and the weak centering
          // above.
          node.fy += (node.strataY - node.y) * STRATA_SPRING;
        } else if (layoutMode === "orrery" && node.orbit) {
          // The mode check is load-bearing now that a 4th law exists:
          // node.orbit is assigned unconditionally at build time (every
          // note is either a system member or a comet — see the
          // LAYOUT_MODES block), so with only the truthy check this
          // branch would silently also catch spectrum-mode notes that
          // happen to carry tag edges, stranding them on stale orrery
          // targets instead of their own spectrum wedge. web/strata
          // above are real mode checks already; this one only looked
          // like an exception because orrery used to be the sole
          // remaining possibility once those two were ruled out.
          // The orrery law (see the LAYOUT_MODES block). Primaries hold
          // their Vogel anchor; everything else chases a live Kepler
          // target — polar conic for position, equal-area law for the
          // angle's own advance — computed around wherever its focus
          // ACTUALLY is right now, not its ideal: drag a primary and its
          // whole system follows, which is the orrery being a real
          // instrument rather than a picture of one. Comets share the
          // exact same math with the domain center as focus. The spring
          // (rather than teleporting nodes onto their conics) is what
          // lets every other influence — collision, cursor, current,
          // stir, plucks — genuinely perturb an orbit and be corrected,
          // and it feeds a = F/m like everything else, so heavy notes
          // trail their own orbits the way heavy things do.
          const o = node.orbit;
          if (o.isPrimary) {
            node.fx += (o.anchorX - node.x) * ORRERY_PRIMARY_SPRING;
            node.fy += (o.anchorY - node.y) * ORRERY_PRIMARY_SPRING;
          } else {
            const focus = o.primaryId ? byId.get(o.primaryId) : null;
            const focusX = focus ? focus.x : cx;
            const focusY = focus ? focus.y : cy;
            const rOrbit = (o.a * (1 - o.e * o.e)) / (1 + o.e * Math.cos(o.theta));
            // r²·θ̇ = const, normalized so θ̇ = rate exactly at r = a —
            // the same equal-area advance the favorite moons already run.
            o.theta += o.rate * (o.a / rOrbit) * (o.a / rOrbit) * dt;
            const localX = Math.cos(o.theta) * rOrbit;
            const localY = Math.sin(o.theta) * rOrbit * ORRERY_TILT;
            const targetX = focusX + localX * o.planeCos - localY * o.planeSin;
            const targetY = focusY + localX * o.planeSin + localY * o.planeCos;
            node.fx += (targetX - node.x) * ORRERY_SPRING;
            node.fy += (targetY - node.y) * ORRERY_SPRING;
          }
        } else if (layoutMode === "flock") {
          // Edge-avoid — boids' classic "steer off the wall" rule: a soft
          // inward push that only ever engages past FLOCK_EDGE_MARGIN, so
          // it never competes with the interior flocking itself, just
          // keeps the school from ever actually reaching the domain edge.
          if (node.x < FLOCK_EDGE_MARGIN) node.fx += (FLOCK_EDGE_MARGIN - node.x) * FLOCK_EDGE_GAIN;
          else if (node.x > DOMAIN_W - FLOCK_EDGE_MARGIN) node.fx -= (node.x - (DOMAIN_W - FLOCK_EDGE_MARGIN)) * FLOCK_EDGE_GAIN;
          if (node.y < FLOCK_EDGE_MARGIN) node.fy += (FLOCK_EDGE_MARGIN - node.y) * FLOCK_EDGE_GAIN;
          else if (node.y > DOMAIN_H - FLOCK_EDGE_MARGIN) node.fy -= (node.y - (DOMAIN_H - FLOCK_EDGE_MARGIN)) * FLOCK_EDGE_GAIN;

          // The cruising floor (see FLOCK_SPEED_MIN) — thrust along the
          // CURRENT heading once the boid actually has one, else its own
          // stable spawn heading (flockHeading), so a boid fresh off zero
          // velocity still has some direction to push in.
          const speed = Math.hypot(node.vx, node.vy);
          if (speed < FLOCK_SPEED_MIN) {
            const hx = speed > 0.01 ? node.vx / speed : Math.cos(node.flockHeading);
            const hy = speed > 0.01 ? node.vy / speed : Math.sin(node.flockHeading);
            const thrust = (FLOCK_SPEED_MIN - speed) * FLOCK_THRUST_GAIN;
            node.fx += hx * thrust;
            node.fy += hy * thrust;
          }
        }

        // Disabled under reduced motion — same reasoning as everything
        // else in this file that moves nodes on its own without a
        // deliberate discrete action behind it: mere cursor presence
        // shouldn't set the graph swaying.
        if (cursorField.active && !reduceMotionRef.current) {
          const cdx = cursorField.x - node.x;
          const cdy = cursorField.y - node.y;
          const cdist = Math.hypot(cdx, cdy);
          if (cdist > 0.0001 && cdist < CURSOR_FIELD_RADIUS) {
            const t = 1 - cdist / CURSOR_FIELD_RADIUS;
            const smooth = t * t * (3 - 2 * t); // smoothstep
            const force = smooth * CURSOR_FIELD_STRENGTH;
            node.fx += (cdx / cdist) * force;
            node.fy += (cdy / cdist) * force;
          }
        }

        // The ambient current (see the CURRENT_STRENGTH constant block) —
        // gated with the cursor field above for the same reason: ambient,
        // autonomous motion is exactly what reduced motion opts out of.
        if (!reduceMotionRef.current) {
          const flow = curlNoise2(node.x / CURRENT_SCALE, node.y / CURRENT_SCALE, simTime * CURRENT_TIME_SCALE);
          node.fx += flow.x * CURRENT_STRENGTH;
          node.fy += flow.y * CURRENT_STRENGTH;
        }

        // The pool pushing back (see the BUOYANCY_GAIN constant block) —
        // the note surfs downhill off whatever slope the wave field
        // holds under it right now. `ink` is null under reduced motion
        // (the surface is never built there), which is this force's own
        // gate.
        if (ink) {
          const grad = ink.gradientAt(node.x, node.y);
          let buoyX = -grad.x * BUOYANCY_GAIN;
          let buoyY = -grad.y * BUOYANCY_GAIN;
          const buoyMag = Math.hypot(buoyX, buoyY);
          if (buoyMag > BUOYANCY_MAX) {
            buoyX = (buoyX / buoyMag) * BUOYANCY_MAX;
            buoyY = (buoyY / buoyMag) * BUOYANCY_MAX;
          }
          node.fx += buoyX;
          node.fy += buoyY;
        }

        // The stirring rod (see the STIR_RADIUS constant block) — the
        // paddle drags nearby fluid along its own motion: force in the
        // rod's velocity direction, smoothstep falloff like the cursor
        // field's, felt through 1/mass like everything else. Keyed off
        // the paddle's own remaining speed rather than stir.active, so
        // the eddy a vigorous final swirl leaves keeps pushing through
        // its short decay after the button releases (tick() owns that
        // decay, and snaps it to a clean zero once spent). Speed only
        // ever becomes nonzero outside reduced motion (see handleDown),
        // so no second gate is needed here.
        if (stir.vx !== 0 || stir.vy !== 0) {
          const sdx = node.x - stir.x;
          const sdy = node.y - stir.y;
          const sdist = Math.hypot(sdx, sdy);
          if (sdist < STIR_RADIUS) {
            const t = 1 - sdist / STIR_RADIUS;
            const smooth = t * t * (3 - 2 * t); // smoothstep
            node.fx += stir.vx * smooth * STIR_GAIN;
            node.fy += stir.vy * smooth * STIR_GAIN;

            // The rod's own torque (see the STIR_SPIN_GAIN constant
            // block) — the tangential component of its velocity around
            // THIS note, not its raw direction of travel. sdist floored
            // rather than trusted bare: unlike the translational force
            // just above (which only ever divides sdist BY the constant
            // STIR_RADIUS), this divides BY sdist itself, and the rod
            // sitting exactly on a note's own position — vanishingly
            // unlikely, not impossible — would otherwise hand omega a
            // NaN that never heals, the same floor every other distance
            // division in this file already keeps for exactly this
            // reason (see MIN_DIST's own module comment).
            const tangentialSpeed = (stir.vx * -sdy + stir.vy * sdx) / Math.max(0.001, sdist);
            node.omega += (tangentialSpeed * STIR_SPIN_GAIN * smooth) / node.mass;
          }
        }

        // a = F/m — see the MASS_MAX_BONUS constant block. The one line
        // where mass actually enters the dynamics.
        node.vx = (node.vx + (node.fx / node.mass) * dt) * DAMPING;
        node.vy = (node.vy + (node.fy / node.mass) * dt) * DAMPING;

        const speed = Math.hypot(node.vx, node.vy);
        if (speed > speedCap) {
          node.vx = (node.vx / speed) * speedCap;
          node.vy = (node.vy / speed) * speedCap;
        }

        node.x += node.vx * dt;
        node.y += node.vy * dt;
      });

      // Geometric cooling, once per substep — when the temperature drops
      // below mattering it snaps to a clean 0 rather than decaying
      // imperceptibly forever, the same shutoff discipline
      // PAN_MOMENTUM_STOP already applies to the camera.
      if (temperature > 0) {
        temperature *= REHEAT_COOLING;
        if (temperature < REHEAT_MIN_TEMPERATURE) temperature = 0;
      }

      // A position correction, not a force — see COLLISION_ITERATIONS's
      // own module comment. Runs after the FR forces above have already
      // moved everything for this substep, so it's always correcting
      // against genuinely current positions.
      const ids = Array.from(byId.keys());
      for (let iter = 0; iter < COLLISION_ITERATIONS; iter++) {
        for (let i = 0; i < ids.length; i++) {
          const a = byId.get(ids[i]);
          for (let j = i + 1; j < ids.length; j++) {
            const b = byId.get(ids[j]);

            const minDist = (a.radiusPx + b.radiusPx) / renderScale + COLLISION_PADDING;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.hypot(dx, dy) || 0.0001;
            if (dist >= minDist) continue;

            // Split by how movable each end actually is — the exact same
            // weighting utils/verlet.js's own satisfyConstraint uses, so a
            // dragged (or pinned) node still pushes everything it overlaps
            // without ever being pushed back itself.
            const aFree = (a.dragging || a.pinned) ? 0 : 1;
            const bFree = (b.dragging || b.pinned) ? 0 : 1;
            const total = aFree + bFree;
            if (total === 0) continue;

            const overlap = minDist - dist;
            const nx = dx / dist, ny = dy / dist;
            a.x -= nx * overlap * (aFree / total);
            a.y -= ny * overlap * (aFree / total);
            b.x += nx * overlap * (bFree / total);
            b.y += ny * overlap * (bFree / total);

            // Each side's share of the resolved overlap doubles as its
            // impact energy — collected here, converted into the jelly
            // wobble by tick() (see the WOBBLE_OMEGA constants), so a
            // node that got shoved visibly rings while one that did the
            // shoving from behind a pin or a pointer doesn't.
            a.impact += overlap * (aFree / total);
            b.impact += overlap * (bFree / total);

            // Contact friction's spin kick (see the SPIN constants) and
            // bounce's own velocity impulse (see the BOUNCE_RESTITUTION
            // constant block) share one gate — both write into node
            // velocity/omega rather than position, and both carry the
            // exact same banked-state risk under a reduced-motion settle
            // pass (see either constant block's own comment for the
            // full reasoning).
            if (!reduceMotionRef.current) {
              const slipX = -ny;
              const slipY = nx;
              const slip = (b.vx - a.vx) * slipX + (b.vy - a.vy) * slipY;
              a.omega += (slip * SPIN_CONTACT_GAIN) / a.mass;
              b.omega += (slip * SPIN_CONTACT_GAIN) / b.mass;

              const invMassA = aFree / a.mass;
              const invMassB = bFree / b.mass;
              const invMassSum = invMassA + invMassB;
              const closingSpeed = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
              if (invMassSum > 0 && closingSpeed < -BOUNCE_MIN_CLOSING_SPEED) {
                const j = (-(1 + BOUNCE_RESTITUTION) * closingSpeed) / invMassSum;
                a.vx -= j * nx * invMassA;
                a.vy -= j * ny * invMassA;
                b.vx += j * nx * invMassB;
                b.vy += j * ny * invMassB;
              }
            }
          }
        }
      }
    };

    if (reduceMotionRef.current) {
      for (let i = 0; i < SETTLE_ITERATIONS; i++) step(SETTLE_DT);
    } else {
      // The pour's own first impression — the same center detonation a
      // reshuffle or mode switch already announces itself with, struck at
      // POUR_POINT_Y rather than the domain center since that's genuinely
      // where the ink is landing from.
      ink?.splash(cx, POUR_POINT_Y, INK_POUR_SPLASH);

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

    // The camera itself — see the MIN_ZOOM/MAX_ZOOM module comment for the
    // full reasoning. x/y/zoom/rot are what actually gets written to
    // worldGroupRef's own transform every frame; vx/vy are the pan's own
    // momentum, decayed in tick() below once a pan drag releases; vrot is
    // the rotate spring's own working velocity (see ROTATE_SPRING_STIFFNESS).
    const camera = { x: 0, y: 0, zoom: 1, rot: 0, vx: 0, vy: 0, vrot: 0 };

    // Rotates a world-pixel point by `angle` around the viewport's own
    // center (see the ROTATE_SPRING_STIFFNESS constant block for why that
    // point, not the domain origin, is the pivot every rotation uses).
    const rotateAroundPivot = (wx, wy, rect, angle) => {
      if (!angle) return { x: wx, y: wy };
      const px = rect.width / 2;
      const py = rect.height / 2;
      const dx = wx - px;
      const dy = wy - py;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return { x: px + dx * cos - dy * sin, y: py + dx * sin + dy * cos };
    };

    // Screen pixels within the SVG's own box → domain space, inverting the
    // camera's own translate+scale+rotate first (see the MIN_ZOOM/MAX_ZOOM
    // comment above and ROTATE_SPRING_STIFFNESS below) — without that
    // inversion, dragging a node while panned, zoomed, or (briefly, mid
    // two-finger twist) rotated would grab the wrong point entirely, since
    // a given screen position no longer corresponds to the same domain
    // coordinate once the camera has moved away from its default identity
    // transform.
    const worldPixelFromLocal = (localX, localY, rect) => {
      const ux = (localX - camera.x) / camera.zoom;
      const uy = (localY - camera.y) / camera.zoom;
      return rotateAroundPivot(ux, uy, rect, -camera.rot);
    };

    const domainFromEvent = (e) => {
      const rect = svg.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      const { x: worldPixelX, y: worldPixelY } = worldPixelFromLocal(localX, localY, rect);
      return {
        x: (worldPixelX / rect.width) * DOMAIN_W,
        y: (worldPixelY / rect.height) * DOMAIN_H,
      };
    };

    // Where a domain-space event currently sits in the stereo field (see
    // the STEREO_WIDTH constant block) — the same domain → world → camera
    // mapping every screen-space element already does, reduced to the one
    // axis ears care about. panRectW is stamped by tick() each frame;
    // until the first frame it stays 0 and everything voices centered.
    let panRectW = 0;
    const stereoPanAt = (domainX) => {
      if (!panRectW) return 0;
      const screenX = camera.x + domainX * (panRectW / DOMAIN_W) * camera.zoom;
      return Math.max(-1, Math.min(1, (screenX / panRectW) * 2 - 1)) * STEREO_WIDTH;
    };

    // The focus swimmer's own body (see the FOCUS_SPRING constant block)
    // — position, velocity, and its ring's eased visibility.
    const swimmer = { x: 0, y: 0, vx: 0, vy: 0, opacity: 0 };

    // The aim line's eased visibility (see the AIM_STEPS constant block).
    let aimAmp = 0;

    // The impact shake's remaining amplitude (see the SHAKE constants).
    const shake = { amp: 0 };
    // True only while handleDblClick's own GSAP reset tween is actively
    // driving camera.x/y/zoom directly — the momentum/boundary-spring
    // block in tick() below has to stand down for that whole window, or
    // both would be fighting over the same properties every frame.
    let cameraAnimating = false;

    // Clicking the minimap (see the JSX below, which converts the click
    // into a plain domain-space point before calling this) tweens the
    // camera so that point becomes centered in the main view, at whatever
    // zoom is already current — a "jump to here," not a zoom reset. Same
    // kill-any-in-flight-tween-first discipline handleWheel/handleDown's
    // own pan branch already follow, so a jump started mid-reset (or a
    // second jump before the first finishes) doesn't fight a leftover tween.
    minimapControllerRef.current = {
      // `immediate` is the scrub path (see the minimap's own pointer
      // handlers): while actively dragging across the minimap the camera
      // tracks 1:1 — direct manipulation shouldn't lag behind a tween —
      // where a single click keeps the glide it always had.
      jumpTo: (domainX, domainY, immediate = false) => {
        const rect = svg.getBoundingClientRect();
        const worldX = domainX * (rect.width / DOMAIN_W);
        const worldY = domainY * (rect.height / DOMAIN_H);
        const targetX = rect.width / 2 - worldX * camera.zoom;
        const targetY = rect.height / 2 - worldY * camera.zoom;

        gsap.killTweensOf(camera);
        camera.vx = 0;
        camera.vy = 0;
        // targetX/Y above are plain unrotated centering math (mirroring the
        // boundary spring's own "ideal position" formula) — honest only at
        // rot 0, so a jump snaps level immediately rather than landing the
        // graph centered but still visibly tilted.
        camera.rot = 0;
        camera.vrot = 0;

        if (immediate || reduceMotionRef.current) {
          cameraAnimating = false;
          camera.x = targetX;
          camera.y = targetY;
          return;
        }
        cameraAnimating = true;
        gsap.to(camera, {
          x: targetX,
          y: targetY,
          duration: MINIMAP_JUMP_DURATION,
          ease: "power3.out",
          overwrite: "auto",
          onComplete: () => { cameraAnimating = false; },
        });
      },
    };

    // The reshuffle action (see the REHEAT_TEMPERATURE constant block) —
    // same controller-ref bridge morphControllerRef and
    // minimapControllerRef already use to let plain JSX handlers reach
    // into this effect's own closure state.
    reheatControllerRef.current = {
      reheat: () => {
        if (reduceMotionRef.current) {
          // A new layout with no animation: re-scatter every free node the
          // same way the initial spawn did, then re-run the exact same
          // synchronous settle pass reduced motion already boots through.
          byId.forEach((node) => {
            if (node.pinned || node.dragging) return;
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * Math.min(DOMAIN_W, DOMAIN_H) * 0.35;
            node.x = cx + Math.cos(angle) * radius;
            node.y = cy + Math.sin(angle) * radius;
            node.vx = 0;
            node.vy = 0;
          });
          for (let i = 0; i < SETTLE_ITERATIONS; i++) step(SETTLE_DT);
          return;
        }

        temperature = REHEAT_TEMPERATURE;
        // The pool registers the detonation — one hard center splash whose
        // expanding ring IS the annealing shockwave, propagating at the
        // wave equation's own speed while the kicked nodes scatter.
        ink?.splash(cx, cy, INK_RESHUFFLE_SPLASH);
        byId.forEach((node) => {
          if (node.pinned || node.dragging) return;
          const angle = Math.random() * Math.PI * 2;
          // The kick fights inertia like every other impulse here — a
          // heavy note shrugs off more of the same detonation.
          const kick = (REHEAT_KICK * (0.5 + Math.random() * 0.5)) / node.mass;
          node.vx += Math.cos(angle) * kick;
          node.vy += Math.sin(angle) * kick;
        });
      },
    };

    // The toss (see the TOSS_GRAVITY constant block) — a fresh matter-js
    // world built right here, seeded from the graph's own CURRENT
    // world-pixel positions and radii, thrown, and torn back down once
    // it settles. Reduced motion and an already-running toss both no-op
    // (the button itself is hidden under reduced motion — this is the
    // second, defensive gate the same way most controller actions in
    // this file carry one).
    tossControllerRef.current = {
      toss: () => {
        if (reduceMotionRef.current || toss.active) return;

        const rect = svg.getBoundingClientRect();
        // rect.width/height ARE DOMAIN_W/DOMAIN_H's own world-pixel
        // extent by construction (scaleX·DOMAIN_W = rect.width always),
        // so they're also exactly the bounds the toss should bounce
        // within — the full logical desk, not whatever the camera
        // currently happens to be panned/zoomed to show.
        const scaleX = rect.width / DOMAIN_W;
        const scaleY = rect.height / DOMAIN_H;

        const engine = Matter.Engine.create({ gravity: { x: 0, y: TOSS_GRAVITY } });

        const t = TOSS_WALL_THICKNESS;
        const floor = Matter.Bodies.rectangle(rect.width / 2, rect.height + t / 2, rect.width + t * 2, t, { isStatic: true, restitution: TOSS_RESTITUTION });
        const left = Matter.Bodies.rectangle(-t / 2, rect.height / 2, t, rect.height * 3, { isStatic: true, restitution: TOSS_RESTITUTION });
        const right = Matter.Bodies.rectangle(rect.width + t / 2, rect.height / 2, t, rect.height * 3, { isStatic: true, restitution: TOSS_RESTITUTION });
        // Deliberately no ceiling — a real toss leaves the hand and can
        // arc higher than the eye follows before gravity brings it back;
        // TOSS_DURATION's own ceiling is what actually bounds how long
        // that's allowed to take.
        Matter.World.add(engine.world, [floor, left, right]);

        byId.forEach((node, id) => {
          if (node.pinned || node.dragging) return;
          const body = Matter.Bodies.circle(node.x * scaleX, node.y * scaleY, node.radiusPx, {
            restitution: TOSS_RESTITUTION,
            friction: TOSS_FRICTION,
            frictionAir: TOSS_FRICTION_AIR,
          });
          // node.mass (content length, deliberately decoupled from the
          // radius that just built this body's own size — see the
          // MASS_MAX_BONUS constant block) overrides matter-js's own
          // radius-derived default, so a long note still throws and
          // lands like something with real heft, exactly as it already
          // feels sluggish under the ordinary force-directed physics.
          // setMass rather than an options.density guess, since it
          // correctly updates the body's own inertia too, not just its
          // scalar mass.
          Matter.Body.setMass(body, node.mass);
          body.__noteId = id;
          Matter.Body.setVelocity(body, {
            x: (Math.random() - 0.5) * TOSS_KICK_VX,
            y: -(TOSS_KICK_VY_MIN + Math.random() * TOSS_KICK_VY_SPAN),
          });
          Matter.World.add(engine.world, body);
          toss.bodies.set(id, body);
          node.tossed = true;
          node.vx = 0;
          node.vy = 0;
        });

        // Every real bounce feeds the exact same node.impact channel an
        // ordinary collision already does — the jelly wobble and the
        // audible thud both just happen, no second instrument built for
        // this one.
        toss.handleCollision = (e) => {
          for (const pair of e.pairs) {
            for (const body of [pair.bodyA, pair.bodyB]) {
              const node = body.__noteId ? byId.get(body.__noteId) : null;
              if (!node) continue;
              const speed = Math.hypot(body.velocity.x, body.velocity.y);
              if (speed < TOSS_IMPACT_MIN_SPEED) continue;
              node.impact += speed * TOSS_IMPACT_GAIN;
            }
          }
        };
        Matter.Events.on(engine, "collisionStart", toss.handleCollision);

        toss.engine = engine;
        toss.active = true;
        toss.endAt = simTime + TOSS_DURATION;
        // The same detonation the reshuffle's own annealing kick
        // announces itself with — a toss is every bit as big a
        // statement about the desk.
        ink?.splash(cx, cy, INK_RESHUFFLE_SPLASH);
      },
    };

    // The mode switch (see the LAYOUT_MODES block) — the caller has
    // already written modeRef, so all this owns is the journey: no random
    // kick (unlike the reshuffle, the new law's own forces supply all the
    // direction the migration needs), just the annealing speed cap that
    // stages the first lurch into a legible swim, and the pool marking
    // the moment. Under reduced motion the same synchronous settle pass
    // as boot, now solving under the new law: the destination without
    // the journey.
    modeControllerRef.current = {
      transition: () => {
        if (reduceMotionRef.current) {
          for (let i = 0; i < SETTLE_ITERATIONS; i++) step(SETTLE_DT);
          return;
        }
        temperature = MODE_TEMPERATURE;

        // Each law rings its own note — the pool strikes the same
        // standing eigenmode the Shift+Tap "drum" gesture reaches (see
        // strikeChladni below), matched 1:1 by index against
        // LAYOUT_MODES instead of that gesture's own round-robin cycle,
        // so switching TO a given law always rings the same signature
        // chord rather than whichever mode happens to be next in line.
        // No sound unless the strike itself actually landed — the same
        // rule CHLADNI_MODES' own comment already states elsewhere.
        const next = modeRef.current;
        const modeIndex = LAYOUT_MODES.findIndex((m) => m.id === next);
        const [chladniM, chladniN] = CHLADNI_MODES[modeIndex];
        if (ink) {
          ink.strikeMode(chladniM, chladniN, CHLADNI_AMP);
          const freqRatio = Math.hypot(chladniM / DOMAIN_W, chladniN / DOMAIN_H) / Math.hypot(1 / DOMAIN_W, 1 / DOMAIN_H);
          playMembrane(CHLADNI_FREQ_BASE * freqRatio, 0.7, stereoPanAt(cx));
        }

        // A small, one-time seed on top of whatever velocity each node
        // already carries — the destination law's own per-frame forces
        // (ORRERY_SPRING, STRATA_SPRING, SPECTRUM_SPRING, FLOCK_ALIGN_GAIN)
        // already pull every node toward its correct new target
        // regardless; this only nudges the very first visible frame so
        // the migration reads as already knowing where it's headed,
        // rather than a beat of isotropic drift before the new law's own
        // pull takes over.
        const seedGain = MODE_TEMPERATURE * 0.4;

        if (next === "orrery") {
          // A shared tangential bias — the whole graph starts swirling
          // the same way a moment before each node's own Kepler spring
          // takes over its exact orbit.
          byId.forEach((node) => {
            const dx = node.x - cx;
            const dy = node.y - cy;
            const dist = Math.max(1, Math.hypot(dx, dy));
            node.vx += (-dy / dist) * seedGain;
            node.vy += (dx / dist) * seedGain;
          });
        } else if (next === "strata") {
          // Sediment falls — a shared downward bias, settling under its
          // own weight before each note's own shelf spring sorts it onto
          // the month it actually belongs to.
          byId.forEach((node) => { node.vy += seedGain * 0.6; });
        } else if (next === "flock") {
          // The flock agrees on a heading before it's even finished
          // forming up — one shared bearing, picked fresh per
          // transition, rather than each node's own alignment rule being
          // the only thing that ever points them the same way.
          const heading = Math.random() * Math.PI * 2;
          const hx = Math.cos(heading) * seedGain;
          const hy = Math.sin(heading) * seedGain;
          byId.forEach((node) => { node.vx += hx; node.vy += hy; });
        } else if (next === "spectrum") {
          // Each note leans toward its own color's wedge a beat early —
          // the same sector lookup the real spectrum force uses for its
          // target, just read here for direction only.
          byId.forEach((node) => {
            const sector = SPECTRUM_SECTORS.find((s) => s.key === (node.color || "none")) || SPECTRUM_SECTORS[SPECTRUM_SECTORS.length - 1];
            node.vx += Math.cos(sector.centerAngle) * seedGain;
            node.vy += Math.sin(sector.centerAngle) * seedGain * (DOMAIN_H / DOMAIN_W);
          });
        }
      },
    };

    // The signal ping's schedule (see the PING_HOP_INTERVAL constant
    // block) — a time-sorted event list walked with a head index in tick()
    // (the same no-shift() discipline findShortestPath's own queue keeps,
    // and for the same reason). Only shift-click launches one, and
    // shift-click lives in handleDown below inside this same closure, so
    // unlike the morph/minimap/reheat bridges this needs no controller ref.
    const ping = { events: [], head: 0, elapsed: 0 };

    const startPing = (sourceId) => {
      // An autonomous cascading disturbance is precisely what reduced
      // motion opts out of — the path-status pill still reports
      // reachability in words either way.
      if (reduceMotionRef.current) return;

      // BFS hop distances from the source — the same adjacency build and
      // head-index queue findShortestPath uses, kept separate because this
      // wants the whole distance field, not one path.
      const adjacency = new Map();
      edgeList.forEach((edge) => {
        if (!adjacency.has(edge.a)) adjacency.set(edge.a, []);
        if (!adjacency.has(edge.b)) adjacency.set(edge.b, []);
        adjacency.get(edge.a).push(edge.b);
        adjacency.get(edge.b).push(edge.a);
      });
      const hop = new Map([[sourceId, 0]]);
      const queue = [sourceId];
      for (let head = 0; head < queue.length; head++) {
        for (const neighbor of adjacency.get(queue[head]) || []) {
          if (hop.has(neighbor)) continue;
          hop.set(neighbor, hop.get(queue[head]) + 1);
          queue.push(neighbor);
        }
      }

      // A thread carries the front the moment the front reaches its
      // NEARER endpoint (min hop) — including the equal-hop cross edges a
      // BFS tree alone would miss, which a real wavefront still floods
      // through. Node arrivals land a full hop later by construction.
      const events = [];
      hop.forEach((h, id) => {
        const factor = Math.pow(PING_DECAY, h);
        if (h === 0 || factor < PING_MIN_FACTOR) return;
        events.push({ type: "node", id, t: h * PING_HOP_INTERVAL, factor });
      });
      edgeList.forEach((edge) => {
        const ha = hop.get(edge.a);
        const hb = hop.get(edge.b);
        if (ha === undefined || hb === undefined) return;
        const h = Math.min(ha, hb);
        const factor = Math.pow(PING_DECAY, h);
        if (factor < PING_MIN_FACTOR) return;
        events.push({ type: "edge", edge, t: h * PING_HOP_INTERVAL, factor });
      });
      events.sort((x, y) => x.t - y.t);

      // A new ping simply replaces any still-running one — two overlapping
      // wavefronts would double-strum every shared thread for no legible
      // gain, and the fresh anchor is the statement being made now.
      ping.events = events;
      ping.head = 0;
      ping.elapsed = 0;

      // The source announces itself immediately — hop 0 is "now".
      const source = byId.get(sourceId);
      if (source) {
        source.pingPulse = Math.max(source.pingPulse, PING_NODE_PULSE);
        ink?.splash(source.x, source.y, PING_NODE_SPLASH);
      }
    };

    // A sonar tap (see the SONAR_SPEED constant block) — only ever called
    // from the non-reduced-motion side of handleUp's tap test. A tap with
    // every ring slot in flight just misses: four overlapping fronts is
    // already past the point where a fifth says anything.
    const emitSonar = (x, y) => {
      if (sonarFreeSlots.length === 0) return;
      sonars.push({ slot: sonarFreeSlots.pop(), x, y, r: 0, prevR: 0 });
      ink?.splash(x, y, SONAR_SPLASH);
    };

    // A Chladni strike (see the CHLADNI constants) — each one climbs the
    // mode ladder and sounds that mode's true relative eigenfrequency,
    // panned from wherever the striking tap landed (the mode fills the
    // whole pool, but the strike happened somewhere). Gated on the
    // surface existing — no pool, no membrane, no voice.
    let chladniIndex = 0;
    const strikeChladni = (x) => {
      if (!ink) return;
      const [m, n] = CHLADNI_MODES[chladniIndex % CHLADNI_MODES.length];
      chladniIndex += 1;
      ink.strikeMode(m, n, CHLADNI_AMP);
      const freqRatio = Math.hypot(m / DOMAIN_W, n / DOMAIN_H) / Math.hypot(1 / DOMAIN_W, 1 / DOMAIN_H);
      playMembrane(CHLADNI_FREQ_BASE * freqRatio, 0.7, stereoPanAt(x));
    };

    // One side of a contact dimple (see the DIMPLE constants) — runs the
    // node's own breathing anchors through the neighbor's inflated disc
    // and records how deep each one sits, in the blob's LOCAL units (the
    // dent rides inside the same scaled transform the path does, so a
    // px of dent on screen is a px/scale dent in the path). Targets take
    // the max across neighbors — a blob squeezed from two sides dents on
    // both — and the per-anchor buffers are allocated lazily on first
    // contact, since most notes on a calm desk never touch anything.
    const applyDimples = (id, node, rEff, ncx, ncy, otherR, ocx, ocy) => {
      const shapes = shapeCacheRef.current.get(id);
      if (!shapes || rEff <= 0.001) return;
      if (!node.dents) {
        node.dents = new Float32Array(shapes.anchors.length);
        node.dentTargets = new Float32Array(shapes.anchors.length);
      }
      const scale = rEff / shapes.radius;
      for (let idx = 0; idx < shapes.anchors.length; idx++) {
        const { angle, wobble } = shapes.anchors[idx];
        // The anchor's WORLD direction folds in the blob's own spin (see
        // the SPIN constants) — a dent is material, it turns with the
        // body, so the pressure field must find whichever anchors NOW
        // face the neighbor.
        const worldAngle = angle + node.rot;
        const anchorX = ncx + Math.cos(worldAngle) * wobble * rEff;
        const anchorY = ncy + Math.sin(worldAngle) * wobble * rEff;
        const pen = (otherR + DIMPLE_RANGE) - Math.hypot(anchorX - ocx, anchorY - ocy);
        if (pen <= 0) continue;
        const dentLocal = Math.min(rEff * DIMPLE_MAX, pen * DIMPLE_DEPTH) / scale;
        if (dentLocal > node.dentTargets[idx]) node.dentTargets[idx] = dentLocal;
      }
    };

    // Pinch navigation — the camera's one genuinely touch-native gesture.
    // Every active pointer is rostered by id; the moment a second lands
    // on open water the gesture stops being a pan and becomes a pinch:
    // per move, the zoom scales by the finger-distance ratio and the
    // camera tilts by the finger-pair's own angle change, both anchored at
    // the current midpoint (the exact keep-the-point-under-the-anchor
    // solve the wheel already does, generalized to rotation too — see the
    // handleMove pinch block), and the midpoint's own travel pans.
    // Incremental against the LAST frame's distance/angle/midpoint rather
    // than the gesture's start, so fingers that drift apart (or spin past
    // ±180°) mid-gesture never cause a jump. Ends when either finger
    // lifts — deliberately without handing zoom/pan momentum off or
    // converting back to a pan, since a half-lifted pinch has no honest
    // single-pointer intent to inherit; the tilt follows the same
    // restraint by simply not tracking any angular velocity to inherit in
    // the first place; see ROTATE_SPRING_STIFFNESS for what un-does it
    // instead. Direct manipulation, so not gated on reduced motion, same
    // as the pan and the wheel.
    const activePointers = new Map();
    const pinch = { active: false, lastDist: 0, lastAngle: 0, lastMidX: 0, lastMidY: 0 };

    // The lasso's own live state (see the LASSO_POINT_GAP constant block)
    // — declared up here with pinch/stir/tow for the same temporal-
    // dead-zone reason: handleDown below can reach it before a `const`
    // declared nearer its own use would exist yet.
    const lasso = { active: false, points: [] };

    // The toss's own live state (see the TOSS_GRAVITY constant block) —
    // the matter-js engine and its bodies exist only for the duration of
    // one toss, created fresh each time rather than kept warm between
    // uses (a few seconds every so often doesn't earn a persistent
    // second physics world sitting idle the rest of the session).
    const toss = { active: false, engine: null, bodies: new Map(), endAt: 0, handleCollision: null };

    // A drag that starts on empty space (no [data-note-id] under the
    // pointer) pans the camera instead of grabbing a node — tracked
    // separately from `drag` above since the two are mutually exclusive
    // per gesture but need different state (a node drag hands off a
    // domain-space velocity to physics; a pan hands off a screen-space
    // velocity to the camera's own momentum).
    const panDrag = { active: false, lastClientX: 0, lastClientY: 0, lastT: 0, pixelDistance: 0, startDomainX: 0, startDomainY: 0 };

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
      lastInputTime = performance.now();
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // A second pointer on the stage upgrades the gesture to a pinch
      // (see the pinch declaration above) — unless a node, thread, or
      // the stirring rod is already claimed, whose gestures a stray
      // second finger shouldn't hijack. Any in-flight pan hands over,
      // its tap disarmed so lifting the pinch can't fire a sonar.
      if (activePointers.size === 2 && !drag.id && !tow.edge && !stir.active) {
        const [p1, p2] = Array.from(activePointers.values());
        gsap.killTweensOf(camera);
        cameraAnimating = false;
        panDrag.active = false;
        panDrag.pixelDistance = 999;
        camera.vx = 0;
        camera.vy = 0;
        pinch.active = true;
        pinch.lastDist = Math.max(1, Math.hypot(p2.x - p1.x, p2.y - p1.y));
        pinch.lastAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        pinch.lastMidX = (p1.x + p2.x) / 2;
        pinch.lastMidY = (p1.y + p2.y) / 2;
        return;
      }

      // Right button anywhere — the stirring rod (see the STIR_RADIUS
      // constant block), node or no node under the pointer: stirring is
      // an action on the pool itself, not on any one note. Mutually
      // exclusive with an in-flight node drag or pan by construction
      // (those gestures started with the left button and are still
      // holding it). Under reduced motion this never engages, and the
      // contextmenu listener below leaves the browser's own menu alone
      // there for the same reason.
      if (e.button === 2) {
        if (reduceMotionRef.current || drag.id || panDrag.active || tow.edge) return;
        const { x, y } = domainFromEvent(e);
        stir.active = true;
        stir.x = x;
        stir.y = y;
        stir.vx = 0;
        stir.vy = 0;
        stir.lastT = performance.now();
        svg.style.cursor = "grabbing";
        return;
      }

      const target = e.target.closest("[data-note-id]");

      if (!target) {
        // A second finger while a node or thread is already held gets
        // no gesture of its own — the pinch upgrade above already
        // declined it, and a stray pan or tow underneath a live grip
        // would fight it.
        if (drag.id || tow.edge) return;

        const { x, y } = domainFromEvent(e);

        // Ctrl/Cmd-drag on open water starts a lasso (see the
        // LASSO_POINT_GAP constant block) instead of a pan or a tow —
        // checked before the tow's own grab-radius test so intent to
        // lasso never gets mistaken for brushing a nearby thread.
        if (e.ctrlKey || e.metaKey) {
          lasso.active = true;
          lasso.points = [{ x, y }];
          svg.style.cursor = "crosshair";
          return;
        }

        // A drag that starts ON a thread tows the thread itself (see the
        // TOW_GRAB_PX constant block) — closest chord within the grab
        // radius wins, tested in domain space against a threshold scaled
        // back from screen pixels so the grab feels the same at every
        // zoom. Skipped under reduced motion (towing displaces nodes the
        // same way node-dragging does), where the press falls through to
        // the pan it would otherwise have been.
        if (!reduceMotionRef.current) {
          let towEdge = null;
          let towBest = TOW_GRAB_PX / renderScale;
          for (const edge of edgeList) {
            const a = byId.get(edge.a);
            const b = byId.get(edge.b);
            const d = pointSegDist(x, y, a.x, a.y, b.x, b.y);
            if (d < towBest) { towBest = d; towEdge = edge; }
          }
          if (towEdge) {
            tow.edge = towEdge;
            tow.x = x;
            tow.y = y;
            tow.stretch = 0;
            svg.style.cursor = "grabbing";
            return;
          }
        }

        // Empty space — pan, not a node grab. Panning itself isn't gated
        // on reduced motion (it's direct manipulation, the same as
        // scrolling a page); only its own post-release momentum coast is
        // (see handleUp below). Grabbing the camera directly always wins
        // over any in-flight reset tween — kill it rather than let the two
        // fight over camera.x/y for the rest of this drag. The press
        // point and travel are kept for handleUp's own tap test: a pan
        // that never moves is a tap on open water, and a tap is a sonar
        // (see the SONAR_SPEED constant block).
        gsap.killTweensOf(camera);
        cameraAnimating = false;
        panDrag.active = true;
        panDrag.pixelDistance = 0;
        panDrag.startDomainX = x;
        panDrag.startDomainY = y;
        panDrag.lastClientX = e.clientX;
        panDrag.lastClientY = e.clientY;
        panDrag.lastT = performance.now();
        camera.vx = 0;
        camera.vy = 0;
        svg.style.cursor = "grabbing";
        return;
      }

      const id = target.getAttribute("data-note-id");
      const node = byId.get(id);
      if (!node) return;

      // Shift-click sets/clears a path anchor instead of grabbing or
      // selecting the node — a deliberately different gesture from a
      // plain click, which still opens the note exactly as it always has.
      // setPathAnchors is a stable setState function (React guarantees its
      // identity never changes), safe to call directly from this
      // [active]-only effect the same way `service` already is.
      if (e.shiftKey) {
        // A FRESH anchor launches the signal ping (see the
        // PING_HOP_INTERVAL constant block); shift-clicking an existing
        // anchor is a removal — a withdrawn question, nothing to announce.
        // pathAnchorsRef mirrors the state because this [active]-only
        // effect never re-runs on pathAnchors changes.
        if (!pathAnchorsRef.current.includes(id)) startPing(id);
        togglePathAnchor(id);
        return;
      }

      // Alt-click pins/unpins in place (see the pinning constant-block
      // comment for why this isn't double-click) — flag flipped on the
      // physics side immediately, mirrored into React state for the ring
      // visual, same stable-setState reasoning as togglePathAnchor above.
      // An unpinned node wakes up at rest and lets the forces reclaim it
      // from wherever it was held.
      if (e.altKey) {
        togglePin(id);
        return;
      }

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
      // The grip's own state (see the GRIP_K constant block) — target
      // starts at the note itself, offset by where on the blob the pinch
      // landed, so grabbing never jerks the note to the pointer.
      drag.offsetX = node.x - x;
      drag.offsetY = node.y - y;
      drag.targetX = node.x;
      drag.targetY = node.y;
    };

    const handleMove = (e) => {
      lastInputTime = performance.now();
      const roster = activePointers.get(e.pointerId);
      if (roster) {
        roster.x = e.clientX;
        roster.y = e.clientY;
      }

      // The pinch (see its declaration) — zoom from the finger distance's
      // ratio, tilt from the finger-pair's own angle change, and pan from
      // the midpoint's travel, all three folded into ONE anchor solve: read
      // whatever world-pixel point currently sits under this frame's own
      // midpoint through the OLD camera, apply this frame's zoom/rotate
      // deltas, then place the camera so that same point lands back under
      // the (possibly already-travelled) midpoint. That single re-anchor is
      // what makes pan fall out for free alongside zoom and rotate, the
      // same "keep the point under the gesture fixed" idea the wheel's own
      // zoom-anchor already uses, generalized from one axis to three.
      if (pinch.active) {
        if (activePointers.size < 2) return;
        const [p1, p2] = Array.from(activePointers.values());
        const rect = svg.getBoundingClientRect();
        const dist = Math.max(1, Math.hypot(p2.x - p1.x, p2.y - p1.y));
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const midX = (p1.x + p2.x) / 2 - rect.left;
        const midY = (p1.y + p2.y) / 2 - rect.top;

        const anchor = worldPixelFromLocal(midX, midY, rect);

        let deltaAngle = angle - pinch.lastAngle;
        if (deltaAngle > Math.PI) deltaAngle -= Math.PI * 2;
        else if (deltaAngle < -Math.PI) deltaAngle += Math.PI * 2;
        camera.rot += deltaAngle;
        camera.vrot = 0; // no inherited spin on release — see the pinch declaration

        const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * (dist / pinch.lastDist)));
        const rotatedAnchor = rotateAroundPivot(anchor.x, anchor.y, rect, camera.rot);
        camera.x = midX - rotatedAnchor.x * nextZoom;
        camera.y = midY - rotatedAnchor.y * nextZoom;
        camera.zoom = nextZoom;

        pinch.lastDist = dist;
        pinch.lastAngle = angle;
        pinch.lastMidX = midX + rect.left;
        pinch.lastMidY = midY + rect.top;
        return;
      }

      // The lasso (see the LASSO_POINT_GAP constant block) — records a
      // new point only once the cursor has actually moved a meaningful
      // domain distance, so a slow drag doesn't flood the array; the
      // in-progress stroke itself is drawn by tick() from this same
      // list, the same raw-handlers-mutate-data / tick-owns-the-DOM
      // split every other live gesture here already follows.
      if (lasso.active) {
        const { x, y } = domainFromEvent(e);
        const last = lasso.points[lasso.points.length - 1];
        if (lasso.points.length < LASSO_MAX_POINTS && Math.hypot(x - last.x, y - last.y) >= LASSO_POINT_GAP) {
          lasso.points.push({ x, y });
        }
        return;
      }
      // Tracked on every move regardless of what else this gesture is
      // doing (panning, dragging a node, or nothing at all) — gated at the
      // force-application site in step() by cursorField.active, which
      // handlePointerEnter/handleSvgLeave below own, so this is harmless
      // to keep current even while the pointer is briefly outside the SVG
      // mid-drag (handleMove is a window listener, same as the drag logic
      // below needs to be able to track a drag that strays past the edge).
      if (cursorField.active) {
        // The parallax head position (see the PARALLAX_GAIN constant
        // block) — normalized pointer offset from stage center, clamped
        // to ±1 for the drags that stray outside; the tick loop eases
        // toward it.
        if (!reduceMotionRef.current) {
          const rect = svg.getBoundingClientRect();
          parallax.tx = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width) * 2 - 1));
          parallax.ty = Math.max(-1, Math.min(1, ((e.clientY - rect.top) / rect.height) * 2 - 1));
        }

        const { x, y } = domainFromEvent(e);
        cursorField.prevX = cursorField.x;
        cursorField.prevY = cursorField.y;
        cursorField.x = x;
        cursorField.y = y;

        // The bare pointer's wake (see the POINTER_WAKE constants) — a
        // hand moved quickly through the water says the water is there.
        if (cursorField.hasPrev && !reduceMotionRef.current && !panDrag.active && !drag.id && !stir.active) {
          const movePx = Math.hypot(x - cursorField.prevX, y - cursorField.prevY) * renderScale;
          if (movePx > POINTER_WAKE_MIN_PX) {
            ink?.splash(x, y, Math.min(POINTER_WAKE_MAX, movePx * POINTER_WAKE_GAIN));
          }
        }

        // Sweeping the cursor across a thread plucks it (see the
        // PLUCK_OMEGA constant block): the segment the cursor just moved
        // through, tested against every edge's chord. Only while the
        // pointer is otherwise idle — a pan moves the world under a
        // stationary-in-world cursor (no real sweep happened), and a node
        // drag already jerks its own threads more honestly via the fling
        // handoff in handleUp. Amplitude scales with how hard the sweep
        // was, exactly like a real string picks up more energy from a
        // faster pick.
        if (cursorField.hasPrev && !panDrag.active && !drag.id && !stir.active && !reduceMotionRef.current) {
          const sweepPx = Math.hypot(x - cursorField.prevX, y - cursorField.prevY) * renderScale;
          if (sweepPx > 0.5) {
            for (const edge of edgeList) {
              // The towed thread never self-plucks — the cursor rides its
              // own midpoint, so every move would cross its own chord.
              // Every OTHER thread stays fair game: dragging a towed
              // thread across the rigging strums it, and the glissando
              // is real.
              if (edge === tow.edge) continue;
              const a = byId.get(edge.a);
              const b = byId.get(edge.b);
              if (!segmentsCross(cursorField.prevX, cursorField.prevY, x, y, a.x, a.y, b.x, b.y)) continue;
              const amp = Math.min(PLUCK_MAX_AMP - edge.vibAmp, sweepPx * PLUCK_SWEEP_GAIN);
              // WHERE the sweep crossed the chord — the intersection's
              // own parameter along a→b (the orientation ratio, exact
              // for segments that strictly cross) — becomes the pluck
              // point pluckEdge turns into modal amplitudes: crossing a
              // thread near its end genuinely rings brighter than
              // crossing its middle.
              const oA = orient(cursorField.prevX, cursorField.prevY, x, y, a.x, a.y);
              const oB = orient(cursorField.prevX, cursorField.prevY, x, y, b.x, b.y);
              const crossP = oA / (oA - oB);
              const bright = pluckEdge(edge, amp, crossP);

              // Resonance — the pluck's energy also reaches the string's
              // own anchors (see the PLUCK_NODE_IMPULSE constant block),
              // perpendicular to the chord on whichever side the sweep
              // crossed from (the cross product's own sign), through each
              // endpoint's own inertia.
              const chordX = b.x - a.x;
              const chordY = b.y - a.y;
              const chordLen = Math.hypot(chordX, chordY) || 1;
              const sweepDx = x - cursorField.prevX;
              const sweepDy = y - cursorField.prevY;
              const side = Math.sign(chordX * sweepDy - chordY * sweepDx) || 1;
              const nX = (-chordY / chordLen) * side;
              const nY = (chordX / chordLen) * side;
              const kick = amp * PLUCK_NODE_IMPULSE;
              a.vx += (nX * kick) / a.mass;
              a.vy += (nY * kick) / a.mass;
              b.vx += (nX * kick) / b.mass;
              b.vy += (nY * kick) / b.mass;

              // And the pool feels the tap, right at the string's belly.
              ink?.splash((a.x + b.x) / 2, (a.y + b.y) / 2, amp * INK_PLUCK_GAIN);

              // The audible pluck (see the PLUCK_SOUND constants) —
              // pitched by this thread's own current length, gated on
              // fresh amplitude so re-sweeping an already-ringing thread
              // doesn't machine-gun; a sweep crossing several threads at
              // once lands as a strum. utils/sound.js's own opt-in gate
              // keeps all of this silent until sounds are turned on.
              if (amp > PLUCK_SOUND_MIN_AMP) {
                playThreadPluck(pluckFrequency(chordLen * renderScale), amp / PLUCK_MAX_AMP, stereoPanAt((a.x + b.x) / 2), bright);
              }
            }
          }
        }
        cursorField.hasPrev = true;
      }

      // The stirring rod's own tracking (see the STIR_RADIUS constant
      // block) — instantaneous rate from this move alone, clamped, then
      // eased into the paddle's working velocity: the same "just read the
      // latest rate" approach the pan and node drags below use, softened
      // one step because a raw per-move rate is jumpy enough to read as
      // jitter when it's driving a force field rather than a release
      // handoff.
      if (stir.active) {
        const now = performance.now();
        const dtSec = Math.max(0.001, (now - stir.lastT) / 1000);
        const { x, y } = domainFromEvent(e);
        let ivx = (x - stir.x) / dtSec;
        let ivy = (y - stir.y) / dtSec;
        const rate = Math.hypot(ivx, ivy);
        if (rate > STIR_MAX_SPEED) {
          ivx = (ivx / rate) * STIR_MAX_SPEED;
          ivy = (ivy / rate) * STIR_MAX_SPEED;
        }
        stir.vx += (ivx - stir.vx) * STIR_SMOOTHING;
        stir.vy += (ivy - stir.vy) * STIR_SMOOTHING;
        stir.x = x;
        stir.y = y;
        stir.lastT = now;
        return;
      }

      // The towed thread just follows the hand — all the actual physics
      // (tension into the anchors, the stretch readout) lives in step(),
      // and the two-half rendering in the tick loop's edge pass.
      if (tow.edge) {
        const { x, y } = domainFromEvent(e);
        tow.x = x;
        tow.y = y;
        return;
      }

      if (panDrag.active) {
        const now = performance.now();
        const dtSec = Math.max(0.001, (now - panDrag.lastT) / 1000);
        const dx = e.clientX - panDrag.lastClientX;
        const dy = e.clientY - panDrag.lastClientY;

        camera.x += dx;
        camera.y += dy;
        panDrag.pixelDistance += Math.abs(dx) + Math.abs(dy);
        // Implied velocity from this move alone, same "just read the
        // latest instantaneous rate" approach the node drag below already
        // uses — only the very last of these survives to become the
        // release's own momentum.
        camera.vx = dx / dtSec;
        camera.vy = dy / dtSec;

        panDrag.lastClientX = e.clientX;
        panDrag.lastClientY = e.clientY;
        panDrag.lastT = now;
        return;
      }

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

      // The grip's own target — the hand plus the original pinch offset
      // (see the GRIP_K constant block). Nothing here writes a position
      // or a velocity anymore: the spring in step() integrates the held
      // note for real, which is also what feeds the trail, the jelly
      // stretch, and the release momentum without any mirroring.
      drag.targetX = x + drag.offsetX;
      drag.targetY = y + drag.offsetY;
    };

    const handleUp = (e) => {
      activePointers.delete(e.pointerId);

      // Either finger lifting ends the pinch outright — see the pinch
      // declaration for why nothing is inherited by the survivor.
      if (pinch.active) {
        if (activePointers.size < 2) pinch.active = false;
        return;
      }

      // Resolving the lasso (see the LASSO_POINT_GAP constant block) —
      // too few recorded points is an accidental ctrl-click, not a real
      // drag, and leaves whatever selection already existed alone rather
      // than wiping it. A real drag tests every note's TRUE domain
      // position against the traced loop with the exact same
      // point-in-polygon utils/hull.js's cluster hit-test already uses.
      if (lasso.active) {
        lasso.active = false;
        svg.style.cursor = "";
        if (lassoPathRef.current) {
          lassoPathRef.current.setAttribute("d", "");
          lassoPathRef.current.setAttribute("opacity", "0");
        }
        if (lasso.points.length >= LASSO_MIN_POINTS) {
          const polygon = lasso.points.map((p) => [p.x, p.y]);
          const picked = [];
          byId.forEach((node, id) => {
            if (pointInPolygon(node.x, node.y, polygon)) picked.push(id);
          });
          // A hand-drawn loop is at least as deliberate a selection as a
          // tag click (see LENS_SPLASH's own confirmation), so it earns
          // the same scatter of taps across exactly what it caught.
          picked.forEach((id) => {
            const node = byId.get(id);
            if (node) ink?.splash(node.x, node.y, LASSO_SPLASH);
          });
          setLassoIds(picked);
        }
        lasso.points = [];
        return;
      }

      // The rod lifting out of the pool — residual paddle speed just
      // decays in tick() rather than being zeroed, so a vigorous final
      // swirl doesn't cut dead the instant the button releases.
      if (stir.active && e.button === 2) {
        stir.active = false;
        svg.style.cursor = "";
        return;
      }

      // Releasing a towed thread (see the TOW_GRAB_PX constant block) —
      // the snap-back pluck carries exactly the energy the tow had
      // stored: amplitude from the stretch it was released under, voiced
      // by the thread's own current length, splashing right where the
      // hand let go. A tow released slack just drapes back to its own
      // catenary with no ceremony, which is what a rope actually does.
      if (tow.edge) {
        const edge = tow.edge;
        tow.edge = null;
        svg.style.cursor = "";
        const stretchPx = tow.stretch * renderScale;
        if (stretchPx > 1) {
          const amp = Math.min(PLUCK_MAX_AMP - edge.vibAmp, stretchPx * TOW_RELEASE_PLUCK);
          if (amp > 0) {
            const a = byId.get(edge.a);
            const b = byId.get(edge.b);
            // The snap-back releases FROM the hand — its pluck point is
            // the hand's own projection onto the chord, so a tow held
            // near one end lets go bright and a centered tow lets go
            // round, same law as every other pluck.
            const chordX = b.x - a.x;
            const chordY = b.y - a.y;
            const chordLenSq = chordX * chordX + chordY * chordY || 1;
            const handP = ((tow.x - a.x) * chordX + (tow.y - a.y) * chordY) / chordLenSq;
            const bright = pluckEdge(edge, amp, handP);
            ink?.splash(tow.x, tow.y, amp * INK_PLUCK_GAIN * 2);
            if (amp > PLUCK_SOUND_MIN_AMP) {
              playThreadPluck(pluckFrequency(Math.sqrt(chordLenSq) * renderScale), amp / PLUCK_MAX_AMP, stereoPanAt(tow.x), bright);
            }
          }
        }
        return;
      }

      if (panDrag.active) {
        panDrag.active = false;
        svg.style.cursor = "";
        // The coast itself is what reduced motion asks this app not to
        // introduce on its own — the pan drag that already happened was
        // the visitor's own direct input, not autonomous motion, but
        // continuing to glide afterward is exactly the kind of inertial
        // scrolling prefers-reduced-motion is meant to suppress.
        if (reduceMotionRef.current) { camera.vx = 0; camera.vy = 0; }
        // A pan that never moved was a tap on open water — the sonar
        // (see the SONAR_SPEED constant block), launched from the press
        // point rather than the release, since a tap IS its press. A
        // SHIFT-tap strikes the whole pool as a drumhead instead (see
        // the CHLADNI constants) — the same modifier that asks bigger
        // questions of nodes asks a bigger question of the water.
        else if (panDrag.pixelDistance < 6) {
          if (e.shiftKey) strikeChladni(panDrag.startDomainX);
          else emitSonar(panDrag.startDomainX, panDrag.startDomainY);
        }
        return;
      }

      if (!drag.id) return;
      const node = byId.get(drag.id);
      if (node) {
        node.dragging = false;
        // The throw is whatever momentum the grip's spring actually built
        // up (see the GRIP_K constant block) — the note has been
        // integrating its own velocity the whole drag, so release just
        // stops holding it; no implied-rate handoff to fake. Unless it's
        // pinned: dragging a pinned node relocates its anchor, and an
        // anchor doesn't coast.
        if (node.pinned) {
          node.vx = 0;
          node.vy = 0;
        }

        // A fling jerks every thread tied to the released node — the same
        // damped standing wave a cursor sweep excites (see the PLUCK_OMEGA
        // constant block), energized by the release speed itself, so a
        // gentle set-down barely stirs them and a hard fling makes the
        // whole neighborhood's rigging ring.
        if (!reduceMotionRef.current) {
          const releaseSpeedPx = Math.hypot(drag.vx, drag.vy) * renderScale;
          if (releaseSpeedPx > 1) {
            for (const edge of edgeList) {
              if (edge.a !== drag.id && edge.b !== drag.id) continue;
              const amp = Math.min(PLUCK_MAX_AMP - edge.vibAmp, releaseSpeedPx * PLUCK_FLING_GAIN);
              // A fling jerks the thread AT the flung node's own end —
              // an end-pluck by construction, so a hard release rings
              // bright, exactly as yanking a string's end does.
              const bright = pluckEdge(edge, amp, edge.a === drag.id ? 0.12 : 0.88);

              // Resonance, fling flavor — a yanked string tugs its far
              // anchor toward the node doing the yanking, along the chord
              // (where the sweep pluck's impulse is perpendicular: a
              // sideways strum versus a longitudinal jerk), through the
              // far anchor's own inertia.
              const far = edge.a === drag.id ? byId.get(edge.b) : byId.get(edge.a);
              const towardX = node.x - far.x;
              const towardY = node.y - far.y;
              const towardLen = Math.hypot(towardX, towardY) || 1;
              const kick = (amp * PLUCK_NODE_IMPULSE) / far.mass;
              far.vx += (towardX / towardLen) * kick;
              far.vy += (towardY / towardLen) * kick;

              ink?.splash((node.x + far.x) / 2, (node.y + far.y) / 2, amp * INK_PLUCK_GAIN);

              // Same audible pluck as the sweep (see there) — a hard
              // fling rakes every thread tied to the node, which lands
              // as a chord voiced by their actual lengths.
              if (amp > PLUCK_SOUND_MIN_AMP) {
                playThreadPluck(pluckFrequency(towardLen * renderScale), amp / PLUCK_MAX_AMP, stereoPanAt((node.x + far.x) / 2), bright);
              }
            }
          }
        }
      }
      // A confirmed click (not a drag) hands off to the xstate machine
      // rather than calling onSelectNote directly — see
      // ConstellationState.js for why the actual callback only ever fires
      // once the "diving" flourish this triggers has finished playing.
      if (drag.pixelDistance < 6) service.send({ type: "SELECT", id: drag.id });
      drag.id = null;
    };

    // The cursor field (see CURSOR_FIELD_RADIUS's own module comment) only
    // ever pulls while the pointer is confirmed to actually be over the
    // SVG — entering sets cursorField.active, leaving clears it (and the
    // last-known position along with it, so a node doesn't keep feeling a
    // stale pull toward wherever the pointer happened to leave from).
    const handlePointerEnter = () => { cursorField.active = true; lastInputTime = performance.now(); };
    // hasPrev cleared too — the first move after re-entering would
    // otherwise measure a "sweep" from wherever the pointer left the SVG
    // to wherever it came back in, plucking every thread that stale
    // phantom segment happens to cross. The parallax head eases home to
    // center rather than freezing at wherever the pointer exited.
    const handleSvgPointerLeave = () => {
      cursorField.active = false;
      cursorField.hasPrev = false;
      parallax.tx = 0;
      parallax.ty = 0;
    };

    // Wheel-zoom, anchored to the cursor — see the MIN_ZOOM/MAX_ZOOM
    // module comment for why this is applied directly per event rather
    // than eased. Standard "keep the point under the cursor fixed" math:
    // find that point in world space before the zoom changes, then solve
    // for whatever camera.x/y keeps it under the same screen position
    // after.
    const handleWheel = (e) => {
      e.preventDefault();
      lastInputTime = performance.now();
      gsap.killTweensOf(camera);
      cameraAnimating = false;

      const rect = svg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const world = worldPixelFromLocal(mouseX, mouseY, rect);

      const zoomFactor = Math.exp(-e.deltaY * WHEEL_SENSITIVITY);
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * zoomFactor));

      // rot itself never changes here — rotateAroundPivot still has to run
      // (at whatever tilt is currently live, mid pinch-release spring or
      // not) since the anchor solve is in world-pixel space, upstream of
      // rotation, not domain space.
      const rotated = rotateAroundPivot(world.x, world.y, rect, camera.rot);
      camera.x = mouseX - rotated.x * nextZoom;
      camera.y = mouseY - rotated.y * nextZoom;
      camera.zoom = nextZoom;
    };

    // Fit-to-bounds — the zoom that shows a padded WORLD-PIXEL box on both
    // axes, then whatever camera translate centers that box (the same
    // forward mapping the minimap jump already solves, with the zoom now
    // solved for too). Pulled out once both the cluster dive below and
    // the search fly-to (see searchControllerRef further down) needed the
    // exact same "frame this box" solve on two different note sets —
    // duplicating it a third time was the actual sign to extract it, the
    // same threshold utils/catenary.js was pulled from TagThreads.jsx for.
    const flyToWorldBox = (rect, minX, minY, maxX, maxY, padding, duration) => {
      const boxW = maxX - minX + padding * 2;
      const boxH = maxY - minY + padding * 2;
      const fitZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(rect.width / boxW, rect.height / boxH)));
      // rot: 0 rides along with every fit — this box's own min/max were
      // measured in plain unrotated world-pixel space (see the callers
      // below), so the frame this solves for is only honest at zero tilt;
      // folding the un-tilt into the same move reads as one continuous
      // camera gesture rather than a rotate snap-back the fit then fights.
      const fit = {
        x: rect.width / 2 - ((minX + maxX) / 2) * fitZoom,
        y: rect.height / 2 - ((minY + maxY) / 2) * fitZoom,
        zoom: fitZoom,
        rot: 0,
      };

      gsap.killTweensOf(camera);
      camera.vx = 0;
      camera.vy = 0;
      camera.vrot = 0;

      if (reduceMotionRef.current) {
        cameraAnimating = false;
        Object.assign(camera, fit);
        return;
      }
      cameraAnimating = true;
      gsap.to(camera, {
        ...fit,
        duration,
        ease: "power3.out",
        overwrite: "auto",
        onComplete: () => { cameraAnimating = false; },
      });
    };

    // The search fly-to (see the search JSX and its own state further
    // down) — resolves the current match set's own true positions into
    // the same world-pixel box flyToWorldBox already knows how to frame.
    // Bridged through a controller ref rather than reading React state
    // directly, the same reason morph/minimap/reheat all are: this whole
    // effect only runs once per [active], so it can never see a state
    // update React makes after that first render.
    searchControllerRef.current = {
      flyToMatches: (ids) => {
        if (!ids || ids.size === 0) return;
        const rect = svg.getBoundingClientRect();
        const scaleX = rect.width / DOMAIN_W;
        const scaleY = rect.height / DOMAIN_H;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        ids.forEach((id) => {
          const node = byId.get(id);
          if (!node) return;
          // Flying to a result set is exactly the kind of deliberate
          // "here's what I found" moment LENS_SPLASH already marks for a
          // tag click — the same confirmation, once per match.
          ink?.splash(node.x, node.y, SEARCH_SPLASH);
          const mx = node.x * scaleX;
          const my = node.y * scaleY;
          if (mx < minX) minX = mx;
          if (mx > maxX) maxX = mx;
          if (my < minY) minY = my;
          if (my > maxY) maxY = my;
        });
        if (minX === Infinity) return;
        flyToWorldBox(rect, minX, minY, maxX, maxY, SEARCH_FIT_PADDING, SEARCH_FIT_DURATION);
      },
    };

    // Double-clicking empty space resets the view — a small, standard
    // pan/zoom-UI convention, not something this needed to invent — unless
    // the point sits inside a cluster's own ink pool, in which case the
    // camera dives to fit that cluster instead (see the CLUSTER_FIT
    // constants). The hulls layer is pointer-events: none, so the hit has
    // to be resolved here by geometry: the click unprojected to world
    // pixels, ray-cast against each pool's current padded hull (the same
    // ring the tick loop drew this frame — clusters stash it as lastHull
    // precisely for this).
    const handleDblClick = (e) => {
      lastInputTime = performance.now();
      if (e.target.closest("[data-note-id]")) return;
      gsap.killTweensOf(camera);
      camera.vx = 0;
      camera.vy = 0;
      camera.vrot = 0;

      const rect = svg.getBoundingClientRect();
      const { x: worldX, y: worldY } = worldPixelFromLocal(e.clientX - rect.left, e.clientY - rect.top, rect);
      const hit = clusterList.find((cluster) => cluster.lastHull && pointInPolygon(worldX, worldY, cluster.lastHull));

      if (hit) {
        const scaleX = rect.width / DOMAIN_W;
        const scaleY = rect.height / DOMAIN_H;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        hit.members.forEach((memberId) => {
          const member = byId.get(memberId);
          const mx = member.x * scaleX;
          const my = member.y * scaleY;
          if (mx < minX) minX = mx;
          if (mx > maxX) maxX = mx;
          if (my < minY) minY = my;
          if (my > maxY) maxY = my;
        });
        flyToWorldBox(rect, minX, minY, maxX, maxY, CLUSTER_FIT_PADDING, CLUSTER_FIT_DURATION);
        return;
      }

      const target = { x: 0, y: 0, zoom: 1, rot: 0 };
      if (reduceMotionRef.current) {
        cameraAnimating = false;
        Object.assign(camera, target);
        return;
      }
      cameraAnimating = true;
      gsap.to(camera, {
        ...target,
        duration: VIEW_RESET_DURATION,
        ease: "power3.out",
        overwrite: "auto",
        onComplete: () => { cameraAnimating = false; },
      });
    };

    // Right-drag owns stirring (see handleDown), so the browser's own
    // context menu has to stand down over the stage — except under
    // reduced motion, where stirring never engages and suppressing the
    // menu would just break right-click for nothing.
    const handleContextMenu = (e) => {
      if (!reduceMotionRef.current) e.preventDefault();
    };

    // One pin toggle for both hands (see the pinning constant block) —
    // alt-click and the keyboard's P both land here: flag flipped on the
    // physics side immediately, mirrored into React state for the ring
    // visual, and an unpinned node wakes at rest for the forces to
    // reclaim.
    const togglePin = (id) => {
      const node = byId.get(id);
      if (!node) return;
      node.pinned = !node.pinned;
      node.vx = 0;
      node.vy = 0;
      // Only on the way to pinned — an arrival worth marking, the same
      // way diving into a note or a lens switching on already are.
      // Unpinning is a release, not an arrival, so it stays quiet.
      if (node.pinned) ink?.splash(node.x, node.y, PIN_SPLASH);
      setPinnedIds((prev) => (node.pinned ? [...prev, id] : prev.filter((pinnedId) => pinnedId !== id)));
    };

    // Focus movement (see the FOCUS_SPRING constant block) — one funnel
    // for every way focus changes, so the hover card and silhouette morph
    // always travel with it and always release the note they leave.
    const moveFocus = (nextId) => {
      const prev = focusIdRef.current;
      if (prev && prev !== nextId) morphControllerRef.current?.leave(prev);
      setFocusId(nextId);
      setHoveredId(nextId);
      if (nextId && nextId !== prev) morphControllerRef.current?.enter(nextId);
    };

    const ARROW_DIRS = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const handleKey = (e) => {
      lastInputTime = performance.now();

      // Escape peels one layer at a time — guide, then focus, and only
      // with nothing left to release does it bubble on to the panel's
      // own window-level Escape and close the whole sheet. Without the
      // stopPropagation here, dropping focus would ALSO slam the panel
      // shut — both listeners fire on the same keystroke.
      if (e.key === "Escape") {
        if (guideOpenRef.current) {
          e.stopPropagation();
          setGuideOpen(false);
          return;
        }
        if (focusIdRef.current) {
          e.stopPropagation();
          moveFocus(null);
          return;
        }
        // The lasso's own layer (see the LASSO_POINT_GAP constant block)
        // — added after focus, so with an early return on both branches
        // above, one press only ever peels exactly one layer.
        if (lassoIdsRef.current.length > 0) {
          e.stopPropagation();
          setLassoIds([]);
          return;
        }
        return;
      }

      // "?" summons the field guide (see GUIDE_SECTIONS) — the one key
      // every keyboard-driven surface teaches first. stopPropagation is
      // load-bearing here too (see "/" below for the same reasoning):
      // without it, this bubbles straight to ShortcutsSheet.jsx's own
      // window-level "?" handler and pops the app-wide shortcuts sheet
      // open on top of this panel's own field guide — the same key
      // opening two overlapping overlays at once.
      if (e.key === "?") {
        e.preventDefault();
        e.stopPropagation();
        playTick();
        setGuideOpen((prev) => !prev);
        return;
      }

      // "/" opens search (see the SEARCH_FIT_PADDING constant block) —
      // the same shortcut the app's own header search already teaches,
      // reused here since the graph is itself a search surface once a
      // query is typed. stopPropagation is load-bearing: this listener
      // lives on the svg, and without it the keystroke would still
      // bubble up to Home.jsx's own window-level "/" handler and steal
      // focus into the header's (currently hidden, behind this panel)
      // search input instead.
      if (e.key === "/") {
        e.preventDefault();
        e.stopPropagation();
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
        return;
      }
      if (e.key === "Enter" && focusIdRef.current) {
        e.preventDefault();
        service.send({ type: "SELECT", id: focusIdRef.current });
        return;
      }

      // Keyboard parity (see the FOCUS_SPRING constant block) — the
      // mouse's bigger statements, granted to the focused note: Space
      // launches the signal ping from it (startPing carries its own
      // reduced-motion gate), P pins it in place, and 1-5 pick the
      // layout law directly — switchMode reads modeRef precisely so this
      // mount-time capture stays legal.
      if (e.key === " " && focusIdRef.current) {
        e.preventDefault();
        startPing(focusIdRef.current);
        return;
      }
      // P pins the lasso's whole group when one exists (see the
      // LASSO_POINT_GAP constant block) — all-pin if any member is
      // unpinned, else all-unpin, so one press never leaves the group in
      // a mixed state — checked before the single-focus branch below so
      // a lasso selection takes priority when both exist.
      if ((e.key === "p" || e.key === "P") && lassoIdsRef.current.length > 0) {
        e.preventDefault();
        const ids = lassoIdsRef.current;
        const allPinned = ids.every((id) => byId.get(id)?.pinned);
        ids.forEach((id) => {
          const node = byId.get(id);
          if (node && node.pinned === allPinned) togglePin(id);
        });
        return;
      }
      if ((e.key === "p" || e.key === "P") && focusIdRef.current) {
        e.preventDefault();
        togglePin(focusIdRef.current);
        return;
      }
      const modePick = { 1: "web", 2: "orrery", 3: "strata", 4: "spectrum", 5: "flock" }[e.key];
      if (modePick) {
        switchMode(modePick);
        return;
      }

      const dir = ARROW_DIRS[e.key];
      if (!dir) return;
      e.preventDefault();

      const currentId = focusIdRef.current && byId.has(focusIdRef.current) ? focusIdRef.current : null;

      // Nothing focused yet — seed at the hub, the same crowning rule
      // the orrery's primaries use.
      if (!currentId) {
        let seed = null;
        let best = -1;
        byId.forEach((node, id) => {
          const degree = localDegree.get(id) || 0;
          if (degree > best || (degree === best && (seed === null || id < seed))) {
            best = degree;
            seed = id;
          }
        });
        if (seed) moveFocus(seed);
        return;
      }

      // Directional pick: the neighbor whose thread best matches the
      // arrow — unit-dot score with a floor, so an arrow with no honest
      // candidate simply doesn't move.
      const current = byId.get(currentId);
      let bestId = null;
      let bestEdge = null;
      let bestScore = FOCUS_MIN_ALIGNMENT;
      for (const edge of edgeList) {
        if (edge.a !== currentId && edge.b !== currentId) continue;
        const otherId = edge.a === currentId ? edge.b : edge.a;
        const other = byId.get(otherId);
        const dx = other.x - current.x;
        const dy = other.y - current.y;
        const dist = Math.hypot(dx, dy) || 1;
        const score = (dx / dist) * dir[0] + (dy / dist) * dir[1];
        if (score > bestScore) {
          bestScore = score;
          bestId = otherId;
          bestEdge = edge;
        }
      }
      if (!bestId) return;
      moveFocus(bestId);

      // The swimmer plucks the thread it travels — a keystroke crossing
      // a thread is still a thread being crossed. Stands down under
      // reduced motion with every other keyboard-cascaded motion.
      if (bestEdge && !reduceMotionRef.current) {
        const amp = Math.min(PLUCK_MAX_AMP - bestEdge.vibAmp, FOCUS_PLUCK_AMP);
        if (amp > 0) {
          // The swimmer runs the thread's whole length — centered,
          // fundamental-heavy voicing, same as the ping's flood.
          const bright = pluckEdge(bestEdge, amp, 0.5);
          const a = byId.get(bestEdge.a);
          const b = byId.get(bestEdge.b);
          ink?.splash((a.x + b.x) / 2, (a.y + b.y) / 2, amp * INK_PLUCK_GAIN);
          if (amp > PLUCK_SOUND_MIN_AMP) {
            playThreadPluck(
              pluckFrequency(Math.hypot(b.x - a.x, b.y - a.y) * renderScale),
              amp / PLUCK_MAX_AMP,
              stereoPanAt((a.x + b.x) / 2),
              bright
            );
          }
        }
      }
    };

    // Leaving the stage's focus releases the swimmer — standard focus
    // behavior, and it keeps a stale ring from floating over a graph the
    // keyboard is no longer talking to.
    const handleFocusBlur = () => {
      if (focusIdRef.current) moveFocus(null);
    };

    // A cancelled pointer (palm rejection, the OS stealing the gesture)
    // is a lift the app never chose — disarm the pan's tap so no sonar
    // fires from it and force the rod off (handleUp's own stir branch
    // needs the right button, which a cancel doesn't carry), then let
    // handleUp run the ordinary releases.
    const handlePointerCancel = (e) => {
      panDrag.pixelDistance = 999;
      stir.active = false;
      // Aborts an in-flight lasso outright rather than resolving a
      // selection from a truncated gesture — set BEFORE handleUp runs,
      // so its own `if (lasso.active)` branch below never fires for a
      // cancel.
      if (lasso.active) {
        lasso.active = false;
        lasso.points = [];
        if (lassoPathRef.current) {
          lassoPathRef.current.setAttribute("d", "");
          lassoPathRef.current.setAttribute("opacity", "0");
        }
      }
      if (svg.style.cursor === "grabbing" || svg.style.cursor === "crosshair") svg.style.cursor = "";
      handleUp(e);
    };

    svg.addEventListener("pointerdown", handleDown);
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    svg.addEventListener("contextmenu", handleContextMenu);
    svg.addEventListener("keydown", handleKey);
    svg.addEventListener("blur", handleFocusBlur);
    svg.addEventListener("wheel", handleWheel, { passive: false });
    svg.addEventListener("dblclick", handleDblClick);
    svg.addEventListener("pointerenter", handlePointerEnter);
    svg.addEventListener("pointerleave", handleSvgPointerLeave);

    let lastTime = performance.now();
    let raf = null;

    const tick = () => {
      raf = requestAnimationFrame(tick);

      const now = performance.now();
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      simTime += dt;

      if (!reduceMotionRef.current) {
        const subDt = dt / SUBSTEPS;
        for (let s = 0; s < SUBSTEPS; s++) step(subDt);
      }

      // The stirring rod's own frame (see the STIR_RADIUS constant block):
      // the pool streaks under the moving rod — the stir's whole visual
      // feedback, energy scaled by dt so it tracks distance traveled the
      // same way the node wakes do — and paddle speed decays on its short
      // time constant, snapping to a clean zero once spent (the same
      // shutoff discipline PAN_MOMENTUM_STOP keeps) so step()'s own
      // residual-speed gate actually closes.
      if (stir.vx !== 0 || stir.vy !== 0) {
        const stirSpeed = Math.hypot(stir.vx, stir.vy);
        if (stir.active && stirSpeed > 1) {
          ink?.splash(stir.x, stir.y, Math.min(STIR_WAKE_MAX, stirSpeed * STIR_WAKE_GAIN * dt));
        }
        const stirDecay = Math.exp(-dt / STIR_DECAY_TAU);
        stir.vx *= stirDecay;
        stir.vy *= stirDecay;
        if (stirSpeed < 2) {
          stir.vx = 0;
          stir.vy = 0;
        }
      }

      // Fire whatever signal-ping events have come due (see startPing
      // above) — each edge arrival is a genuine pluck (ring-down, pool
      // tap, endpoint resonance skipped on purpose: the front should
      // sweep the graph, not shove it around), each node arrival a jelly
      // pulse and a splash. A whole hop shell lands within one frame, so
      // its plucks voice together as a receding chord.
      if (ping.head < ping.events.length && !reduceMotionRef.current) {
        ping.elapsed += dt;
        while (ping.head < ping.events.length && ping.events[ping.head].t <= ping.elapsed) {
          const event = ping.events[ping.head++];
          if (event.type === "node") {
            const node = byId.get(event.id);
            if (node) {
              node.pingPulse = Math.max(node.pingPulse, PING_NODE_PULSE * event.factor);
              ink?.splash(node.x, node.y, PING_NODE_SPLASH * event.factor);
            }
          } else {
            const { edge } = event;
            const a = byId.get(edge.a);
            const b = byId.get(edge.b);
            const amp = Math.min(PLUCK_MAX_AMP - edge.vibAmp, PING_EDGE_AMP * event.factor);
            if (amp > 0) {
              // The front floods the whole thread at once — no single
              // pluck point, so it takes the centered, fundamental-heavy
              // voicing (see pluckEdge).
              const bright = pluckEdge(edge, amp, 0.5);
              ink?.splash((a.x + b.x) / 2, (a.y + b.y) / 2, amp * INK_PLUCK_GAIN);
              if (amp > PLUCK_SOUND_MIN_AMP) {
                playThreadPluck(pluckFrequency(Math.hypot(b.x - a.x, b.y - a.y) * renderScale), amp / PLUCK_MAX_AMP, stereoPanAt((a.x + b.x) / 2), bright);
              }
            }
          }
        }
        if (ping.head >= ping.events.length) {
          ping.events = [];
          ping.head = 0;
        }
      }

      const rect = svg.getBoundingClientRect();
      const scaleX = rect.width / DOMAIN_W;
      const scaleY = rect.height / DOMAIN_H;
      // Read by step()'s own collision resolution — see renderScale's own
      // declaration above for why one frame of staleness there is fine.
      renderScale = Math.min(scaleX, scaleY);
      // The stereo field's own yardstick (see stereoPanAt) — same
      // one-frame-stale-at-worst contract as renderScale.
      panRectW = rect.width;

      // The toss's own frame (see the TOSS_GRAVITY constant block) —
      // advance matter-js by a fixed 1000/60ms step (the same convention
      // Pile/NotePile.jsx's own matter-js loop already uses, rather than
      // this file's own variable dt: matter-js's solver is tuned for a
      // steady timestep, and a toss is a few-second flourish where that
      // small a mismatch against real elapsed time is never worth
      // noticing), then read every body's position and velocity straight
      // back into its node — converted out of world-pixel space here the
      // exact same way it was converted in at toss-start — so the whole
      // rest of this file (the render loop right below, the jelly
      // squash/wobble it reads speed and impact from, the ink wake) sees
      // a tossed node exactly like it would see any other moving one,
      // with no idea matter-js is the one currently driving it.
      if (toss.active) {
        Matter.Engine.update(toss.engine, 1000 / 60);

        let totalSpeed = 0;
        toss.bodies.forEach((body, id) => {
          const node = byId.get(id);
          if (!node) return;
          node.x = body.position.x / scaleX;
          node.y = body.position.y / scaleY;
          node.vx = (body.velocity.x / scaleX) * 60;
          node.vy = (body.velocity.y / scaleY) * 60;
          totalSpeed += Math.hypot(body.velocity.x, body.velocity.y);
        });

        const avgSpeed = toss.bodies.size > 0 ? totalSpeed / toss.bodies.size : 0;
        if (simTime > toss.endAt || avgSpeed < TOSS_SETTLE_SPEED) {
          // Handing back — clear the tossed flag first, so the very next
          // step() call (already about to run next frame) picks every
          // note back up into whichever law is currently active, exactly
          // wherever the bounce left it.
          toss.bodies.forEach((body, id) => {
            const node = byId.get(id);
            if (node) node.tossed = false;
          });
          Matter.Events.off(toss.engine, "collisionStart", toss.handleCollision);
          Matter.World.clear(toss.engine.world, false);
          Matter.Engine.clear(toss.engine);
          toss.engine = null;
          toss.bodies.clear();
          toss.active = false;
        }
      }

      // Sonar fronts (see the SONAR_SPEED constant block) — each advances
      // at the wave speed, plucks every thread its annulus swept over
      // THIS frame (prevR < distance ≤ r — the same last-frame/this-frame
      // crossing discipline throughout this file), pulses every note it
      // passes, and dies at the rim. Fronts still in flight when reduced
      // motion flips on mid-session are simply cleared — a frozen ring
      // would outstay the preference it violates.
      if (sonars.length > 0) {
        if (reduceMotionRef.current) {
          for (const front of sonars) {
            sonarRingRefs.current[front.slot]?.setAttribute("opacity", "0");
            sonarFreeSlots.push(front.slot);
          }
          sonars.length = 0;
        }
        for (let s = sonars.length - 1; s >= 0; s--) {
          const front = sonars[s];
          front.prevR = front.r;
          front.r += SONAR_SPEED * dt;
          const energy = 1 - front.r / SONAR_MAX_R;
          const ringEl = sonarRingRefs.current[front.slot];

          if (energy <= 0) {
            if (ringEl) ringEl.setAttribute("opacity", "0");
            sonarFreeSlots.push(front.slot);
            sonars.splice(s, 1);
            continue;
          }

          if (ringEl) {
            ringEl.setAttribute("cx", front.x * scaleX);
            ringEl.setAttribute("cy", front.y * scaleY);
            ringEl.setAttribute("rx", front.r * scaleX);
            ringEl.setAttribute("ry", front.r * scaleY);
            ringEl.setAttribute("opacity", (energy * SONAR_RING_OPACITY).toFixed(3));
          }

          for (const edge of edgeList) {
            const a = byId.get(edge.a);
            const b = byId.get(edge.b);
            const d = pointSegDist(front.x, front.y, a.x, a.y, b.x, b.y);
            if (d <= front.prevR || d > front.r) continue;
            const amp = Math.min(PLUCK_MAX_AMP - edge.vibAmp, SONAR_PLUCK_AMP * energy);
            if (amp <= 0) continue;
            // The front touches a chord first at the tap's own projection
            // onto it — that closest point is the honest pluck point, so
            // a front grazing a thread's end rings it brighter than one
            // meeting a thread broadside.
            const chordX = b.x - a.x;
            const chordY = b.y - a.y;
            const chordLenSq = chordX * chordX + chordY * chordY || 1;
            const frontP = ((front.x - a.x) * chordX + (front.y - a.y) * chordY) / chordLenSq;
            const bright = pluckEdge(edge, amp, frontP);
            ink?.splash((a.x + b.x) / 2, (a.y + b.y) / 2, amp * INK_PLUCK_GAIN);
            // With sounds on, the front voices each thread as it arrives
            // — a radial arpeggio ordered by true distance from the tap,
            // swept across the stereo field by where each thread actually
            // hangs, where the signal ping's chords land in hop order.
            if (amp > PLUCK_SOUND_MIN_AMP) {
              playThreadPluck(pluckFrequency(Math.sqrt(chordLenSq) * renderScale), amp / PLUCK_MAX_AMP, stereoPanAt((a.x + b.x) / 2), bright);
            }
          }

          byId.forEach((node) => {
            const d = Math.hypot(node.x - front.x, node.y - front.y);
            if (d <= front.prevR || d > front.r) return;
            node.pingPulse = Math.max(node.pingPulse, SONAR_NODE_PULSE * energy);
            ink?.splash(node.x, node.y, SONAR_NODE_SPLASH * energy);
          });
        }
      }

      // The pan's own momentum plus the elastic boundary spring (see the
      // BOUNDARY_FREE_RANGE module comment for the full reasoning) —
      // active once a pan drag has released (reduced motion already
      // zeroed the velocity at release, see handleUp, so this naturally
      // never runs there) and no reset tween currently owns the camera.
      if (!panDrag.active && !cameraAnimating) {
        // "Ideal" = whatever camera position centers the graph's own
        // content in the current viewport at the current zoom.
        const idealX = rect.width / 2 - (DOMAIN_W / 2) * scaleX * camera.zoom;
        const idealY = rect.height / 2 - (DOMAIN_H / 2) * scaleY * camera.zoom;
        const driftX = camera.x - idealX;
        const driftY = camera.y - idealY;
        const driftDist = Math.hypot(driftX, driftY);
        const freeRange = Math.max(rect.width, rect.height) * BOUNDARY_FREE_RANGE;
        const outOfRange = driftDist > freeRange;

        if (outOfRange) {
          // The nearest point still inside the free range, not all the way
          // back to dead-center — the spring pulls back to the boundary's
          // own edge, the same way a real rubber band only resists past
          // its own slack, not all the way to its anchor.
          const targetX = idealX + (driftX / driftDist) * freeRange;
          const targetY = idealY + (driftY / driftDist) * freeRange;
          camera.vx += -(camera.x - targetX) * BOUNDARY_STIFFNESS * dt;
          camera.vy += -(camera.y - targetY) * BOUNDARY_STIFFNESS * dt;
        }

        if (outOfRange || camera.vx !== 0 || camera.vy !== 0) {
          camera.x += camera.vx * dt;
          camera.y += camera.vy * dt;
          camera.vx *= PAN_MOMENTUM_DAMPING;
          camera.vy *= PAN_MOMENTUM_DAMPING;
          // Only ever snapped fully to rest inside the free range — outside
          // it, the spring above still has real pulling-back left to do
          // even at a momentarily small velocity (e.g. right at the peak
          // of an overshoot), and zeroing it there would strand the camera
          // outside the boundary instead of letting it finish settling.
          if (!outOfRange && Math.hypot(camera.vx, camera.vy) < PAN_MOMENTUM_STOP) {
            camera.vx = 0;
            camera.vy = 0;
          }
        }

        // The idle-drift cruise (see the IDLE_DELAY_MS constant block) —
        // nested inside the same "no drag, no tween owns the camera"
        // guard as the spring above, plus its own idle clock and a
        // mid-node-drag check (a held-still node drag is not idleness).
        // The breathing zoom is anchored at the viewport center — the
        // same solve-for-the-fixed-point math the wheel zoom uses, with
        // the anchor at center instead of the cursor — and the Lissajous
        // targets sit well inside BOUNDARY_FREE_RANGE, so the cruise and
        // the boundary spring never contradict each other.
        if (!reduceMotionRef.current && !drag.id && now - lastInputTime > IDLE_DELAY_MS) {
          driftT += dt;

          const zoomTarget = DRIFT_ZOOM + Math.sin(driftT * 0.09) * DRIFT_ZOOM_AMP;
          const nextZoom = camera.zoom + (zoomTarget - camera.zoom) * DRIFT_EASE;
          camera.x = rect.width / 2 - (rect.width / 2 - camera.x) * (nextZoom / camera.zoom);
          camera.y = rect.height / 2 - (rect.height / 2 - camera.y) * (nextZoom / camera.zoom);
          camera.zoom = nextZoom;

          // "Ideal" recomputed at the fresh zoom rather than reusing the
          // spring's value from before the breath moved it.
          const idealDriftX = rect.width / 2 - (DOMAIN_W / 2) * scaleX * camera.zoom;
          const idealDriftY = rect.height / 2 - (DOMAIN_H / 2) * scaleY * camera.zoom;
          const tx = idealDriftX + (Math.sin(driftT * 0.21) + 0.5 * Math.sin(driftT * 0.13)) * rect.width * DRIFT_AMP;
          const ty = idealDriftY + Math.cos(driftT * 0.17) * rect.height * DRIFT_AMP;
          camera.x += (tx - camera.x) * DRIFT_EASE;
          camera.y += (ty - camera.y) * DRIFT_EASE;
        }
      }

      // The rotate spring (see ROTATE_SPRING_STIFFNESS) — pan and tilt are
      // independent axes, so this runs on its own condition rather than
      // nesting inside the pan/boundary block above: gated only on the one
      // thing that actually owns rot moment to moment, a live two-finger
      // twist, not on panDrag/cameraAnimating, which have no say over it.
      if (!pinch.active && (camera.rot !== 0 || camera.vrot !== 0)) {
        camera.vrot += -camera.rot * ROTATE_SPRING_STIFFNESS * dt;
        camera.rot += camera.vrot * dt;
        camera.vrot *= ROTATE_SPRING_DAMPING;
        if (Math.abs(camera.rot) < ROTATE_SNAP_EPS && Math.abs(camera.vrot) < ROTATE_SNAP_EPS) {
          camera.rot = 0;
          camera.vrot = 0;
        }
      }
      // The impact shake rides the transform write alone (see the SHAKE
      // constants) — camera.x/y themselves never see it, so every
      // unprojection and the minimap stay honest.
      let shakeX = 0;
      let shakeY = 0;
      if (shake.amp > 0.05) {
        shake.amp *= Math.exp(-SHAKE_DECAY * dt);
        shakeX = Math.sin(simTime * 71) * shake.amp;
        shakeY = Math.cos(simTime * 89) * shake.amp * 0.7;
      } else {
        shake.amp = 0;
      }
      if (worldGroupRef.current) {
        // rotate(...) pivots on the viewport's own center in world-pixel
        // space (see ROTATE_SPRING_STIFFNESS) — SVG's own transform-list
        // order applies it first, before scale/translate, exactly matching
        // rotateAroundPivot's math, so every unprojection built on that
        // helper stays the true inverse of what's actually on screen.
        const rotDeg = (camera.rot * 180) / Math.PI;
        worldGroupRef.current.setAttribute("transform", `translate(${ camera.x + shakeX },${ camera.y + shakeY }) scale(${ camera.zoom }) rotate(${ rotDeg },${ rect.width / 2 },${ rect.height / 2 })`);
      }

      // The parallax head eases toward wherever the pointer currently
      // is (see the PARALLAX_GAIN constant block) — under reduced motion
      // the targets are never set, so this settles at exactly zero and
      // every dispX/dispY below degenerates to the true position.
      parallax.x += (parallax.tx - parallax.x) * PARALLAX_EASE;
      parallax.y += (parallax.ty - parallax.y) * PARALLAX_EASE;

      // The fisheye's engagement swells toward on/off (see the FISHEYE
      // constants) — a live subject is part of the target, so losing it
      // relaxes the whole distortion rather than freezing it around a
      // last known position. The subject is the pointer when it's in the
      // water, else the keyboard's focus swimmer — magnify finally works
      // for the visitor who never touches the mouse, the lens riding
      // wherever the swimmer last settled (one frame behind its own
      // chase, invisibly).
      const fisheyeHasSubject = cursorField.active || !!focusIdRef.current;
      const fisheyeTarget = magnifyRef.current && fisheyeHasSubject && !reduceMotionRef.current ? 1 : 0;
      fisheye.amp += (fisheyeTarget - fisheye.amp) * FISHEYE_EASE;
      // The focus and reach, in world-pixel space — a circle in world
      // space stays a circle on screen (the camera scales uniformly), so
      // dividing the screen-space radius by zoom is the whole conversion.
      const fisheyeFocusX = cursorField.active ? cursorField.x * scaleX : swimmer.x;
      const fisheyeFocusY = cursorField.active ? cursorField.y * scaleY : swimmer.y;
      const fisheyeR = FISHEYE_RADIUS / camera.zoom;

      byId.forEach((node, id) => {
        const px = node.x * scaleX;
        const py = node.y * scaleY;
        // The displayed position — true position plus this node's own
        // parallax shift. Stored on the node so every later drawing pass
        // this frame (edges, hulls, hover card) reads the same offset and
        // nothing detaches; physics and the minimap keep using true x/y.
        const depthShift = node.depthFactor * PARALLAX_GAIN;
        let dispX = px + parallax.x * depthShift;
        let dispY = py + parallax.y * depthShift * PARALLAX_VERTICAL;

        // The fisheye displacement (see the FISHEYE constants) — layered
        // onto the parallax offset before dispX/dispY are stored, so
        // every downstream reader (threads, hulls, trails, card, labels)
        // sees the lensed position without knowing the lens exists.
        node.magnifyScale = 1;
        if (fisheye.amp > 0.003) {
          const ldx = dispX - fisheyeFocusX;
          const ldy = dispY - fisheyeFocusY;
          const lr = Math.hypot(ldx, ldy);
          if (lr > 0.0001 && lr < fisheyeR) {
            const t = lr / fisheyeR;
            const displaced = (fisheyeR * (FISHEYE_D + 1) * t) / (FISHEYE_D * t + 1);
            const push = ((displaced - lr) / lr) * fisheye.amp;
            dispX += ldx * push;
            dispY += ldy * push;
            const m = (FISHEYE_D + 1) / ((FISHEYE_D * t + 1) * (FISHEYE_D * t + 1));
            node.magnifyScale = 1 + (Math.sqrt(m) - 1) * FISHEYE_NODE_GAIN * fisheye.amp;
          }
        }

        node.dispX = dispX;
        node.dispY = dispY;
        const speed = Math.hypot(node.vx, node.vy);

        // The ping pulse's own ring-down (see the PING_HOP_INTERVAL
        // constant block) — a plain exponential release with the same
        // snap-to-zero shutoff every other decaying quantity here uses.
        // Stays 0 forever under reduced motion, since startPing never runs.
        if (node.pingPulse > 0) {
          node.pingPulse = node.pingPulse > 0.003 ? node.pingPulse * Math.exp(-PING_PULSE_RELEASE * dt) : 0;
        }

        const el = nodeElRefs.current[id];
        if (el) {
          const scale = (node.revealScale ?? 1) * (node.hoverScale ?? 1) * (1 + node.pingPulse) * (node.magnifyScale ?? 1);

          // Jelly squash & stretch (see the SQUASH_GAIN constant block) —
          // R(θ)·S·R(−θ), an area-preserving stretch along the motion
          // axis. The axis freezes at its last meaningful heading when the
          // node is near rest (a near-zero velocity has no direction worth
          // reading), which is also what lets the impact wobble keep
          // ringing along the axis the collision actually happened on.
          let deform = "";
          if (!reduceMotionRef.current) {
            if (speed > 1) node.stretchAngle = Math.atan2(node.vy, node.vx);
            const stretchTarget = 1 + Math.min(SQUASH_MAX, (speed * SQUASH_GAIN) / node.mass);
            node.stretch += (stretchTarget - node.stretch) * SQUASH_EASE;

            if (node.impact > 0.01) {
              node.wobbleAmp = Math.min(WOBBLE_MAX, node.wobbleAmp + (node.impact * WOBBLE_GAIN) / node.mass);

              // A landing worth hearing squirts ink at the contact (see
              // the IMPACT_SPLASH constants) — independent of the thud's
              // own cooldowns: the pool doesn't care how recently it was
              // last splashed — and knocks the view itself (see the
              // SHAKE constants), amplitude from how far past the
              // threshold the hit actually landed.
              if (node.impact > THUD_MIN_IMPACT) {
                ink?.splash(node.x, node.y, Math.min(IMPACT_SPLASH_MAX, node.impact * IMPACT_SPLASH_GAIN));
                shake.amp = Math.min(SHAKE_MAX, shake.amp + (node.impact - THUD_MIN_IMPACT) * SHAKE_GAIN);
              }

              // The audible half of the same impact (see the THUD
              // constants) — quiet during annealing (temperature > 0
              // means a migration or reshuffle is mid-flight, one event
              // rather than fifty landings) and through the opening
              // bloom, then throttled per node and desk-wide.
              if (node.impact > THUD_MIN_IMPACT
                && simTime > 1.5
                && temperature === 0
                && simTime - node.lastThud > THUD_COOLDOWN
                && simTime - lastThudTime > THUD_GLOBAL_GAP) {
                node.lastThud = simTime;
                lastThudTime = simTime;
                playImpact(Math.min(1, node.impact / THUD_REF_IMPACT) * THUD_LEVEL, stereoPanAt(node.x));
              }
            }
            node.impact = 0;

            let wobble = 0;
            if (node.wobbleAmp > WOBBLE_MIN) {
              node.wobblePhase += WOBBLE_OMEGA * dt;
              node.wobbleAmp *= Math.exp(-WOBBLE_DECAY * dt);
              wobble = node.wobbleAmp * Math.sin(node.wobblePhase);
            } else {
              node.wobbleAmp = 0;
            }

            const deformScale = Math.max(0.6, node.stretch + wobble);
            if (Math.abs(deformScale - 1) > 0.004) {
              const deg = (node.stretchAngle * 180) / Math.PI;
              deform = ` rotate(${ deg }) scale(${ deformScale },${ 1 / deformScale }) rotate(${ -deg })`;
            }
          }

          el.setAttribute("transform", `translate(${ dispX },${ dispY }) scale(${ scale })${ deform }`);
        }

        // The pendulum label (see the LABEL_HANG constant block) — one
        // verlet point under gravity, tethered to the node's displayed
        // position by a rigid distance constraint; the label's offset and
        // tilt both read straight off where the point actually hangs.
        // Created lazily on first sight since the rest length needs
        // radiusPx, and rendered as a static hang under reduced motion.
        const labelEl = labelElRefs.current[id];
        if (labelEl) {
          const rest = node.radiusPx + LABEL_HANG;
          if (reduceMotionRef.current) {
            labelEl.setAttribute("transform", `translate(0,${ rest })`);
          } else {
            if (!node.labelP) node.labelP = createPoint(dispX, dispY + rest);
            // The same ambient current every node already feels (see the
            // CURRENT_STRENGTH constant block) reaches the label's own
            // tether too, at a much lighter gain — a note can sit
            // perfectly still while the tag hanging off it still sways,
            // the way a light tag catches air a heavier body wouldn't.
            const labelFlow = curlNoise2(node.x / CURRENT_SCALE, node.y / CURRENT_SCALE, simTime * CURRENT_TIME_SCALE);
            integratePoint(node.labelP, dt, labelFlow.x * LABEL_CURRENT_GAIN, LABEL_GRAVITY, LABEL_DAMPING);
            labelAnchor.x = dispX;
            labelAnchor.y = dispY;
            satisfyConstraint(labelAnchor, node.labelP, rest);
            const ox = node.labelP.x - dispX;
            const oy = node.labelP.y - dispY;
            // Tilt from the tether's own angle off vertical — the rotation
            // that keeps the label hanging along its string.
            const swingDeg = (-Math.atan2(ox, oy) * 180) / Math.PI;
            labelEl.setAttribute("transform", `translate(${ ox },${ oy }) rotate(${ swingDeg.toFixed(2) })`);
          }
        }

        // The breathing silhouette (see the BREATH_AMP constant block) —
        // skipped while the hover morph owns this node's path (flubber
        // mid-flight, drive.t > 0), resumed the moment it fully lets go.
        // Contact dimples ease first (see the DIMPLE constants): each
        // dent chases the target the LAST frame's contact pass recorded,
        // then the targets rezero for the pass that runs later this
        // frame — attack fast, release like pressed flesh.
        if (!reduceMotionRef.current) {
          if (node.dents) {
            for (let di = 0; di < node.dents.length; di++) {
              const dentTarget = node.dentTargets[di];
              node.dents[di] += (dentTarget - node.dents[di]) * (dentTarget > node.dents[di] ? DIMPLE_ATTACK : DIMPLE_RELEASE);
              node.dentTargets[di] = 0;
            }
          }

          // Spin (see the SPIN constants): the angular velocity chases
          // the flow's own local rotation — ζ by central differences
          // over the same field the drift forces read — with the chase's
          // ease doubling as the contact kicks' ring-down, then the
          // silhouette turns about its own center.
          const flowR = curlNoise2((node.x + SPIN_VORTICITY_STEP) / CURRENT_SCALE, node.y / CURRENT_SCALE, simTime * CURRENT_TIME_SCALE);
          const flowL = curlNoise2((node.x - SPIN_VORTICITY_STEP) / CURRENT_SCALE, node.y / CURRENT_SCALE, simTime * CURRENT_TIME_SCALE);
          const flowD = curlNoise2(node.x / CURRENT_SCALE, (node.y + SPIN_VORTICITY_STEP) / CURRENT_SCALE, simTime * CURRENT_TIME_SCALE);
          const flowU = curlNoise2(node.x / CURRENT_SCALE, (node.y - SPIN_VORTICITY_STEP) / CURRENT_SCALE, simTime * CURRENT_TIME_SCALE);
          const vorticity = (flowR.y - flowL.y) - (flowD.x - flowU.x);
          node.omega += (vorticity * SPIN_VORTICITY_GAIN - node.omega) * SPIN_VORTICITY_EASE;
          node.omega = Math.max(-SPIN_MAX, Math.min(SPIN_MAX, node.omega));
          node.rot += node.omega * dt;

          const shapes = shapeCacheRef.current.get(id);
          const blobEl = blobPathElRefs.current[id];
          const morphEntry = blobMorphers.get(id);
          if (shapes && blobEl) {
            blobEl.setAttribute(
              "transform",
              `translate(${ shapes.offset },${ shapes.offset }) rotate(${ ((node.rot * 180) / Math.PI).toFixed(2) } ${ shapes.radius } ${ shapes.radius })`
            );
            if (!morphEntry || morphEntry.drive.t <= 0.001) {
              blobEl.setAttribute("d", breathingBlobPath(shapes.radius, shapes.anchors, simTime, node.dents));
            }
          }
        }

        // The minimap's own dot for this same node — plain domain-space
        // x/y (see the MINIMAP_WIDTH module comment on why this view needs
        // no scale conversion of its own).
        const dot = minimapDotRefs.current[id];
        if (dot) {
          dot.setAttribute("cx", node.x);
          dot.setAttribute("cy", node.y);
        }

        // The ink comet trail (see the TRAIL_LENGTH constant block) —
        // history recorded every frame regardless of speed (a buffer that
        // only fills while fast would open with a straight jump from
        // wherever recording last stopped), amplitude eased toward
        // whether the node is currently fast enough to deserve one.
        if (!reduceMotionRef.current) {
          // Displayed position, not true — the trail is exhaust behind
          // what the eye actually sees, so it has to share the parallax.
          node.trail.push({ x: dispX, y: dispY });
          if (node.trail.length > TRAIL_LENGTH) node.trail.shift();

          const target = speed > TRAIL_MIN_SPEED ? 1 : 0;
          node.trailAmp += (target - node.trailAmp) * (target ? TRAIL_ATTACK : TRAIL_RELEASE);

          const trailEl = trailElRefs.current[id];
          if (trailEl) {
            if (node.trailAmp > 0.03) {
              trailEl.setAttribute("d", smoothPath(node.trail));
              trailEl.setAttribute("opacity", (node.trailAmp * TRAIL_MAX_OPACITY).toFixed(3));
            } else if (trailEl.getAttribute("d")) {
              trailEl.setAttribute("d", "");
              trailEl.setAttribute("opacity", "0");
            }
          }

          // A fast node also drags a wake through the pool (see the
          // INK_WAKE constants) — splash amount scaled by dt so the wake's
          // total energy tracks distance actually traveled, not frame rate.
          if (speed > INK_WAKE_MIN_SPEED) {
            ink?.splash(node.x, node.y, Math.min(INK_WAKE_MAX, speed * INK_WAKE_GAIN * dt));
          }
        }

        // The favorite's Kepler moon (see the MOON_RADIUS constant block)
        // — polar conic for position, equal-area law for speed. The moon
        // element lives inside the node's own group, so the translate here
        // is purely local; reveal/hover scaling comes along for free.
        if (node.favorite) {
          const moonEl = moonElRefs.current[id];
          if (moonEl) {
            const a = node.radiusPx + MOON_ORBIT_MARGIN;
            const r = (a * (1 - MOON_ECCENTRICITY * MOON_ECCENTRICITY))
              / (1 + MOON_ECCENTRICITY * Math.cos(node.moonAngle));
            // r²·θ̇ = const, normalized so θ̇ = MOON_MEAN_RATE exactly at
            // r = a — held static (angle frozen, position still honest)
            // under reduced motion.
            if (!reduceMotionRef.current) node.moonAngle += MOON_MEAN_RATE * (a / r) * (a / r) * dt;
            const mx = Math.cos(node.moonAngle) * r;
            const my = Math.sin(node.moonAngle) * r * MOON_TILT;
            moonEl.setAttribute("transform", `translate(${ mx },${ my })`);
          }
        }
      });

      // The cluster ink pools (see the HULL_MIN_MEMBERS constant block) —
      // fresh convex hull of each component's live member positions every
      // frame, padded and closed through the same Catmull-Rom ring the
      // node blobs are drawn with. Membership was fixed at build; only
      // the geometry moves.
      for (const cluster of clusterList) {
        const hullEl = hullElRefs.current[cluster.id];
        if (!hullEl) continue;
        const pts = cluster.members.map((memberId) => {
          const member = byId.get(memberId);
          return [member.dispX ?? member.x * scaleX, member.dispY ?? member.y * scaleY];
        });
        const padded = expandHull(convexHull(pts), cluster.pad);
        // Stashed for the double-click cluster dive's own hit test (see
        // handleDblClick) — the exact ring being drawn this frame, so
        // what you click is literally what you saw.
        cluster.lastHull = padded;
        hullEl.setAttribute("d", closedCatmullRomPath(padded));

        // The region name rides the pool's live centroid, counter-scaled
        // by 1/zoom for constant screen size and faded past the overview
        // scales — see the CLUSTER_LABEL constants.
        const labelEl = clusterLabelRefs.current[cluster.id];
        if (labelEl) {
          let sumX = 0;
          let sumY = 0;
          for (const [hx, hy] of padded) { sumX += hx; sumY += hy; }
          const fade = Math.max(0, Math.min(1,
            (CLUSTER_LABEL_FADE_END - camera.zoom) / (CLUSTER_LABEL_FADE_END - CLUSTER_LABEL_FADE_START)));
          labelEl.setAttribute(
            "transform",
            `translate(${ sumX / padded.length },${ sumY / padded.length }) scale(${ 1 / camera.zoom })`
          );
          labelEl.setAttribute("opacity", (CLUSTER_LABEL_OPACITY * fade).toFixed(3));
        }
      }

      // The current streamlines (see the STREAM_COUNT constant block) —
      // advected by the exact same curlNoise2 call, scales, and clock the
      // nodes' own ambient drift reads, plus the stirring rod's reach, so
      // the filaments are a true instrument reading of the field this
      // frame. A tracer that ages out or reaches the domain's edge
      // respawns fresh; a mid-session flip to reduced motion retires
      // every visible filament rather than freezing them.
      if (!reduceMotionRef.current) {
        for (let ti = 0; ti < tracers.length; ti++) {
          const tr = tracers[ti];
          tr.life += dt;
          if (tr.life > tr.maxLife || tr.x < 2 || tr.x > DOMAIN_W - 2 || tr.y < 2 || tr.y > DOMAIN_H - 2) {
            tr.x = 2 + Math.random() * (DOMAIN_W - 4);
            tr.y = 2 + Math.random() * (DOMAIN_H - 4);
            tr.life = 0;
            tr.maxLife = STREAM_LIFE_MIN + Math.random() * STREAM_LIFE_SPAN;
            tr.trail.length = 0;
          }

          const flow = curlNoise2(tr.x / CURRENT_SCALE, tr.y / CURRENT_SCALE, simTime * CURRENT_TIME_SCALE);
          let tvx = flow.x * STREAM_SPEED;
          let tvy = flow.y * STREAM_SPEED;
          if (stir.vx !== 0 || stir.vy !== 0) {
            const sdx = tr.x - stir.x;
            const sdy = tr.y - stir.y;
            const sdist = Math.hypot(sdx, sdy);
            if (sdist < STIR_RADIUS) {
              const st = 1 - sdist / STIR_RADIUS;
              const smooth = st * st * (3 - 2 * st);
              tvx += stir.vx * smooth * STREAM_STIR_GAIN;
              tvy += stir.vy * smooth * STREAM_STIR_GAIN;
            }
          }
          tr.x += tvx * dt;
          tr.y += tvy * dt;
          tr.trail.push({ x: tr.x * scaleX, y: tr.y * scaleY });
          if (tr.trail.length > STREAM_TRAIL) tr.trail.shift();

          const streamEl = streamElRefs.current[ti];
          if (streamEl) {
            const fadeIn = Math.min(1, tr.life);
            const fadeOut = Math.min(1, (tr.maxLife - tr.life) / 1.5);
            streamEl.setAttribute("d", smoothPath(tr.trail));
            streamEl.setAttribute("opacity", (Math.max(0, Math.min(fadeIn, fadeOut)) * STREAM_OPACITY).toFixed(3));
          }
        }
      } else {
        for (let ti = 0; ti < tracers.length; ti++) {
          const streamEl = streamElRefs.current[ti];
          if (streamEl && streamEl.getAttribute("opacity") !== "0") {
            streamEl.setAttribute("d", "");
            streamEl.setAttribute("opacity", "0");
          }
          tracers[ti].trail.length = 0;
        }
      }

      // The Voronoi territories (see the VORONOI constant block) — the
      // full tessellation of the desk, re-derived from scratch every
      // frame while the overlay is on: sites are the same displayed
      // positions the eye sees, the box is the domain's own world-pixel
      // extent, and the walls land wherever the bisectors say. Off, the
      // layer just fades by CSS over its last frame's geometry.
      if (territoriesRef.current) {
        const sites = [];
        byId.forEach((node, nodeId) => {
          sites.push({ id: nodeId, x: node.dispX ?? node.x * scaleX, y: node.dispY ?? node.y * scaleY });
        });
        const cells = voronoiCells(sites, 0, 0, rect.width, rect.height);
        for (let ci = 0; ci < sites.length; ci++) {
          const cellEl = voronoiElRefs.current[sites[ci].id];
          if (!cellEl) continue;
          const poly = cells[ci];
          cellEl.setAttribute(
            "d",
            poly.length > 2 ? `M ${ poly.map((p) => `${ p[0] } ${ p[1] }`).join(" L ") } Z` : ""
          );
        }
      }

      // The orrery's orbit guides (see the LAYOUT_MODES block) — each
      // ellipse carries its own static domain-space geometry from the
      // build (focus at the local origin, center offset −a·e down the
      // major axis, the ecliptic squash baked into ry); all that moves
      // per frame is the frame itself: translate to the focus's displayed
      // position, the domain→pixel scale, then the plane's rotation —
      // the exact affine chain the physics targets go through, so the
      // guide IS the path its planet is being asked to fly. vector-effect
      // keeps the hairline honest under both that non-uniform scale and
      // the camera zoom (the minimap viewport's own trick). Touched only
      // while the orrery is the active law; the CSS fade walks the layer
      // out over the last frame's geometry.
      if (modeRef.current === "orrery") {
        for (const o of orbitsForState) {
          const guideEl = orbitGuideRefs.current[o.id];
          if (!guideEl) continue;
          const orbit = byId.get(o.id)?.orbit;
          const focus = orbit?.primaryId ? byId.get(orbit.primaryId) : null;
          const focusX = focus ? (focus.dispX ?? focus.x * scaleX) : cx * scaleX;
          const focusY = focus ? (focus.dispY ?? focus.y * scaleY) : cy * scaleY;
          guideEl.setAttribute(
            "transform",
            `translate(${ focusX },${ focusY }) scale(${ scaleX },${ scaleY }) rotate(${ o.planeDeg })`
          );
        }
      }

      // The strata's shelf furniture (see the LAYOUT_MODES block) — wash
      // bands spanning the domain's full world width, month lettering at
      // the left margin counter-scaled by 1/zoom exactly like the cluster
      // region names.
      if (modeRef.current === "strata") {
        strataForState.forEach((band, bandIndex) => {
          const bandEl = strataBandRefs.current[bandIndex];
          if (bandEl) {
            bandEl.setAttribute("x", 0);
            bandEl.setAttribute("width", rect.width);
            bandEl.setAttribute("y", (band.y - band.halfH) * scaleY);
            bandEl.setAttribute("height", band.halfH * 2 * scaleY);
          }
          const bandLabelEl = strataLabelRefs.current[bandIndex];
          if (bandLabelEl) {
            bandLabelEl.setAttribute("transform", `translate(12,${ band.y * scaleY }) scale(${ 1 / camera.zoom })`);
          }
        });
      }

      // The spectrum wheel's own furniture (see the SPECTRUM_COLOR_ORDER
      // constant block) — center and radii converted to world-pixel space
      // once per frame (see spectrumWedgePath's own comment on why this
      // needs explicit x/y semi-axes rather than one radius), then every
      // sector reuses that same pair. Labels sit just past the outer edge
      // of their own wedge, at its center angle, counter-scaled by
      // 1/zoom exactly like the strata labels and cluster region names.
      if (modeRef.current === "spectrum") {
        const wheelCx = cx * scaleX;
        const wheelCy = cy * scaleY;
        const aspect = DOMAIN_H / DOMAIN_W;
        const outerRx = (SPECTRUM_RADIUS + SPECTRUM_RADIUS_JITTER + SPECTRUM_OUTER_PAD) * scaleX;
        const outerRy = (SPECTRUM_RADIUS + SPECTRUM_RADIUS_JITTER + SPECTRUM_OUTER_PAD) * aspect * scaleY;
        const innerRx = SPECTRUM_INNER_RADIUS * scaleX;
        const innerRy = SPECTRUM_INNER_RADIUS * aspect * scaleY;
        const labelRx = outerRx + 14;
        const labelRy = outerRy + 14 * aspect;

        SPECTRUM_SECTORS.forEach((sector, i) => {
          const wedgeEl = spectrumWedgeRefs.current[i];
          if (wedgeEl) {
            wedgeEl.setAttribute(
              "d",
              spectrumWedgePath(wheelCx, wheelCy, innerRx, innerRy, outerRx, outerRy, sector.startAngle, sector.endAngle)
            );
          }
          const labelEl = spectrumLabelRefs.current[i];
          if (labelEl) {
            const lx = wheelCx + Math.cos(sector.centerAngle) * labelRx;
            const ly = wheelCy + Math.sin(sector.centerAngle) * labelRy;
            labelEl.setAttribute("transform", `translate(${ lx },${ ly }) scale(${ 1 / camera.zoom })`);
          }
        });
      }

      // Mass wells (see the WELL_GAIN constant block) — cast before this
      // frame's own wave-equation step, the same "apply the forcing term,
      // then integrate" order the file already reasons about for driven
      // fields. Excite amount is negative (a trough) and scaled by dt, so
      // total well depth tracks elapsed time rather than frame rate, the
      // same discipline INK_WAKE_GAIN's own splash already keeps.
      if (ink) {
        byId.forEach((node) => {
          const excess = node.mass - 1;
          if (excess > 0.01) ink.splash(node.x, node.y, -WELL_GAIN * excess * dt);
        });
      }

      // The liquid ink surface's own frame (see the INK_WAKE constants):
      // one wave-equation step (dt already clamped at 0.05 above, safely
      // inside the CFL bound inkSurface.js derives), an ink-color refresh
      // if the theme flipped since last frame, then the shader pass aimed
      // at wherever the camera currently is.
      if (ink) {
        ink.step(dt);

        // The pool's own voice (see utils/sound.js's updatePoolVoice) —
        // read right after this frame's own wave step, so the energy
        // sonified is never more than one frame stale. Off by default
        // and toggled independently of the sound-enabled setting itself
        // (which updatePoolVoice checks internally, same gate every
        // other cue in this file already answers to) — this only
        // decides whether the constellation is ASKING for the pool's
        // voice at all.
        if (poolVoiceOnRef.current) updatePoolVoice(ink.energy());

        const theme = document.documentElement.getAttribute("data-theme");
        if (theme !== inkTheme) {
          inkTheme = theme;
          inkCssColor = resolveInkColor();
          ink.setInk(inkCssColor);
        }

        ink.render({
          width: rect.width,
          height: rect.height,
          // The shaken camera, not the true one — the pool is world
          // content and a knock moves the whole world together; only
          // the unprojections (input, minimap) read the honest camera.
          cameraX: camera.x + shakeX,
          cameraY: camera.y + shakeY,
          zoom: camera.zoom,
          scaleX,
          scaleY,
          time: simTime,
        });
      }

      // The long-exposure film (see the EXPOSURE constants) — develop,
      // then project: deposits and the fade wash land on the world-space
      // canvas at zoom-1 resolution, and the display canvas just shows
      // that film through the live camera transform every frame.
      {
        const exposureCanvas = exposureCanvasRef.current;
        const wantExposure = exposureRef.current && !reduceMotionRef.current && exposureCanvas;
        if (wantExposure) {
          const W = Math.max(1, Math.round(rect.width));
          const H = Math.max(1, Math.round(rect.height));
          // Fresh film on toggle-on; a resize also rewinds it — the
          // world canvas must be rebuilt at the new extent, and
          // stretching an old exposure would misplace where things had
          // actually been.
          if (!exposureLive || exposureW !== W || exposureH !== H) {
            exposureWorld = document.createElement("canvas");
            exposureWorld.width = W;
            exposureWorld.height = H;
            exposureWctx = exposureWorld.getContext("2d");
            exposureCanvas.width = W;
            exposureCanvas.height = H;
            exposureCtx = exposureCanvas.getContext("2d");
            exposureW = W;
            exposureH = H;
            exposureFrame = 0;
            exposureLive = true;
          }

          exposureFrame += 1;
          if (exposureFrame % EXPOSURE_FADE_EVERY === 0) {
            exposureWctx.globalCompositeOperation = "destination-out";
            exposureWctx.globalAlpha = 1;
            exposureWctx.fillStyle = `rgba(0,0,0,${ EXPOSURE_FADE_ALPHA })`;
            exposureWctx.fillRect(0, 0, W, H);
            exposureWctx.globalCompositeOperation = "source-over";
          }

          exposureWctx.globalAlpha = EXPOSURE_DEPOSIT_ALPHA;
          byId.forEach((node) => {
            exposureWctx.fillStyle = node.colorCss.startsWith("var(") ? inkCssColor : node.colorCss;
            exposureWctx.beginPath();
            exposureWctx.arc(node.x * scaleX, node.y * scaleY, Math.max(1.2, node.radiusPx * EXPOSURE_DOT_FACTOR), 0, Math.PI * 2);
            exposureWctx.fill();
          });
          exposureWctx.globalAlpha = 1;

          exposureCtx.setTransform(1, 0, 0, 1, 0, 0);
          exposureCtx.clearRect(0, 0, W, H);
          // Shaken with the world, like the pool — see the ink.render
          // comment above.
          exposureCtx.setTransform(camera.zoom, 0, 0, camera.zoom, camera.x + shakeX, camera.y + shakeY);
          exposureCtx.drawImage(exposureWorld, 0, 0);
        } else if (exposureLive) {
          // Film off (or reduced motion arrived) — clear the projection
          // so nothing stale ghosts behind the fading CSS.
          exposureCtx?.setTransform(1, 0, 0, 1, 0, 0);
          exposureCtx?.clearRect(0, 0, exposureW, exposureH);
          exposureLive = false;
        }
      }

      // The minimap's own viewport rectangle — the inverse of the main
      // view's forward mapping (domain → world-pixel → camera → screen):
      // each screen corner unprojected back down to the domain-space point
      // currently sitting there.
      if (minimapViewportRef.current) {
        const domX0 = (0 - camera.x) / camera.zoom / scaleX;
        const domY0 = (0 - camera.y) / camera.zoom / scaleY;
        const domX1 = (rect.width - camera.x) / camera.zoom / scaleX;
        const domY1 = (rect.height - camera.y) / camera.zoom / scaleY;
        minimapViewportRef.current.setAttribute("x", Math.min(domX0, domX1));
        minimapViewportRef.current.setAttribute("y", Math.min(domY0, domY1));
        minimapViewportRef.current.setAttribute("width", Math.abs(domX1 - domX0));
        minimapViewportRef.current.setAttribute("height", Math.abs(domY1 - domY0));
      }

      // The fisheye boundary ring — screen space (its element lives
      // outside worldGroupRef), so the cursor's domain position gets the
      // full domain → world-pixel → camera mapping; opacity rides the
      // lens's own eased engagement so it condenses and dissolves with it.
      if (lensRingRef.current) {
        if (fisheye.amp > 0.003 && fisheyeHasSubject) {
          const fisheyeRotated = rotateAroundPivot(fisheyeFocusX, fisheyeFocusY, rect, camera.rot);
          lensRingRef.current.setAttribute("cx", camera.x + fisheyeRotated.x * camera.zoom);
          lensRingRef.current.setAttribute("cy", camera.y + fisheyeRotated.y * camera.zoom);
          lensRingRef.current.setAttribute("opacity", (FISHEYE_RING_OPACITY * fisheye.amp).toFixed(3));
        } else {
          lensRingRef.current.setAttribute("opacity", "0");
        }
      }

      edgeList.forEach((edge, i) => {
        const el = edgeElRefs.current[i];
        if (!el) return;
        const a = byId.get(edge.a);
        const b = byId.get(edge.b);

        // Tension in domain space (where k itself is defined) — how much
        // of the edge's own rest length its actual current distance is
        // already using up, 0 (all slack) to 1 (taut or beyond; anything
        // stretched past rest length just stays fully taut, the same way
        // a real inextensible thread would rather than sagging negatively).
        const restLength = k * EDGE_REST_LENGTH_FACTOR;
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const tension = Math.min(1, dist / restLength);
        const targetK = EDGE_K_SLACK - (EDGE_K_SLACK - EDGE_K_TAUT) * tension;
        edge.displayK += (targetK - edge.displayK) * EDGE_SAG_SMOOTHING;

        // The pluck ring-down (see the PLUCK_OMEGA constant block and
        // pluckEdge): per mode, phase advances at the mode's own
        // frequency and amplitude decays as e^(−λₙ·dt) — the closed-form
        // underdamped envelope, not an eased approximation. Mode n runs
        // at n·ω (a fixed string's exact harmonic ladder) and decays at
        // n·λ (damping rises with frequency — why a real string's ring
        // mellows toward its fundamental as it dies), and each
        // instantaneous displacement hands off to catenaryPath's own
        // sin(nπ·s) spatial shape.
        let wave = 0;
        if (edge.vibAmp > PLUCK_MIN_AMP && !reduceMotionRef.current) {
          edge.vibPhase += PLUCK_OMEGA * dt;
          edge.vibAmp *= Math.exp(-PLUCK_DECAY * dt);
          wave = edge.vibAmp * Math.sin(edge.vibPhase);
        } else {
          edge.vibAmp = 0;
        }
        let wave2 = 0;
        if (edge.vibAmp2 > PLUCK_MIN_AMP && !reduceMotionRef.current) {
          edge.vibPhase2 += 2 * PLUCK_OMEGA * dt;
          edge.vibAmp2 *= Math.exp(-2 * PLUCK_DECAY * dt);
          wave2 = edge.vibAmp2 * Math.sin(edge.vibPhase2);
        } else {
          edge.vibAmp2 = 0;
        }
        let wave3 = 0;
        if (edge.vibAmp3 > PLUCK_MIN_AMP && !reduceMotionRef.current) {
          edge.vibPhase3 += 3 * PLUCK_OMEGA * dt;
          edge.vibAmp3 *= Math.exp(-3 * PLUCK_DECAY * dt);
          wave3 = edge.vibAmp3 * Math.sin(edge.vibPhase3);
        } else {
          edge.vibAmp3 = 0;
        }

        // Displayed endpoints (parallax included) — the thread has to
        // stay tied to the blobs the eye sees, not their true positions.
        const x1 = a.dispX ?? a.x * scaleX, y1 = a.dispY ?? a.y * scaleY;
        const x2 = b.dispX ?? b.x * scaleX, y2 = b.dispY ?? b.y * scaleY;
        if (tow.edge === edge) {
          // The towed thread runs through the hand as two taut halves
          // (see the TOW_GRAB_PX constant block) — one path, two
          // subpaths meeting at the hand's own position (domain × scale,
          // no parallax: the hand is screen truth, not a node). TOW_HALF_K
          // rather than the edge's own displayK — a held rope doesn't
          // sag by its resting tension, it runs as taut as the hand
          // makes it.
          const hx = tow.x * scaleX;
          const hy = tow.y * scaleY;
          el.setAttribute("d",
            `${ catenaryPath(x1, y1, hx, hy, { k: TOW_HALF_K, samples: 6, maxSag: EDGE_MAX_SAG }) } `
            + catenaryPath(hx, hy, x2, y2, { k: TOW_HALF_K, samples: 6, maxSag: EDGE_MAX_SAG }));
          // Any forming droplet hides for the duration — its collected
          // charge survives to reform after release, but its belly is in
          // the hand right now, and there's no honest place to draw it.
          const towDewEl = dewElRefs.current[i];
          if (towDewEl && towDewEl.getAttribute("rx") !== "0") {
            towDewEl.setAttribute("rx", "0");
            towDewEl.setAttribute("ry", "0");
          }
        } else {
          el.setAttribute("d", catenaryPath(x1, y1, x2, y2, {
            k: edge.displayK,
            samples: EDGE_CATENARY_SAMPLES,
            maxSag: EDGE_MAX_SAG,
            wave,
            wave2,
            wave3,
          }));
        }

        // Thread dew (see the DEW_GLOBAL_RATE constant block) — the drop
        // hangs off catenaryBelly with the same k/maxSag/wave the path
        // above was just drawn with, so it rides the visible thread
        // exactly, standing wave included. Stood down while this thread
        // is being towed: its belly is wherever the hand is, and a
        // droplet floating off the true curve would give the trick away.
        const dewEl = dewElRefs.current[i];
        if (dewEl && !reduceMotionRef.current && tow.edge !== edge) {
          const belly = catenaryBelly(x1, y1, x2, y2, { k: edge.displayK, maxSag: EDGE_MAX_SAG, wave, wave3 });
          // Condensation collects only where water actually would: real
          // slack, and a belly genuinely hanging below its own chord
          // (a bowed-up thread — a chord drawn steeply "uphill" — sheds).
          const hangsBelow = belly.y > (y1 + y2) / 2 + 1;
          const slack = 1 - tension;
          if (slack > DEW_MIN_SLACK && hangsBelow) {
            edge.dewCharge = Math.min(1,
              edge.dewCharge + edge.dewRate * dt * ((slack - DEW_MIN_SLACK) / (1 - DEW_MIN_SLACK)));
          }

          // Detachment — a full drop lets go on its own; a good pluck
          // shakes a big-enough one loose early (the ring-down amplitude
          // IS the shake). Needs a free flight slot; a drop with nowhere
          // to fall just clings until one opens.
          const shaken = edge.vibAmp > DEW_SHAKE_AMP && edge.dewCharge > DEW_SHAKE_MIN_CHARGE;
          if ((edge.dewCharge >= 1 || shaken) && hangsBelow && dewFreeSlots.length > 0) {
            fallingDrops.push({
              slot: dewFreeSlots.pop(),
              x: belly.x,
              y: belly.y,
              startY: belly.y,
              vy: 0,
              r: DEW_MAX_RADIUS * Math.sqrt(edge.dewCharge),
            });
            edge.dewCharge = Math.random() * DEW_RESIDUE;
          }

          // Radius by √charge (drop AREA collects linearly), elongating
          // toward detachment the way a real pendant drop necks — the
          // ellipse's top stays anchored to the thread while its bottom
          // reaches down.
          const dewR = DEW_MAX_RADIUS * Math.sqrt(edge.dewCharge);
          if (dewR > 0.4) {
            const dewRy = dewR * (1 + 0.45 * edge.dewCharge * edge.dewCharge);
            dewEl.setAttribute("cx", belly.x);
            dewEl.setAttribute("cy", belly.y + (dewRy - dewR));
            dewEl.setAttribute("rx", dewR);
            dewEl.setAttribute("ry", dewRy);
          } else if (dewEl.getAttribute("rx") !== "0") {
            dewEl.setAttribute("rx", "0");
            dewEl.setAttribute("ry", "0");
          }
        }
      });

      // Dew in flight (see the DEW_GLOBAL_RATE constant block) — plain
      // gravity integration in world pixels until each drop has fallen its
      // fixed distance to the pool's notional surface, where it lands as a
      // splash in the ink (converted back to the domain space the surface
      // simulates in) and a pitched plip through the sound gate — smaller
      // drop, higher plip, real cavity acoustics. Iterated backwards so
      // landing (a splice) can't skip the next drop.
      if (!reduceMotionRef.current) {
        for (let d = fallingDrops.length - 1; d >= 0; d--) {
          const drop = fallingDrops[d];
          drop.vy += DEW_FALL_GRAVITY * dt;
          drop.y += drop.vy * dt;
          const dropEl = dewFallRefs.current[drop.slot];

          if (drop.y - drop.startY >= DEW_FALL_DISTANCE) {
            const size = drop.r / DEW_MAX_RADIUS;
            ink?.splash(drop.x / scaleX, drop.y / scaleY, DEW_SPLASH * size);
            playDrip(DEW_DRIP_FREQ_BASE - DEW_DRIP_FREQ_SPAN * size, 0.2 + 0.5 * size, stereoPanAt(drop.x / scaleX));
            if (dropEl) dropEl.setAttribute("r", "0");
            dewFreeSlots.push(drop.slot);
            fallingDrops.splice(d, 1);
          } else if (dropEl) {
            dropEl.setAttribute("cx", drop.x);
            dropEl.setAttribute("cy", drop.y);
            dropEl.setAttribute("r", drop.r);
          }
        }
      }

      // Liquid bridges (see the BRIDGE_REACH constant block) — an
      // all-pairs surface-gap check over the same displayed positions and
      // rendered radii the eye sees this frame (the plain-distance-compare
      // reasoning the collision pass already established: per-pair work
      // this cheap doesn't earn a quadtree). A pair inside reach condenses
      // a neck; a bridged pair torn past the snap distance breaks with a
      // splash, an impact ring through both jellies, and a wet pop.
      {
        const ids = Array.from(byId.keys());
        for (let i = 0; i < ids.length; i++) {
          const a = byId.get(ids[i]);
          const rA = a.radiusPx * (a.revealScale ?? 1) * (a.hoverScale ?? 1) * (1 + a.pingPulse) * (a.magnifyScale ?? 1);
          for (let j = i + 1; j < ids.length; j++) {
            const b = byId.get(ids[j]);
            const key = pairKey(ids[i], ids[j]);
            const entry = bridges.get(key);

            const rB = b.radiusPx * (b.revealScale ?? 1) * (b.hoverScale ?? 1) * (1 + b.pingPulse) * (b.magnifyScale ?? 1);
            const ax = a.dispX ?? a.x * scaleX;
            const ay = a.dispY ?? a.y * scaleY;
            const bx = b.dispX ?? b.x * scaleX;
            const by = b.dispY ?? b.y * scaleY;
            const gap = Math.hypot(bx - ax, by - ay) - (rA + rB);

            // Contact dimples (see the DIMPLE constants) — both blobs of
            // any pressing pair dent toward each other, targets consumed
            // by next frame's breathing rebuild.
            if (gap < DIMPLE_RANGE && !reduceMotionRef.current) {
              applyDimples(ids[i], a, rA, ax, ay, rB, bx, by);
              applyDimples(ids[j], b, rB, bx, by, rA, ax, ay);
            }

            if (!entry) {
              if (gap < BRIDGE_REACH && bridgeFreeSlots.length > 0) {
                bridges.set(key, { slot: bridgeFreeSlots.pop(), strength: 0, midX: 0, midY: 0 });
              }
              continue;
            }
            // The neck itself, attached inside each blob's own wobbly
            // silhouette (see the BRIDGE_ATTACH comment); maxDist a hair
            // past the snap threshold so the geometry always outlives the
            // decision to break.
            const neck = gap > BRIDGE_SNAP_DIST
              ? null
              : metaballBridge(ax, ay, rA * BRIDGE_ATTACH, bx, by, rB * BRIDGE_ATTACH, {
                maxDist: (rA + rB) * BRIDGE_ATTACH + BRIDGE_SNAP_DIST + 6,
              });

            const pathEl = bridgePathRefs.current[entry.slot];
            if (!neck) {
              // Torn apart — the snap. Impact feeds the same channel
              // collisions ring the jelly through (converted next frame),
              // the splash lands at the neck's last midpoint, and the pop
              // sits an octave-ish under the dew's plip.
              if (pathEl) {
                pathEl.setAttribute("d", "");
                pathEl.setAttribute("opacity", "0");
              }
              bridgeFreeSlots.push(entry.slot);
              bridges.delete(key);
              if (entry.strength > 0.3) {
                a.impact += BRIDGE_SNAP_IMPACT;
                b.impact += BRIDGE_SNAP_IMPACT;
                ink?.splash(entry.midX / scaleX, entry.midY / scaleY, BRIDGE_SNAP_SPLASH);
                // The opening scatter tears whatever necks the spawn
                // crowd briefly condensed — honest physics worth SEEING
                // (ink pulling apart into droplets is exactly the right
                // opening image), but a half-dozen simultaneous pops is
                // not worth HEARING; the pop waits out the bloom.
                if (simTime > 1.5) playDrip(BRIDGE_SNAP_FREQ, 0.6, stereoPanAt(entry.midX / scaleX));
              }
              continue;
            }

            entry.strength += (1 - entry.strength) * BRIDGE_ATTACK;
            entry.midX = (ax + bx) / 2;
            entry.midY = (ay + by) / 2;

            if (pathEl) {
              pathEl.setAttribute("d", neck);
              pathEl.setAttribute("opacity", (entry.strength * BRIDGE_OPACITY).toFixed(3));
            }
            const gradEl = bridgeGradRefs.current[entry.slot];
            if (gradEl) {
              gradEl.setAttribute("x1", ax);
              gradEl.setAttribute("y1", ay);
              gradEl.setAttribute("x2", bx);
              gradEl.setAttribute("y2", by);
            }
            // stop-color through style rather than the presentation
            // attribute — the fallback colorCss can be a var(), which
            // attribute values don't resolve but inline styles do.
            const stopA = bridgeStopARefs.current[entry.slot];
            const stopB = bridgeStopBRefs.current[entry.slot];
            if (stopA) stopA.style.stopColor = a.colorCss;
            if (stopB) stopB.style.stopColor = b.colorCss;
          }
        }
      }

      // The hover card follows its node every frame, since the graph keeps
      // moving underneath it — clamped to the stage's own bounds the same
      // way HistoryConstellation.jsx's own hover label already is. The
      // card itself lives outside worldGroupRef (it's a plain positioned
      // div, not SVG content the camera transform already applies to), so
      // its own screen position has to fold that transform in by hand —
      // world-pixel position first, then the same translate+scale the
      // camera applies to everything else in the graph.
      if (hoveredIdRef.current) {
        const node = byId.get(hoveredIdRef.current);
        const card = cardElRef.current;
        if (node && card) {
          const worldPixelX = node.dispX ?? node.x * scaleX;
          const worldPixelY = node.dispY ?? node.y * scaleY;
          const rotated = rotateAroundPivot(worldPixelX, worldPixelY, rect, camera.rot);
          const screenX = camera.x + rotated.x * camera.zoom;
          const screenY = camera.y + rotated.y * camera.zoom;
          const px = Math.min(Math.max(screenX, 90), rect.width - 90);
          const py = Math.max(screenY, 70);
          card.style.transform = `translate(${ px }px, ${ py }px) translate(-50%, -125%)`;
        }
      }

      // The aim line (see the AIM_STEPS constant block) — a ghost of the
      // held note integrated forward through the frozen world: the same
      // repulsion, the active law's own forces, the same damping and
      // mass. Points carry the held note's current parallax offset so
      // the filament stays attached to the blob the eye actually sees.
      if (aimPathRef.current) {
        const held = drag.id ? byId.get(drag.id) : null;
        const heldSpeed = held ? Math.hypot(held.vx, held.vy) : 0;
        const aimTarget = held && !reduceMotionRef.current && heldSpeed > AIM_MIN_SPEED ? 1 : 0;
        aimAmp += (aimTarget - aimAmp) * 0.18;

        if (held && aimAmp > 0.02) {
          const lawNow = modeRef.current;
          const offX = (held.dispX ?? held.x * scaleX) - held.x * scaleX;
          const offY = (held.dispY ?? held.y * scaleY) - held.y * scaleY;
          let gx = held.x;
          let gy = held.y;
          let gvx = held.vx;
          let gvy = held.vy;
          const aimPts = [];

          for (let s = 0; s < AIM_STEPS; s++) {
            let fx = 0;
            let fy = 0;
            // Repulsion, direct sum — one ghost against n frozen bodies
            // doesn't earn a tree any more than collision's pairs do.
            // A plain iterator rather than forEach's callback, since the
            // callback would close over the loop's own mutating gx/gy.
            for (const other of byId.values()) {
              if (other === held) continue;
              const ddx = gx - other.x;
              const ddy = gy - other.y;
              const d = Math.max(MIN_DIST, Math.hypot(ddx, ddy));
              const mag = (k * k) / d;
              fx += (ddx / d) * mag;
              fy += (ddy / d) * mag;
            }

            if (lawNow === "web") {
              for (const edge of edgeList) {
                if (edge.a !== drag.id && edge.b !== drag.id) continue;
                const other = byId.get(edge.a === drag.id ? edge.b : edge.a);
                const ddx = other.x - gx;
                const ddy = other.y - gy;
                const d = Math.max(MIN_DIST, Math.hypot(ddx, ddy));
                const f = ((d * d) / k) * (1 + EDGE_WEIGHT_BONUS * (edge.weight - 1));
                fx += (ddx / d) * f;
                fy += (ddy / d) * f;
              }
              fx -= (gx - cx) * CENTER_STRENGTH;
              fy -= (gy - cy) * CENTER_STRENGTH;
            } else if (lawNow === "strata") {
              fx -= (gx - cx) * STRATA_CENTER_X;
              fy += (held.strataY - gy) * STRATA_SPRING;
            } else if (lawNow === "spectrum") {
              // Same target-point spring step()'s own spectrum branch
              // uses (see the SPECTRUM_COLOR_ORDER constant block) — the
              // ghost has to chase the same wedge the real note would.
              const targetX = cx + Math.cos(held.spectrumAngle) * held.spectrumRadius;
              const targetY = cy + Math.sin(held.spectrumAngle) * held.spectrumRadius * (DOMAIN_H / DOMAIN_W);
              fx += (targetX - gx) * SPECTRUM_SPRING;
              fy += (targetY - gy) * SPECTRUM_SPRING;
            } else if (lawNow === "orrery" && held.orbit) {
              // The mode check is load-bearing here for the same reason
              // it now is in step() itself (see that block's own
              // comment): node.orbit is set unconditionally on every
              // note, so without this check a spectrum-mode drag would
              // silently preview an orrery orbit instead of its own
              // wedge spring.
              const o = held.orbit;
              if (o.isPrimary) {
                fx += (o.anchorX - gx) * ORRERY_PRIMARY_SPRING;
                fy += (o.anchorY - gy) * ORRERY_PRIMARY_SPRING;
              } else {
                const focus = o.primaryId ? byId.get(o.primaryId) : null;
                const focusX = focus ? focus.x : cx;
                const focusY = focus ? focus.y : cy;
                // The conic at THIS instant's phase — frozen with the
                // rest of the world, per the header's admission.
                const rOrbit = (o.a * (1 - o.e * o.e)) / (1 + o.e * Math.cos(o.theta));
                const localX = Math.cos(o.theta) * rOrbit;
                const localY = Math.sin(o.theta) * rOrbit * ORRERY_TILT;
                fx += (focusX + localX * o.planeCos - localY * o.planeSin - gx) * ORRERY_SPRING;
                fy += (focusY + localX * o.planeSin + localY * o.planeCos - gy) * ORRERY_SPRING;
              }
            }

            // Damping applied per lookahead step where the live sim
            // applies it per substep — a slightly gentler decay, which
            // errs the prediction long rather than short; an aim line
            // that undersells a throw would be the worse lie.
            gvx = (gvx + (fx / held.mass) * AIM_DT) * DAMPING;
            gvy = (gvy + (fy / held.mass) * AIM_DT) * DAMPING;
            gx += gvx * AIM_DT;
            gy += gvy * AIM_DT;
            if (s % 2 === 0) aimPts.push({ x: gx * scaleX + offX, y: gy * scaleY + offY });
          }

          aimPathRef.current.setAttribute("d", smoothPath(aimPts));
          aimPathRef.current.setAttribute("opacity", (aimAmp * AIM_OPACITY).toFixed(3));
        } else if (aimAmp <= 0.02 && aimPathRef.current.getAttribute("opacity") !== "0") {
          aimPathRef.current.setAttribute("d", "");
          aimPathRef.current.setAttribute("opacity", "0");
        } else if (!held && aimAmp > 0.02) {
          aimPathRef.current.setAttribute("opacity", (aimAmp * AIM_OPACITY).toFixed(3));
        }
      }

      // The lasso's in-progress stroke (see the LASSO_POINT_GAP constant
      // block) — domain points converted to world-pixel and closed
      // straight back to their own start, so the live preview always
      // shows the exact loop release will actually test against. Lives
      // inside worldGroupRef (see the JSX), so the wrapping group's own
      // transform handles panning/zooming it for free, the same as
      // every other in-world overlay here.
      if (lassoPathRef.current) {
        if (lasso.active && lasso.points.length > 1) {
          const pts = lasso.points.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }));
          const first = pts[0];
          lassoPathRef.current.setAttribute("d", `${ smoothPath(pts) } L ${ first.x } ${ first.y }`);
          lassoPathRef.current.setAttribute("opacity", "1");
        } else if (!lasso.active && lassoPathRef.current.getAttribute("opacity") !== "0") {
          lassoPathRef.current.setAttribute("d", "");
          lassoPathRef.current.setAttribute("opacity", "0");
        }
      }

      // The focus swimmer (see the FOCUS_SPRING constant block) — chases
      // the focused note's displayed position on its underdamped spring,
      // squashing along its own travel like everything else that moves
      // here; with nothing focused it fades out where it stands. Under
      // reduced motion it rides exactly on target: present (a focus
      // indicator is accessibility, not ornament), just not swimming.
      if (focusRingRef.current) {
        const focusedNode = focusIdRef.current ? byId.get(focusIdRef.current) : null;
        if (focusedNode) {
          const targetX = focusedNode.dispX ?? focusedNode.x * scaleX;
          const targetY = focusedNode.dispY ?? focusedNode.y * scaleY;
          if (reduceMotionRef.current || swimmer.opacity <= 0.01) {
            swimmer.x = targetX;
            swimmer.y = targetY;
            swimmer.vx = 0;
            swimmer.vy = 0;
          } else {
            swimmer.vx = (swimmer.vx + (targetX - swimmer.x) * FOCUS_SPRING * dt) * FOCUS_DAMPING;
            swimmer.vy = (swimmer.vy + (targetY - swimmer.y) * FOCUS_SPRING * dt) * FOCUS_DAMPING;
            swimmer.x += swimmer.vx * dt;
            swimmer.y += swimmer.vy * dt;
          }
          swimmer.opacity += (1 - swimmer.opacity) * 0.2;

          let deform = "";
          const swimSpeed = Math.hypot(swimmer.vx, swimmer.vy);
          if (swimSpeed > 4 && !reduceMotionRef.current) {
            const ang = (Math.atan2(swimmer.vy, swimmer.vx) * 180) / Math.PI;
            const s = 1 + Math.min(0.35, swimSpeed * 0.0009);
            deform = ` rotate(${ ang }) scale(${ s },${ 1 / s }) rotate(${ -ang })`;
          }
          focusRingRef.current.setAttribute("transform", `translate(${ swimmer.x },${ swimmer.y })${ deform }`);
          focusRingRef.current.setAttribute("r", focusedNode.radiusPx + FOCUS_RING_PAD);
          focusRingRef.current.setAttribute("opacity", (swimmer.opacity * 0.85).toFixed(3));
        } else if (swimmer.opacity > 0.01) {
          swimmer.opacity *= 0.85;
          focusRingRef.current.setAttribute("opacity", (swimmer.opacity * 0.85).toFixed(3));
        } else if (focusRingRef.current.getAttribute("opacity") !== "0") {
          focusRingRef.current.setAttribute("opacity", "0");
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
      window.removeEventListener("pointercancel", handlePointerCancel);
      svg.removeEventListener("contextmenu", handleContextMenu);
      svg.removeEventListener("keydown", handleKey);
      svg.removeEventListener("blur", handleFocusBlur);
      svg.removeEventListener("wheel", handleWheel);
      svg.removeEventListener("dblclick", handleDblClick);
      svg.removeEventListener("pointerenter", handlePointerEnter);
      svg.removeEventListener("pointerleave", handleSvgPointerLeave);
      gsap.killTweensOf(Array.from(byId.values()));
      gsap.killTweensOf(camera);
      blobMorphers.forEach(({ drive }) => gsap.killTweensOf(drive));
      // An in-flight toss's own matter-js world (see the TOSS_GRAVITY
      // constant block) — without this, closing the panel mid-toss would
      // leak the whole engine: its event listener, every body, all of
      // it, since nothing else ever tears it down once the RAF loop
      // above has already stopped ticking.
      if (toss.engine) {
        Matter.Events.off(toss.engine, "collisionStart", toss.handleCollision);
        Matter.World.clear(toss.engine.world, false);
        Matter.Engine.clear(toss.engine);
      }
      morphControllerRef.current = null;
      minimapControllerRef.current = null;
      reheatControllerRef.current = null;
      tossControllerRef.current = null;
      searchControllerRef.current = null;
      inkControllerRef.current = null;
      modeControllerRef.current = null;
      ink?.dispose();
      // Unconditional, regardless of poolVoiceOn's own value at teardown
      // time — unlike every other cue in utils/sound.js, a started
      // oscillator does not stop itself, and a mount that skipped this
      // would leave the pool humming in the background of a page that no
      // longer even shows the panel it came from. Cheap enough to call
      // even when it was never started (stopPoolVoice no-ops on a null
      // graph), so there's no reason to guard it behind poolVoiceOn here.
      stopPoolVoice();
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

    // The selected note's splash-down — rings spread from exactly where
    // the dive is about to zoom. No-ops by construction under reduced
    // motion (the surface was never created).
    inkControllerRef.current?.splashNote(selectedId, INK_DIVE_SPLASH);

    // And the note itself swells through its own hover morph on the way
    // under — the silhouette the pointer already knows, reused as the
    // dive's last gesture rather than a new shape invented for the exit.
    // (Under reduced motion the morph controller applies it instantly.)
    morphControllerRef.current?.enter(selectedId);

    const svg = svgRef.current;
    const inkCanvas = inkCanvasRef.current;
    const nodeEl = nodeElRefs.current[selectedId];
    const edgesGroup = svg?.querySelector(".note-constellation-edges");
    if (!svg || !nodeEl) return undefined;

    const nodeRect = nodeEl.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    const originX = nodeRect.left + nodeRect.width / 2 - svgRect.left;
    const originY = nodeRect.top + nodeRect.height / 2 - svgRect.top;
    svg.style.transformOrigin = `${ originX }px ${ originY }px`;

    // The ink canvas dives too — this zoom is a CSS transform on the SVG
    // element itself, not a camera move (the camera's own math never sees
    // it), so the pool has to be scaled alongside or the ripples would
    // stay flat and detached while the whole graph plunges. Same element
    // box, same origin, same tween — and the long-exposure film rides
    // along for exactly the same reason.
    if (inkCanvas) inkCanvas.style.transformOrigin = `${ originX }px ${ originY }px`;
    const exposureCanvas = exposureCanvasRef.current;
    if (exposureCanvas) exposureCanvas.style.transformOrigin = `${ originX }px ${ originY }px`;

    // A little short of the machine's own DIVE_DURATION_MS so the zoom
    // visibly finishes (rather than getting cut mid-tween) before the
    // panel closes and hands off to the editor.
    const duration = DIVE_DURATION_MS / 1000 - 0.04;
    const tweenFn = reduceMotionRef.current ? gsap.set : gsap.to;
    const diveTargets = [svg, inkCanvas, exposureCanvas].filter(Boolean);
    tweenFn(diveTargets, { scale: 3.2, duration, ease: "power3.in" });
    if (edgesGroup) tweenFn(edgesGroup, { opacity: 0, duration: duration * 0.6, ease: "power1.in" });

    return () => {
      gsap.killTweensOf(diveTargets);
      if (edgesGroup) gsap.killTweensOf(edgesGroup);
    };
  }, [phase, selectedId]);

  // Feedback for the shift-click path-anchor gesture — genuinely useful
  // (confirming a path was found, and how long it is, is the actual payoff
  // of the feature) rather than decoration, and the one thing that makes
  // a gesture this undiscoverable (shift-click isn't hinted at anywhere
  // else in this app) legible once someone stumbles onto it.
  let pathStatus = null;
  if (pathAnchors.length === 1) {
    pathStatus = { text: "Shift-click a second note to trace the path", tone: "" };
  } else if (pathAnchors.length === 2) {
    pathStatus = shortestPath
      ? {
        text: shortestPath.length === 2
          ? "Directly connected"
          // The hop count is the concrete payoff (see findShortestPath's
          // own comment); "drawing taut" names the physical answer to it
          // — see the PATH_TENSION_GAIN constant block — only once
          // there's an actual interior to straighten.
          : `Path found — ${ shortestPath.length } notes, ${ shortestPath.length - 1 } hops, drawing taut`,
        tone: "found",
      }
      : { text: "No path between these notes", tone: "warn" };
  } else if (lassoIds.length > 0) {
    // The lasso's own readout (see the LASSO_POINT_GAP constant block) —
    // right after the path branches (a fresh drag is a deliberate
    // statement, same tier as a traced path) and ahead of the lens,
    // since a mouse-drawn selection is fresher than a standing tag
    // toggle, the same reasoning the dimming priority chain already uses.
    pathStatus = {
      text: `${ lassoIds.length } ${ lassoIds.length === 1 ? "note" : "notes" } selected · P pins them all`,
      tone: "found",
    };
  } else if (lensTag && lensNodeIds) {
    // The lens borrows the same pill — with no path being traced it's the
    // most deliberate statement on screen, and its member count is the
    // same kind of concrete payoff the path readout already gives.
    pathStatus = {
      text: `#${ lensTag } — ${ lensNodeIds.size } ${ lensNodeIds.size === 1 ? "note carries" : "notes carry" } this tag`,
      tone: "found",
    };
  } else if (mode === "orrery" && graph.nodes.length > 0) {
    // Each non-web law introduces itself in the same subtle register the
    // web's own gesture hints use — one sentence of what the arrangement
    // means, since unlike the web the reading isn't self-evident.
    pathStatus = { text: "Each system orbits its most connected note · Untagged notes ride the comet belt", tone: "subtle" };
  } else if (mode === "strata" && graph.nodes.length > 0) {
    pathStatus = { text: "Notes settle onto the shelf of their own month — oldest at the bottom", tone: "subtle" };
  } else if (mode === "spectrum" && graph.nodes.length > 0) {
    pathStatus = { text: "Notes gather into their own color's wedge of the wheel", tone: "subtle" };
  } else if (mode === "flock" && graph.nodes.length > 0) {
    pathStatus = { text: "Notes steer by their nearest neighbors · Shared tags flock closer together", tone: "subtle" };
  } else if (graph.edges.length > 0) {
    // The stir hint only where the gesture actually exists — under
    // reduced motion right-drag does nothing (see the STIR constants),
    // and a hint for a dead gesture is worse than none.
    pathStatus = {
      text: `Shift-click two notes to trace a path · Alt-click pins a note in place${ reduceMotion ? "" : " · Right-drag stirs the ink" }`,
      tone: "subtle",
    };
  }

  return (
    <>
      {/* The liquid ink surface — a WebGL canvas underneath the whole SVG
          (see utils/inkSurface.js and the INK_WAKE constants). Rendered
          every frame by the physics effect's own tick loop; never even
          initialized under reduced motion, in which case this stays a
          blank transparent element. */}
      <canvas ref={ inkCanvasRef } className="note-constellation-ink" aria-hidden="true" />
      {/* The long-exposure film — see the EXPOSURE constants. Between the
          pool and the SVG in paint order: developed light sits ON the
          water, under everything that's actually happening now. The tick
          loop owns all pixels; this element only fades in and out. */}
      <canvas
        ref={ exposureCanvasRef }
        className={ `note-constellation-exposure ${ exposure && !reduceMotion ? "visible" : "" }` }
        aria-hidden="true"
      />
      {/* Focusable now (see the FOCUS_SPRING constant block) — tabIndex
          puts the stage in the tab order, role="application" hands arrow
          keys to this component's own graph-walking instead of a screen
          reader's virtual cursor, and the aria-live region further down
          announces each focused note by name. The old aria-hidden is
          gone for exactly that reason: a focusable stage that claims to
          not exist is a contradiction assistive tech rightly punishes. */}
      <svg
        ref={ svgRef }
        className="note-constellation-svg"
        tabIndex={ 0 }
        role="application"
        aria-label="Note constellation. Arrow keys move between connected notes, Enter opens the focused note, Space pings from it, P pins it, 1 to 3 switch the layout, slash finds a note by text, question mark opens the gesture guide, Escape releases focus."
      >
        {/* Everything the camera pans/zooms lives in this one wrapping
            group — see the MIN_ZOOM/MAX_ZOOM module comment. The physics
            layout itself (every child's own position below) stays in the
            same fixed domain space regardless of what this group's own
            transform currently is. */}
        <g ref={ worldGroupRef } className="note-constellation-world">
          {/* The strata's shelf furniture — see the LAYOUT_MODES block.
              The very bottom of the stack, below even the cluster pools:
              bedrock and wash bands are the ground the sediment settles
              onto, never content over it. Geometry is written by the tick
              loop while strata is the active law; the layer's own CSS
              fade covers entry and exit. */}
          <g className={ `note-constellation-strata ${ mode === "strata" ? "visible" : "" }` }>
            {
              graph.strata.map((band, i) => (
                <g key={ band.key }>
                  {/* Alternating wash weights so neighboring shelves read
                      as separate layers even before their notes arrive. */}
                  <rect
                    ref={ (el) => { strataBandRefs.current[i] = el; } }
                    className="note-constellation-strata-band"
                    fillOpacity={ i % 2 ? 0.09 : 0.05 }
                  />
                  <text
                    ref={ (el) => { strataLabelRefs.current[i] = el; } }
                    className="note-constellation-strata-label"
                  >
                    { band.label }
                  </text>
                </g>
              ))
            }
          </g>
          {/* The spectrum wheel's own furniture — see the
              SPECTRUM_COLOR_ORDER constant block. Same background tier as
              the strata bands right above (both are "the ground a law's
              own notes settle onto," never content of their own), and the
              same mode-gated opacity-fade discipline. Wedge shapes are
              fixed for the whole mount (see spectrumWedgePath's own
              comment on why); the tick loop only ever rewrites their d
              attribute to follow the live domain→screen scale, the same
              one-frame-stale-at-worst contract every other per-frame
              geometry write in this file already accepts. */}
          <g className={ `note-constellation-spectrum ${ mode === "spectrum" ? "visible" : "" }` }>
            {
              SPECTRUM_SECTORS.map((sector, i) => (
                <g key={ sector.key }>
                  <path
                    ref={ (el) => { spectrumWedgeRefs.current[i] = el; } }
                    className="note-constellation-spectrum-wedge"
                    fill={ sector.color }
                  />
                  <text
                    ref={ (el) => { spectrumLabelRefs.current[i] = el; } }
                    className="note-constellation-spectrum-label"
                    fill={ sector.color }
                  >
                    { sector.label }
                  </text>
                </g>
              ))
            }
          </g>
          {/* Cluster ink pools — bottom of the stack on purpose: they're
              context behind the graph, never content in front of it. The
              whole layer steps back while a traced path is active, same
              deliberate-beats-ambient priority the edge dimming below
              already follows. */}
          <g className={ `note-constellation-hulls ${ (pathNodeIds || searchNodeIds || lensNodeIds) ? "dimmed" : "" }` }>
            {
              graph.clusters.map((cluster) => (
                <path
                  key={ cluster.id }
                  ref={ (el) => { hullElRefs.current[cluster.id] = el; } }
                  className="note-constellation-hull"
                  fill={ cluster.color }
                />
              ))
            }
            {
              // Region names (see the CLUSTER_LABEL constants) — after the
              // pool paths so a name never sits under its own stain's
              // blur, but still inside this layer, so it stays behind all
              // actual content and steps back with the pools whenever a
              // path or lens takes priority. Transform and fade are
              // written every frame by the tick loop.
              graph.clusters.map((cluster) => (
                cluster.label && (
                  <text
                    key={ `${ cluster.id }-label` }
                    ref={ (el) => { clusterLabelRefs.current[cluster.id] = el; } }
                    className="note-constellation-cluster-label"
                    fill={ cluster.color }
                    opacity={ 0 }
                  >
                    { cluster.label }
                  </text>
                )
              ))
            }
          </g>
          {/* Voronoi territories — see the VORONOI constant block. Above
              the pools (a map's cadaster sits over its terrain washes)
              and below the streamlines and everything that moves: the
              tessellation is ground, not content. Cell geometry is
              written per frame by the tick loop while the overlay is on;
              each cell carries a whisper of its own note's color, so the
              desk reads as stained glass at a squint. */}
          <g className={ `note-constellation-voronoi ${ territories ? "visible" : "" }` }>
            {
              graph.nodes.map((note) => (
                <path
                  key={ note.id }
                  ref={ (el) => { voronoiElRefs.current[note.id] = el; } }
                  className="note-constellation-voronoi-cell"
                  fill={ NOTE_COLORS[note.color] || "var(--page-ink-color)" }
                  fillOpacity={ VORONOI_FILL_OPACITY }
                />
              ))
            }
          </g>
          {/* Current streamlines — see the STREAM_COUNT constant block.
              Above the pools (motion over stains) and below every
              annotation and thread: the filaments are the water's own
              texture, and everything else floats on it. */}
          <g className="note-constellation-streams">
            {
              Array.from({ length: STREAM_COUNT }, (_, i) => (
                <path
                  key={ `stream-${ i }` }
                  ref={ (el) => { streamElRefs.current[i] = el; } }
                  className="note-constellation-stream"
                  opacity={ 0 }
                />
              ))
            }
          </g>
          {/* The orrery's orbit guides — see the LAYOUT_MODES block and
              the tick loop's own transform comment. Above the pools
              (they annotate systems, and a system's pool is behind it)
              but below the threads and everything that is actual
              content: a guide is the promise of a path, drawn in the
              pin ring's quiet dashed register. */}
          <g className={ `note-constellation-orbit-guides ${ mode === "orrery" ? "visible" : "" }` }>
            {
              graph.orbits.map((o) => (
                <ellipse
                  key={ o.id }
                  ref={ (el) => { orbitGuideRefs.current[o.id] = el; } }
                  className={ `note-constellation-orbit-guide ${ o.comet ? "comet" : "" }` }
                  cx={ o.guideCx }
                  cy={ 0 }
                  rx={ o.a }
                  ry={ o.guideRy }
                />
              ))
            }
          </g>
          {/* Sonar fronts — see the SONAR_SPEED constant block. Below the
              threads on purpose: the front travels the water the rigging
              hangs over, so it passes UNDER what it plucks. Ellipses, not
              circles — a circular wave in domain space renders through
              the domain's own anisotropic scale (the tick loop writes
              all geometry). */}
          <g className="note-constellation-sonar">
            {
              Array.from({ length: SONAR_POOL }, (_, i) => (
                <ellipse
                  key={ `sonar-${ i }` }
                  ref={ (el) => { sonarRingRefs.current[i] = el; } }
                  className="note-constellation-sonar-ring"
                  opacity={ 0 }
                />
              ))
            }
          </g>
          <g className={ `note-constellation-edges ${ skeleton ? "skeleton" : "" }` }>
            {
              graph.edges.map((edge, i) => {
                // An active path takes visual priority over a plain hover —
                // a deliberately-set path is a stronger statement than a
                // transient pointer position, and the two never need to
                // disagree about what's dimmed at the same time.
                const onPath = pathEdgeIds?.has(pairKey(edge.a, edge.b)) ?? false;
                // Lensed = the lens tag is genuinely among this edge's own
                // shared tags (see the sharedTags build comment) — dimming
                // priority path > search > lens > hover, same as the
                // nodes below (a typed query outranks a standing lens
                // tag the same way a traced path outranks both).
                const lensed = lensTag ? (edge.sharedTags?.includes(lensTag) ?? false) : false;
                const searched = searchNodeIds ? (searchNodeIds.has(edge.a) || searchNodeIds.has(edge.b)) : false;
                const dimmed = pathEdgeIds
                  ? !onPath
                  : searchNodeIds
                    ? !searched
                    : lensTag
                      ? !lensed
                      : (hoveredId && edge.a !== hoveredId && edge.b !== hoveredId);
                // The ink-flow dashes march a→b as drawn; an edge the path
                // walks b→a plays the same animation in reverse so the
                // current runs unbroken from anchor to anchor (see
                // pathEdgeFrom's own comment). Class-gated on reduceMotion
                // the same way the anchor ring's spin already is.
                const flowing = onPath && !reduceMotion;
                const flowReversed = flowing && pathEdgeFrom?.get(pairKey(edge.a, edge.b)) === edge.b;
                return (
                  <path
                    key={ edge.id }
                    ref={ (el) => { edgeElRefs.current[i] = el; } }
                    className={ `note-constellation-edge ${ dimmed ? "dimmed" : "" } ${ onPath ? "on-path" : "" } ${ flowing ? "flowing" : "" } ${ flowReversed ? "flow-reverse" : "" } ${ lensed ? "lensed" : "" } ${ edge.mst ? "mst" : "" }` }
                    strokeWidth={ Math.min(EDGE_WIDTH_MAX, EDGE_WIDTH_BASE + edge.weight * EDGE_WIDTH_PER_TAG) }
                  />
                );
              })
            }
          </g>
          {/* Ink comet trails — above the threads (a moving node passes in
              front of them) but below every node blob (a trail is exhaust,
              never occlusion). Geometry and opacity are written by tick();
              stroke width tracks each node's own rendered size so a heavy
              hub smears a correspondingly heavier wake. */}
          <g className="note-constellation-trails">
            {
              graph.nodes.map((note) => (
                <path
                  key={ note.id }
                  ref={ (el) => { trailElRefs.current[note.id] = el; } }
                  className="note-constellation-trail"
                  stroke={ NOTE_COLORS[note.color] || "var(--page-ink-color)" }
                  strokeWidth={ radiusForDegree(degreeById.get(note.id) || 0) * 0.55 }
                  opacity={ 0 }
                />
              ))
            }
          </g>
          {/* Thread dew — see the DEW_GLOBAL_RATE constant block. One
              forming droplet per thread (ellipse, so it can neck before
              letting go) plus the fixed falling pool; above the threads
              they hang from, below the blobs they fall behind. Geometry
              is written every frame by the tick loop; everything mounts
              at zero size and stays there under reduced motion. */}
          <g className="note-constellation-dew">
            {
              graph.edges.map((edge, i) => (
                <ellipse
                  key={ edge.id }
                  ref={ (el) => { dewElRefs.current[i] = el; } }
                  className="note-constellation-dew-drop"
                  rx={ 0 }
                  ry={ 0 }
                />
              ))
            }
            {
              Array.from({ length: DEW_POOL }, (_, i) => (
                <circle
                  key={ `dew-fall-${ i }` }
                  ref={ (el) => { dewFallRefs.current[i] = el; } }
                  className="note-constellation-dew-drop"
                  r={ 0 }
                />
              ))
            }
          </g>
          <g className="note-constellation-nodes">
            {
              graph.nodes.map((note) => {
                const degree = degreeById.get(note.id) || 0;
                const radius = radiusForDegree(degree);
                const onPath = pathNodeIds?.has(note.id) ?? false;
                const isAnchor = pathAnchors.includes(note.id);
                const isPinned = pinnedIds.includes(note.id);
                const isSelected = lassoIds.includes(note.id);
                // Priority path > search > lens > hover — see the edge
                // pass above for why search outranks the lens.
                const dimmed = pathNodeIds
                  ? !onPath
                  : searchNodeIds
                    ? !searchNodeIds.has(note.id)
                    : lensNodeIds
                      ? !lensNodeIds.has(note.id)
                      : (connectedIds && !connectedIds.has(note.id));
                const color = NOTE_COLORS[note.color] || "var(--page-ink-color)";
                const shapes = getShapes(note.id, radius);

                return (
                  <g
                    key={ note.id }
                    data-note-id={ note.id }
                    ref={ (el) => { nodeElRefs.current[note.id] = el; } }
                    className={ `note-constellation-node ${ dimmed ? "dimmed" : "" } ${ onPath ? "on-path" : "" } ${ isAnchor ? "anchor" : "" } ${ isPinned ? "pinned" : "" }` }
                    onPointerEnter={ () => { setHoveredId(note.id); morphControllerRef.current?.enter(note.id); } }
                    onPointerLeave={ () => { setHoveredId((c) => (c === note.id ? null : c)); morphControllerRef.current?.leave(note.id); } }
                  >
                    {
                      // The lasso's own halo — see the LASSO_HALO_PAD
                      // constant block. A soft filled wash, not a ring,
                      // rendered first (bottom of this node's own stack)
                      // so the anchor/pin rings' crisper line art always
                      // stays legible over it if a note happens to carry
                      // more than one of these states at once.
                      isSelected && (
                        <circle
                          className="note-constellation-lasso-ring"
                          r={ radius + LASSO_HALO_PAD }
                          fillOpacity={ LASSO_HALO_OPACITY }
                        />
                      )
                    }
                    {
                      isAnchor && (
                        <circle
                          className={ `note-constellation-anchor-ring ${ reduceMotion ? "static" : "" }` }
                          r={ radius + 6 }
                        />
                      )
                    }
                    {
                      // A pinned node's ring — deliberately quieter than the
                      // anchor ring above (ink-colored, static, tight to the
                      // blob): a pin is a standing arrangement, not an
                      // active selection.
                      isPinned && (
                        <circle className="note-constellation-pin-ring" r={ radius + 4 } />
                      )
                    }
                    <path
                      ref={ (el) => { blobPathElRefs.current[note.id] = el; } }
                      className="note-constellation-blob"
                      transform={ `translate(${ shapes.offset },${ shapes.offset })` }
                      d={ shapes.rest }
                      fill={ color }
                    />
                    {
                      // The moon's own orbit, drawn once as plain static
                      // geometry rather than anything the tick loop has to
                      // touch — the shape never changes, only the moon's
                      // angle around it does. Same polar-conic-to-ellipse
                      // conversion the orrery's own orbit guides already
                      // use (focus at the node's own center, so the
                      // ellipse's true center sits offset by -a·e — see
                      // guideCx/guideRy above for the identical formula),
                      // just at the moon's own much smaller scale and
                      // unconditional on mode: a favorite's moon orbits in
                      // every law, not only orrery.
                      note.favorite && (
                        <ellipse
                          className="note-constellation-moon-orbit"
                          cx={ -(radius + MOON_ORBIT_MARGIN) * MOON_ECCENTRICITY }
                          cy={ 0 }
                          rx={ radius + MOON_ORBIT_MARGIN }
                          ry={ (radius + MOON_ORBIT_MARGIN) * Math.sqrt(1 - MOON_ECCENTRICITY * MOON_ECCENTRICITY) * MOON_TILT }
                        />
                      )
                    }
                    {
                      // The favorite's orbiting ink droplet — position
                      // written every frame by tick()'s own Kepler math.
                      // Drawn after the blob (always in front): the honest
                      // alternative would re-sort it behind the blob for
                      // half of every orbit, per-frame DOM reordering that
                      // isn't worth what a 2.6px droplet's occlusion says.
                      note.favorite && (
                        <circle
                          ref={ (el) => { moonElRefs.current[note.id] = el; } }
                          className="note-constellation-moon"
                          r={ MOON_RADIUS }
                        />
                      )
                    }
                    {/* No static y offset anymore — the hang is a live
                        verlet pendulum (see the LABEL_HANG constant
                        block), its transform written every frame by the
                        tick loop; reduced motion gets the same offset
                        written statically. */}
                    <text
                      ref={ (el) => { labelElRefs.current[note.id] = el; } }
                      className="note-constellation-label"
                      transform={ `translate(0,${ radius + LABEL_HANG })` }
                    >
                      { truncateTitle(note.title) }
                    </text>
                  </g>
                );
              })
            }
          </g>
          {/* Liquid bridges — see the BRIDGE_REACH constant block. Over
              the nodes layer on purpose: each neck's ends attach inside
              its blobs' own silhouettes in matching ink (the gradient
              runs note color to note color), and sitting on top is what
              lets the neck cover the blobs' paper-colored outline strokes
              where they meet — underneath, every neck would wear a
              hairline scar at each attachment. Path geometry, gradient
              endpoints, and stop colors are all written per frame by the
              tick loop. */}
          <g className="note-constellation-bridges">
            {
              Array.from({ length: BRIDGE_POOL }, (_, i) => (
                <g key={ `bridge-${ i }` }>
                  <linearGradient
                    id={ `note-constellation-bridge-grad-${ i }` }
                    gradientUnits="userSpaceOnUse"
                    ref={ (el) => { bridgeGradRefs.current[i] = el; } }
                  >
                    <stop offset="0" ref={ (el) => { bridgeStopARefs.current[i] = el; } } />
                    <stop offset="1" ref={ (el) => { bridgeStopBRefs.current[i] = el; } } />
                  </linearGradient>
                  <path
                    ref={ (el) => { bridgePathRefs.current[i] = el; } }
                    className="note-constellation-bridge"
                    fill={ `url(#note-constellation-bridge-grad-${ i })` }
                    opacity={ 0 }
                  />
                </g>
              ))
            }
          </g>
          {/* The aim line — see the AIM_STEPS constant block. Up with
              the focus ring at the top of the world: the throw being
              aimed is the current statement, and its oracle shouldn't
              sink under what it's aiming through. Geometry and fade are
              written every frame by the tick loop. */}
          <path ref={ aimPathRef } className="note-constellation-aim" opacity={ 0 } />
          {/* The lasso's own in-progress stroke — see the LASSO_POINT_GAP
              constant block. Geometry and fade written every frame by
              the tick loop while a ctrl-drag is live. */}
          <path ref={ lassoPathRef } className="note-constellation-lasso" opacity={ 0 } />
          {/* The focus swimmer's ring — see the FOCUS_SPRING constant
              block. Topmost in the world: focus is the most deliberate
              statement the keyboard can make, and its ring should never
              sink under a pool, a thread, or a neck. Transform, radius,
              and fade are all written every frame by the tick loop. */}
          <circle ref={ focusRingRef } className="note-constellation-focus-ring" opacity={ 0 } />
        </g>
        {/* The fisheye boundary — a faint dashed ink ring at the lens's
            exact screen-space reach, outside the world group on purpose
            (the lens is an instrument held over the scene, not an object
            in it, so the camera must not scale it). Position and opacity
            are written every frame by the tick loop. */}
        <circle ref={ lensRingRef } className="note-constellation-lens-ring" r={ FISHEYE_RADIUS } opacity={ 0 } />
      </svg>
      {
        graph.nodes.length > 0 && phase !== "diving" && (
          // No physics of its own — a second, tiny rendering of the exact
          // same positions the main view already computed this frame (see
          // the MINIMAP_WIDTH module comment). Clicking anywhere jumps the
          // main camera there — the domain-space math happens right here
          // (this handler only needs the minimap's own bounding rect and
          // the fixed DOMAIN_W/DOMAIN_H constants), then hands off to
          // minimapControllerRef's own tween, the same bridge pattern
          // morphControllerRef already uses to reach into the physics
          // effect from a plain JSX handler.
          <svg
            className="note-constellation-minimap"
            style={{ width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT }}
            viewBox={ `0 0 ${ DOMAIN_W } ${ DOMAIN_H }` }
            preserveAspectRatio="none"
            onPointerDown={ (e) => {
              // Pointer capture turns the click into a scrub: moves keep
              // arriving even once the pointer strays off the minimap,
              // so a drag flies the camera continuously (the controller's
              // immediate path) while a plain click keeps its glide.
              e.currentTarget.setPointerCapture(e.pointerId);
              minimapScrubRef.current = true;
              const rect = e.currentTarget.getBoundingClientRect();
              const x = ((e.clientX - rect.left) / rect.width) * DOMAIN_W;
              const y = ((e.clientY - rect.top) / rect.height) * DOMAIN_H;
              minimapControllerRef.current?.jumpTo(x, y);
            } }
            onPointerMove={ (e) => {
              if (!minimapScrubRef.current) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const x = Math.max(0, Math.min(DOMAIN_W, ((e.clientX - rect.left) / rect.width) * DOMAIN_W));
              const y = Math.max(0, Math.min(DOMAIN_H, ((e.clientY - rect.top) / rect.height) * DOMAIN_H));
              minimapControllerRef.current?.jumpTo(x, y, true);
            } }
            onPointerUp={ (e) => {
              minimapScrubRef.current = false;
              e.currentTarget.releasePointerCapture?.(e.pointerId);
            } }
          >
            <rect className="note-constellation-minimap-bg" x={ 0 } y={ 0 } width={ DOMAIN_W } height={ DOMAIN_H } />
            {
              graph.nodes.map((note) => (
                <circle
                  key={ note.id }
                  ref={ (el) => { minimapDotRefs.current[note.id] = el; } }
                  className="note-constellation-minimap-dot"
                  r={ MINIMAP_DOT_RADIUS }
                  fill={ NOTE_COLORS[note.color] || "var(--page-ink-color)" }
                />
              ))
            }
            <rect ref={ minimapViewportRef } className="note-constellation-minimap-viewport" />
          </svg>
        )
      }
      {
        graph.nodes.length > 0 && phase !== "diving" && (
          // The reshuffle action — the FR paper's own annealing schedule as
          // a button (see the REHEAT_TEMPERATURE constant block). Bottom-
          // left, mirroring the minimap's bottom-right corner; reaches the
          // physics through the same controller-ref bridge the minimap's
          // own click already uses.
          <motion.button
            type="button"
            className="note-constellation-reshuffle"
            initial={ reduceMotion ? false : { opacity: 0, x: -14 } }
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...SNAPPY, delay: reduceMotion ? 0 : 0 * 0.045 }}
            whileHover={ reduceMotion ? undefined : { scale: 1.05 } }
            whileTap={ reduceMotion ? undefined : { scale: .94 } }
            onClick={ () => reheatControllerRef.current?.reheat() }
          >
            <FaArrowsRotate aria-hidden="true" />
            Reshuffle
          </motion.button>
        )
      }
      {
        graph.nodes.length > 0 && phase !== "diving" && !reduceMotion && (
          // The fisheye toggle (see the FISHEYE constants) — stacked just
          // above the reshuffle button in the same pill language. Hidden
          // entirely under reduced motion rather than disabled: a
          // cursor-tracking whole-scene distortion has no reduced-motion
          // rendition worth pretending to offer.
          <motion.button
            type="button"
            className={ `note-constellation-magnify ${ magnify ? "active" : "" }` }
            aria-pressed={ magnify }
            initial={{ opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...SNAPPY, delay: reduceMotion ? 0 : 1 * 0.045 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: .94 }}
            onClick={ () => { playTick(); setMagnify((prev) => !prev); } }
          >
            <FaMagnifyingGlass aria-hidden="true" />
            Magnify
          </motion.button>
        )
      }
      {
        graph.nodes.length > 0 && phase !== "diving" && !reduceMotion && (
          // The pool's own voice (see utils/sound.js's own
          // updatePoolVoice) — stacked with fisheye's own toggle in the
          // same pill language, same reduced-motion gate for the same
          // practical reason (not that ambient sound is a motion
          // preference — utils/sound.js's own opt-in gate already stands
          // fully apart from reduceMotion — but that its data source,
          // the ink surface, is never built there, so there'd be nothing
          // genuine left for it to sonify). Explicitly stopping on the
          // OFF transition here, rather than just letting the tick loop
          // stop calling updatePoolVoice, is load-bearing: a started
          // oscillator holds its last volume forever once nothing is
          // re-aiming it, so simply withholding future updates would
          // leave it humming right where it was, not fading out.
          <motion.button
            type="button"
            className={ `note-constellation-voice ${ poolVoiceOn ? "active" : "" }` }
            aria-pressed={ poolVoiceOn }
            initial={{ opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...SNAPPY, delay: 2 * 0.045 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: .94 }}
            onClick={ () => {
              playTick();
              setPoolVoiceOn((prev) => {
                const next = !prev;
                if (!next) stopPoolVoice();
                return next;
              });
            } }
          >
            <FaEarListen aria-hidden="true" />
            Listen
          </motion.button>
        )
      }
      {
        graph.nodes.length > 0 && phase !== "diving" && (
          // The Voronoi territories toggle (see the VORONOI constant
          // block) — stacked up the same bottom-left pill column as
          // reshuffle and magnify. Shown under reduced motion too: a
          // static tessellation of a static layout is a perfectly good
          // reading there.
          <motion.button
            type="button"
            className={ `note-constellation-cells ${ territories ? "active" : "" }` }
            aria-pressed={ territories }
            initial={ reduceMotion ? false : { opacity: 0, x: -14 } }
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...SNAPPY, delay: reduceMotion ? 0 : 3 * 0.045 }}
            whileHover={ reduceMotion ? undefined : { scale: 1.05 } }
            whileTap={ reduceMotion ? undefined : { scale: .94 } }
            onClick={ () => { playTick(); setTerritories((prev) => !prev); } }
          >
            <FaTableCells aria-hidden="true" />
            Cells
          </motion.button>
        )
      }
      {
        graph.edges.length > 0 && phase !== "diving" && (
          // The skeleton toggle (see the Kruskal block in the build
          // effect) — meaningless without edges, so it only appears when
          // there are threads to strip back.
          <motion.button
            type="button"
            className={ `note-constellation-skeleton ${ skeleton ? "active" : "" }` }
            aria-pressed={ skeleton }
            initial={ reduceMotion ? false : { opacity: 0, x: -14 } }
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...SNAPPY, delay: reduceMotion ? 0 : 4 * 0.045 }}
            whileHover={ reduceMotion ? undefined : { scale: 1.05 } }
            whileTap={ reduceMotion ? undefined : { scale: .94 } }
            onClick={ () => { playTick(); setSkeleton((prev) => !prev); } }
          >
            <FaShareNodes aria-hidden="true" />
            Skeleton
          </motion.button>
        )
      }
      {
        graph.nodes.length > 0 && phase !== "diving" && !reduceMotion && (
          // The long-exposure toggle (see the EXPOSURE constants) —
          // hidden entirely under reduced motion, like magnify: a long
          // exposure of a still scene is just a smudge, not a rendition
          // worth offering.
          <motion.button
            type="button"
            className={ `note-constellation-exposure-toggle ${ exposure ? "active" : "" }` }
            aria-pressed={ exposure }
            initial={{ opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...SNAPPY, delay: 5 * 0.045 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: .94 }}
            onClick={ () => { playTick(); setExposure((prev) => !prev); } }
          >
            <FaCamera aria-hidden="true" />
            Exposure
          </motion.button>
        )
      }
      {
        graph.nodes.length > 0 && phase !== "diving" && !reduceMotion && (
          // The toss — see the TOSS_GRAVITY constant block. Continues
          // the left-side column past Exposure, the same 44px rhythm;
          // hidden under reduced motion like Magnify/Exposure, since a
          // real rigid-body bounce is autonomous, large-amplitude motion
          // by definition, with no reduced rendition worth offering.
          <motion.button
            type="button"
            className="note-constellation-toss"
            initial={{ opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...SNAPPY, delay: 6 * 0.045 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: .94 }}
            onClick={ () => tossControllerRef.current?.toss() }
          >
            <FaDice aria-hidden="true" />
            Toss
          </motion.button>
        )
      }
      {
        graph.nodes.length > 0 && phase !== "diving" && (
          // The field guide's summons — bottom-right, seated just above
          // the minimap it shares the corner with; "?" reaches the same
          // place from the keyboard.
          <motion.button
            ref={ guideToggleRef }
            type="button"
            className={ `note-constellation-guide-toggle ${ guideOpen ? "active" : "" }` }
            aria-pressed={ guideOpen }
            aria-label="Gesture guide"
            initial={ reduceMotion ? false : { opacity: 0, x: 14 } }
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...SNAPPY, delay: reduceMotion ? 0 : 0 * 0.045 }}
            whileHover={ reduceMotion ? undefined : { scale: 1.05 } }
            whileTap={ reduceMotion ? undefined : { scale: .94 } }
            onClick={ () => { playTick(); setGuideOpen((prev) => !prev); } }
          >
            <FaCircleQuestion aria-hidden="true" />
            Guide
          </motion.button>
        )
      }
      {
        graph.nodes.length > 0 && phase !== "diving" && (
          // The portrait — see the PORTRAIT_STYLED_SELECTOR constant
          // block. Continues the right-side column past Guide, the same
          // 44px rhythm the left-side column already keeps.
          <motion.button
            type="button"
            className="note-constellation-portrait"
            aria-label="Save a portrait of the constellation"
            initial={ reduceMotion ? false : { opacity: 0, x: 14 } }
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...SNAPPY, delay: reduceMotion ? 0 : 1 * 0.045 }}
            whileHover={ reduceMotion ? undefined : { scale: 1.05 } }
            whileTap={ reduceMotion ? undefined : { scale: .94 } }
            onClick={ capturePortrait }
          >
            <FaImagePortrait aria-hidden="true" />
            Portrait
          </motion.button>
        )
      }
      <AnimatePresence>
        {
          guideOpen && (
            // The field guide (see GUIDE_SECTIONS) — a right-hand column
            // in the floating-chrome card language, every gesture the
            // stage answers to grouped by which hands it asks for.
            // Reduced motion filters out the rows describing gestures
            // that stand down there, rather than listing dead promises.
            // Its own local Escape handler (stopPropagation, same fix
            // the search input already needed) keeps a press from
            // bubbling past this component to the panel's own
            // window-level Escape — see guideToggleRef's own comment for
            // why that would otherwise close the whole sheet instead of
            // just this overlay.
            <motion.aside
              className="note-constellation-guide"
              role="dialog"
              aria-label="Constellation gesture guide"
              initial={{ opacity: 0, x: 18 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 18, transition: { duration: .15 } }}
              transition={ SNAPPY }
              onKeyDown={ (e) => {
                if (e.key !== "Escape") return;
                e.preventDefault();
                e.stopPropagation();
                setGuideOpen(false);
                guideToggleRef.current?.focus();
              } }
            >
              <div className="note-constellation-guide-header">
                {/* The shared #liquid-text filter (mounted once in
                    Home.jsx) for its constant wet wobble, the same idle
                    ShortcutsSheet's own title already wears, layered with
                    a one-off blur-resolving entrance so the title actually
                    arrives wet rather than just idling that way once on
                    screen. Split across two nodes on purpose — framer's
                    own entrance leaves its `filter: blur()` as a lingering
                    inline style once settled, which on the SAME element as
                    .liquid-text would permanently outrank (and hide) that
                    class's own stylesheet filter for good. The outer span
                    owns the entrance; only the untouched inner span wears
                    .liquid-text, so the ambient wobble keeps running after. */}
                <motion.span
                  className="note-constellation-guide-title"
                  initial={ reduceMotion ? false : { opacity: 0, scale: .85, filter: "blur(3px)" } }
                  animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                  transition={{ ...SETTLE, delay: reduceMotion ? 0 : .1 }}
                >
                  <span className="liquid-text">Field guide</span>
                </motion.span>
                <motion.button
                  type="button"
                  className="note-constellation-guide-close"
                  aria-label="Close guide"
                  autoFocus
                  whileHover={ reduceMotion ? undefined : { scale: 1.15, rotate: 90 } }
                  whileTap={ reduceMotion ? undefined : { scale: .9 } }
                  transition={{ type: "spring", stiffness: 420, damping: 16 }}
                  onClick={ () => { setGuideOpen(false); guideToggleRef.current?.focus(); } }
                >
                  <FaXmark />
                </motion.button>
              </div>
              {
                GUIDE_SECTIONS.map((section) => {
                  const rows = section.rows.filter((row) => !row.motion || !reduceMotion);
                  if (rows.length === 0) return null;
                  return (
                    <div key={ section.title } className="note-constellation-guide-section">
                      <span className="note-constellation-guide-section-title">{ section.title }</span>
                      {
                        rows.map((row) => (
                          <div key={ row.text } className="note-constellation-guide-row">
                            <span className="note-constellation-guide-keys">
                              {
                                row.keys.map((key) => (
                                  <kbd key={ key } className="note-constellation-guide-key">{ key }</kbd>
                                ))
                              }
                            </span>
                            <span className="note-constellation-guide-text">{ row.text }</span>
                          </div>
                        ))
                      }
                    </div>
                  );
                })
              }
            </motion.aside>
          )
        }
      </AnimatePresence>
      {
        graph.nodes.length > 0 && phase !== "diving" && (
          // The layout law switcher — see the LAYOUT_MODES block. Bottom
          // center, the one position the floating chrome hadn't claimed
          // (minimap bottom-right, reshuffle/magnify bottom-left, status
          // top-center, lens rail top-left): the redesign's own primary
          // control earns the primary seat. A single segmented pill
          // rather than three siblings, since the three laws are one
          // mutually-exclusive choice, not three toggles.
          <div className="note-constellation-modes" role="group" aria-label="Layout mode">
            {
              LAYOUT_MODES.map(({ id, label, Icon }) => (
                <motion.button
                  key={ id }
                  type="button"
                  className={ `note-constellation-mode-chip ${ mode === id ? "active" : "" }` }
                  aria-pressed={ mode === id }
                  whileHover={ reduceMotion ? undefined : { scale: 1.05 } }
                  whileTap={ reduceMotion ? undefined : { scale: .94 } }
                  transition={ SNAPPY }
                  onClick={ () => switchMode(id) }
                >
                  {
                    // The active law's own indicator — one shared element
                    // (see the layoutId) that physically slides from chip
                    // to chip as the mode changes, the same technique
                    // NoteEditor's own editorPaletteRing already uses for
                    // its color dots, rather than each chip only fading
                    // its own background in place.
                    mode === id && (
                      <motion.span
                        layoutId="constellationModePill"
                        className="note-constellation-mode-pill"
                        transition={ SNAPPY }
                      />
                    )
                  }
                  <span className="note-constellation-mode-chip-content">
                    <Icon aria-hidden="true" />
                    { label }
                  </span>
                </motion.button>
              ))
            }
          </div>
        )
      }
      {
        tagCatalog.length > 0 && phase !== "diving" && (
          // The tag lens rail (see the LENS_MAX_TAGS constant block) —
          // top-left, mirroring the path-status pill's top-center and the
          // minimap's bottom-right, in the same floating-chrome pill
          // language as both. Chips cascade in with a small per-index
          // delay rather than landing as one block; reduce motion mounts
          // them already settled.
          <div className="note-constellation-lens" role="group" aria-label="Filter notes by tag">
            {
              // whileHover carries the lift rather than a CSS :hover
              // transform — framer already owns this element's inline
              // transform (entrance x, tap scale), and an inline transform
              // always beats a stylesheet one.
              tagCatalog.map(({ tag, count }, i) => (
                <motion.button
                  key={ tag }
                  type="button"
                  className={ `note-constellation-lens-chip ${ lensTag === tag ? "active" : "" }` }
                  onClick={ () => toggleLens(tag) }
                  initial={ reduceMotion ? false : { opacity: 0, x: -14 } }
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ ...SNAPPY, delay: reduceMotion ? 0 : i * 0.035 }}
                  whileHover={ reduceMotion ? undefined : { y: -1 } }
                  whileTap={ reduceMotion ? undefined : { scale: 0.94 } }
                >
                  #{ tag }
                  <span className="note-constellation-lens-count">{ count }</span>
                </motion.button>
              ))
            }
          </div>
        )
      }
      {
        graph.nodes.length > 0 && phase !== "diving" && (
          // Search — see the SEARCH_FIT_PADDING constant block. Top-right,
          // mirroring the tag lens rail's top-left; a plain icon pill that
          // blooms into an input on click or "/" (see handleKey), collapses
          // back to a pill on Escape or when it loses focus with nothing
          // typed. The match count and fly-to button only appear once
          // there's something to report — an empty, freshly-opened input
          // asks a question, it doesn't yet have an answer to show.
          <motion.div
            className={ `note-constellation-search ${ searchOpen ? "open" : "" }` }
            animate={{ width: searchOpen ? 268 : 40 }}
            transition={ SNAPPY }
          >
            <motion.button
              type="button"
              className="note-constellation-search-icon"
              aria-label={ searchOpen ? "Search notes" : "Open search" }
              whileHover={ reduceMotion ? undefined : { scale: 1.1 } }
              whileTap={ reduceMotion ? undefined : { scale: .9 } }
              transition={ SNAPPY }
              onClick={ () => {
                if (searchOpen) {
                  searchControllerRef.current?.flyToMatches(searchNodeIds);
                } else {
                  playTick();
                  setSearchOpen(true);
                  requestAnimationFrame(() => searchInputRef.current?.focus());
                }
              } }
            >
              <FaMagnifyingGlassLocation aria-hidden="true" />
            </motion.button>
            <input
              ref={ searchInputRef }
              type="text"
              className="note-constellation-search-input"
              placeholder="Find a note…"
              value={ searchQuery }
              tabIndex={ searchOpen ? 0 : -1 }
              onChange={ (e) => setSearchQuery(e.target.value) }
              onFocus={ () => setSearchOpen(true) }
              onBlur={ () => { if (!searchQuery) setSearchOpen(false); } }
              onKeyDown={ (e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  searchControllerRef.current?.flyToMatches(searchNodeIds);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setSearchQuery("");
                  setSearchOpen(false);
                  searchInputRef.current?.blur();
                }
              } }
            />
            {
              // A plain mount-time pop (no AnimatePresence — this only
              // ever needs an entrance, not an exit) rather than the
              // instant appearance it had before. Fires once when the
              // count first shows up, not on every keystroke after: React
              // keeps this same span mounted across a refined query, so
              // `initial` never re-triggers just because the number
              // inside it changed.
              searchNodeIds && (
                <motion.span
                  className="note-constellation-search-count"
                  initial={ reduceMotion ? false : { opacity: 0, scale: .6 } }
                  animate={{ opacity: 1, scale: 1 }}
                  transition={ POP }
                >
                  { searchNodeIds.size === 0 ? "No matches" : `${ searchNodeIds.size } found` }
                </motion.span>
              )
            }
          </motion.div>
        )
      }
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
                {
                  hoveredMeta && hoveredMeta.degree > 0 && (
                    <span className="note-constellation-card-meta">
                      { hoveredMeta.degree === 1 ? "1 thread" : `${ hoveredMeta.degree } threads` }
                      { hoveredMeta.region ? ` · ${ hoveredMeta.region }` : "" }
                    </span>
                  )
                }
              </div>
            </motion.div>
          )
        }
      </AnimatePresence>
      {/* The keyboard focus announcement (see the FOCUS_SPRING constant
          block) — visually hidden, politely spoken: each focused note by
          name, which is the reading the swimmer's ring gives sighted
          visitors. */}
      <div className="note-constellation-sr-only" aria-live="polite">
        { focusId ? ((graph.nodes.find((note) => note.id === focusId)?.title || "Untitled").trim() || "Untitled") : "" }
      </div>
      <AnimatePresence mode="wait">
        {
          pathStatus && (
            <motion.div
              key={ pathStatus.text }
              className={ `note-constellation-path-status ${ pathStatus.tone }` }
              initial={{ opacity: 0, y: -8, scale: .92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: .92, transition: { duration: .15 } }}
              transition={ SNAPPY }
            >
              { pathStatus.text }
            </motion.div>
          )
        }
      </AnimatePresence>
      {/* The portrait's own flash — see the PORTRAIT_FLASH_DURATION
          constant block. Deliberately OUTSIDE the svg being captured (so
          the flash itself is never part of the image), topmost of
          everything, driven by a direct GSAP tween inside
          capturePortrait rather than React state. Mounted at opacity 0
          and stays there until a capture actually fires. */}
      <div ref={ portraitFlashRef } className="note-constellation-portrait-flash" aria-hidden="true" />
    </>
  );
};

export default NoteConstellation;
