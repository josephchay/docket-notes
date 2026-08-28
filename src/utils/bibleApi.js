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

// A shared sliding-window budget for the whole module — every caller
// (ScriptureIndexPanel's own query lookup AND its chapter hover-preview,
// ReferencePicker's chapter hover-preview, NoteEditor's citation-pill
// preview) only ever self-debounces its OWN triggering interaction; none
// of them know about each other, so nothing previously coordinated against
// the 15-requests/30s-per-IP limit this whole file's own top comment
// documents. An ordinary sweep across a chapter grid hovering a dozen
// cells, on its own, already clears that budget. Rather than touch every
// call site to add cross-component coordination, this queues admission
// centrally, in the one place every one of them already funnels through:
// once ~15 real requests have gone out in the trailing 30s, any further
// one waits for the oldest of those to age out of the window before it's
// allowed to actually fire, instead of firing straight into a 429. This
// only paces WHEN a request starts, not the request itself — it doesn't
// cancel or coalesce anything, just keeps this module's own total request
// rate under the documented ceiling regardless of how many independent
// callers are triggering it at once.
//
// Two tiers, not a flat queue: a `background` request (a chapter-preview
// hover, purely a taste while scanning — never a deliberate commit) never
// makes a `foreground` one (a typed/clicked lookup, a citation-pill
// preview) wait behind it. Without this, a plain scan across a large
// book's chapter grid could burn the whole 30s budget on hovers alone,
// leaving an unrelated, genuinely-clicked lookup elsewhere in the app
// stuck on "Looking it up…" for up to 30 real seconds with no visible
// reason why — foreground admissions are always taken first whenever a
// slot opens, regardless of queue order, so a deliberate action is never
// held hostage by ambient background activity that happened moments
// earlier.
const REQUEST_LIMIT = 15;
const REQUEST_WINDOW_MS = 30000;
const requestTimestamps = [];
const pendingAdmissions = []; // { resolve, background }
let draining = false;

function admitNext() {
  if (draining) return;
  draining = true;

  const tick = () => {
    if (pendingAdmissions.length === 0) { draining = false; return; }

    const now = Date.now();
    while (requestTimestamps.length && requestTimestamps[0] <= now - REQUEST_WINDOW_MS) {
      requestTimestamps.shift();
    }

    if (requestTimestamps.length >= REQUEST_LIMIT) {
      const waitMs = requestTimestamps[0] + REQUEST_WINDOW_MS - now;
      setTimeout(tick, Math.max(waitMs, 0) + 1);
      return;
    }

    let nextIndex = pendingAdmissions.findIndex((p) => !p.background);
    if (nextIndex === -1) nextIndex = 0;
    const [next] = pendingAdmissions.splice(nextIndex, 1);
    requestTimestamps.push(Date.now());
    next.resolve();

    tick();
  };

  tick();
}

function waitForSlot(background) {
  return new Promise((resolve) => {
    pendingAdmissions.push({ resolve, background: !!background });
    admitNext();
  });
}

// Resolves to one of:
//   { status: "unsupported" }              — a 3-segment path, see above
//   { status: "loading" }                  — never actually returned; callers
//                                             show this themselves while awaiting
//   { status: "ok", text, reference,       — text is the plain, already-
//     verses }                               trimmed concatenated verse(s);
//                                             verses is the same passage
//                                             broken out one entry per verse
//                                             ({ number, text }, individually
//                                             trimmed) — bible-api.com always
//                                             returns this breakdown, even
//                                             for a single-verse request, so
//                                             a caller browsing a whole
//                                             chapter can read it verse by
//                                             verse instead of one long
//                                             concatenated paragraph, with
//                                             no separate fetch of its own.
//   { status: "error", message }           — network failure, rate limit,
//                                             or bible-api.com itself not
//                                             recognizing the reference
//
// `background` (default false) marks this call as ambient/exploratory —
// a chapter-grid hover-preview, not a deliberate click/typed lookup — so
// it queues behind every foreground request already waiting for a slot,
// no matter which order they actually arrived in. Doesn't affect caching:
// the same book|path is deduped and shared across a background AND a
// foreground call alike, since the cache key is only ever the reference
// itself, never the priority it happened to be requested at.
export function fetchVerseText({ book, path }, { background } = {}) {
  if (!isFetchablePath(path)) return Promise.resolve({ status: "unsupported" });

  const key = `${ book }|${ path }`.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  // Spaces in a multi-word book name ("Song of Solomon") become "+" the
  // same way the reference-as-a-whole does — bible-api.com's own documented
  // URL shape, confirmed against the live API rather than assumed.
  const url = `${ BASE_URL }${ `${ book } ${ path }`.replace(/ /g, "+") }?translation=${ TRANSLATION }`;

  const promise = waitForSlot(background)
    .then(() => fetch(url))
    .then(async (response) => {
      if (!response.ok) {
        return { status: "error", message: response.status === 404 ? "Reference not found" : `Lookup failed (${ response.status })` };
      }
      const data = await response.json();
      const text = (data.text ?? "").replace(/\s+/g, " ").trim();
      if (!text) return { status: "error", message: "No text returned" };
      const verses = Array.isArray(data.verses)
        ? data.verses.map((v) => ({ number: v.verse, text: (v.text ?? "").replace(/\s+/g, " ").trim() }))
        : [];
      return { status: "ok", text, reference: data.reference, verses };
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
