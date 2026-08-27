import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FaXmark, FaBookBible, FaBookOpen, FaMagnifyingGlass, FaChevronLeft, FaArrowRight } from "react-icons/fa6";

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
const VERSE_PAGE_SIZE = 30;

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
// same query string.
const ScriptureIndexPanel = ({ entries, onSearch, reduceMotion }) => {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState(null); // null | { status, full }
  const lookupRequestRef = useRef(0);

  const [mode, setMode] = useState("cited"); // "cited" | "browse"
  const [testament, setTestament] = useState("Old");
  const [browseStep, setBrowseStep] = useState("books"); // "books" | "chapters" | "verses"
  const [browseBook, setBrowseBook] = useState(null);
  const [browseChapter, setBrowseChapter] = useState(null);
  const [hoverChapter, setHoverChapter] = useState(null);
  const [chapterPreview, setChapterPreview] = useState(null); // null | { status, text, message }
  const chapterPreviewRequestRef = useRef(0);
  const [versePage, setVersePage] = useState(1);
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
    setMode("cited");
    setBrowseStep("books");
    setBrowseBook(null);
    setBrowseChapter(null);
    setHoverChapter(null);
    setChapterPreview(null);
  };

  // Leaving Browse mode (switching to Cited, or the panel closing via
  // closePanel above) has to invalidate whatever chapter-preview fetch was
  // still in flight, the same reason ReferencePicker's own identical
  // effect does — a slow hover-triggered fetch that only finishes AFTER
  // the tab was left would otherwise silently populate chapterPreview for
  // a chapter nothing is showing anymore.
  useEffect(() => {
    if (mode !== "browse") {
      chapterPreviewRequestRef.current += 1;
      setHoverChapter(null);
      setChapterPreview(null);
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
      fetchVerseText({ book: browseBook, path: String(hoverChapter) }).then((result) => {
        if (chapterPreviewRequestRef.current !== requestId) return;
        setChapterPreview(result);
      });
    }, CHAPTER_PREVIEW_DEBOUNCE);

    return () => clearTimeout(timer);
  }, [hoverChapter, browseBook]);

  const browseSections = useMemo(() => BOOK_SECTIONS.filter((s) => s.testament === testament), [testament]);

  const openBrowseChapters = (book) => {
    chapterPreviewRequestRef.current += 1;
    setBrowseBook(book);
    setBrowseChapter(null);
    setChapterPreview(null);
    setHoverChapter(null);
    setVersePage(1);
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
  // in case the next click is "actually, a different chapter."
  const pickChapter = (n) => {
    setBrowseChapter(n);
    setQuery(`${ browseBook } ${ n }`);
  };

  // Fresh every time this step is entered, not just once — narrowing a
  // DIFFERENT chapter within the same still-open panel must never inherit
  // an earlier chapter's own expanded page size or a typed-but-never-
  // submitted verse number (the exact bug ReferencePicker's own addendum
  // once had to fix for this identical shape of state).
  const openBrowseVerses = () => {
    setVersePage(1);
    setManualVerse("");
    setBrowseStep("verses");
  };

  const pickVerse = (v) => {
    const ref = `${ browseBook } ${ browseChapter }:${ v }`;
    const parsed = parseBareCitation(ref);
    if (!parsed) return;
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

  const trimmedQuery = query.trim().toLowerCase();
  const filteredEntries = trimmedQuery
    ? entries.filter((entry) => entry.full.toLowerCase().includes(trimmedQuery))
    : entries;

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
          onChange={ (e) => setQuery(e.target.value) }
          placeholder="Look up a verse — Genesis 1:1, John 3:16-18…"
        />
      </div>

      <div className="scripture-index-mode-tabs">
        <button type="button" className={ mode === "cited" ? "active" : "" } onClick={ () => setMode("cited") }>
          <FaBookBible /> Cited
        </button>
        <button type="button" className={ mode === "browse" ? "active" : "" } onClick={ () => setMode("browse") }>
          <FaBookOpen /> Browse
        </button>
      </div>

      <div className="scripture-index-body">
        {
          lookup && (
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
                      onClick={ browseStep === "verses" ? () => setBrowseStep("chapters") : backToBooks }
                    >
                      <FaChevronLeft />
                    </motion.button>
                    <span className="scripture-index-browse-crumb">
                      { browseStep === "chapters" ? browseBook : `${ browseBook } ${ browseChapter }` }
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
                        className={ testament === "Old" ? "active" : "" }
                        onClick={ () => setTestament("Old") }
                      >
                        Old Testament
                      </button>
                      <button
                        type="button"
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
                      browseChapter && (
                        <div className="scripture-index-browse-confirm">
                          <span>Looking up { browseBook } { browseChapter }</span>
                          <button type="button" className="scripture-index-browse-narrow" onClick={ openBrowseVerses }>
                            Narrow to a verse <FaArrowRight />
                          </button>
                        </div>
                      )
                    }
                  </>
                )
              }

              {
                browseStep === "verses" && (
                  <>
                    <div className="scripture-index-browse-verse-grid custom-scroll">
                      {
                        Array.from({ length: versePage * VERSE_PAGE_SIZE }, (_, i) => i + 1).map((v) => (
                          <button key={ v } type="button" className="scripture-index-browse-verse" onClick={ () => pickVerse(v) }>
                            { v }
                          </button>
                        ))
                      }
                      <button
                        type="button"
                        className="scripture-index-browse-verse-more"
                        onClick={ () => setVersePage((p) => p + 1) }
                      >
                        + { VERSE_PAGE_SIZE } more
                      </button>
                    </div>
                    <div className="scripture-index-browse-verse-manual">
                      <input
                        type="number"
                        min="1"
                        inputMode="numeric"
                        placeholder="Or type a verse number…"
                        value={ manualVerse }
                        onChange={ (e) => setManualVerse(e.target.value) }
                        onKeyDown={ (e) => { if (e.key === "Enter") { e.preventDefault(); commitManualVerse(); } } }
                      />
                      <button type="button" onClick={ commitManualVerse }>Go</button>
                    </div>
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
