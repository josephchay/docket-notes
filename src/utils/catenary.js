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
export const catenaryPath = (x1, y1, x2, y2, { k, samples = 12, maxSag = 70, wobble = 1 } = {}) => {
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
    const localX = (i / samples) * dist;
    const localY = (a * coshHalf - a * Math.cosh((localX - half) / a)) * sagScale;

    points.push({
      x: x1 + localX * cosT - localY * sinT,
      y: y1 + localX * sinT + localY * cosT,
    });
  }

  return smoothPath(points);
};
