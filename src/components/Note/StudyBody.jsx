import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

import { STUDY_SECTIONS, parseStudy, stringifyStudy } from "../../utils/study";

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
const StudySection = ({ heading, prompt, value, locked, autoFocus, resizeTick, onChange }) => {
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
    <div className="study-section">
      <span className="study-section-heading">{ heading }</span>
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

// Renders note.text as the three-part inductive study it reads as the
// moment its own headings are there (see isStudyText/utils/study.js) — the
// editor-only counterpart to ChecklistBody: a study's three prose sections
// need real room to write in, which the note card's own 350px paper was
// never going to have, so unlike checklists this never renders on the card
// at all — a study note just shows its plain "## Observation" headings
// there like any other multi-line text, the same way it always could
// before this feature existed. `onChange` still receives one freshly-
// stringified note.text, so a study edits through the exact same debounced
// path (handleText) every other field in the editor already does.
const StudyBody = ({ text, onChange, locked, className, autoFocus }) => {
  const sections = parseStudy(text);
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

  const updateSection = (key, value) => {
    onChange(stringifyStudy({ ...sections, [key]: value }));
  };

  return (
    <motion.div ref={ containerRef } className={ `study-body custom-scroll ${ className || "" }` }>
      {
        STUDY_SECTIONS.map(({ key, heading, prompt }, index) => (
          <StudySection
            key={ key }
            heading={ heading }
            prompt={ prompt }
            value={ sections[key] }
            locked={ locked }
            autoFocus={ autoFocus && index === 0 }
            resizeTick={ resizeTick }
            onChange={ (value) => updateSection(key, value) }
          />
        ))
      }
    </motion.div>
  );
};

export default StudyBody;
