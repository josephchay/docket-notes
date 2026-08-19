import { useEffect, useRef } from "react";
import * as THREE from "three";

import { resolveCssColor } from "../History/HistoryAmbient";

import "./EpicycleField.css";

THREE.ColorManagement.enabled = false;

// Epicycles — the same construction behind the Ptolemaic "circles on
// circles" model of planetary motion, and (unrelated history, identical
// mathematics) exactly what a discrete Fourier transform hands you for
// free: any closed path, treated as a sequence of complex numbers
// z_k = x_k + i·y_k, decomposes into N rotating vectors —
//   c_n = (1/N) · Σ_k z_k · exp(−i·2πnk/N)
// — each one a genuine circle: c_n's own magnitude |c_n| never changes as
// time runs, only its phase does, at a rate proportional to its own
// frequency n. Chain them tip-to-tail in order of decreasing |c_n| (the
// classic presentation, since that's the order that puts the visually
// dominant circles first) and the sum
//   z(t) = Σ_n c_n · exp(i·2πnt)
// traces the *exact* original path once every full period — this app's
// only panel whose content is something the visitor actually drew, not a
// procedural system reacting to disturbance. Reconstructing with only the
// first N_TERMS of the sorted list (rather than every term) is real
// low-pass filtering, not a decorative simplification — it's the same
// mathematics JPEG's own frequency truncation runs on, which is why a low
// term count visibly rounds off a sharp corner rather than just drawing a
// "simpler-looking" version of one.
//
// Every other Particles/ panel needs either an iterative solver (RK4,
// ping-pong GPU steps, N-body integration) or a stochastic process to
// reach an interesting state. This is the one closed-form exception: c_n
// above is an exact formula, computed once, instantly, the moment a
// drawing finishes — there is no "settle" or "burst" step anywhere in
// this file the way every other panel's own reduced-motion path needs,
// because there is nothing here that only becomes true after enough
// iterations. What animates afterward is a deterministic function of wall
// clock time alone (see tick() below), never of the previous frame's own
// state — reduced motion here means literally evaluating that same
// function at one fixed t instead of a moving one, nothing more.
const RESAMPLE_COUNT = 140; // points the drawn/preset path is resampled to before the DFT — also the maximum number of Fourier terms available afterward
const TARGET_RADIUS = 2.2; // every drawing is re-centered on its own centroid and rescaled to this radius, so a tiny scribble and a canvas-filling one both reconstruct at the same comfortable size
const VIEW_EXTENT = 5.5; // generous margin beyond TARGET_RADIUS — the chain's own intermediate partial sums can swing wider than the final traced path itself before "arriving," unlike the path's own bounded extent

const N_TERMS_MIN = 3;
const N_TERMS_MAX = 100;
const N_TERMS_DEFAULT = 40;

const CIRCLE_SEGMENTS = 28;
const GHOST_SAMPLES = 200; // resolution of the precomputed static "ghost" reconstruction, recomputed only on a new drawing or a term-count change, never per frame
const PERIOD_SECONDS = 8;
const MIN_POINT_SPACING = 0.05; // world units — raw drawn points closer together than this are skipped, so a slow drag doesn't pile up a huge redundant point list ahead of resampling
const REDUCED_MOTION_T = 0.2; // an arbitrary mid-chain snapshot, not t = 0 — every term's phase is trivially 0 at t = 0 regardless of its own frequency, which is a real but visually duller configuration than an actual mid-cycle moment

const VERT = `
  attribute float aAlpha;
  attribute float aSize;
  varying float vAlpha;
  uniform float uPixelRatio;

  void main() {
    vAlpha = aAlpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// The same soft round falloff every other Particles/ point cloud uses —
// spent here on a single point, the pen's own current tip.
const FRAG = `
  precision mediump float;
  varying float vAlpha;
  uniform vec3 uColor;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    float a = smoothstep(0.5, 0.0, d) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

