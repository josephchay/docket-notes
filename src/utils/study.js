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

// The one place heading positions are actually located — by LINE index
// (not raw character offset), each search starting right after the
// previous heading's own line, and requiring the WHOLE line to match
// (trailing whitespace only tolerated) rather than a bare substring
// anywhere in the text. Both isStudyText and parseStudy below call this
// exact same function, which is what makes it structurally impossible for
// them to disagree about where the sections actually are — they used to
// each run their own independent search (isStudyText sequential, parseStudy
// a plain unanchored indexOf per heading) and could reach different
// answers the instant a heading's own name showed up earlier in the text
// as ordinary prose (a user discussing "the Observation section" before
// actually reaching their own "## Observation" heading, say), silently
// dropping or scrambling real content parseStudy had mis-sliced around the
// wrong occurrence. Anchoring to whole lines also means a sentence that
// merely happens to mention "## Observation" mid-paragraph can never be
// mistaken for a real heading at all — a real heading is a line with
// nothing else on it, exactly what toStudyText itself always produces.
// Returns the three line indices in order, or null if any is missing.
function findHeadingLines(lines) {
  const positions = [];
  let cursor = 0;

  for (const { heading } of STUDY_SECTIONS) {
    const target = HEADING_LINE(heading);
    let found = -1;
    for (let i = cursor; i < lines.length; i++) {
      if (lines[i].trimEnd() === target) { found = i; break; }
    }
    if (found === -1) return null;

    positions.push(found);
    cursor = found + 1;
  }

  return positions;
}

// True once every section heading appears, in order — a note that's only
// been partly converted (or had a heading typed/deleted by hand) just
// reads as plain text until all three are back in place.
export function isStudyText(text) {
  return findHeadingLines((text ?? "").split("\n")) !== null;
}

// Splits note.text into its three sections by heading position. A note
// whose headings aren't there yet (still converting, or never was a
// study) gets three empty sections rather than a thrown error — callers
// check isStudyText first when that distinction actually matters.
export function parseStudy(text) {
  const lines = (text ?? "").split("\n");
  const positions = findHeadingLines(lines);

  if (!positions) {
    return STUDY_SECTIONS.reduce((sections, { key }) => ({ ...sections, [key]: "" }), {});
  }

  return STUDY_SECTIONS.reduce((sections, { key }, i) => {
    const start = positions[i] + 1; // the line right after the heading itself
    const end = i + 1 < positions.length ? positions[i + 1] : lines.length;
    const content = lines.slice(start, end).join("\n").trim();
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
