import { useEffect, useRef } from "react";
import * as THREE from "three";

import { resolveCssColor } from "../History/HistoryAmbient";

import "./LSystemField.css";

THREE.ColorManagement.enabled = false;

// L-systems — Aristid Lindenmayer's 1968 formal grammar for modeling real
// plant cell development (Lindenmayer, "Mathematical Models for Cellular
// Interaction in Development"), later popularized as a generative-art
// technique in Prusinkiewicz & Lindenmayer's "The Algorithmic Beauty of
// Plants." A genuinely different KIND of mathematics from everything else
// in this app: every other Particles/ demo evolves a numeric state forward
// through time (positions, velocities, a scalar field); an L-system
// evolves a *string* forward through repeated rewriting — start from an
// axiom, replace every symbol using a small set of production rules,
// repeat — with no notion of time, physics, or continuous space anywhere
// in the grammar itself. Only afterward does a "turtle" walk the finished
// string and turn it into geometry: F draws forward, +/− turn, [ and ]
// push/pop the turtle's own position and heading (real stack operations —
// what makes a branch a branch is that ] returns the turtle to exactly
// where its [ found it, so a side-branch and the trunk it grew from both
// continue from the same real fork point).
//
// The three presets below are the standard, widely-reproduced examples
// from exactly that literature — a plant (axiom X, X → F+[[X]−X]−F[−FX]+X,
// F → FF), a simpler ternary tree (F → F[+F]F[−F][F]), and the Koch
// snowflake (a closed triangle, F → F−F++F−F) — not derived here, cited
// the same "a real published formulation" way FluidField.jsx's Müller/
// Charypar/Gross citation and ChladniField.jsx's own eigenmode combination
// already are. Segment counts DO grow fast under repeated rewriting
// (checked by hand per preset below, not guessed): the plant's own X → 4
// new X's each iteration compounds with F → FF's doubling into f_n =
// 2f_{n-1} + 3·4^{n-1}, reaching ~1,488 segments at 5 iterations and
// ~6,048 at 6; the ternary tree's flat 5× growth per F reaches 3,125 at 5
// and 15,625 at 6; Koch's 4× growth from a 3-F axiom reaches 3,072 at 5
// and 12,288 at 6 — which is why every preset caps at 5 iterations
// (comfortably under MAX_SEGMENTS below for all three), backed by a hard
// stop in the interpreter itself as a real ceiling regardless.
const VIEW_EXTENT = 4.5;
const TARGET_HEIGHT = 7; // the grown shape's own height after normalizing, leaving margin inside 2 · VIEW_EXTENT
const MAX_SEGMENTS = 4000;
const GROWTH_DURATION = 3.5; // seconds — a one-shot animation, not a loop: watching a plant grow once and then admire it, not regrow forever

export const ITERATIONS_MIN = 1;
export const ITERATIONS_MAX = 5;
export const DEFAULT_ITERATIONS = 4;

// Symbols beyond F/+/−/[/] (X, G, Y, ...) are pure grammar placeholders —
// they exist only so a rule can reference "become something more complex
// later," and carry no turtle action of their own, exactly as real
// L-system notation uses them.
export const PRESETS = [
  {
    key: "plant",
    label: "Fern",
    axiom: "X",
    rules: { X: "F+[[X]-X]-F[-FX]+X", F: "FF" },
    angleDeg: 25,
  },
  {
    key: "tree",
    label: "Tree",
    axiom: "F",
    rules: { F: "F[+F]F[-F][F]" },
    angleDeg: 25.7,
  },
  {
    key: "koch",
    label: "Snowflake",
    axiom: "F++F++F",
    rules: { F: "F-F++F-F" },
    angleDeg: 60,
  },
];

// Plain string rewriting — every symbol replaced by its own rule (or left
// unchanged if it has none, exactly how +/−/[/] themselves pass through
// untouched every iteration).
const expandLSystem = (axiom, rules, iterations) => {
  let current = axiom;
  for (let i = 0; i < iterations; i++) {
    let next = "";
    for (const ch of current) next += rules[ch] || ch;
    current = next;
  }
  return current;
};