// A closed 5-point star, generated parametrically rather than as a
// hand-listed point list — the default drawing a freshly opened panel
// shows before the visitor has drawn anything of their own. A star's own
// sharp points are exactly the kind of detail a low term count visibly
// rounds off (see the file header), which makes it a better opening
// choice than a shape with no sharp features to lose.
const defaultStarPoints = () => {
  const points = [];
  const spikes = 5;
  const outerR = 2.2, innerR = 0.9;
  const steps = spikes * 2;
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    points.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
  }
  return points;
};

// Re-centers on the centroid and rescales so the farthest point sits
// exactly at targetRadius — every drawing reconstructs at the same
// comfortable size regardless of where or how large it was actually drawn.
const normalizePoints = (rawPoints, targetRadius) => {
  let cx = 0, cy = 0;
  for (const p of rawPoints) { cx += p.x; cy += p.y; }
  cx /= rawPoints.length;
  cy /= rawPoints.length;

  let maxDist = 0.0001;
  for (const p of rawPoints) {
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d > maxDist) maxDist = d;
  }

  const scale = targetRadius / maxDist;
  return rawPoints.map((p) => ({ x: (p.x - cx) * scale, y: (p.y - cy) * scale }));
};

// Evenly-spaced-by-arc-length resampling — a two-pointer scan (targetLength
// only ever increases, so segIndex only ever advances, never backtracks),
// O(count) rather than O(count · rawPoints.length). Deliberately covers
// the half-open interval [0, totalLength) rather than including the exact
// endpoint: these count points feed a *periodic* DFT below, where the
// point at t = 1 is already identified with the one at t = 0.
const resamplePath = (rawPoints, count) => {
  if (rawPoints.length < 2) return rawPoints.slice();

  const segLengths = [];
  let totalLength = 0;
  for (let i = 1; i < rawPoints.length; i++) {
    const len = Math.hypot(rawPoints[i].x - rawPoints[i - 1].x, rawPoints[i].y - rawPoints[i - 1].y);
    segLengths.push(len);
    totalLength += len;
  }
  if (totalLength < 0.0001) return [rawPoints[0]];

  const result = [];
  let segIndex = 0;
  let segStart = 0;
  for (let i = 0; i < count; i++) {
    const targetLength = (i / count) * totalLength;
    while (segIndex < segLengths.length - 1 && segStart + segLengths[segIndex] < targetLength) {
      segStart += segLengths[segIndex];
      segIndex++;
    }
    const segLen = segLengths[segIndex] || 0.0001;
    const localT = Math.min(1, Math.max(0, (targetLength - segStart) / segLen));
    const p0 = rawPoints[segIndex];
    const p1 = rawPoints[segIndex + 1];
    result.push({
      x: p0.x + (p1.x - p0.x) * localT,
      y: p0.y + (p1.y - p0.y) * localT,
    });
  }
  return result;
};

// The discrete Fourier transform itself — see the file header for the
// formula and its derivation into plain re/im accumulation
// (exp(−iθ) = cos θ − i sin θ, multiplied out by hand rather than trusted
// blind). O(N²) against RESAMPLE_COUNT ≈ 140 is a few hundred thousand
// additions, computed once per drawing — nowhere near needing an FFT.
// Sorted by descending amplitude so index order already matches "most to
// least visually important," which is what lets the N_TERMS slider below
// just take a prefix of this array rather than re-selecting terms itself.
const computeDFT = (points) => {
  const N = points.length;
  const half = Math.floor(N / 2);
  const coeffs = [];
  for (let n = -half; n < N - half; n++) {
    let re = 0, im = 0;
    for (let k = 0; k < N; k++) {
      const theta = (2 * Math.PI * n * k) / N;
      const cosT = Math.cos(theta), sinT = Math.sin(theta);
      re += points[k].x * cosT + points[k].y * sinT;
      im += points[k].y * cosT - points[k].x * sinT;
    }
    coeffs.push({ freq: n, re: re / N, im: im / N, amp: Math.hypot(re / N, im / N) });
  }
  coeffs.sort((a, b) => b.amp - a.amp);
  return coeffs;
};

