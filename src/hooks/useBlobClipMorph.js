import { useLayoutEffect, useRef } from "react";

import { blobPath, roundedRectPath, createBlobMorph } from "../utils/blob";

// Every dot-to-sheet panel already springs its own scale from .1 up to 1 —
// this just reads that same live value back out to drive the morph, so the
// blob stays exactly in step with however the spring is actually
// progressing (including its own overshoot) without a second, separately-
// timed animation to keep in sync.
const SCALE_MIN = .1;
const SCALE_MAX = 1;

// utils/blob.js's createBlobMorph/blobPath/roundedRectPath — a real
// flubber-powered shape morph — sat completely unused until now. This hook
// is what finally wires it up: clip a panel through a real organic-blob
// stage on the way from "dot" to "sheet" (and back on the way out), rather
// than the plain scale + border-radius approximation every panel already
// had. That approximation stays exactly as it was — this only adds a
// clip-path on top of it, so a panel that can't get accurate dimensions
// yet just renders like it always has.
//
// createBlobMorph expects an element with `.setAttribute("d", ...)` (an
// SVG <path>); nothing here needs an actual one, so a tiny stand-in object
// hands the same calls straight to `clip-path: path(...)` on the panel's
// own element instead.
const useBlobClipMorph = (ref, active, radius = 22) => {
  const morphRef = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;

    if (!active || !el) {
      if (el) el.style.clipPath = "";
      morphRef.current = null;
      return;
    }

    // offsetWidth/Height read the layout box, not the painted one — so
    // this stays correct regardless of whatever scale framer has already
    // applied by this point.
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    if (!width || !height) return;

    const fauxPath = {
      setAttribute: (_name, d) => { el.style.clipPath = `path('${ d }')`; },
    };

    const shapes = [
      roundedRectPath(width, height, Math.min(width, height) / 2), // a circle-in-a-box — scaled down by framer's own .1 start, it reads as a dot
      blobPath(width, height, 9, .34),                              // the organic peak, mid-transition
      roundedRectPath(width, height, radius),                       // the sheet it settles into
    ];

    morphRef.current = createBlobMorph(fauxPath, shapes);
    morphRef.current.set(0);

    return () => {
      el.style.clipPath = "";
    };
  }, [ref, active, radius]);

  // Handed to the panel's own `onUpdate` prop.
  return (latest) => {
    if (!morphRef.current || typeof latest.scale !== "number") return;

    const t = Math.max(0, Math.min(1, (latest.scale - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)));
    morphRef.current.set(t * morphRef.current.stageCount);
  };
};

export default useBlobClipMorph;
