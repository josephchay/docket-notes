// A Bible study note carries no schema of its own either — the same
// derived-from-plain-text approach utils/checklist.js already takes,
// applied to a three-part inductive study (Observation: what does the
// text say; Interpretation: what does it mean; Application: what do I do
// about it) rather than a line-by-line list. Three plain "## Heading"
// markers split note.text into sections; a note "is" a study purely
// because those three headings are actually present, in order — so it
// stays exportable/copyable/downloadable through every existing path with
// zero special-casing, exactly like a checklist does.
export const STUDY_SECTIONS = [
  { key: "observation", heading: "Observation", prompt: "What does the passage actually say?" },
  { key: "interpretation", heading: "Interpretation", prompt: "What did it mean, in its own context?" },
  { key: "application", heading: "Application", prompt: "What does it call for now?" },
];

const HEADING_LINE = (heading) => `## ${ heading }`;

// True once every section heading appears, in order — a note that's only
// been partly converted (or had a heading typed/deleted by hand) just
// reads as plain text until all three are back in place.
export function isStudyText(text) {
  const body = text ?? "";
  let cursor = -1;

  for (const { heading } of STUDY_SECTIONS) {
    const at = body.indexOf(HEADING_LINE(heading), cursor + 1);
    if (at === -1 || at <= cursor) return false;
    cursor = at;
  }

  return true;
}

// Splits note.text into its three sections by heading position. A note
// whose headings aren't there yet (still converting, or never was a
// study) gets three empty sections rather than a thrown error — callers
// check isStudyText first when that distinction actually matters.
export function parseStudy(text) {
  const body = text ?? "";
  const positions = STUDY_SECTIONS.map(({ heading }) => body.indexOf(HEADING_LINE(heading)));

  return STUDY_SECTIONS.reduce((sections, { key, heading }, i) => {
    const start = positions[i];
    if (start === -1) return { ...sections, [key]: "" };

    const end = i + 1 < positions.length && positions[i + 1] !== -1 ? positions[i + 1] : body.length;
    const content = body.slice(start + HEADING_LINE(heading).length, end).trim();
    return { ...sections, [key]: content };
  }, {});
}

export function stringifyStudy(sections) {
  return STUDY_SECTIONS
    .map(({ key, heading }) => `${ HEADING_LINE(heading) }\n${ (sections[key] ?? "").trim() }`)
    .join("\n\n");
}

// Seeds a fresh three-section skeleton — any existing plain text a visitor
// had already started lands in the first section (Observation) rather
// than being discarded, the same "don't throw away what's already there"
// courtesy toChecklistText already extends.
export function toStudyText(text) {
  const existing = (text ?? "").trim();
  return stringifyStudy({ observation: existing, interpretation: "", application: "" });
}

// Strips the headings back off, leaving each section's own writing as
// plain paragraphs separated the same way a visitor would themselves.
export function fromStudyText(text) {
  const sections = parseStudy(text);
  return STUDY_SECTIONS.map(({ key }) => sections[key]).filter(Boolean).join("\n\n");
}
