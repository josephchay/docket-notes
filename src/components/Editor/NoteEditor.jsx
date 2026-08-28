import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import { FaStar, FaPen, FaXmark, FaCopy, FaShuffle, FaTag, FaCalendarDay, FaListCheck, FaBookBible, FaBookOpen, FaMagnifyingGlass, FaLocationCrosshairs, FaPalette } from "react-icons/fa6";
import { FaEye } from "react-icons/fa";

import useJellyTap from "../../hooks/useJellyTap";
import useFocusTrap from "../../hooks/useFocusTrap";
import HistoryAmbient from "../History/HistoryAmbient";
import { EXIT_SPRING, coinFlip } from "../Motion";
import { dueLabel } from "../../utils/date";
import { isChecklistText, toChecklistText, fromChecklistText } from "../../utils/checklist";
import { isStudyText, toStudyText, fromStudyText } from "../../utils/study";
import { parseCitations, parseBareCitation, findPrecedingSpan } from "../../utils/citations";
import { fetchVerseText, isFetchablePath } from "../../utils/bibleApi";
import ChecklistBody from "../Note/ChecklistBody";
import StudyBody from "../Note/StudyBody";
import DueDatePicker from "./DueDatePicker";
import ColorPicker from "./ColorPicker";
import ReferencePicker from "./ReferencePicker";
import HoverCitationOverlay from "./HoverCitationOverlay";
import { SCRIPTURE_INDEX_EVENT } from "../Scripture/ScriptureIndexPanel";

import "./NoteEditor.css";

const debounceTimer = 500;

// The palette dots and every action button (star, lock, copy, resize,
// close) shared this exact spring as a copy-pasted literal six times over
// in this one file — none of the app's cross-file Motion constants happen
// to match this file's own already-tuned 420/16 exactly, so it stays a
// local constant rather than being forced onto a slightly different
// shared one.
const actionSpring = { type: "spring", stiffness: 420, damping: 16 };

// The editor's papers: cozy for a quick line, roomy for writing, grand for
// spreading out, epic for filling the screen.
const EDITOR_SIZES = ["cozy", "roomy", "grand", "epic"];

const sizeFor = (name) => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  switch (name) {
    case "cozy": return { width: Math.min(520, vw * .94), height: Math.min(470, vh * .86) };
    case "grand": return { width: Math.min(1080, vw * .94), height: Math.min(840, vh * .9) };
    case "epic": return { width: Math.min(1440, vw * 0.96), height: Math.min(1080, vh * 0.94) };
    default: return { width: Math.min(720, vw * .94), height: Math.min(600, vh * .86) };
  }
};

