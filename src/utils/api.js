// Talks to the Netlify function backed by the Netlify database (Postgres).
// The wire format is the same array of note objects the app keeps in state.
const ENDPOINT = "/api/notes";

export const fetchNotes = async () => {
  const response = await fetch(ENDPOINT, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) throw new Error(`Fetching notes failed (${ response.status })`);

  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("Unexpected notes payload");

  return rows.map((row) => ({
    id: row.id,
    title: row.title ?? "",
    text: row.text ?? "",
    placeholder: row.placeholder ?? "",
    time: row.time ?? "",
    color: row.color ?? "yellow",
    favorite: !!row.favorite,
    lock: !!row.lock,
  }));
};

export const syncNotes = async (notes) => {
  const response = await fetch(ENDPOINT, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(notes),
  });

  if (!response.ok) throw new Error(`Saving notes failed (${ response.status })`);
};

const SETTINGS_ENDPOINT = "/api/settings";

export const fetchSettings = async () => {
  const response = await fetch(SETTINGS_ENDPOINT, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) throw new Error(`Fetching settings failed (${ response.status })`);

  const settings = await response.json();
  return settings && typeof settings === "object" ? settings : {};
};

export const saveSettings = async (settings) => {
  const response = await fetch(SETTINGS_ENDPOINT, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });

  if (!response.ok) throw new Error(`Saving settings failed (${ response.status })`);
};
