import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from "framer-motion";

import { id } from "../utils/math";
import { formattedDateNow } from "../utils/date";
import { randomQuote } from "../utils/data";
import { NOTE_COLORS } from "../constants/colors";
import Navigation from "../components/Navigation/Navigation";
import GooeyEffectSvg from "../components/Svg/GooeyEffectSvg";
import Header from "../components/Header/Header";
import NoteList from "../components/List/NoteList";
import NoteEditor from "../components/Editor/NoteEditor";
import UndoToast from "../components/Toast/UndoToast";

import quotes from "../assets/data/quotes.json";

import "./Home.css";

const Home = () => {
  const [notes, setNotes] = useState(() => {
    return JSON.parse(sessionStorage.getItem('DocketNoteProject')) || [];
  });

  const [notesSortText, setNotesSortText] = useState("");
  const [notesSortByFavorite, setNotesSortByFavorite] = useState(false);

  // Long-press-deleted notes and where each sat, kept around as a toast deck
  // for their undo windows. Oldest first; only the freshest few are shown.
  const [deletedNotes, setDeletedNotes] = useState([]);

  // Which note is stretched open in the focus editor, if any.
  const [editingNoteId, setEditingNoteId] = useState(null);

  const toggleSortByFavorite = () => {
    setNotesSortByFavorite(!notesSortByFavorite);
  }

  const addNote = (color) => {
    const newNotes = [...notes];

    newNotes.push({
      id: id(),
      title: "",
      text: "",
      placeholder: randomQuote(quotes),
      time: formattedDateNow(),
      color,
      favorite: false,
      lock: false,
    });

    setNotes(newNotes);
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

  useEffect(() => {
    sessionStorage.setItem("DocketNoteProject", JSON.stringify(notes));
  }, [notes]);

  const closeEditor = useCallback(() => setEditingNoteId(null), []);

  const editingNote = notes.find((note) => note.id === editingNoteId);

  return (
    <div className="home custom-scroll">
      <Navigation
        addNote={ addNote }
      />
      <GooeyEffectSvg
        id="colorSelectors"
      />
      <Header
        setNotesSortText={ setNotesSortText }
        notesSortByFavorite={ notesSortByFavorite }
        setNotesSortByFavorite={ toggleSortByFavorite }
      />
      <NoteList
        notes={ notes }
        deleteNote={ deleteNote }
        updateTitle={ updateTitle }
        updateText={ updateText }
        updateFavourite={ updateFavourite }
        updateColor={ updateColor }
        updateLock={ updateLock }
        reorderNotes={ reorderNotes }
        duplicateNote={ duplicateNote }
        openEditor={ setEditingNoteId }
        sortText={ notesSortText }
        sortFavorite={ notesSortByFavorite }
      />
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
    </div>
  );
}

export default Home;
