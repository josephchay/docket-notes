// The Proclamation Weave composer — the automatic side of the "weave"
// template (see STUDY_TEMPLATES): the citation-dense, quotation-woven,
// echo-driven proclamatory genre this app's own writer works in, rendered
// in complete pastoral sentences. Like studyComposer.js it never
// manufactures scholarship; unlike studyComposer.js its whole point IS
// connection — and the connections it proclaims are the one kind a
// machine can claim honestly: VERBAL ECHOES that actually exist in the
// letters. The method is the old concordance discipline (the rabbis'
// gezerah shavah, the Reformers' "scripture interprets scripture" worked
// at the level of shared words): where the dealt verse's chapter and its
// own Treasury-linked passages genuinely share a run of words, both
// places are quoted EXACTLY — every quotation in a composed weave is a
// verbatim substring of a fetched KJV text, checkable character by
// character — and the echo is set forth for the reader to weigh. Where no
// echo exists, none is claimed; the weave says so and hands the loom to
// the reader.
//
// Composition costs at most three background-tier requests (the chapter,
// plus up to two Treasury-linked passages — all cached by bibleApi.js's
// own session cache), spent ahead of need by studyComposer's pantry,
// never at pour time.
import { BIBLE_BOOKS, NT_START_INDEX, parseBareCitation } from "./citations";
import { STUDY_TEMPLATES, stringifyStudy, detectStudyTemplate, parseStudy } from "./study";
import { fetchVerseText } from "./bibleApi";
import { hashOf, pick, incipitTitle } from "./studyComposer";

// Words that can't carry an echo on their own — a shared run must hold at
// least one word NOT in this list, or "and he said unto" would count as
// the canon quoting itself.
const ECHO_STOPWORDS = new Set(("the and of to in that for with unto upon a an is are was were be been shall will not his her their my thy thine mine your our its him them me thee you ye we they he she it i as at by on from into out which who whom this these those there then than but or nor so if when where all any every no o do did have hath had may might said saith says came come went cometh let also up down over under before after again more most very against among things thing day days man men one two every because behold now").split(" "));

