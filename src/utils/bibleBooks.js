// Structural facts about the 66 books ReferencePicker.jsx browses by —
// distinct from utils/citations.js, which only ever needs to RECOGNIZE a
// book name already typed. Chapter counts are canon-fixed (every English
// translation agrees on where a book's LAST chapter falls, unlike verse
// boundaries within a chapter, which do shift by translation/versification
// — see citations.js's own comment on why this app deliberately never
// hardcodes verse counts). That's what makes a chapter grid safe to render
// with a real, trustworthy upper bound while a verse strip still can't be.

import { BIBLE_BOOKS } from "./citations";

export const BOOK_CHAPTER_COUNTS = {
  "Genesis": 50, "Exodus": 40, "Leviticus": 27, "Numbers": 36, "Deuteronomy": 34,
  "Joshua": 24, "Judges": 21, "Ruth": 4, "1 Samuel": 31, "2 Samuel": 24,
  "1 Kings": 22, "2 Kings": 25, "1 Chronicles": 29, "2 Chronicles": 36, "Ezra": 10,
  "Nehemiah": 13, "Esther": 10, "Job": 42, "Psalms": 150, "Proverbs": 31,
  "Ecclesiastes": 12, "Song of Solomon": 8, "Isaiah": 66, "Jeremiah": 52, "Lamentations": 5,
  "Ezekiel": 48, "Daniel": 12, "Hosea": 14, "Joel": 3, "Amos": 9,
  "Obadiah": 1, "Jonah": 4, "Micah": 7, "Nahum": 3, "Habakkuk": 3,
  "Zephaniah": 3, "Haggai": 2, "Zechariah": 14, "Malachi": 4,
  "Matthew": 28, "Mark": 16, "Luke": 24, "John": 21, "Acts": 28,
  "Romans": 16, "1 Corinthians": 16, "2 Corinthians": 13, "Galatians": 6, "Ephesians": 6,
  "Philippians": 4, "Colossians": 4, "1 Thessalonians": 5, "2 Thessalonians": 3,
  "1 Timothy": 6, "2 Timothy": 4, "Titus": 3, "Philemon": 1, "Hebrews": 13,
  "James": 5, "1 Peter": 5, "2 Peter": 3, "1 John": 5, "2 John": 1,
  "3 John": 1, "Jude": 1, "Revelation": 22,
};

// Grouped in traditional reading order, not alphabetically — the way
// someone who's actually studied the Bible thinks of "where a book lives"
// (Law, then History, then Wisdom, then the Prophets; Gospels, then Acts,
// then Paul's letters, then the General epistles, then Revelation).
// Every name here is drawn from BIBLE_BOOKS itself (citations.js's own
// source of truth for spelling/casing) rather than re-typed, so the two
// files can never quietly drift apart on how a book's name is spelled.
const bySection = (names) => names.map((name) => {
  const book = BIBLE_BOOKS.find((b) => b === name);
  if (!book) throw new Error(`bibleBooks.js: "${ name }" is not in BIBLE_BOOKS`);
  return book;
});

export const BOOK_SECTIONS = [
  { testament: "Old", section: "Law", books: bySection(["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"]) },
  { testament: "Old", section: "History", books: bySection(["Joshua", "Judges", "Ruth", "1 Samuel", "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther"]) },
  { testament: "Old", section: "Wisdom", books: bySection(["Job", "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon"]) },
  { testament: "Old", section: "Major Prophets", books: bySection(["Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel"]) },
  { testament: "Old", section: "Minor Prophets", books: bySection(["Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi"]) },
  { testament: "New", section: "Gospels", books: bySection(["Matthew", "Mark", "Luke", "John"]) },
  { testament: "New", section: "History", books: bySection(["Acts"]) },
  { testament: "New", section: "Pauline Epistles", books: bySection(["Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians", "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus", "Philemon"]) },
  { testament: "New", section: "General Epistles", books: bySection(["Hebrews", "James", "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude"]) },
  { testament: "New", section: "Revelation", books: bySection(["Revelation"]) },
];
