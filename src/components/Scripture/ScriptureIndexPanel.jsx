import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FaXmark, FaBookBible, FaBookOpen, FaMagnifyingGlass, FaChevronLeft, FaChevronDown, FaCopy, FaCheck } from "react-icons/fa6";

import useFocusTrap from "../../hooks/useFocusTrap";
import { parseBareCitation } from "../../utils/citations";
import { BOOK_CHAPTER_COUNTS, BOOK_SECTIONS } from "../../utils/bibleBooks";
import { BIBLE_BOOK_DETAILS } from "../../utils/bibleBookDetails";
import { loadCrossReferences } from "../../utils/crossReferences";
import { fetchVerseText } from "../../utils/bibleApi";
import { SNAPPY, RAIL_SLIDE } from "../Motion";

import "./ScriptureIndexPanel.css";

// Below this width there's no real room for the dock to sit beside
// anything else (NoteEditor's own smallest "cozy" preset is already
// min(520px, 94vw)) — side-by-side reading stops being a realistic option,
// so the dock falls back to the exact modal behavior every other panel in
// this app already uses (backdrop, focus trap) rather than a half-covered
// non-modal rail nobody could actually read next to. Kept as a plain literal
// mirrored in the CSS media query rather than a shared constant — the one
// other breakpoint in this codebase (HistoryPanel.css) does the same, since
// a CSS @media can't import a JS value.
const NARROW_BREAKPOINT = "(max-width: 720px)";

// The event the command palette's "Open the Scripture Index" entry (and the
// toolbar's own button) fire to summon this panel from anywhere.
export const SCRIPTURE_INDEX_EVENT = "docket:scripture-index";

// How long to let typing settle before actually spending a lookup on it —
// bible-api.com is tightly rate-limited (15 requests/30s per IP, see utils/
// bibleApi.js), so this only ever fires once per pause in typing, never
// once per keystroke.
const SEARCH_DEBOUNCE = 450;

// Same reasoning as ReferencePicker.jsx's own identical constant: a fast
// sweep across a dozen chapter cells while scanning for the right one must
// never fire a dozen requests against the same tightly-rate-limited API.
const CHAPTER_PREVIEW_DEBOUNCE = 400;

// Lettered cross-reference markers, printed-Bible style ("a," "b," "c," …).
// utils/crossReferences.js caps every verse at 6 references, well under 26,
// so plain a-z (never needing a second pass through the alphabet) is safe.
const XREF_LETTERS = "abcdefghijklmnopqrstuvwxyz";

