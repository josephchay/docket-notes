"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from "framer-motion";
import {
  FaArrowUp,
  FaPlus,
  FaShuffle,
  FaMoon,
  FaSun,
  FaFileArrowDown,
  FaRotateLeft,
  FaMagnifyingGlass,
  FaQuestion,
  FaChartLine,
  FaChartSimple,
  FaClockRotateLeft,
  FaArrowRotateRight,
  FaCompress,
  FaHourglassHalf,
  FaClapperboard,
  FaLock,
  FaLockOpen,
  FaTrashCan,
  FaTimeline,
  FaGear,
  FaLayerGroup,
  FaCompass,
  FaMeteor,
  FaDroplet,
  FaWaveSquare,
  FaWater,
  FaFlag,
  FaCircleNodes,
} from "react-icons/fa6";

import { id } from "../utils/math";
import { formattedDateNow } from "../utils/date";
import { randomQuote } from "../utils/data";
import { loadNotes, saveNotes, loadSettings, saveSettings, getPersistPref, setPersistPref } from "../utils/storage";
import {
  setSoundEnabled as setSoundEngineEnabled,
  playSpawn,
  playThemeToggle,
  playStamp,
  playMilestone,
  playHistoryAction,
} from "../utils/sound";
import { NOTE_COLORS } from "../constants/colors";
import { MILESTONES } from "../constants/milestones";
import Navigation from "../components/Navigation/Navigation";
import GooeyEffectSvg from "../components/Svg/GooeyEffectSvg";
import LiquidTextFilter from "../components/Svg/LiquidTextFilter";
import Header from "../components/Header/Header";
import NoteList from "../components/List/NoteList";
import NoteEditor from "../components/Editor/NoteEditor";
import UndoToast from "../components/Toast/UndoToast";
import CommandPalette from "../components/Command/CommandPalette";
import ThemeWipe from "../components/Theme/ThemeWipe";
import InkCelebration from "../components/Celebration/InkCelebration";
import ShortcutsSheet, { SHORTCUTS_EVENT } from "../components/Shortcuts/ShortcutsSheet";
import TourGuide, { TOUR_EVENT } from "../components/Tour/TourGuide";
import ShotReplay, { REPLAY_EVENT } from "../components/Replay/ShotReplay";
import BulkActionBar from "../components/Bulk/BulkActionBar";
import InsightsPanel, { INSIGHTS_EVENT } from "../components/Insights/InsightsPanel";
import InkLevelsPanel, { INK_LEVELS_EVENT } from "../components/Header/InkLevelsPanel";
import TrashPanel, { TRASH_EVENT } from "../components/Trash/TrashPanel";
import HistoryPanel, { HISTORY_EVENT } from "../components/History/HistoryPanel";
import SettingsPanel, { SETTINGS_EVENT } from "../components/Settings/SettingsPanel";
import usePrefersReducedMotion from "../hooks/usePrefersReducedMotion";
import ActionStamp from "../components/Stamp/ActionStamp";
import ScrollProgress from "../components/Scroll/ScrollProgress";
import DropZoneOverlay from "../components/DropZone/DropZoneOverlay";
import SprintPanel, { SPRINT_EVENT } from "../components/Sprint/SprintPanel";
import QuickDock from "../components/Dock/QuickDock";
import AmbientField from "../components/Ambient/AmbientField";
import GravityFieldPanel, { GRAVITY_FIELD_EVENT } from "../components/Particles/GravityFieldPanel";
import FluidFieldPanel, { FLUID_FIELD_EVENT } from "../components/Particles/FluidFieldPanel";
import AudioWaveStringPanel, { AUDIO_WAVE_STRING_EVENT } from "../components/Particles/AudioWaveStringPanel";
import FluidVisualizerPanel, { FLUID_VISUALIZER_EVENT } from "../components/Particles/FluidVisualizerPanel";
import FluidPlayerDock from "../components/Particles/FluidPlayerDock";
import ClothPanel, { CLOTH_EVENT } from "../components/Particles/ClothPanel";
import NoteConstellationPanel, { NOTE_CONSTELLATION_EVENT } from "../components/Constellation/NoteConstellationPanel";
import useLenisScroll from "../hooks/useLenisScroll";

import quotes from "../assets/data/quotes.json";

import "./Home.css";

// Note shape:
// {
//   id: string,
//   title: string,
//   text: string,
//   placeholder: string,
//   time: string,
//   color: string,
//   favorite: boolean,
//   lock: boolean,
//   tags: string[]
// }

// DeletedEntry shape:
// {
//   note: Note,
//   index: number,
//   deletedAt: number,   // Date.now() at the moment of deletion
//   dismissed: boolean   // no longer shown in the toast deck; still in the trash
// }

