// Deterministic 3D value noise, plus the curl of it — the standard
// construction for a smooth, divergence-free 2D flow field (Bridson,
// Hourihan & Fedkiw, "Curl-noise for procedural fluid flow", SIGGRAPH
// 2007): treat a scalar noise field ψ(x, y, t) as a stream function and
// take its 2D curl, v = (∂ψ/∂y, −∂ψ/∂x). The divergence of that field is
// ∂²ψ/∂x∂y − ∂²ψ/∂y∂x = 0 identically — incompressible flow by
// construction, no solver required — which is exactly what makes it read
// as a liquid current rather than a random jitter: nothing ever piles up
// or drains away, it only ever swirls.
//
// Value noise rather than Perlin/simplex gradient noise on purpose:
// trilinear interpolation of hashed lattice values with a smoothstep
// fade is a strictly simpler construction (no gradient tables, no simplex
// skewing) whose only real cost is a slightly blockier spectral character
// — invisible once the field is differentiated and applied as a weak
// ambient force, which is this module's only current caller.

// Integer lattice hash → [0, 1). A small multiply-xorshift mix (the same
// family mulberry32-style PRNGs use), chosen for being deterministic,
// seedless, and cheap — this is a hash, not a stream cipher, and it only
// ever needs to look uncorrelated across neighboring lattice cells.
const hash3 = (ix, iy, iz) => {
  let h = (ix * 374761393 + iy * 668265263 + iz * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

const fade = (t) => t * t * (3 - 2 * t); // smoothstep — C¹ across cell boundaries

export const valueNoise3 = (x, y, z) => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const fz = fade(z - z0);

  const lerp = (a, b, t) => a + (b - a) * t;

  const c000 = hash3(x0, y0, z0);
  const c100 = hash3(x0 + 1, y0, z0);
  const c010 = hash3(x0, y0 + 1, z0);
  const c110 = hash3(x0 + 1, y0 + 1, z0);
  const c001 = hash3(x0, y0, z0 + 1);
  const c101 = hash3(x0 + 1, y0, z0 + 1);
  const c011 = hash3(x0, y0 + 1, z0 + 1);
  const c111 = hash3(x0 + 1, y0 + 1, z0 + 1);

  return lerp(
    lerp(lerp(c000, c100, fx), lerp(c010, c110, fx), fy),
    lerp(lerp(c001, c101, fx), lerp(c011, c111, fx), fy),
    fz,
  );
};

// The 2D curl of the noise field at (x, y), with t as the third dimension
// so the current itself slowly evolves rather than being frozen in place.
// Central differences rather than analytic partials — value noise is
// piecewise-trilinear and differentiable almost everywhere, but the
// finite-difference form stays correct without caring where the cell
// boundaries fall, and `eps` doubles as a smoothing radius that keeps the
// resulting force field gentle.
export const curlNoise2 = (x, y, t, eps = 0.35) => {
  const dpdy = (valueNoise3(x, y + eps, t) - valueNoise3(x, y - eps, t)) / (2 * eps);
  const dpdx = (valueNoise3(x + eps, y, t) - valueNoise3(x - eps, y, t)) / (2 * eps);
  return { x: dpdy, y: -dpdx };
};
