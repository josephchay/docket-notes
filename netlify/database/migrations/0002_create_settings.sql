-- Small key/value table for app preferences (currently just the theme),
-- so nothing needs the browser's local storage.
CREATE TABLE IF NOT EXISTS settings (
  key   text PRIMARY KEY,
  value text NOT NULL DEFAULT ''
);
