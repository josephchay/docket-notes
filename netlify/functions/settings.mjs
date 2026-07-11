import { getDatabase } from "@netlify/database";

// App preferences, served at /api/settings.
//
// GET -> every setting as one object, e.g. { "theme": "dark" }.
// PUT -> an object of settings to upsert; only the keys sent are touched.

// Created lazily inside the handler so a missing database surfaces as a
// readable JSON error instead of a function that fails to load.
let cachedDb;
const database = () => (cachedDb ??= getDatabase());

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export default async (req) => {
  try {
    const db = database();
    if (req.method === "GET") {
      const rows = await db.sql`SELECT key, value FROM settings`;
      return json(Object.fromEntries(rows.map((row) => [row.key, row.value])));
    }

    if (req.method === "PUT") {
      const settings = await req.json();
      if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
        return json({ error: "Expected an object of settings" }, 400);
      }

      for (const [key, value] of Object.entries(settings)) {
        await db.sql`
          INSERT INTO settings (key, value)
          VALUES (${ key }, ${ String(value) })
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        `;
      }

      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (error) {
    return json({ error: String(error?.message ?? error) }, 500);
  }
};

export const config = {
  path: "/api/settings",
};
