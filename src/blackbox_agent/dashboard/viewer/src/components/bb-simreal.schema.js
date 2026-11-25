// bb-simreal: the stock Sim × Real workspace (viewer/CONTRACT.md §21), the page a box's site serves at simreal/ when its
// site/nav.json names it. Pure: no DOM.
export default {
  tag: 'bb-simreal', name: 'Sim × Real', version: 1, wave: 3,
  description: 'A box\'s simulated results beside its real ones, one answer first ("Real is 0.074 picks/min; sim says 4.37: real is 1.7 % of sim"), then: the headline chart in the Ticker look with a Real / Sim / Both switch (real solid, sim hollow and dashed, a best-so-far line per world); two Pareto fronts on one chart over a shared time metric; sim against real per solution (a scatter with y = x) and the sim-to-real gap over time; one small sim-against-real chart per metric both worlds record; every pair as a table.',
  reads: ['simreal'],
  settings: [
    { id: 'world', type: 'select', label: 'Worlds on the headline chart', default: 'both',
      options: [{ value: 'both', label: 'Both' }, { value: 'real', label: 'Real' }, { value: 'sim', label: 'Sim' }] },
    { id: 'range', type: 'select', label: 'Range', default: 'All', options: ['1D', '5D', '1M', 'All'].map((r) => ({ value: r, label: r })) },
    { id: 'y', type: 'select', label: 'y scale', default: 'auto',
      options: [{ value: 'auto', label: 'Auto (log past 20×)' }, { value: 'log', label: 'Log' }, { value: 'linear', label: 'Linear' }] },
    { id: 'cost', type: 'text', label: 'Cost on the fronts\' x ("" = the first shared time metric)', default: '' },
    { id: 'parts', type: 'text', label: 'Parts, in order', default: 'answer,headline,fronts,pairs,metrics,table',
      info: 'answer, headline, fronts, pairs (the scatter and the gap over time), metrics (the small multiples), table' },
    { id: 'height', type: 'range', label: 'Headline chart height', min: 220, max: 640, step: 10, unit: 'px', default: 340 },
  ],
  blocks: [],
  limit: null,
  presets: [{ name: 'Sim × Real' }],
  events: ['bb-open'],
  empty: 'No simulated results yet. A box adds them to its ledger as rows with world: "sim", split: "sim", sim: {name, rung, profile} and the pair of the real row each predicts (same solution, same task); the next fold draws them here beside the real ones.',
};
