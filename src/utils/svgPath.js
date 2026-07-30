// Turns a run of {x,y} points into a smooth SVG path — a cubic Bezier
// through each point via a Catmull-Rom conversion (each segment's control
// points come from the two neighboring points), so the curve actually
// passes through every data point instead of merely approximating them the
// way a generic spline-fit would.
export const smoothPath = (points) => {
  if (!points || points.length === 0) return "";
  if (points.length === 1) return `M${ points[0].x },${ points[0].y }`;

  const d = [`M${ points[0].x },${ points[0].y }`];

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d.push(`C${ cp1x },${ cp1y } ${ cp2x },${ cp2y } ${ p2.x },${ p2.y }`);
  }

  return d.join(" ");
};

// The same smooth line, closed down to a baseline — for a filled area
// beneath it rather than just the stroke.
export const smoothAreaPath = (points, baselineY) => {
  if (!points || points.length === 0) return "";

  const line = smoothPath(points);
  const first = points[0];
  const last = points[points.length - 1];

  return `${ line } L${ last.x },${ baselineY } L${ first.x },${ baselineY } Z`;
};
