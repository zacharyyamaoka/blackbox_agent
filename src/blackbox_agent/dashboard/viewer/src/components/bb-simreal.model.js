/* The Sim × Real workspace's model (viewer/CONTRACT.md §21): the `simreal` slice read into what <bb-simreal> draws. Pure
   (no DOM): the node test runs it. Nothing here knows what a solution or a simulator is: ids, two worlds, one objective,
   the metrics both worlds record, and the pair key that joins a sim row to the real row it predicts.

   Zach, 2026-11-25: "Real is what matters at the end of the day, but often its the simulated things we get performance on
   first. So for example on the headline image it would be helpful to show like Real, Simulate, Both results or something.
   And could be nice on like draw two pareto fronts one for real and one for simulation."

   The rules (each the Black box dashboard's own, read for two worlds):
   - a best-so-far line per world, in the time its results describe (`at`); real moves on admissible real rows only (the
     headliner's rule), sim on every sim row that does not say it failed (sim rows carry no gates); a new best beats the
     last by a relative 1e-9 (GOTCHAS: a float tie is not progress);
   - a front per world over (a shared metric read as a cost, the objective): bb-frontier's own pareto() run per world, a
     metric offered as a cost when it is a time (_s, _ms, _min; bb-frontier's costs are lower-is-better), a row without
     that metric left off and counted, never plotted at 0;
   - real ÷ sim is the fold's, per pair and simulator (never recomputed here);
   - the answer is the newest real solution against its own sim, in the box's unit, its numbers from the state. */
import { RANGES, logTicks } from './bb-headliner.model.js';
import { makeFrontier } from './bb-frontier.model.js';

export { RANGES, logTicks };
export const WORLDS = [
  { id: 'both', label: 'Both', long: 'real and sim on one chart' },
  { id: 'real', label: 'Real', long: 'the real rows only: what the objective is judged on' },
  { id: 'sim', label: 'Sim', long: 'the sim rows only: where performance arrives first' },
];
const RELATIVE_TIE = 1e-9;
const TIME_UNIT = /(?:_s|_ms|_min)$/;
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const ms = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : null; };

/** A reading the way the box prints it: 3 decimals under 1 (0.074 picks/min), 3 significant digits from 1 (4.37), whole
    from 100; the full value is in each dot's card. */