// Every inline citation across the whole desk, one row each, in canonical
// Bible order — the corpus-wide counterpart to a single note's own pill row
// (see NoteEditor.jsx): that row answers "what does THIS note cite," this
// answers "what has the whole desk cited, and how often." `entries` is
// already aggregated and sorted by Home.jsx's own scriptureIndex memo (see
// its own comment there for why). On top of browsing it, the search field
// does two things at once, same as HistoryPanel's own search box does for
// its list: narrows the visible entries to ones matching what's typed
// (never replacing the list wholesale — typing "gen" still shows every
// already-cited Genesis passage, not a dead end), AND, whenever what's
// typed happens to fully parse as a real reference (the same shorthand
// parseBareCitation already recognizes elsewhere), fetches that passage's
// actual text live above the list — independent of whether it's ever been
// cited in a note at all. Both can show together: a passage can be both
// something already written about AND something being looked up fresh.
//
// A "Cited" / "Browse" tab sits above that: Cited is the view described
// above; Browse is the old single dedicated note.reference field's own
// zero-typing book -> chapter [-> verse] picker (see ReferencePicker.jsx),
// relocated here now that per-note field is gone and this panel is the
// one remaining desk-wide home for "find/look up a passage" as a whole.
// Deliberately NOT a reuse of the ReferencePicker COMPONENT itself — that
// one is built as a small anchored popover (portal + anchorRef position
// math + outside-pointerdown-to-close), a shape this full-height side dock
// doesn't need and would only fight; only the underlying DATA
// (bibleBooks.js's chapter counts/sections, bibleApi.js's fetchVerseText)
// is shared, not the JSX. Picking a book/chapter/verse never opens a
// SEPARATE result view — it just sets `query`, the exact same state the
// search box above already drives, so the SAME lookup effect and lookup
// card handle both a typed reference and a browsed one identically; the
// only thing Browse mode adds is a second, click-only way to produce that
// same query string. The instant a chapter is picked, its actual verse-by-
// verse text is fetched and listed right there, in the same chapter view —
// not gated behind a separate "narrow to a verse" step — so choosing a
// verse means reading it in context, not guessing a number blind. Kept as
// its OWN chapterVerses state rather than derived from `lookup`, since
// `lookup` itself becomes a single narrowed verse the moment one is picked
// from that list, but the list needs to keep showing every verse in the
// chapter regardless of which one (if any) is currently picked.
const ScriptureIndexPanel = ({ entries, onSearch, reduceMotion }) => {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState(null); // null | { status, full }
  const lookupRequestRef = useRef(0);
  const [copiedLookup, setCopiedLookup] = useState(false);
  const copiedLookupTimerRef = useRef(null);

  const [mode, setMode] = useState("cited"); // "cited" | "browse"
  const [testament, setTestament] = useState("Old");
  const [browseStep, setBrowseStep] = useState("books"); // "books" | "chapters"
  const [browseBook, setBrowseBook] = useState(null);
  const [browseChapter, setBrowseChapter] = useState(null);
  const [browseVerse, setBrowseVerse] = useState(null);
  const [hoverChapter, setHoverChapter] = useState(null);
  const [chapterPreview, setChapterPreview] = useState(null); // null | { status, text, message }
  const chapterPreviewRequestRef = useRef(0);
  const [chapterVerses, setChapterVerses] = useState(null); // null | { status, verses, message }
  const chapterVersesRequestRef = useRef(0);
  const [manualVerse, setManualVerse] = useState("");
  // Defaults open on every fresh book — a reader who's never seen this
  // book's own intro before shouldn't have to go looking for a collapse
  // toggle they don't know exists yet; one who already knows the book can
  // just collapse it back down (see the toggle button below) without that
  // choice being remembered across a DIFFERENT book next time.
  const [bookDetailsOpen, setBookDetailsOpen] = useState(true);

  // Below the narrow breakpoint the dock covers the whole viewport rather
  // than sitting beside anything, which makes it functionally modal again
  // (see NARROW_BREAKPOINT above) — tracked here, live, via the same
  // matchMedia-plus-change-listener shape usePrefersReducedMotion.js
  // already uses, so the backdrop/focus-trap/full-width CSS below and the
  // JS-side focus trap toggle (see useFocusTrap call further down) both
  // react immediately to a resize, not just to the next open.
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia ? window.matchMedia(NARROW_BREAKPOINT).matches : false
  );

  useEffect(() => {
    const mql = window.matchMedia(NARROW_BREAKPOINT);
    const handleChange = (e) => setIsNarrow(e.matches);
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);

  // Resets every piece of this panel's own local state back to fresh —
  // used by every path that can end this panel's visit (the X button,
  // Escape, a backdrop click on a narrow viewport, and searching a list
  // row) so none of them can leave a stale query/lookup sitting around for
  // the NEXT time this panel opens. Declared before the effects below
  // specifically so the Escape handler can already close over it — safe
  // even though that effect's own listener is re-registered every time
  // `open` changes (see below), since this function's own body only ever
  // calls the stable setOpen/setQuery/setLookup setters, never reads a
  // value that could go stale.
  const closePanel = () => {
    setOpen(false);
    setQuery("");
    setLookup(null);
    clearTimeout(copiedLookupTimerRef.current);
    setCopiedLookup(false);
    setMode("cited");
    setTestament("Old");
    setBrowseStep("books");
    setBrowseBook(null);
    setBrowseChapter(null);
    setBrowseVerse(null);
    setHoverChapter(null);
    setChapterPreview(null);
    setChapterVerses(null);
    setBookDetailsOpen(true);
  };

  // Leaving Browse mode (switching to Cited, or the panel closing via
  // closePanel above) has to invalidate whatever chapter-preview OR
  // chapter-verses fetch was still in flight, the same reason
  // ReferencePicker's own identical effect does — a slow fetch that only
  // finishes AFTER the tab was left would otherwise silently populate
  // state for a chapter nothing is showing anymore.
  useEffect(() => {
    if (mode !== "browse") {
      chapterPreviewRequestRef.current += 1;
      setHoverChapter(null);
      setChapterPreview(null);
      chapterVersesRequestRef.current += 1;
      setChapterVerses(null);
    }
  }, [mode]);

  // The full verse-to-verse cross-reference dataset (~3MB, see
  // utils/crossReferences.js's own comment on why this is a lazy fetch of a
  // public/ static file rather than a static import) is only worth
  // spending that fetch on once someone actually opens Browse mode at all
  // — loadCrossReferences() caches internally, so entering Browse a second
  // time (or a second panel instance, if this ever weren't a single
  // app-wide singleton) never re-fetches. Left `null` until it resolves;
  // every read of it below already treats `null` as "no cross-references
  // yet known for anything," which is honestly true for that brief window.
  const [crossRefMap, setCrossRefMap] = useState(null);

  useEffect(() => {
    if (mode === "browse" && !crossRefMap) {
      loadCrossReferences().then(setCrossRefMap);
    }
  }, [mode, crossRefMap]);

  // Debounced live preview while hovering a chapter cell in Browse mode —
  // never fired on a fast sweep across many cells, only once the pointer
  // actually pauses. Guarded by an incrementing request id (mirroring
  // ReferencePicker's own identical pattern) so a slower, now-abandoned
  // hover can never land its result under a DIFFERENT chapter the pointer
  // has since moved to.
  useEffect(() => {
    if (hoverChapter == null || !browseBook) {
      chapterPreviewRequestRef.current += 1;
      setChapterPreview(null);
      return;
    }

    setChapterPreview({ status: "loading" });
    const requestId = ++chapterPreviewRequestRef.current;

    const timer = setTimeout(() => {
      fetchVerseText({ book: browseBook, path: String(hoverChapter) }, { background: true }).then((result) => {
        if (chapterPreviewRequestRef.current !== requestId) return;
        setChapterPreview(result);
      });
    }, CHAPTER_PREVIEW_DEBOUNCE);

    return () => clearTimeout(timer);
  }, [hoverChapter, browseBook]);

  // The full verse-by-verse breakdown for whichever chapter is currently
  // picked — fetched once per chapter (picking a different verse from the
  // resulting list never re-fetches anything, since this only depends on
  // browseBook/browseChapter, not browseVerse). No debounce: unlike the
  // hover-preview above (which can fire many times during a fast sweep
  // across the grid), picking a chapter is a single deliberate click.
  // bibleApi.js's own cache means this never spends a second real request
  // on a chapter the hover-preview (or the top lookup card) already just
  // fetched.
  useEffect(() => {
    if (!browseBook || !browseChapter) {
      chapterVersesRequestRef.current += 1;
      setChapterVerses(null);
      return;
    }

    setChapterVerses({ status: "loading" });
    const requestId = ++chapterVersesRequestRef.current;

    fetchVerseText({ book: browseBook, path: String(browseChapter) }).then((result) => {
      if (chapterVersesRequestRef.current !== requestId) return;
      setChapterVerses(result);
    });
  }, [browseBook, browseChapter]);

  const browseSections = useMemo(() => BOOK_SECTIONS.filter((s) => s.testament === testament), [testament]);

  // Opening a DIFFERENT book abandons whichever chapter/verse Browse had
  // previously picked — if `query` is still showing that abandoned pick
  // (the only way it could be, since the search input's own onChange
  // clears browseChapter the instant the user types over it directly —
  // see below), clear it too (the query-driven lookup effect handles
  // clearing `lookup` to match), so the lookup card above doesn't keep
  // showing a passage from a book the chapter grid has already moved on
  // from. Never clears a reference the user typed themselves: this only
  // fires when browseChapter is still set, which typing already prevents.
  const openBrowseChapters = (book) => {
    chapterPreviewRequestRef.current += 1;
    if (browseChapter) setQuery("");
    setBrowseBook(book);
    setBrowseChapter(null);
    setBrowseVerse(null);
    setManualVerse("");
    setChapterPreview(null);
    setHoverChapter(null);
    setBrowseStep("chapters");
    setBookDetailsOpen(true);
  };

  const backToBooks = () => {
    chapterPreviewRequestRef.current += 1;
    setChapterPreview(null);
    setHoverChapter(null);
    setBrowseStep("books");
  };

  // Sets the chapter as the current query immediately — the chapter alone
  // is already a complete, valid reference, so there's no reason to force
  // a further step before it feeds the lookup card above. Doesn't close
  // or reset anything else, so the chapter grid stays right where it was
  // in case the next click is "actually, a different chapter." Clears
  // browseVerse since whichever verse was picked (if any) belonged to
  // whatever chapter was previously selected, not this one — the fresh
  // chapterVerses fetch effect above (keyed on browseChapter) takes care
  // of loading THIS chapter's own verse list. Also clears hoverChapter/
  // chapterPreview: clicking a cell doesn't itself fire a mouseleave, so
  // without this, the transient hover-preview box stays showing this same
  // chapter's plain text directly above the verse-by-verse list that's
  // about to render right below it — the exact same passage in two boxes
  // at once until the pointer happens to move off the grid.
  const pickChapter = (n) => {
    chapterPreviewRequestRef.current += 1;
    setHoverChapter(null);
    setChapterPreview(null);
    setBrowseChapter(n);
    setBrowseVerse(null);
    setManualVerse("");
    setQuery(`${ browseBook } ${ n }`);
  };

  const pickVerse = (v) => {
    const ref = `${ browseBook } ${ browseChapter }:${ v }`;
    const parsed = parseBareCitation(ref);
    if (!parsed) return;
    setBrowseVerse(v);
    setQuery(parsed.full);
  };

  const commitManualVerse = () => {
    const n = Number(manualVerse.trim());
    if (!Number.isInteger(n) || n <= 0) return;
    pickVerse(n);
  };

  // The global "please open" broadcast — Header's own toolbar button, the
  // command palette, and now NoteEditor's own toolbar (see NoteEditor.jsx)
  // all fire this identically, so this listener stays mount-once/always-on
  // regardless of whether the dock is currently open.
  useEffect(() => {
    const handleSummon = () => setOpen(true);
    window.addEventListener(SCRIPTURE_INDEX_EVENT, handleSummon);
    return () => window.removeEventListener(SCRIPTURE_INDEX_EVENT, handleSummon);
  }, []);

  // Now that this panel can stay open ALONGSIDE NoteEditor (rather than as
  // a modal blocking it — see the render below), a plain bubble-phase
  // Escape listener isn't enough: NoteEditor has its own unconditioned
  // Escape handler that closes the whole editor, and without coordination
  // both would fire on the same keypress, closing the note out from under
  // someone who only meant to dismiss the reference dock. Capturing the
  // event (the `true` third argument) means this runs BEFORE it ever
  // reaches NoteEditor's bubble-phase listener; stopPropagation() there
  // stops it from continuing on to that listener at all. Registering the
  // listener only while `open` (rather than unconditionally, the way the
  // old combined effect did) matters here specifically because capture-
  // phase — unlike the previous bubble-phase version, which was harmless
  // to leave always-on since closePanel() on an already-closed panel is a
  // no-op — would otherwise swallow Escape app-wide the instant this
  // component is merely MOUNTED, not just open, silently breaking every
  // other panel/popover's own Escape handling whenever this one happens to
  // be closed.
  useEffect(() => {
    if (!open) return;

    const handleKey = (e) => {
      if (e.key !== "Escape") return;
      // DueDatePicker/ReferencePicker (both anchored INSIDE NoteEditor, both
      // portaled straight to document.body, both z-index 980 — above this
      // dock's own 950) can be open on top of the editor at the same time
      // this dock is. Neither knows about this dock or vice versa, so
      // there's no shared state to check directly — each instead toggles a
      // body class in exact sync with its own `open` prop (see their own
      // "*-picker-open" effects) that this reads. NOT a DOM-presence check
      // (e.g. querySelector for their panel elements) — both stay mounted
      // for a beat into their OWN exit animation after `open` already went
      // false, so presence alone would misread "still closing" as "still
      // open" and wrongly defer on a fast second Escape pressed during that
      // window. Bailing here (before stopPropagation) lets the event fall
      // through to that popover's own already-working Escape handler
      // instead of this dock reflexively closing itself first — a calendar
      // or the "add reference" picker the user is actively looking at
      // should close on Escape, not the dock they'd already glanced away
      // from.
      if (document.body.classList.contains("due-picker-open") || document.body.classList.contains("reference-picker-open")) return;
      e.stopPropagation();
      closePanel();
    };

    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Focus lands on the panel — and is restored to whatever had it before —
  // on every genuine open/close, at ANY width: `open` alone drives this,
  // never combined with `isNarrow`, specifically so a mid-session resize
  // across the breakpoint (with the dock already open) can never look like
  // a fresh open/close to this effect and steal or restore focus purely as
  // a side effect of the viewport changing size. This is also what gives a
  // keyboard user any way to actually REACH the dock at all while
  // NoteEditor is open at a wide viewport: NoteEditor's own trap only
  // blocks Tab from crossing its own boundary, it doesn't stop focus
  // being moved programmatically, so landing focus here the instant the
  // dock opens (e.g. from NoteEditor's own "Open the Scripture Index"
  // button) is the one path in — without it, the dock's search/list/browse
  // controls were reachable by mouse only.
  //
  // `trapTab: isNarrow` is the separate half: an actual boundary-cycling
  // Tab trap only while the dock is acting like a real modal (the narrow-
  // viewport fallback — see NARROW_BREAKPOINT). At any wider viewport this
  // coexists with NoteEditor's OWN permanent trap, and two active traps
  // fighting over every Tab press would be worse than neither trapping the
  // wide case at all — so Tab is free to wander out of the dock once
  // inside it, rather than being boxed in, while still landing there fresh
  // on every open.
  useFocusTrap(panelRef, open, { trapTab: isNarrow });

  // Parsing is synchronous and free, so it happens on every keystroke —
  // only the actual network lookup (inside the timer below) is debounced.
  // lookupRequestRef is bumped FIRST, unconditionally, on every single run
  // of this effect — including the two early-return branches below — so
  // ANY new query (even clearing the box back to empty, or editing a once-
  // valid reference into gibberish) invalidates whatever slower fetch a
  // PREVIOUS query already had in flight. Bumping it only on the success
  // branch (an earlier version of this effect's own mistake) left those
  // two early returns unprotected: a stale fetch from an earlier valid
  // query could still land and silently overwrite the just-cleared/just-
  // invalidated state once it finally resolved.
  useEffect(() => {
    // A "Copied" confirmation belongs to whatever passage was showing at
    // the moment it was clicked — the instant query changes to anything
    // else (typing a new search, picking a different chapter or verse),
    // that confirmation is no longer true of the NEW text about to render
    // next to this same button, so it has to drop immediately rather than
    // riding out its own 1400ms timer next to unrelated content.
    clearTimeout(copiedLookupTimerRef.current);
    setCopiedLookup(false);

    const requestId = ++lookupRequestRef.current;
    const trimmed = query.trim();

    if (!trimmed) { setLookup(null); return; }

    const parsed = parseBareCitation(trimmed);
    if (!parsed) { setLookup(null); return; }

    setLookup({ status: "loading", full: parsed.full });

    const timer = setTimeout(() => {
      fetchVerseText(parsed).then((result) => {
        if (lookupRequestRef.current !== requestId) return;
        setLookup({ ...result, full: parsed.full });
      });
    }, SEARCH_DEBOUNCE);

    return () => clearTimeout(timer);
  }, [query]);

  const handleSearch = (full) => {
    closePanel();
    onSearch(full);
  };

  // Copies the lookup card's own fetched verse text — a brief icon swap
  // for feedback, the same "Copied" duration NoteEditor's own handleCopy
  // uses, without that one's flying-ghost animation (built around
  // measuring specific note-editor DOM refs this panel has no equivalent
  // of; a plain icon swap is enough confirmation for one small pill).
  const handleCopyLookup = async () => {
    if (!lookup?.text) return;
    try {
      await navigator.clipboard.writeText(lookup.text);
    } catch {
      return;
    }
    setCopiedLookup(true);
    clearTimeout(copiedLookupTimerRef.current);
    copiedLookupTimerRef.current = setTimeout(() => setCopiedLookup(false), 1400);
  };

  // Typing directly into the search box is a deliberate "look up something
  // else" signal — if Browse still has a chapter/verse pick live (the
  // chapter grid's own "selected" highlight, the verse list below it), it
  // has to be abandoned right here, at the one place `query` can change
  // outside of Browse's own click handlers, or the verse list would keep
  // being read against a chapter the user has already typed past.
  const handleQueryChange = (value) => {
    setQuery(value);
    if (browseChapter) { setBrowseChapter(null); setBrowseVerse(null); }
  };

  const trimmedQuery = query.trim().toLowerCase();
  const filteredEntries = trimmedQuery
    ? entries.filter((entry) => entry.full.toLowerCase().includes(trimmedQuery))
    : entries;

  // Suppressed in exactly one case: Browse mode is actually AT the
  // chapters step with a chapter picked but no verse narrowed down yet,
  // i.e. `lookup` itself is showing that same whole chapter's plain,
  // unlabeled text — the verses section rendered below the chapter grid
  // already shows the identical text, verse-by-verse and properly scoped,
  // so this card would just be a second, redundant (and for a long
  // chapter like Psalm 119, potentially very tall) copy of what's already
  // on screen. The instant a specific verse is picked (browseVerse set),
  // this card becomes genuinely useful again — it's the one place showing
  // "the current selection" with its own find-notes action, independent
  // of the full verse list's own scroll. browseStep === "chapters" is
  // required alongside browseChapter/browseVerse, not just the latter two
  // — backToBooks deliberately leaves browseChapter/browseVerse alone
  // when returning to the book grid (so re-entering the same book still
  // remembers where you were), but the verses section that justifies
  // suppressing this card only renders while browseStep is actually
  // "chapters"; without this, clicking Back left BOTH the card and the
  // verses section invisible until a new pick was made.
  const showLookupCard = lookup && !(mode === "browse" && browseStep === "chapters" && browseChapter && !browseVerse);

  return (
    <AnimatePresence>
      { open && (
        <>
          {/* No backdrop above the narrow breakpoint — a click-blocking
              scrim is exactly the modal behavior this dock exists to drop,
              since the whole point is staying open and clickable alongside
              NoteEditor. CSS hides this element entirely above
              NARROW_BREAKPOINT (see ScriptureIndexPanel.css); it only ever
              actually paints, and only then does its onClick matter, once
              the dock has fallen back to full-width/modal-ish behavior on a
              small viewport. */}
          <motion.div
            className="scripture-index-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: .2 } }}
            onClick={ closePanel }
          />
          <motion.div
            ref={ panelRef }
            tabIndex={ -1 }
            role={ isNarrow ? "dialog" : "complementary" }
            aria-modal={ isNarrow ? "true" : undefined }
            aria-label="Scripture Index"
            className="scripture-index-panel"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={ reduceMotion ? { duration: 0 } : RAIL_SLIDE }
          >
            <div className="scripture-index-header">
              <h3>Scripture Index</h3>
              <motion.button
                type="button"
                aria-label="Close"
                className="scripture-index-close"
                whileHover={{ scale: 1.15, rotate: 90 }}
                whileTap={{ scale: .9 }}
                transition={{ type: "spring", stiffness: 420, damping: 16 }}
                onClick={ closePanel }
              >
                <FaXmark />
              </motion.button>
            </div>

            <div className="scripture-index-search">
              <FaMagnifyingGlass className="scripture-index-search-icon" />
              <input
                type="text"
                value={ query }
                onChange={ (e) => handleQueryChange(e.target.value) }
                placeholder="Look up a verse — Genesis 1:1, John 3:16-18…"
              />
            </div>

            <div className="scripture-index-mode-tabs">
              <button
                type="button"
                aria-pressed={ mode === "cited" }
                className={ mode === "cited" ? "active" : "" }
                onClick={ () => setMode("cited") }
              >
                <FaBookBible /> Cited
              </button>
              <button
                type="button"
                aria-pressed={ mode === "browse" }
                className={ mode === "browse" ? "active" : "" }
                onClick={ () => setMode("browse") }
              >
                <FaBookOpen /> Browse
              </button>
            </div>

            <div className="scripture-index-body custom-scroll">
              {
                showLookupCard && (
                  <motion.div
                    className="scripture-index-lookup"
                    initial={{ opacity: 0, scale: .96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: "spring", stiffness: 380, damping: 28 }}
                  >
                    <div className="scripture-index-lookup-head">
                      <FaBookOpen className="scripture-index-lookup-icon" />
                      <span>{ lookup.full }</span>
                      {
                        lookup.status === "ok" && (
                          <motion.button
                            type="button"
                            className="scripture-index-lookup-search"
                            aria-label={ `Find every note mentioning ${ lookup.full }` }
                            title="Find notes on this passage"
                            whileHover={{ scale: 1.15 }}
                            whileTap={{ scale: .88 }}
                            transition={{ type: "spring", stiffness: 420, damping: 18 }}
                            onClick={ () => handleSearch(lookup.full) }
                          >
                            <FaMagnifyingGlass />
                          </motion.button>
                        )
                      }
                      {
                        lookup.status === "ok" && (
                          <motion.button
                            type="button"
                            className="scripture-index-lookup-copy"
                            aria-label={ copiedLookup ? "Copied" : `Copy ${ lookup.full }` }
                            title="Copy this verse's text"
                            whileHover={{ scale: 1.15 }}
                            whileTap={{ scale: .88 }}
                            transition={{ type: "spring", stiffness: 420, damping: 18 }}
                            onClick={ handleCopyLookup }
                          >
                            { copiedLookup ? <FaCheck /> : <FaCopy /> }
                          </motion.button>
                        )
                      }
                    </div>
                    {
                      lookup.status === "loading" ? (
                        <span className="scripture-index-lookup-muted">Looking it up…</span>
                      ) : lookup.status === "unsupported" ? (
                        <span className="scripture-index-lookup-muted">
                          The third number here is this app's own shorthand, not a standard verse — no text to look up.
                        </span>
                      ) : lookup.status === "error" ? (
                        <span className="scripture-index-lookup-muted">{ lookup.message || "Couldn't load this verse." }</span>
                      ) : (
                        <p className="scripture-index-lookup-text">{ lookup.text }</p>
                      )
                    }
                  </motion.div>
                )
              }
              {
                mode === "cited" && (
                  filteredEntries.length > 0 ? (
                    <ul className="scripture-index-list">
                      <AnimatePresence initial={ false }>
                        {
                          filteredEntries.map((entry) => (
                            <motion.li
                              key={ entry.full }
                              className="scripture-index-item"
                              layout
                              initial={{ opacity: 0, y: -10, scale: .92 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, scale: .92, y: -10, transition: { duration: .15 } }}
                              transition={{ type: "spring", stiffness: 380, damping: 26 }}
                            >
                              <motion.button
                                type="button"
                                className="scripture-index-item-button"
                                aria-label={ `Find every note mentioning ${ entry.full }` }
                                title="Find notes on this passage"
                                whileHover={{ scale: 1.015 }}
                                whileTap={{ scale: .98 }}
                                transition={{ type: "spring", stiffness: 420, damping: 22 }}
                                onClick={ () => handleSearch(entry.full) }
                              >
                                <span className="scripture-index-item-label">{ entry.full }</span>
                                <span className="scripture-index-item-count">
                                  <FaMagnifyingGlass className="scripture-index-item-icon" />
                                  { entry.count }
                                </span>
                              </motion.button>
                            </motion.li>
                          ))
                        }
                      </AnimatePresence>
                    </ul>
                  ) : !lookup && (
                    <motion.div
                      className="scripture-index-empty"
                      initial={{ opacity: 0, scale: .7, translateY: 14 }}
                      animate={{ opacity: 1, scale: 1, translateY: 0 }}
                      transition={{ type: "spring", stiffness: 260, damping: 18 }}
                    >
                      <motion.span
                        initial={{ rotate: -18, scale: .6 }}
                        animate={{ rotate: 0, scale: 1 }}
                        transition={{ type: "spring", stiffness: 300, damping: 14, delay: .08 }}
                      >
                        <FaBookBible className="scripture-index-empty-icon" />
                      </motion.span>
                      <p>{ entries.length === 0 ? "No passages cited yet." : "No citations match your search." }</p>
                    </motion.div>
                  )
                )
              }
              {
                mode === "browse" && (
                  <div className="scripture-index-browse">
                    {
                      browseStep !== "books" && (
                        <div className="scripture-index-browse-header">
                          <motion.button
                            type="button"
                            aria-label="Back"
                            className="scripture-index-browse-back"
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: .88 }}
                            transition={ SNAPPY }
                            onClick={ backToBooks }
                          >
                            <FaChevronLeft />
                          </motion.button>
                          <span className="scripture-index-browse-crumb">
                            { browseChapter ? `${ browseBook } ${ browseChapter }` : browseBook }
                          </span>
                        </div>
                      )
                    }

                    {
                      browseStep === "books" && (
                        <>
                          <div className="scripture-index-browse-tabs">
                            <button
                              type="button"
                              aria-pressed={ testament === "Old" }
                              className={ testament === "Old" ? "active" : "" }
                              onClick={ () => setTestament("Old") }
                            >
                              Old Testament
                            </button>
                            <button
                              type="button"
                              aria-pressed={ testament === "New" }
                              className={ testament === "New" ? "active" : "" }
                              onClick={ () => setTestament("New") }
                            >
                              New Testament
                            </button>
                          </div>
                          <div className="scripture-index-browse-sections">
                            {
                              browseSections.map((section) => (
                                <div key={ section.section } className="scripture-index-browse-section">
                                  <span className="scripture-index-browse-section-label">{ section.section }</span>
                                  <div className="scripture-index-browse-book-grid">
                                    {
                                      section.books.map((book) => (
                                        <button
                                          key={ book }
                                          type="button"
                                          className="scripture-index-browse-book"
                                          onClick={ () => openBrowseChapters(book) }
                                        >
                                          { book }
                                        </button>
                                      ))
                                    }
                                  </div>
                                </div>
                              ))
                            }
                          </div>
                        </>
                      )
                    }

                    {
                      browseStep === "chapters" && (
                        <>
                          {
                            // The way a printed Bible's own front matter
                            // introduces a book before its first chapter
                            // begins — a real synopsis, not fabricated
                            // scholarship: this app has no live source for
                            // book-level detail (bibleApi.js only ever
                            // returns verse text), so BIBLE_BOOK_DETAILS is
                            // static, pre-written, fact-checked local data,
                            // the same "verify hand-authored reference data
                            // before it becomes load-bearing" discipline
                            // BOOK_CHAPTER_COUNTS/BOOK_SECTIONS in
                            // bibleBooks.js already used. Collapsible since
                            // a reader who just wants to jump to a chapter
                            // shouldn't have to scroll past four sentences
                            // of introduction to reach the grid every time.
                            BIBLE_BOOK_DETAILS[browseBook] && (
                              <div className="scripture-index-book-details">
                                {/* The traditional heading this book actually
                                    carries in essentially every standard KJV
                                    printing ("The First Book of Moses, Called
                                    Genesis," etc.) — real, public-domain KJV
                                    text, not editorial content, so unlike the
                                    synopsis below it, it's always shown, never
                                    behind the toggle: the same permanent,
                                    un-skippable role it plays on an actual
                                    printed page. */}
                                <span className="scripture-index-book-traditional-title">
                                  { BIBLE_BOOK_DETAILS[browseBook].title }
                                </span>
                                <motion.button
                                  type="button"
                                  aria-expanded={ bookDetailsOpen }
                                  className="scripture-index-book-details-toggle"
                                  whileHover={{ scale: 1.01 }}
                                  whileTap={{ scale: .98 }}
                                  transition={ SNAPPY }
                                  onClick={ () => setBookDetailsOpen((o) => !o) }
                                >
                                  <span>About { browseBook }</span>
                                  <motion.span
                                    className="scripture-index-book-details-chevron"
                                    animate={{ rotate: bookDetailsOpen ? 180 : 0 }}
                                    transition={ SNAPPY }
                                  >
                                    <FaChevronDown />
                                  </motion.span>
                                </motion.button>
                                <AnimatePresence initial={ false }>
                                  {
                                    bookDetailsOpen && (
                                      <motion.div
                                        className="scripture-index-book-details-body"
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: "auto" }}
                                        exit={{ opacity: 0, height: 0 }}
                                        transition={{ type: "spring", stiffness: 380, damping: 32 }}
                                      >
                                        <p className="scripture-index-book-details-meaning">
                                          { BIBLE_BOOK_DETAILS[browseBook].meaning }
                                        </p>
                                        <dl className="scripture-index-book-details-facts">
                                          <div>
                                            <dt>Author</dt>
                                            <dd>{ BIBLE_BOOK_DETAILS[browseBook].author }</dd>
                                          </div>
                                          <div>
                                            <dt>Written</dt>
                                            <dd>{ BIBLE_BOOK_DETAILS[browseBook].period }</dd>
                                          </div>
                                        </dl>
                                        <p className="scripture-index-book-details-synopsis">
                                          { BIBLE_BOOK_DETAILS[browseBook].synopsis }
                                        </p>
                                      </motion.div>
                                    )
                                  }
                                </AnimatePresence>
                              </div>
                            )
                          }
                          <div
                            className="scripture-index-browse-chapter-grid"
                            onMouseLeave={ () => setHoverChapter(null) }
                          >
                            {
                              Array.from({ length: BOOK_CHAPTER_COUNTS[browseBook] }, (_, i) => i + 1).map((n) => (
                                <motion.button
                                  key={ n }
                                  type="button"
                                  aria-label={ `${ browseBook } chapter ${ n }` }
                                  aria-pressed={ browseChapter === n }
                                  className={ `scripture-index-browse-chapter ${ browseChapter === n ? "selected" : "" }` }
                                  whileHover={{ scale: 1.1 }}
                                  whileTap={{ scale: .88 }}
                                  transition={ SNAPPY }
                                  onMouseEnter={ () => setHoverChapter(n) }
                                  onClick={ () => pickChapter(n) }
                                >
                                  { n }
                                </motion.button>
                              ))
                            }
                          </div>

                          <AnimatePresence>
                            {
                              chapterPreview && (
                                <motion.div
                                  className="scripture-index-browse-preview"
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: "auto" }}
                                  exit={{ opacity: 0, height: 0 }}
                                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                                >
                                  {
                                    chapterPreview.status === "loading" ? (
                                      <span className="scripture-index-browse-preview-muted">Looking it up…</span>
                                    ) : chapterPreview.status === "error" ? (
                                      <span className="scripture-index-browse-preview-muted">
                                        { chapterPreview.message || "Couldn't load this chapter." }
                                      </span>
                                    ) : (
                                      <span className="scripture-index-browse-preview-text">{ chapterPreview.text }</span>
                                    )
                                  }
                                </motion.div>
                              )
                            }
                          </AnimatePresence>

                          {
                            // The instant a chapter is picked, its full verse-by-
                            // verse text shows right here — no separate "narrow to
                            // a verse" step to click through first.
                            browseChapter && (
                              <div className="scripture-index-browse-verses">
                                <div className="scripture-index-browse-verses-head">
                                  {/* Set the way a printed Bible's own chapter head
                                      reads — "CHAPTER 1", not the book name again —
                                      since the book is already named a step up, in
                                      the Back breadcrumb above the chapter grid.
                                      aria-label keeps the book in the accessible
                                      name even though the visible text drops it, so
                                      a screen-reader user landing straight on this
                                      heading (rather than having just read the
                                      breadcrumb) isn't left without it. */}
                                  <span
                                    className="scripture-index-chapter-heading"
                                    aria-label={ `${ browseBook } chapter ${ browseChapter }` }
                                  >
                                    Chapter { browseChapter }
                                  </span>
                                  {/* The top lookup card's own find-notes action is
                                      deliberately suppressed while this exact same
                                      whole-chapter text is already showing here
                                      (see showLookupCard above) — this is what
                                      takes its place, not a new capability. */}
                                  <motion.button
                                    type="button"
                                    className="scripture-index-browse-verses-search"
                                    aria-label={ `Find every note mentioning ${ browseBook } ${ browseChapter }` }
                                    title="Find notes on this passage"
                                    whileHover={{ scale: 1.15 }}
                                    whileTap={{ scale: .88 }}
                                    transition={{ type: "spring", stiffness: 420, damping: 18 }}
                                    onClick={ () => handleSearch(`${ browseBook } ${ browseChapter }`) }
                                  >
                                    <FaMagnifyingGlass />
                                  </motion.button>
                                </div>
                                {
                                  chapterVerses?.status === "loading" ? (
                                    <p className="scripture-index-browse-verses-status">Loading every verse in this chapter…</p>
                                  ) : chapterVerses?.status === "ok" && chapterVerses.verses?.length > 0 ? (
                                    // Labeled the way an actual printed Bible page
                                    // sets a chapter — each verse's number as a
                                    // small raised numeral set tight against its
                                    // own first word, every verse running on in
                                    // one continuous block rather than each
                                    // getting its own row, the way a real page
                                    // reads rather than a picker list, justified
                                    // like a real page's own column, and set in a
                                    // serif face (this app's own Poppins stays for
                                    // every OTHER label/button in this panel — only
                                    // actual scripture text, here and in the lookup
                                    // card/hover preview, reads like a printed
                                    // page). Still click-to-narrow (pickVerse, same
                                    // as before); only the layout/typography
                                    // changed, not the interaction.
                                    <p className="scripture-index-browse-verse-list">
                                      {
                                        chapterVerses.verses.map((v) => {
                                          // A real printed Bible opens its first
                                          // verse with a large decorative initial,
                                          // the rest of that first word and the
                                          // verses after it wrapping around it —
                                          // only verse 1 ever gets one. Pulled out
                                          // as its own leading span (a sibling of
                                          // the verse-1 button, not nested inside
                                          // it) rather than floating something
                                          // inside the button itself, since a
                                          // float's own containing block is
                                          // whichever ancestor actually establishes
                                          // a block formatting context — here,
                                          // this <p> — regardless of whether the
                                          // element right next to it happens to be
                                          // an inline button; nesting the float
                                          // inside the button risked fighting that
                                          // element's own layout for no benefit,
                                          // since the button's hit-target doesn't
                                          // need to include the drop cap's own
                                          // glyph to stay a fully usable "pick
                                          // verse 1" target — every other pixel
                                          // of verse 1's own text still is one.
                                          const isFirstVerse = v.number === 1;
                                          const text = isFirstVerse ? v.text.slice(1) : v.text;

                                          return (
                                            <Fragment key={ v.number }>
                                              {
                                                isFirstVerse && (
                                                  <span className="scripture-index-drop-cap" aria-hidden="true">
                                                    { v.text.charAt(0) }
                                                  </span>
                                                )
                                              }
                                              <button
                                                type="button"
                                                aria-label={ `${ browseBook } ${ browseChapter }:${ v.number }` }
                                                aria-pressed={ browseVerse === v.number }
                                                className={ `scripture-index-browse-verse-inline ${ browseVerse === v.number ? "selected" : "" }` }
                                                onClick={ () => pickVerse(v.number) }
                                              >
                                                <sup className="scripture-index-browse-verse-num">
                                                  { v.number }
                                                  {
                                                    // The dataset has no word-level anchor (see
                                                    // crossReferences.js's own comment) — these
                                                    // letters mark "this verse has N cross-
                                                    // references, spelled out below" rather than
                                                    // pointing at a specific word the way a real
                                                    // printed Bible's own letters do.
                                                    crossRefMap?.[`${ browseBook } ${ browseChapter }:${ v.number }`]?.length > 0 && (
                                                      <span className="scripture-index-verse-xref-marks">
                                                        { crossRefMap[`${ browseBook } ${ browseChapter }:${ v.number }`].map((_, i) => XREF_LETTERS[i]).join("") }
                                                      </span>
                                                    )
                                                  }
                                                </sup>
                                                { `${ text } ` }
                                              </button>
                                            </Fragment>
                                          );
                                        })
                                      }
                                    </p>
                                  ) : (
                                    <p className="scripture-index-browse-verses-status">
                                      { chapterVerses?.message || "Couldn't load this chapter's verses." }
                                    </p>
                                  )
                                }
                                {
                                  // The footnote strip a printed Bible's own cross-
                                  // reference letters point down to — see the sup
                                  // marks above for why these are per-VERSE rather
                                  // than per-word. Each entry re-uses the exact
                                  // same "look something else up" path the search
                                  // box's own onChange already provides
                                  // (handleQueryChange), so clicking one behaves
                                  // identically to typing that reference in by
                                  // hand: abandons whatever was browsed here and
                                  // feeds the shared lookup card above.
                                  chapterVerses?.status === "ok" && crossRefMap && (
                                    <div className="scripture-index-footnotes">
                                      {
                                        chapterVerses.verses.map((v) => {
                                          const refs = crossRefMap[`${ browseBook } ${ browseChapter }:${ v.number }`];
                                          if (!refs?.length) return null;
                                          return (
                                            <p key={ v.number } className="scripture-index-footnote-row">
                                              <span className="scripture-index-footnote-verse">{ v.number }</span>
                                              {
                                                refs.map((ref, i) => (
                                                  <button
                                                    key={ ref }
                                                    type="button"
                                                    className="scripture-index-footnote-entry"
                                                    onClick={ () => handleQueryChange(ref) }
                                                  >
                                                    <sup>{ XREF_LETTERS[i] }</sup> { ref }
                                                  </button>
                                                ))
                                              }
                                            </p>
                                          );
                                        })
                                      }
                                    </div>
                                  )
                                }
                                <div className="scripture-index-browse-verse-manual">
                                  <input
                                    type="number"
                                    min="1"
                                    inputMode="numeric"
                                    aria-label="Verse number"
                                    placeholder="Or type a verse number…"
                                    value={ manualVerse }
                                    onChange={ (e) => setManualVerse(e.target.value) }
                                    onKeyDown={ (e) => { if (e.key === "Enter") { e.preventDefault(); commitManualVerse(); } } }
                                  />
                                  <button type="button" aria-label="Go to that verse" onClick={ commitManualVerse }>Go</button>
                                </div>
                              </div>
                            )
                          }
                        </>
                      )
                    }
                  </div>
                )
              }
            </div>
          </motion.div>
        </>
      ) }
    </AnimatePresence>
  );
};

export default ScriptureIndexPanel;
