// A Barnes-Hut quadtree (Barnes & Hut, "A hierarchical O(N log N)
// force-calculation algorithm", Nature, 1986) — the standard technique for
// approximating all-pairs force sums (gravity, charge repulsion, a
// force-directed graph's own node repulsion) in O(n log n) instead of
// O(n²): recursively bucket points into a quadtree, then for any given
// query point, a whole distant subtree gets treated as a single aggregate
// point at its own center of mass rather than visited one member at a
// time. This class is deliberately agnostic about what the force actually
// represents — see accumulateForce's own `force` callback — it only knows
// how to decide when an aggregate is a trustworthy stand-in for its
// members, not what law governs the force itself.
//
// Two-pass construction (build the tree's own bucket structure first via
// insert(), then a separate finalize() computes every node's center of
// mass bottom-up) rather than updating each center of mass incrementally
// as points are inserted — the incremental running-mean update is a classic
// source of off-by-one bugs (exactly when does a node's own count include
// the point currently being inserted); two passes are easier to get right
// and to verify by hand.
const MAX_DEPTH_DEFAULT = 24;

const makeNode = (x, y, size) => ({ x, y, size, children: null, point: null, count: 0, centerX: 0, centerY: 0 });

// Which of the 4 children (0=top-left, 1=top-right, 2=bottom-left,
// 3=bottom-right) a point at (px, py) falls into, given node's own bounds.
const childIndexFor = (node, px, py) => {
  const midX = node.x + node.size / 2;
  const midY = node.y + node.size / 2;
  const right = px >= midX ? 1 : 0;
  const bottom = py >= midY ? 1 : 0;
  return bottom * 2 + right;
};

const childBounds = (node, index) => {
  const half = node.size / 2;
  const right = index % 2;
  const bottom = index >> 1;
  return { x: node.x + right * half, y: node.y + bottom * half, size: half };
};

const subdivide = (node) => {
  node.children = [0, 1, 2, 3].map((i) => {
    const b = childBounds(node, i);
    return makeNode(b.x, b.y, b.size);
  });
};

const insertPoint = (node, point, depth, maxDepth) => {
  if (node.count === 0) {
    node.point = point;
    node.count = 1;
    return;
  }

  if (!node.children) {
    if (depth >= maxDepth) {
      // Two points closer together than this node's own box can still
      // subdivide to separate (after maxDepth halvings) are, for every
      // practical purpose, coincident — rather than recursing forever,
      // fold the new one into this leaf's own count so it still
      // contributes to any aggregate that includes this region, just
      // without a distinct position of its own. Unreachable in ordinary
      // operation at the node spacing a real simulation's own softening
      // floor already guarantees; this is a safety net, not a real path.
      node.count++;
      return;
    }

    subdivide(node);
    const existing = node.point;
    node.point = null;
    insertPoint(node.children[childIndexFor(node, existing.x, existing.y)], existing, depth + 1, maxDepth);
  }

  insertPoint(node.children[childIndexFor(node, point.x, point.y)], point, depth + 1, maxDepth);
  node.count++;
};

// Bottom-up: a leaf's center of mass is just its own point; an internal
// node's is the count-weighted average of its children's — the actual
// definition of a center of mass, not an approximation of one.
const aggregate = (node) => {
  if (!node.children) {
    if (node.point) {
      node.centerX = node.point.x;
      node.centerY = node.point.y;
    }
    return;
  }

  let sumX = 0;
  let sumY = 0;
  let total = 0;
  for (const child of node.children) {
    if (child.count === 0) continue;
    aggregate(child);
    sumX += child.centerX * child.count;
    sumY += child.centerY * child.count;
    total += child.count;
  }
  if (total > 0) {
    node.centerX = sumX / total;
    node.centerY = sumY / total;
  }
};

export class Quadtree {
  constructor(x, y, size, maxDepth = MAX_DEPTH_DEFAULT) {
    this.maxDepth = maxDepth;
    this.root = makeNode(x, y, size);
  }

  // `point` needs only {x, y} — callers that need to map a result back to
  // their own object (see NoteConstellation.jsx's own points array) keep
  // that mapping on their own side, this class doesn't need to know about it.
  insert(point) {
    insertPoint(this.root, point, 0, this.maxDepth);
  }

  // Must be called once, after every insert() and before any
  // accumulateForce() call.
  finalize() {
    aggregate(this.root);
  }

  // The Barnes-Hut criterion: a node's own region-width divided by its
  // distance from the query point. Below `theta`, the region is small
  // enough relative to how far away it is that treating every point inside
  // it as if it sat exactly at their shared center of mass is a good
  // approximation (this is the same "far enough away that internal
  // structure stops mattering" idea a real gravitational or electrostatic
  // field already behaves by) — above it, close enough that the
  // approximation would visibly matter, so this recurses into the node's
  // own children instead. Lower theta (down toward 0) is more accurate and
  // slower (more of the tree gets visited); higher is faster and coarser.
  // 0.5–0.7 is the typical range for scientific N-body work; interactive
  // visual simulations, where "looks structurally right" matters more than
  // precise force values, commonly run higher — see the caller's own theta
  // for the specific value chosen there and why.
  //
  // `exclude` skips a point matched by reference (the query point's own
  // entry, so a point never exerts force on itself). `force(dx, dy, dist,
  // weight)` is the caller's own force law — dx/dy point from the query
  // toward the other mass, weight is how many real points that leaf/
  // aggregate stands in for (1 for an ordinary leaf) — called once per
  // real point or once per aggregated region, this class has no opinion on
  // whether the result should attract or repel.
  accumulateForce(qx, qy, exclude, theta, force) {
    let fx = 0;
    let fy = 0;

    const visit = (node) => {
      if (node.count === 0) return;

      if (!node.children) {
        if (node.point === exclude) return;
        const dx = node.centerX - qx;
        const dy = node.centerY - qy;
        const dist = Math.hypot(dx, dy);
        const c = force(dx, dy, dist, node.count);
        fx += c.fx;
        fy += c.fy;
        return;
      }

      const dx = node.centerX - qx;
      const dy = node.centerY - qy;
      const dist = Math.hypot(dx, dy);

      if (node.size / Math.max(dist, 1e-6) < theta) {
        const c = force(dx, dy, dist, node.count);
        fx += c.fx;
        fy += c.fy;
        return;
      }

      for (const child of node.children) visit(child);
    };

    visit(this.root);
    return { fx, fy };
  }
}
