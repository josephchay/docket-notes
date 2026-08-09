// Position-based Verlet integration (Jakobsen, "Advanced Character
// Physics", 2001) — the standard game-physics technique behind essentially
// every real-time rope/cloth demo, not a bespoke scheme invented for this
// file. Velocity is never stored as its own field, only implied by how far
// a point moved since last step (x - px); constraints are satisfied as
// direct position corrections rather than spring forces. That's what makes
// this unconditionally stable under a stiff, densely-connected mesh in a
// way explicit force integration isn't — a spring stiff enough to hold a
// cloth's weave taut needs a vanishingly small timestep to stay stable if
// integrated as a force, where a position correction has no such limit; it
// just converges to the correct shape over however many relaxation passes
// it's given (see relaxConstraints below).

// pinned marks a point the solver never moves on its own (an anchor); a
// caller can still force pinned=true temporarily on an otherwise-free point
// (e.g. while it's being dragged) — see ClothField.jsx's own use of this.
export const createPoint = (x, y, pinned = false) => ({ x, y, px: x, py: y, pinned });

// One integration step for a single point. accelX/accelY are this step's
// full acceleration (gravity, wind, anything else a caller wants to add),
// already combined — this function doesn't know or care what's in them.
// damping is a per-step velocity retention factor (1 = lossless, real cloth
// always bleeds a little energy to air resistance and internal friction
// each step) applied to the *implied* velocity (x - px), not a separate
// force term.
export const integratePoint = (p, dt, accelX, accelY, damping) => {
  if (p.pinned) return;

  const vx = (p.x - p.px) * damping;
  const vy = (p.y - p.py) * damping;
  p.px = p.x;
  p.py = p.y;
  p.x += vx + accelX * dt * dt;
  p.y += vy + accelY * dt * dt;
};

// A single distance constraint between two points, pulled directly back
// toward their rest `length` rather than toward each other with a spring
// force. The correction splits by how movable each end actually is — a
// pinned point takes none of it, two free points share it evenly, so an
// anchor stays exactly put while everything hanging from it gets pulled
// into place around it.
export const satisfyConstraint = (a, b, length) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 0.0001;
  const diff = (dist - length) / dist;

  const aFree = a.pinned ? 0 : 1;
  const bFree = b.pinned ? 0 : 1;
  const total = aFree + bFree;
  if (total === 0) return;

  const correctionX = dx * diff;
  const correctionY = dy * diff;

  a.x += correctionX * (aFree / total);
  a.y += correctionY * (aFree / total);
  b.x -= correctionX * (bFree / total);
  b.y -= correctionY * (bFree / total);
};

// A single pass over every constraint only gets a mesh partway to a
// consistent shape — correcting one constraint can pull a point out of true
// on a different constraint that already looked satisfied a moment ago.
// The standard fix is simply repeating the whole pass several times a step
// so corrections propagate through the mesh; more iterations reads as
// stiffer material, fewer as slacker and more elastic — this is the actual
// knob that decides "how taut does this feel," not a spring constant.
export const relaxConstraints = (constraints, iterations) => {
  for (let n = 0; n < iterations; n++) {
    for (let i = 0; i < constraints.length; i++) {
      const c = constraints[i];
      satisfyConstraint(c.a, c.b, c.length);
    }
  }
};
