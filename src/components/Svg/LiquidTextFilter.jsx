import { useEffect, useRef } from "react";
import gsap from "gsap";

// A living wobble for type, the same one-<svg>-with-<defs> convention
// GooeyEffectSvg.jsx uses for shapes: feTurbulence generates a slowly
// shifting noise field, feDisplacementMap pushes each glyph's edges around
// by it. GSAP tweens the turbulence's own baseFrequency attribute back and
// forth — one DOM attribute animating, not a per-frame redraw — so text
// wearing `.liquid-text` never quite sits still. Any element can opt in with
// `className="liquid-text"`.
const LiquidTextFilter = () => {
  const turbulenceRef = useRef(null);

  useEffect(() => {
    if (!turbulenceRef.current) return;

    const tween = gsap.to(turbulenceRef.current, {
      attr: { baseFrequency: "0.014 0.021" },
      duration: 6,
      yoyo: true,
      repeat: -1,
      ease: "sine.inOut",
    });

    return () => tween.kill();
  }, []);

  return (
    <svg xmlns="http://www.w3.org/2000/svg" version="1.1" aria-hidden="true">
      <defs>
        <filter id="liquid-text" x="-20%" y="-40%" width="140%" height="180%">
          <feTurbulence
            ref={ turbulenceRef }
            type="fractalNoise"
            baseFrequency="0.008 0.012"
            numOctaves="2"
            seed="7"
            result="liquid-noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="liquid-noise"
            scale="7"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
};

export default LiquidTextFilter;
