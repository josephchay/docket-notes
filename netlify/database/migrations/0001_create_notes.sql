-- The notes table mirrors every attribute a note carries in the app, plus
-- "position" to preserve the list order and a bookkeeping timestamp.
-- ("text", "time", "lock", and "position" are quoted so their names can
-- match the app's attributes exactly despite being SQL keywords.)
CREATE TABLE IF NOT EXISTS notes (
  id          text        PRIMARY KEY,
  title       text        NOT NULL DEFAULT '',
  "text"      text        NOT NULL DEFAULT '',
  placeholder text        NOT NULL DEFAULT '',
  "time"      text        NOT NULL DEFAULT '',
  color       text        NOT NULL DEFAULT 'yellow',
  favorite    boolean     NOT NULL DEFAULT false,
  "lock"      boolean     NOT NULL DEFAULT false,
  "position"  integer     NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
