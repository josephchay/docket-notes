// A Bible study note carries no schema of its own either — the same
// derived-from-plain-text approach utils/checklist.js already takes,
// applied to a set of "## Heading" sections rather than a line-by-line
// list. A note "is" a study purely because one template's full heading
// sequence is actually present, in order — so it stays exportable/
// copyable/downloadable through every existing path with zero
// special-casing, exactly like a checklist does.
//
// What used to be one hardcoded three-section shape (Observation/
// Interpretation/Application) is now a registry of templates: the same
// heading-marker grammar, several section sets. The first template is the
// default; a note declares which template it is purely by which heading
// sequence its own text carries (see detectStudyTemplate below), never by
// a stored mode.
export const STUDY_TEMPLATES = [
  {
    id: "inductive",
    label: "Inductive",
    about: "What it says, what it means, what it asks of you",
    sections: [
      { key: "observation", heading: "Observation", prompt: "What does the passage actually say?" },
      { key: "interpretation", heading: "Interpretation", prompt: "What did it mean, in its own context?" },
      { key: "application", heading: "Application", prompt: "What does it call for now?" },
    ],
  },
  {
    id: "quadriga",
    label: "Fourfold (Quadriga)",
    about: "The classical four senses — the letter first, the spirit built on it",
    sections: [
      // The prompts double as method controls, not just placeholders — each
      // spiritual sense's own wording demands its warrant (the church's own
      // discipline for the Quadriga: the literal sense is established
      // first, and every spiritual reading argues FROM it, never around
      // it), so the template itself resists the eisegesis it makes room
      // for. The same prompts-as-method-controls voice carries through
      // every template below.
      { key: "literal", heading: "Literal", prompt: "What did the human author assert, to his own audience, in its own context?" },
      { key: "allegorical", heading: "Allegorical", prompt: "What does the NT itself warrant reading here of Christ? Cite the warrant." },
      { key: "tropological", heading: "Tropological", prompt: "What conduct follows — argued from the literal sense, not around it?" },
      { key: "anagogical", heading: "Anagogical", prompt: "What hope does it direct toward — what is promised, not merely evoked?" },
    ],
  },
  {
    id: "lectio",
    label: "Lectio Divina",
    about: "The monastic four movements — read, ponder, answer, rest",
    sections: [
      { key: "lectio", heading: "Lectio", prompt: "Read slowly — which word or phrase arrests you?" },
      { key: "meditatio", heading: "Meditatio", prompt: "Ponder it — what does it stir, and what does it recall across the canon?" },
      { key: "oratio", heading: "Oratio", prompt: "Answer back — what does this move you to pray?" },
      { key: "contemplatio", heading: "Contemplatio", prompt: "Rest in it — what remains true when your own words run out?" },
    ],
  },
  {
    id: "doctrineUse",
    label: "Text, Doctrine & Use",
    about: "The Puritan sermon method — what it says, what it teaches, what it's for",
    sections: [
      { key: "text", heading: "Text", prompt: "Set down the passage itself, and establish what it actually says." },
      { key: "doctrine", heading: "Doctrine", prompt: "What truth does this text teach — stated plainly, as a proposition?" },
      { key: "use", heading: "Use", prompt: "How is this doctrine to be used — for conviction, comfort, and practice?" },
    ],
  },
  {
    id: "exegetical",
    label: "Exegetical",
    about: "The scholar's bench — from the words themselves up to theology",
    sections: [
      { key: "passage", heading: "Passage", prompt: "Set the text down whole — the unit as it stands, before any comment." },
      { key: "context", heading: "Context", prompt: "What surrounds it — historically, culturally, and in the book's own argument?" },
      { key: "observations", heading: "Observations", prompt: "What is actually there — structure, repetition, tense, the words carrying the weight?" },
      { key: "theology", heading: "Theology", prompt: "What does the whole canon do with this — stated from the text, not over it?" },
      { key: "significance", heading: "Significance", prompt: "What follows for the church and for you — earned from everything above?" },
    ],
  },
  {
    id: "weave",
    label: "Proclamation Weave",
    about: "The herald's cloth — the word set forth, its echoes sounded, the charge given",
    sections: [
      // The citation-woven proclamatory genre this app's own writer works
      // in: narration that carries a citation on every clause, quotation
      // that is always the text's own exact words, and connection made by
      // the same words genuinely sounding again in another place (the old
      // concordance method — an echo either exists in the letters or it
      // is not claimed). The prompts hold the writer to that discipline.
      { key: "proclamation", heading: "Proclamation", prompt: "Set the passage forth as one telling — every clause carrying its citation, every quotation the text's own exact words." },
      { key: "echoes", heading: "Echoes", prompt: "Where do the same words sound again across the canon? Quote both places exactly, and let the echo make its own claim." },
      { key: "exhortation", heading: "Exhortation", prompt: "Give the charge — what must be heard, kept, and done, now that the word has been set forth?" },
    ],
  },
];

