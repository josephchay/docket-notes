// A fixed-capacity ring buffer of short-lived "foam" sprites — the cheap,
// standard real-time approximation of SPH spray/foam (see Ihmsen et al.,
// "Unified Spray, Foam and Bubbles for Particle-Based Fluids", 2012, for
// the full physically-simulated version this simplifies): rather than
// solving a second trapped-air/kinetic-energy field, a splash is detected
// directly from the main SPH particles' own already-computed state — a
// particle moving fast *and* sparsely surrounded (low density, i.e. at the
// fluid's surface rather than buried in its bulk) is exactly what a real
// splash looks like locally — and a handful of decorative sprites are
// spawned at that position. They carry no back-reaction on the fluid; the
// SPH pool is unaffected by their existence, same as real foam doesn't
// meaningfully perturb the body of water it sits on.
//
// A ring buffer (fixed capacity, oldest slot recycled first) rather than a
// growing array — a bounded splash budget that never needs its own GC
// pressure or a separate alive/dead compaction pass, at the cost of a busy
// frame occasionally recycling a sprite mid-fade a little early. At the
// capacities this runs at (a few hundred), that trade is the right one.
export class FoamPool {
  constructor(capacity) {
    this.capacity = capacity;
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.radius = new Float32Array(capacity);
    // 0 means the slot is free/dead — checked below before spending any
    // work on it, and how the renderer knows to skip it entirely.
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this._cursor = 0;
  }

  spawn(x, y, vx, vy, radius, lifeSeconds) {
    const i = this._cursor;
    this._cursor = (this._cursor + 1) % this.capacity;
    this.x[i] = x; this.y[i] = y;
    this.vx[i] = vx; this.vy[i] = vy;
    this.radius[i] = radius;
    this.life[i] = lifeSeconds;
    this.maxLife[i] = lifeSeconds;
  }

  // gravity/drag: same sim-space units as the SPH pool's own GRAVITY
  // constant and a plain per-substep multiplicative velocity decay — foam
  // is deliberately not run through the SPH forces themselves (see class
  // comment), just a light, independent ballistic-with-drag motion that
  // reads as "flung droplet" rather than "part of the fluid body".
  update(dt, gravity, drag) {
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;

      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.life[i] = 0; continue; }

      this.vy[i] -= gravity * dt;
      this.vx[i] *= drag;
      this.vy[i] *= drag;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
    }
  }
}

// Shared splash criterion for both FluidField.jsx and FluidVisualizer.jsx:
// fast *and* under-dense relative to rest density reads as "at the surface
// and moving violently" — the same simplified stand-in the class comment
// above describes. A probability roll (rather than spawning unconditionally
// whenever the thresholds are crossed) keeps a whole fast-moving splash
// front from emptying the entire foam budget into a single frame; the roll
// itself scales with how far past the speed threshold a particle is, so a
// harder splash reliably throws more foam than a borderline one, not just
// a coin-flip indifferent to magnitude.
export const shouldSpawnFoam = (speed, density, restDensity, speedThreshold, densityRatio, rng) => {
  if (speed < speedThreshold) return false;
  if (density > restDensity * densityRatio) return false;
  const excess = Math.min(1, (speed - speedThreshold) / speedThreshold);
  return rng() < 0.05 + excess * 0.35;
};
