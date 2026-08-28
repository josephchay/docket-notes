import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FaXmark, FaBookBible, FaBookOpen, FaMagnifyingGlass, FaChevronLeft, FaCopy, FaCheck } from "react-icons/fa6";

import SheetPanel from "../Sheet/SheetPanel";
import { parseBareCitation } from "../../utils/citations";
import { BOOK_CHAPTER_COUNTS, BOOK_SECTIONS } from "../../utils/bibleBooks";
import { fetchVerseText } from "../../utils/bibleApi";
import { SNAPPY } from "../Motion";

import "./ScriptureIndexPanel.css";

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
// math + outside-pointerdown-to-close), a shape this already-full-screen
// sheet panel doesn't need and would only fight; only the underlying DATA
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

  // Resets every piece of this panel's own local state back to fresh —
  // used by every path that can end this panel's visit (the X button,
  // Escape, SheetPanel's own backdrop click via onClose, and searching a
  // list row) so none of them can leave a stale query/lookup sitting
  // around for the NEXT time this panel opens. Declared before the effects
  // below specifically so the Escape handler (registered once, on mount)
  // can already close over it — safe even though that effect never
  // re-runs, since this function's own body only ever calls the stable
  // setOpen/setQuery/setLookup setters, never reads a value that could go
  // stale.
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

  useEffect(() => {
    const handleKey = (e) => { if (e.key === "Escape") closePanel(); };
    const handleSummon = () => setOpen(true);

    window.addEventListener("keydown", handleKey);
    window.addEventListener(SCRIPTURE_INDEX_EVENT, handleSummon);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener(SCRIPTURE_INDEX_EVENT, handleSummon);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    <SheetPanel
      open={ open }
      onClose={ closePanel }
      panelRef={ panelRef }
      radius={ 22 }
      layerClassName="scripture-index-layer"
      backdropClassName="scripture-index-backdrop"
      panelClassName="scripture-index-panel"
      ariaLabel="Scripture Index"
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

      <div className="scripture-index-body">
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
                    <div className="scripture-index-browse-sections custom-scroll">
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
                    <div
                      className="scripture-index-browse-chapter-grid custom-scroll"
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
                            <span className="scripture-index-browse-verses-label">{ browseBook } { browseChapter }</span>
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
                              // reads rather than a picker list. Still
                              // click-to-narrow (pickVerse, same as before);
                              // only the layout/typography changed, not the
                              // interaction.
                              <p className="scripture-index-browse-verse-list custom-scroll">
                                {
                                  chapterVerses.verses.map((v) => (
                                    <button
                                      key={ v.number }
                                      type="button"
                                      aria-label={ `${ browseBook } ${ browseChapter }:${ v.number }` }
                                      aria-pressed={ browseVerse === v.number }
                                      className={ `scripture-index-browse-verse-inline ${ browseVerse === v.number ? "selected" : "" }` }
                                      onClick={ () => pickVerse(v.number) }
                                    >
                                      <sup className="scripture-index-browse-verse-num">{ v.number }</sup>
                                      { `${ v.text } ` }
                                    </button>
                                  ))
                                }
                              </p>
                            ) : (
                              <p className="scripture-index-browse-verses-status">
                                { chapterVerses?.message || "Couldn't load this chapter's verses." }
                              </p>
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
    </SheetPanel>
  );
};

export default ScriptureIndexPanel;