// Sections any study can carry APPENDED after its template's own required
// sections, without changing which template the note reads as — the
// sensus plenior (the fuller, divinely intended sense beyond the human
// author's own horizon) is categorically distinct from the literal sense,
// and giving it a marked, structurally separate home makes the note's own
// plain-text shape declare when the writer has left the grammatical-
// historical register. Detection (isStudyText/detectStudyTemplate) ignores
// these entirely: presence or absence of an optional section never changes
// what template a study is, only what it additionally carries.
export const OPTIONAL_SECTIONS = [
  { key: "sensusPlenior", heading: "Sensus Plenior", prompt: "What fuller, divinely intended sense does the whole canon reveal here — beyond the human author's own horizon?" },
];

const HEADING_LINE = (heading) => `## ${ heading }`;

// Detection tries templates with MORE sections first — with distinct
// heading names this ordering is belt-and-braces, but it's what makes the
// subsequence assertion below sufficient: as long as no template's ordered
// heading sequence nests inside another's, the first (largest) match is
// always the only possible one.
const TEMPLATES_MOST_SECTIONS_FIRST = [...STUDY_TEMPLATES].sort(
  (a, b) => b.sections.length - a.sections.length
);

// The registry's own structural invariants, checked once at module load in
// development — each would silently corrupt detection if a future template
// violated it, and neither is enforceable by the type of the data alone:
// (1) no template's ordered heading sequence may be a subsequence of
// another's (otherwise a note carrying the larger set would ALSO match the
// smaller, and most-sections-first ordering would be doing real,
// easy-to-break disambiguation work instead of none); (2) no optional
// heading may collide with any template's required heading (an optional
// scan finding "## Application" would misfile a required section as an
// appended layer).
if (process.env.NODE_ENV !== "production") {
  const isSubsequence = (small, big) => {
    let cursor = 0;
    for (const item of small) {
      cursor = big.indexOf(item, cursor);
      if (cursor === -1) return false;
      cursor += 1;
    }
    return true;
  };

  for (const a of STUDY_TEMPLATES) {
    for (const b of STUDY_TEMPLATES) {
      if (a === b) continue;
      const headingsA = a.sections.map((s) => s.heading);
      const headingsB = b.sections.map((s) => s.heading);
      if (isSubsequence(headingsA, headingsB)) {
        throw new Error(`Study template "${ a.id }"'s headings nest inside "${ b.id }"'s — detection can't tell them apart.`);
      }
    }
  }

  const requiredHeadings = new Set(STUDY_TEMPLATES.flatMap((t) => t.sections.map((s) => s.heading)));
  for (const optional of OPTIONAL_SECTIONS) {
    if (requiredHeadings.has(optional.heading)) {
      throw new Error(`Optional section "${ optional.heading }" collides with a template's own required heading.`);
    }
  }
}

