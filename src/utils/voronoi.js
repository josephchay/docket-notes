// Voronoi cells by direct half-plane clipping — each site's cell is, by
// definition, the set of points closer to it than to any other site,
// which is exactly the intersection of the half-planes bounded by the
// perpendicular bisectors between it and every other site. So each cell
// starts as the bounding box and gets clipped (Sutherland–Hodgman, the
// standard convex polygon clip) against one bisector per other site.
// O(n²·v) against Fortune's O(n log n) — chosen deliberately: at a
// personal desk's note counts the direct construction is comfortably
// per-frame cheap, dependency-free, and every line of it is the
// DEFINITION of a Voronoi diagram rather than an implementation of a
// sweepline whose correctness has to be taken on faith. The same honest
// tradeoff utils/hull.js already made picking monotone chain.
//
// The inside test never divides: p is closer to a than b exactly when
// 2p·(b−a) ≤ |b|²−|a|², a plain linear inequality (expand the two
// squared distances and cancel |p|²). The clip intersects each crossing
// edge with that same line by linear interpolation.

// Clip a convex polygon to the half-plane of points closer to (ax,ay)
// than to (bx,by).
const clipToBisector = (poly, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const c = (bx * bx - ax * ax + by * by - ay * ay) / 2;

  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const fp = p[0] * dx + p[1] * dy - c; // ≤ 0 means p is on the site's own side
    const fq = q[0] * dx + q[1] * dy - c;

    if (fp <= 0) out.push(p);
    if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) {
      const t = fp / (fp - fq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
};

// All cells for `sites` ([{x, y}, …]) within the axis-aligned box —
// returned in the same order as the sites, each an array of [x, y]
// vertices (possibly empty for a site clipped away entirely, which only
// happens with coincident sites).
export const voronoiCells = (sites, minX, minY, maxX, maxY) => {
  const box = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];

  return sites.map((site, i) => {
    let cell = box;
    for (let j = 0; j < sites.length && cell.length > 0; j++) {
      if (j === i) continue;
      const other = sites[j];
      // Coincident sites have no bisector — skip rather than divide by
      // a zero-length direction; the cells will simply coincide.
      if (other.x === site.x && other.y === site.y) continue;
      cell = clipToBisector(cell, site.x, site.y, other.x, other.y);
    }
    return cell;
  });
};
