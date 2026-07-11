# Docket

![image](https://github.com/josephchay/docket-note/assets/136827046/e6b96caf-627f-4ea5-9e76-bba76a5aa2a4)

---

# About

Welcome to **Docket**, your go-to quick note jotting app! Swiftly capture your thoughts, ideas, 
and to-dos on the fly with **Docket**'s intuitive interface. Whether you're on the move or struck by inspiration, our app ensures you never miss a beat. 
Effortlessly organize your notes, set reminders, and access your snippets anytime, anywhere. 
**Docket** - where note-taking meets speed and simplicity, making every thought a quick, memorable note!

# Application Features
1. **Choice of Themes**: Personalize your note-taking experience with a range of color plate themes to suit your mood and style.
2. **Random Quote Generation**: Get inspired with a random quote generator that appears every time you create a new note.
3. **Tablet Note-Taking**: Seamlessly take down notes on your tablet with a user-friendly interface with emphasis on aesthetics.
4. **Starred Notes**: Mark your favorite notes with a star to easily access them later.
5. **Quick Search**: Easily find your notes with a quick search feature that lets you filter through your snippets.
6. **Delete Notes**: Remove notes you no longer need with a simple hold.
7. **Undo Deletes**: Deleted notes pile into a colorful toast deck for a few seconds — press Undo to spring one back into place.
8. **Elastic Pull-Strings**: Stretch a note's strings to recolor, duplicate, download, open, or swap it — release past the threshold to fire.
9. **Focus Editor**: Pull a note open into a full writing surface with four jelly-springy paper sizes, a direct color palette, live word count, copy-to-clipboard, and quote shuffling.
10. **Quick Capture Shortcuts**: Press `N` anywhere to jot a new note in a random color, or `/` to jump straight into search.
11. **Lasting Notes**: Every note is kept in a Netlify Database (Postgres) table, so your notes are on the desk from any browser you sign in from.
12. **Ink Theme**: Flip the whole desk to dark with the moon in the header — the paper goes dark while your notes keep their colors.
13. **Color Filters**: Tap a palette dot above the list to see only notes of that color; tap it again to bring every color back.
14. **Backup & Restore**: Save all your notes to a JSON file and pour them back in later, from the buttons at the foot of the nav rail.
15. **Tactile Touches**: Notes tilt under your pointer like paper on a soft desk, starring throws a burst of sparks, and an ink drop floats you back to the top of a long list.

# Tech Stack
1. React
2. xState
3. Framer motion
4. Anime.js
5. Netlify Functions + Netlify Database (Postgres)

# Deploying to Netlify (with the notes database)

The app keeps all records in a [Netlify Database](https://docs.netlify.com/build/data-and-storage/netlify-database/):
every note attribute (id, title, text, placeholder, time, color, favorite,
lock, and list position) lives in a `notes` table, and preferences such as
the theme live in a `settings` table. No browser storage is used. The schema
lives in `netlify/database/migrations/`, the API in `netlify/functions/`
(`/api/notes` and `/api/settings`), and the browser syncs through
`src/utils/api.js`. Because there is no local fallback, run the app through
`netlify dev` (or the deployed site) — plain `npm start` has no database and
will show an empty desk that cannot save.

One-time setup:

```bash
npm install -g netlify-cli   # or use npx netlify
netlify login                # opens the browser to authenticate
netlify init                 # create/link the Netlify site
netlify database init        # provisions the database and installs @netlify/database
                             # (choose plain SQL; the migration is already written)
```

Develop locally against a local Postgres:

```bash
netlify dev
```

Deploy (migrations are applied automatically during the deploy):

```bash
netlify deploy --prod
```

# Acknowledgements
- Design inspired from <a href="https://dribbble.com/shots/14037848-Docket-note-Side-menu" target="_blank">Docket Note</a>
