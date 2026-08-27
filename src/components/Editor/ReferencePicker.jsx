import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { FaChevronLeft, FaArrowRight } from "react-icons/fa6";

import { parseBareCitation } from "../../utils/citations";
import { BOOK_CHAPTER_COUNTS, BOOK_SECTIONS } from "../../utils/bibleBooks";
import { fetchVerseText } from "../../utils/bibleApi";
import { SETTLE, SNAPPY, squashCollapse, enterExitStagger } from "../Motion";

import "./ReferencePicker.css";

// How long a chapter cell has to sit under the pointer before its preview
// is worth spending a request on — bible-api.com is tightly rate-limited
// (15/30s, see utils/bibleApi.js), so a fast sweep across a dozen cells
// while scanning for the right one must never fire a dozen fetches.
const CHAPTER_PREVIEW_DEBOUNCE = 400;
const VERSE_PAGE_SIZE = 30;

// The step panels' own slide direction — a function of the `custom` value
// rather than a plain object, specifically so the EXITING panel picks up
// whatever direction is current at the moment it's actually removed.
// directionRef is a plain ref (not state, so flipping it never forces its
// own extra render), and AnimatePresence forwards whatever `custom` it
// currently holds to an already-exiting child — but only a function-typed
// exit/initial/animate ever reads that forwarded value; a plain object
// literal bakes in whatever directionRef.current happened to be during
// that child's own last live render, which is one transition behind by
// the time it's actually exiting (e.g. book -> chapter, then Back: the
// entering "home" panel gets the fresh -1 correctly, but the exiting
// "chapter" panel — a plain-object version — would still animate out
// using the +1 direction from when IT was entering, a visibly wrong
// reversal on exactly the transitions that go backward).
const slideVariants = {
  enter: (direction) => ({ opacity: 0, x: direction * 16 }),
  center: { opacity: 1, x: 0 },
  exit: (direction) => ({ opacity: 0, x: direction * -16 }),
};

// "home" is the outermost page, so its own enter/exit run the opposite
// sign from "chapter"/"verse" (both moving together in whichever direction
// the drill is currently going, rather than sliding apart) — preserving
// exactly the sign relationship the original plain-object version had,
// just made direction-reactive on exit the same way.
const homeSlideVariants = {
  enter: (direction) => ({ opacity: 0, x: direction * -16 }),
  center: { opacity: 1, x: 0 },
  exit: (direction) => ({ opacity: 0, x: direction * 16 }),
};

