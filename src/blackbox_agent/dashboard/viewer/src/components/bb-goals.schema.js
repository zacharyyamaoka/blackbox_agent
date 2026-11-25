// bb-goals: the Goals tab (viewer/CONTRACT.md §20, §25; PICKS.md "Goals round 2 (2026-11-25)": one stock data-ui table
// with the presets Rows · Cards · Timeline · Tracking, the splice (proposals-goals-v2/09-splice) as the default taken, and
// round 1's levers, odds, moves, "no idea aims at this" and goal hit rate as sections of its side panel). Pure: no DOM.
export default {
  tag: 'bb-goals', name: 'Goals (tracking, the odds)', version: 2, wave: 3,
  description: "The box's dated goals, one calm answer first (how many are met, then what holds each other one back), then ONE stock data-ui table with four presets: Rows (the plain table), Cards (a kpi card per target, in its own unit), Timeline (V5's plan: the desired window, the roadmap's ideas from now, your waits) and Tracking (one burn-up per goal: % of the way, planned vs actual vs the estimate). A click on any goal opens one side panel: where it stands, each target's planned / actual / estimate chart in its own unit, the per-box strips, how the % counts, the roadmap in plan order with \"its N ideas →\", what it takes (\"no idea aims at this\" under a red criterion nothing aims at), 03's levers with the odds and the moves, and the goal as written with the goal hit rate. The buffer ×2 switch moves the table and the panel at once.",
  reads: ['goals'],
  settings: [
    { id: 'goal', type: 'text', label: 'Goal it opens on', default: '', info: 'a goal id (G2): opens its side panel; empty = no panel open' },
    { id: 'view', type: 'select', label: 'Preset it opens on', default: 'Rows', info: 'one of the four presets (a deep link: #goals?view=Tracking)',
      options: [{ value: 'Rows', label: 'Rows' }, { value: 'Cards', label: 'Cards' }, { value: 'Timeline', label: 'Timeline' }, { value: 'Tracking', label: 'Tracking' }] },
    { id: 'buffer', type: 'select', label: 'Bottom-up buffer', default: 'x2', info: "Zach's Nov 23 rule: bottom-up estimates never include all the things; the reader flips it",
      options: [{ value: 'x2', label: '×2 (the buffer on)' }, { value: 'x1', label: '×1 (as written)' }] },
    { id: 'levers', type: 'checkbox', label: "03's levers and odds in each goal's panel", default: true },
  ],
  blocks: [],
  limit: 1,
  presets: [{ name: 'Goals' }],
  empty: "This box has no goals yet. Add goals/G1-<slug>.md (vibe-goal, vibe-done-when, vibe-target, tier, set) and a '- Goal: G1 · step 1' line under each idea that serves it in ideas.md.",
};
