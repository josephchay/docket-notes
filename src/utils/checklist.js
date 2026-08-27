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
// an empty checklist with nothing to check.
export function toChecklistText(text) {
  const lines = (text ?? "").split("\n");
  const source = lines.some((line) => line.trim() !== "") ? lines : [""];
  return source.map((line) => (MARKER.test(line) ? line : `[ ] ${ line }`)).join("\n");
}

// Strips every marker back off, leaving plain paragraph text exactly as a
// visitor typing right over the checkboxes by hand would have produced.
export function fromChecklistText(text) {
  return (text ?? "").split("\n").map((line) => line.replace(MARKER, "$2")).join("\n");
}

// Trash/Archive panel row labels and NotePile's own toss-view text preview
// all just read note.text as a raw snippet — none of them know or care
// about checklist syntax. This strips the markers first so a checklist
// note previews as its actual content instead of raw "[ ] "/"[x] "
// brackets; a plain note passes through completely unchanged.
export function checklistAwareText(text) {
  return isChecklistText(text) ? fromChecklistText(text) : (text ?? "");
}