// The running chain of partial sums at time t, using only the first
// nTerms (already-sorted) coefficients — positions[0] is always the
// origin, positions[i] is the center of circle i / tip of vector i,
// positions[nTerms] is the pen's own current position. Each term's own
// contribution (dx, dy) = c_n · exp(i·2πnt), multiplied out the same
// explicit way as the DFT itself above rather than trusted blind.
const chainPositions = (coeffs, nTerms, t) => {
  const positions = [{ x: 0, y: 0 }];
  let x = 0, y = 0;
  const count = Math.min(nTerms, coeffs.length);
  for (let i = 0; i < count; i++) {
    const c = coeffs[i];
    const phi = 2 * Math.PI * c.freq * t;
    const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
    x += c.re * cosPhi - c.im * sinPhi;
    y += c.re * sinPhi + c.im * cosPhi;
    positions.push({ x, y });
  }
  return positions;
};

// The full static reconstruction, sampled at GHOST_SAMPLES points across
// one whole period — a plain closed polyline, recomputed only when the
// coefficients or nTerms change, never per animation frame.
const computeGhostPath = (coeffs, nTerms) => {
  const pts = [];
  for (let i = 0; i <= GHOST_SAMPLES; i++) {
    const chain = chainPositions(coeffs, nTerms, i / GHOST_SAMPLES);
    pts.push(chain[chain.length - 1]);
  }
  return pts;
};

