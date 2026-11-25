/* The one Needs-you count (viewer/CONTRACT.md §23), shown on every pill (bb-nav, bb-site-nav, bb-needs-you): only what
   cannot go ahead without him (blocking, no default, or on the still-stop list). A question with a default and a time is
   "going ahead", not "needs you", so the count measures autonomy, not volume. A state folded before the Receipt has no
   step on its rows: every ask then counts, as before. Pure (no DOM). WHY (Zach, Daily Note 2026-11-25): keep needs-you
   low, with "a high number of them that default answers are being taken and proceed with". */

/** How many asks need him, or null when the state has no needs slice (a count it cannot read is never shown as 0). */
export function needsYou(state) {
  if (!state || typeof state !== 'object') return null;
  if (state.receipt && state.receipt.counts && Number.isInteger(state.receipt.counts.needs_you)) return state.receipt.counts.needs_you;
  if (!Array.isArray(state.needs)) return null;
  return state.needs.filter((n) => !n || !n.step || n.step === 'call').length;
}
