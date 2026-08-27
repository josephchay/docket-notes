// Inline citations — the OTHER way a note can point at scripture, distinct
// from the single dedicated `reference` field (utils study/reference
// wiring in Home.jsx): a note can carry any number of parenthetical
// citations woven through its own prose, e.g. "Without was void (Genesis
// 1:1:10, 1:2:5-6)." A citation group is whatever sits inside one set of
// parens; each piece inside it — separated by a comma OR a semicolon, the
// two separators real Bible-citation prose actually mixes ("Genesis 1:1;
// Exodus 3:14, 4:1") — is its own reference, and a book name given once at
// the start of a group carries forward onto every piece after it that
// doesn't name its own — the exact shorthand this style of writing already
// leans on, so "Genesis 1:1:7, 1:3:9-10" reads as two references to
// Genesis, not one to Genesis and one to nothing.
//
// This never touches note.text itself — nothing here rewrites or marks up
// the note the way checklist/study markers do. It's purely a derived read,
// same spirit as isChecklistText, just producing a list instead of a
// yes/no.

// The 66 canonical English book names recognized inside a citation — full
// names only for now (no abbreviations), matched case-insensitively.
export const BIBLE_BOOKS = [
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy",
  "Joshua", "Judges", "Ruth", "1 Samuel", "2 Samuel",
  "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra",
  "Nehemiah", "Esther", "Job", "Psalms", "Proverbs",
  "Ecclesiastes", "Song of Solomon", "Isaiah", "Jeremiah", "Lamentations",
  "Ezekiel", "Daniel", "Hosea", "Joel", "Amos",
  "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk",
  "Zephaniah", "Haggai", "Zechariah", "Malachi",
  "Matthew", "Mark", "Luke", "John", "Acts",
  "Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians",
  "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians",
  "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews",
  "James", "1 Peter", "2 Peter", "1 John", "2 John",
  "3 John", "Jude", "Revelation",
];

const BOOK_LOOKUP = new Map(BIBLE_BOOKS.map((name) => [name.toLowerCase(), name]));

// One citation piece: an optional book name, then a chapter:verse path of
// two or three numbers, the last of which may itself be a range
// ("9-10") — "Genesis 1:1:7", "1:3:9-10" (book inherited), and
// "Jeremiah 4:23" (a plain two-part chapter:verse, no third number) are
// all valid shapes this same pattern accepts.
const PIECE = /^(?:([1-3]?\s?[A-Za-z][A-Za-z. ]*?)\s+)?(\d+(?::\d+){1,2}(?:-\d+)?)$/;

// The chapter-only fallback ("Genesis 3", no verse) — tried only once
// PIECE itself fails to match. Unlike PIECE, the book-name group here is
// NOT optional: a bare number with no book text of its own must never
// resolve through this pattern, even inside a group that already has a
// currentBook in scope — "(Genesis 3, 4)" tags "Genesis 3" and silently
// leaves the trailing "4" alone rather than guessing it means "Genesis 4",
// since a bare chapter number is far more likely to be ordinary prose (a
// footnote marker, a count) than shorthand for "same book, next chapter."
const BARE_CHAPTER = /^([1-3]?\s?[A-Za-z][A-Za-z. ]*?)\s+(\d+)$/;

// True when every chapter/verse segment in a matched path is a plausible
// positive number, and any trailing range doesn't run backwards. Chapter
// and verse numbering starts at 1 in every book with no exceptions, so a
// bare "0" anywhere is always a typo, never a real citation — the same is
// true of a range like "16-10", which no one means literally. Deliberately
// stops there rather than checking a number against real per-book
// chapter/verse limits: chapter counts are fixed canon-wide, but verse
// counts shift across translations/versification, so a hardcoded ceiling
// would eventually reject a real, correctly-typed citation just because it
// disagrees with whichever numbering the table happened to encode.
function isValidPath(path) {
  const [main, rangeEnd] = path.split("-");
  const segments = main.split(":").map(Number);
  if (segments.some((n) => n <= 0)) return false;

  if (rangeEnd !== undefined) {
    const end = Number(rangeEnd);
    if (end <= 0 || end < segments[segments.length - 1]) return false;
  }

  return true;
}

