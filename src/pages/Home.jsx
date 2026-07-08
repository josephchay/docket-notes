import React, { useEffect, useState } from 'react';

import { id } from "../utils/math";
import { formattedDateNow } from "../utils/date";
import { randomQuote } from "../utils/data";
import { NOTE_COLORS } from "../constants/colors";
import Navigation from "../components/Navigation/Navigation";
import GooeyEffectSvg from "../components/Svg/GooeyEffectSvg";
import Header from "../components/Header/Header";
import NoteList from "../components/List/NoteList";

import quotes from "../assets/data/quotes.json";

import "./Home.css";

const Home = () => {
  const [notes, setNotes] = useState(() => {
    return JSON.parse(sessionStorage.getItem('DocketNoteProject')) || [];
  });

  const [notesSortText, setNotesSortText] = useState("");
  const [notesSortByFavorite, setNotesSortByFavorite] = useState(false);

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

  const deleteNote = (id) => {
    const newNotes = notes.filter((note) => note.id !== id);
    setNotes(newNotes);
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
        sortText={ notesSortText }
        sortFavorite={ notesSortByFavorite }
      />
    </div>
  );
}

export default Home;