// A real browsable book -> chapter [-> verse] popover for choosing a
// scripture reference, not a bare text field to type one into — the same
// "replace a plain input with a real hand-built control" bar
// DueDatePicker.jsx already set for this app. Browsing is the default
// path: pick a book, pick a chapter, done — two taps, never a keystroke
// required. Verse-level precision stays available but opt-in (most notes
// are "about" a chapter, not one verse), and typing a reference directly
// is still a first-class fallback for power users or genuinely freeform
// labels — the search field's Enter commits the raw text exactly as
// typed, unvalidated and unblocked.
//
// Used to power a single dedicated note.reference field once (since
// removed — highlight-and-annotate below fully subsumed it); its sole
// caller now is NoteEditor's "Add reference" flow, which lets ANY
// highlighted span of a note's own prose get a citation attached via this
// same picker rather than one field per note. `onChange` fires once per
// pick (a chapter pick fires it without closing, so verse-narrowing can
// follow) — a caller that only wants the FINAL choice should read it off
// `onClose`, not act on every intermediate call.
const ReferencePicker = ({ open, value, colorName, anchorRef, scriptureIndex, noteCitations, onChange, onClose, onReturnHome }) => {
  const [step, setStep] = useState("home"); // "home" | "chapter" | "verse"
  const [testament, setTestament] = useState("Old");
  const [searchText, setSearchText] = useState("");
  const [pendingBook, setPendingBook] = useState(null);
  const [pendingChapter, setPendingChapter] = useState(null);
  const [versePage, setVersePage] = useState(1);
  const [manualVerse, setManualVerse] = useState("");
  const [position, setPosition] = useState(null);
  const directionRef = useRef(0);
  const panelRef = useRef(null);

  const [hoverChapter, setHoverChapter] = useState(null);
  const [preview, setPreview] = useState(null); // null | { status, text, message }
  const previewRequestRef = useRef(0);

  // Every fresh open lands back on the home screen — even reopening an
  // already-set reference's chip — with the search field pre-seeded so
  // retyping the same thing (or tweaking it slightly) still works, but the
  // promote/browse rows stay the primary, first thing seen rather than
  // dropping straight into a deep book/chapter step that has to be undone.
  useEffect(() => {
    if (!open) return;
    setStep("home");
    setTestament("Old");
    setSearchText(value || "");
    setPendingBook(null);
    setPendingChapter(null);
    setVersePage(1);
    setManualVerse("");
    setPreview(null);
    setHoverChapter(null);
    directionRef.current = 0;

    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) {
      setPosition({
        left: Math.min(rect.left, window.innerWidth - 320),
        top: Math.min(rect.bottom + 10, window.innerHeight - 420),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleKey = (e) => { if (e.key === "Escape") onClose(); };
    const handleOutside = (e) => {
      if (panelRef.current?.contains(e.target)) return;
      if (anchorRef.current?.contains(e.target)) return;
      onClose();
    };

    window.addEventListener("keydown", handleKey);
    // Deferred a tick so the same pointerdown that opened this (the
    // trigger/chip itself) doesn't also count as the outside click that
    // immediately closes it again — the same trick DueDatePicker uses.
    const timer = setTimeout(() => document.addEventListener("pointerdown", handleOutside), 0);

    return () => {
      window.removeEventListener("keydown", handleKey);
      clearTimeout(timer);
      document.removeEventListener("pointerdown", handleOutside);
    };
  }, [open, onClose, anchorRef]);

  // Debounced live preview while hovering a chapter cell — never fired on
  // a fast sweep across many cells, only once the pointer actually pauses.
  // Guarded by an incrementing request id (the same shape as NoteEditor's
  // own citation-pill togglePreview) so a slower, now-abandoned hover can
  // never land its result under a DIFFERENT cell the pointer has since
  // moved to.
  useEffect(() => {
    if (hoverChapter == null || !pendingBook) {
      // Leaving the grid entirely still has to invalidate whatever was
      // in flight — otherwise a fetch that only finished LAUNCHING (past
      // the debounce) right as the pointer left keeps running, and its
      // result would silently repopulate `preview` after the fact, for a
      // chapter nothing is hovering anymore.
      previewRequestRef.current += 1;
      setPreview(null);
      return;
    }

    setPreview({ status: "loading" });
    const requestId = ++previewRequestRef.current;

    const timer = setTimeout(() => {
      fetchVerseText({ book: pendingBook, path: String(hoverChapter) }).then((result) => {
        if (previewRequestRef.current !== requestId) return;
        setPreview(result);
      });
    }, CHAPTER_PREVIEW_DEBOUNCE);

    return () => clearTimeout(timer);
  }, [hoverChapter, pendingBook]);

  const commitAndClose = (text) => {
    onChange(text);
    onClose();
  };

  const openChapterStep = (book) => {
    previewRequestRef.current += 1;
    directionRef.current = 1;
    setPendingBook(book);
    setPendingChapter(null);
    setPreview(null);
    setHoverChapter(null);
    setVersePage(1);
    setStep("chapter");
  };

  const backToHome = () => {
    previewRequestRef.current += 1;
    directionRef.current = -1;
    setPreview(null);
    setHoverChapter(null);
    setStep("home");
    // Tells a caller that whatever was picked while browsing (a chapter,
    // narrowed or not) is no longer the "current" choice — a caller that
    // commits eagerly on every onChange (like the singular reference field
    // used to) has nothing to do with this, but one that defers committing
    // until the picker actually closes needs to know a return to the very
    // top of the picker means "treat this browse as abandoned," not
    // "silently keep whatever the last pick happened to be."
    onReturnHome?.();
  };

  // Commits immediately (the chapter alone is already a complete, valid
  // reference) but deliberately does NOT close — narrowing to a verse is
  // a real extra step, not something the picker should force before
  // letting the user leave.
  const pickChapter = (n) => {
    setPendingChapter(n);
    onChange(`${ pendingBook } ${ n }`);
  };

  const openVerseStep = () => {
    previewRequestRef.current += 1;
    directionRef.current = 1;
    setPreview(null);
    setHoverChapter(null);
    // Fresh every time this step is entered, not just on the picker's own
    // first open — going back and narrowing a DIFFERENT chapter within the
    // same still-open session must never inherit an earlier chapter's own
    // expanded page size or a typed-but-never-submitted verse number.
    setVersePage(1);
    setManualVerse("");
    setStep("verse");
  };

  const pickVerse = (v) => {
    const ref = `${ pendingBook } ${ pendingChapter }:${ v }`;
    const parsed = parseBareCitation(ref);
    if (!parsed) return;
    commitAndClose(parsed.full);
  };

  const commitManualVerse = () => {
    const n = Number(manualVerse.trim());
    if (!Number.isInteger(n) || n <= 0) return;
    pickVerse(n);
  };

  const parsedSearch = useMemo(() => parseBareCitation(searchText), [searchText]);

  const handleSearchKeyDown = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const trimmed = searchText.trim();
    if (!trimmed) return;
    // Commits the RAW typed text, not the parsed/canonical form — a
    // deliberate choice so freeform, non-Bible reference labels (already
    // saved before this feature existed, or simply what someone wants to
    // write) keep working exactly as they always have. parsedSearch is
    // only ever a visual/quick-commit signal, never a gate.
    commitAndClose(trimmed);
  };

  // While actively typing, search spans both testaments (no reason to
  // make someone pick Old/New first when they already know the name) —
  // with nothing typed, the testament tabs are the primary browse mode.
  const filteredSections = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    const sections = query ? BOOK_SECTIONS : BOOK_SECTIONS.filter((s) => s.testament === testament);
    return sections
      .map((s) => ({ ...s, books: query ? s.books.filter((b) => b.toLowerCase().includes(query)) : s.books }))
      .filter((s) => s.books.length > 0);
  }, [searchText, testament]);

  // The "Often on your desk" row draws from the same desk-wide inline-
  // citation aggregation the Scripture Index panel already computes (see
  // Home.jsx's own scriptureIndex memo) — the whole desk's actual citation
  // corpus, not a separate, narrower count of a since-removed single
  // dedicated reference field. scriptureIndex arrives already deduped and
  // sorted in canonical Bible order, so this only needs to re-rank by
  // count and cap it.
  const topReferences = useMemo(() => {
    if (!scriptureIndex?.length) return [];
    const currentKey = value?.trim().toLowerCase();
    return scriptureIndex
      .filter((entry) => entry.count > 0 && entry.full.trim().toLowerCase() !== currentKey)
      .slice()
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
      .map((entry) => ({ reference: entry.full, count: entry.count }));
  }, [scriptureIndex, value]);

  if (!position) return null;

  const verseNumbers = Array.from({ length: versePage * VERSE_PAGE_SIZE }, (_, i) => i + 1);

  return createPortal(
    <AnimatePresence>
      {
        open && (
          <motion.div
            ref={ panelRef }
            role="dialog"
            aria-label="Choose a scripture reference"
            className={ `reference-picker ${ colorName }-bg` }
            style={{ left: position.left, top: position.top }}
            initial={{ opacity: 0, scale: .8, y: -10, rotate: -3 }}
            animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }}
            exit={ squashCollapse({ scale: .85, y: -8, rotate: 2 }) }
            transition={ SETTLE }
          >
            {
              step !== "home" && (
                <div className="reference-picker-header">
                  <motion.button
                    type="button"
                    aria-label="Back"
                    className="reference-picker-back"
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: .88 }}
                    transition={ SNAPPY }
                    onClick={ step === "verse" ? () => { directionRef.current = -1; setStep("chapter"); } : backToHome }
                  >
                    <FaChevronLeft />
                  </motion.button>
                  <span className="reference-picker-crumb">
                    { step === "chapter" ? pendingBook : `${ pendingBook } ${ pendingChapter }` }
                  </span>
                </div>
              )
            }

            <AnimatePresence mode="popLayout" initial={ false } custom={ directionRef.current }>
              {
                step === "home" && (
                  <motion.div
                    key="home"
                    custom={ directionRef.current }
                    variants={ homeSlideVariants }
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: .18, ease: "easeOut" }}
                  >
                    {
                      noteCitations?.length > 0 && (
                        <div className="reference-picker-quick-section">
                          <span className="reference-picker-quick-label">From this note</span>
                          <div className="reference-picker-quick-row">
                            {
                              noteCitations.map((citation) => (
                                <button
                                  key={ citation.full }
                                  type="button"
                                  className={ `reference-picker-quick-pill ${ citation.full === value ? "current" : "" }` }
                                  onClick={ () => commitAndClose(citation.full) }
                                >
                                  { citation.full }
                                </button>
                              ))
                            }
                          </div>
                        </div>
                      )
                    }
                    {
                      topReferences.length > 0 && (
                        <div className="reference-picker-quick-section">
                          <span className="reference-picker-quick-label">Often on your desk</span>
                          <div className="reference-picker-quick-row">
                            {
                              topReferences.map((r) => (
                                <button
                                  key={ r.reference }
                                  type="button"
                                  className="reference-picker-quick-pill"
                                  onClick={ () => commitAndClose(r.reference) }
                                >
                                  { r.reference }
                                  <span className="reference-picker-quick-count">{ r.count }</span>
                                </button>
                              ))
                            }
                          </div>
                        </div>
                      )
                    }

                    <div className="reference-picker-search">
                      <input
                        type="text"
                        value={ searchText }
                        placeholder="Search a book, or type a reference…"
                        onChange={ (e) => setSearchText(e.target.value) }
                        onKeyDown={ handleSearchKeyDown }
                      />
                    </div>
                    {
                      parsedSearch && (
                        <button
                          type="button"
                          className="reference-picker-use-chip"
                          onClick={ () => commitAndClose(parsedSearch.full) }
                        >
                          Use “{ parsedSearch.full }” <FaArrowRight />
                        </button>
                      )
                    }

                    {
                      !searchText.trim() && (
                        <div className="reference-picker-tabs">
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
                      )
                    }

                    <div className="reference-picker-body custom-scroll">
                      {
                        filteredSections.length === 0 ? (
                          <p className="reference-picker-empty">No book matches “{ searchText }”.</p>
                        ) : (
                          filteredSections.map((section) => (
                            <div key={ `${ section.testament }-${ section.section }` } className="reference-picker-section">
                              <span className="reference-picker-section-label">{ section.section }</span>
                              <div className="reference-picker-book-grid">
                                {
                                  section.books.map((book) => (
                                    <button
                                      key={ book }
                                      type="button"
                                      className="reference-picker-book"
                                      onClick={ () => openChapterStep(book) }
                                    >
                                      { book }
                                    </button>
                                  ))
                                }
                              </div>
                            </div>
                          ))
                        )
                      }
                    </div>
                  </motion.div>
                )
              }

              {
                step === "chapter" && (
                  <motion.div
                    key="chapter"
                    custom={ directionRef.current }
                    variants={ slideVariants }
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: .18, ease: "easeOut" }}
                  >
                    <motion.div
                      className="reference-picker-chapter-grid custom-scroll"
                      variants={ enterExitStagger(0, .008) }
                      initial="hidden"
                      animate="shown"
                      onMouseLeave={ () => setHoverChapter(null) }
                    >
                      {
                        Array.from({ length: BOOK_CHAPTER_COUNTS[pendingBook] }, (_, i) => i + 1).map((n) => (
                          <motion.button
                            key={ n }
                            type="button"
                            aria-label={ `${ pendingBook } chapter ${ n }` }
                            aria-pressed={ pendingChapter === n }
                            className={ `reference-picker-chapter ${ pendingChapter === n ? "selected" : "" }` }
                            variants={{ hidden: { opacity: 0, scale: .5 }, shown: { opacity: 1, scale: 1, transition: SNAPPY } }}
                            whileHover={{ scale: 1.12 }}
                            whileTap={{ scale: .88 }}
                            transition={ SNAPPY }
                            onMouseEnter={ () => setHoverChapter(n) }
                            onClick={ () => pickChapter(n) }
                          >
                            { n }
                          </motion.button>
                        ))
                      }
                    </motion.div>

                    <AnimatePresence>
                      {
                        preview && (
                          <motion.div
                            className="reference-picker-preview"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ type: "spring", stiffness: 380, damping: 30 }}
                          >
                            {
                              preview.status === "loading" ? (
                                <span className="reference-picker-preview-muted">Looking it up…</span>
                              ) : preview.status === "error" ? (
                                <span className="reference-picker-preview-muted">{ preview.message || "Couldn't load this chapter." }</span>
                              ) : (
                                <span className="reference-picker-preview-text">{ preview.text }</span>
                              )
                            }
                          </motion.div>
                        )
                      }
                    </AnimatePresence>

                    {
                      pendingChapter && (
                        <div className="reference-picker-confirm">
                          <span>Set to { pendingBook } { pendingChapter }</span>
                          <button type="button" className="reference-picker-narrow" onClick={ openVerseStep }>
                            Narrow to a verse <FaArrowRight />
                          </button>
                        </div>
                      )
                    }
                  </motion.div>
                )
              }

              {
                step === "verse" && (
                  <motion.div
                    key="verse"
                    custom={ directionRef.current }
                    variants={ slideVariants }
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: .18, ease: "easeOut" }}
                  >
                    <div className="reference-picker-verse-grid custom-scroll">
                      {
                        verseNumbers.map((v) => (
                          <button key={ v } type="button" className="reference-picker-verse" onClick={ () => pickVerse(v) }>
                            { v }
                          </button>
                        ))
                      }
                      <button
                        type="button"
                        className="reference-picker-verse-more"
                        onClick={ () => setVersePage((p) => p + 1) }
                      >
                        + { VERSE_PAGE_SIZE } more
                      </button>
                    </div>
                    <div className="reference-picker-verse-manual">
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
                  </motion.div>
                )
              }
            </AnimatePresence>
          </motion.div>
        )
      }
    </AnimatePresence>,
    document.body
  );
};

export default ReferencePicker;
