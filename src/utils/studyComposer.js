// The automatic study composer — how a study-shaped pour keeps dealing
// COMPLETE, titled studies once the hand-authored library
// (utils/studyLibrary.js) runs dry, endlessly and without repetition:
// a random verse is dealt from bible-api.com and a full study is COMPOSED
// around it from data this app genuinely possesses. There is no language
// model here and no pretense of one — every sentence a composed study
// asserts is either a fact (the fetched KJV text; the fact-checked
// per-book details in bibleBookDetails.js; the Treasury cross-references
// and their testament crossings; canon structure from bibleBooks.js;
// counts and repetitions computed from the verse's own words) or a
// method DIRECTIVE in the template's own tradition (what the Quadriga,
// the Puritans, or lectio divina actually instruct a reader to do next).
// The result is a complete worked study GUIDE, specific to its verse —
// two composed studies never read alike because their verse, book,
// apparatus, and computed word-facts all differ — while never
// manufacturing an interpretation and dressing it as scholarship, the
// same honesty line every other scripture surface here holds.
//
// Citations inside composed prose are written in the app's own grammar
// (each Treasury reference re-validated through parseBareCitation before
// it is ever woven in — the ~0.2% span-form entries the grammar can't
// express are simply skipped), so a composed study lights up the full
// apparatus: pills grouped by section, layered-sense marks where one
// passage is deliberately cited under two senses, and the verse-preview
// card on every tag.
//
// Composition is DETERMINISTIC per verse (phrasing variants are chosen by
// a hash of the reference, never Math.random), so composing the same
// verse twice yields the identical study — repetition control lives in
// WHICH verses get dealt, not in re-rolling prose.
import { BIBLE_BOOKS, NT_START_INDEX, parseBareCitation } from "./citations";
import { BOOK_CHAPTER_COUNTS, BOOK_SECTIONS } from "./bibleBooks";
import { BIBLE_BOOK_DETAILS } from "./bibleBookDetails";
import { STUDY_TEMPLATES, stringifyStudy, detectStudyTemplate, parseStudy } from "./study";
import { fetchRandomVerse } from "./bibleApi";
import { loadCrossReferences } from "./crossReferences";
// A deliberate two-way pairing: weaveComposer borrows this file's small
// text helpers (exported at the bottom) while this file's pantry hands
// weave-template picks to composeWeave — both references live inside
// function bodies, never at module top level, which is what keeps the
// cycle safe under ESM.
import { composeWeave } from "./weaveComposer";

// ---------- small facts, all computed, none invented ----------

// A tiny stable hash so a verse's phrasing variants never reshuffle
// between composings of the same reference.
const hashOf = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};
const pick = (hash, salt, variants) => variants[(hash + salt) % variants.length];

