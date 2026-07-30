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
export function timeAgo(timestamp) {
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
