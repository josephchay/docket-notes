// Verse-to-verse cross-references — "Genesis 1:1" relates to "John 1:1-3",
// "Psalms 148:5", etc. — sourced from openbible.info's own cross-reference
// dataset (CC-BY, built from the public-domain Treasury of Scripture
// Knowledge; see https://www.openbible.info/labs/cross-references/),
// filtered down from its own full ~345,000 community-voted connections to
// the top 6 positive-voted references per verse (a printed Bible's own
// footnote apparatus is typically a handful per verse, not the full
// crowdsourced long tail — see the one-time processing script this file's
// own data was generated from for the exact filtering).
//
// Unlike a printed Bible's own cross-reference letters, this dataset has no
// word-level anchor (it only ever says "verse X relates to verse Y," never
// "specifically the word 'beginning' in verse X") — so this app renders its
// own lettered markers at the VERSE level (right after the verse number),
// not mid-word. An honest adaptation to what the data actually supports,
// not an attempt to fake a precision the source doesn't have.
//
// ~3MB uncompressed — meaningfully larger than every other piece of local
// data this app bundles, so it's NOT a static import (which would inflate
// every page load's own JS entry chunk regardless of whether Browse mode
// or its cross-references are ever opened this session). Instead it's a
// same-origin fetch of a public/ static file, lazy (only the first time
// anything actually asks for cross-reference data) and cached in module
// state thereafter, the same "never fetch the same thing twice" discipline
// bibleApi.js's own cache already holds itself to — just for one big local
// file instead of many small network calls.
let cachePromise = null;

function loadAll() {
  if (!cachePromise) {
    cachePromise = fetch(`${ process.env.PUBLIC_URL }/data/cross-references.json`)
      .then((response) => (response.ok ? response.json() : {}))
      .catch(() => ({}));
  }
  return cachePromise;
}

// Resolves to a plain object: "Book c:v" -> string[] of cross-referenced
// passages (already formatted as this app's own citation shorthand, e.g.
// "John 1:1-3"), for every verse the dataset covers at all — a caller reads
// whichever keys it needs (typically every verse in one currently-open
// chapter) rather than this module offering a single-verse lookup, since a
// caller showing a whole chapter needs nearly all of them at once anyway.
export function loadCrossReferences() {
  return loadAll();
}
