// bb-goals: the Goals tab (viewer/CONTRACT.md §20; PICKS.md "Goals (2026-11-25)": 02 Two lines as the hero + 03 Odds'
// levers and re-simulated moves + 04 Gate ladder's "no idea aims at this" + 01's goal hit rate on the Overview). Pure: no DOM.
export default {
  tag: 'bb-goals', name: 'Goals (two lines, the odds)', version: 1, wave: 3,
  description: "The box's dated goals, one calm answer first (how many are met, then what holds each other one back), then data-ui's stock pace list (desired dashed, real solid), and per goal its two lines with the violet bottom-up estimate idea by idea, its roadmap in plan order, the criteria with the idea that aims at each (\"no idea aims at this\" under a red one nothing aims at), 03's levers (when you answer each wait, when the box runs) with the odds and the three moves re-simulated, the buffer ×2 switch, and \"Its N ideas →\" to the Ideas tab filtered to that goal.",
  reads: ['goals', 'ideas'],
  settings: [
    { id: 'goal', type: 'text', label: 'Goal it opens on', default: '', info: 'a goal id (G2); empty = the worst first (at risk, then cannot judge, then met)' },
    { id: 'buffer', type: 'select', label: 'Bottom-up buffer', default: 'x2', info: "Zach's Nov 23 rule: bottom-up estimates never include all the things; the reader flips it",
      options: [{ value: 'x2', label: '×2 (the buffer on)' }, { value: 'x1', label: '×1 (as written)' }] },
    { id: 'pace', type: 'checkbox', label: "data-ui's pace list above the goals", default: true },
    { id: 'levers', type: 'checkbox', label: "03's levers and odds under each open goal", default: true },
  ],
  blocks: [],
  limit: 1,
  presets: [{ name: 'Goals' }],
  empty: "This box has no goals yet. Add goals/G1-<slug>.md (vibe-goal, vibe-done-when, vibe-target, tier, set) and a '- Goal: G1 · step 1' line under each idea that serves it in ideas.md.",
};
