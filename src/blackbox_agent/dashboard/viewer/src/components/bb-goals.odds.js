/* bb-goals' odds (viewer/CONTRACT.md §20): proposals-goals/03-odds/odds.mjs @ 642290f as it is, its node CLI left
   out. The bottom-up estimate as a distribution: each open agent idea of a goal's roadmap takes its written effort ×
   buffer × exp(sigma·z) (sigma from the box's own pace spread), lands with the box's own hit rate (a miss costs one more
   idea of the roadmap's median effort), and a wait on Zach is a slot whose time the reader sets. Inputs: the goals
   slice's `odds` (tools/folds/goals.py), minutes after its as_of. JS == 03's Python draw for draw
   (tests/goals.test.mjs imports 03's build.py by path). Pure: no DOM. */
/** mulberry32: a 32-bit PRNG that both languages compute bit for bit (no floats until the last division). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a) >>> 0;
    t = (((t + (Math.imul(t ^ (t >>> 7), 61 | t) >>> 0)) >>> 0) ^ t) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// WHY rounding each draw to a micro-minute: Math.exp (V8's fdlibm) and Python's math.exp (glibc) may differ in the last
// bit; rounding makes the sums identical in both, so "JS == Python" is a real equality, not a tolerance.
const round6 = (x) => Math.floor(x * 1e6 + 0.5) / 1e6;
const at = (sorted, q) => sorted[Math.floor(q * (sorted.length - 1))];

/** One goal's Monte Carlo. settings: {buffer, start, slots: {id: minutes}, lanes, cut: [ids], due}. */
export function simulate(model, settings = {}) {
  const buffer = settings.buffer ?? model.buffer;
  const start = settings.start ?? model.start;
  const slots = { ...model.slots, ...(settings.slots || {}) };
  const lanes = Math.max(1, settings.lanes ?? 1);
  const cut = new Set(settings.cut || []);
  const due = settings.due ?? model.due;
  const steps = model.steps.filter((s) => !cut.has(s.id));
  const rng = mulberry32(model.seed);
  const z = () => { let s = 0; for (let i = 0; i < 12; i++) s += rng(); return s - 6; };
  const n = model.n;
  const finish = new Float64Array(n);
  const done = steps.map(() => new Float64Array(n));
  let onTime = 0, extra = 0;
  for (let d = 0; d < n; d++) {
    let free = new Array(lanes).fill(start);
    steps.forEach((s, j) => {
      if (s.kind === 'wait') {
        const t = Math.max(Math.max(...free), slots[s.id]);
        free = new Array(lanes).fill(t);
        done[j][d] = t;
        return;
      }
      let k = 0;
      for (let i = 1; i < lanes; i++) if (free[i] < free[k]) k = i;
      let dur = round6(s.min * buffer * Math.exp(model.sigma * z()));
      for (let tries = 0; tries < model.cap && rng() >= model.hit; tries++) {
        dur += round6(model.retry * buffer * Math.exp(model.sigma * z()));
        extra++;
      }
      free[k] = free[k] + dur;
      done[j][d] = free[k];
    });
    finish[d] = Math.max(...free);
    if (finish[d] <= due) onTime++;
  }
  const q = (arr) => { const s = Float64Array.from(arr).sort(); return { p10: at(s, 0.1), p50: at(s, 0.5), p90: at(s, 0.9) }; };
  return {
    n, on_time: onTime, p_on_time: onTime / n, extra_ideas: extra,
    finish: q(finish),
    steps: Object.fromEntries(steps.map((s, j) => [s.id, q(done[j])])),
  };
}

/** The numbers two runs are compared on: every quantile to the micro-minute, and the on-time count. */
export function fingerprint(r) {
  const f = (o) => [o.p10, o.p50, o.p90].map(round6);
  return { n: r.n, on_time: r.on_time, extra: r.extra_ideas, finish: f(r.finish),
    steps: Object.fromEntries(Object.entries(r.steps).map(([k, v]) => [k, f(v)])) };
}

/** JS's run of the model's default setting(s) against the Python numbers build.py stored beside it. */
export function parity(model) {
  return model.python.map((c) => {
    const js = JSON.stringify(fingerprint(simulate(model, c.settings)));
    const py = JSON.stringify(c.fingerprint);
    return { label: c.label, ok: js === py, js, py };
  });
}