// The turtle walk — see the file header for what each symbol does. depth
// (the live stack size while F draws a given segment) rides along per
// segment purely for display (see writeGrowthBuffer's own depth -> alpha
// mapping below), not for the geometry itself. Hard-stops at MAX_SEGMENTS
// regardless of how the string itself grew, the real ceiling the file
// header's own growth-rate arithmetic is a *justification* for, not a
// substitute for.
const interpretLSystem = (str, angleDeg, stepLength) => {
  const angle = (angleDeg * Math.PI) / 180;
  const segments = [];
  const stack = [];
  let x = 0, y = 0, heading = Math.PI / 2;

  for (let i = 0; i < str.length && segments.length < MAX_SEGMENTS; i++) {
    const ch = str[i];
    if (ch === "F" || ch === "G") {
      const nx = x + Math.cos(heading) * stepLength;
      const ny = y + Math.sin(heading) * stepLength;
      segments.push({ x1: x, y1: y, x2: nx, y2: ny, depth: stack.length });
      x = nx; y = ny;
    } else if (ch === "+") {
      heading += angle;
    } else if (ch === "-") {
      heading -= angle;
    } else if (ch === "[") {
      stack.push({ x, y, heading });
    } else if (ch === "]") {
      const s = stack.pop();
      if (s) { x = s.x; y = s.y; heading = s.heading; }
    }
  }
  return segments;
};

// Re-centers horizontally on the bounding box's own midpoint and rescales
// to TARGET_HEIGHT, rooted near the bottom of the view — like a real
// plant, anchored at the ground rather than floating centered in the
// frame the way a radially-symmetric shape (ChladniField's own grains,
// EpicycleField's own drawing) reasonably would be instead.
const normalizeSegments = (segments, targetHeight) => {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of segments) {
    minX = Math.min(minX, s.x1, s.x2); maxX = Math.max(maxX, s.x1, s.x2);
    minY = Math.min(minY, s.y1, s.y2); maxY = Math.max(maxY, s.y1, s.y2);
  }
  const height = Math.max(maxY - minY, 0.0001);
  const scale = targetHeight / height;
  const cx = (minX + maxX) / 2;
  const rootY = -targetHeight / 2;
  return segments.map((s) => ({
    x1: (s.x1 - cx) * scale, y1: (s.y1 - minY) * scale + rootY,
    x2: (s.x2 - cx) * scale, y2: (s.y2 - minY) * scale + rootY,
    depth: s.depth,
  }));
};

const VERT_LINES = `
  attribute float aAlpha;
  varying float vAlpha;

  void main() {
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG_LINES = `
  precision mediump float;
  varying float vAlpha;
  uniform vec3 uColor;

  void main() {
    gl_FragColor = vec4(uColor, vAlpha);
  }
