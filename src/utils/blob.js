import { interpolate } from "flubber";

// A closed, organic blob path inside a width×height box: `points` anchors
// spaced evenly around the box's center, each pushed out to a randomized
// fraction of the box's own half-extents, joined with a Catmull-Rom curve
// (converted to cubic beziers) so the outline has no hard corners — an
// actual hand-drawn ink silhouette, not a rectangle wearing a wobble.
export const blobPath = (width, height, points = 9, irregularity = 0.35, rng = Math.random) => {
  const cx = width / 2;
  const cy = height / 2;
  const rx = width / 2;
  const ry = height / 2;

  const pts = Array.from({ length: points }, (_, i) => {
    const angle = (i / points) * Math.PI * 2;
    const wobble = 1 - irregularity + rng() * irregularity * 2;
    return [
      cx + Math.cos(angle) * rx * wobble,
      cy + Math.sin(angle) * ry * wobble,
    ];
  });

  return closedCatmullRomPath(pts);
};

// A standard rounded rectangle, built from cubic beziers rather than arc
// commands — matching the blob paths' own curve type keeps flubber's
// point-sampling well-behaved and the morph untangled.
export const roundedRectPath = (width, height, radius) => {
  const r = Math.min(radius, width / 2, height / 2);
  const k = r * 0.5523; // cubic-bezier approximation of a quarter circle

  return [
    `M ${r} 0`,
    `L ${width - r} 0`,
    `C ${width - r + k} 0 ${width} ${r - k} ${width} ${r}`,
    `L ${width} ${height - r}`,
    `C ${width} ${height - r + k} ${width - r + k} ${height} ${width - r} ${height}`,
    `L ${r} ${height}`,
    `C ${r - k} ${height} 0 ${height - r + k} 0 ${height - r}`,
    `L 0 ${r}`,
    `C 0 ${r - k} ${r - k} 0 ${r} 0`,
    "Z",
  ].join(" ");
};

// Catmull-Rom spline through a closed ring of points, converted to a cubic
// bezier SVG path — the standard construction for a smooth curve that
// actually passes through every anchor, rather than merely curving toward
// them the way a quadratic approximation would. Exported (rather than left
// as blobPath's private helper) once NoteConstellation.jsx's cluster hulls
// needed the exact same closed-ring smoothing for convex hull outlines —
// same extract-don't-duplicate reasoning utils/catenary.js records for its
// own move out of TagThreads.jsx.
export const closedCatmullRomPath = (pts) => {
  const n = pts.length;
  const at = (i) => pts[(i + n) % n];

  let d = `M ${pts[0][0]} ${pts[0][1]} `;

  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);

    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;

    d += `C ${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]} `;
  }

  return `${d}Z`;
};

// Builds a player that steps one <path> element through a chain of closed
// shapes, using flubber's interpolate() for each adjacent pair — flubber
// resamples both paths into matched point sets and hands back a function
// that returns the in-between outline for any t in [0, 1], which is the
// actual "best-guess shape morph" this needs rather than a CSS property
// tween pretending to be one.
export const createBlobMorph = (pathEl, shapes) => {
  const stages = [];
  for (let i = 0; i < shapes.length - 1; i++) {
    stages.push(interpolate(shapes[i], shapes[i + 1], { maxSegmentLength: 6 }));
  }

  return {
    stageCount: stages.length,
    // t runs continuously from 0 to stageCount across the whole chain.
    set(t) {
      const clamped = Math.max(0, Math.min(t, stages.length));
      const stage = Math.min(Math.floor(clamped), stages.length - 1);
      const local = clamped - stage;
      pathEl.setAttribute("d", stages[stage](local));
    },
  };
};
