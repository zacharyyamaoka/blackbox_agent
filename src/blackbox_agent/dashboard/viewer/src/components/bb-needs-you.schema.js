// bb-needs-you: the Receipt (viewer/CONTRACT.md §5.1, §23). Pure: no DOM.
export default {
  tag: 'bb-needs-you', name: 'Needs you', version: 2, wave: 1,
  description: "The Receipt: one calm sentence and the two counts (needs you: only what cannot go ahead without Zach; went ahead on its default), then 1 Your call (blocking, no default, or still-stop, the recommended answer picked), 2 Going ahead on their own (each question's default and when it lands, by kind), 3 Decided for you (what the agents did, grouped; All look right per group, Undo per line). Static: each button shows the exact command, with Copy. Reads state.json needs (ideas.md's Suggestions for Zach, status.json blocked_on, the box's needs.jsonl) and receipt.",
  reads: ['needs', 'receipt'],
  settings: [
    { id: 'title', type: 'text', label: 'Title', default: 'Needs you' },
    { id: 'layout', type: 'select', label: 'Layout', default: 'receipt', options: [{ value: 'receipt', label: 'Receipt' }, { value: 'list', label: 'List' }, { value: 'pill', label: 'Pill' }] },
    { id: 'limit', type: 'range', label: 'Questions shown in Your call before “more”', min: 1, max: 20, step: 1, default: 5 },
    { id: 'show_source', type: 'checkbox', label: 'Show where each ask is written', default: true },
    { id: 'href', type: 'text', label: 'Link to the full list', default: '' },
  ],
  blocks: [],
  presets: [{ name: 'Needs you' }],
  empty: 'Nothing needs you. A question appears here from the box\'s needs.jsonl, an open line under Suggestions for Zach in ideas.md, or status.json\'s blocked_on.',
};
