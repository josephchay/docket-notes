import React, { useEffect, useRef, useState } from 'react';

import { motion } from "framer-motion";
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
}) => {
  const navActivator = useRef(null);
  const fileInput = useRef(null);
  const [toggleService, setToggleService] = useState(null);

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
    <div className="nav">
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
      >
        <h4>Docket</h4>
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
          onClick={ exportNotes }
        >
          <FaFileArrowDown className="nav-tool-icon" />
        </motion.button>
        <motion.button
          type="button"
          aria-label="Bring notes in from a backup file"
          className="nav-tool"
          whileHover={{ scale: 1.15 }}
          whileTap={{ scale: .9 }}
          transition={{ type: "spring", stiffness: 400, damping: 17 }}
          onClick={ () => fileInput.current?.click() }
        >
          <FaFileArrowUp className="nav-tool-icon" />
        </motion.button>
        <input
          ref={ fileInput }
          type="file"
          accept="application/json"
          hidden
          onChange={ handleImportFile }
        />
      </motion.div>
    </div>
  );
}

export default Navigation;
