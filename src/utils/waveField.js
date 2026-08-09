// A real, hand-verified discretization of the 2D wave equation
// (∂²h/∂t² = c²∇²h) on a uniform grid — the standard way real-time water
// rendering simulates surface *ripples* (as opposed to the water's own
// bulk motion, which is what utils/sph.js's Lagrangian particles already
// model). This is a genuinely different physics system from either of this
// app's other two: SPH tracks particles moving through space; utils/verlet.js
// tracks point masses connected by constraints; this tracks a fixed grid of
// height samples, each only ever interacting with its 4 immediate neighbors
// (a proper Eulerian field, not a particle or a point-mass mesh).
//
// The time discretization below is structurally the same leapfrog/
// Störmer-Verlet family utils/verlet.js's own integratePoint already uses —
// "new height = current height + damped implied-velocity + acceleration·dt²"
// is exactly that function's update rule, just applied to a field cell
// instead of a point mass. Not a coincidence: both are the same numerical
// family (implicit velocity via position/height history, rather than a
// separately-tracked velocity field), just applied to different kinds of
// state.
//
// Stability — von Neumann analysis of the 5-point Laplacian stencil on a
// square grid (Δx = Δy = cellSize), Courant number r = waveSpeed·Δt/cellSize:
// substituting a plane-wave trial solution h = ξⁿ·exp(i(kx·xΔx + ky·yΔy))
// into the recurrence below reduces it to a quadratic in ξ whose roots stay
// on the unit circle (|ξ| ≤ 1, the stability condition) exactly when
// r² ≤ 1/2 — i.e. r ≤ 1/√2 ≈ 0.7071. Miss that bound and this doesn't just
// look wrong, it diverges (the growth factor exceeds 1 and every step
// amplifies without bound). See FluidVisualizer.jsx's own comment for the
// actual numbers checked against this bound for that instance.
export class WaveField {
  constructor(cols, rows, cellSize, { waveSpeed = 18, damping = 0.985 } = {}) {
    this.cols = cols;
    this.rows = rows;
    this.cellSize = cellSize;
    this.waveSpeed = waveSpeed;
    this.damping = damping;

    const n = cols * rows;
    this.height = new Float32Array(n);
    this.prevHeight = new Float32Array(n);
    this._next = new Float32Array(n);
  }

  // Bilinear splat of a single impulse into the field, spread across the 4
  // cells surrounding (x, y) weighted by fractional cell position — an
  // excitation's apparent origin shouldn't visibly snap to the nearest grid
  // cell, the same reasoning smoothPath's own Catmull-Rom interpolation
  // exists for curves. x/y are in the same domain-unit coordinate space the
  // caller's own SPH pool already uses.
  excite(x, y, amount) {
    const gx = x / this.cellSize;
    const gy = y / this.cellSize;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;

    const add = (cx, cy, w) => {
      if (cx < 0 || cx >= this.cols || cy < 0 || cy >= this.rows) return;
      this.height[cy * this.cols + cx] += amount * w;
    };

    add(x0, y0, (1 - fx) * (1 - fy));
    add(x0 + 1, y0, fx * (1 - fy));
    add(x0, y0 + 1, (1 - fx) * fy);
    add(x0 + 1, y0 + 1, fx * fy);
  }

  // One leapfrog step, dt small enough to keep r = waveSpeed·dt/cellSize
  // under the 1/√2 bound derived above (the caller's responsibility — this
  // class has no way to know what dt it'll actually be called with ahead of
  // time). Boundary cells stay fixed at 0 (a Dirichlet edge): ripples
  // reflect off the pool's own walls, the same as real water in a bounded
  // container.
  step(dt) {
    const { cols, rows, cellSize, waveSpeed, damping, height, prevHeight } = this;
    const next = this._next;
    const c2 = (waveSpeed * waveSpeed) / (cellSize * cellSize);

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) {
          next[i] = 0;
          continue;
        }

        const laplacian = height[i - 1] + height[i + 1] + height[i - cols] + height[i + cols] - 4 * height[i];
        const impliedVelocity = (height[i] - prevHeight[i]) * damping;
        next[i] = height[i] + impliedVelocity + c2 * laplacian * dt * dt;
      }
    }

    // Rotate the three buffers rather than reallocating: `height` becomes
    // the new `prevHeight`, the freshly-computed `next` becomes the new
    // `height`, and the now-stale old `prevHeight` array is recycled as
    // next step's scratch `_next` buffer.
    this.prevHeight = height;
    this.height = next;
    this._next = prevHeight;
  }
}
