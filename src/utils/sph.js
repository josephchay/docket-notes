// The SPH (smoothed-particle hydrodynamics) kernels shared by FluidField.jsx
// and FluidVisualizer.jsx — extracted here once both files needed the exact
// same verified math, rather than left to drift as two independent copies.
// Implements the standard real-time formulation from Müller, Charypar &
// Gross, "Particle-Based Fluid Simulation for Interactive Applications"
// (Eurographics/SIGGRAPH 2003) — the reference essentially every real-time
// graphics SPH demo since has built on — rather than deriving a fluid model
// from scratch. The two kernel constants marked "verified by hand" are
// re-derived below from the actual normalization integral (∫W dA = 1 over
// the disk of radius h) rather than just copied, since a wrong constant
// here wouldn't crash anything, it would just silently mean a caller's own
// tuning doesn't mean what it's commented to mean.

// 2D poly6 kernel (density estimation): normalization derived from
// ∫₀^h σ(h²-r²)³ · 2πr dr = 1. Substituting u = h²-r² turns the integral
// into ∫₀^{h²} u³ du / 2 = h⁸/8, giving σ·2π·h⁸/8 = 1 → σ = 4/(πh⁸) — the
// 2D figure (distinct from the more commonly quoted 3D constant, 315/64π,
// since these are flat simulations, not a slice through a 3D one).
export const poly6Coeff = (h) => 4 / (Math.PI * h ** 8);
export const poly6 = (r, h, coeff) => (r >= h ? 0 : coeff * (h * h - r * r) ** 3);

// 2D spiky kernel gradient (pressure force — spiky rather than poly6
// specifically because poly6's own gradient vanishes at r→0, which lets
// particles pile up with no separating force right where it matters most).
// The kernel itself normalizes to σ = 10/(πh⁵) by the same disk-integral
// method above (∫₀^h σ(h-r)³·2πr dr = σ·πh⁵/10 = 1); differentiating
// (h-r)³ brings down a factor of 3, giving the gradient's own constant,
// 3·10/(πh⁵) = 30/(πh⁵).
export const spikyGradCoeff = (h) => 30 / (Math.PI * h ** 5);
export const spikyGrad = (r, h, coeff) => (r >= h || r <= 0 ? 0 : -coeff * (h - r) * (h - r));

// 2D viscosity-kernel Laplacian: 40/(πh⁵)·(h-r). Taken from the standard
// real-time-SPH literature (it appears consistently across independent
// reference implementations of Müller's scheme) rather than re-derived
// from scratch — unlike the two kernels above, this one is reused on the
// strength of convergent published sources, not an independent derivation.
export const viscLapCoeff = (h) => 40 / (Math.PI * h ** 5);
export const viscLap = (r, h, coeff) => (r >= h ? 0 : coeff * (h - r));

// The standard real-time-SPH heuristic for particle mass: give each
// particle the mass a spacing×spacing patch of rest-density fluid would
// carry, so a well-packed neighborhood's density estimate starts out close
// to restDensity. A heuristic, not an identity — the *actual* resulting
// density also depends on the kernel's own smoothing profile and how many
// neighbors fall within h, which is exactly the part of SPH tuning no
// amount of hand-derivation replaces the need to actually look at.
export const particleMassFor = (restDensity, spacing) => restDensity * spacing * spacing;
