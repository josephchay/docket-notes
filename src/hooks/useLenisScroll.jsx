import { useEffect, useRef } from "react";
import { useMotionValue } from "framer-motion";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger);

// Wires Lenis's inertia scroll onto an existing overflow:scroll container —
// .home already IS the real scroller (ScrollProgress.jsx reads it the same
// way via Framer's useScroll({ container })), so Lenis just takes over
// driving its scrollTop instead of the browser's native wheel handling,
// while still setting the wrapper's real scrollTop each frame — which keeps
// dispatching the same native `scroll` events the whole time, so nothing
// downstream needs to change. A GSAP ScrollTrigger scrollerProxy registers
// the wrapper as a scroller other ScrollTrigger instances elsewhere (see
// NoteList.jsx's QuoteCard parallax, which targets it by the ".home"
// selector) can hook into. `paused` stops Lenis — native scroll still works
// underneath — whenever .home's own overflow:hidden lock is active (the
// focus editor's .receded state), so the two never fight over the same
// scrollTop.
const useLenisScroll = (containerRef, { paused = false } = {}) => {
  const lenisRef = useRef(null);
  // The raw signed velocity behind --scroll-tilt's own clamped figure,
  // handed out as a real framer motion value rather than a second CSS
  // custom property — .home's grid-track skew reads velocity as one flat
  // number for the whole grid; a motion value lets individual notes each
  // run their own spring off the same live signal (see Note.jsx's own
  // scroll-lag, sized by each note's real mass) without a re-render on
  // every scroll tick, the same no-render-per-frame property CSS vars have.
  const scrollVelocity = useMotionValue(0);

  useEffect(() => {
    const wrapper = containerRef.current;
    if (!wrapper) return;

    const lenis = new Lenis({
      wrapper,
      content: wrapper,
      gestureOrientation: "vertical",
      smoothWheel: true,
    });
    lenisRef.current = lenis;

    ScrollTrigger.scrollerProxy(wrapper, {
      scrollTop(value) {
        if (arguments.length) {
          lenis.scrollTo(value, { immediate: true });
          return;
        }
        return lenis.scroll;
      },
      getBoundingClientRect() {
        return wrapper.getBoundingClientRect();
      },
    });

    // One combined listener: keeps ScrollTrigger's own progress math in
    // sync with Lenis's virtual scroll position, and drives the classic
    // Lenis velocity-skew signature — a subtle whole-grid tilt that reads
    // as "buttery" while scrolling and eases flat the instant scrolling
    // settles. Set on .home itself (rather than threading a second ref
    // down to NoteList) so it inherits into .notes via the ordinary CSS
    // custom-property cascade.
    const handleScroll = (e) => {
      ScrollTrigger.update();
      const tilt = Math.max(-2.4, Math.min(2.4, e.velocity * 0.6));
      wrapper.style.setProperty("--scroll-tilt", tilt.toFixed(3));
      scrollVelocity.set(e.velocity);
    };
    lenis.on("scroll", handleScroll);

    const raf = (time) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);

    const refreshTimer = setTimeout(() => ScrollTrigger.refresh(), 50);

    return () => {
      clearTimeout(refreshTimer);
      gsap.ticker.remove(raf);
      lenis.destroy();
      lenisRef.current = null;
      wrapper.style.removeProperty("--scroll-tilt");
      ScrollTrigger.getAll().forEach((instance) => {
        if (instance.scroller === wrapper) instance.kill();
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (paused) lenisRef.current?.stop();
    else lenisRef.current?.start();
  }, [paused]);

  return { lenisRef, scrollVelocity };
};

export default useLenisScroll;