// active/reduceMotion follow every other Particles/ field's own contract.
// nTerms is read fresh every frame via a ref, so EpicyclePanel's own
// slider retunes both the live animation and the static ghost path
// immediately — no reset needed, the coefficients themselves never change,
// only how many of them get used. onDraw fires once per finished stroke
// with the point count actually captured, purely for EpicyclePanel's own
// hint copy.
const EpicycleField = ({ active, reduceMotion = false, nTerms = N_TERMS_DEFAULT, onDraw }) => {
  const canvasRef = useRef(null);
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  const nTermsRef = useRef(nTerms);
  nTermsRef.current = nTerms;
  const onDrawRef = useRef(onDraw);
  useEffect(() => { onDrawRef.current = onDraw; });

  useEffect(() => {
    if (!active) return undefined;

    const canvas = canvasRef.current;
    const parent = canvas.parentElement;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);

    const scene = new THREE.Scene();
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

    // A unit circle template, built once — every one of the up to
    // N_TERMS_MAX drawn circles reuses it every frame (scale by that
    // term's own fixed radius, translate by its current center) rather
    // than re-evaluating CIRCLE_SEGMENTS worth of cos/sin per circle per
    // frame for a shape whose own local geometry never actually changes.
    const unitCircle = Array.from({ length: CIRCLE_SEGMENTS }, (_, i) => {
      const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
      return { x: Math.cos(a), y: Math.sin(a) };
    });

    let coeffs = computeDFT(resamplePath(defaultStarPoints(), RESAMPLE_COUNT));
    let ghostPoints = computeGhostPath(coeffs, nTermsRef.current);

    // Circles: LineSegments (not one LineLoop per circle — a single draw
    // call and a single attribute upload for up to N_TERMS_MAX circles,
    // rather than that many separate Object3Ds/draw calls every frame),
    // CIRCLE_SEGMENTS segments closing each circle back on itself.
    const circleVertCount = N_TERMS_MAX * CIRCLE_SEGMENTS * 2;
    const circlePositions = new Float32Array(circleVertCount * 3);
    const circleGeometry = new THREE.BufferGeometry();
    circleGeometry.setAttribute("position", new THREE.BufferAttribute(circlePositions, 3));
    const circleMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color(resolveCssColor("var(--page-ink-color)")),
      transparent: true,
      opacity: 0.16,
    });
    const circleLines = new THREE.LineSegments(circleGeometry, circleMaterial);
    scene.add(circleLines);

    // Radius vectors: one segment per term, from the previous running
    // center to the next — a touch bolder than the circles themselves so
    // the "arm" driving each circle stays legible against them.
    const radiusPositions = new Float32Array(N_TERMS_MAX * 2 * 3);
    const radiusGeometry = new THREE.BufferGeometry();
    radiusGeometry.setAttribute("position", new THREE.BufferAttribute(radiusPositions, 3));
    const radiusMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color(resolveCssColor("var(--page-ink-color)")),
      transparent: true,
      opacity: 0.5,
    });
    const radiusLines = new THREE.LineSegments(radiusGeometry, radiusMaterial);
    scene.add(radiusLines);

    // The static full reconstruction — a plain closed polyline, very
    // faint, always fully visible underneath the animating chain above it.
    const ghostPositions = new Float32Array((GHOST_SAMPLES + 1) * 3);
    const ghostGeometry = new THREE.BufferGeometry();
    ghostGeometry.setAttribute("position", new THREE.BufferAttribute(ghostPositions, 3));
    const ghostMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color(resolveCssColor("var(--page-ink-color)")),
      transparent: true,
      opacity: 0.22,
    });
    const ghostLine = new THREE.Line(ghostGeometry, ghostMaterial);
    scene.add(ghostLine);

    // The pen's own current tip — one point, the same soft-point shader
    // every other Particles/ demo's own point cloud uses.
    const tipPositions = new Float32Array(3);
    const tipAlphas = new Float32Array([0.9]);
    const tipSizes = new Float32Array([8]);
    const tipGeometry = new THREE.BufferGeometry();
    tipGeometry.setAttribute("position", new THREE.BufferAttribute(tipPositions, 3));
    tipGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(tipAlphas, 1));
    tipGeometry.setAttribute("aSize", new THREE.BufferAttribute(tipSizes, 1));
    const tipUniforms = {
      uPixelRatio: { value: dpr },
      uColor: { value: new THREE.Color(resolveCssColor("var(--page-ink-color)")) },
    };
    const tipMaterial = new THREE.ShaderMaterial({
      uniforms: tipUniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const tipPoint = new THREE.Points(tipGeometry, tipMaterial);
    scene.add(tipPoint);

    const themeObserver = new MutationObserver(() => {
      const ink = resolveCssColor("var(--page-ink-color)");
      circleMaterial.color.set(ink);
      radiusMaterial.color.set(ink);
      ghostMaterial.color.set(ink);
      tipUniforms.uColor.value.set(ink);
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const writeGhost = () => {
      for (let i = 0; i <= GHOST_SAMPLES; i++) {
        const p = ghostPoints[i] || ghostPoints[ghostPoints.length - 1];
        ghostPositions[i * 3] = p.x;
        ghostPositions[i * 3 + 1] = p.y;
        ghostPositions[i * 3 + 2] = 0;
      }
      ghostGeometry.attributes.position.needsUpdate = true;
    };
    writeGhost();

    // One frame of the animating chain — a pure function of t (see the
    // file header: nothing here reads or writes any state carried over
    // from the previous frame), so calling it with a fixed t under
    // reduced motion is exactly as correct as calling it with a moving
    // one, not an approximation of it.
    const drawChain = (t) => {
      const chain = chainPositions(coeffs, nTermsRef.current, t);
      const count = chain.length - 1; // number of actual terms drawn this frame

      for (let i = 0; i < count; i++) {
        const center = chain[i];
        const radius = coeffs[i].amp;
        const base = i * CIRCLE_SEGMENTS * 2;
        for (let s = 0; s < CIRCLE_SEGMENTS; s++) {
          const a = unitCircle[s];
          const b = unitCircle[(s + 1) % CIRCLE_SEGMENTS];
          const idx = (base + s * 2) * 3;
          circlePositions[idx] = center.x + a.x * radius;
          circlePositions[idx + 1] = center.y + a.y * radius;
          circlePositions[idx + 2] = 0;
          circlePositions[idx + 3] = center.x + b.x * radius;
          circlePositions[idx + 4] = center.y + b.y * radius;
          circlePositions[idx + 5] = 0;
        }

        const from = chain[i];
        const to = chain[i + 1];
        const ridx = i * 2 * 3;
        radiusPositions[ridx] = from.x;
        radiusPositions[ridx + 1] = from.y;
        radiusPositions[ridx + 2] = 0;
        radiusPositions[ridx + 3] = to.x;
        radiusPositions[ridx + 4] = to.y;
        radiusPositions[ridx + 5] = 0;
      }

      circleGeometry.attributes.position.needsUpdate = true;
      circleGeometry.setDrawRange(0, count * CIRCLE_SEGMENTS * 2);
      radiusGeometry.attributes.position.needsUpdate = true;
      radiusGeometry.setDrawRange(0, count * 2);

      const tip = chain[chain.length - 1];
      tipPositions[0] = tip.x;
      tipPositions[1] = tip.y;
      tipPositions[2] = 0;
      tipGeometry.attributes.position.needsUpdate = true;
    };

    // Drag to draw: raw world-space samples while the pointer is down
    // (throttled to MIN_POINT_SPACING so a slow drag doesn't pile up a
    // huge redundant point list), replaced on release by the normalized,
    // resampled, DFT'd reconstruction of exactly that stroke. A gesture
    // too short to be a real drawing (fewer than 3 points) is simply
    // dropped — the previous reconstruction stays exactly as it was
    // rather than collapsing into a degenerate one.
    let drawing = false;
    let rawPoints = [];
    const ndcFromEvent = (e) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: -(((e.clientY - rect.top) / rect.height) * 2 - 1),
      };
    };
    const worldFromNdc = (ndc) => new THREE.Vector3(ndc.x, ndc.y, 0).unproject(camera);

    const handlePointerDown = (e) => {
      drawing = true;
      const w = worldFromNdc(ndcFromEvent(e));
      rawPoints = [{ x: w.x, y: w.y }];
    };
    const handlePointerMove = (e) => {
      if (!drawing) return;
      const w = worldFromNdc(ndcFromEvent(e));
      const last = rawPoints[rawPoints.length - 1];
      if (Math.hypot(w.x - last.x, w.y - last.y) >= MIN_POINT_SPACING) {
        rawPoints.push({ x: w.x, y: w.y });
      }
    };
    const handlePointerUp = () => {
      if (!drawing) return;
      drawing = false;
      if (rawPoints.length < 3) return;

      coeffs = computeDFT(resamplePath(normalizePoints(rawPoints, TARGET_RADIUS), RESAMPLE_COUNT));
      ghostPoints = computeGhostPath(coeffs, nTermsRef.current);
      writeGhost();
      onDrawRef.current?.(rawPoints.length);

      if (reduceMotionRef.current) drawChain(REDUCED_MOTION_T);
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    let raf = null;
    const startTime = performance.now();
    // Retuning nTerms via the panel's own slider needs the static ghost
    // path recomputed too (fewer/more terms genuinely changes what it
    // looks like), which the per-frame chain redraw alone won't do — a
    // plain equality check against tick()'s own already-running per-frame
    // loop below costs nothing extra to ask, so there's no reason to reach
    // for a separate timer just to ask it less often.
    let lastNTerms = nTermsRef.current;

    const tick = () => {
      raf = requestAnimationFrame(tick);

      if (nTermsRef.current !== lastNTerms) {
        lastNTerms = nTermsRef.current;
        ghostPoints = computeGhostPath(coeffs, lastNTerms);
        writeGhost();
      }

      if (reduceMotionRef.current) {
        drawChain(REDUCED_MOTION_T);
      } else {
        const elapsed = (performance.now() - startTime) / 1000;
        const t = (elapsed % PERIOD_SECONDS) / PERIOD_SECONDS;
        drawChain(t);
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
      canvas.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      circleGeometry.dispose();
      circleMaterial.dispose();
      radiusGeometry.dispose();
      radiusMaterial.dispose();
      ghostGeometry.dispose();
      ghostMaterial.dispose();
      tipGeometry.dispose();
      tipMaterial.dispose();
      renderer.dispose();
    };
  }, [active]);

  return (
    <canvas
      ref={ canvasRef }
      className="epicycle-field-canvas"
      aria-hidden="true"
    />
  );
};

export { N_TERMS_MIN, N_TERMS_MAX, N_TERMS_DEFAULT, RESAMPLE_COUNT };
export default EpicycleField;
