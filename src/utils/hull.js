// Convex hulls — Andrew's monotone chain (A. M. Andrew, "Another efficient
// algorithm for convex hulls in two dimensions", Information Processing
// Letters, 1979), the standard O(n log n) construction: sort points once by
// x (then y), then build the lower and upper chains in a single pass each,
// popping any vertex that would introduce a clockwise turn. Simpler to
// verify by hand than Graham scan (no angular sort, no pivot selection) at
// the same complexity — the same "easier to get right" reasoning
// utils/quadtree.js's own two-pass construction already follows.
//
// Points are [x, y] pairs (matching utils/blob.js's own point format, since
// the one current caller feeds the result straight into a closed
// Catmull-Rom path from there), and the returned hull is in
// counter-clockwise order in standard math coordinates — which reads as
// clockwise on screen, where y grows downward; nothing in this module
// depends on which of the two conventions the caller is thinking in.

const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

export const convexHull = (points) => {
  if (points.length < 3) return points.slice();

  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }

  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }

  // Each chain's last point is the other chain's first — drop both
  // duplicates when concatenating.
  lower.pop();
  upper.pop();
  return lower.concat(upper);
};

// Pushes every hull vertex outward from the hull's own centroid by `pad` —
// growing the hull into a padded ring with breathing room around whatever
// it encloses. Centroid-outward rather than a true constant-width offset
// (per-vertex edge normals plus join handling): convexity guarantees the
// centroid sits strictly inside, so "away from centroid" is always a valid
// outward direction, and the padding a very elongated hull loses across its
// waist is invisible at the soft-edged, low-opacity rendering the one
// current caller draws this with — the same looks-right-over-machinist-
// precision tradeoff NoteConstellation.jsx's own BARNES_HUT_THETA already
// makes explicit.
//
// Degenerate inputs get honest fallbacks rather than NaN geometry: two
// points (a fully collinear "hull", which a moving simulation can pass
// through transiently) become a diamond around their shared segment, one
// point becomes a diamond around itself — both close into a sensible
// ink-pool ring downstream instead of a zero-area sliver.
// Point-in-polygon by ray casting (Franklin's PNPOLY formulation of the
// Jordan curve theorem): shoot a ray from the query point toward +x and
// count edge crossings — odd means inside. The half-open comparison
// ((yi > y) !== (yj > y)) is the standard guard against double-counting a
// crossing that lands exactly on a vertex. Works for any simple polygon;
// the one current caller happens to pass convex hull rings, but nothing
// here relies on convexity.
export const pointInPolygon = (x, y, polygon) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

export const expandHull = (hull, pad) => {
  if (hull.length === 1) {
    const [x, y] = hull[0];
    return [[x - pad, y], [x, y - pad], [x + pad, y], [x, y + pad]];
  }

  if (hull.length === 2) {
    const [a, b] = hull;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    // Perpendicular bulge at each midpoint side, extension past each end —
    // a diamond stretched along the segment.
    return [
      [a[0] - ux * pad, a[1] - uy * pad],
      [(a[0] + b[0]) / 2 - uy * pad, (a[1] + b[1]) / 2 + ux * pad],
      [b[0] + ux * pad, b[1] + uy * pad],
      [(a[0] + b[0]) / 2 + uy * pad, (a[1] + b[1]) / 2 - ux * pad],
    ];
  }

  let cx = 0;
  let cy = 0;
  for (const [x, y] of hull) {
    cx += x;
    cy += y;
  }
  cx /= hull.length;
  cy /= hull.length;

  return hull.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.hypot(dx, dy) || 1;
    return [x + (dx / dist) * pad, y + (dy / dist) * pad];
  });
};