`;

// active/reduceMotion follow every other Particles/ field's own contract.
// preset/iterations are read fresh via refs and applied through an
// imperative regrow() (ref-bridged, the same pattern CrystalField's own
// "New crystal" and PendulumField's own "Release" already use) rather than
// sitting in the main effect's own dependency array — that would tear down
// and recreate the WebGLRenderer on every preset click or slider tick,
// something no other Particles/ panel does and this one has no real
// reason to be the first to risk (repeatedly re-acquiring a WebGL context
// on the same canvas is a well-known source of subtle browser-dependent
// state bugs). A different ruleset or iteration count is a genuinely
// different shape, not a smooth variation of the current one, so regrow()
// always restarts the growth animation from scratch rather than trying to
// blend into the new one.
const LSystemField = ({
  active,
  reduceMotion = false,
  preset = PRESETS[0],
  iterations = DEFAULT_ITERATIONS,
  regrowToken = 0,
}) => {
  const canvasRef = useRef(null);
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  const presetRef = useRef(preset);
  presetRef.current = preset;
  const iterationsRef = useRef(iterations);
  iterationsRef.current = iterations;
  const regrowFnRef = useRef(null);

  useEffect(() => {
    if (!active) return undefined;

    const canvas = canvasRef.current;
    const parent = canvas.parentElement;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);

    const camera = new THREE.OrthographicCamera(-VIEW_EXTENT, VIEW_EXTENT, VIEW_EXTENT, -VIEW_EXTENT, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    const resize = () => {
      const w = parent.clientWidth || 1;
      const h = parent.clientHeight || 1;
      renderer.setSize(w, h, false);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(parent);

    const positions = new Float32Array(MAX_SEGMENTS * 2 * 3);
    const alphas = new Float32Array(MAX_SEGMENTS * 2);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));

    const uniforms = { uColor: { value: new THREE.Color(resolveCssColor("var(--page-ink-color)")) } };
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT_LINES,
      fragmentShader: FRAG_LINES,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(geometry, material);
    const scene = new THREE.Scene();
    scene.add(lines);

    const themeObserver = new MutationObserver(() => {
      uniforms.uColor.value.set(resolveCssColor("var(--page-ink-color)"));
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    // grownCount segments draw in full; the segment at index grownCount
    // (if any) draws partway, from its own start toward its end by
    // partialT — a branch visibly unfurling stroke by stroke rather than
    // popping fully drawn into place. Deeper branches (higher stack depth
    // at the moment they were drawn) render a touch fainter — the same
    // "smaller/later growth reads as more delicate" cue real botanical
    // illustration already uses, cheap here since depth was already
    // tracked per segment during the turtle walk above.
    let segments = [];
    let maxDepth = 1;
    const writeGrowthBuffer = (grownCount, partialT) => {
      const total = segments.length;
      for (let i = 0; i < total; i++) {
        const s = segments[i];
        const alpha = 1 - 0.45 * (s.depth / maxDepth);
        let ex = s.x2, ey = s.y2;
        let a = alpha;

        if (i > grownCount) {
          ex = s.x1; ey = s.y1; a = 0;
        } else if (i === grownCount) {
          ex = s.x1 + (s.x2 - s.x1) * partialT;
          ey = s.y1 + (s.y2 - s.y1) * partialT;
        }

        const idx = i * 2;
        positions[idx * 3] = s.x1; positions[idx * 3 + 1] = s.y1; positions[idx * 3 + 2] = 0;
        positions[idx * 3 + 3] = ex; positions[idx * 3 + 4] = ey; positions[idx * 3 + 5] = 0;
        alphas[idx] = a; alphas[idx + 1] = a;
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.aAlpha.needsUpdate = true;
      geometry.setDrawRange(0, total * 2);
    };

    let growthStart = performance.now();

    // Generates fresh segments for whatever preset/iterations are current
    // right now and restarts the growth clock — the one place this file
    // actually regenerates anything, called once at setup below and again
    // by the panel's own preset buttons / iteration slider via
    // regrowFnRef.
    const regrow = () => {
      const raw = expandLSystem(presetRef.current.axiom, presetRef.current.rules, iterationsRef.current);
      // Step length chosen so the RAW (unnormalized) walk is already a
      // reasonable size before normalizeSegments rescales it exactly to
      // TARGET_HEIGHT regardless — the actual value barely matters, but a
      // wildly wrong one risks the bounding-box math above dividing by
      // something degenerate.
      const rawSegments = interpretLSystem(raw, presetRef.current.angleDeg, 1);
      segments = normalizeSegments(rawSegments, TARGET_HEIGHT);
      maxDepth = 1;
      for (const s of segments) maxDepth = Math.max(maxDepth, s.depth);
      growthStart = performance.now();

      // Reduced motion skips straight to the finished shape — trivial
      // here since every segment's own final endpoint is already known
      // exactly, the same "a closed form needs no burst, just evaluate it
      // at the end state" simplicity EpicycleField.jsx's own reduced-
      // motion path already has.
      writeGrowthBuffer(reduceMotionRef.current ? segments.length : 0, reduceMotionRef.current ? 1 : 0);
    };
    regrowFnRef.current = regrow;
    regrow();

    let raf = null;

    const tick = () => {
      raf = requestAnimationFrame(tick);

      if (!reduceMotionRef.current) {
        const elapsed = (performance.now() - growthStart) / 1000;
        const t = Math.min(1, elapsed / GROWTH_DURATION);
        const exact = t * segments.length;
        const grownCount = Math.floor(exact);
        const partialT = exact - grownCount;
        writeGrowthBuffer(grownCount, partialT);
      }

      renderer.render(scene, camera);
    };

    const handleVisibility = () => {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = null;
      } else if (!raf) {
        tick();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    tick();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", handleVisibility);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      regrowFnRef.current = null;
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [active]);

  // The panel's own preset buttons and iteration slider both funnel
  // through here — presetRef/iterationsRef are already fresh by the time
  // this runs (refs are assigned unconditionally above, every render), so
  // regrow() always reads whatever the visitor most recently chose.
  useEffect(() => {
    regrowFnRef.current?.();
  }, [preset, iterations]);

  // The panel's own "Regrow" button bumps regrowToken — guarded to >0 so
  // mounting never fires a redundant regrow on top of the one the effect
  // above already triggers on a genuine preset/iteration change. Needed
  // because re-clicking the *same* already-active preset changes nothing
  // React would treat as a real prop change (same object reference), so
  // there'd otherwise be no way to replay the growth animation without
  // first switching away and back.
  useEffect(() => {
    if (regrowToken > 0) regrowFnRef.current?.();
  }, [regrowToken]);

  return (
    <canvas
      ref={ canvasRef }
      className="lsystem-field-canvas"
      aria-hidden="true"
    />
  );
};

export default LSystemField;