const WORD = /[A-Za-z']+/g;
const tokenize = (text) => (text ?? "").toLowerCase().match(WORD) ?? [];

// Recovers the EXACT surface form of a token run from its source text —
// what makes every quoted echo a checkable verbatim substring rather than
// a normalized reconstruction.
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const surfaceOf = (tokens, source) => {
  const match = new RegExp(tokens.map(escapeRegExp).join("[^A-Za-z']+"), "i").exec(source);
  return match ? match[0] : null;
};

const gramsOf = (tokens, n) => {
  const grams = new Set();
  for (let i = 0; i + n <= tokens.length; i++) grams.add(tokens.slice(i, i + n).join(" "));
  return grams;
};

// The longest runs of words two texts genuinely share, longest first,
// each carrying at least one non-stopword, none nested inside an already
// chosen longer echo. Returns [{ tokens, surfaceA, surfaceB }].
export const sharedEchoes = (textA, textB, { maxEchoes = 2, maxN = 6, minN = 2 } = {}) => {
  const tokensA = tokenize(textA);
  const tokensB = tokenize(textB);
  const chosen = [];

  // The weight an echo actually carries is its NON-stopword substance —
  // "the Son of God" outweighs "of the world" at the same length, so
  // candidates at each length are ranked by that substance rather than
  // taken in first-found order.
  const substanceOf = (words) => words.filter((w) => !ECHO_STOPWORDS.has(w)).join("").length;

  for (let n = maxN; n >= minN && chosen.length < maxEchoes; n--) {
    const inB = gramsOf(tokensB, n);
    const candidates = [];
    for (const gram of gramsOf(tokensA, n)) {
      if (!inB.has(gram)) continue;

      const words = gram.split(" ");
      if (words.every((w) => ECHO_STOPWORDS.has(w))) continue;
      if (chosen.some((c) => c.tokens.join(" ").includes(gram))) continue;

      candidates.push(words);
    }

    candidates.sort((a, b) => substanceOf(b) - substanceOf(a));
    for (const words of candidates) {
      if (chosen.length >= maxEchoes) break;
      if (chosen.some((c) => c.tokens.join(" ").includes(words.join(" ")))) continue;

      const surfaceA = surfaceOf(words, textA);
      const surfaceB = surfaceOf(words, textB);
      if (!surfaceA || !surfaceB) continue;

      chosen.push({ tokens: words, surfaceA, surfaceB });
    }
  }

  return chosen;
};

// A verse's own most quotable stretch — the comma/colon-bounded clause
// whose words carry the most non-stopword weight, trimmed at word
// boundaries to quotation length. Always a verbatim substring of the
// verse.
export const quotableClauseOf = (text) => {
  const clauses = (text ?? "").split(/[,;:.!?]+/).map((c) => c.trim()).filter((c) => c.length > 0);
  if (clauses.length === 0) return null;

  const weightOf = (clause) => tokenize(clause).filter((w) => !ECHO_STOPWORDS.has(w)).join("").length;
  let best = clauses[0];
  for (const clause of clauses) if (weightOf(clause) > weightOf(best)) best = clause;

  const words = best.split(/\s+/);
  return words.length <= 9 ? best : words.slice(0, 9).join(" ");
};

// Composes one complete Proclamation Weave around a dealt verse. `fetch`
// work happens here (chapter + up to two linked passages, background
// tier); everything after is the same deterministic, self-validating
// discipline studyComposer.js keeps. Resolves to a pantry entry or null.
export async function composeWeave({ book: rawBook, chapter, verse, text }, crossRefs) {
  const template = STUDY_TEMPLATES.find((t) => t.id === "weave");
  if (!template || !text) return null;

  const parsed = parseBareCitation(`${ rawBook } ${ chapter }:${ verse }`);
  if (!parsed) return null;
  const book = parsed.book;
  const reference = parsed.full;
  const hash = hashOf(reference);
  const isNT = BIBLE_BOOKS.indexOf(book) >= NT_START_INDEX;

  // The whole chapter — the cloth the proclamation is cut from.
  const chapterResult = await fetchVerseText({ book, path: `${ chapter }` }, { background: true });
  if (chapterResult.status !== "ok" || !Array.isArray(chapterResult.verses) || chapterResult.verses.length === 0) return null;
  const verses = chapterResult.verses;

  // Up to two Treasury-linked passages, crossings first — the places the
  // apparatus itself says to listen for the echo. Links into the SAME
  // chapter are excluded outright: their text is already part of the
  // cloth being searched, so any "echo" found there would be the chapter
  // quoting itself verbatim — a tautology dressed as a discovery.
  const links = (crossRefs?.[reference] ?? []).filter((ref) => {
    const linkParsed = parseBareCitation(ref);
    return linkParsed && !(linkParsed.book === book && linkParsed.path.split(":")[0] === `${ chapter }`);
  });
  const crossings = links.filter((ref) => (BIBLE_BOOKS.indexOf(parseBareCitation(ref).book) >= NT_START_INDEX) !== isNT);
  const echoTargets = [...crossings, ...links.filter((ref) => !crossings.includes(ref))].slice(0, 2);

  const chapterText = verses.map((v) => v.text).join(" ");
  const echoes = [];
  for (const target of echoTargets) {
    const targetParsed = parseBareCitation(target);
    const result = await fetchVerseText(targetParsed, { background: true });
    if (result.status !== "ok") continue;

    const found = sharedEchoes(chapterText, result.text, { maxEchoes: 1 });
    if (found.length > 0) {
      echoes.push({ reference: target, surfaceHere: found[0].surfaceA, surfaceThere: found[0].surfaceB });
    } else {
      echoes.push({ reference: target, surfaceHere: null, surfaceThere: null });
    }
  }
  const sounded = echoes.filter((e) => e.surfaceHere);
  const silent = echoes.filter((e) => !e.surfaceHere);

  // ---------- Proclamation: the chapter set forth as one telling ----------
  // A handful of verses spread across the chapter — always the first and
  // the dealt verse, with up to two more between — each contributing its
  // own most quotable clause, every quotation tagged.
  const stationNumbers = [...new Set([
    1,
    Math.max(1, Math.ceil(verses.length / 3)),
    Math.max(1, Math.ceil((2 * verses.length) / 3)),
    verse,
  ])].filter((n) => verses.some((v) => v.number === n)).sort((a, b) => a - b);

  const stations = stationNumbers
    .map((n) => {
      const stationVerse = verses.find((v) => v.number === n);
      const clause = quotableClauseOf(stationVerse.text);
      return clause ? `"${ clause }" (${ book } ${ chapter }:${ n })` : null;
    })
    .filter(Boolean);

  const opening = pick(hash, 3, [
    `Hear the word as ${ book } ${ chapter } sets it down, clause upon clause, each carrying its own witness.`,
    `Set forth the account of ${ book } ${ chapter }, and let every clause bear its citation as it goes.`,
  ]);
  const proclamation = `${ text } (${ reference })\n\n${ opening } It stands written: ${ stations.join("; and again, ") }. So the chapter bears one telling from its first word to its last, and the verse dealt to you stands within that telling — not a fragment, but a thread in the cloth. Read the whole of it aloud, and mark where your verse takes up the words of its neighbours.`;

  // ---------- Echoes: the same words sounding again ----------
  const echoSentences = sounded.map(({ reference: ref, surfaceHere, surfaceThere }) =>
    `Mark well how the words return: here it is written "${ surfaceHere }" (${ book } ${ chapter }), and the same words sound again where it is written "${ surfaceThere }" (${ ref }). The echo is in the letters themselves — weigh what it asks of you.`
  );
  const silentSentence = silent.length > 0
    ? `The apparatus also sets ${ silent.length === 1 ? `this passage beside the chapter (${ silent.map((e) => e.reference).join("; ") })` : `these passages beside the chapter (${ silent.map((e) => e.reference).join("; ") })` }, though their kinship is of matter rather than of shared words — read ${ silent.length === 1 ? "it" : "them" } and judge the tie yourself.`
    : "";
  const noEchoFallback = `No linked passage in the bundled apparatus shares a run of words with this chapter — so no echo is claimed here, for an echo that is not in the letters is only an assertion. Take the concordance work upon yourself: choose the chapter's weightiest word, follow it through the canon, and quote exactly whatever you find.`;
  const echoesSection = sounded.length > 0
    ? [
      ...echoSentences,
      silentSentence,
      `This is the old discipline — scripture heard interpreting scripture, one cloth, its threads running farther than one chapter. Claim nothing the letters do not carry, and neglect nothing they do.`,
    ].filter(Boolean).join(" ")
    : [noEchoFallback, silentSentence].filter(Boolean).join(" ");

  // ---------- Exhortation: the charge ----------
  const verseClause = quotableClauseOf(text);
  const exhortation = [
    pick(hash, 4, [
      `Now the charge, for what was proclaimed is not a tale but a summons.`,
      `Now hear the charge, for a word set forth demands a hearer, not an audience.`,
    ]),
    verseClause
      ? `Take the word dealt to you — "${ verseClause }" (${ reference }) — and keep it before your eyes this day; let it be the measure you carry into every dealing.`
      : `Take the word dealt to you (${ reference }) and keep it before your eyes this day; let it be the measure you carry into every dealing.`,
    sounded.length > 0
      ? `Where its words sounded again in ${ sounded.map((e) => e.reference).join(" and ") }, go there and read both places aloud, that the one text may charge you with the other's weight.`
      : `And where the canon seems silent around it, search the more diligently — the threads are longer than one sitting will trace.`,
    `Walk as one who has heard; the word does not return void (Isaiah 55:11).`,
  ].join(" ");

  const sections = {
    proclamation,
    echoes: echoesSection,
    exhortation,
  };

  const composed = stringifyStudy(template, sections);
  if (detectStudyTemplate(composed)?.id !== "weave") return null;
  const roundTrip = parseStudy(composed);
  if (stringifyStudy(roundTrip.template, roundTrip.sections) !== composed) return null;

  return { templateId: "weave", reference, title: incipitTitle(text), text: composed };
}
