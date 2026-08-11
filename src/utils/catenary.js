import { smoothPath } from "./svgPath";

// The real catenary curve a rope hangs in under its own weight — y =
// a·cosh(x/a), not the parabola a plain quadratic bezier would quietly
// approximate — worked out in a local frame where the chord between the
// two endpoints is horizontal (the one case that formula directly solves),
// then rotated back into screen space. Extracted from TagThreads.jsx once
// NoteConstellation.jsx needed the exact same math for its own edges,
// rather than left to drift as two independently-tuned copies — the same
// reasoning utils/sph.js was pulled out for.
//
// `k` is the real catenary parameter's own denominator (a = span/k, see
// TagThreads.jsx's own comment on the derivation): a bigger k means a
// smaller `a`, and a smaller `a` is what makes the curve sag *harder* per
// unit span — counter-intuitive from the name alone, but it's the actual
// physical relationship (small a ≈ low horizontal tension relative to the
// rope's own weight, which is exactly what a slack rope's own shape reads
// as), not a naming choice worth second-guessing.
// `wave`/`wave2`/`wave3` superimpose a plucked-string displacement on top
// of the hanging shape: the first three standing-wave modes of a string
// fixed at both ends, spatial shapes sin(nπ·s) along the span (zero at
// both endpoints — the leading terms of the d'Alembert/Fourier solution
// to the wave equation with fixed boundaries). Three modes rather than
// one because a real pluck's SHAPE depends on where the string was
// plucked: the modal amplitudes are the Fourier coefficients of the
// pluck's own triangle, so an end-pluck rings visibly wrigglier than a
// mid-pluck (see NoteConstellation.jsx's pluckEdge for the coefficient
// math). The caller owns the time half of the solution per mode (each
// amplitude's own oscillation and decay, Aₙ·e^(−λₙt)·sin(ωₙt)) and
// passes only the current instantaneous displacements — this function
// stays a pure shape, same as it always was.
export const catenaryPath = (x1, y1, x2, y2, { k, samples = 12, maxSag = 70, wobble = 1, wave = 0, wave2 = 0, wave3 = 0 } = {}) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);

  // Overlapping/near-overlapping endpoints have no meaningful chord to
  // build a local frame from — a plain line covers that instant without
  // risking a division by (near) zero in the catenary math below.
  if (dist < 1) return `M ${ x1 } ${ y1 } L ${ x2 } ${ y2 }`;

  const theta = Math.atan2(dy, dx);
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  const a = (dist / k) * wobble;
  const half = dist / 2;
  const coshHalf = Math.cosh(half / a);

  // A hard cap on the midpoint sag — scaling the whole curve down rather
  // than clamping it flat keeps the catenary's actual shape (steep near
  // center, flattening toward the ends) intact even when a very long span
  // would otherwise droop further than reads well.
  const naturalSag = a * (coshHalf - 1);
  const sagScale = naturalSag > maxSag ? maxSag / naturalSag : 1;

  const points = [];
  for (let i = 0; i <= samples; i++) {
    const s = i / samples;
    const localX = s * dist;
    const localY = (a * coshHalf - a * Math.cosh((localX - half) / a)) * sagScale
      + wave * Math.sin(Math.PI * s)
      + wave2 * Math.sin(2 * Math.PI * s)
      + wave3 * Math.sin(3 * Math.PI * s);

    points.push({
      x: x1 + localX * cosT - localY * sinT,
      y: y1 + localX * sinT + localY * cosT,
    });
  }

  return smoothPath(points);
};

// The belly of that same curve — the drawn midpoint (parametric s = 0.5,
// where the sag and the standing wave both peak), computed with the exact
// same a/coshHalf/sagScale terms catenaryPath itself evaluates there,
// rather than left for a caller to re-derive and quietly drift from what's
// actually on screen. NoteConstellation.jsx's dew condensation hangs its
// droplets off this point; anything else that needs to touch "the lowest
// part of the thread" should come here too. Kept a separate function
// instead of a return-both refactor of catenaryPath so the hot path-string
// builder doesn't grow an allocation every caller but one would ignore.
export const catenaryBelly = (x1, y1, x2, y2, { k, maxSag = 70, wave = 0, wave3 = 0 } = {}) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);

  if (dist < 1) return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };

  const theta = Math.atan2(dy, dx);
  const a = dist / k;
  const half = dist / 2;
  const coshHalf = Math.cosh(half / a);
  const naturalSag = a * (coshHalf - 1);
  const sagScale = naturalSag > maxSag ? maxSag / naturalSag : 1;

  // At the midpoint: sin(π/2) = 1, sin(2π/2) = 0 (mode 2 has a node
  // there — nothing to add), sin(3π/2) = −1 — so the belly rides mode 1
  // fully, mode 3 inverted, exactly like the path's own center sample.
  const localY = naturalSag * sagScale + wave - wave3;

  return {
    x: x1 + half * Math.cos(theta) - localY * Math.sin(theta),
    y: y1 + half * Math.sin(theta) + localY * Math.cos(theta),
  };
};
