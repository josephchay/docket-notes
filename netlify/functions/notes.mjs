import { getDatabase } from "@netlify/database";

// The notes API, served at /api/notes.
//
// GET  -> every note, in the app's list order.
// PUT  -> the app's full list; the table is replaced inside one transaction
//         so the database always holds exactly what is on the desk.
//
// A whole-list sync keeps the wire format identical to the app's state (the
// same array it keeps in localStorage), which suits a personal jotting app
// where the list stays small.

const db = getDatabase();

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export default async (req) => {
  try {
    if (req.method === "GET") {
      const rows = await db.sql`
        SELECT id, title, "text", placeholder, "time", color, favorite, "lock"
        FROM notes
        ORDER BY "position" ASC
      `;
      return json(rows);
    }

    if (req.method === "PUT") {
      const notes = await req.json();
      if (!Array.isArray(notes)) {
        return json({ error: "Expected an array of notes" }, 400);
      }

      const client = await db.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM notes");

        for (let index = 0; index < notes.length; index++) {
          const note = notes[index] ?? {};
          await client.query(
            `INSERT INTO notes
               (id, title, "text", placeholder, "time", color, favorite, "lock", "position", updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
            [
              String(note.id ?? crypto.randomUUID()),
              typeof note.title === "string" ? note.title : "",
              typeof note.text === "string" ? note.text : "",
              typeof note.placeholder === "string" ? note.placeholder : "",
              typeof note.time === "string" ? note.time : "",
              typeof note.color === "string" ? note.color : "yellow",
              Boolean(note.favorite),
              Boolean(note.lock),
              index,
            ]
          );
        }

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      return json({ ok: true, count: notes.length });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (error) {
    return json({ error: String(error?.message ?? error) }, 500);
  }
};

export const config = {
  path: "/api/notes",
};
