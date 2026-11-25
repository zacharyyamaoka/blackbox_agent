/* Display columns a tab derives from a slice's rows in the viewer, never stored in state.json (viewer/CONTRACT.md §22.4).
   WHY in the viewer: the fold of a box that writes none of the new keys stays byte for byte what it was; a column that
   only restates fields the row already has (a spec id as a link, a word for its standing) belongs to the page. Pure. */

/** feedback rows (CONTRACT §22.4): `standing` (obsolete | became a spec | open), the status-badge word the table greys
    out when obsolete; `spec_link`, the first spec it became as a link to that spec's page (#node=spec:<id>), labelled
    with every spec it names; `bug`, true when the note is tagged bug-report. A row's own key of the same name wins. */
export function feedbackRows(rows) {
  return rows.map((r) => {
    const specs = Array.isArray(r.spec) ? r.spec.filter((s) => typeof s === 'string' && s) : typeof r.spec === 'string' && r.spec ? [r.spec] : [];
    const tags = Array.isArray(r.tags) ? r.tags : typeof r.tags === 'string' ? [r.tags] : [];
    const out = { ...r };
    if (out.standing === undefined) out.standing = r.status === 'obsolete' ? 'obsolete' : specs.length ? 'became a spec' : 'open';
    if (out.spec_link === undefined && specs.length) out.spec_link = { value: `#node=${encodeURIComponent(`spec:${specs[0]}`)}`, text: specs.join(', ') };
    if (out.bug === undefined) out.bug = tags.includes('bug-report');
    return out;
  });
}

/** slice -> its row deriver. */
export const DERIVED = { feedback: feedbackRows };

export const deriveRows = (slice, rows) => (DERIVED[slice] ? DERIVED[slice](rows) : rows);
