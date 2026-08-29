// The dealt verse — what quotes.json used to be, replaced with the real
// thing: every fresh note's placeholder (and the daily-ink card's line) is
// now an actual random KJV verse from bible-api.com, TAGGED in this app's
// own "(Book c:v)" citation grammar, so the verse a blank note wears isn't
// just decoration — parseCitations reads it, the editor's pills/preview
// recognize it, and the moment real writing replaces it (a placeholder
// only ever shows while the note is empty) it steps aside, returning the
// instant the note is emptied again.
import { fetchRandomVerse } from "./bibleApi";
import { parseBareCitation } from "./citations";

// A handful of KJV verses (public domain) kept locally for the moments the
// live deal can't happen — a pour while offline, a rate-limit collision, a
// bulk import that would otherwise fire dozens of requests at once. NOT a
// dataset the way quotes.json was: the live service is the source of the
// endless variety; these exist only so an empty note is never wearing a
// blank or an error.
export const FALLBACK_VERSES = [
  { text: "In the beginning God created the heaven and the earth.", reference: "Genesis 1:1" },
  { text: "The LORD is my shepherd; I shall not want.", reference: "Psalms 23:1" },
  { text: "Thy word is a lamp unto my feet, and a light unto my path.", reference: "Psalms 119:105" },
  { text: "Trust in the LORD with all thine heart; and lean not unto thine own understanding.", reference: "Proverbs 3:5" },
  { text: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.", reference: "John 3:16" },
  { text: "And we know that all things work together for good to them that love God, to them who are the called according to his purpose.", reference: "Romans 8:28" },
  { text: "I can do all things through Christ which strengtheneth me.", reference: "Philippians 4:13" },
];

// The one place a verse-and-reference pair becomes the tagged placeholder
// string — trailing parenthetical citation, exactly the "prose (Book c:v)"
// shape parseCitations reads and the highlight-to-annotate flow writes.
const asTaggedVerse = ({ text, reference }) => `${ text } (${ reference })`;

const randomFallbackParts = () => FALLBACK_VERSES[Math.floor(Math.random() * FALLBACK_VERSES.length)];

export function randomFallbackVerse() {
  return asTaggedVerse(randomFallbackParts());
}

// Deals one verse as { text, reference }, ALWAYS resolving to something
// usable — the live service's verse when it arrives, a local fallback when
// it doesn't. The dealt reference is re-validated through the app's own
// citation grammar (parseBareCitation) before it's ever trusted: the
// service's book spellings matched BIBLE_BOOKS exactly when checked live,
// but a tag that doesn't parse would be worse than a fallback — a verse
// wearing a citation the rest of the app can't read.
export function dealRandomVerseParts({ background } = {}) {
  return fetchRandomVerse({ background }).then((result) => {
    if (result.status !== "ok") return randomFallbackParts();

    const reference = `${ result.book } ${ result.chapter }:${ result.verse }`;
    if (!parseBareCitation(reference)) return randomFallbackParts();

    return { text: result.text, reference };
  });
}

// The same deal, already formatted as a note's tagged placeholder string.
export function dealRandomVerse(options) {
  return dealRandomVerseParts(options).then(asTaggedVerse);
}
