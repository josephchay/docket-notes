import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { parseChecklist, stringifyChecklist } from "../../utils/checklist";
import InkCheckbox from "./InkCheckbox";

import "./ChecklistBody.css";

// Renders note.text as an interactive list of checkable rows whenever it
// already reads as a checklist (see isChecklistText/utils/checklist.js) —
// reused as-is by both the note card (Note.jsx) and the focus editor
// (NoteEditor.jsx), the only difference between the two being the sizing
// context each hands it via `className`. `onChange` always receives a
// freshly-stringified note.text down the exact same debounced path a plain
// textarea's own onChange already feeds (handleTextUpdate/handleText) — so
// checking a box is exactly as undo-transparent as typing a letter, the
// same "just keep typing" reasoning Home.jsx's own pushUndo comment already
// gives for why continuous edits don't each earn their own history entry.
const ChecklistBody = ({ text, onChange, locked, className, onFocus, onBlur, autoFocus, colorName }) => {
  const items = parseChecklist(text);

  // Which row (if any) should claim focus once this render's DOM has
  // committed — set by addAfter/removeAt below (and once, on mount, by the
  // autoFocus effect a little further down), read and cleared in the
  // effect right after. A plain ref rather than state: it's write-once-
  // read-once bookkeeping for an imperative focus call, not something
  // that should itself trigger a re-render.
  const inputRefs = useRef([]);
  const pendingFocusRef = useRef(autoFocus && !locked ? 0 : null);

  // items is recomputed fresh from `text` every render (there's no
  // internal item state to key off of) — a plain array index would give
  // React's reconciler an unstable identity the instant a row is inserted
  // or removed anywhere but the very end (the row after an insert point
  // inherits the OLD key that used to belong to a different row's content,
  // which reads to AnimatePresence as "this row's text just changed"
  // rather than "a new row appeared here," scrambling exit/enter pairing
  // and mid-edit focus). keysRef is a parallel array manually kept in
  // lockstep by addAfter/removeAt below — the only two operations that
  // ever change row COUNT — so each row's key survives every operation
  // that isn't its own removal. The length-mismatch fallback only ever
  // fires for a change this component didn't itself make (an external
  // edit — undo/redo, import — landing as a different set of lines).
  const keysRef = useRef(items.map((_, i) => `k${ i }`));
  const keyCounterRef = useRef(items.length);

  if (keysRef.current.length !== items.length) {
    keysRef.current = items.map((_, i) => keysRef.current[i] ?? `k${ keyCounterRef.current++ }`);
  }

  useEffect(() => {
    inputRefs.current = inputRefs.current.slice(0, items.length);
    if (pendingFocusRef.current === null) return;

    const target = inputRefs.current[pendingFocusRef.current];
    pendingFocusRef.current = null;
    target?.focus();
  });

  const commit = (nextItems) => onChange(stringifyChecklist(nextItems));

  const toggle = (index) => {
    commit(items.map((item, i) => (i === index ? { ...item, checked: !item.checked } : item)));
  };

  const editContent = (index, content) => {
    commit(items.map((item, i) => (i === index ? { ...item, content } : item)));
  };

  const addAfter = (index) => {
    const next = [...items];
    next.splice(index + 1, 0, { checked: false, content: "" });
    keysRef.current.splice(index + 1, 0, `k${ keyCounterRef.current++ }`);
    pendingFocusRef.current = index + 1;
    commit(next);
  };

  // Backspacing an empty row merges it away rather than leaving an
  // ever-growing trail of blank items — the last row stays put regardless,
  // so a checklist can never be backspaced down to nothing at all.
  const removeAt = (index) => {
    if (items.length <= 1) return;
    keysRef.current.splice(index, 1);
    pendingFocusRef.current = Math.max(0, index - 1);
    commit(items.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e, index) => {
    // readOnly (see the row <input> below) already blocks the native
    // character-level edits typing would make, but it doesn't stop keydown
    // handlers from running — Enter/Backspace's row-structural side effects
    // here are custom JS, not the browser's own readOnly behavior, so they
    // need their own explicit guard the way the checkbox's disabled prop
    // and the input's readOnly already are one.
    if (locked) return;

    if (e.key === "Enter") {
      e.preventDefault();
      addAfter(index);
    } else if (e.key === "Backspace" && !items[index].content && e.currentTarget.selectionStart === 0) {
      e.preventDefault();
      removeAt(index);
    }
  };

  const checkedCount = items.filter((item) => item.checked).length;

  return (
    <div className={ `checklist-body ${ locked ? "locked" : "" } ${ className || "" }` }>
      <ul className="checklist-rows custom-scroll">
        <AnimatePresence initial={ false }>
          {
            items.map((item, index) => (
              <motion.li
                key={ keysRef.current[index] }
                className="checklist-row"
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, scale: .8, transition: { duration: .15 } }}
                transition={{ type: "spring", stiffness: 420, damping: 26 }}
              >
                <InkCheckbox
                  checked={ item.checked }
                  locked={ locked }
                  colorName={ colorName }
                  onToggle={ () => toggle(index) }
                />
                <input
                  ref={ (el) => { inputRefs.current[index] = el; } }
                  type="text"
                  readOnly={ locked }
                  value={ item.content }
                  placeholder="List item"
                  className={ `checklist-input ${ item.checked ? "checked" : "" }` }
                  onChange={ (e) => editContent(index, e.target.value) }
                  onKeyDown={ (e) => handleKeyDown(e, index) }
                  onFocus={ onFocus }
                  onBlur={ onBlur }
                />
              </motion.li>
            ))
          }
        </AnimatePresence>
      </ul>
      {
        items.length > 0 && (
          <span className="checklist-progress">{ checkedCount }/{ items.length } done</span>
        )
      }
    </div>
  );
};

export default ChecklistBody;
