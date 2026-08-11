// The classic two-circle metaball bridge — the gooey "neck" of liquid that
// connects two nearby droplets, per the standard construction (Hiroyuki
// Sato's Illustrator metaball script, carried into the well-known Paper.js
// example most SVG gooey work descends from): find where each circle's
// silhouette should peel away toward the other (the tangent spread angles,
// blended by `v` between "kissing circles" and "fully wrapped"), then join
// those four peel-off points with two cubic Beziers whose handles run
// tangent to each circle — which is what reads as surface tension rather
// than a drawn shape. Geometry only, like utils/catenary.js: the caller
// owns when a bridge exists at all, what color it is, and what happens the
// instant it snaps.
//
// Deliberately only the NECK, not the full two-blob metaball outline: the
// blobs themselves are already drawn (and are wobbly Catmull-Rom rings, not
// true circles), so the near-side gaps are closed with plain lines and the
// whole shape is expected to be layered so its ends sit underneath (or
// color-matched over) the blobs that own them.
//
// `d2` is Sato's own handle-length factor: proportional to `v·handleRate`
// but capped by the neck's actual span over the two radii, then thinned as
// the circles close in — the term that makes a stretched neck go taut and
// a near-contact neck bulge, instead of one fixed curvature for both.
const HALF_PI = Math.PI / 2;

// The law-of-cosines ratios below can drift a hair outside [-1, 1] from
// float error right at tangency, and Math.acos returns NaN there rather
// than clamping on its own.
const clampAcos = (t) => Math.acos(Math.max(-1, Math.min(1, t)));

export const metaballBridge = (x1, y1, r1, x2, y2, r2, { v = 0.5, handleRate = 2.4, maxDist = null } = {}) => {
  const d = Math.hypot(x2 - x1, y2 - y1);
  const limit = maxDist ?? (r1 + r2) * 2;

  // No neck to draw: degenerate radii, centers on top of each other (no
  // direction to build from), too far apart to still cohere, or one
  // circle swallowed inside the other (the "neck" would be interior).
  if (r1 <= 0 || r2 <= 0 || d < 0.001 || d > limit || d <= Math.abs(r1 - r2)) return null;

  // Overlapping circles peel away from each other at their actual
  // intersection angles (law of cosines); separated circles start from
  // zero spread and let `v` open them toward the tangent limit.
  let u1 = 0;
  let u2 = 0;
  if (d < r1 + r2) {
    u1 = clampAcos((r1 * r1 + d * d - r2 * r2) / (2 * r1 * d));
    u2 = clampAcos((r2 * r2 + d * d - r1 * r1) / (2 * r2 * d));
  }

  const angleBetween = Math.atan2(y2 - y1, x2 - x1);
  const maxSpread = clampAcos((r1 - r2) / d);

  const angle1 = angleBetween + u1 + (maxSpread - u1) * v;
  const angle2 = angleBetween - u1 - (maxSpread - u1) * v;
  const angle3 = angleBetween + Math.PI - u2 - (Math.PI - u2 - maxSpread) * v;
  const angle4 = angleBetween - Math.PI + u2 + (Math.PI - u2 - maxSpread) * v;

  const p1x = x1 + Math.cos(angle1) * r1;
  const p1y = y1 + Math.sin(angle1) * r1;
  const p2x = x1 + Math.cos(angle2) * r1;
  const p2y = y1 + Math.sin(angle2) * r1;
  const p3x = x2 + Math.cos(angle3) * r2;
  const p3y = y2 + Math.sin(angle3) * r2;
  const p4x = x2 + Math.cos(angle4) * r2;
  const p4y = y2 + Math.sin(angle4) * r2;

  const totalRadius = r1 + r2;
  const d2 = Math.min(v * handleRate, Math.hypot(p3x - p1x, p3y - p1y) / totalRadius)
    * Math.min(1, (d * 2) / totalRadius);
  const handle1 = r1 * d2;
  const handle2 = r2 * d2;

  // Handles perpendicular to each peel-off point's own radius — i.e.
  // tangent to the circle there, which is what keeps the Bezier meeting
  // the circle's silhouette without a visible corner.
  const h1x = p1x + Math.cos(angle1 - HALF_PI) * handle1;
  const h1y = p1y + Math.sin(angle1 - HALF_PI) * handle1;
  const h2x = p2x + Math.cos(angle2 + HALF_PI) * handle1;
  const h2y = p2y + Math.sin(angle2 + HALF_PI) * handle1;
  const h3x = p3x + Math.cos(angle3 + HALF_PI) * handle2;
  const h3y = p3y + Math.sin(angle3 + HALF_PI) * handle2;
  const h4x = p4x + Math.cos(angle4 - HALF_PI) * handle2;
  const h4y = p4y + Math.sin(angle4 - HALF_PI) * handle2;

  return `M ${ p1x } ${ p1y } `
    + `C ${ h1x } ${ h1y } ${ h3x } ${ h3y } ${ p3x } ${ p3y } `
    + `L ${ p4x } ${ p4y } `
    + `C ${ h4x } ${ h4y } ${ h2x } ${ h2y } ${ p2x } ${ p2y } Z`;
};