const Home = () => {
  // Notes live in sessionStorage by default — surviving reloads within this
  // tab, resetting when it closes — or in localStorage if the visitor has
  // opted into remembering across sessions (persistNotes below). The list
  // starts empty and is hydrated in an effect so SSR never touches storage.
  const [notes, setNotes] = useState([]);
  const [hydrated, setHydrated] = useState(false);

  const [notesSortText, setNotesSortText] = useState("");
  const [notesSortByFavorite, setNotesSortByFavorite] = useState(false);
  const [notesSortColor, setNotesSortColor] = useState(null);
  const [notesSortTag, setNotesSortTag] = useState(null);

  // Fresh paper or the Ink theme — kept alongside the notes, in whichever
  // store the persist preference below currently points at.
  const [theme, setTheme] = useState("light");

  // Off by default: notes and settings live in sessionStorage and clear the
  // moment this tab closes. Flipping it on moves the exact same reads and
  // writes over to localStorage instead (see storage.js) — the choice
  // itself always lives in localStorage regardless, so it's still known
  // the next time the visitor opens a fresh tab.
  const [persistNotes, setPersistNotesFlag] = useState(false);

  const togglePersistNotes = () => {
    setPersistNotesFlag((prev) => {
      const next = !prev;
      setPersistPref(next);

      // Carry this tab's current notes and settings over to whichever
      // store just became active, rather than leaving them stranded in the
      // old one until the next unrelated edit happens to re-save them.
      saveNotes(notes);
      saveSettings({ theme });

      showStamp(
        next
          ? "Notes will now stick around after you close this tab"
          : "Notes will clear when you close this tab, like before"
      );

      return next;
    });
  }

  // The drop of ink that washes over the desk when the theme flips — see
  // ThemeWipe. Cleared once the wash has finished playing.
  const [wipe, setWipe] = useState(null);
  const THEME_BG = { light: "#fffeff", dark: "#161616" };

  const toggleTheme = (origin) => {
    playThemeToggle();
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      saveSettings({ theme: next });

      if (origin) {
        const wipeId = id();
        setWipe({ key: wipeId, x: origin.x, y: origin.y, color: THEME_BG[next] });
        setTimeout(() => {
          setWipe((current) => (current?.key === wipeId ? null : current));
        }, 950);
      }

      return next;
    });
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // The OS-level preference always wins; this only ever adds reduction on
  // top of it — never something an app-level toggle should be able to
  // defeat. Previously lived entirely inside the History panel (visible,
  // and controllable, only while that one panel happened to be open) —
  // promoted up here so it's a real, always-reachable setting like theme
  // and persistNotes, surfaced in SettingsPanel.jsx.
  const systemReducedMotion = usePrefersReducedMotion();
  const [manualReduceMotion, setManualReduceMotion] = useState(false);
  const reduceMotion = systemReducedMotion || manualReduceMotion;

  const toggleReduceMotion = () => {
    setManualReduceMotion((prev) => {
      const next = !prev;
      saveSettings({ reduceMotion: next });
      return next;
    });
  };

  // Soft ink/paper cues on a handful of key actions (see utils/sound.js) —
  // silent by default, since a visitor has never heard sound from this app
  // before and defaulting it on would just surprise people mid-session.
  const [soundEnabled, setSoundEnabled] = useState(false);

  const toggleSound = () => {
    setSoundEnabled((prev) => {
      const next = !prev;
      saveSettings({ soundEnabled: next });
      return next;
    });
  };

  useEffect(() => {
    setSoundEngineEnabled(soundEnabled);
  }, [soundEnabled]);

  // Milestone note counts already celebrated this session — seeded from
  // whatever the desk already held on load, so restoring a big session
  // never replays a shower for ground already covered.
  const celebratedRef = useRef(new Set());
  const [celebration, setCelebration] = useState(null);

  // Whether the desk has ever held a note this session — so the "clean
  // desk" moment only plays on the 1→0 edge, not on the very first render
  // of an empty session.
  const everHadNotesRef = useRef(false);
  const [deskCleared, setDeskCleared] = useState(0);

  // Hydrate the persist choice first — loadNotes/loadSettings below read
  // whichever store it points at — then the notes and settings themselves.
  useEffect(() => {
    setPersistNotesFlag(getPersistPref());

    const stored = loadNotes();
    if (stored.length > 0) setNotes(stored);

    celebratedRef.current = new Set(MILESTONES.filter((m) => m <= stored.length));
    everHadNotesRef.current = stored.length > 0;

    const settings = loadSettings();
    if (settings.theme === "dark" || settings.theme === "light") {
      setTheme(settings.theme);
    }
    if (typeof settings.reduceMotion === "boolean") {
      setManualReduceMotion(settings.reduceMotion);
    }
    if (typeof settings.soundEnabled === "boolean") {
      setSoundEnabled(settings.soundEnabled);
    }

    setHydrated(true);
  }, []);

  // A fresh note crossing a milestone count sends a shower of ink over the
  // desk — each threshold fires exactly once per session, the moment the
  // count lands on it.
  useEffect(() => {
    if (!hydrated) return;

    const hit = MILESTONES.find((m) => m === notes.length && !celebratedRef.current.has(m));
    if (!hit) return;

    celebratedRef.current.add(hit);
    playMilestone();

    const celebrationId = id();
    setCelebration({ key: celebrationId, count: hit });
    setTimeout(() => {
      setCelebration((current) => (current?.key === celebrationId ? null : current));
    }, 1900);
  }, [notes.length, hydrated]);

  // The desk going from at-least-one note to none at all gets its own
  // quieter moment — the empty state's gooey blobs bloom bigger for a beat.
  // Bumping a counter (rather than a boolean) lets it fire again every time
  // the desk is fully cleared, not just once per session.
  useEffect(() => {
    if (!hydrated) return;

    if (notes.length === 0 && everHadNotesRef.current) {
      everHadNotesRef.current = false;
      setDeskCleared((n) => n + 1);
    } else if (notes.length > 0) {
      everHadNotesRef.current = true;
    }
  }, [notes.length, hydrated]);

  // Mirror every change back into storage — but only after hydration, so
  // the initial empty list never overwrites what was already there.
  useEffect(() => {
    if (!hydrated) return;
    saveNotes(notes);
  }, [notes, hydrated]);

  // The scrollable page, and the ink ball that floats back up it.
  const homeRef = useRef(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  const handleScroll = (e) => {
    const show = e.currentTarget.scrollTop > 600;
    setShowScrollTop((prev) => (prev === show ? prev : show));
  }

  // Focus mode slides the nav rail and toolbar away with a bouncy spring,
  // leaving just the notes. The dedicated floating exit button (rendered
  // below, outside the header it hides) is what keeps a way back always
  // reachable regardless of what's currently slid off-screen.
  const [focusMode, setFocusMode] = useState(false);
  const toggleFocusMode = () => setFocusMode((prev) => !prev);

  // Tosses the visible desk into a real, physically-simulated pile (see
  // NotePile.jsx) — a decorative, opt-in view with no reduced-motion
  // variant, so the toggle itself only ever surfaces when motion is on.
  const [pileView, setPileView] = useState(false);
  const togglePileView = () => setPileView((prev) => !prev);

  // Every note deleted this session, oldest first, and where each sat —
  // this desk's whole trash, not capped and never auto-expired on its own.
  // Two views read it: the toast deck below only ever shows the freshest
  // few, undismissed ones (see visibleDeleted), while the Trash panel
  // (TrashPanel.jsx) shows the lot. `dismissed` marks an entry whose toast
  // has run its course or been swiped away — it stays in the trash either
  // way, just stops competing for room in the toast deck.
  const [deletedNotes, setDeletedNotes] = useState([]);

  // Which note is stretched open in the focus editor, if any.
  const [editingNoteId, setEditingNoteId] = useState(null);

  // Select mode: a checkmark badge blooms onto every note, tapping toggles
  // it into the selection instead of doing nothing, and the bulk action bar
  // morphs up the moment the first one is picked.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const toggleSelectMode = () => {
    setSelectMode((prev) => !prev);
    setSelectedIds(new Set());
  }

  // Unlike toggleSelectMode above, guaranteed to actually be ON afterward
  // rather than flipping whatever it currently is — what the lasso (see
  // NoteList.jsx) needs the moment a drag crosses its move threshold,
  // since a lasso started while already in select mode shouldn't
  // accidentally turn it back off.
  const enterSelectMode = useCallback(() => {
    setSelectMode(true);
  }, []);

  const toggleSelectNote = useCallback((noteId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }, []);

  // A wholesale replace rather than a toggle — the lasso recomputes which
  // notes it currently covers on every pointer move and hands the whole
  // set over each time, so a note that drifts back out of the rectangle
  // correctly falls back out of the selection instead of staying stuck in
  // (which toggling per-note couldn't express as the rectangle shrinks).
  const setSelection = useCallback((ids) => {
    setSelectedIds(new Set(ids));
  }, []);

  const endSelection = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  // Selects (or deselects) every currently-visible note — staggered rather
  // than all at once, so the checkmarks bloom across the grid as a wave
  // rather than popping in a single flat instant. Reuses each note's own
  // existing select-badge pop-in animation; nothing in Note.jsx needs to
  // know this was a bulk action rather than an individual tap.
  const selectAllVisible = () => {
    const allSelected = filteredNotes.length > 0 && filteredNotes.every((note) => selectedIds.has(note.id));

    if (allSelected) {
      filteredNotes.forEach((note, index) => {
        setTimeout(() => {
          setSelectedIds((prev) => {
            const next = new Set(prev);
            next.delete(note.id);
            return next;
          });
        }, index * 18);
      });
      return;
    }

    filteredNotes.forEach((note, index) => {
      setTimeout(() => {
        setSelectedIds((prev) => new Set(prev).add(note.id));
      }, index * 22);
    });
  }

  // Every bulk action reads the current selection off one shared `notes`
  // snapshot and writes the whole array back in a single setNotes call —
  // calling the single-note updaters once per id would each start from the
  // same stale snapshot and clobber one another.
  const bulkStar = () => {
    const allFavorited = notes.every((note) => !selectedIds.has(note.id) || note.favorite);
    pushUndo("starred the selection");
    setNotes((prev) => prev.map((note) =>
      selectedIds.has(note.id) ? { ...note, favorite: !allFavorited } : note
    ));
  }

  const bulkRecolor = () => {
    const palette = Object.keys(NOTE_COLORS);
    pushUndo("recolored the selection");
    setNotes((prev) => prev.map((note) => {
      if (!selectedIds.has(note.id)) return note;
      const nextIndex = (palette.indexOf(note.color) + 1) % palette.length;
      return { ...note, color: palette[nextIndex] };
    }));
  }

  const bulkExport = () => {
    const selected = notes.filter((note) => selectedIds.has(note.id));
    if (selected.length === 0) return;

    const blob = new Blob([JSON.stringify(selected, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `docket-selection-${ new Date().toISOString().slice(0, 10) }.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    showStamp(`Backup saved · ${ selected.length } ${ selected.length === 1 ? "note" : "notes" }`);
  }

  const bulkDelete = () => {
    const toDelete = notes.filter((note) => selectedIds.has(note.id));
    if (toDelete.length === 0) return;

    pushUndo("deleted the selection");
    setDeletedNotes((prev) => [
      ...prev.filter((entry) => !selectedIds.has(entry.note.id)),
      ...toDelete.map((note) => ({
        note,
        index: notes.findIndex((n) => n.id === note.id),
        deletedAt: Date.now(),
        dismissed: false,
      })),
    ]);
    setNotes((prev) => prev.filter((note) => !selectedIds.has(note.id)));

    if (editingNoteId && selectedIds.has(editingNoteId)) setEditingNoteId(null);

    setSelectedIds(new Set());
    setSelectMode(false);
  }

  const toggleSortByFavorite = () => {
    setNotesSortByFavorite(!notesSortByFavorite);
  }

  // One motion to lift every lens off the desk at once — search text,
  // the star, and the color filter.
  const clearFilters = useCallback(() => {
    setNotesSortText("");
    setNotesSortByFavorite(false);
    setNotesSortColor(null);
    setNotesSortTag(null);
  }, []);

  // Every tag in use across the desk, for the tag filter strip — sorted so
  // the strip doesn't reshuffle itself as notes come and go.
  const allTags = useMemo(() => {
    const set = new Set();
    notes.forEach((note) => (note.tags || []).forEach((tag) => set.add(tag)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [notes]);

  // How the desk lays its papers out: freshest first, grouped by ink color,
  // or with the starred ones brought to the front. Switching modes lets the
  // notes' layout springs fly everything to its new spot.
  const [sortMode, setSortMode] = useState("fresh");

  // A quick riffle of the whole desk — the layout springs turn the new
  // random order into a bouncy mid-air reshuffle.
  const shuffleNotes = () => {
    pushUndo("shuffled the desk");
    playHistoryAction("shuffled");
    setSortMode("fresh");
    setNotes((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j], next[i]];
      }
      return next;
    });
  }

  // Every lens over the list — search text, starred, color — stacks here.
  // Newest notes first, same as the desk renders them.
  const filteredNotes = useMemo(() => {
    const query = notesSortText.trim().toLowerCase();
    let filtered = [...notes].reverse();

    if (query) {
      filtered = filtered.filter((note) =>
        `${ note.title ?? "" } ${ note.text }`.toLowerCase().includes(query)
      );
    }

    if (notesSortByFavorite) {
      filtered = filtered.filter((note) => note.favorite);
    }

    if (notesSortColor) {
      filtered = filtered.filter((note) => note.color === notesSortColor);
    }

    if (notesSortTag) {
      filtered = filtered.filter((note) => (note.tags || []).includes(notesSortTag));
    }

    if (sortMode === "color") {
      const order = Object.keys(NOTE_COLORS);
      filtered = [...filtered].sort((a, b) => order.indexOf(a.color) - order.indexOf(b.color));
    } else if (sortMode === "starred") {
      filtered = [...filtered].sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));
    }

    return filtered;
  }, [notes, notesSortText, notesSortByFavorite, notesSortColor, notesSortTag, sortMode]);

  // Starred notes' rough position within the currently-filtered list, fed
  // to ScrollProgress as quick-jump tick marks — index/total is an honest
  // approximation (notes wrap in a flex grid, so there's no simple
  // function from list position to real scroll offset), not a claim of
  // pixel accuracy.
  const scrollMarkers = useMemo(() => {
    if (filteredNotes.length <= 1) return [];
    return filteredNotes
      .map((note, index) => (note.favorite ? index / (filteredNotes.length - 1) : null))
      .filter((ratio) => ratio !== null);
  }, [filteredNotes]);

  // The dot a fresh note should morph out of: the ink pot that was tapped,
  // or the nav activator for keyboard-born notes. Cleared once the morph
  // has played.
  const [spawn, setSpawn] = useState(null);
  const clearSpawn = useCallback(() => setSpawn(null), []);

  const addNote = (color, origin) => {
    const noteId = id();
    const newNotes = [...notes];

    newNotes.push({
      id: noteId,
      title: "",
      text: "",
      placeholder: randomQuote(quotes),
      time: formattedDateNow(),
      color,
      favorite: false,
      lock: false,
      tags: [],
    });

    pushUndo("poured a new note");
    setNotes(newNotes);
    playSpawn();

    let spawnOrigin = origin;
    if (!spawnOrigin) {
      const activator = document.getElementById("navActivator");
      if (activator) {
        const rect = activator.getBoundingClientRect();
        spawnOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
    }
    setSpawn(spawnOrigin ? { id: noteId, ...spawnOrigin } : null);

    // New notes land at the front of the list — bring the desk back up to it.
    scrollHomeToTop();
  }

  const deleteNote = (noteId) => {
    const index = notes.findIndex((note) => note.id === noteId);
    if (index === -1) return;

    pushUndo("deleted a note");
    setDeletedNotes((prev) => [
      ...prev.filter((entry) => entry.note.id !== noteId),
      { note: notes[index], index, deletedAt: Date.now(), dismissed: false },
    ]);
    setNotes(notes.filter((note) => note.id !== noteId));

    if (editingNoteId === noteId) setEditingNoteId(null);
  }

  // Brings a note back — called from the toast's Undo button or from the
  // Trash panel, whichever still has it. Either way it leaves the trash
  // for good, restored to as close to its old spot as the desk allows.
  const restoreNote = (noteId) => {
    const entry = deletedNotes.find((item) => item.note.id === noteId);
    if (!entry) return;

    pushUndo("restored a note");
    playHistoryAction("restored");
    setNotes((prev) => {
      if (prev.some((note) => note.id === entry.note.id)) return prev;

      const next = [...prev];
      next.splice(Math.min(entry.index, next.length), 0, entry.note);
      return next;
    });
    setDeletedNotes((prev) => prev.filter((item) => item.note.id !== noteId));
  }

  // The toast's own timer (or a swipe) retiring it from the toast deck —
  // the note stays in the trash regardless, just stops competing for one
  // of the few slots the toast deck shows at once. Purely a display flag,
  // not a content change, so it deliberately doesn't push its own history
  // entry — and stays a stable useCallback since UndoToast's own dismiss
  // timer depends on this reference not changing every render.
  const dismissUndo = useCallback((noteId) => {
    setDeletedNotes((prev) => prev.map((entry) =>
      entry.note.id === noteId ? { ...entry, dismissed: true } : entry
    ));
  }, []);

  // Gone for good, skipping the desk entirely — the Trash panel's shred.
  const shredNote = (noteId) => {
    pushUndo("shredded a note");
    playHistoryAction("shredded");
    setDeletedNotes((prev) => prev.filter((entry) => entry.note.id !== noteId));
  };

  const emptyTrash = () => {
    if (deletedNotes.length === 0) return;
    pushUndo("emptied the trash");
    playHistoryAction("emptied");
    setDeletedNotes([]);
  };

  // Only the freshest few, undismissed deletes get a toast — the Trash
  // panel is where the rest (and these, once their moment passes) live on.
  const visibleDeleted = useMemo(
    () => deletedNotes.filter((entry) => !entry.dismissed).slice(-3),
    [deletedNotes]
  );

  // The copy lands right beside its source in the grid, starting unstarred —
  // and, reusing the same spawn morph a fresh note plays, peels out from the
  // original's own position instead of just fading in in its new slot.
  const duplicateNote = (noteId) => {
    const sourceRect = document.querySelector(`[data-note-id="${ noteId }"]`)?.getBoundingClientRect();
    const copyId = id();

    pushUndo("duplicated a note");
    playHistoryAction("duplicated");
    setNotes((prev) => {
      const index = prev.findIndex((note) => note.id === noteId);
      if (index === -1) return prev;

      const copy = {
        ...prev[index],
        id: copyId,
        time: formattedDateNow(),
        favorite: false,
      };

      const next = [...prev];
      next.splice(index + 1, 0, copy);
      return next;
    });

    if (sourceRect) {
      setSpawn({
        id: copyId,
        x: sourceRect.left + sourceRect.width / 2,
        y: sourceRect.top + sourceRect.height / 2,
        duplicate: true,
      });
    }
  }

  // A general undo covering the whole desk — every content-changing action
  // (pouring, editing, deleting, restoring, shredding, importing,
  // recoloring, starring, locking, tagging, shuffling, moving, duplicating,
  // the bulk actions, all of it) pushes a snapshot here, and jumpTo below
  // restores the desk AND the trash together so the two can never drift out
  // of sync with each other while scrubbing. Typing (title/text)
  // deliberately doesn't push its own snapshot: it's debounced and
  // continuous, so tracking every committed keystroke would flood the stack
  // and undo would only ever step back a character or two — "just keep
  // typing" is the real undo there. Deletes used to live on a separate,
  // untracked path from this stack; they (and restoring/shredding/emptying
  // the trash) now push the same way everything else does, so the History
  // panel is a complete record instead of missing whatever happened to be
  // routed through the trash.
  //
  // undoStack and redoStack are state (not refs) so the History panel can
  // actually render them. The two combine into one chronological timeline
  // — everything undoStack remembers, wherever the desk sits right now,
  // then everything still queued up in redoStack — which is what jumpTo
  // below actually operates on: one function that lands anywhere on that
  // line in a single step, whether that's one Ctrl+Z or the History
  // panel's scrub landing several stops away at once. cursor is always
  // exactly undoStack.length; nothing separately tracks "where we are."
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);

  // Every redo branch a fresh edit has ever forked away from, kept instead
  // of thrown out — pushUndo below used to just setRedoStack([]) and let
  // whatever was queued up ahead vanish for good the moment anything new
  // was done. Each entry freezes exactly what's needed to jump straight
  // back to that fork and pick the abandoned branch back up: the desk as it
  // stood right at the fork (forkNotes/forkDeletedNotes), and the stacks on
  // either side of it as they stood then. Capped the same way undoStack is.
  const [branchStash, setBranchStash] = useState([]);

  // Shared by pushUndo and restoreBranch below — whichever redoStack is
  // about to be overwritten gets saved first, if there was anything in it.
  const stashCurrentBranch = (prevStash) => {
    if (redoStack.length === 0) return prevStash;
    return [...prevStash, {
      id: id(),
      label: redoStack[redoStack.length - 1].label,
      at: Date.now(),
      forkNotes: notes,
      forkDeletedNotes: deletedNotes,
      undoStack: [...undoStack],
      redoStack: [...redoStack],
    }].slice(-10);
  }

  const pushUndo = (label) => {
    setBranchStash(stashCurrentBranch);
    setUndoStack((prev) => [...prev, { notes, deletedNotes, label, at: Date.now() }].slice(-20));
    setRedoStack([]);   // a fresh edit forks away from any undone branch
  }

  // Jumps back to exactly where a stashed branch forked off, with its
  // abandoned future reattached as the live redoStack again — a real undo/
  // redo swap, not a separate data model, so everything downstream (the
  // History panel's rail, playback, pin/compare) keeps working unchanged.
  // Whatever branch was live before this swap is itself stashed first, the
  // same way pushUndo stashes one, so restoring one branch never silently
  // drops another.
  const restoreBranch = (stashId) => {
    const stash = branchStash.find((b) => b.id === stashId);
    if (!stash) return;

    setBranchStash((prev) => stashCurrentBranch(prev.filter((b) => b.id !== stashId)));
    setUndoStack([...stash.undoStack, { notes, deletedNotes, label: "restored a branch", at: Date.now() }]);
    setRedoStack(stash.redoStack);
    setNotes(stash.forkNotes);
    setDeletedNotes(stash.forkDeletedNotes);

    showStamp(`Restored branch: ${ stash.label }`);
  }

  // redoStack stores nearest-future last (performRedo below pops off its
  // end), so reading it forward in time means reversing it first.
  const timeline = useMemo(
    () => [...undoStack, { notes, deletedNotes, label: "now", at: null }, ...[...redoStack].reverse()],
    [undoStack, redoStack, notes, deletedNotes]
  );
  const cursor = undoStack.length;

  // The synthetic "now" marker above (timeline[cursor], fresh every render)
  // always carries a placeholder label:"now"/at:null — "now" isn't a real
  // pushUndo'd entry, so it never earned a real one. Jumping away from it
  // freezes it into a genuine stack entry (redoStack going backward,
  // undoStack going forward); left untouched, that placeholder leaked
  // straight into history — every tick/row that read the frozen entry as
  // its own arrival showed "Now" as its label and, since `at: null`
  // coerces to epoch 0 in timeAgo's subtraction, something like "20666d
  // ago" as its time. Patched here, the one moment real data to describe
  // it is still around: going backward, the edit that turned the live
  // state into what's being frozen is exactly the label the last real undo
  // entry already carries; going forward, it's exactly the label the
  // nearest real redo entry already carries — both already describe that
  // same transition, by the same "entry i's label describes i→i+1" rule
  // every other real entry here already follows. Once patched, that entry
  // is real, correctly-labeled, and never touched again by a later jump.
  const jumpTo = (targetIndex) => {
    const clamped = Math.max(0, Math.min(targetIndex, timeline.length - 1));
    if (clamped === cursor) return;

    const frozenNow = {
      notes,
      deletedNotes,
      label: clamped < cursor
        ? undoStack[undoStack.length - 1].label
        : redoStack[redoStack.length - 1].label,
      at: Date.now(),
    };
    const withFrozenNow = [...timeline.slice(0, cursor), frozenNow, ...timeline.slice(cursor + 1)];

    setUndoStack(withFrozenNow.slice(0, clamped));
    setRedoStack([...withFrozenNow.slice(clamped + 1)].reverse());
    setNotes(timeline[clamped].notes);
    setDeletedNotes(timeline[clamped].deletedNotes);
  }

  const performUndo = () => {
    if (cursor === 0) return;
    showStamp(`Undid: ${ timeline[cursor - 1].label }`);
    jumpTo(cursor - 1);
  }

  const performRedo = () => {
    if (cursor >= timeline.length - 1) return;
    showStamp(`Redid: ${ timeline[cursor + 1].label }`);
    jumpTo(cursor + 1);
  }

  useEffect(() => {
    const handleKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.target instanceof Element && e.target.closest("input, textarea")) return;

      if (e.key === "y" || e.key === "Y") {
        e.preventDefault();
        performRedo();
      } else if (e.key === "z" || e.key === "Z") {
        e.preventDefault();
        if (e.shiftKey) performRedo();
        else performUndo();
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  const updateTitle = (title, id) => {
    const newNotes = notes.map((note) =>
      note.id === id ? { ...note, title } : note
    );
    setNotes(newNotes);
  }

  const updateText = (text, id) => {
    const newNotes = notes.map((note) =>
      note.id === id ? { ...note, text } : note
    );
    setNotes(newNotes);
  }

  const updateColor = (id) => {
    pushUndo("recolored a note");
    playHistoryAction("recolored");
    const palette = Object.keys(NOTE_COLORS);

    const newNotes = notes.map((note) => {
      if (note.id !== id) return note;

      const nextIndex = (palette.indexOf(note.color) + 1) % palette.length;
      return { ...note, color: palette[nextIndex] };
    });

    setNotes(newNotes);
  }

  // Paint a note a specific color — the focus editor's palette picks
  // directly instead of cycling.
  const setNoteColor = (color, noteId) => {
    pushUndo("recolored a note");
    playHistoryAction("recolored");
    const newNotes = notes.map((note) =>
      note.id === noteId ? { ...note, color } : note
    );
    setNotes(newNotes);
  }

  // Pours every note of one color into another — the whole-color
  // counterpart to setNoteColor's single note, driven by the ink-levels
  // panel's own vial-onto-vial decant gesture (see InkLevelsPanel.jsx).
  // Undoable like every other bulk action; a no-op (no undo entry, no
  // stamp) when the source color is empty, so a stray drag never pushes a
  // meaningless step onto the history.
  const decantColor = (fromColor, toColor) => {
    if (fromColor === toColor) return;

    const moved = notes.filter((note) => note.color === fromColor).length;
    if (moved === 0) return;

    pushUndo(`decanted ${ fromColor } into ${ toColor }`);
    playHistoryAction("recolored");
    setNotes((prev) => prev.map((note) => (
      note.color === fromColor ? { ...note, color: toColor } : note
    )));
    showStamp(`${ moved } ${ moved === 1 ? "note" : "notes" } · ${ fromColor } → ${ toColor }`);
  }

  const reorderNotes = (sourceId, targetId) => {
    if (sourceId === targetId) return;

    pushUndo("moved a note");
    playHistoryAction("moved");
    setNotes((prev) => {
      const next = [...prev];
      const from = next.findIndex((note) => note.id === sourceId);
      const to = next.findIndex((note) => note.id === targetId);

      if (from === -1 || to === -1) return prev;

      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }

  const updateFavourite = (id) => {
    pushUndo("starred a note");
    const newNotes = notes.map((note) =>
      note.id === id ? { ...note, favorite: !note.favorite } : note
    );
    setNotes(newNotes);
  }

  const updateLock = (id) => {
    pushUndo("locked a note");
    playHistoryAction("locked");
    const newNotes = notes.map((note) =>
      note.id === id ? { ...note, lock: !note.lock } : note
    );
    setNotes(newNotes);
  }

  const updateTags = (tags, id) => {
    pushUndo("edited a tag");
    playHistoryAction("tagged");
    const newNotes = notes.map((note) =>
      note.id === id ? { ...note, tags } : note
    );
    setNotes(newNotes);
  }

  // A quick ink stamp confirming an export or import actually happened —
  // export and import are otherwise silent, and silently doing nothing
  // (an empty file, a backup with nothing importable) reads the same as
  // working correctly unless something says so.
  const [stamp, setStamp] = useState(null);

  const showStamp = (text) => {
    playStamp();
    const stampId = id();
    setStamp({ key: stampId, text });
    setTimeout(() => {
      setStamp((current) => (current?.key === stampId ? null : current));
    }, 2200);
  }

  // Save the whole desk as a JSON backup the visitor can keep or move.
  const exportNotes = () => {
    const blob = new Blob([JSON.stringify(notes, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `docket-notes-${ new Date().toISOString().slice(0, 10) }.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    showStamp(`Backup saved · ${ notes.length } ${ notes.length === 1 ? "note" : "notes" }`);
  }

  // Pour a backup file back onto the desk. Incoming notes are scrubbed field
  // by field and appended; colliding ids get fresh ones so nothing is lost.
  const importNotes = (file) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result !== "string") return;

      try {
        const incoming = JSON.parse(reader.result);
        if (!Array.isArray(incoming)) return;

        // showStamp/pushUndo used to run *inside* the setNotes updater
        // below — StrictMode's dev-only double-invoke of state updaters
        // (see src/index.js) ran both of them twice per import, pushing
        // two identical "imported a backup" entries onto the undo stack
        // (so one Ctrl+Z didn't fully undo it) and firing the stamp/sound
        // twice. An updater must stay pure; these two are real side
        // effects, so they're computed and called here instead, and
        // setNotes below stays a plain, honestly-pure array merge.
        const existing = new Set(notes.map((note) => note.id));

        const cleaned = incoming
          .filter((note) => note && typeof note === "object" && typeof note.text === "string")
          .map((note) => ({
            id: typeof note.id !== "string" || !note.id || existing.has(note.id) ? id() : note.id,
            title: typeof note.title === "string" ? note.title : "",
            text: note.text,
            placeholder: typeof note.placeholder === "string" && note.placeholder
              ? note.placeholder
              : randomQuote(quotes),
            time: typeof note.time === "string" ? note.time : formattedDateNow(),
            color: typeof note.color === "string" && note.color in NOTE_COLORS ? note.color : "yellow",
            favorite: !!note.favorite,
            lock: !!note.lock,
            tags: Array.isArray(note.tags) ? note.tags.filter((tag) => typeof tag === "string") : [],
          }));

        showStamp(
          cleaned.length > 0
            ? `${ cleaned.length } ${ cleaned.length === 1 ? "note" : "notes" } poured in`
            : "Nothing to pour in from that file"
        );

        if (cleaned.length > 0) {
          pushUndo("imported a backup");
          setNotes((prev) => [...prev, ...cleaned]);
        }
      } catch {
        showStamp("That file isn't a Docket backup");
      }
    };

    reader.readAsText(file);
  }

  // importNotes closes over `notes` (for id-collision checks) and is
  // recreated fresh every render, same as pushUndo/showStamp. The window
  // drop listener below is only attached once (mount), so it needs to
  // reach the *current* importNotes rather than close over the first
  // render's — otherwise dropped-in backups would always be deduped
  // against the note list as it stood on first load, never anything
  // added or removed since.
  const importNotesRef = useRef(importNotes);
  importNotesRef.current = importNotes;

  // Dragging a backup file over the window pours it in on drop, not just
  // the nav's import button. dragenter/dragleave both fire on every
  // element the pointer crosses, so a counter (rather than a boolean) is
  // what keeps the overlay from flickering as the drag passes over child
  // elements on its way across the page.
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragDepthRef = useRef(0);

  // Ticks up only on an actual successful drop (never a drag-cancel) — the
  // overlay's own blobs read the rising edge to throw a one-shot splash
  // impulse, distinct from the ambient wobble they run the whole time the
  // overlay's open.
  const [dropPulse, setDropPulse] = useState(0);

  useEffect(() => {
    const isFileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");

    const handleDragEnter = (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      setIsDraggingFile(true);
    };

    const handleDragOver = (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
    };

    const handleDragLeave = (e) => {
      if (!isFileDrag(e)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setIsDraggingFile(false);
    };

    const handleDrop = (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepthRef.current = 0;
      setIsDraggingFile(false);

      const file = e.dataTransfer.files?.[0];
      if (file) {
        importNotesRef.current(file);
        setDropPulse((n) => n + 1);
      }
    };

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);
    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, []);

  // Deal a fresh inspiration quote into an empty note's placeholder.
  const updateQuote = (noteId) => {
    const newNotes = notes.map((note) =>
      note.id === noteId ? { ...note, placeholder: randomQuote(quotes) } : note
    );
    setNotes(newNotes);
  }

  // Quick-capture shortcuts: N jots a new note in a random color, / jumps to
  // the search field. Both stand down while any field has the caret, and
  // both stand down while the note constellation is open — that panel is
  // a full-viewport overlay with its own single-letter vocabulary (P
  // pins, 1/2/3 switch layouts, / opens ITS OWN search), and without this
  // guard every one of those keystrokes would also reach here: an "n"
  // meant for the graph would jot a random new note onto the hidden desk
  // behind it, an "f" would silently toggle focus mode, and "/" would
  // steal the caret into a search field the visitor can't even see.
  useEffect(() => {
    const handleKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest("input, textarea, .note-constellation-panel")) return;

      if (e.key === "/") {
        e.preventDefault();
        document.querySelector(".search input")?.focus();
      } else if ((e.key === "n" || e.key === "N") && !editingNoteId) {
        const palette = Object.keys(NOTE_COLORS);
        addNote(palette[Math.floor(Math.random() * palette.length)]);
      } else if (e.key === "f" || e.key === "F") {
        toggleFocusMode();
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  const closeEditor = useCallback(() => setEditingNoteId(null), []);

  const editingNote = notes.find((note) => note.id === editingNoteId);

  // Smooth inertia scroll on the desk itself — paused whenever .receded's
  // own overflow:hidden lock is active (the focus editor open) so Lenis
  // never fights it. See useLenisScroll.jsx.
  const { lenisRef, scrollVelocity } = useLenisScroll(homeRef, { paused: !!editingNote });

  // Prefers Lenis's own smooth scrollTo (so the same inertia easing carries
  // the jump) once it's live; falls back to the native smooth-scroll this
  // already did before Lenis existed.
  const scrollHomeToTop = useCallback(() => {
    if (lenisRef.current) lenisRef.current.scrollTo(0, { duration: 1.1 });
    else homeRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [lenisRef]);

  // How much of each ink the desk holds — the toolbar's ink-levels chart
  // draws these as springy bars.
  const colorCounts = useMemo(() => {
    const counts = {};
    for (const note of notes) {
      counts[note.color] = (counts[note.color] || 0) + 1;
    }
    return counts;
  }, [notes]);

  // The desk insights panel's numbers: how many notes were poured each day,
  // how many are starred, and the average length of what's written. Notes
  // only carry a calendar day (not a time), and sessionStorage means the
  // whole history usually lives within one sitting — so "by day" is a
  // handful of discrete buckets, not a long time series.
  const insights = useMemo(() => {
    const byDay = new Map();
    notes.forEach((note) => {
      const key = note.time || "Unknown";
      byDay.set(key, (byDay.get(key) || 0) + 1);
    });

    const days = Array.from(byDay.entries())
      .map(([label, count]) => ({ label, count, when: new Date(label).getTime() }))
      .sort((a, b) => {
        if (Number.isNaN(a.when) || Number.isNaN(b.when)) return 0;
        return a.when - b.when;
      });

    const favoriteCount = notes.filter((note) => note.favorite).length;
    const totalChars = notes.reduce((sum, note) => sum + (note.text?.length || 0), 0);
    const avgChars = notes.length ? Math.round(totalChars / notes.length) : 0;

    return { days, favoriteCount, avgChars };
  }, [notes]);

  // Everything the command palette can cast, in its shelf order.
  const paletteActions = [
    {
      key: "new",
      label: "Pour a new note",
      hint: "N",
      icon: <FaPlus />,
      perform: () => {
        const palette = Object.keys(NOTE_COLORS);
        addNote(palette[Math.floor(Math.random() * palette.length)]);
      },
    },
    { key: "shuffle", label: "Shuffle the desk", icon: <FaShuffle />, perform: shuffleNotes },
    {
      key: "focus",
      label: focusMode ? "Exit focus mode" : "Enter focus mode",
      hint: "F",
      icon: <FaCompress />,
      perform: toggleFocusMode,
    },
    ...(!reduceMotion ? [{
      key: "pile",
      label: pileView ? "Restore the grid" : "Toss notes into a pile",
      icon: <FaLayerGroup />,
      perform: togglePileView,
    }] : []),
    { key: "undo", label: "Undo the last edit", hint: "⌘Z", icon: <FaClockRotateLeft />, perform: performUndo },
    { key: "redo", label: "Redo the last undo", hint: "⌘⇧Z", icon: <FaArrowRotateRight />, perform: performRedo },
    {
      key: "history",
      label: "Show edit history",
      icon: <FaTimeline />,
      perform: () => window.dispatchEvent(new CustomEvent(HISTORY_EVENT)),
    },
    {
      key: "theme",
      label: theme === "dark" ? "Switch to fresh paper" : "Switch to Ink",
      icon: theme === "dark" ? <FaSun /> : <FaMoon />,
      perform: toggleTheme,
    },
    {
      key: "persist",
      label: persistNotes ? "Stop remembering notes after this tab" : "Remember notes across sessions",
      icon: persistNotes ? <FaLock /> : <FaLockOpen />,
      perform: togglePersistNotes,
    },
    { key: "export", label: "Export a backup", icon: <FaFileArrowDown />, perform: exportNotes },
    { key: "clear", label: "Clear every filter", icon: <FaRotateLeft />, perform: clearFilters },
    {
      key: "search",
      label: "Jump to search",
      hint: "/",
      icon: <FaMagnifyingGlass />,
      perform: () => document.querySelector(".search input")?.focus(),
    },
    {
      key: "shortcuts",
      label: "Show keyboard shortcuts",
      hint: "?",
      icon: <FaQuestion />,
      perform: () => window.dispatchEvent(new CustomEvent(SHORTCUTS_EVENT)),
    },
    {
      key: "insights",
      label: "Show desk insights",
      icon: <FaChartLine />,
      perform: () => window.dispatchEvent(new CustomEvent(INSIGHTS_EVENT)),
    },
    {
      key: "ink-levels",
      label: "Show ink levels",
      icon: <FaChartSimple />,
      perform: () => window.dispatchEvent(new CustomEvent(INK_LEVELS_EVENT)),
    },
    {
      key: "gravity-field",
      label: "Show the gravity field",
      icon: <FaMeteor />,
      perform: () => window.dispatchEvent(new CustomEvent(GRAVITY_FIELD_EVENT)),
    },
    {
      key: "fluid-field",
      label: "Show the fluid field",
      icon: <FaDroplet />,
      perform: () => window.dispatchEvent(new CustomEvent(FLUID_FIELD_EVENT)),
    },
    {
      key: "audio-wave-string",
      label: "Show the wavy line",
      icon: <FaWaveSquare />,
      perform: () => window.dispatchEvent(new CustomEvent(AUDIO_WAVE_STRING_EVENT)),
    },
    {
      key: "fluid-visualizer",
      label: "Show the fluid visualizer",
      icon: <FaWater />,
      perform: () => window.dispatchEvent(new CustomEvent(FLUID_VISUALIZER_EVENT)),
    },
    {
      key: "cloth-field",
      label: "Show the cloth field",
      icon: <FaFlag />,
      perform: () => window.dispatchEvent(new CustomEvent(CLOTH_EVENT)),
    },
    {
      key: "note-constellation",
      label: "Map your notes",
      icon: <FaCircleNodes />,
      perform: () => window.dispatchEvent(new CustomEvent(NOTE_CONSTELLATION_EVENT)),
    },
    {
      key: "trash",
      label: deletedNotes.length > 0 ? `Open the trash · ${ deletedNotes.length }` : "Open the trash",
      icon: <FaTrashCan />,
      perform: () => window.dispatchEvent(new CustomEvent(TRASH_EVENT)),
    },
    {
      key: "settings",
      label: "Open settings",
      icon: <FaGear />,
      perform: () => window.dispatchEvent(new CustomEvent(SETTINGS_EVENT)),
    },
    {
      key: "sprint",
      label: "Start a focus sprint",
      hint: "S",
      icon: <FaHourglassHalf />,
      perform: () => window.dispatchEvent(new CustomEvent(SPRINT_EVENT)),
    },
    {
      key: "replay",
      label: "Replay the original shot",
      icon: <FaClapperboard />,
      perform: () => window.dispatchEvent(new CustomEvent(REPLAY_EVENT)),
    },
    {
      key: "tour",
      label: "Show me around again",
      icon: <FaCompass />,
      perform: () => window.dispatchEvent(new CustomEvent(TOUR_EVENT)),
    },
  ];

  return (
    <>
      {/* The page recedes while the focus editor is open — a cheap,
          compositor-only depth cue that replaces the old backdrop blur.
          The fixed layers below live outside this div so the transform
          never becomes their containing block. */}
      <div
        ref={ homeRef }
        onScroll={ handleScroll }
        className={ `home custom-scroll ${ editingNote ? "receded" : "" } ${ focusMode ? "focus" : "" }` }
      >
        <Navigation
          addNote={ addNote }
          exportNotes={ exportNotes }
          importNotes={ importNotes }
          hasNotes={ notes.length > 0 }
          focusMode={ focusMode }
          reduceMotion={ reduceMotion }
        />
        <GooeyEffectSvg
          id="colorSelectors"
        />
        <LiquidTextFilter />
        <AmbientField />
        <Header
          searchText={ notesSortText }
          setNotesSortText={ setNotesSortText }
          notesSortByFavorite={ notesSortByFavorite }
          setNotesSortByFavorite={ toggleSortByFavorite }
          sortColor={ notesSortColor }
          setSortColor={ setNotesSortColor }
          notesCount={ filteredNotes.length }
          totalCount={ notes.length }
          clearFilters={ clearFilters }
          colorCounts={ colorCounts }
          theme={ theme }
          toggleTheme={ toggleTheme }
          focusMode={ focusMode }
          toggleFocusMode={ toggleFocusMode }
          persistNotes={ persistNotes }
          togglePersistNotes={ togglePersistNotes }
          trashCount={ deletedNotes.length }
          pileView={ pileView }
          togglePileView={ togglePileView }
          reduceMotion={ reduceMotion }
          celebration={ celebration }
        />
        <NoteList
          notes={ filteredNotes }
          hasNotes={ notes.length > 0 }
          deskCleared={ deskCleared }
          focusMode={ focusMode }
          addNote={ addNote }
          clearFilters={ clearFilters }
          allTags={ allTags }
          sortTag={ notesSortTag }
          setSortTag={ setNotesSortTag }
          selectMode={ selectMode }
          toggleSelectMode={ toggleSelectMode }
          enterSelectMode={ enterSelectMode }
          selectedIds={ selectedIds }
          toggleSelectNote={ toggleSelectNote }
          setSelection={ setSelection }
          selectAllVisible={ selectAllVisible }
          spawn={ spawn }
          clearSpawn={ clearSpawn }
          sortMode={ sortMode }
          setSortMode={ setSortMode }
          shuffleNotes={ shuffleNotes }
          deleteNote={ deleteNote }
          updateTitle={ updateTitle }
          updateText={ updateText }
          updateFavourite={ updateFavourite }
          updateColor={ updateColor }
          updateLock={ updateLock }
          reorderNotes={ reorderNotes }
          duplicateNote={ duplicateNote }
          openEditor={ setEditingNoteId }
          reduceMotion={ reduceMotion }
          pileView={ pileView }
          togglePileView={ togglePileView }
          searchQuery={ notesSortText }
          scrollVelocity={ scrollVelocity }
        />
      </div>
      <AnimatePresence>
        {
          editingNote && (
            <NoteEditor
              key={ editingNote.id }
              note={ editingNote }
              onClose={ closeEditor }
              updateTitle={ updateTitle }
              updateText={ updateText }
              updateFavorite={ updateFavourite }
              updateLock={ updateLock }
              setNoteColor={ setNoteColor }
              updateQuote={ updateQuote }
              updateTags={ updateTags }
            />
          )
        }
      </AnimatePresence>
      <CommandPalette actions={ paletteActions } reduceMotion={ reduceMotion } />
      <ShortcutsSheet />
      <TourGuide theme={ theme } persistNotes={ persistNotes } />
      <ShotReplay />
      <SprintPanel reduceMotion={ reduceMotion } />
      <AnimatePresence>
        {
          !focusMode && (
            <QuickDock
              addNote={ addNote }
              shuffleNotes={ shuffleNotes }
              focusMode={ focusMode }
              toggleFocusMode={ toggleFocusMode }
              theme={ theme }
              toggleTheme={ toggleTheme }
              reduceMotion={ reduceMotion }
            />
          )
        }
      </AnimatePresence>
      {/* <AnimatePresence>
        {
          !focusMode && <FluidPlayerDock key="fluidPlayerDock" reduceMotion={ reduceMotion } />
        }
      </AnimatePresence> */}
      <InsightsPanel
        totalCount={ notes.length }
        colorCounts={ colorCounts }
        days={ insights.days }
        favoriteCount={ insights.favoriteCount }
        avgChars={ insights.avgChars }
        sortColor={ notesSortColor }
        setSortColor={ setNotesSortColor }
        reduceMotion={ reduceMotion }
      />
      <InkLevelsPanel
        totalCount={ notes.length }
        colorCounts={ colorCounts }
        sortColor={ notesSortColor }
        setSortColor={ setNotesSortColor }
        reduceMotion={ reduceMotion }
        celebration={ celebration }
        addNote={ addNote }
        decantColor={ decantColor }
      />
      <GravityFieldPanel reduceMotion={ reduceMotion } />
      <FluidFieldPanel reduceMotion={ reduceMotion } />
      <AudioWaveStringPanel reduceMotion={ reduceMotion } />
      <FluidVisualizerPanel reduceMotion={ reduceMotion } />
      <ClothPanel reduceMotion={ reduceMotion } />
      <NoteConstellationPanel notes={ notes } openEditor={ setEditingNoteId } reduceMotion={ reduceMotion } />
      <TrashPanel
        entries={ deletedNotes }
        onRestore={ restoreNote }
        onShred={ shredNote }
        onEmpty={ emptyTrash }
        reduceMotion={ reduceMotion }
      />
      <HistoryPanel
        timeline={ timeline }
        cursor={ cursor }
        onJump={ jumpTo }
        branchStash={ branchStash }
        onRestoreBranch={ restoreBranch }
        reduceMotion={ reduceMotion }
      />
      <SettingsPanel
        theme={ theme }
        toggleTheme={ toggleTheme }
        persistNotes={ persistNotes }
        togglePersistNotes={ togglePersistNotes }
        reduceMotion={ reduceMotion }
        toggleReduceMotion={ toggleReduceMotion }
        systemReducedMotion={ systemReducedMotion }
        soundEnabled={ soundEnabled }
        toggleSound={ toggleSound }
      />
      <BulkActionBar
        count={ selectedIds.size }
        onStar={ bulkStar }
        onRecolor={ bulkRecolor }
        onExport={ bulkExport }
        onDelete={ bulkDelete }
        onDone={ endSelection }
        reduceMotion={ reduceMotion }
      />
      <AnimatePresence>
        {
          focusMode && (
            <motion.button
              key="focusExit"
              type="button"
              aria-label="Exit focus mode"
              title="Exit focus mode (F)"
              className="focus-exit"
              initial={{ opacity: 0, scale: 0, rotate: -20 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0, rotate: 20 }}
              whileHover={{ scale: 1.12 }}
              whileTap={{ scale: .88 }}
              transition={{ type: "spring", stiffness: 380, damping: 16 }}
              onClick={ toggleFocusMode }
            >
              <FaCompress className="focus-exit-icon" />
            </motion.button>
          )
        }
      </AnimatePresence>
      <ThemeWipe wipe={ wipe } />
      <InkCelebration celebration={ celebration } />
      <ActionStamp stamp={ stamp } />
      <ScrollProgress containerRef={ homeRef } markers={ scrollMarkers } reduceMotion={ reduceMotion } />
      <DropZoneOverlay active={ isDraggingFile } dropPulse={ dropPulse } reduceMotion={ reduceMotion } />
      <div className="undo-toast-layer">
        <AnimatePresence>
          {
            visibleDeleted.map((entry, index) => (
              <UndoToast
                key={ entry.note.id }
                note={ entry.note }
                depth={ visibleDeleted.length - 1 - index }
                onUndo={ restoreNote }
                onDismiss={ dismissUndo }
                reduceMotion={ reduceMotion }
              />
            ))
          }
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {
          showScrollTop && (
            <motion.button
              key="backToTop"
              type="button"
              aria-label="Float back to the top"
              className="back-to-top"
              initial={{ opacity: 0, scale: 0, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0, y: 40 }}
              whileHover={{ scale: 1.12 }}
              whileTap={{ scale: .9 }}
              transition={{ type: "spring", stiffness: 360, damping: 20 }}
              onClick={ scrollHomeToTop }
            >
              <FaArrowUp className="back-to-top-icon" />
            </motion.button>
          )
        }
      </AnimatePresence>
    </>
  );
}

export default Home;
