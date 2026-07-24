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
} from "react-icons/fa6";

import { id } from "../utils/math";
import { formattedDateNow } from "../utils/date";
import { randomQuote } from "../utils/data";
import { loadNotes, saveNotes, loadSettings, saveSettings } from "../utils/storage";
import { NOTE_COLORS } from "../constants/colors";
import Navigation from "../components/Navigation/Navigation";
import GooeyEffectSvg from "../components/Svg/GooeyEffectSvg";
import Header from "../components/Header/Header";
import NoteList from "../components/List/NoteList";
import NoteEditor from "../components/Editor/NoteEditor";
import UndoToast from "../components/Toast/UndoToast";
import CommandPalette from "../components/Command/CommandPalette";
import ThemeWipe from "../components/Theme/ThemeWipe";
import InkCelebration from "../components/Celebration/InkCelebration";
import ShortcutsSheet, { SHORTCUTS_EVENT } from "../components/Shortcuts/ShortcutsSheet";
import TourGuide from "../components/Tour/TourGuide";
import BulkActionBar from "../components/Bulk/BulkActionBar";
import InsightsPanel, { INSIGHTS_EVENT } from "../components/Insights/InsightsPanel";

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
//   index: number
// }

// The note counts worth a little ink shower over the desk.
const MILESTONES = [5, 10, 25, 50, 100, 200, 500];

