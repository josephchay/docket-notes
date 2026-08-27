import { useLayoutEffect, useRef } from "react";
import { motion } from "framer-motion";

import { STUDY_SECTIONS, parseStudy, stringifyStudy } from "../../utils/study";

import "./StudyBody.css";

// A single section's own textarea — grows with its content instead of
// scrolling internally, the same "the paper gets taller, not the field"
// feel the rest of this app's editable text already has. Height is
// recalculated on every value change (not just on mount), since Home's own
// note.text can change out from under this from elsewhere (undo/redo, an
// import) same as any other controlled field here.
const StudySection = ({ heading, prompt, value, locked, onChange }) => {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${ el.scrollHeight }px`;
  }, [value]);

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
const StudyBody = ({ text, onChange, locked, className }) => {
  const sections = parseStudy(text);

  const updateSection = (key, value) => {
    onChange(stringifyStudy({ ...sections, [key]: value }));
  };

  return (
    <motion.div className={ `study-body custom-scroll ${ className || "" }` }>
      {
        STUDY_SECTIONS.map(({ key, heading, prompt }) => (
          <StudySection
            key={ key }
            heading={ heading }
            prompt={ prompt }
            value={ sections[key] }
            locked={ locked }
            onChange={ (value) => updateSection(key, value) }
          />
        ))
      }
    </motion.div>
  );
};

export default StudyBody;
