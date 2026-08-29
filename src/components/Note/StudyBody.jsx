import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FaPlus, FaXmark } from "react-icons/fa6";

import { OPTIONAL_SECTIONS, parseStudy, stringifyStudy } from "../../utils/study";

import "./StudyBody.css";

// A single section's own textarea — grows with its content instead of
// scrolling internally, the same "the paper gets taller, not the field"
// feel the rest of this app's editable text already has. Height is
// recalculated on every value change (not just on mount), since Home's own
// note.text can change out from under this from elsewhere (undo/redo, an
// import) same as any other controlled field here — AND on every
// resizeTick (see StudyBody's own ResizeObserver below): the same wrapped
// content needs a different pixel height once the editor's own width
// changes (the cozy/roomy/grand/epic resize button), and `value` alone
// never signals that on its own, which used to leave a stale, too-short
// height in place — clipped invisibly by this field's own overflow:hidden
// with no scrollbar to recover it — until the next keystroke in that
// specific section happened to retrigger the effect.
//
// `count` is how many citation occurrences this section's own prose
// carries (see NoteEditor.jsx's per-section grouping — computed there,
// where the citations already live, and passed down purely for display).
// `optional` marks an appended interpretive layer (Sensus Plenior) rather
// than one of the template's own required sections; `onDismiss`, when
// given, renders the ✕ that removes that layer — the caller only ever
// passes it while the section is empty, so dismissing can never silently
// discard written prose (deleting the words first is the deliberate step
// that arms the ✕).
const StudySection = ({ heading, prompt, value, locked, autoFocus, resizeTick, count, optional, onDismiss, onChange }) => {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${ el.scrollHeight }px`;
  }, [value, resizeTick]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
    // Runs once on this section's own mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={ `study-section ${ optional ? "optional" : "" }` }>
      <span className="study-section-heading-row">
        <span className="study-section-heading">{ heading }</span>
        {
          count > 0 && (
            <motion.span
              key={ count }
              className="study-section-count"
              aria-label={ `${ count } ${ count === 1 ? "citation" : "citations" } in this section` }
              initial={{ scale: .7 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 18 }}
            >
              { count }
            </motion.span>
          )
        }
        {
          onDismiss && (
            <motion.button
              type="button"
              aria-label={ `Remove the ${ heading } section` }
              className="study-section-dismiss"
              whileHover={{ scale: 1.15 }}
              whileTap={{ scale: .85 }}
              transition={{ type: "spring", stiffness: 420, damping: 18 }}
              onClick={ onDismiss }
            >
              <FaXmark />
            </motion.button>
          )
        }
      </span>
      <textarea
        ref={ ref }
        readOnly={ locked }
        placeholder={ prompt }
        value={ value }
        rows={ 1 }
        className="study-section-text"
        onChange={ (e) => onChange(e.target.value) }
      />
    </div>
  );
};

// Renders note.text as the multi-section study its own headings declare it
// to be (see detectStudyTemplate/utils/study.js) — the editor-only
// counterpart to ChecklistBody: a study's prose sections need real room to
// write in, which the note card's own 350px paper was never going to have,
// so unlike checklists this never renders on the card at all — a study
// note just shows its plain "## Literal"/"## Observation" headings there
// like any other multi-line text, the same way it always could before this
// feature existed. `onChange` still receives one freshly-stringified
// note.text, so a study edits through the exact same debounced path
// (handleText) every other field in the editor already does.
//
// Which sections render is entirely the parsed template's own business —
// this component never hardcodes a section list, so a new template in
// STUDY_TEMPLATES shows up here with zero changes. Appended optional
// layers (Sensus Plenior) render after the required sections, visually set
// apart, with a ghost chip to add whichever aren't present yet — the add
// and the dismiss both just re-stringify through the same onChange path a
// keystroke takes, since presence is nothing more than the heading
// existing in the text.
const StudyBody = ({ text, onChange, locked, className, autoFocus, sectionCounts }) => {
  const { template, sections } = parseStudy(text);
  const containerRef = useRef(null);

  // Bumped on every width change of this body's own container (the editor
  // resize button, or a viewport resize) — each StudySection's own
  // auto-grow effect depends on this too, so a pure width change (no text
  // edited) still re-measures every section's height instead of leaving a
  // stale one from before the resize.
  const [resizeTick, setResizeTick] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => setResizeTick((t) => t + 1));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The only render this component ever gets while the text ISN'T a study
  // is a transient one mid-toggle (NoteEditor's ternary re-evaluates on the
  // same draftText this parses) — nothing meaningful to draw, and every
  // access below assumes a real template.
  if (!template) return null;

  const updateSection = (key, value) => {
    onChange(stringifyStudy(template, { ...sections, [key]: value }));
  };

  // Both mutations below move focus deliberately, because both REMOVE the
  // very button being activated (the ghost chip's row unmounts once its
  // last section is added; the dismiss ✕ unmounts with its section) — a
  // focused element that disappears surrenders focus to <body>, from
  // where the next Tab silently escapes the editor's focus trap into the
  // page behind the modal. rAF so the post-change DOM exists first.
  const addOptional = (key) => {
    onChange(stringifyStudy(template, { ...sections, [key]: "" }));
    // Into the fresh section's own field — also simply the natural next
    // action after asking for a place to write.
    const heading = OPTIONAL_SECTIONS.find((o) => o.key === key)?.heading;
    requestAnimationFrame(() => {
      const rows = [...(containerRef.current?.querySelectorAll(".study-section.optional") ?? [])];
      const target = rows.find((row) => row.querySelector(".study-section-heading")?.textContent === heading);
      target?.querySelector("textarea")?.focus({ preventScroll: true });
    });
  };

  const dismissOptional = (key) => {
    const rest = { ...sections };
    delete rest[key];
    onChange(stringifyStudy(template, rest));
    // Lands on the LAST REQUIRED section's field — indexed off the
    // template's own section count, never "the last .study-section-text in
    // the DOM": AnimatePresence keeps the dismissed section mounted for
    // its exit animation, so for a beat the DOM's last field IS the dying
    // one, and focusing it would just drop focus a second time when it
    // finishes unmounting (the same exit-lag trap the Escape body-class
    // checks exist for).
    requestAnimationFrame(() => {
      const fields = containerRef.current?.querySelectorAll(".study-section-text");
      fields?.[template.sections.length - 1]?.focus({ preventScroll: true });
    });
  };

  const presentOptional = OPTIONAL_SECTIONS.filter(({ key }) => key in sections);
  const absentOptional = OPTIONAL_SECTIONS.filter(({ key }) => !(key in sections));

  return (
    <motion.div ref={ containerRef } className={ `study-body custom-scroll ${ className || "" }` }>
      {
        template.sections.map(({ key, heading, prompt }, index) => (
          <StudySection
            key={ key }
            heading={ heading }
            prompt={ prompt }
            value={ sections[key] }
            locked={ locked }
            autoFocus={ autoFocus && index === 0 }
            resizeTick={ resizeTick }
            count={ sectionCounts?.[key] ?? 0 }
            onChange={ (value) => updateSection(key, value) }
          />
        ))
      }
      <AnimatePresence initial={ false }>
        {
          presentOptional.map(({ key, heading, prompt }) => (
            <motion.div
              key={ key }
              initial={{ opacity: 0, y: 8, scale: .97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: .96, transition: { duration: .15, ease: "easeIn" } }}
              transition={{ type: "spring", stiffness: 380, damping: 24 }}
            >
              <StudySection
                heading={ heading }
                prompt={ prompt }
                value={ sections[key] }
                locked={ locked }
                resizeTick={ resizeTick }
                count={ sectionCounts?.[key] ?? 0 }
                optional
                onDismiss={ !locked && !(sections[key] ?? "").trim() ? () => dismissOptional(key) : null }
                onChange={ (value) => updateSection(key, value) }
              />
            </motion.div>
          ))
        }
      </AnimatePresence>
      {
        !locked && absentOptional.length > 0 && (
          <div className="study-optional-row">
            {
              absentOptional.map(({ key, heading }) => (
                <motion.button
                  key={ key }
                  type="button"
                  aria-label={ `Add a ${ heading } section` }
                  className="study-add-optional"
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: .92 }}
                  transition={{ type: "spring", stiffness: 420, damping: 18 }}
                  onClick={ () => addOptional(key) }
                >
                  <FaPlus className="study-add-optional-icon" />
                  { heading }
                </motion.button>
              ))
            }
          </div>
        )
      }
    </motion.div>
  );
};

export default StudyBody;