const Home = () => {
  // Notes live in sessionStorage only — they survive reloads within this
  // tab and reset when the tab closes. The list starts empty and is
  // hydrated in an effect so SSR never touches sessionStorage.
  const [notes, setNotes] = useState([]);
  const [hydrated, setHydrated] = useState(false);

  const [notesSortText, setNotesSortText] = useState("");
  const [notesSortByFavorite, setNotesSortByFavorite] = useState(false);
  const [notesSortColor, setNotesSortColor] = useState(null);
  const [notesSortTag, setNotesSortTag] = useState(null);

  // Fresh paper or the Ink theme — kept in sessionStorage alongside the notes.
  const [theme, setTheme] = useState("light");

  // The drop of ink that washes over the desk when the theme flips — see
  // ThemeWipe. Cleared once the wash has finished playing.
  const [wipe, setWipe] = useState(null);
  const THEME_BG = { light: "#fffeff", dark: "#161616" };

  const toggleTheme = (origin) => {
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

  // Hydrate notes and settings from sessionStorage once, on mount.
  useEffect(() => {
    const stored = loadNotes();
    if (stored.length > 0) setNotes(stored);

    celebratedRef.current = new Set(MILESTONES.filter((m) => m <= stored.length));
    everHadNotesRef.current = stored.length > 0;

    const settings = loadSettings();
    if (settings.theme === "dark" || settings.theme === "light") {
      setTheme(settings.theme);
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

  // Mirror every change back into sessionStorage — but only after hydration,
  // so the initial empty list never overwrites what the session already holds.
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

  // Long-press-deleted notes and where each sat, kept around as a toast deck
  // for their undo windows. Oldest first; only the freshest few are shown.
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

  const toggleSelectNote = useCallback((noteId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }, []);

  const endSelection = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  // Every bulk action reads the current selection off one shared `notes`
  // snapshot and writes the whole array back in a single setNotes call —
  // calling the single-note updaters once per id would each start from the
  // same stale snapshot and clobber one another.
  const bulkStar = () => {
    const allFavorited = notes.every((note) => !selectedIds.has(note.id) || note.favorite);
    setNotes((prev) => prev.map((note) =>
      selectedIds.has(note.id) ? { ...note, favorite: !allFavorited } : note
    ));
  }

  const bulkRecolor = () => {
    const palette = Object.keys(NOTE_COLORS);
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
  }

  const bulkDelete = () => {
    const toDelete = notes.filter((note) => selectedIds.has(note.id));
    if (toDelete.length === 0) return;

    setDeletedNotes((prev) => [
      ...prev.filter((entry) => !selectedIds.has(entry.note.id)),
      ...toDelete.map((note) => ({ note, index: notes.findIndex((n) => n.id === note.id) })),
    ].slice(-4));
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

    setNotes(newNotes);

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
    homeRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  const deleteNote = (noteId) => {
    const index = notes.findIndex((note) => note.id === noteId);
    if (index === -1) return;

    setDeletedNotes((prev) => [
      ...prev.filter((entry) => entry.note.id !== noteId),
      { note: notes[index], index },
    ].slice(-4));
    setNotes(notes.filter((note) => note.id !== noteId));

    if (editingNoteId === noteId) setEditingNoteId(null);
  }

  const undoDelete = (noteId) => {
    const entry = deletedNotes.find((item) => item.note.id === noteId);
    if (!entry) return;

    setNotes((prev) => {
      if (prev.some((note) => note.id === entry.note.id)) return prev;

      const next = [...prev];
      next.splice(Math.min(entry.index, next.length), 0, entry.note);
      return next;
    });
    setDeletedNotes((prev) => prev.filter((item) => item.note.id !== noteId));
  }

  const dismissUndo = useCallback((noteId) => {
    setDeletedNotes((prev) => prev.filter((entry) => entry.note.id !== noteId));
  }, []);

  // The copy lands right beside its source in the grid, starting unstarred.
  const duplicateNote = (noteId) => {
    setNotes((prev) => {
      const index = prev.findIndex((note) => note.id === noteId);
      if (index === -1) return prev;

      const copy = {
        ...prev[index],
        id: id(),
        time: formattedDateNow(),
        favorite: false,
      };

      const next = [...prev];
      next.splice(index + 1, 0, copy);
      return next;
    });
  }

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
    const newNotes = notes.map((note) =>
      note.id === noteId ? { ...note, color } : note
    );
    setNotes(newNotes);
  }

  const reorderNotes = (sourceId, targetId) => {
    if (sourceId === targetId) return;

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
    const newNotes = notes.map((note) =>
      note.id === id ? { ...note, favorite: !note.favorite } : note
    );
    setNotes(newNotes);
  }

  const updateLock = (id) => {
    const newNotes = notes.map((note) =>
      note.id === id ? { ...note, lock: !note.lock } : note
    );
    setNotes(newNotes);
  }

  const updateTags = (tags, id) => {
    const newNotes = notes.map((note) =>
      note.id === id ? { ...note, tags } : note
    );
    setNotes(newNotes);
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

        setNotes((prev) => {
          const existing = new Set(prev.map((note) => note.id));

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

          return [...prev, ...cleaned];
        });
      } catch {
        // Not a Docket backup; leave the desk untouched.
      }
    };

    reader.readAsText(file);
  }

  // Deal a fresh inspiration quote into an empty note's placeholder.
  const updateQuote = (noteId) => {
    const newNotes = notes.map((note) =>
      note.id === noteId ? { ...note, placeholder: randomQuote(quotes) } : note
    );
    setNotes(newNotes);
  }

  // Quick-capture shortcuts: N jots a new note in a random color, / jumps to
  // the search field. Both stand down while any field has the caret.
  useEffect(() => {
    const handleKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest("input, textarea")) return;

      if (e.key === "/") {
        e.preventDefault();
        document.querySelector(".search input")?.focus();
      } else if ((e.key === "n" || e.key === "N") && !editingNoteId) {
        const palette = Object.keys(NOTE_COLORS);
        addNote(palette[Math.floor(Math.random() * palette.length)]);
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  const closeEditor = useCallback(() => setEditingNoteId(null), []);

  const editingNote = notes.find((note) => note.id === editingNoteId);

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
      key: "theme",
      label: theme === "dark" ? "Switch to fresh paper" : "Switch to Ink",
      icon: theme === "dark" ? <FaSun /> : <FaMoon />,
      perform: toggleTheme,
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
        className={ `home custom-scroll ${ editingNote ? "receded" : "" }` }
      >
        <Navigation
          addNote={ addNote }
          exportNotes={ exportNotes }
          importNotes={ importNotes }
        />
        <GooeyEffectSvg
          id="colorSelectors"
        />
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
        />
        <NoteList
          notes={ filteredNotes }
          hasNotes={ notes.length > 0 }
          deskCleared={ deskCleared }
          clearFilters={ clearFilters }
          allTags={ allTags }
          sortTag={ notesSortTag }
          setSortTag={ setNotesSortTag }
          selectMode={ selectMode }
          toggleSelectMode={ toggleSelectMode }
          selectedIds={ selectedIds }
          toggleSelectNote={ toggleSelectNote }
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
      <CommandPalette actions={ paletteActions } />
      <ShortcutsSheet />
      <TourGuide />
      <InsightsPanel
        totalCount={ notes.length }
        colorCounts={ colorCounts }
        days={ insights.days }
        favoriteCount={ insights.favoriteCount }
        avgChars={ insights.avgChars }
        sortColor={ notesSortColor }
        setSortColor={ setNotesSortColor }
      />
      <BulkActionBar
        count={ selectedIds.size }
        onStar={ bulkStar }
        onRecolor={ bulkRecolor }
        onExport={ bulkExport }
        onDelete={ bulkDelete }
        onDone={ endSelection }
      />
      <ThemeWipe wipe={ wipe } />
      <InkCelebration celebration={ celebration } />
      <div className="undo-toast-layer">
        <AnimatePresence>
          {
            deletedNotes.map((entry, index) => (
              <UndoToast
                key={ entry.note.id }
                note={ entry.note }
                depth={ deletedNotes.length - 1 - index }
                onUndo={ undoDelete }
                onDismiss={ dismissUndo }
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
              onClick={ () => homeRef.current?.scrollTo({ top: 0, behavior: "smooth" }) }
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