export function fmt(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (Number.isInteger(v)) return v.toLocaleString('en-CA');
  const a = Math.abs(v);
  if (a >= 100) return Math.round(v).toLocaleString('en-CA');
  if (a >= 1) return String(+v.toPrecision(3));
  if (a >= 0.01 || a === 0) return v.toFixed(3);
  return String(+v.toPrecision(2));
}
/** A share in per cent: 15 %, 1.7 %, 0.54 %. */
export function pct(share) {
  if (!fin(share)) return '—';
  const p = 100 * share;
  return p >= 10 ? p.toFixed(0) : p >= 1 ? p.toFixed(1) : String(+p.toPrecision(2));
}
const unitText = (u) => (u ? ` ${u}` : '');
const words = (list) => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`);

export function makeSimReal(data) {
  const sr = data && data.simreal;
  const o = (data && data.objective) || {};
  const direction = o.direction === 'higher' ? 'higher' : 'lower';
  const beats = (a, b) => (b === null || b === undefined ? true
    : direction === 'lower' ? a < b - RELATIVE_TIE * Math.abs(b) : a > b + RELATIVE_TIE * Math.abs(b));
  const objective = { name: o.name || 'objective', unit: o.unit || '', direction, world: sr ? sr.objective_world || null : null };
  if (!sr || !Array.isArray(sr.rows) || !sr.rows.length) return { empty: true, objective };

  const rows = sr.rows.map((r, i) => ({ ...r, i, t: ms(r.at), t0: r.window ? ms(r.window.start) : null }));
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const real = rows.filter((r) => r.world === 'real');
  const sim = rows.filter((r) => r.world === 'sim' && r.split === 'sim');
  const holdout = rows.filter((r) => r.world === 'sim' && r.split !== 'sim');
  const ok = (r) => r.objective !== null && (r.world === 'real' ? r.admissible === true : r.admissible !== false);
  const of = (world) => (world === 'real' ? real : world === 'sim' ? sim : [...real, ...sim]);
  const ordered = (world) => of(world).slice().sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity) || a.i - b.i);

  /** The best-so-far steps of one world, oldest first: each row that beat every earlier one. */
  function line(world, list = ordered(world), from = null) {
    const out = [];
    let best = from;
    for (const r of list) if (ok(r) && beats(r.objective, best)) { best = r.objective; out.push({ id: r.id, at: r.at, t: r.t, y: r.objective, row: r }); }
    return out;
  }
  const bestOf = (world) => line(world).at(-1)?.row || null;

  const pairs = (sr.pairs || []).map((p) => ({ ...p, realRow: p.real ? byId[p.real] : null,
    sims: (p.ratios.length ? p.ratios.map((q) => ({ row: byId[q.sim], ratio: q.real_over_sim, why: q.why || null }))
      : p.sim.map((id) => ({ row: byId[id], ratio: null, why: p.real ? null : 'no real row yet' }))) }));
  const pairOf = (row) => pairs.find((p) => p.pair === row.pair) || null;

  /** One point per (pair, simulator) with a real row: sim on x, real on y, the fold's ratio. */
  function points() {
    const out = [];
    for (const p of pairs) {
      if (!p.realRow) continue;
      for (const s of p.sims) {
        out.push({ id: `${p.pair} @ ${s.row.simulator}`, pair: p.pair, solution: p.solution, task: p.task, cell: s.row.task,
          simulator: s.row.simulator, rung: s.row.rung, real: p.realRow.objective, sim: s.row.objective, ratio: s.ratio, why: s.why,
          at: p.realRow.at, t: p.realRow.t, sim_at: s.row.at });
      }
    }
    return out;
  }

  // ---------- the answer (one calm sentence first; Zach's own example: "Real is 0.074 SPPM; sim says 4.37: real is 1.7 %
  // of sim"), then the support under it
  function answer() {
    const u = unitText(objective.unit);
    const newest = real.filter((r) => r.objective !== null).sort((a, b) => (a.n ?? 0) - (b.n ?? 0) || (a.t ?? 0) - (b.t ?? 0) || a.i - b.i).at(-1) || null;
    const simBest = bestOf('sim');
    const realBest = bestOf('real');
    const lines = [];
    let text;
    let sims = [];
    if (!newest) {
      text = simBest ? `Nothing real yet; sim's best is ${fmt(simBest.objective)}${u}.` : 'Nothing real yet, and no sim row has a number.';
    } else {
      const p = pairOf(newest);
      sims = p ? p.sims.filter((s) => fin(s.row.objective)) : [];
      if (!sims.length) text = `Real is ${fmt(newest.objective)}${u}; no sim row predicts it yet (no sim row shares its pair).`;
      else {
        const vals = sims.map((s) => s.row.objective);
        const lo = Math.min(...vals), hi = Math.max(...vals);
        const said = fmt(lo) === fmt(hi) ? fmt(lo) : `${fmt(lo)} to ${fmt(hi)}`;
        const rs = sims.map((s) => s.ratio).filter(fin);
        const share = !rs.length ? null : pct(Math.min(...rs)) === pct(Math.max(...rs)) ? `${pct(rs[0])} %` : `${pct(Math.min(...rs))} to ${pct(Math.max(...rs))} %`;
        text = `Real is ${fmt(newest.objective)}${u}; sim says ${said}: ${share ? `real is ${share} of sim` : sims[0].why || 'no ratio'}.`;
        const names = sims.map((s) => s.row.simulator);
        const says = names.length === 1 ? `${names[0]} says ${said}${u}` : fmt(lo) === fmt(hi) ? `${words(names)} both say ${said}${u}`
          : sims.map((s) => `${s.row.simulator} ${fmt(s.row.objective)}`).join(', ') + u;
        const cells = [...new Set(sims.map((s) => s.row.task).filter(Boolean))];
        lines.push(`${newest.solution}, the newest real solution, on ${newest.task || 'its cell'} · ${says}${cells.length ? ` on ${cells.join(', ')}` : ''}`);
      }
    }
    if (realBest && (!newest || realBest.id !== newest.id)) {
      const p = pairOf(realBest);
      const r = p ? p.sims.map((s) => s.ratio).filter(fin) : [];
      lines.push(`best real so far: ${realBest.solution} ${fmt(realBest.objective)}${u}${r.length ? ` (${pct(Math.max(...r))} % of its sim)` : ''}`);
    }
    if (simBest) {
      const p = pairOf(simBest);
      lines.push(`best in sim: ${fmt(simBest.objective)}${u} (${simBest.solution} · ${simBest.simulator} · ${simBest.task})${p && p.realRow ? `, its real ${fmt(p.realRow.objective)}` : ', not on the real arm yet'}`);
    }
    return { text, lines, solution: newest ? newest.solution : null, newest, sims, realBest, simBest };
  }

  // ---------- the headline chart: both worlds on one time axis, a window anchored to the newest result
  /** What one (worlds, range) draws: per world its points, its best-so-far steps from where the window opened, the x
      domain over everything drawn (a real row's whole window included), y over the values above 0 (log has no 0). */
  function view(worlds = 'both', rangeId = 'All') {
    const on = worlds === 'both' ? ['real', 'sim'] : [worlds];
    const timed = on.flatMap((w) => of(w).filter((r) => r.t !== null));
    const anchor = timed.length ? Math.max(...timed.map((r) => r.t)) : 0;
    const R = RANGES.find((q) => q.id === rangeId) || RANGES.at(-1);
    const start = R.ms === null ? -Infinity : anchor - R.ms;
    const out = { worlds: on, rangeId: R.id, anchor, start, world: {} };
    const xs = [], ys = [];
    for (const w of on) {
      const list = ordered(w).filter((r) => r.t !== null);
      const shown = list.filter((r) => r.t >= start);
      const before = list.filter((r) => r.t < start);
      const open = line(w, before).at(-1) || null;
      const steps = line(w, shown, open ? open.y : null);
      const end = steps.length ? steps.at(-1).y : open ? open.y : null;
      out.world[w] = { shown, open, steps, end, zeros: shown.filter((r) => r.objective === 0), untimed: of(w).filter((r) => r.t === null) };
      for (const r of shown) { xs.push(r.t); if (r.t0 !== null && r.t0 >= start) xs.push(r.t0); if (fin(r.objective) && r.objective > 0) ys.push(r.objective); }
      if (open && open.y > 0) ys.push(open.y);
    }
    let lo = xs.length ? Math.min(...xs) : anchor - 3600e3, hi = xs.length ? Math.max(...xs) : anchor + 3600e3;
    const pad = Math.max((hi - lo) * 0.04, 30 * 60e3);
    out.domain = [lo - pad, hi + pad];
    out.ymin = ys.length ? Math.min(...ys) : 1;
    out.ymax = ys.length ? Math.max(...ys) : 1;
    out.span = out.ymin > 0 ? out.ymax / out.ymin : Infinity;
    return out;
  }
  const counted = (worlds, rangeId) => { const v = view(worlds, rangeId); return v.worlds.reduce((a, w) => a + v.world[w].shown.length, 0); };

  // ---------- two fronts: bb-frontier's pareto() per world over (cost, objective)
  const shared = (sr.metrics || []).filter((m) => m.shared);
  const costs = shared.filter((m) => !m.objective && TIME_UNIT.test(m.id)).map((m) => m.id);
  const frontiers = {};
  const frontierOf = (world) => {
    if (!frontiers[world]) {
      const list = ordered(world);
      frontiers[world] = makeFrontier({
        objective: { direction },
        iterations: list.map((r, k) => ({ id: r.id, n: k + 1, objective: r.objective, admissible: ok(r), created: r.at, change: r.task || '' })),
        costs: list.map((r) => ({ id: r.id, ...Object.fromEntries(costs.map((c) => [c, fin(r.metrics[c]) ? r.metrics[c] : null])) })),
      });
    }
    return frontiers[world];
  };
  /** The front of each world on one cost, the rows drawn and the rows left off (no value for it). */
  function front(cid) {
    const out = { cid, real: [], sim: [], drawn: {}, off: {} };
    for (const w of ['real', 'sim']) {
      const fr = frontierOf(w);
      out[w] = fr.pareto(fr.search, cid).map((s) => byId[s.id]);
      out.drawn[w] = of(w).filter((r) => fin(r.metrics[cid]) && fin(r.objective));
      out.off[w] = of(w).filter((r) => !fin(r.metrics[cid]));
    }
    return out;
  }

  // ---------- small multiples: each metric both worlds record, sim (x) against real (y) per pair and simulator
  const multiples = shared.map((m) => {
    const pts = [];
    for (const p of pairs) {
      if (!p.realRow) continue;
      for (const s of p.sims) {
        const x = s.row.metrics[m.id], y = p.realRow.metrics[m.id];
        if (fin(x) && fin(y)) pts.push({ id: `${p.pair} @ ${s.row.simulator} · ${m.id}`, metric: m.id, solution: p.solution, simulator: s.row.simulator, sim: x, real: y });
      }
    }
    return { id: m.id, unit: m.unit || null, objective: !!m.objective, real: m.real, sim: m.sim, points: pts };
  });

  /** The ratio of each point over time (the real row's `at`), per simulator. */
  const gap = () => points().filter((p) => fin(p.ratio) && p.t !== null).sort((a, b) => a.t - b.t);

  const simulators = sr.simulators || [];
  return {
    empty: false, objective, direction, beats, slice: sr, rows, byId, real, sim, holdout, ok, ordered, line, bestOf, pairs, pairOf,
    points, gap, answer: answer(), view, counted, costs, front, multiples, simulators, counts: sr.counts || {},
  };
}