// The focus editor. Pulling a note's "open" string stretches the card into
// this full writing surface — same paper, same color, far more room. Edits
// flow back into the card as you type (debounced, like the card's own
// fields), the palette repaints the note directly, and Escape, the backdrop,
// or the close button snap it shut again.
const NoteEditor = ({
  note,
  onClose,
  updateTitle,
  updateText,
  updateFavorite,
  updateLock,
  setNoteColor,
  updateQuote,
  updateTags,
  setNoteDueDate,
  toggleChecklist,
  toggleStudy,
  scriptureIndex,
  onFindCitation,
  tagCitation,
}) => {
  const [draftTitle, setDraftTitle] = useState(note.title);
  const [draftText, setDraftText] = useState(note.text);
  const [size, setSize] = useState("roomy");
  const [copied, setCopied] = useState(false);

  // The body renders as an interactive checklist or a three-part Bible
  // study the moment its own text reads as one or the other — see Note.jsx
  // and utils/checklist.js/utils/study.js for why both are derived rather
  // than a stored mode. The two are mutually exclusive by construction
  // (their marker grammars don't overlap), so at most one of these is ever
  // true.
  const isChecklist = isChecklistText(draftText);
  const isStudy = isStudyText(draftText);
  const due = dueLabel(note.dueAt);

  // Inline parenthetical citations woven through the note's own prose —
  // "(Genesis 1:1:7, 1:3:9-10)" — a purely derived read (see
  // utils/citations.js), never a stored mode the way checklist/study are;
  // it just re-scans whenever the text itself changes, and works the same
  // regardless of whether the body is plain text, a checklist, or a study.
  const citations = useMemo(() => parseCitations(draftText), [draftText]);

  // A highlighted piece of plain text offers a scripture reference — two
  // different flavors depending on what the selection already reads as.
  // If it's already a complete, valid citation on its own ("Genesis 1:1"
  // typed inline, not "(Genesis 1:1)" yet — see parseBareCitation), the
  // offer is a one-tap "Tag it" that just wraps it in place, no picker
  // needed. Any OTHER highlighted text — a sentence, a phrase, anything at
  // all — offers "Add reference" instead, opening ReferencePicker to
  // choose one, which then gets appended as a trailing parenthetical
  // citation right after the highlight, the exact style this app's own
  // placeholder quotes and the user's own original sample writing already
  // use ("...the earth was without form and void (Genesis 1:2)."). Both
  // share one state shape (start/end/text, a `kind` discriminant) since
  // they're mutually-exclusive outcomes of the same selection-
  // classification decision, not two independent concerns that happen to
  // overlap — keeping them one state means the staleness guard below only
  // has to be written, and trusted, once. Cleared the instant the
  // selection changes to something the current kind's own offer no longer
  // applies to.
  const [pendingSelection, setPendingSelection] = useState(null);

  // The native `select` event alone is unreliable for this — several
  // browsers don't fire it for a keyboard-driven selection (Shift+Arrow),
  // only a mouse drag — so this is also wired to onMouseUp/onKeyUp on the
  // same field (see the textarea below), the standard belt-and-braces way
  // text editors track "did the selection just change" across both input
  // methods.
  const handleTextSelect = (e) => {
    if (note.lock) { setPendingSelection(null); return; }

    const { selectionStart, selectionEnd } = e.target;
    if (selectionStart === selectionEnd) { setPendingSelection(null); return; }

    // Trimmed before it's ever stored, not just before matching — a
    // double-click or drag that happens to catch a trailing space would
    // otherwise get wrapped/inserted-after verbatim later, a real, if
    // cosmetic, gap. start/end are adjusted inward by the same amount
    // trimmed off, so they still point at exactly the matched text, not
    // the original untrimmed span.
    const raw = draftText.slice(selectionStart, selectionEnd);
    const leading = raw.match(/^\s*/)[0].length;
    const trailing = raw.match(/\s*$/)[0].length;
    const start = selectionStart + leading;
    const end = selectionEnd - trailing;
    const selected = draftText.slice(start, end);
    // A selection that's entirely whitespace trims down to nothing — there
    // is no text left to offer either flavor of reference for.
    if (!selected) { setPendingSelection(null); return; }

    const parsed = parseBareCitation(selected);
    if (parsed) {
      setPendingSelection({ kind: "citation", start, end, text: selected, ...parsed });
      return;
    }

    // Does this selection fall within the sentence/clause an EXISTING
    // citation already in this note is attached to (see findPrecedingSpan)?
    // If so, offer to reveal that citation's own verse text instead of
    // offering to attach a brand new, different one to the same prose.
    const linked = citations.find((citation) => {
      const span = findPrecedingSpan(draftText, citation);
      return start < span.end && end > span.start;
    });
    if (linked) {
      setPendingSelection({ kind: "linked", start, end, text: selected, citation: linked });
      return;
    }

    setPendingSelection({ kind: "annotate", start, end, text: selected });
  };

  // Wraps the current selection in parens right where it sits — the exact
  // syntax parseCitations already reads — rather than opening any kind of
  // reference-entry form, since the selected text already IS a complete,
  // valid citation on its own; all this has to do is give it the
  // punctuation that turns it from plain prose into one the app recognizes.
  const tagSelectionAsCitation = () => {
    if (note.lock || !pendingSelection || pendingSelection.kind !== "citation") return;
    const { start, end, text } = pendingSelection;

    // pendingSelection's own start/end are only ever as fresh as the
    // selection event that set them — draftText itself can change out
    // from under it without that event ever re-firing (an undo/redo
    // landing while the offer is still showing, note.text syncing in from
    // elsewhere, even just switching to checklist/study mode, which also
    // clears this explicitly below but is worth a belt-and-braces check
    // here too). Re-reading the same span and confirming it still holds
    // exactly the text it did when selected is what actually keeps this
    // safe against every one of those causes at once, rather than trying
    // to separately catch each one — a slice that no longer matches means
    // "stale," and this simply declines rather than corrupting whatever
    // now sits at that old offset.
    if (draftText.slice(start, end) !== text) { setPendingSelection(null); return; }

    const nextText = `${ draftText.slice(0, start) }(${ text })${ draftText.slice(end) }`;

    // Committed as its own named action (tagCitation, see Home.jsx) rather
    // than through the plain debounced handleText path every keystroke
    // uses — the same reasoning as the checklist/study toggles just above:
    // cancel the still-armed debounce first so it can't fire moments later
    // and silently overwrite this with stale pre-tag text, and update
    // draftText locally so the wrap is instant regardless of the field's
    // own focus state.
    cancelPendingText();
    setDraftText(nextText);
    tagCitation(note.id, nextText);
    setPendingSelection(null);

    // Re-selects the same text (now shifted one character by the opening
    // paren just inserted) so the visible selection lands right back on
    // the citation it always was, rather than collapsing to a bare caret.
    requestAnimationFrame(() => {
      textRef.current?.focus({ preventScroll: true });
      textRef.current?.setSelectionRange(start + 1, end + 1);
    });
  };

  // The "Add reference" half — opens ReferencePicker rather than acting
  // immediately, since arbitrary text (unlike an already-citation-shaped
  // selection) needs a real book/chapter/verse choice, not just
  // punctuation. Captures the insertion point (right after the highlight)
  // and the highlight's own text into a ref rather than leaving it in
  // pendingSelection, which is cleared immediately below — the offer
  // banner's own job is done the moment this opens; ReferencePicker takes
  // over from here, and may stay open a while (browsing, narrowing to a
  // verse) with no further need for the original offer's own state.
  const annotationTargetRef = useRef(null);
  // The picker's own onChange can fire more than once per open session
  // (a chapter pick that deliberately doesn't close, later refined to a
  // verse) — rather than writing into the text on every intermediate
  // value (noisy, and would spam pushUndo the same way addendum #7 already
  // flagged for the singular reference field), this just remembers the
  // LATEST picked value in a ref and only ever touches note.text once,
  // when the picker actually closes. A ref rather than state specifically
  // because onChange and onClose can both fire synchronously back to back
  // from the same click (see ReferencePicker's own commitAndClose) — state
  // set in onChange wouldn't be visible yet to onClose's own closure in
  // that same call, a ref reads back immediately with no such lag.
  const latestAnnotationRef = useRef(null);
  const [annotationPickerOpen, setAnnotationPickerOpen] = useState(false);
  const annotationTriggerRef = useRef(null);
  // Forces a fresh ReferencePicker instance every time "Add reference" is
  // clicked, bumped in openAnnotationPicker below — without this, clicking
  // it a SECOND time while an earlier session is already open (open stays
  // true -> true, a no-op transition) leaves the picker's own internal
  // step/book/chapter/search/position state exactly as browsing left it,
  // now silently misattached to a brand new highlight. A changed `key`
  // guarantees React discards and remounts it clean every time, regardless
  // of whether `open` itself actually changed.
  const [annotationPickerKey, setAnnotationPickerKey] = useState(0);

  const openAnnotationPicker = () => {
    if (note.lock || !pendingSelection || pendingSelection.kind !== "annotate") return;
    annotationTargetRef.current = { insertAt: pendingSelection.end, selectionStart: pendingSelection.start, originalText: pendingSelection.text };
    latestAnnotationRef.current = null;
    setPendingSelection(null);
    setAnnotationPickerKey((k) => k + 1);
    setAnnotationPickerOpen(true);
  };

  const closeAnnotationPicker = () => {
    setAnnotationPickerOpen(false);
    const target = annotationTargetRef.current;
    const reference = latestAnnotationRef.current;
    annotationTargetRef.current = null;
    latestAnnotationRef.current = null;
    if (note.lock || !target || !reference) return;

    // Same staleness discipline as tagSelectionAsCitation's own guard —
    // the picker can sit open a while (browsing books, hovering chapters
    // for a preview), plenty of time for the text around the original
    // highlight to have changed underneath it (undo/redo, more typing).
    // Re-verifying the exact span the highlight occupied is still intact
    // right before ever touching the text is what keeps this from ever
    // inserting a citation into the wrong place.
    if (draftText.slice(target.selectionStart, target.insertAt) !== target.originalText) return;

    // Never splice a new citation's parens into the middle of an EXISTING
    // one — a highlight that happens to end partway through an adjacent
    // "(Book c:v)" (a plausible imprecise drag when a citation sits right
    // next to prose with no separating space) would otherwise nest a new
    // paren group inside the old one's. That breaks both: parseCitations'
    // own group regex can't match nested parens, so the ORIGINAL citation
    // silently vanishes from the pill row, and the text itself is left
    // visibly malformed ("(Genesis (Genesis 1:2) 1:1)"). If the natural
    // insertion point falls inside an unclosed paren, push it forward to
    // just past that group's own close instead — the new citation lands
    // right after the existing one rather than inside it.
    let insertAt = target.insertAt;
    let depth = 0;
    for (let i = 0; i < insertAt; i++) {
      if (draftText[i] === "(") depth++;
      else if (draftText[i] === ")") depth = Math.max(0, depth - 1);
    }
    if (depth > 0) {
      const closeIndex = draftText.indexOf(")", insertAt);
      if (closeIndex === -1) return; // an unterminated group — decline rather than guess
      insertAt = closeIndex + 1;
    }

    cancelPendingText();
    const nextText = `${ draftText.slice(0, insertAt) } (${ reference })${ draftText.slice(insertAt) }`;
    setDraftText(nextText);
    tagCitation(note.id, nextText);
  };

  // Proactively clears a pending selection offer the instant it goes
  // stale, rather than only ever catching it reactively inside
  // tagSelectionAsCitation's own guard above — that guard keeps the
  // ACTION safe (it will never corrupt text), but on its own it leaves a
  // dead offer button sitting on screen that silently does nothing when
  // clicked, which reads as broken rather than safe. Three ways it goes
  // stale: switching to checklist/study mode replaces the plain textarea
  // entirely, so there's no longer a single field the old offsets could
  // even mean anything against; draftText changing at those same offsets
  // to something other than what was actually selected (an undo/redo
  // landing, note.text syncing in from elsewhere) — checked the same way
  // the action's own guard checks it, just ahead of a click rather than
  // only at one; or, for a "linked" offer specifically, its `citation`
  // going stale even though the {start,end,text} span it also carries
  // still matches — findPrecedingSpan's span always ends right BEFORE the
  // citation's own "(...)" text, so deleting only the citation elsewhere
  // (e.g. via a History-panel jump, a sibling overlay that never unmounts
  // this editor) leaves that prefix slice unchanged and the span check
  // above none the wiser, the same reason previewCitation's own staleness
  // effect just below checks citation identity against `citations`
  // directly rather than trusting a text span.
  useEffect(() => {
    if (!pendingSelection) return;
    if (note.lock || isChecklist || isStudy) { setPendingSelection(null); return; }
    if (draftText.slice(pendingSelection.start, pendingSelection.end) !== pendingSelection.text) {
      setPendingSelection(null);
      return;
    }
    if (pendingSelection.kind === "linked" && !citations.some((c) => c.full === pendingSelection.citation.full)) {
      setPendingSelection(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftText, isChecklist, isStudy, note.lock, citations]);

  // Jumps to where a recognized citation actually lives in this note's own
  // text — only meaningful in plain-text mode, where there's a single
  // textarea to select within at all (a checklist/study body is several
  // separate fields, none of which is "the" text this citation's own
  // start/end offsets were measured against).
  const selectCitationInText = (citation) => {
    if (isChecklist || isStudy) return;
    const field = textRef.current;
    if (!field) return;

    field.focus({ preventScroll: false });
    field.setSelectionRange(citation.start, citation.end);
  };

  // The one place this app ever fetches anything — clicking a citation's
  // own label asks bible-api.com what it actually says (see utils/
  // bibleApi.js). Unlike the jump button, this has nothing to do with
  // where the citation sits in THIS note's own text, so it works the same
  // in checklist/study mode as in plain text, and needs no note.lock guard
  // either — a read-only lookup, same as the magnifier's cross-note search
  // right next to it. previewRequestRef guards against a slower first
  // fetch landing after a second click already moved on to a different
  // citation (or closed the preview) — without it, clicking pill A then
  // quickly pill B could show A's answer under B's label the moment A's
  // request finally resolves.
  const [previewCitation, setPreviewCitation] = useState(null);
  const [previewResult, setPreviewResult] = useState(null);
  const previewRequestRef = useRef(0);

  const togglePreview = (citation) => {
    if (previewCitation === citation.full) {
      previewRequestRef.current += 1;
      setPreviewCitation(null);
      setPreviewResult(null);
      return;
    }

    const requestId = ++previewRequestRef.current;
    setPreviewCitation(citation.full);
    setPreviewResult({ status: "loading" });

    fetchVerseText(citation).then((result) => {
      if (previewRequestRef.current !== requestId) return;
      setPreviewResult(result);
    });
  };

  // Proactively closes a stale preview the same way pendingSelection's own
  // effect above does — if the citation being previewed no longer appears
  // in the note at all (its text was edited or deleted), there's nothing
  // left for the open card to actually be showing text FOR.
  useEffect(() => {
    if (previewCitation && !citations.some((c) => c.full === previewCitation)) {
      previewRequestRef.current += 1;
      setPreviewCitation(null);
      setPreviewResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citations]);

  // Strips whichever structured form (if either) is currently active back
  // to plain text — the shared first step both toggle handlers below take
  // before applying the OTHER form's markers, so switching directly from a
  // checklist to a study (or back) never layers one marker grammar on top
  // of the other's leftover syntax.
  const normalizeStructuredText = (text) => {
    if (isChecklistText(text)) return fromChecklistText(text);
    if (isStudyText(text)) return fromStudyText(text);
    return text;
  };

  // Tags pop in bouncy, shrink away when removed. Notes from before this
  // feature existed simply have none yet.
  const tags = note.tags || [];
  const [tagDraft, setTagDraft] = useState("");
  const tagInputRef = useRef(null);

  const addTag = () => {
    const clean = tagDraft.trim().toLowerCase().replace(/\s+/g, "-");
    setTagDraft("");
    if (!clean || tags.includes(clean)) return;

    updateTags([...tags, clean], note.id);
  };

  const handleTagKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag();
    } else if (e.key === "Backspace" && !tagDraft && tags.length > 0) {
      updateTags(tags.slice(0, -1), note.id);
    }
  };

  const removeTag = (tag) => {
    updateTags(tags.filter((t) => t !== tag), note.id);
  };

  // The annotation ReferencePicker is NOT inside any {!note.lock && (...)}
  // or {!isChecklist && !isStudy && (...)} conditional the way the offer
  // banner that opens it is — the picker itself is rendered unconditionally
  // (only its own `open` prop controls visibility), so nothing unmounts it
  // automatically the instant a lock or a mode switch makes it stop making
  // sense. Both transitions are reachable while it's open WITHOUT the
  // picker's own outside-pointerdown listener ever firing to close it
  // first — a keyboard-activated (Enter/Space) toggle button fires only a
  // `click`, never a `pointerdown` — so this force-closes it directly on
  // either. Deliberately bypasses closeAnnotationPicker's own insert-
  // whatever-was-last-picked step: locking, or leaving plain-text mode
  // entirely, should discard whatever pick was still in progress, not race
  // to sneak one last commit in right as the field it was even happening
  // over stops existing.
  useEffect(() => {
    if (note.lock || isChecklist || isStudy) setAnnotationPickerOpen(false);
  }, [note.lock, isChecklist, isStudy]);

  // The gluey wobble: whenever the paper opens or changes size it squashes
  // and stretches like jelly while the bouncy size spring overshoots.
  const jelly = useAnimationControls();

  // The header's action row was the editor's one flat corner — plain
  // hover/tap scale with no give in it. Each icon gets its own tap jelly
  // now, played on its own inner span so it never fights the button's own
  // whileHover/whileTap, or (for lock) the coin-flip already swapping
  // pen/eye on the span inside it.
  const starTap = useJellyTap();
  const lockTap = useJellyTap();
  const remindTap = useJellyTap();
  const colorTap = useJellyTap();
  const checklistTap = useJellyTap();
  const studyTap = useJellyTap();
  const scriptureTap = useJellyTap();
  const copyTap = useJellyTap();
  const resizeTap = useJellyTap();
  const closeTap = useJellyTap();

  const wobble = useCallback(() => {
    // .start()'s own promise rejects when a fresh call on the same
    // controls (the next resize, fired before this one's .6s settles)
    // interrupts it mid-flight — a real, pre-existing gap this session's
    // testing happened to surface by clicking resize faster than a person
    // normally would, not anything the resize feature itself got wrong.
    // The wobble is purely decorative, so a cancelled one is never an
    // error worth surfacing — just nothing left to catch it before now.
    jelly.start({
      scaleX: [1, 1.05, .96, 1.02, 1],
      scaleY: [1, .94, 1.06, .98, 1],
      transition: { duration: .6, times: [0, .25, .5, .75, 1], ease: "easeInOut" },
    }).catch(() => {});
  }, [jelly]);

  useEffect(() => {
    wobble();
  }, [size, wobble]);

  const titleRef = useRef(null);
  const textRef = useRef(null);
  const editorRef = useRef(null);
  const titleTimerRef = useRef(null);
  const textTimerRef = useRef(null);
  const copiedTimerRef = useRef(null);
  const hoverOverlayRef = useRef(null);
  // The latest typed value handleTitle/handleText below have queued a
  // debounced commit for — read back by the unmount cleanup a little
  // further down, since that cleanup's own closure only ever sees
  // whatever draftTitle/draftText were AT MOUNT (its effect has no
  // dependency that would re-create it on every keystroke), while a ref's
  // .current is always current regardless of which render's closure asks.
  const latestTitleRef = useRef(draftTitle);
  const latestTextRef = useRef(draftText);

  // The copy action's own ghost scrap (see handleCopy below) — page-space
  // coordinates, portaled straight to document.body the same way every
  // other cross-element travel effect in this app already is (Note.jsx's
  // radial menu, ColorSelector's drag ghost), since it has to fly from the
  // textarea to the copy button regardless of whatever transform the
  // editor's own entrance/jelly wrappers currently carry.
  const [copyGhost, setCopyGhost] = useState(null);
  const copyBtnRef = useRef(null);

  // Traps Tab/Shift+Tab within the editor and returns focus to whatever
  // triggered it once closed — see useFocusTrap.js. `open` is a constant
  // `true` here (unlike every other panel using this hook) since this
  // component only ever exists while actively editing — Home.jsx mounts
  // and unmounts it entirely rather than toggling an internal open flag,
  // and the hook's restore-on-close step lives in its effect's own
  // cleanup specifically so that still fires correctly on unmount.
  // focusOnOpen is off: the effect below already puts the caret in the
  // text field itself (or, for a locked note, on the editor shell) — a
  // more specific target than the hook's own generic "focus the panel
  // root" fallback.
  useFocusTrap(editorRef, true, { focusOnOpen: false });

  // Adopt outside changes to the note unless that field is being typed in
  // right now — a self-made edit round-trips as the same value anyway.
  // Also re-syncs latestTitleRef/latestTextRef (see the unmount cleanup
  // further down) — an outside change (e.g. an undo landing on this same
  // still-mounted note while focus is elsewhere) has to update what the
  // cleanup would flush too, or a later close would silently re-commit
  // the pre-undo value straight back over it.
  useEffect(() => {
    if (document.activeElement !== titleRef.current) {
      setDraftTitle(note.title);
      latestTitleRef.current = note.title;
    }
  }, [note.title]);

  useEffect(() => {
    if (document.activeElement !== textRef.current) {
      setDraftText(note.text);
      latestTextRef.current = note.text;
    }
  }, [note.text]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key !== "Escape") return;
      // DueDatePicker/ReferencePicker/ColorPicker are all portaled straight
      // to document.body and each close themselves on Escape independently
      // (see their own identical handleKey effects) — but a plain, global
      // `window` keydown listener has no notion of "the popover already
      // handled this," so without checking here too, the SAME Escape press
      // that closes one of those popovers was also closing this whole
      // editor underneath it in one keystroke. Mirrors the exact body-class
      // check ScriptureIndexPanel.jsx's own Escape handler already uses to
      // defer to these same three popovers.
      if (
        document.body.classList.contains("due-picker-open") ||
        document.body.classList.contains("reference-picker-open") ||
        document.body.classList.contains("color-picker-open")
      ) return;
      onClose();
    };

    window.addEventListener("keydown", handleKey);

    return () => {
      window.removeEventListener("keydown", handleKey);
      // A commit still pending when this unmounts (closing the editor, or
      // switching to a different note — both fully unmount this
      // component, since Home.jsx keys it by note.id) has to actually be
      // applied here, not just discarded — clearTimeout alone silently
      // dropped whatever was typed in the last debounceTimer-ms window
      // before closing, including a just-typed scripture citation. Reads
      // the LATEST typed value off latestTitleRef/latestTextRef, not
      // draftTitle/draftText directly — this cleanup closure only ever
      // sees whatever those were AT MOUNT, since this effect has no
      // dependency that would re-create it on every keystroke, while a
      // ref's own .current is always current. Only flushes if a timer is
      // actually still pending (non-null), so a note closed well after
      // its last edit already committed doesn't get a redundant, no-op
      // second commit.
      if (titleTimerRef.current) {
        clearTimeout(titleTimerRef.current);
        updateTitle(latestTitleRef.current, note.id);
      }
      if (textTimerRef.current) {
        clearTimeout(textTimerRef.current);
        updateText(latestTextRef.current, note.id);
      }
      clearTimeout(copiedTimerRef.current);
    };
  }, [onClose]);

  // Drop the caret at the end of the body so writing continues immediately
  // — or, for a locked note (nothing to type into), land on the editor
  // shell itself instead, so a keyboard user still has *something*
  // focused to Tab from rather than nothing at all. A note that opens
  // straight into checklist mode has no textRef to focus here at all (see
  // the isChecklist branch below) — ChecklistBody handles that case itself
  // via its own `autoFocus` prop, landing on its first row instead.
  useEffect(() => {
    if (note.lock) {
      editorRef.current?.focus({ preventScroll: true });
      return;
    }

    const field = textRef.current;
    if (!field) return;

    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
  }, [note.lock]);

  // Both timer refs are nulled out the instant their own setTimeout
  // actually fires — without this, a fired-and-forgotten timer id (still
  // truthy) is indistinguishable from a genuinely pending one, so the
  // unmount cleanup's own "only flush if a commit is still pending" guard
  // stayed true forever after the FIRST edit, re-applying latestTitleRef/
  // latestTextRef on every later close even when nothing was pending
  // (a redundant, silent extra commit) — or, worse, re-applying a value
  // an outside change (e.g. undo) had already superseded.
  const handleTitle = (value) => {
    setDraftTitle(value);
    latestTitleRef.current = value;
    clearTimeout(titleTimerRef.current);
    titleTimerRef.current = setTimeout(() => {
      titleTimerRef.current = null;
      updateTitle(value, note.id);
    }, debounceTimer);
  };

  const handleText = (value) => {
    setDraftText(value);
    latestTextRef.current = value;
    clearTimeout(textTimerRef.current);
    textTimerRef.current = setTimeout(() => {
      textTimerRef.current = null;
      updateText(value, note.id);
    }, debounceTimer);
  };

  // Disarms a pending debounced text commit without discarding it — used
  // right before the checklist toggle below, which is handed draftText
  // directly (see toggleChecklist(note.id, draftText)) rather than reading
  // note.text back out of Home's own state, so it always converts exactly
  // what's on screen even mid-keystroke. Left armed, that old timer would
  // still fire ~debounceTimer later and commit the stale PRE-toggle plain
  // text over top of the just-toggled checklist, silently undoing it.
  const cancelPendingText = () => {
    clearTimeout(textTimerRef.current);
    textTimerRef.current = null;
  };

  // Copy the whole note as plain text, with a small sparkle of confirmation
  // — and now a scrap of the paper itself visibly lifting off the text and
  // flying to the button that just fired, rather than only the flat
  // "Copied ✦" label popping in place.
  const handleCopy = async () => {
    const body = draftText?.trim() ? draftText : note.placeholder;
    const content = `${ draftTitle?.trim() || "Untitled note" }\n\n${ body }`;

    try {
      await navigator.clipboard.writeText(content);
    } catch {
      return;
    }

    setCopied(true);
    clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), 1400);

    const textRect = textRef.current?.getBoundingClientRect();
    const btnRect = copyBtnRef.current?.getBoundingClientRect();
    if (textRect && btnRect) {
      setCopyGhost({
        key: Date.now(),
        fromX: textRect.left + textRect.width / 2,
        fromY: textRect.top + 30,
        toX: btnRect.left + btnRect.width / 2,
        toY: btnRect.top + btnRect.height / 2,
      });
    }
  };

  const words = draftText.trim() ? draftText.trim().split(/\s+/).length : 0;

  // The reminder button opens DueDatePicker.jsx's own hand-built calendar
  // popover instead of the browser's native date widget — anchored off
  // this button's own rect, which the popover measures itself via this ref.
  const remindBtnRef = useRef(null);
  const [dueCalendarOpen, setDueCalendarOpen] = useState(false);

  // Same shape as the reminder button above — the always-visible 7-dot
  // palette this header used to show was replaced with one trigger button,
  // styled identically to it (plain dark, not tinted to the note's own
  // color) that opens ColorPicker.jsx's own popover of the actual color
  // choices, anchored off this ref.
  const colorBtnRef = useRef(null);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);

  return (
    <div className="note-editor-layer">
      <motion.div
        className="note-editor-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{
          opacity: 0,
          transition: { duration: .25, ease: "easeIn" },
        }}
        onClick={ onClose }
      />
      <motion.div
        ref={ editorRef }
        tabIndex={ -1 }
        className="note-editor-shell"
        initial={{ opacity: 0, scale: .8, y: 90, rotate: -1.5 }}
        animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }}
        /* The entrance is a real spring with a slight rotate settle; the
           exit used to be a flat linear fade-shrink with none of that
           character. Now it reverses the same spring, tipping back the
           way it came in instead of just shrinking straight down. */
        exit={{
          opacity: 0,
          scale: .86,
          y: 60,
          rotate: 1.5,
          transition: EXIT_SPRING,
        }}
        transition={{
          type: "spring",
          stiffness: 300,
          damping: 24,
        }}
      >
        <motion.div
          className="note-editor-jelly"
          animate={ jelly }
        >
          <motion.div
            className={ `note-editor ${ size } ${ note.color }-bg ${ note.lock ? "locked" : "" }` }
            initial={ sizeFor("roomy") }
            animate={ sizeFor(size) }
            transition={{ type: "spring", stiffness: 260, damping: 14, mass: .9 }}
          >
            {/* A faint drift of actual ink specks behind the paper — the
                exact same raw-Three.js dust technique History's own preview
                pane and the Settings panel already reuse (see
                HistoryAmbient.jsx). Tinted to the page's own ink rather than
                the note's color: the paper itself already *is* that color
                (note-editor's own background), so dust in the same shade
                would all but disappear into it — ink motes read clearly
                against any of the seven paper colors instead. */}
            <HistoryAmbient color="var(--page-ink-color)" />
            <div className="note-editor-header">
              <div className="note-editor-palette">
                <motion.button
                  ref={ colorBtnRef }
                  type="button"
                  aria-label="Change this note's color"
                  aria-pressed={ colorPickerOpen }
                  className="note-editor-action dark"
                  whileHover={{ scale: 1.15, rotate: -8 }}
                  whileTap={{ scale: .9 }}
                  transition={ actionSpring }
                  onTapStart={ colorTap.squash }
                  onClick={ () => setColorPickerOpen((prev) => !prev) }
                >
                  <motion.span animate={ colorTap.jelly } style={{ display: "inline-flex" }}>
                    <FaPalette className="note-editor-action-icon light" />
                  </motion.span>
                </motion.button>
              </div>
              <div className="note-editor-actions">
                <motion.button
                  type="button"
                  aria-label={ note.favorite ? "Unstar this note" : "Star this note" }
                  className="note-editor-action"
                  whileHover={{ scale: 1.15, rotate: -10 }}
                  whileTap={{ scale: .9 }}
                  transition={ actionSpring }
                  style={{
                    backgroundColor: note.favorite ? "var(--black-color)" : "var(--black-even-more-transclucent-color)",
                  }}
                  onTapStart={ starTap.squash }
                  onClick={ () => updateFavorite(note.id) }
                >
                  <motion.span animate={ starTap.jelly } style={{ display: "inline-flex" }}>
                    <FaStar className={ `note-editor-action-icon ${ note.color }` } />
                  </motion.span>
                </motion.button>
                <motion.button
                  type="button"
                  aria-label={ note.lock ? "Unlock this note for editing" : "Lock this note" }
                  className="note-editor-action dark"
                  style={{ transformPerspective: 300 }}
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: .9 }}
                  transition={ actionSpring }
                  onTapStart={ lockTap.squash }
                  onClick={ () => updateLock(note.id) }
                >
                  <motion.span animate={ lockTap.jelly } style={{ display: "inline-flex" }}>
                    <AnimatePresence mode="wait" initial={ false }>
                      <motion.span
                        key={ note.lock ? "pen" : "eye" }
                        className="note-editor-action-icon-wrap"
                        { ...coinFlip({ type: "spring", stiffness: 420, damping: 17 }) }
                      >
                        {
                          note.lock
                            ? <FaPen className="note-editor-action-icon light" />
                            : <FaEye className="note-editor-action-icon light" />
                        }
                      </motion.span>
                    </AnimatePresence>
                  </motion.span>
                </motion.button>
                <motion.button
                  ref={ remindBtnRef }
                  type="button"
                  aria-label={ note.dueAt ? "Change this note's reminder" : "Set a reminder for this note" }
                  aria-pressed={ dueCalendarOpen }
                  className="note-editor-action dark"
                  whileHover={{ scale: 1.15, rotate: -8 }}
                  whileTap={{ scale: .9 }}
                  transition={ actionSpring }
                  onTapStart={ remindTap.squash }
                  onClick={ () => setDueCalendarOpen((prev) => !prev) }
                >
                  <motion.span animate={ remindTap.jelly } style={{ display: "inline-flex" }}>
                    <FaCalendarDay className="note-editor-action-icon light" />
                  </motion.span>
                </motion.button>
                <motion.button
                  type="button"
                  aria-label={ isChecklist ? "Turn this back into plain text" : "Turn this into a checklist" }
                  aria-pressed={ isChecklist }
                  disabled={ note.lock }
                  className="note-editor-action"
                  style={{
                    backgroundColor: isChecklist ? "var(--black-color)" : "var(--black-even-more-transclucent-color)",
                    opacity: note.lock ? .4 : 1,
                  }}
                  whileHover={ note.lock ? undefined : { scale: 1.15, rotate: 8 } }
                  whileTap={ note.lock ? undefined : { scale: .9 } }
                  transition={ actionSpring }
                  onTapStart={ checklistTap.squash }
                  onClick={ () => {
                    if (note.lock) return;
                    cancelPendingText();
                    // draftText is updated here directly rather than left
                    // to round-trip back down through the note.text prop
                    // (see the sync effect above) — that effect only syncs
                    // while the field it guards against isn't itself
                    // focused, and this toggle can fire with the textarea
                    // still mid-focus (typed something, clicked straight
                    // over to this button without an intervening blur) —
                    // updating locally keeps the toggle instant and
                    // correct regardless of that timing.
                    const nextText = isChecklist ? fromChecklistText(draftText) : toChecklistText(normalizeStructuredText(draftText));
                    setDraftText(nextText);
                    toggleChecklist(note.id, draftText);
                  } }
                >
                  <motion.span animate={ checklistTap.jelly } style={{ display: "inline-flex" }}>
                    <FaListCheck className={ `note-editor-action-icon ${ isChecklist ? "light" : "" }` } />
                  </motion.span>
                </motion.button>
                <motion.button
                  type="button"
                  aria-label={ isStudy ? "Turn this back into plain text" : "Turn this into a Bible study" }
                  aria-pressed={ isStudy }
                  disabled={ note.lock }
                  className="note-editor-action"
                  style={{
                    backgroundColor: isStudy ? "var(--black-color)" : "var(--black-even-more-transclucent-color)",
                    opacity: note.lock ? .4 : 1,
                  }}
                  whileHover={ note.lock ? undefined : { scale: 1.15, rotate: -8 } }
                  whileTap={ note.lock ? undefined : { scale: .9 } }
                  transition={ actionSpring }
                  onTapStart={ studyTap.squash }
                  onClick={ () => {
                    if (note.lock) return;
                    cancelPendingText();
                    // Same instant-local-update reasoning as the checklist
                    // toggle just above.
                    const nextText = isStudy ? fromStudyText(draftText) : toStudyText(normalizeStructuredText(draftText));
                    setDraftText(nextText);
                    toggleStudy(note.id, draftText);
                  } }
                >
                  <motion.span animate={ studyTap.jelly } style={{ display: "inline-flex" }}>
                    <FaBookOpen className={ `note-editor-action-icon ${ isStudy ? "light" : "" }` } />
                  </motion.span>
                </motion.button>
                {/* Opens the same corpus-wide Scripture Index every other
                    summoner (Header's own toolbar button, the command
                    palette) already opens — now a persistent side dock
                    rather than a modal (see ScriptureIndexPanel.jsx), so it
                    can stay open and readable while this editor stays open
                    too, exactly what this button exists to make reachable
                    without leaving the note. Non-toggling, same one-shot
                    shape as Copy/Reminder/Close right next to it: this
                    editor has no visibility into whether the dock is
                    currently open (that state stays local to the panel
                    itself), so there's nothing to show as "active" here —
                    closing the dock happens on its own close button or
                    Escape, not a second click on this one. */}
                <motion.button
                  type="button"
                  aria-label="Open the Scripture Index"
                  className="note-editor-action dark"
                  whileHover={{ scale: 1.15, rotate: 6 }}
                  whileTap={{ scale: .9 }}
                  transition={ actionSpring }
                  onTapStart={ scriptureTap.squash }
                  onClick={ () => window.dispatchEvent(new CustomEvent(SCRIPTURE_INDEX_EVENT)) }
                >
                  <motion.span animate={ scriptureTap.jelly } style={{ display: "inline-flex" }}>
                    <FaBookBible className="note-editor-action-icon light" />
                  </motion.span>
                </motion.button>
                <motion.button
                  ref={ copyBtnRef }
                  type="button"
                  aria-label="Copy the note to the clipboard"
                  className="note-editor-action dark"
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: .9 }}
                  transition={ actionSpring }
                  onTapStart={ copyTap.squash }
                  onClick={ handleCopy }
                >
                  <motion.span animate={ copyTap.jelly } style={{ display: "inline-flex" }}>
                    <FaCopy className="note-editor-action-icon light" />
                  </motion.span>
                </motion.button>
                <motion.button
                  type="button"
                  aria-label={ `Resize the paper (now ${ size })` }
                  className="note-editor-action"
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: .8 }}
                  transition={ actionSpring }
                  onTapStart={ resizeTap.squash }
                  onClick={ () => setSize(EDITOR_SIZES[(EDITOR_SIZES.indexOf(size) + 1) % EDITOR_SIZES.length]) }
                >
                  <motion.span animate={ resizeTap.jelly } style={{ display: "inline-flex" }}>
                    <span className={ `note-editor-size-box s${ EDITOR_SIZES.indexOf(size) }` } />
                  </motion.span>
                </motion.button>
                <motion.button
                  type="button"
                  aria-label="Close the editor"
                  className="note-editor-action dark"
                  whileHover={{ scale: 1.15, rotate: 90 }}
                  whileTap={{ scale: .9 }}
                  transition={ actionSpring }
                  onTapStart={ closeTap.squash }
                  onClick={ onClose }
                >
                  <motion.span animate={ closeTap.jelly } style={{ display: "inline-flex" }}>
                    <FaXmark className="note-editor-action-icon light" />
                  </motion.span>
                </motion.button>
              </div>
              <AnimatePresence>
                {
                  copied && (
                    <motion.span
                      className="note-editor-copied"
                      initial={{ opacity: 0, scale: .8, y: -6 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: .8, y: -6 }}
                      transition={{ type: "spring", stiffness: 380, damping: 20 }}
                    >
                      Copied ✦
                    </motion.span>
                  )
                }
              </AnimatePresence>
            </div>
            <input
              ref={ titleRef }
              readOnly={ note.lock }
              placeholder="Title"
              value={ draftTitle }
              onChange={ (e) => handleTitle(e.target.value) }
              className={ `note-editor-title ${ note.color }-highlight` }
            />
            {/* A little rack of tags — each pops in with an overshoot when
                pinned on, shrinks away when pulled off. Enter or a comma
                pins the current word; Backspace on an empty field pulls the
                last one back off. */}
            {
              !note.lock && (
                <div className="note-editor-tags">
                  <AnimatePresence initial={ false }>
                    {
                      tags.map((tag) => (
                        <motion.button
                          key={ tag }
                          type="button"
                          aria-label={ `Remove the ${ tag } tag` }
                          className="note-editor-tag"
                          layout
                          initial={{ opacity: 0, scale: 0, translateY: 8 }}
                          animate={{ opacity: 1, scale: 1, translateY: 0 }}
                          exit={{ opacity: 0, scale: .4, transition: { duration: .16, ease: "easeIn" } }}
                          whileHover={{ scale: 1.06 }}
                          whileTap={{ scale: .9 }}
                          transition={{ type: "spring", stiffness: 420, damping: 17 }}
                          onClick={ () => removeTag(tag) }
                        >
                          <FaTag className="note-editor-tag-icon" />
                          { tag }
                          <FaXmark className="note-editor-tag-remove" />
                        </motion.button>
                      ))
                    }
                  </AnimatePresence>
                  <input
                    ref={ tagInputRef }
                    type="text"
                    placeholder={ tags.length ? "Add another…" : "Add a tag…" }
                    value={ tagDraft }
                    onChange={ (e) => setTagDraft(e.target.value) }
                    onKeyDown={ handleTagKeyDown }
                    onBlur={ addTag }
                    className="note-editor-tag-input"
                  />
                </div>
              )
            }
            {
              isChecklist ? (
                <ChecklistBody
                  text={ draftText }
                  onChange={ handleText }
                  locked={ note.lock }
                  colorName={ note.color }
                  className="editor-checklist"
                  autoFocus={ !note.lock }
                />
              ) : isStudy ? (
                <StudyBody
                  text={ draftText }
                  onChange={ handleText }
                  locked={ note.lock }
                  className="editor-study"
                  autoFocus={ !note.lock }
                />
              ) : (
                <div className="note-editor-text-wrap">
                  <textarea
                    ref={ textRef }
                    readOnly={ note.lock }
                    placeholder={ note.placeholder }
                    value={ draftText }
                    onChange={ (e) => handleText(e.target.value) }
                    onSelect={ handleTextSelect }
                    onMouseUp={ handleTextSelect }
                    onKeyUp={ handleTextSelect }
                    onMouseMove={ (e) => hoverOverlayRef.current?.handleMouseMove(e) }
                    onMouseLeave={ () => hoverOverlayRef.current?.clearHover() }
                    className={ `note-editor-text custom-scroll ${ note.color }-highlight` }
                  ></textarea>
                  {/* A real hover affordance over the plain textarea above —
                      see HoverCitationOverlay's own comment for how a
                      native <textarea>, with no DOM node per character
                      range, can be hovered at all. Mounted (and torn down)
                      by this same ternary, note.lock included — this only
                      ever reads, never mutates, the same as the citation
                      pills' own hover-free click-to-preview. The textarea
                      above owns the real pointer events (see its own
                      z-index in NoteEditor.css) and forwards
                      mousemove/mouseleave into this component via ref,
                      since the overlay itself no longer sits on top. */}
                  <HoverCitationOverlay
                    ref={ hoverOverlayRef }
                    text={ draftText }
                    citations={ citations }
                    textareaRef={ textRef }
                  />
                </div>
              )
            }
            {/* Offered the instant a selection exists in the plain text
                above — one of three readings, in priority order. A bare
                "Genesis 1:1" already reads as a complete citation on its
                own (no parens yet) and offers a one-tap "Tag it." Text
                that falls within the sentence/clause an EXISTING citation
                is already attached to (see findPrecedingSpan) offers to
                reveal what that citation actually says instead — the
                selection didn't create this association, it's just
                recognizing one that's already there from how the citation
                sits right after its own prose. Any OTHER highlighted text
                — a sentence, a phrase, anything at all with no citation of
                its own yet — offers "Add reference," opening
                ReferencePicker to choose one and appending it as a
                trailing citation right after the highlight. */}
            <AnimatePresence>
              {
                pendingSelection && !isChecklist && !isStudy && !note.lock && (
                  <motion.div
                    className="note-editor-citation-offer"
                    initial={{ opacity: 0, scale: .9, translateY: -6 }}
                    animate={{ opacity: 1, scale: 1, translateY: 0 }}
                    exit={{ opacity: 0, scale: .9, translateY: -6, transition: { duration: .15 } }}
                    transition={{ type: "spring", stiffness: 420, damping: 22 }}
                  >
                    <FaBookBible className="note-editor-reference-icon" />
                    {
                      pendingSelection.kind === "citation" ? (
                        <>
                          <span>Tag “{ pendingSelection.text }” as a citation</span>
                          <button type="button" onClick={ tagSelectionAsCitation }>
                            Tag it
                          </button>
                        </>
                      ) : pendingSelection.kind === "linked" ? (
                        <>
                          <span>This belongs to { pendingSelection.citation.full }</span>
                          <button
                            type="button"
                            onClick={ () => { togglePreview(pendingSelection.citation); setPendingSelection(null); } }
                          >
                            Show verse
                          </button>
                        </>
                      ) : (
                        <>
                          <span>Add a scripture reference to “{ pendingSelection.text }”</span>
                          <button type="button" ref={ annotationTriggerRef } onClick={ openAnnotationPicker }>
                            Add reference
                          </button>
                        </>
                      )
                    }
                  </motion.div>
                )
              }
            </AnimatePresence>
            <ReferencePicker
              key={ annotationPickerKey }
              open={ annotationPickerOpen }
              value={ null }
              colorName={ note.color }
              anchorRef={ annotationTriggerRef }
              scriptureIndex={ scriptureIndex }
              noteCitations={ citations }
              onChange={ (reference) => { latestAnnotationRef.current = reference; } }
              onClose={ closeAnnotationPicker }
              onReturnHome={ () => { latestAnnotationRef.current = null; } }
            />
            {/* Every citation this note's own prose mentions, auto-detected
                — a table of contents for a densely cross-referenced note.
                Purely a read of the text just written, so it appears and
                updates on its own with no toggle to find.
                Each pill carries two distinct actions rather than one:
                the crosshair jumps straight to where THIS citation sits
                in this note's own text (plain-text mode only — see
                selectCitationInText), the magnifier finds every OTHER
                note mentioning the same passage. */}
            {
              citations.length > 0 && (
                <motion.div
                  className="note-editor-citations custom-scroll"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: .2 }}
                >
                  {
                    citations.map((citation) => (
                      <span key={ citation.full } className="note-editor-citation">
                        {
                          !isChecklist && !isStudy && (
                            <motion.button
                              type="button"
                              aria-label={ `Jump to ${ citation.full } in this note` }
                              title="Jump to it in this note"
                              className="note-editor-citation-jump"
                              whileHover={{ scale: 1.15 }}
                              whileTap={{ scale: .88 }}
                              transition={{ type: "spring", stiffness: 420, damping: 18 }}
                              onClick={ () => selectCitationInText(citation) }
                            >
                              <FaLocationCrosshairs />
                            </motion.button>
                          )
                        }
                        <motion.button
                          type="button"
                          aria-label={ `${ previewCitation === citation.full ? "Hide" : "Show" } what ${ citation.full } says` }
                          aria-pressed={ previewCitation === citation.full }
                          title="Preview the verse text"
                          className={ `note-editor-citation-label ${ previewCitation === citation.full ? "active" : "" }` }
                          whileTap={{ scale: .96 }}
                          transition={{ type: "spring", stiffness: 420, damping: 18 }}
                          onClick={ () => togglePreview(citation) }
                        >
                          { citation.full }
                        </motion.button>
                        <motion.button
                          type="button"
                          aria-label={ `Find every note mentioning ${ citation.full }` }
                          title="Find other notes on this passage"
                          className="note-editor-citation-search"
                          whileHover={{ scale: 1.15 }}
                          whileTap={{ scale: .88 }}
                          transition={{ type: "spring", stiffness: 420, damping: 18 }}
                          onClick={ () => onFindCitation?.(citation.full) }
                        >
                          <FaMagnifyingGlass />
                        </motion.button>
                      </span>
                    ))
                  }
                </motion.div>
              )
            }
            {/* The verse text itself, fetched live from bible-api.com only
                once a pill's own label is clicked (see togglePreview) —
                never eagerly for the whole row, both because that service
                is tightly rate-limited and because most citations in a
                dense note are never actually re-read once written. A
                three-number citation (this app's own chapter:verse:
                subverse shorthand, see isFetchablePath) has no real
                reference to look up at all, so it says so rather than
                guessing at a verse that might not be the one meant. */}
            <AnimatePresence>
              {
                previewCitation && (
                  <motion.div
                    className="note-editor-citation-preview"
                    initial={{ opacity: 0, scale: .96, height: 0 }}
                    animate={{ opacity: 1, scale: 1, height: "auto" }}
                    exit={{ opacity: 0, scale: .96, height: 0, transition: { duration: .15 } }}
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  >
                    <div className="note-editor-citation-preview-head">
                      <FaBookOpen className="note-editor-citation-preview-icon" />
                      <span>{ previewCitation }</span>
                      <button
                        type="button"
                        aria-label="Close preview"
                        className="note-editor-citation-preview-close"
                        onClick={ () => togglePreview({ full: previewCitation }) }
                      >
                        <FaXmark />
                      </button>
                    </div>
                    <div className="note-editor-citation-preview-body custom-scroll">
                      {
                        previewResult?.status === "loading" ? (
                          <span className="note-editor-citation-preview-muted">Looking it up…</span>
                        ) : previewResult?.status === "unsupported" ? (
                          <span className="note-editor-citation-preview-muted">
                            The third number here is this app's own shorthand, not a standard verse — no text to look up.
                          </span>
                        ) : previewResult?.status === "error" ? (
                          <span className="note-editor-citation-preview-muted">{ previewResult.message || "Couldn't load this verse." }</span>
                        ) : (
                          <p>{ previewResult?.text }</p>
                        )
                      }
                    </div>
                  </motion.div>
                )
              }
            </AnimatePresence>
            <div className="note-editor-footer">
              <div className="note-editor-footer-left">
                <span className="note-editor-date">{ note.time }</span>
                <AnimatePresence>
                  {
                    !draftText.trim() && (
                      <motion.button
                        key="quote"
                        type="button"
                        aria-label="Deal a new inspiration quote"
                        className="note-editor-quote"
                        initial={{ opacity: 0, scale: .8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: .8 }}
                        whileHover={{ scale: 1.08 }}
                        whileTap={{ scale: .92 }}
                        transition={{ type: "spring", stiffness: 420, damping: 18 }}
                        onClick={ () => updateQuote(note.id) }
                      >
                        <FaShuffle className="note-editor-quote-icon" />
                        new quote
                      </motion.button>
                    )
                  }
                </AnimatePresence>
                <AnimatePresence>
                  {
                    due && (
                      <motion.span
                        key="dueChip"
                        className={ `note-editor-due-chip ${ due.urgency }` }
                        initial={{ opacity: 0, scale: .7 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: .7 }}
                        transition={{ type: "spring", stiffness: 420, damping: 18 }}
                      >
                        { due.text }
                        <button
                          type="button"
                          aria-label="Clear this reminder"
                          className="note-editor-due-clear"
                          onClick={ () => setNoteDueDate(null, note.id) }
                        >
                          <FaXmark />
                        </button>
                      </motion.span>
                    )
                  }
                </AnimatePresence>
              </div>
              {
                !isChecklist && !isStudy && (
                  <div className="note-editor-meta">
                    <motion.span
                      key={ words }
                      className="note-editor-count"
                      initial={{ scale: .75, y: 2 }}
                      animate={{ scale: 1, y: 0 }}
                      transition={{ type: "spring", stiffness: 500, damping: 18 }}
                    >
                      { words } { words === 1 ? "word" : "words" }
                    </motion.span>
                    <span className="note-editor-count muted">{ draftText.length } chars</span>
                  </div>
                )
              }
            </div>
          </motion.div>
        </motion.div>
      </motion.div>
      <DueDatePicker
        open={ dueCalendarOpen }
        value={ note.dueAt }
        colorName={ note.color }
        anchorRef={ remindBtnRef }
        onChange={ (date) => { setNoteDueDate(date, note.id); setDueCalendarOpen(false); } }
        onClose={ () => setDueCalendarOpen(false) }
      />
      <ColorPicker
        open={ colorPickerOpen }
        value={ note.color }
        anchorRef={ colorBtnRef }
        onChange={ (name) => { setNoteColor(name, note.id); setColorPickerOpen(false); } }
        onClose={ () => setColorPickerOpen(false) }
      />
      {
        createPortal(
          <AnimatePresence>
            {
              copyGhost && (
                <motion.span
                  key={ copyGhost.key }
                  className={ `note-editor-copy-ghost ${ note.color }-bg` }
                  initial={{ x: copyGhost.fromX, y: copyGhost.fromY, opacity: .95, scale: 1, rotate: 0 }}
                  animate={{ x: copyGhost.toX, y: copyGhost.toY, opacity: 0, scale: .3, rotate: 18 }}
                  transition={{ duration: .55, ease: "easeIn" }}
                  onAnimationComplete={ () => setCopyGhost((prev) => (prev?.key === copyGhost.key ? null : prev)) }
                />
              )
            }
          </AnimatePresence>,
          document.body,
        )
      }
    </div>
  );
};

export default NoteEditor;
