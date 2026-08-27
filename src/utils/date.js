export function now() {
  return Date.now();
}

export function formattedDateNow() {
  const now = new Date();
  const options = { year: 'numeric', month: 'short', day: 'numeric' };

  return now.toLocaleDateString('en-US', options);
}

export function formattedDateTimeNow() {
  const now = new Date();
  const options = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true,
  };

  return now.toLocaleDateString('en-US', options);
}

// A relative stamp for timestamps from earlier this same session (the
// Trash and History panels' own entries) — coarser the further back it
// goes, since a session is usually one sitting, not a long time series.
// Guards against a missing/invalid timestamp (`null` coerces to epoch 0 in
// the subtraction below, which would otherwise report several decades'
// worth of days) rather than trusting every caller to already know which
// of their own values are real timestamps and which are placeholders.
export function timeAgo(timestamp) {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return "just now";

  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));

  if (seconds < 5) return "just now";
  if (seconds < 60) return `${ seconds }s ago`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${ minutes }m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${ hours }h ago`;

  const days = Math.round(hours / 24);
  return `${ days }d ago`;
}

// A due date is stored as a plain "YYYY-MM-DD" (a native <input type="date">
// value) — no time-of-day, matching note.time's own day-only grain. Compared
// against today's own calendar date (not a raw millisecond diff, which would
// misjudge "today" depending on what hour it happens to be read) so the four
// buckets below line up with how a visitor actually thinks about a due date.
export function dueLabel(dueAt) {
  if (typeof dueAt !== "string" || !dueAt) return null;

  const due = new Date(`${ dueAt }T00:00:00`);
  if (Number.isNaN(due.getTime())) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days = Math.round((due.getTime() - today.getTime()) / 86400000);

  if (days < 0) return { text: days === -1 ? "Due yesterday" : `${ -days }d overdue`, urgency: "overdue" };
  if (days === 0) return { text: "Due today", urgency: "today" };
  if (days === 1) return { text: "Due tomorrow", urgency: "soon" };
  if (days <= 6) return { text: `Due in ${ days }d`, urgency: "soon" };
  return { text: `Due ${ due.toLocaleDateString("en-US", { month: "short", day: "numeric" }) }`, urgency: "later" };
}