// Finds one ordered heading sequence by LINE index — each search starting
// right after the previous heading's own line, and requiring the WHOLE
// line to match (trailing whitespace only tolerated) rather than a bare
// substring anywhere in the text. Anchoring to whole lines means a
// sentence that merely happens to mention "## Observation" mid-paragraph
// can never be mistaken for a real heading — a real heading is a line with
// nothing else on it, exactly what toStudyText itself always produces.
function findHeadingSequence(lines, sections) {
  const positions = [];
  let cursor = 0;

  for (const { heading } of sections) {
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

// The one place study structure is ever actually located — template
// detection, required heading positions, and optional-section positions,
// all in a single pass every reader below (isStudyText, parseStudy,
// fromStudyText, sectionRangesOf) shares. They used to risk each running
// their own independent search and disagreeing the instant a heading's own
// name showed up earlier in the text as ordinary prose — one shared
// implementation is what makes disagreement structurally impossible (the
// same lesson checklist.js's single MARKER regex already embodies).
//
// Optional headings are scanned only in lines AFTER the last required
// heading — an appended layer lives at the end by construction
// (stringifyStudy only ever writes it there), and scanning earlier lines
// would let a mid-study prose line that happens to read "## Sensus
// Plenior" split a required section in two.
//
// Returns { template, required: number[], optional: [{ section, line }] }
// or null when no template's full sequence is present.
function findStudyLines(lines) {
  for (const template of TEMPLATES_MOST_SECTIONS_FIRST) {
    const required = findHeadingSequence(lines, template.sections);
    if (!required) continue;

    const optional = [];
    const foundKeys = new Set();
    for (let i = required[required.length - 1] + 1; i < lines.length; i++) {
      const line = lines[i].trimEnd();
      for (const section of OPTIONAL_SECTIONS) {
        if (foundKeys.has(section.key) || line !== HEADING_LINE(section.heading)) continue;
        foundKeys.add(section.key);
        optional.push({ section, line: i });
      }
    }

    return { template, required, optional };
  }

  return null;
}

// The template whose full ordered heading sequence this text carries, or
// null when it carries none — a note that's only been partly converted (or
// had a heading typed/deleted by hand) just reads as plain text until the
// whole sequence is back in place.
export function detectStudyTemplate(text) {
  return findStudyLines((text ?? "").split("\n"))?.template ?? null;
}

export function isStudyText(text) {
  return detectStudyTemplate(text) !== null;
}

// Splits note.text into its sections by heading position. Returns
// { template, sections } — sections holds every one of the template's own
// required keys (empty string when nothing's written under a heading yet),
// plus each OPTIONAL_SECTIONS key ONLY when its heading is actually
// present in the text: key-presence IS the "does this study carry that
// layer" signal, deliberately independent of whether any content sits
// under it, since stringifyStudy round-trips on every keystroke and a
// drop-when-empty rule would delete the layer the instant its text was
// cleared. A note that isn't a study gets { template: null, sections: {} }
// rather than a thrown error — callers check isStudyText/template first
// when that distinction matters.
export function parseStudy(text) {
  const lines = (text ?? "").split("\n");
  const study = findStudyLines(lines);

  if (!study) return { template: null, sections: {} };

  const { template, required, optional } = study;

  // Every heading in document order — each section's content runs from
  // just past its own heading line to the next heading (or the end).
  const entries = [
    ...template.sections.map((section, i) => ({ key: section.key, line: required[i] })),
    ...optional.map(({ section, line }) => ({ key: section.key, line })),
  ];

  const sections = {};
  entries.forEach(({ key, line }, i) => {
    const start = line + 1; // the line right after the heading itself
    const end = i + 1 < entries.length ? entries[i + 1].line : lines.length;
    sections[key] = lines.slice(start, end).join("\n").trim();
  });

  return { template, sections };
}

// Serializes required sections in template order, then whichever optional
// sections are present (by key) in OPTIONAL_SECTIONS order — the exact
// end-of-text placement findStudyLines's own optional scan expects.
export function stringifyStudy(template, sections) {
  const parts = template.sections.map(
    ({ key, heading }) => `${ HEADING_LINE(heading) }\n${ (sections[key] ?? "").trim() }`
  );

  for (const { key, heading } of OPTIONAL_SECTIONS) {
    if (key in sections) {
      parts.push(`${ HEADING_LINE(heading) }\n${ (sections[key] ?? "").trim() }`);
    }
  }

  return parts.join("\n\n");
}

// Builds a fresh study skeleton in the chosen template, with
// `firstSectionText` (if any) landing in the FIRST section — the one
// construction both conversion (toStudyText below) and spawn-time
// study-shaped pours (Home.jsx's addNote) share, so the skeleton a pour
// writes and the skeleton the toggle writes can never drift apart.
// `withSensusPlenior` appends the empty Sensus Plenior layer the way the
// editor's own ghost chip would — presence is just the heading existing,
// so a spawned layer and a hand-added one are indistinguishable by
// construction.
export function seedStudyText(templateId, firstSectionText = "", { withSensusPlenior = false } = {}) {
  const template = STUDY_TEMPLATES.find((t) => t.id === templateId) ?? STUDY_TEMPLATES[0];

  const sections = {};
  template.sections.forEach(({ key }, i) => {
    sections[key] = i === 0 ? firstSectionText : "";
  });
  if (withSensusPlenior) sections.sensusPlenior = "";

  return stringifyStudy(template, sections);
}

// Seeds a fresh skeleton in the chosen template — any existing plain text
// a visitor had already started lands in the FIRST section (whatever that
// template calls it) rather than being discarded, the same "don't throw
// away what's already there" courtesy toChecklistText already extends.
export function toStudyText(text, templateId) {
  return seedStudyText(templateId, (text ?? "").trim());
}

// Strips the headings back off — whichever template's, plus any appended
// optional layers — leaving each section's own writing as plain paragraphs
// separated the same way a visitor would themselves. Text that never was a
// study passes through unchanged.
export function fromStudyText(text) {
  const { template, sections } = parseStudy(text);
  if (!template) return text;

  return [
    ...template.sections.map(({ key }) => sections[key]),
    ...OPTIONAL_SECTIONS.filter(({ key }) => key in sections).map(({ key }) => sections[key]),
  ].filter(Boolean).join("\n\n");
}

// Each section's own CHARACTER range within the text — the bridge between
// this file's line-oriented heading grammar and citations.js's
// character-offset world, so a citation's `start` can be bucketed into the
// section whose prose actually carries it. Calls the same findStudyLines
// as everything above (never its own independent search), then converts
// line indices to offsets by walking the exact "\n"-split this whole file
// splits on. Ranges are raw (untrimmed) spans from just past each heading
// line to the next heading line — a citation anywhere in a section's
// whitespace still belongs to that section. Returns [] for a non-study.
export function sectionRangesOf(text) {
  const body = text ?? "";
  const lines = body.split("\n");
  const study = findStudyLines(lines);
  if (!study) return [];

  // lineStarts[i] = character offset where line i begins.
  const lineStarts = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1; // +1 for the "\n" split consumed
  }

  const { template, required, optional } = study;
  const entries = [
    ...template.sections.map((section, i) => ({ section, line: required[i], optional: false })),
    ...optional.map(({ section, line }) => ({ section, line, optional: true })),
  ];

  return entries.map(({ section, line, optional: isOptional }, i) => {
    const contentLine = line + 1;
    const nextLine = i + 1 < entries.length ? entries[i + 1].line : lines.length;
    return {
      key: section.key,
      heading: section.heading,
      optional: isOptional,
      startChar: contentLine < lines.length ? lineStarts[contentLine] : body.length,
      endChar: nextLine < lines.length ? lineStarts[nextLine] : body.length,
    };
  });
}