// Finds every "(...)" group in note text and parses each piece inside it
// (split on a comma or semicolon) as a citation. A piece that isn't
// recognized (ordinary parenthetical prose, or a bare number path with no
// book anywhere before it in the same group) is just skipped rather than
// treated as an error — a parenthetical aside and a citation group share
// identical syntax otherwise, so only the pieces that actually parse count
// as citations. Returns each distinct reference once, in first-seen order,
// along with `start`/`end` — the exact character range of THAT PIECE's own
// text within the original string (book name excluded when it was
// inherited rather than typed at that spot), so a caller can select/scroll
// straight to where a citation actually lives in the note rather than only
// searching for it elsewhere.
export function parseCitations(text) {
  const body = text ?? "";
  const found = [];
  const seen = new Set();
  const groupPattern = /\(([^()]+)\)/g;
  let groupMatch;

  while ((groupMatch = groupPattern.exec(body)) !== null) {
    const groupContent = groupMatch[1];
    const groupStart = groupMatch.index + 1; // just past the "("
    let currentBook = null;
    let cursor = 0; // offset into groupContent of the piece about to be read

    // Splitting on a single-character separator either way keeps this
    // cursor math exactly as valid for ";" as it already was for ",".
    for (const rawPiece of groupContent.split(/[,;]/)) {
      const pieceOffset = cursor;
      cursor += rawPiece.length + 1; // +1 to skip the separator this piece was split on

      const leading = rawPiece.match(/^\s*/)[0].length;
      const trimmed = rawPiece.trim();

      let rawBook, path;
      const m = trimmed.match(PIECE);
      if (m) {
        rawBook = m[1]?.trim();
        path = m[2];
      } else {
        const bare = trimmed.match(BARE_CHAPTER);
        if (!bare) continue;
        rawBook = bare[1].trim();
        path = bare[2];
      }
      if (!isValidPath(path)) continue;

      const book = rawBook ? BOOK_LOOKUP.get(rawBook.toLowerCase()) : currentBook;
      if (!book) continue;

      currentBook = book;
      const full = `${ book } ${ path }`;
      const key = full.toLowerCase();
      if (seen.has(key)) continue;

      seen.add(key);
      const start = groupStart + pieceOffset + leading;
      found.push({ book, path, full, start, end: start + trimmed.length });
    }
  }

  return found;
}

// Tests whether a standalone span of text — no surrounding group to
// inherit a book from — is itself a complete citation on its own, e.g. a
// visitor selecting text they typed as "Genesis 1:1" without ever wrapping
// it in parens. A book name is REQUIRED here (there's nothing else it
// could come from), unlike a piece living inside an existing group.
export function parseBareCitation(text) {
  const trimmed = (text ?? "").trim();

  let rawBook, path;
  const m = trimmed.match(PIECE);
  if (m) {
    if (!m[1]) return null;
    rawBook = m[1].trim();
    path = m[2];
  } else {
    const bare = trimmed.match(BARE_CHAPTER);
    if (!bare) return null;
    rawBook = bare[1].trim();
    path = bare[2];
  }
  if (!isValidPath(path)) return null;

  const book = BOOK_LOOKUP.get(rawBook.toLowerCase());
  if (!book) return null;

  return { book, path, full: `${ book } ${ path }` };
}

// The sentence/clause a citation reads as "attached to" — walked backward
// from the citation's own enclosing "(...)" group to the nearest preceding
// sentence boundary (a ".", "!", "?", newline, or the very start of the
// text). There's no explicit marker in the plain text distinguishing "this
// citation annotates THIS specific preceding clause" from "this citation
// just happens to sit somewhere in the prose" — this heuristic (the same
// one a reader's own eye would use, and the exact shape this app's own
// established "sentence (Book c:v)" writing style produces) is what lets
// selecting or hovering that clause recognize which citation it belongs
// to. Anchored off the citation's own enclosing group, not its bare
// `.start`, since a multi-piece group like "(Genesis 1:1, Exodus 3:14)"
// has every piece after the first starting mid-group (right after a
// comma) — the whole group still reads as belonging to one preceding
// clause, not each piece independently. Shared by NoteEditor.jsx's own
// selection-offer classification AND HoverCitationOverlay's mirror-
// backdrop marking — two different features that both need to agree on
// exactly the same span, so they call the exact same function rather than
// two independently-written searches that merely intend to agree (see
// the parseStudy/isStudyText lesson from an earlier round of this app).
export function findPrecedingSpan(text, citation) {
  const groupOpen = text.lastIndexOf("(", citation.start);
  let end = groupOpen === -1 ? citation.start : groupOpen;
  while (end > 0 && /\s/.test(text[end - 1])) end--;

  // ")" is a boundary too, not just sentence punctuation — otherwise, when
  // two citations share one sentence with no terminal punctuation between
  // them ("...formless (Genesis 1:1) and the light appeared (Genesis
  // 1:3)."), the walk would run straight through the FIRST citation's own
  // closing paren and swallow its entire "(Book c:v)" text into the
  // SECOND citation's span.
  let start = end;
  while (start > 0 && !/[.!?\n)]/.test(text[start - 1])) start--;
  while (start < end && /\s/.test(text[start])) start++;

  return { start, end };
}
