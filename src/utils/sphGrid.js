// A uniform spatial hash grid for 2D neighbor queries — the standard way
// real-time SPH scales past a couple hundred particles. FluidField.jsx and
// FluidVisualizer.jsx previously found neighbors with an all-pairs O(n^2)
// double loop (fine at n≈100-130, the counts they shipped with); at the
// particle counts they use now, O(n^2) stops being viable long before the
// physics itself would. A grid whose cell size equals the SPH smoothing
// radius (h) turns "every particle within h" into "every particle in my
// cell or the 8 surrounding it" — O(n) amortized, same exact neighbor set
// (still filtered by the real r < h check at the call site; the grid only
// narrows *candidates*, it never decides who's actually a neighbor).
//
// Built with typed arrays via counting sort (bucket sort by cell index),
// not a Map keyed by "x,y" — this runs once per SPH substep, several times
// a frame, and a Map would allocate a string key + rehash per particle per
// build. Counting sort is the standard low-GC way to do this in a hot loop:
// one pass to count particles per cell, a prefix sum to get per-cell start
// offsets, one pass to scatter indices into place.
export class UniformGrid {
  constructor(domainW, domainH, cellSize) {
    this.cellSize = cellSize;
    // +2 padding columns/rows so a particle exactly on or fractionally past
    // a domain edge (the boundary clamp in the callers keeps this rare, but
    // never guarantees it mid-substep) still maps to a valid, in-range cell
    // rather than reading past the typed arrays below.
    this.cols = Math.max(1, Math.ceil(domainW / cellSize) + 2);
    this.rows = Math.max(1, Math.ceil(domainH / cellSize) + 2);
    const cellTotal = this.cols * this.rows;
    this.cellCount = new Int32Array(cellTotal);
    this.cellStart = new Int32Array(cellTotal + 1);
    this._writeCursor = new Int32Array(cellTotal);
    this._sorted = null;
    this._cellOf = null;
    this._capacity = 0;
  }

  _ensureCapacity(n) {
    if (this._capacity === n) return;
    this._capacity = n;
    this._sorted = new Int32Array(n);
    this._cellOf = new Int32Array(n);
  }

  _cellCoords(x, y) {
    const cx = Math.min(this.cols - 1, Math.max(0, (x / this.cellSize | 0) + 1));
    const cy = Math.min(this.rows - 1, Math.max(0, (y / this.cellSize | 0) + 1));
    return cy * this.cols + cx;
  }

  // particles: array-like of objects with a `.pos` THREE.Vector2 (or any
  // {x,y}) — matches the particle shape FluidField.jsx/FluidVisualizer.jsx
  // already use, so callers don't need to reshape their state to use this.
  build(particles) {
    const n = particles.length;
    this._ensureCapacity(n);

    this.cellCount.fill(0);
    for (let i = 0; i < n; i++) {
      const p = particles[i].pos;
      const c = this._cellCoords(p.x, p.y);
      this._cellOf[i] = c;
      this.cellCount[c]++;
    }

    let sum = 0;
    for (let c = 0; c < this.cellCount.length; c++) {
      this.cellStart[c] = sum;
      sum += this.cellCount[c];
    }
    this.cellStart[this.cellCount.length] = sum;
    this._writeCursor.set(this.cellStart.subarray(0, this.cellCount.length));

    for (let i = 0; i < n; i++) {
      const c = this._cellOf[i];
      this._sorted[this._writeCursor[c]++] = i;
    }
  }

  // Invokes callback(particleIndex) once for every particle in the query
  // point's own cell and its 8 neighbors (a 3×3 block spanning 3×cellSize —
  // with cellSize == smoothing radius h, that's a comfortable margin around
  // the r < h disk the caller actually cares about). Duplicate-free: each
  // particle lives in exactly one cell.
  forEachNear(x, y, callback) {
    const cx = Math.min(this.cols - 1, Math.max(0, (x / this.cellSize | 0) + 1));
    const cy = Math.min(this.rows - 1, Math.max(0, (y / this.cellSize | 0) + 1));
    const x0 = Math.max(0, cx - 1), x1 = Math.min(this.cols - 1, cx + 1);
    const y0 = Math.max(0, cy - 1), y1 = Math.min(this.rows - 1, cy + 1);

    for (let gy = y0; gy <= y1; gy++) {
      const rowBase = gy * this.cols;
      for (let gx = x0; gx <= x1; gx++) {
        const c = rowBase + gx;
        const start = this.cellStart[c], end = this.cellStart[c + 1];
        for (let k = start; k < end; k++) callback(this._sorted[k]);
      }
    }
  }
}
