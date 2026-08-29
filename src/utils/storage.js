// Session-only by default. Notes and settings live in the browser's
// sessionStorage — they survive reloads within the tab, and vanish when the
// tab closes — unless the visitor has opted into remembering across
// sessions (see getPersistPref/setPersistPref below), in which case the
// exact same reads/writes go to localStorage instead. There is no database
// and no network involved either way.
//
// This module replaces the old api.js (fetchNotes / syncNotes /
// fetchSettings / saveSettings). Delete api.js from the project.

import { randomFallbackVerse } from "./randomVerse";

const NOTES_KEY = "docket-notes";
const SETTINGS_KEY = "docket-settings";
const TOUR_KEY = "docket-tour-seen";
const PERSIST_KEY = "docket-persist";
const INTRO_KEY = "docket-intro-seen";

// StoredNote shape:
// {
//   id: string,
//   title: string,
//   text: string,
//   placeholder: string,
//   time: string,
//   color: string,
//   favorite: boolean,
//   lock: boolean,
//   tags: string[],
//   archived: boolean,
//   archivedAt: number | null,
//   dueAt: string | null,
// }

// StoredSettings shape:
// {
//   theme?: "light" | "dark",
//   [key: string]: unknown
// }

// A given storage kind only exists in the browser; every helper no-ops
// safely during SSR / prerendering.
const storageAvailable = (kind) => {
  try {
    return typeof window !== "undefined" && !!window[kind];
  } catch {
    return false;
  }
};

// Whether the visitor has asked notes and settings to survive closing the
// tab. Always read/written in localStorage regardless of the preference's
// own value — this one flag has to outlive the tab to know which store to
// boot into next time, even when the notes themselves are session-only.
export const getPersistPref = () => {
  if (!storageAvailable("localStorage")) return false;

  try {
    return window.localStorage.getItem(PERSIST_KEY) === "1";
  } catch {
    return false;
  }
};

export const setPersistPref = (on) => {
  if (!storageAvailable("localStorage")) return;

  try {
    window.localStorage.setItem(PERSIST_KEY, on ? "1" : "0");
  } catch {
    // Storage blocked — the choice just won't stick past this tab.
  }
};

// Which Web Storage object notes/settings currently read and write.
const activeKind = () => (getPersistPref() ? "localStorage" : "sessionStorage");

export const loadNotes = () => {
  const kind = activeKind();
  if (!storageAvailable(kind)) return [];

  try {
    const raw = window[kind].getItem(NOTES_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((note) => note && typeof note === "object" && typeof note.text === "string")
      .map((note) => ({
        id: typeof note.id === "string" ? note.id : "",
        title: typeof note.title === "string" ? note.title : "",
        text: note.text,
        // A LOCAL fallback verse, matching importNotes' own repair of the
        // same missing-field case in Home.jsx — an empty note hydrated
        // with placeholder "" would wear a blank forever, the exact thing
        // the fallback verses exist to prevent (and local for the same
        // reason there: a whole desk hydrating at boot must not spend
        // dozens of rate-limited requests on placeholders).
        placeholder: typeof note.placeholder === "string" && note.placeholder
          ? note.placeholder
          : randomFallbackVerse(),
        time: typeof note.time === "string" ? note.time : "",
        color: typeof note.color === "string" ? note.color : "yellow",
        favorite: !!note.favorite,
        lock: !!note.lock,
        tags: Array.isArray(note.tags) ? note.tags.filter((tag) => typeof tag === "string") : [],
        archived: !!note.archived,
        archivedAt: typeof note.archivedAt === "number" ? note.archivedAt : null,
        dueAt: typeof note.dueAt === "string" && note.dueAt ? note.dueAt : null,
      }));
  } catch {
    return [];
  }
};

export const saveNotes = (notes) => {
  const kind = activeKind();
  if (!storageAvailable(kind)) return;

  try {
    window[kind].setItem(NOTES_KEY, JSON.stringify(notes));
  } catch {
    // Quota exceeded or storage blocked — the in-memory state still works.
  }
};

export const loadSettings = () => {
  const kind = activeKind();
  if (!storageAvailable(kind)) return {};

  try {
    const raw = window[kind].getItem(SETTINGS_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

export const saveSettings = (settings) => {
  const kind = activeKind();
  if (!storageAvailable(kind)) return;

  try {
    const merged = { ...loadSettings(), ...settings };
    window[kind].setItem(SETTINGS_KEY, JSON.stringify(merged));
  } catch {
    // Storage blocked — theme just won't persist this session.
  }
};

// Whether the first-run coach-mark tour has already played this session.
// Always sessionStorage, deliberately independent of the persist
// preference — a returning visitor with remembered notes still gets the
// tour once per fresh tab, same as before this preference existed.
export const hasSeenTour = () => {
  if (!storageAvailable("sessionStorage")) return true;

  try {
    return window.sessionStorage.getItem(TOUR_KEY) === "1";
  } catch {
    return true;
  }
};

export const markTourSeen = () => {
  if (!storageAvailable("sessionStorage")) return;

  try {
    window.sessionStorage.setItem(TOUR_KEY, "1");
  } catch {
    // Storage blocked — the tour will just play again next reload.
  }
};

export const hasSeenIntro = () => {
  if (!storageAvailable("sessionStorage")) return true;

  try {
    return window.sessionStorage.getItem(INTRO_KEY) === "1";
  } catch {
    return true;
  }
};

export const markIntroSeen = () => {
  if (!storageAvailable("sessionStorage")) return;

  try {
    window.sessionStorage.setItem(INTRO_KEY, "1");
  } catch {
    // Storage blocked — the intro will just play again next visit.
  }
};
