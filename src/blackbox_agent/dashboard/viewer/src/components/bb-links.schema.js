// bb-links: where a box's words came from (the linking round's splice: Matrix's one line, Margin's objective page, Wiki's
// pages). Reads the `links` slice (viewer/tools/folds/links.py) and the notes it cites (spec and feedback `_note`). Pure.
export default {
  tag: 'bb-links', name: 'Links (where it came from)', version: 1, wave: 3,
  description: "Where a box's words came from: one line on how many specs trace to Zach's own words (Matrix), the objective's page with each citation's words in the margin opening in source-highlighter (Margin), and a page per feedback note, spec and source with Came from and Linked mentions (Wiki).",
  reads: ['links', 'spec', 'feedback'],
  settings: [
    { id: 'view', type: 'select', label: 'View', default: 'answer',
      info: "answer: one line for the top of the Spec or Feedback tab; objective: the objective's page; node: one note's or source's page",
      options: [{ value: 'answer', label: 'One line (Matrix)' }, { value: 'objective', label: "The objective's page (Margin)" },
        { value: 'node', label: 'A note or source page (Wiki)' }] },
    { id: 'about', type: 'select', label: 'The one line is about', default: 'spec',
      options: [{ value: 'spec', label: 'Specs' }, { value: 'feedback', label: 'Feedback' }] },
    { id: 'id', type: 'text', label: 'Node (the node view): spec:<id>, feedback:<id> or source:<key>', default: '' },
  ],
  blocks: [],
  presets: [{ name: 'Where it came from', settings: { view: 'answer' } }, { name: "The objective's page", settings: { view: 'objective' } }],
  empty: "Where each spec came from is not cited yet. A note cites a source with a bare number, [1](../SOURCES.md#z1), and SOURCES.md keeps each key's label and quote.",
};
