// Checklist notes carry no schema of their own — a note "becomes" a
// checklist purely because every one of its non-empty lines already wears a
// "[ ] "/"[x] " marker, the exact plain-text convention a visitor could type
// by hand. That keeps a checklist note exportable/copyable/downloadable
// through every existing path (exportNotes, handleCopy, handleDownload) with
// zero special-casing anywhere else in the app — they all already just read
// note.text verbatim.
const MARKER = /^\[([ xX])\]\s?(.*)$/;

// True once a note's body actually reads as a checklist — every non-empty
// line wears the marker, and there's at least one such line. An empty note,
// or one with plain paragraph text and no markers at all, is just text.
export function isChecklistText(text) {
  const nonEmpty = (text ?? "").split("\n").filter((line) => line.trim() !== "");
  return nonEmpty.length > 0 && nonEmpty.every((line) => MARKER.test(line));
}

// One row per line: a line that already carries a marker keeps its own
// checked state; anything else (a stray plain line typed before or while
// converting) starts unchecked rather than being dropped.
export function parseChecklist(text) {
  return (text ?? "").split("\n").map((line) => {
    const match = line.match(MARKER);
    return match ? { checked: match[1].toLowerCase() === "x", content: match[2] } : { checked: false, content: line };
  });
}

export function stringifyChecklist(items) {
  return items.map((item) => `[${ item.checked ? "x" : " " }] ${ item.content }`).join("\n");
}

// Prefixes every existing line with a fresh, unchecked marker — a line that
// already carries one is left untouched, so re-entering checklist mode on a
// note that was only half-converted never resets what's already checked
// off. An empty note gets one blank item to start typing into rather than
// an empty checklist with nothing to check. Genuinely blank lines (a
// paragraph break in ordinary prose, or the blank line fromStudyText joins
// its sections with) are dropped rather than turned into their own empty
// item — a blank line was never a list entry to begin with, just
// whitespace between two that were; a line that already carries a marker
// survives this even with no content after it ("[ ] ".trim() is "[ ]", not
// ""), so a genuinely blank CHECKLIST item a visitor left on purpose is
// never the one this removes.
export function toChecklistText(text) {
  const lines = (text ?? "").split("\n").filter((line) => line.trim() !== "");
  const source = lines.length > 0 ? lines : [""];
  return source.map((line) => (MARKER.test(line) ? line : `[ ] ${ line }`)).join("\n");
}

// Strips every marker back off, leaving plain paragraph text exactly as a
// visitor typing right over the checkboxes by hand would have produced.
export function fromChecklistText(text) {
  return (text ?? "").split("\n").map((line) => line.replace(MARKER, "$2")).join("\n");
}
