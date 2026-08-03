import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import gsap from "gsap";

import { blobPath, roundedRectPath, createBlobMorph } from "../../utils/blob";

// A punctual stamp of ink, not a persistent marker — arrives with the stop
// and is gone within a second, on purpose. A tiny dot morphs through two
// organic blob stages up to roughly the control's own footprint — the same
// flubber-powered createBlobMorph the dot-to-sheet panels already use for
// their own entrance (see utils/blob.js, useBlobClipMorph.js), applied
// here to a one-shot punctuation instead of a whole panel — then the shape
// holds while the whole thing fades, read as ink briefly pressed onto the
// paper and soaking in rather than reversing the morph back down.
//
// This is deliberately the fourth and last thing marking a discussed
// control, and deliberately not a fourth persistent ring: InkGoo's WebGL
// mark breathes fluid and stays the whole stop, the DOM jelly bounce
// squashes the control itself once and holds its z-index the whole stop,
// SketchRing's pen circle stays drawn the whole stop — three persistent
// layers already. A fourth persistent one would just be clutter. This one
// only ever occupies its own first second, then leaves the other three to
// do the holding.
const InkStamp = ({ rect, accent, reduced }) => {
  const pathRef = useRef(null);
  const groupRef = useRef(null);

  const pad = 6;
  const w = rect.width + pad * 2;
  const h = rect.height + pad * 2;

  useEffect(() => {
    if (reduced || !pathRef.current || !groupRef.current) return;

    const dot = roundedRectPath(w, h, Math.min(w, h) / 2);
    const shapes = [
      dot,
      blobPath(w, h, 8, .4),
      blobPath(w, h, 9, .3),
      roundedRectPath(w, h, Math.min(w, h) * .28),
    ];

    const morph = createBlobMorph(pathRef.current, shapes);
    morph.set(0);
    gsap.set(groupRef.current, { opacity: 1 });

    const drive = { t: 0 };
    const tl = gsap.timeline();
    tl.to(drive, {
      t: shapes.length - 1,
      duration: .55,
      ease: "elastic.out(1, .6)",
      onUpdate: () => morph.set(drive.t),
    });
    tl.to(groupRef.current, {
      opacity: 0,
      duration: .5,
      ease: "power2.in",
    }, "-=.1");

    return () => tl.kill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  if (reduced) return null;

  return (
    <motion.svg
      className="tour-stamp"
      style={{ left: rect.cx - w / 2, top: rect.cy - h / 2 }}
      width={ w }
      height={ h }
      viewBox={ `0 0 ${ w } ${ h }` }
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: .15 } }}
      aria-hidden="true"
    >
      <g ref={ groupRef }>
        <path ref={ pathRef } className="tour-stamp-fill" style={{ fill: accent }} />
      </g>
    </motion.svg>
  );
};

export default InkStamp;
