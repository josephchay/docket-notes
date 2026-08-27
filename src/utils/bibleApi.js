// A thin client for bible-api.com — the one piece the rest of the Bible
// features never had: actual scripture TEXT, not just a recognized
// reference. Free, keyless, CORS-enabled, defaults here to the King James
// Version to match the voice quotes.json already writes in (see that
// file's own note about being untranslated/unlabeled KJV Genesis text).
// This is deliberately the ONLY place in the app that talks to a network
// service — everything else here is local-first by design (sessionStorage/
// localStorage, no backend) — so every call is cached and nothing fetches
// eagerly; a caller decides when a lookup is actually worth spending one of
// bible-api.com's own rate-limited requests on (15 per 30s per IP, an
// unsupported hobby service with no uptime guarantee, so failures here are
// expected, not exceptional).

const BASE_URL = "https://bible-api.com/";
const TRANSLATION = "kjv";

// A real citation.path is one of three shapes this app recognizes (see
// citations.js): a bare chapter ("3"), a standard chapter:verse[-verse]
// ("1:16" or "1:16-18"), or this app's OWN invented chapter:verse:subverse
// three-number shorthand ("1:1:7") — a personal annotation convention this
// specific writing style leans on, not a real, standardized Bible
// reference. bible-api.com (like every real Bible reference scheme) has no
// concept of a third number, so guessing which of the first two numbers to
// drop and fetching anyway would risk confidently showing the WRONG verse
// under a citation that looks identical to a real one — worse than not
// showing text at all. Only a one- or two-segment path is ever fetchable.
export function isFetchablePath(path) {
  return /^\d+(:\d+(-\d+)?)?$/.test(path ?? "");
}

const cache = new Map(); // "book|path" -> Promise<result>, so a repeated or
// concurrently-duplicated lookup (a pill previewed twice, a search box
// re-typing the same reference) never spends a second real request.

// Resolves to one of:
//   { status: "unsupported" }              — a 3-segment path, see above
//   { status: "loading" }                  — never actually returned; callers
//                                             show this themselves while awaiting
//   { status: "ok", text, reference }      — text is the plain, already-
//                                             trimmed concatenated verse(s)
//   { status: "error", message }           — network failure, rate limit,
//                                             or bible-api.com itself not
//                                             recognizing the reference
export function fetchVerseText({ book, path }) {
  if (!isFetchablePath(path)) return Promise.resolve({ status: "unsupported" });

  const key = `${ book }|${ path }`.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  // Spaces in a multi-word book name ("Song of Solomon") become "+" the
  // same way the reference-as-a-whole does — bible-api.com's own documented
  // URL shape, confirmed against the live API rather than assumed.
  const url = `${ BASE_URL }${ `${ book } ${ path }`.replace(/ /g, "+") }?translation=${ TRANSLATION }`;

  const promise = fetch(url)
    .then(async (response) => {
      if (!response.ok) {
        return { status: "error", message: response.status === 404 ? "Reference not found" : `Lookup failed (${ response.status })` };
      }
      const data = await response.json();
      const text = (data.text ?? "").replace(/\s+/g, " ").trim();
      if (!text) return { status: "error", message: "No text returned" };
      return { status: "ok", text, reference: data.reference };
    })
    .catch(() => ({ status: "error", message: "Couldn't reach the lookup service" }));

  cache.set(key, promise);

  // An error result is deliberately NOT kept cached — everything else
  // (a real verse's text) is permanently true and safe to remember for the
  // rest of the session, but an error is very often transient (a dropped
  // connection, a momentary hit against the 15-per-30s rate limit), and
  // caching it anyway would leave a reference permanently "broken" for
  // this session the instant one lookup happened to fail, with no way for
  // a later click to ever try again.
  promise.then((result) => {
    if (result.status === "error") cache.delete(key);
  });

  return promise;
}
