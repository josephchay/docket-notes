// Session-only persistence. Notes and settings live in the browser's
// sessionStorage — they survive reloads within the tab, and vanish when the
// tab closes. There is no database and no network involved.
//
// This module replaces the old api.js (fetchNotes / syncNotes /
// fetchSettings / saveSettings). Delete api.js from the project.

const NOTES_KEY = "docket-notes";
const SETTINGS_KEY = "docket-settings";
const TOUR_KEY = "docket-tour-seen";

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
//   tags: string[]
// }

// StoredSettings shape:
// {
//   theme?: "light" | "dark",
//   [key: string]: unknown
// }

// sessionStorage only exists in the browser; every helper no-ops safely
// during SSR / prerendering.
const storageAvailable = () => {
  try {
    return typeof window !== "undefined" && !!window.sessionStorage;
  } catch {
    return false;
  }
};

export const loadNotes = () => {
  if (!storageAvailable()) return [];

  try {
    const raw = window.sessionStorage.getItem(NOTES_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((note) => note && typeof note === "object" && typeof note.text === "string")
      .map((note) => ({
        id: typeof note.id === "string" ? note.id : "",
        title: typeof note.title === "string" ? note.title : "",
        text: note.text,
        placeholder: typeof note.placeholder === "string" ? note.placeholder : "",
        time: typeof note.time === "string" ? note.time : "",
        color: typeof note.color === "string" ? note.color : "yellow",
        favorite: !!note.favorite,
        lock: !!note.lock,
        tags: Array.isArray(note.tags) ? note.tags.filter((tag) => typeof tag === "string") : [],
      }));
  } catch {
    return [];
  }
};

export const saveNotes = (notes) => {
  if (!storageAvailable()) return;

  try {
    window.sessionStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  } catch {
    // Quota exceeded or storage blocked — the in-memory state still works.
  }
};

export const loadSettings = () => {
  if (!storageAvailable()) return {};

  try {
    const raw = window.sessionStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

export const saveSettings = (settings) => {
  if (!storageAvailable()) return;

  try {
    const merged = { ...loadSettings(), ...settings };
    window.sessionStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
  } catch {
    // Storage blocked — theme just won't persist this session.
  }
};

// Whether the first-run coach-mark tour has already played this session.
export const hasSeenTour = () => {
  if (!storageAvailable()) return true;

  try {
    return window.sessionStorage.getItem(TOUR_KEY) === "1";
  } catch {
    return true;
  }
};

export const markTourSeen = () => {
  if (!storageAvailable()) return;

  try {
    window.sessionStorage.setItem(TOUR_KEY, "1");
  } catch {
    // Storage blocked — the tour will just play again next reload.
  }
};