const ORDINALS = ["zeroth", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
// Spelled out through ten, standard suffix math above it — the naive
// "`${n}th`" fallback composed "the 22th of its 24 chapters" for roughly a
// fifth of the canon's chapters (everything ending 1/2/3 except 11-13).
const ordinal = (n) => {
  if (ORDINALS[n]) return ORDINALS[n];
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${ n }${ suffix }`;
};

const sectionOf = (book) => BOOK_SECTIONS.find((s) => s.books.includes(book));

// The first sentence of one of bibleBookDetails' own (already hedged,
// already fact-checked) prose fields — reused verbatim rather than
// re-summarized, so composed context can never drift from the vetted text.
// Abbreviation-aware, because the details prose really does write
// "c. AD 55-57" (a naive [.!?] split shipped the two-word non-sentence
// "Commonly dated c." into live studies) and really does end sentences
// inside closing quotes (a lookahead that demanded whitespace after the
// period returned "" for those fields entirely). No terminator at all
// falls back to the whole trimmed field rather than an empty string.
const firstSentence = (prose) => {
  const text = (prose ?? "").trim();
  const terminator = /[.!?]["”')\]]*(?=\s|$)/g;
  let match;
  while ((match = terminator.exec(text)) !== null) {
    // A dot belonging to an abbreviation ("c." for circa, "cf.", a bare
    // initial) is not a sentence end — skip to the next candidate.
    if (/(^|\s)(c|ca|cf|e\.g|i\.e|v|vv|[A-Z])$/.test(text.slice(0, match.index))) continue;
    return text.slice(0, match.index + match[0].length).trim();
  }
  return text;
};

// Weaves detail sentences together while dropping any that came back
// empty — a missing/degenerate field must cost its sentence, never leave
// a stray double space or a floating fragment mid-prose.
const joinSentences = (...parts) => parts.filter(Boolean).join(" ");

const STOPWORDS = new Set(("the and of to in that for with unto upon a an is are was were be been shall will not his her their my thy thine mine own your our its him them me thee you we they he she it i as at by on from into which who whom whoso whosoever this these those there then than thereof therein but or nor so if because when where all any every no o ye yea nay do did done doth have hath had having may might can could would should let also out up down over under before after again more most very").split(" "));

const tokensOf = (text) => (text.toLowerCase().match(/[a-z']+/g) ?? []).filter((w) => w.length > 2 && !STOPWORDS.has(w));

// Lowercase token -> the word's FIRST surface form in the verse, so
// anything quoted back at the reader keeps the KJV's own casing — quoting
// "lord" where the text prints LORD would misquote the very tetragrammaton
// convention the study tells the reader to circle.
const surfaceFormsOf = (text) => {
  const forms = new Map();
  for (const raw of text.match(/[A-Za-z']+/g) ?? []) {
    const key = raw.toLowerCase();
    if (!forms.has(key)) forms.set(key, raw);
  }
  return forms;
};

// A word the verse itself repeats — repetition is structure in Hebrew and
// Greek rhetoric, and pointing at a real one beats gesturing at none.
// Returned in its own surface casing (see surfaceFormsOf).
const repeatedWordOf = (text) => {
  const counts = new Map();
  for (const token of tokensOf(text)) counts.set(token, (counts.get(token) ?? 0) + 1);
  let best = null;
  for (const [word, count] of counts) {
    if (count >= 2 && (!best || count > best.count || (count === best.count && word.length > best.word.length))) {
      best = { word, count };
    }
  }
  return best ? surfaceFormsOf(text).get(best.word) ?? best.word : null;
};

// The verse's most arresting words by the only honest automatic measure —
// length and rarity within the verse — offered to the reader as CANDIDATES
// ("perhaps..."), never as the answer, each in its own surface casing.
const notableWordsOf = (text) => {
  const seen = new Set();
  const forms = surfaceFormsOf(text);
  return tokensOf(text)
    .filter((w) => (seen.has(w) ? false : seen.add(w)))
    .sort((a, b) => b.length - a.length)
    .slice(0, 2)
    .map((w) => forms.get(w) ?? w);
};

const DIVINE_NAMES = ["LORD", "God", "Jesus", "Christ", "Spirit"];
// Display forms carry the article English (and the KJV itself) requires —
// the bare list composed "and LORD stands in it by name", a phrase the
// KJV never prints; it always writes "the LORD".
const DIVINE_DISPLAY = { LORD: "the LORD", Spirit: "the Spirit" };
const divineNamesOf = (text) => DIVINE_NAMES
  .filter((name) => new RegExp(`\\b${ name }\\b`).test(text))
  .map((name) => DIVINE_DISPLAY[name] ?? name);

const joinNames = (names) => names.length <= 1 ? names.join("") : `${ names.slice(0, -1).join(", ") } and ${ names[names.length - 1] }`;

// The incipit — the traditional way an untitled text gets a name (psalms,
// hymns, papal documents): its own opening words, verbatim. Two small
// courtesies so the cut lands on a phrase rather than mid-breath: when the
// verse's own punctuation offers a boundary inside the window, cut there
// ("One generation passeth away, and..." -> "One generation passeth
// away"); otherwise trim trailing connective words that leave a title
// hanging ("For the promise is unto" -> "For the promise is"), never
// below three words.
const INCIPIT_TRAILERS = new Set([
  "and", "or", "nor", "but", "unto", "of", "the", "a", "an", "for", "to", "with", "upon", "into", "that",
  // Possessives and auxiliaries leave a title just as mid-breath as a
  // conjunction does ("I will lift up mine" — mine WHAT?).
  "mine", "thine", "my", "thy", "his", "her", "its", "their", "your", "our",
  "am", "is", "are", "was", "were", "be", "been", "shall", "will", "may", "might", "hath", "doth", "did",
]);
const incipitTitle = (text) => {
  const words = text.split(/\s+/).slice(0, 5);
  const boundary = words.findIndex((w) => /[,;:.!?]$/.test(w));
  let kept = boundary >= 2 ? words.slice(0, boundary + 1) : words;
  while (kept.length > 3 && INCIPIT_TRAILERS.has(kept[kept.length - 1].toLowerCase().replace(/[^a-z']/g, ""))) {
    kept = kept.slice(0, -1);
  }
  return kept.join(" ").replace(/[,.;:!?]+$/, "");
};

// ---------- the composed sentences ----------

const composeStudy = ({ book: rawBook, chapter, verse, text }, crossRefs, templateId) => {
  const template = STUDY_TEMPLATES.find((t) => t.id === templateId);
  if (!template || !text) return null;

  // The dealt book name is canonicalized through the app's own grammar
  // rather than trusted as-spelled — parseBareCitation matches
  // case-insensitively and hands back the canonical form, so a
  // case-drifted "PSALMS" from the service composes as "Psalms" instead
  // of sailing past a truthiness check and then blowing up every lookup
  // keyed on exact spelling below.
  const parsed = parseBareCitation(`${ rawBook } ${ chapter }:${ verse }`);
  if (!parsed) return null;
  const book = parsed.book;
  const reference = parsed.full;

  const hash = hashOf(reference);
  const details = BIBLE_BOOK_DETAILS[book] ?? {};
  const place = sectionOf(book);
  const chapterCount = BOOK_CHAPTER_COUNTS[book] ?? 0;
  if (!place || !chapterCount) return null; // structural-table drift — decline, never throw
  const isNT = BIBLE_BOOKS.indexOf(book) >= NT_START_INDEX;

  // Treasury links, re-validated through the app's own grammar and split
  // by testament — the raw strings are woven into prose inside one
  // semicolon-separated citation group, so each becomes a live pill.
  const xrefs = (crossRefs?.[reference] ?? []).filter((ref) => parseBareCitation(ref));
  const crossings = xrefs.filter((ref) => {
    const parsed = parseBareCitation(ref);
    return (BIBLE_BOOKS.indexOf(parsed.book) >= NT_START_INDEX) !== isNT;
  });
  const tag = (refs) => `(${ refs.join("; ") })`;

  const divineNames = divineNamesOf(text);
  const repeated = repeatedWordOf(text);
  const notable = notableWordsOf(text);
  const wordCount = text.split(/\s+/).length;

  // Section labels are category names, not plural nouns — "stands among
  // the Wisdom" is broken English and "Revelation stands among the
  // Revelation" was self-referential nonsense; single-book sections
  // (Acts, Revelation) get their own honest phrasing instead.
  const chapterClause = chapterCount > 1
    ? `, and this verse falls in the ${ ordinal(chapter) } of its ${ chapterCount } chapters`
    : ", a single-chapter book";
  const placeSentence = place.books.length === 1
    ? `${ book } stands on its own in the ${ place.testament } Testament's canon${ chapterClause }.`
    : `${ book } belongs to the ${ place.section } ${ /Prophets|Epistles|Gospels/.test(place.section) ? "" : "books " }of the ${ place.testament } Testament${ chapterClause }.`;
  const authorSentence = firstSentence(details.author);
  const periodSentence = firstSentence(details.period);
  const synopsisSentence = firstSentence(details.synopsis);
  const meaningSentence = firstSentence(details.meaning);

  const apparatusSentence = xrefs.length > 0
    ? pick(hash, 1, [
      // "From the Treasury..." — the COUNT is this app's bundled top-6
      // selection, not the printed Treasury's own (which lists far more
      // for well-trodden verses); the wording owns the selection rather
      // than attributing our cap to the named work.
      `From the Treasury of Scripture Knowledge, the bundled apparatus sets ${ xrefs.length === 1 ? "one companion passage" : `${ xrefs.length } companion passages` } beside this verse ${ tag(xrefs) }.`,
      `The bundled apparatus hands you ${ xrefs.length === 1 ? "a single witness to read alongside" : `${ xrefs.length } witnesses to read alongside` } ${ tag(xrefs) }.`,
    ])
    : "The bundled apparatus records no cross-reference for this verse — whatever connections you draw, the text itself must earn them.";

  const crossingSentence = crossings.length > 0
    ? `Its trail crosses the testaments ${ tag(crossings) } — the direction a fuller sense would have to travel.`
    : "";

  const divineClause = divineNames.length > 0
    ? `, and ${ joinNames(divineNames) } ${ divineNames.length === 1 ? "stands" : "stand" } in it by name`
    : "";
  const repeatedClause = repeated
    ? ` The wording repeats "${ repeated }" — repetition is never idle in scriptural rhetoric; circle it.`
    : "";

  // The verse is quoted VERBATIM, its own trailing punctuation included —
  // a mid-sentence verse really does end "...one LORD:" and the colon
  // stays, even sitting directly before the tag: smoothing scripture's own
  // punctuation for typography would be editing the quotation.
  const verseHead = `${ text } (${ reference })`;

  // Each builder returns the template's sections in order; the first
  // always opens with the dealt verse itself, tagged.
  const builders = {
    inductive: () => ({
      observation: `${ verseHead }\n\nBegin with what is actually there. ${ placeSentence } Read the verse twice, aloud once; mark every subject and every verb${ divineClause }.${ repeatedClause } Write down only observations a stranger could check against the words themselves — what is asserted, what is assumed, and what surprised you by its absence.`,
      interpretation: joinSentences(authorSentence, periodSentence, `Interpretation asks what this sentence meant before it meant anything to you — read it inside that setting, as its first hearers had to. ${ apparatusSentence } Let any parallel sharpen the verse's own claim rather than replace it, and then state that claim in one plain sentence of your own.`),
      application: `${ pick(hash, 2, [
        "Only what the text actually asserts can bind the conscience — application begins where accurate reading ends.",
        "Application is not decoration added to a reading; it is the reading arriving home.",
      ]) } Name one place this week where the verse's claim touches your practice, and one habit it corrects.${ xrefs.length > 0 ? ` If a companion passage above pressed hardest, put it beside this verse and let the two examine you together.` : "" } End by writing the single next act the text will bear.`,
    }),

    quadriga: () => ({
      literal: `${ verseHead }\n\n${ joinSentences("The letter comes first, or nothing built on it stands.", placeSentence, authorSentence, `Establish what the human author asserted to his own audience — no more and no less — before any further sense is attempted.${ repeatedClause }`) }`,
      allegorical: isNT
        ? `This verse is already the New Testament's own voice, so the allegorical question runs backward: what older scripture does it take up, and how does it read what it takes up?${ crossings.length > 0 ? ` The apparatus points across the testaments ${ tag(crossings) }.` : "" } Trace the older text before claiming the newer one has transformed it.`
        : `Whether Christ may be read here is not free association — the church's own rule demands a warrant in the New Testament's reading of this very text.${ crossings.length > 0 ? ` The Treasury already carries this verse across the testaments ${ tag(crossings) }; weigh whether any of these amounts to warrant.` : ` The bundled apparatus records no crossing to the New Testament here, which is itself worth respecting: a spiritual sense without a canonical trail must be held all the more loosely.` } If a warrant holds, mark the typology yourself — highlight the citation and set an arrow — so the claim stands examined rather than assumed.`,
      tropological: `What conduct follows — argued from the literal sense, not around it? Let the verse's own verbs set the agenda: what they assert about ${ divineNames.length > 0 ? joinNames(divineNames) : "God and his ways" } becomes, by the same measure, a claim on you. Write the duty in your own words, then test it against the letter above; a moral reading that contradicts the literal one has left the text behind.`,
      anagogical: `What hope does it direct toward — what is promised, not merely evoked? Read the verse once more as a word spoken toward the end of all things, and write only the hope you can trace to its own words${ crossings.length > 0 ? " or along the apparatus's own trail above" : "" }. Where the text promises nothing, say so plainly; hope claimed without warrant comforts no one for long.`,
    }),

    lectio: () => ({
      lectio: `${ verseHead }\n\nRead slowly, twice, the second time aloud. Which word arrests you${ notable.length > 0 ? ` — perhaps "${ notable[0] }"${ notable[1] ? `, perhaps "${ notable[1] }"` : "" }, perhaps another entirely` : "" }? Stay with the word that stopped you; do not hurry past it toward a lesson. ${ placeSentence }`,
      meditatio: `Ponder the arrested word until it opens. ${ apparatusSentence }${ crossingSentence ? ` ${ crossingSentence }` : "" } Let the canon answer the canon while you hold this one verse still — meditation ranges widely precisely so that it can return to the same few words with more in its hands.`,
      oratio: `Answer back. Turn the verse's own language into address: where it speaks of ${ divineNames.length > 0 ? joinNames(divineNames) : "God" }, speak to him; where it names what you lack, ask for it without ornament; where it names what you have been given, give thanks in the same plain words. Prayer here is not commentary — it is the reading, continued in the second person.`,
      contemplatio: `Rest. Beyond the asking there is only staying: remain with the word of ${ book } as a place rather than a task. When your own words run out, let the verse keep speaking, and do not reach for a conclusion — what remains true in the silence is what you came for.`,
    }),

    doctrineUse: () => ({
      text: `${ verseHead }\n\n${ joinSentences(placeSentence, meaningSentence, "Settle the text first: read it whole, mark its claim, and let it stand in its own words before any doctrine is drawn from it.") }`,
      doctrine: `State the truth this text teaches as one plain proposition — the Puritan divines wrote it as a single sentence and defended every word of it from the text. ${ apparatusSentence } A doctrine no parallel supports may still be true, but hold it more loosely than one the wider canon presses on you from several sides.`,
      use: `Put the doctrine to its uses, as the old method requires: for conviction — where does it find you out; for comfort — what does it give you to stand on; for practice — what will you do differently before the week ends? Write all three, each in one sentence, each traceable back to the text above and none exceeding it.`,
    }),

    exegetical: () => ({
      passage: `${ verseHead }\n\nSet the unit down whole before commenting on any part of it. ${ placeSentence } In the English of the King James Version the verse runs ${ wordCount } words — ${ wordCount <= 40 ? "small enough to weigh one word at a time, which is the pace this bench works at" : "long enough that this bench will take it a clause at a time, which is the same discipline at a different stride" }.`,
      context: joinSentences(authorSentence, periodSentence, synopsisSentence, "Place this verse inside that larger argument before reading anything out of it — a sentence's meaning is fixed by the book it serves, not by the uses later readers found for it."),
      observations: `Work the surface before the depths: note the tense and mood of the main verbs, what is asserted versus what is assumed${ divineClause }.${ repeatedClause } Note also what the verse does not say that you expected it to — absence is data. Every observation recorded here should survive a hostile reader checking it against the words.`,
      theology: joinSentences(
        apparatusSentence,
        crossingSentence,
        // "Read the parallels" only when there ARE parallels — beside the
        // no-xref apparatus sentence it contradicted itself in one breath.
        xrefs.length > 0
          ? "Read the parallels in full, not as proof-texts, and ask what the whole canon does with this verse — stated from the text, never over it. Where witnesses disagree in emphasis, record the tension instead of flattening it."
          : "With no bundled parallels to lean on, let the book's own larger argument be the canon's first witness here — and hold any wider connection you reach for to the same stated-from-the-text standard."
      ),
      significance: `What follows once the exegesis stands? Write the verse's significance in two registers: what the church may confess on its authority, and the next obedient step it asks of you in particular. Neither register may exceed what Context and Observations above will actually bear.`,
    }),
  };

  const sections = builders[template.id]?.();
  if (!sections) return null;

  // The fuller-sense layer rides along only when the apparatus itself
  // crosses the testaments — a data-warranted occasion, not a coin flip —
  // and its wording follows the crossing's actual DIRECTION: for an Old
  // Testament verse the fuller sense may lie beyond this writer's own
  // horizon; for a New Testament verse the crossing points BACKWARD, and
  // the question becomes whether this text is an older preparation
  // arriving (the same direction its own allegorical section already
  // reads in — the two must never contradict each other).
  if (crossings.length > 0) {
    sections.sensusPlenior = isNT
      ? `The fuller sense is a claim about the divine author, never a license against the human one. This verse's own apparatus reaches back across the testaments ${ tag(crossings) }: read those older texts beside it and ask what God, knowing the end from the beginning, was preparing in them beyond their writers' own horizon — and whether this verse is that preparation arriving. Write only what the canonical connections themselves will carry — a sensus plenior that cannot cite its trail is only a mood.`
      : `The fuller sense is a claim about the divine author, never a license against the human one. This verse's own apparatus already crosses the testaments ${ tag(crossings) }: read those texts beside it and ask what God, knowing the end from the beginning, was preparing here beyond the writer's own horizon. Write only what the canonical connections themselves will carry — a sensus plenior that cannot cite its trail is only a mood.`;
  }

  const composed = stringifyStudy(template, sections);

  // Belt and braces before anything is ever dealt: the composed text must
  // read back as exactly the study it claims to be through the app's own
  // parsers, or it is silently discarded (a dropped pantry entry costs
  // nothing; a malformed study dealt onto the desk costs trust).
  if (detectStudyTemplate(composed)?.id !== template.id) return null;
  const roundTrip = parseStudy(composed);
  if (stringifyStudy(roundTrip.template, roundTrip.sections) !== composed) return null;

  return {
    templateId: template.id,
    reference,
    title: incipitTitle(text),
    text: composed,
  };
};

// Exported for standalone verification scripts — the app itself only ever
// goes through the pantry below. The small text helpers are shared with
// weaveComposer.js (the Proclamation Weave genre builds on the same
// deterministic-variant and incipit-title conventions rather than growing
// second copies that could drift).
export { composeStudy, hashOf, pick, incipitTitle, joinSentences };

// ---------- the pantry ----------
//
// Pours are synchronous; composing needs a network verse. Rather than
// mutate a note after the fact (the async-seed design a previous round
// deliberately deleted, guards and all), studies are composed AHEAD into
// this small module-level pantry — background tier, at most a couple of
// verses in flight — and a pour simply takes one that is already whole.
// Empty pantry just means plain paper this pour and a refill on the way.
const PANTRY_TARGET = 2;
const FILL_ATTEMPTS = 4;
const pantry = [];
let filling = false;

const fillPantry = async () => {
  if (filling || pantry.length >= PANTRY_TARGET) return;
  filling = true;

  try {
    for (let attempt = 0; attempt < FILL_ATTEMPTS && pantry.length < PANTRY_TARGET; attempt++) {
      // Each attempt is individually disposable — a thrown surprise costs
      // that attempt, never the loop, and can never escape fillPantry as a
      // floating unhandled rejection (nothing awaits this function).
      try {
        const [dealt, crossRefs] = await Promise.all([
          fetchRandomVerse({ background: true }),
          loadCrossReferences(),
        ]);
        if (dealt.status !== "ok") break; // offline/rate-limited — a later prime retries

        // A dataset that resolved EMPTY didn't load (crossReferences.js
        // resolves {} on a failed fetch — and no longer caches the
        // failure, so a later prime retries) — composing against it would
        // bake the false sentence "records no cross-reference" into
        // permanent note text for verses the Treasury actually covers.
        if (Object.keys(crossRefs).length === 0) break;

        const reference = `${ dealt.book } ${ dealt.chapter }:${ dealt.verse }`;
        if (pantry.some((entry) => entry.reference.toLowerCase() === reference.toLowerCase())) continue;

        const templateId = STUDY_TEMPLATES[hashOf(reference) % STUDY_TEMPLATES.length].id;
        // composeStudy/composeWeave both canonicalize the dealt book's
        // spelling themselves and decline (null) anything they can't
        // place — no pre-check needed. The weave path is async on its own
        // account (it fetches the chapter and up to two linked passages,
        // background tier); every other template composes synchronously
        // from what's already in hand.
        const entry = templateId === "weave"
          ? await composeWeave(dealt, crossRefs)
          : composeStudy(dealt, crossRefs, templateId);
        if (entry) pantry.push(entry);
      } catch {
        // one bad attempt — the next may fare better
      }
    }
  } finally {
    filling = false;
  }
};

// Starts a background fill if one isn't already running — called when the
// hand-authored library runs low, so the first composed study is usually
// ready by the time it is actually needed.
export function primeStudyPantry() {
  fillPantry();
}

// Hands over one composed study whose primary verse isn't already on the
// desk (`isReferenceTaken` is the caller's own check against its notes —
// the pantry can't see them), removing it from the pantry and starting a
// refill. Returns null when nothing suitable is ready yet.
//
// Blocked entries are EVICTED, not skipped: a taken reference can get
// onto the desk without going through the pantry at all (any note citing
// that verse inline — including another study's own apparatus group), and
// a merely-skipped entry would then sit in its slot forever, counting
// toward PANTRY_TARGET so no refill happens either. Two of those and the
// composer is silently dead for the session. Evicting costs one cheap
// recompose of some other verse; deadlock costs the feature.
export function takeComposedStudy(isReferenceTaken) {
  for (let i = pantry.length - 1; i >= 0; i--) {
    if (isReferenceTaken(pantry[i].reference)) pantry.splice(i, 1);
  }
  const entry = pantry.length > 0 ? pantry.shift() : null;
  fillPantry();
  return entry;
}
