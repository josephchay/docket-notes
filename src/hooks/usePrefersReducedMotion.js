import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

// The OS/browser-level motion preference, kept live via the media query's
// own change listener — updates immediately if it's flipped while the app
// is already open, no reload needed.
const usePrefersReducedMotion = () => {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia ? window.matchMedia(QUERY).matches : false
  );

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const handleChange = (e) => setReduced(e.matches);

    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);

  return reduced;
};

export default usePrefersReducedMotion;
