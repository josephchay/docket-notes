"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from "framer-motion";
import { FaArrowUp } from "react-icons/fa6";

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
//   lock: boolean
// }

// DeletedEntry shape:
// {
//   note: Note,
//   index: number
// }

const Home = () => {
  // Notes live in sessionStorage only — they survive reloads within this
  // tab and reset when the tab closes. The list starts empty and is
  // hydrated in an effect so SSR never touches sessionStorage.
  const [notes, setNotes] = useState([]);
  const [hydrated, setHydrated] = useState(false);

  const [notesSortText, setNotesSortText] = useState("");
  const [notesSortByFavorite, setNotesSortByFavorite] = useState(false);
  const [notesSortColor, setNotesSortColor] = useState(null);

  // Fresh paper or the Ink theme — kept in sessionStorage alongside the notes.
  const [theme, setTheme] = useState("light");

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      saveSettings({ theme: next });
      return next;
    });
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Hydrate notes and settings from sessionStorage once, on mount.
  useEffect(() => {
    const stored = loadNotes();
    if (stored.length > 0) setNotes(stored);

    const settings = loadSettings();
    if (settings.theme === "dark" || settings.theme === "light") {
      setTheme(settings.theme);
    }

    setHydrated(true);
  }, []);

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

  const toggleSortByFavorite = () => {
    setNotesSortByFavorite(!notesSortByFavorite);
  }

  // One motion to lift every lens off the desk at once — search text,
  // the star, and the color filter.
  const clearFilters = useCallback(() => {
    setNotesSortText("");
    setNotesSortByFavorite(false);
    setNotesSortColor(null);
  }, []);

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

    return filtered;
  }, [notes, notesSortText, notesSortByFavorite, notesSortColor]);

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
          theme={ theme }
          toggleTheme={ toggleTheme }
        />
        <NoteList
          notes={ filteredNotes }
          hasNotes={ notes.length > 0 }
          clearFilters={ clearFilters }
          spawn={ spawn }
          clearSpawn={ clearSpawn }
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
            />
          )
        }
      </AnimatePresence>
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
