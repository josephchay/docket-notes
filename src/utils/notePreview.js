import { isChecklistText, fromChecklistText } from "./checklist";
import { isStudyText, fromStudyText } from "./study";

// Trash/Archive panel row labels and NotePile's own toss-view text preview
// all just read note.text as a raw snippet — none of them know or care
// about checklist or Bible-study marker syntax. This strips whichever
// structured form (if either) is actually active first, so a checklist or
// study note previews as its real content instead of raw "[ ] "/
// "## Observation" syntax; a plain note passes through completely
// unchanged. The two forms are mutually exclusive by construction (see
// Home.jsx's normalizeStructuredText), so at most one branch here ever
// actually applies.
export function notePreviewText(text) {
  if (isChecklistText(text)) return fromChecklistText(text);
  if (isStudyText(text)) return fromStudyText(text);
  return text ?? "";
}
