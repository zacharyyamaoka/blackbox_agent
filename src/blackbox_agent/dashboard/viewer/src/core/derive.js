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

/** CONTRACT §24: where a prediction sits against its first result (the fold's `expect_when`, from git history), in words. */
export const EXPECT_WHEN = {
  'before-result': 'stated before the result',
  'with-result': 'written in the same commit as the result',
  'after-result': 'written after the result',
  'edited-after-result': 'changed after the result',
  'no-result-yet': 'stated; no result yet',
  'not-stated': 'not stated before the run',
};

/** iteration, ablation and unscored rows (CONTRACT §24): `expect_status`, the words for `expect_when`. Only a row the fold
    gave `expect_when` (a box that names its iterations) gains it; a row's own key of the same name wins. */
export function nameRows(rows) {
  return rows.map((r) => (r.expect_when === undefined || r.expect_status !== undefined ? r
    : { ...r, expect_status: EXPECT_WHEN[r.expect_when] ?? r.expect_when }));
}

/** slice -> its row deriver. */
export const DERIVED = { feedback: feedbackRows, iterations: nameRows, ablations: nameRows, unscored: nameRows };

export const deriveRows = (slice, rows) => (DERIVED[slice] ? DERIVED[slice](rows) : rows);
