import React, { useEffect, useRef, useState } from 'react';

import { AnimatePresence, motion } from "framer-motion";
import { interpret } from "xstate";
import anime from "animejs";
import { FaFileArrowDown, FaFileArrowUp } from "react-icons/fa6";

import { toggleMachine } from "./NavigationState";
import plusIcon from "../../assets/icons/plus.svg";

import ColorSelector from "./ColorSelector";

import "./Nagivation.css";

const colorSelectors = [
  { order: "first", color: "yellow", isSubsequent: false, dataFrom: "0", dataTo: "80" },
  { order: "second", color: "orange", isSubsequent: true, dataFrom: "100", dataTo: "140" },
  { order: "third", color: "green", isSubsequent: true, dataFrom: "160", dataTo: "200" },
  { order: "fourth", color: "blue", isSubsequent: true, dataFrom: "220", dataTo: "260" },
  { order: "fifth", color: "purple", isSubsequent: true, dataFrom: "280", dataTo: "320" },
  { order: "sixth", color: "pink", isSubsequent: true, dataFrom: "340", dataTo: "380" },
  { order: "seventh", color: "red", isSubsequent: true, dataFrom: "400", dataTo: "440" },
];

const Navigation = ({
  addNote,
  exportNotes,
  importNotes,
  hasNotes,
  focusMode,
}) => {
  const navActivator = useRef(null);
  const fileInput = useRef(null);
  const logoRef = useRef(null);
  const [toggleService, setToggleService] = useState(null);

  // An empty desk gets a slow breathing halo around the + activator to draw
  // the eye — measured in JS rather than centered with pure CSS, since the
  // activator sits inside the gooey-filtered group and a halo living in
  // there would melt into the ink pots instead of glowing around them.
  const [inviteAt, setInviteAt] = useState(null);

  useEffect(() => {
    if (hasNotes) {
      setInviteAt(null);
      return;
    }

    const measure = () => {
      const rect = navActivator.current?.getBoundingClientRect();
      if (rect) setInviteAt({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [hasNotes]);

  // The wordmark's letters spring up one by one with an elastic overshoot,
  // and do a little wave again whenever the pointer greets them.
  useEffect(() => {
    anime({
      targets: logoRef.current?.querySelectorAll(".logo-letter"),
      translateY: [26, 0],
      delay: anime.stagger(55, { start: 250 }),
      duration: 1100,
      easing: "easeOutElastic(1, .55)",
    });
  }, []);

  // The rail tools are gently magnetic: their icons lean toward the pointer
  // while it hovers, then snap home with an elastic wobble. Only the inner
  // icon span moves, so framer keeps the button's own scale to itself.
  const magnetMove = (e) => {
    const icon = e.currentTarget.querySelector(".magnet");
    if (!icon) return;

    const rect = e.currentTarget.getBoundingClientRect();
    anime.remove(icon);
    anime.set(icon, {
      translateX: (e.clientX - rect.left - rect.width / 2) * .4,
      translateY: (e.clientY - rect.top - rect.height / 2) * .4,
    });
  }

  const magnetLeave = (e) => {
    const icon = e.currentTarget.querySelector(".magnet");
    if (!icon) return;

    anime.remove(icon);
    anime({
      targets: icon,
      translateX: 0,
      translateY: 0,
      duration: 650,
      easing: "easeOutElastic(1, .4)",
    });
  }

  const waveLogo = () => {
    const letters = logoRef.current?.querySelectorAll(".logo-letter");
    if (!letters) return;

    anime.remove(letters);
    anime({
      targets: letters,
      translateY: [
        { value: -8, duration: 160, easing: "easeOutQuad" },
        { value: 0, duration: 650, easing: "easeOutElastic(1, .5)" },
      ],
      delay: anime.stagger(45),
    });
  }

  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    if (file) importNotes(file);
    e.target.value = "";   // allow re-importing the same file
  }

  const disableActivator = () => {
    navActivator.current.setAttribute('disabled', '');
  }

  const enableActivator = () => {
    navActivator.current.removeAttribute('disabled');
  }

  useEffect(() => {
    const open = () => {
      const tl = anime.timeline();

      disableActivator();

      tl.add({
        targets: navActivator.current,
        translateY: [0, -14, 0],
        scale: [1, .8, 1],
        rotate: 316,
        duration: 800,
        easing: 'easeInOutSine',
      }).add({
          targets: '.color-selectors .first',
          translateY: [0, 80],
          duration: 3200,
          scaleY: [1.8, 1],
        }, '-=400'
      ).add({
        targets: '.color-selectors .subsequent',
        translateY: (el) => {
          return [el.getAttribute('data-from'), el.getAttribute('data-to')];
        },
        scaleY: [0, 1],
        duration: 1600,
        opacity: {
          value: 1,
          duration: 10,
        },
        delay: anime.stagger(240),
        complete: () => {
          enableActivator();
        }
      }, '-=2600');
    }

    const close = () => {
      const tl = anime.timeline();

      disableActivator();

      tl.add({
        targets: navActivator.current,
        rotate: 0,
        duration: 600,
        easing: 'easeInOutSine',
      }).add({
        targets: '.color-selectors .selector',
        translateY: (el) => {
          return [el.getAttribute('data-to'), 0];
        },
        duration: 400,
        delay: anime.stagger(80),
        easing: 'easeInOutSine',
        complete: () => {
          enableActivator();
        }
      }, '-=400');
    }

    const interpretToggleMachine = () => {
      const toggleService = interpret(toggleMachine);

      toggleService.onTransition((state) => {
        if (state.value === 'active') {
          open();
        } else if (state.value === 'inactive') {
          close();
        }
      }).start();

      return toggleService;
    }

    setToggleService(interpretToggleMachine());
  }, []);

  return (
    <motion.div
      className="nav"
      animate={{ x: focusMode ? -170 : 0 }}
      transition={{ type: "spring", stiffness: 210, damping: 24 }}
    >
      <motion.div
        initial={{
          opacity: 0,
          translateX: -140,
          scale: 1.04,
        }}
        animate={{
          opacity: 1,
          translateX: 0,
          scale: 1,
        }}
        transition={{
          duration: 0.4,
          type: "spring",
          stiffness: 120,
        }}
        className="logo"
        ref={ logoRef }
      >
        <h4
          onMouseEnter={ waveLogo }
        >
          {
            "Docket".split("").map((letter, index) => (
              <span
                key={ index }
                className="logo-letter"
              >
                { letter }
              </span>
            ))
          }
        </h4>
        {/* An unmissable little credit for the AI that helped build this
            desk — pops in right after the wordmark lands, then keeps a
            slow shimmer of its own so it never quite fades into the rail. */}
        <motion.div
          className="ai-credit"
          initial={{ opacity: 0, scale: 0, rotate: -10 }}
          animate={{ opacity: 1, scale: [0, 1.22, .94, 1.06, 1], rotate: 0 }}
          transition={{ duration: 1, type: "spring", stiffness: 220, damping: 11, delay: 1.05 }}
        >
          <span className="ai-credit-spark">✦</span>
          <span className="ai-credit-text">
            <span className="ai-credit-made">Made with</span>
            <span className="ai-credit-name">Claude AI</span>
          </span>
        </motion.div>
      </motion.div>
      <div
        className="activator-container"
      >
        <motion.div
          initial={{
            scale: 0,
          }}
          animate={{
            scale: 1,
          }}
          transition={{
            duration: 0.8,
            type: "spring",
            stiffness: 240,
            delay: 0.3,
          }}
          className="activator"
        >
          <button
            id="navActivator"
            ref={ navActivator }
            onClick={ () => toggleService.send("TOGGLE") }
          >
            <img src={ plusIcon } alt="Plus Icon" />
          </button>
        </motion.div>
        <motion.div
          initial={{
            opacity: 0,
            scale: 0,
          }}
          animate={{
            opacity: 1,
            scale: 1,
          }}
          transition={{
            delay: 1.6,
          }}
          className="color-selectors"
        >
          {
            colorSelectors.map((selector, index) => (
              <ColorSelector
                key={ index }
                className={`selector ${ selector.order } ${ selector.isSubsequent ? 'subsequent' : '' } ${ selector.color }-bg`}
                color={ selector.color }
                dataFrom={ selector.dataFrom }
                dataTo={ selector.dataTo }
                addNote={ addNote }
              />
            ))
          }
        </motion.div>
      </div>
      {/* Deliberately outside .activator-container, whose gooey filter
          would otherwise melt this into the ink pots instead of glowing
          softly around the button. */}
      <AnimatePresence>
        {
          inviteAt && (
            <motion.div
              className="nav-invite"
              style={{ left: inviteAt.x, top: inviteAt.y }}
              initial={{ opacity: 0, scale: .6 }}
              animate={{ opacity: [0, .4, .15, .4], scale: [.6, 1.3, 1, 1.3] }}
              exit={{ opacity: 0, scale: .6, transition: { duration: .3 } }}
              transition={{
                opacity: { duration: 2.2, repeat: Infinity, ease: "easeInOut", times: [0, .3, .6, 1] },
                scale: { duration: 2.2, repeat: Infinity, ease: "easeInOut", times: [0, .3, .6, 1] },
              }}
            />
          )
        }
      </AnimatePresence>
      <motion.div
        initial={{
          opacity: 0,
          translateY: 40,
        }}
        animate={{
          opacity: 1,
          translateY: 0,
        }}
        transition={{
          duration: 0.6,
          type: "spring",
          stiffness: 160,
          delay: 1,
        }}
        className="nav-tools"
      >
        <motion.button
          type="button"
          aria-label="Save all notes to a backup file"
          className="nav-tool"
          whileHover={{ scale: 1.15 }}
          whileTap={{ scale: .9 }}
          transition={{ type: "spring", stiffness: 400, damping: 17 }}
          onMouseMove={ magnetMove }
          onMouseLeave={ magnetLeave }
          onClick={ exportNotes }
        >
          <span className="magnet">
            <FaFileArrowDown className="nav-tool-icon" />
          </span>
        </motion.button>
        <motion.button
          id="navImportButton"
          type="button"
          aria-label="Bring notes in from a backup file"
          className="nav-tool"
          whileHover={{ scale: 1.15 }}
          whileTap={{ scale: .9 }}
          transition={{ type: "spring", stiffness: 400, damping: 17 }}
          onMouseMove={ magnetMove }
          onMouseLeave={ magnetLeave }
          onClick={ () => fileInput.current?.click() }
        >
          <span className="magnet">
            <FaFileArrowUp className="nav-tool-icon" />
          </span>
        </motion.button>
        <input
          ref={ fileInput }
          type="file"
          accept="application/json"
          hidden
          onChange={ handleImportFile }
        />
      </motion.div>
    </motion.div>
  );
}

export default Navigation;
