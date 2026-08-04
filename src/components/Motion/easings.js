// Ease strings, kept one export per library dialect rather than faked into
// a single shared shape — framer, anime.js, and GSAP each parse their own
// string grammar, so unifying the names here (not the values) is what
// actually helps: every file reaches for the same import instead of
// retyping "easeOutElastic(1, .55)" slightly differently each time.

// framer-motion
export const EASE_OUT = "easeOut";
export const EASE_IN = "easeIn";
export const EASE_IN_OUT = "easeInOut";

// anime.js — Navigation's logo wave and magnet-release timelines.
export const ANIME_ELASTIC_SOFT = "easeOutElastic(1, .55)";
export const ANIME_ELASTIC_SNAP = "easeOutElastic(1, .4)";
export const ANIME_ELASTIC_WAVE = "easeOutElastic(1, .5)";
export const ANIME_SINE = "easeInOutSine";

// GSAP — useMagnetic's release wobble, LiquidMeter's milestone pulse.
export const GSAP_ELASTIC_RELEASE = "elastic.out(1, 0.45)";
export const GSAP_POWER_OUT = "power3.out";
