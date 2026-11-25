/* <bb-simreal>: the stock Sim × Real workspace (viewer/CONTRACT.md §21), one more dashboard in a box's site bar beside the
   Black box dashboard, which stays as it is. Reads only state.json `simreal` (the fold's slice, CONTRACT §21.2).

   Zach, 2026-11-25: "Lets have a Sim X Real Tab basically then we add as a workspace. and there we shows the charts for
   things that Are doing simulation we show how like the stuff is comparing between sim and real. This is good as it
   keeps the blackbox dashboard simpler which is good, there is almost to much going on there already."

   Top to bottom (each a part, `parts` picks and orders them), one answer first and the detail below (the calm-UI rule):
   1. the answer: "Real is 0.074 picks/min; sim says 4.37: real is 1.7 % of sim." (the newest real solution against its
      own sim, numbers from the state), what it rests on, and the counts;
   2. the headline chart in the Ticker look (bb-headliner's stylesheet and range rules) with a Real / Sim / Both switch:
      real solid (filled dots, its measured window as a whisker), sim hollow (a shape per simulator) and dashed, a
      best-so-far line per world, on one time axis;
   3. two Pareto fronts on one chart: bb-frontier's pareto() run per world over a shared metric read as a cost;
   4. sim against real per solution (a scatter with y = x: does sim predict real?) and the sim-to-real gap over time
      (real ÷ sim), from the pairs;
   5. small multiples: one sim-against-real chart per metric both worlds record;
   6. every pair as a table.

   STOCK PARTS: uPlot 1.6.32 (the headliner's and the frontier's) draws the canvas, the scales (log or linear), the time
   axis and the grid of parts 2 and 3; ours, as theirs, is one draw hook (the step lines, the dots, the whiskers) and the
   2-D nearest-dot hover. WHY uPlot there: data-ui has no stock ticker (viewer README, follow-up 2) and its chart view
   opens its own peek on a dot instead of the solution (§16.3). Parts 4 to 6 are data-ui's own `chart` and `table` views
   (`<data-views>` with an inline .base, nothing hand-drawn); the y = x line is a Vega-Lite rule layer, because data-ui's
   `indexLine` guide spans only the dots' x extent (a pair set at one sim value draws it as a point): a data-ui gap,
   CONTRACT §21.6. */
import uPlot from '../../vendor/uplot/uPlot.esm.js';
import uplotCss from '../../vendor/uplot/uPlot.css.js';
import { BBElement, esc } from '../core/element.js';
import { register } from '../core/registry.js';
import { adoptCss, onTheme, cssVar } from '../core/tokens.js';
import { loadViews } from '../core/kit.js';
import tickerCss from './bb-headliner.css.js';
import { makeSimReal, WORLDS, RANGES, logTicks, fmt, pct } from './bb-simreal.model.js';
import schema from './bb-simreal.schema.js';

export const PARTS = ['answer', 'headline', 'fronts', 'pairs', 'metrics', 'table'];
const RANGE_IDS = ['1D', '5D', '1M', 'All'];
const SHAPES = ['circle', 'square', 'diamond', 'triangle'];
const dtf = new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtDate = (t) => (Number.isFinite(t) ? dtf.format(new Date(t)) : '—');
const tickFmt = (v) => (v === null || v === undefined ? '' : Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-CA') : String(+(+v).toPrecision(3)));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
let uid = 0;

// the Ticker look: bb-headliner's own stylesheet, scoped to this element (its .bbh-* classes, chips, segments, tip)
const OWN = `
bb-simreal { --bbsr-real: var(--bb-best); --bbsr-sim: #6d5bd0; display: block; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) bb-simreal { --bbsr-sim: #a99bf5; } }
:root[data-theme="dark"] bb-simreal { --bbsr-sim: #a99bf5; }
bb-simreal .bbsr { display: grid; gap: 20px; min-width: 0; }
bb-simreal .bbsr-answer { min-width: 0; padding: 4px 2px 0; }
bb-simreal .bbsr-kicker { font-size: 13px; color: var(--bb-muted); margin: 0 0 4px; overflow-wrap: anywhere; }
bb-simreal .bbsr-kicker b { color: var(--bb-fg); font-weight: 600; }
bb-simreal .bbsr-say { font-size: 26px; font-weight: 650; line-height: 1.25; letter-spacing: -0.01em; margin: 0; overflow-wrap: anywhere; }
bb-simreal .bbsr-why { margin: 8px 0 0; padding: 0; list-style: none; font-size: 13.5px; color: var(--bb-muted); display: grid; gap: 3px; }
bb-simreal .bbsr-why li { overflow-wrap: anywhere; }
bb-simreal .bbsr-meta { font-size: 12.5px; color: var(--bb-faint); margin-top: 8px; overflow-wrap: anywhere; }
bb-simreal .bbsr-h { font-size: 18px; font-weight: 650; margin: 2px 0 0; letter-spacing: -0.2px; overflow-wrap: anywhere; }
bb-simreal .bbsr-q { font-size: 13px; color: var(--bb-muted); margin: 2px 0 0; overflow-wrap: anywhere; }
bb-simreal .bbsr-nums { display: flex; flex-wrap: wrap; gap: 4px 22px; align-items: baseline; margin-top: 8px; }
bb-simreal .bbsr-num { display: inline-flex; align-items: baseline; gap: 6px; min-width: 0; }
bb-simreal .bbsr-num .v { font-size: 30px; font-weight: 650; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; line-height: 1.15; }
bb-simreal .bbsr-num .u { font-size: 14px; color: var(--bb-muted); }
bb-simreal .bbsr-num .w { font-size: 13px; color: var(--bb-muted); }
bb-simreal .bbsr-two { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 430px), 1fr)); gap: 20px; min-width: 0; }
bb-simreal .bbsr-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: 14px; margin-top: 10px; min-width: 0; }
bb-simreal .bbsr-cell { min-width: 0; border: 1px solid var(--bb-border); border-radius: 12px; padding: 10px 10px 6px; }
bb-simreal .bbsr-cell h4 { margin: 0 0 2px; font-size: 13.5px; font-weight: 600; overflow-wrap: anywhere; }
bb-simreal .bbsr-cell h4 .k { color: var(--bb-muted); font-weight: 400; }
bb-simreal .bbsr-view { min-width: 0; margin-top: 8px; }
bb-simreal .bbsr-view data-views { min-width: 0; }
bb-simreal .bbsr-wait { color: var(--bb-muted); font-size: 13px; }
bb-simreal .bbsr-note { font-size: 12.5px; color: var(--bb-muted); margin-top: 6px; overflow-wrap: anywhere; }
bb-simreal .bbsr-note b { color: var(--bb-fg); font-weight: 600; }
bb-simreal .bbsr-front { display: grid; gap: 3px; font-size: 12.5px; color: var(--bb-muted); margin: 6px 0 2px; overflow-wrap: anywhere; }
bb-simreal .bbsr-front b { color: var(--bb-fg); font-weight: 600; }
bb-simreal .bbsr-none { border: 1px dashed var(--bb-border); border-radius: 12px; padding: 14px; color: var(--bb-muted); font-size: 13.5px; margin-top: 10px; }
bb-simreal .bbsr-none b { color: var(--bb-fg); font-weight: 600; }
bb-simreal .bbsr-none code, bb-simreal .bbsr-note code { font-family: var(--bb-mono); font-size: .92em; }
bb-simreal .sw { display: inline-block; flex: none; vertical-align: middle; }
bb-simreal .lg-real-line { width: 18px; height: 0; border-top: 2.2px solid var(--bbsr-real); }
bb-simreal .lg-sim-line { width: 18px; height: 0; border-top: 2.2px dashed var(--bbsr-sim); }
bb-simreal .lg-real-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--bbsr-real); }
bb-simreal .lg-sim-dot { width: 10px; height: 10px; border-radius: 50%; border: 1.6px solid var(--bbsr-sim); }
bb-simreal .lg-sim-square { width: 10px; height: 10px; border: 1.6px solid var(--bbsr-sim); }
bb-simreal .lg-sim-diamond { width: 9px; height: 9px; border: 1.6px solid var(--bbsr-sim); transform: rotate(45deg); }
bb-simreal .lg-sim-triangle { width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-bottom: 10px solid var(--bbsr-sim); }
bb-simreal .lg-win { width: 18px; height: 0; border-top: 1.2px solid var(--bbsr-real); opacity: .6; }
bb-simreal .lg-front { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--bb-fg); }
bb-simreal .bbh-ring { display: none; }
@media (max-width: 520px) { bb-simreal .bbsr-say { font-size: 21px; } bb-simreal .bbsr-num .v { font-size: 24px; } }
`;

export class BBSimReal extends BBElement {
  static schema = schema;
  static css = tickerCss.replaceAll('bb-headliner ', 'bb-simreal ') + OWN;

  constructor() {
    super();
    this.charts = {};
    this.ui = null;
    this.hovered = null;
  }

  connectedCallback() {
    adoptCss('uplot', uplotCss);
    super.connectedCallback();
    this._stopTheme ||= onTheme(() => this.m && !this.m.empty && this.repaint());
    this._ro ||= new ResizeObserver(() => {
      for (const [k, u] of Object.entries(this.charts)) {
        const el = this.querySelector(`[data-chart="${k}"]`);
        if (u && el && el.clientWidth && Math.abs(el.clientWidth - u.width) > 1) u.setSize({ width: el.clientWidth, height: el.clientHeight });
      }
    });
    this._ro.observe(this);
  }

  teardown() {
    this._stopTheme?.(); this._stopTheme = null;
    this._ro?.disconnect(); this._ro = null;
    this.destroyCharts();
  }

  destroyCharts() { for (const u of Object.values(this.charts)) u?.destroy(); this.charts = {}; }

  parts() {
    const want = String(this.settings.parts || '').split(',').map((p) => p.trim()).filter((p) => PARTS.includes(p));
    return want.length ? [...new Set(want)] : PARTS;
  }

  render() {
    const s = this.settings;
    this.destroyCharts();
    this.m = makeSimReal(this.data);
    delete this.dataset.drew;
    if (this.m.empty) { this.empty(); this.dataset.drew = 'empty'; return; }
    const m = this.m;
    this.ui = { world: s.world, range: s.range, y: s.y, cost: m.costs.includes(s.cost) ? s.cost : m.costs[0] || null, logx: null };
    const html = { answer: () => this.answerHtml(), headline: () => this.headlineHtml(), fronts: () => this.frontsHtml(),
      pairs: () => this.pairsHtml(), metrics: () => this.metricsHtml(), table: () => this.tableHtml() };
    const parts = this.parts();
    this.innerHTML = `<div class="bbsr" data-worlds="${m.real.length} real, ${m.sim.length} sim">${parts.map((p) => html[p]()).join('')}</div><div class="bbh-tip" hidden></div>`;
    this.querySelectorAll('[data-open]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); this.open(a.dataset.open); }));
    if (parts.includes('headline')) this.paintHeadline();
    if (parts.includes('fronts')) this.paintFronts();
    this.mountViews(parts);
  }

  repaint() {
    if (this.querySelector('[data-part="headline"]')) this.paintHeadline();
    if (this.querySelector('[data-part="fronts"]')) this.paintFronts();
  }

  /** bb-open {kind: 'solution', id}: a real solution is a row of the Black box dashboard's Iterations. */
  open(id) { return this.context.open(this, { kind: 'solution', id, href: this.context.href('solution', { id }) }); }

  unit() { return this.m.objective.unit || ''; }
  objName() { return this.m.objective.name || 'objective'; }

  // ── 1. the answer ────────────────────────────────────────────────────────────────────────────────────────────────
  answerHtml() {
    const m = this.m, d = this.data, a = m.answer, c = m.counts;
    const sims = m.simulators.map((x) => `${x.name} ${x.rows}`).join(', ');
    const worldWord = m.objective.world ? ` · the objective is judged on <b>${esc(m.objective.world)}</b> (OBJECTIVES.md)` : '';
    return `<section class="bbsr-answer" data-part="answer">
      <p class="bbsr-kicker"><b>${esc(d.box || '')}</b> · ${esc(this.objName())}${this.unit() ? ` (${esc(this.unit())}, ${m.direction} is better)` : ` (${m.direction} is better)`}${worldWord}</p>
      <p class="bbsr-say" data-answer>${esc(a.text)}</p>
      ${a.lines.length ? `<ul class="bbsr-why">${a.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
      <div class="bbsr-meta">${plural(c.real ?? m.real.length, 'real row')} · ${plural(c.sim ?? m.sim.length, 'sim row')}${sims ? ` (${esc(sims)})` : ''} · ${plural(c.paired ?? 0, 'real solution')} paired with sim by <code>pair</code>${c.sim_only ? `, ${plural(c.sim_only, 'sim-only pair')}` : ''}${d.ref ? ` · as of ${esc(d.ref)}` : ''}</div>
    </section>`;
  }

  // ── 2. the headline chart (the Ticker look, two worlds) ──────────────────────────────────────────────────────────
  headlineHtml() {
    const s = this.settings;
    return `<section class="bbh" data-part="headline">
      <div class="bbh-box"><b>Real and sim over time</b> · ${esc(this.objName())}${this.unit() ? ` (${esc(this.unit())})` : ''} · a best-so-far line per world</div>
      <div class="bbsr-nums" data-nums aria-live="polite"></div>
      <div class="bbh-sub" data-sub></div>
      <div class="bbh-bar"><div class="chips" role="group" aria-label="Time window" data-chips></div>
        <div class="bbh-right"><span class="bbh-ctl">show <span class="seg" data-seg="world"></span></span><span class="bbh-ctl">y <span class="seg" data-seg="y"></span></span></div></div>
      <div class="bbh-chart" data-chart="headline" style="height:${s.height}px"></div>
      <div class="bbh-foot"><div class="bbh-legend" data-legend="headline"></div><div class="bbh-hint">Point at a dot for its card · click a real one to open the solution</div></div>
      <div class="bbsr-note" data-note="headline"></div>
    </section>`;
  }

  seg(scope, name, options, current, pick) {
    const el = scope.querySelector(`[data-seg="${name}"]`);
    if (!el) return;
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', name === 'world' ? 'Worlds shown' : `${name} axis`);
    el.innerHTML = options.map((o) => `<button type="button" data-v="${o.id}" aria-pressed="${o.id === current}" title="${esc(o.long || o.label)}">${esc(o.label)}</button>`).join('');
    el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => pick(b.dataset.v)));
  }

  /** log y past a 20x span (the headliner's rule), unless the reader picked; never log over a value <= 0 in the scale. */
  yLog(setting, ymin, ymax) {
    if (setting === 'linear') return false;
    if (setting === 'log') return ymin > 0;
    return ymin > 0 && ymax / ymin > 20;
  }

  paintHeadline() {
    const sec = this.querySelector('[data-part="headline"]');
    if (!sec) return;
    const m = this.m, ui = this.ui, unit = this.unit();
    const v = this.hv = m.view(ui.world, ui.range);
    const chips = sec.querySelector('[data-chips]');
    chips.innerHTML = RANGE_IDS.map((id) => {
      const r = RANGES.find((q) => q.id === id);
      const n = m.counted(ui.world, id);
      return `<button type="button" class="chip" data-range="${id}" aria-pressed="${id === v.rangeId}" title="${esc(`${r.long}: ${plural(n, 'result')}`)}">${id}</button>`;
    }).join('');
    chips.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { this.ui.range = b.dataset.range; this.paintHeadline(); }));
    this.seg(sec, 'world', WORLDS, ui.world, (id) => { this.ui.world = id; this.paintHeadline(); });
    const ylog = this.yLog(ui.y, v.ymin, v.ymax);
    this.seg(sec, 'y', [{ id: 'log', label: 'Log' }, { id: 'linear', label: 'Linear' }], ylog ? 'log' : 'linear', (id) => { this.ui.y = id; this.paintHeadline(); });
    // the numbers: each world's best in the window (the Ticker's big number, one per world)
    const nums = sec.querySelector('[data-nums]');
    nums.innerHTML = v.worlds.map((w) => {
      const x = v.world[w];
      const best = x.steps.at(-1)?.row || (x.open && x.open.row) || null;
      return `<span class="bbsr-num" data-world="${w}"><i class="sw lg-${w}-dot"></i><span class="w">${w === 'real' ? 'Real best' : 'Sim best'}</span>
        <span class="v">${fmt(x.end)}</span>${unit ? `<span class="u">${esc(unit)}</span>` : ''}${best ? `<span class="w">${esc(best.solution)}${w === 'sim' ? ` · ${esc(best.simulator)}` : ''}</span>` : ''}</span>`;
    }).join('');
    this.subText(null);
    // the legend: one entry per mark drawn, the simulators by shape
    const sims = m.simulators.map((x) => x.name);
    const lg = [];
    if (v.worlds.includes('real')) {
      lg.push('<span><i class="sw lg-real-line"></i>real: best so far (admissible only)</span><span><i class="sw lg-real-dot"></i>real solution</span>');
      if (m.real.some((r) => r.t0 !== null)) lg.push('<span><i class="sw lg-win"></i>the window it was measured over</span>');
      if (m.real.some((r) => !m.ok(r) && r.objective !== null)) lg.push('<span><i class="lg-ring"></i>real, not admissible</span>');
    }
    if (v.worlds.includes('sim')) {
      lg.push('<span><i class="sw lg-sim-line"></i>sim: best so far</span>');
      sims.forEach((n, i) => lg.push(`<span><i class="sw lg-sim-${SHAPES[i % SHAPES.length] === 'circle' ? 'dot' : SHAPES[i % SHAPES.length]}"></i>sim · ${esc(n)}</span>`));
    }
    sec.querySelector('[data-legend="headline"]').innerHTML = lg.join('');
    const notes = [];
    const zeros = v.worlds.flatMap((w) => v.world[w].zeros);
    if (zeros.length && ylog) notes.push(`${plural(zeros.length, 'result')} scored 0 ${esc(unit)}: drawn on the floor of the log axis (a log axis has no 0).`);
    const untimed = v.worlds.flatMap((w) => v.world[w].untimed);
    if (untimed.length) notes.push(`${plural(untimed.length, 'row')} with no time left off.`);
    if (m.holdout.length) notes.push(`${plural(m.holdout.length, 'sim hold-out row')} (reporting only) not drawn.`);
    const at = new Set(m.rows.map((r) => r.at_from).filter(Boolean));
    notes.push(`Time: ${[...at].map((f) => ({ 'window.end': 'a real row at the end of the window it measured', 'source.started_at': 'a sim row when its run started', t: 'when the row was scored' }[f] || f)).join('; ')}.`);
    sec.querySelector('[data-note="headline"]').innerHTML = notes.join(' ');

    const C = this.colors();
    const pts = [];
    const shapeOf = (name) => SHAPES[Math.max(0, sims.indexOf(name)) % SHAPES.length];
    for (const w of v.worlds) for (const r of v.world[w].shown) pts.push({ x: r.t, y: r.objective, row: r });
    const [lo, hi] = v.domain;
    const yr = this.yRange(v.ymin, v.ymax, ylog, zeros.length > 0);
    this.plot('headline', sec.querySelector('[data-chart="headline"]'), {
      x: { lo, hi, time: true }, y: { lo: yr[0], hi: yr[1], log: ylog }, pts, C,
      marks: (u, X, Y, ctx, dpr) => {
        const right = u.bbox.left + u.bbox.width;
        for (const w of v.worlds) {
          const x = v.world[w];
          const steps = [...(x.open ? [{ t: lo, y: x.open.y }] : []), ...x.steps];
          if (!steps.length) continue;
          ctx.save();
          ctx.strokeStyle = w === 'real' ? C.real : C.sim; ctx.lineWidth = 2.2 * dpr;
          ctx.setLineDash(w === 'sim' ? [6 * dpr, 4 * dpr] : []);
          ctx.beginPath();
          steps.forEach((p, i) => { const px = X(p.t), py = Y(p.y); if (!i) ctx.moveTo(px, py); else { ctx.lineTo(px, Y(steps[i - 1].y)); ctx.lineTo(px, py); } });
          ctx.lineTo(right, Y(steps.at(-1).y));
          ctx.stroke(); ctx.restore();
        }
        // dots: sim first (hollow, a shape per simulator), real on top (filled; its window a whisker; a failure a red ring)
        for (const p of pts.filter((q) => q.row.world === 'sim')) this.shape(ctx, X(p.x), Y(this.floorY(p.y, yr, ylog)), shapeOf(p.row.simulator), 4.6 * dpr, C.sim, C.card, dpr);
        for (const p of pts.filter((q) => q.row.world === 'real')) {
          const r = p.row, px = X(p.x), py = Y(this.floorY(p.y, yr, ylog));
          if (r.t0 !== null) {
            const x0 = X(Math.max(r.t0, lo));
            ctx.save(); ctx.globalAlpha = 0.55; ctx.strokeStyle = C.real; ctx.lineWidth = 1.2 * dpr;
            ctx.beginPath(); ctx.moveTo(x0, py); ctx.lineTo(px, py); ctx.moveTo(x0, py - 4 * dpr); ctx.lineTo(x0, py + 4 * dpr); ctx.stroke(); ctx.restore();
          }
          if (this.m.ok(r)) { ctx.fillStyle = C.real; ctx.beginPath(); ctx.arc(px, py, 5.2 * dpr, 0, 2 * Math.PI); ctx.fill(); }
          else { ctx.fillStyle = C.card; ctx.strokeStyle = C.bad; ctx.lineWidth = 1.8 * dpr; ctx.beginPath(); ctx.arc(px, py, 5.5 * dpr, 0, 2 * Math.PI); ctx.fill(); ctx.stroke(); }
        }
      },
      onHover: (row) => this.subText(row),
    });
  }

  /** The line under the numbers: the window's counts, or the row the reader points at. */
  subText(row) {
    const el = this.querySelector('[data-part="headline"] [data-sub]');
    if (!el) return;
    if (!row) {
      const v = this.hv;
      el.innerHTML = v.worlds.map((w) => `${plural(v.world[w].shown.length, `${w} result`)}`).join(' · ') + (v.rangeId === 'All' ? '' : ` in ${esc(v.rangeId)} up to the newest`);
      return;
    }
    el.innerHTML = `<span class="who">${esc(row.solution)}</span>${row.world === 'sim' ? ` · sim · ${esc(row.simulator)}` : ' · real'} · ${esc(row.task || '')} · ${fmt(row.objective)}${this.unit() ? ` ${esc(this.unit())}` : ''}`;
  }

  floorY(y, yr, log) { return log && !(y > 0) ? yr[0] * Math.pow(yr[1] / yr[0], 0.012) : y; }

  yRange(ymin, ymax, log, zeros) {
    if (log) return [ymin / (zeros ? 2.2 : 1.5), ymax * 1.5];
    const lo = zeros ? 0 : ymin, span = ymax - lo;
    const pad = span > 0 ? span * 0.08 : Math.max(Math.abs(ymax) * 0.1, 1e-9);
    return [lo >= 0 ? Math.max(0, lo - pad) : lo - pad, ymax + pad];
  }

  shape(ctx, x, y, kind, r, stroke, fill, dpr) {
    ctx.save();
    ctx.strokeStyle = stroke; ctx.fillStyle = fill; ctx.lineWidth = 1.6 * dpr;
    ctx.beginPath();
    if (kind === 'square') ctx.rect(x - r, y - r, 2 * r, 2 * r);
    else if (kind === 'diamond') { ctx.moveTo(x, y - r * 1.25); ctx.lineTo(x + r * 1.25, y); ctx.lineTo(x, y + r * 1.25); ctx.lineTo(x - r * 1.25, y); ctx.closePath(); }
    else if (kind === 'triangle') { ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r * 1.1, y + r * 0.8); ctx.lineTo(x - r * 1.1, y + r * 0.8); ctx.closePath(); }
    else ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
    ctx.restore();
  }

  colors() {
    const c = (n) => cssVar(this, n);
    return { card: c('--bb-card'), fg: c('--bb-fg'), muted: c('--bb-muted'), faint: c('--bb-faint'), grid: c('--bb-grid'), bad: c('--bb-bad'),
      real: c('--bbsr-real'), sim: c('--bbsr-sim'), font: c('--bb-font') };
  }

  /** One uPlot canvas for axes, scales and grid; everything on it drawn by `marks` (the frontier's way); the nearest dot
      within 24 px is hovered (its card) and, for a real row, opened on click. */
  plot(key, el, { x, y, pts, C, marks, onHover }) {
    if (this.charts[key]) { this.charts[key].destroy(); delete this.charts[key]; }
    if (!el) return;
    const axisFont = `11px ${C.font}`;
    const opts = {
      width: el.clientWidth || 600, height: el.clientHeight || 300, pxAlign: 0, padding: [12, 16, 0, 6], legend: { show: false }, ms: 1,
      cursor: { x: false, y: false, points: { show: false }, drag: { x: false, y: false, setScale: false, click: () => {} }, focus: { prox: -1 } },
      select: { show: false },
      scales: {
        x: { time: !!x.time, ...(x.log ? { distr: 3, log: 10 } : { distr: 1 }), range: () => [x.lo, x.hi] },
        y: { ...(y.log ? { distr: 3, log: 10 } : { distr: 1 }), range: () => [y.lo, y.hi] },
      },
      axes: [
        { stroke: C.muted, grid: { stroke: C.grid, width: 1 }, ticks: { stroke: C.grid }, font: axisFont, space: 64, size: 32,
          ...(x.time ? {} : { values: (u, sp) => sp.map(tickFmt) }), ...(x.log ? { splits: (u, ai, mn, mx) => logTicks(mn, mx, 9), filter: (u, sp) => sp } : {}) },
        { stroke: C.muted, grid: { stroke: C.grid, width: 1 }, ticks: { show: false }, font: axisFont, size: 46, space: 30,
          values: (u, sp) => sp.map(tickFmt), ...(y.log ? { splits: (u, ai, mn, mx) => logTicks(mn, mx), filter: (u, sp) => sp } : {}) },
      ],
      series: [{}, { paths: () => null, points: { show: false } }],
      hooks: {
        draw: [(u) => {
          const ctx = u.ctx, dpr = uPlot.pxRatio || 1;
          const X = (v) => u.valToPos(v, 'x', true), Y = (v) => u.valToPos(v, 'y', true);
          ctx.save();
          ctx.beginPath(); ctx.rect(u.bbox.left - 8 * dpr, u.bbox.top - 8 * dpr, u.bbox.width + 16 * dpr, u.bbox.height + 16 * dpr); ctx.clip();
          marks(u, X, Y, ctx, dpr);
          ctx.restore();
        }],
        setCursor: [(u) => {
          const { left, top } = u.cursor;
          if (left === undefined || left < 0) { this.hover(key, null); return; }
          let near = null, dist = 24;
          for (const p of pts) {
            const py = y.log && !(p.y > 0) ? this.floorY(p.y, [y.lo, y.hi], true) : p.y;
            if (!fin(p.x) || !fin(py)) continue;
            const d = Math.hypot(u.valToPos(p.x, 'x') - left, u.valToPos(py, 'y') - top);
            if (d <= dist) { dist = d; near = { ...p, yAt: py }; }
          }
          this.hover(key, near);
          onHover?.(near ? near.row : null);
        }],
      },
    };
    const u = new uPlot(opts, [[x.lo, x.hi], [null, null]], el);
    this.charts[key] = u;
    u.over.addEventListener('mouseleave', () => { this.hover(key, null); onHover?.(null); });
    u.over.addEventListener('click', () => { const h = this.hovered; if (h && h.key === key && h.row.world === 'real') this.open(h.row.solution); });
    u.__pts = pts;
  }

  hover(key, p) {
    const tip = this.querySelector('.bbh-tip');
    const u = this.charts[key];
    if (!tip) return;
    if (!p || !u) { if (!this.hovered || this.hovered.key === key) { tip.hidden = true; this.hovered = null; } if (u) u.over.style.cursor = ''; return; }
    this.hovered = { key, row: p.row };
    u.over.style.cursor = p.row.world === 'real' ? 'pointer' : 'default';
    tip.innerHTML = this.tipHtml(p.row, key);
    tip.hidden = false;
    const r = u.over.getBoundingClientRect();
    const cx = r.left + u.valToPos(p.x, 'x'), cy = r.top + u.valToPos(p.yAt, 'y');
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let l = cx + 14, t = cy + 14;
    if (l + w > innerWidth - 8) l = cx - w - 14;
    if (l < 8) l = 8;
    if (t + h > innerHeight - 8) t = cy - h - 14;
    tip.style.left = `${l}px`;
    tip.style.top = `${Math.max(8, t)}px`;
  }

  tipHtml(r, key) {
    const m = this.m, unit = this.unit();
    const u = (v) => `${fmt(v)}${unit ? ` ${esc(unit)}` : ''}`;
    const p = m.pairOf(r);
    let pairLine = '';
    if (p && r.world === 'real' && p.sims.length) pairLine = `<div><span class="k">its sim:</span> ${p.sims.map((s) => `${esc(s.row.simulator)} ${fmt(s.row.objective)}${fin(s.ratio) ? ` (real is ${pct(s.ratio)} %)` : ''}`).join(' · ')}</div>`;
    if (p && r.world === 'sim') {
      const mine = p.sims.find((s) => s.row.id === r.id);
      pairLine = p.realRow ? `<div><span class="k">its real:</span> ${u(p.realRow.objective)}${mine && fin(mine.ratio) ? ` (real is ${pct(mine.ratio)} % of this)` : ''}</div>` : '<div class="k">no real row shares its pair yet</div>';
    }
    const when = r.at_from === 'window.end' && r.t0 !== null ? `measured ${fmtDate(r.t0)} → ${fmtDate(r.t)}` : r.at_from === 'source.started_at' ? `run ${fmtDate(r.t)}` : `scored ${fmtDate(r.t)}`;
    const cost = key === 'fronts' && this.ui.cost ? `<div><span class="k">${esc(this.ui.cost)}</span> ${fmt(r.metrics[this.ui.cost])}</div>` : '';
    return `<div><b>${esc(r.solution)}</b><span class="tag">${r.world === 'real' ? 'real' : `sim · ${esc(r.simulator)}`}</span>${r.world === 'real' && !m.ok(r) ? '<span class="tag no">not admissible</span>' : ''}</div>
      <div class="k">${esc(r.task || '')}${r.rung ? ` · rung ${esc(r.rung)}` : ''}</div>
      <div><span class="k">${esc(this.objName())}</span> <b>${u(r.objective)}</b>${fin(r.objective) && fmt(r.objective) !== String(r.objective) ? ` <span class="k">(${r.objective})</span>` : ''}</div>
      ${cost}${pairLine}<div class="k">${when}</div>${r.world === 'real' ? '<div class="go">click: open this solution</div>' : ''}`;
  }

  // ── 3. two Pareto fronts ─────────────────────────────────────────────────────────────────────────────────────────
  frontsHtml() {
    const m = this.m;
    const dir = m.direction === 'higher' ? 'higher' : 'lower';
    if (!m.costs.length) {
      return `<section class="bbh" data-part="fronts"><h3 class="bbsr-h">Two Pareto fronts: real and sim</h3>
        <div class="bbsr-none"><b>No metric both worlds record reads as a cost.</b> A front needs one: a time both a real and a sim row record
        (a metric id ending <code>_s</code>, <code>_ms</code> or <code>_min</code>), with the same id in both worlds.</div></section>`;
    }
    return `<section class="bbh" data-part="fronts">
      <div class="bbh-box"><b>Performance against a cost, per world</b> · y: ${esc(this.objName())} (${dir} is better) · x: a time both worlds record, read as a cost (lower is better)</div>
      <h3 class="bbsr-h">Two Pareto fronts: real and sim</h3>
      <div class="bbh-bar"><div class="chips" role="group" aria-label="Cost on x" data-costs></div>
        <div class="bbh-right"><span class="bbh-ctl">x <span class="seg" data-seg="xs"></span></span></div></div>
      <div class="bbsr-front" data-front></div>
      <div class="bbh-chart" data-chart="fronts" style="height:320px"></div>
      <div class="bbh-foot"><div class="bbh-legend" data-legend="fronts"></div><div class="bbh-hint">Point at a dot for its card</div></div>
      <div class="bbsr-note" data-note="fronts"></div>
    </section>`;
  }

  paintFronts() {
    const sec = this.querySelector('[data-part="fronts"]');
    const m = this.m;
    if (!sec || !m.costs.length || !this.ui.cost) return;
    const cid = this.ui.cost, unit = this.unit();
    const f = this.fv = m.front(cid);
    const meta = (this.data.simreal.metrics || []).find((x) => x.id === cid) || {};
    const cu = meta.unit || '';
    const chips = sec.querySelector('[data-costs]');
    chips.innerHTML = m.costs.map((c) => `<button type="button" class="chip" data-cost="${esc(c)}" aria-pressed="${c === cid}">${esc(c)}</button>`).join('');
    chips.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { this.ui.cost = b.dataset.cost; this.ui.logx = null; this.paintFronts(); }));
    const drawn = [...f.drawn.real, ...f.drawn.sim];
    const xs = drawn.map((r) => r.metrics[cid]).filter((v) => v > 0);
    const autoLog = xs.length > 1 && Math.max(...xs) / Math.min(...xs) > 20 && drawn.every((r) => r.metrics[cid] > 0);
    const logx = this.ui.logx === null ? autoLog : this.ui.logx && drawn.every((r) => r.metrics[cid] > 0);
    this.seg(sec, 'xs', [{ id: 'log', label: 'Log' }, { id: 'linear', label: 'Linear' }], logx ? 'log' : 'linear', (id) => { this.ui.logx = id === 'log'; this.paintFronts(); });
    const line = (w) => (f[w].length ? f[w].map((r) => `${esc(r.solution)}${w === 'sim' ? ` · ${esc(r.simulator)} · ${esc(r.task || '')}` : ''} (${fmt(r.metrics[cid])}${cu ? ` ${esc(cu)}` : ''}, ${fmt(r.objective)}${unit ? ` ${esc(unit)}` : ''})`).join(' → ') : 'none yet');
    sec.querySelector('[data-front]').innerHTML = `<div><i class="sw lg-real-line"></i> <b>Real front</b>: ${line('real')}</div><div><i class="sw lg-sim-line"></i> <b>Sim front</b>: ${line('sim')}</div>`;
    sec.querySelector('[data-legend="fronts"]').innerHTML = '<span><i class="sw lg-real-line"></i>real front</span><span><i class="sw lg-real-dot"></i>real</span><span><i class="sw lg-sim-line"></i>sim front</span><span><i class="sw lg-sim-dot"></i>sim</span><span><i class="sw lg-front"></i>on a front</span>';
    const off = ['real', 'sim'].filter((w) => f.off[w].length).map((w) => `${w} ${w === 'real' ? f.off[w].map((r) => esc(r.solution)).join(', ') : plural(f.off[w].length, 'row')}`);
    const zeros = drawn.filter((r) => !(r.objective > 0)).length;
    const ys = drawn.map((r) => r.objective).filter((v) => v > 0);
    const ymin = ys.length ? Math.min(...ys) : 1, ymax = ys.length ? Math.max(...ys) : 1;
    const ylog = this.yLog(this.ui.y, ymin, ymax);
    sec.querySelector('[data-note="fronts"]').innerHTML = [
      off.length ? `Left off, no ${esc(cid)} recorded: ${off.join('; ')} (never plotted at 0).` : '',
      zeros && ylog ? `${plural(zeros, 'row')} scored 0: drawn on the floor of the log axis.` : '',
      'A front keeps each point that does better than every cheaper one (bb-frontier\'s rule, run once per world); real counts admissible rows only.',
    ].filter(Boolean).join(' ');
    const yr = this.yRange(ymin, ymax, ylog, zeros > 0);
    let lo = xs.length ? Math.min(...drawn.map((r) => r.metrics[cid])) : 0, hi = xs.length ? Math.max(...drawn.map((r) => r.metrics[cid])) : 1;
    if (logx) { lo /= 1.25; hi *= 1.25; } else { const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.1 || 1; lo = lo >= 0 ? Math.max(0, lo - pad) : lo - pad; hi += pad; }
    const C = this.colors();
    const pts = drawn.map((r) => ({ x: r.metrics[cid], y: r.objective, row: r }));
    const sims = m.simulators.map((x) => x.name);
    const shapeOf = (name) => SHAPES[Math.max(0, sims.indexOf(name)) % SHAPES.length];
    const onFront = new Set([...f.real, ...f.sim].map((r) => r.id));
    this.plot('fronts', sec.querySelector('[data-chart="fronts"]'), {
      x: { lo, hi, log: logx }, y: { lo: yr[0], hi: yr[1], log: ylog }, pts, C,
      marks: (u, X, Y, ctx, dpr) => {
        const right = u.bbox.left + u.bbox.width;
        const fy = (v) => Y(this.floorY(v, yr, ylog));
        for (const w of ['sim', 'real']) {
          const fr = f[w];
          if (!fr.length) continue;
          ctx.save(); ctx.strokeStyle = w === 'real' ? C.real : C.sim; ctx.lineWidth = 2.2 * dpr; ctx.setLineDash(w === 'sim' ? [6 * dpr, 4 * dpr] : []);
          ctx.beginPath();
          fr.forEach((r, i) => { const px = X(r.metrics[cid]), py = fy(r.objective); if (!i) ctx.moveTo(px, py); else { ctx.lineTo(px, fy(fr[i - 1].objective)); ctx.lineTo(px, py); } });
          ctx.lineTo(right, fy(fr.at(-1).objective));
          ctx.stroke(); ctx.restore();
        }
        for (const p of pts.filter((q) => q.row.world === 'sim')) this.shape(ctx, X(p.x), fy(p.y), shapeOf(p.row.simulator), 4.4 * dpr, C.sim, C.card, dpr);
        for (const p of pts.filter((q) => q.row.world === 'real')) {
          const px = X(p.x), py = fy(p.y);
          if (m.ok(p.row)) { ctx.fillStyle = C.real; ctx.beginPath(); ctx.arc(px, py, 5.2 * dpr, 0, 2 * Math.PI); ctx.fill(); }
          else { ctx.fillStyle = C.card; ctx.strokeStyle = C.bad; ctx.lineWidth = 1.8 * dpr; ctx.beginPath(); ctx.arc(px, py, 5.5 * dpr, 0, 2 * Math.PI); ctx.fill(); ctx.stroke(); }
        }
        for (const p of pts.filter((q) => onFront.has(q.row.id))) {
          ctx.strokeStyle = C.fg; ctx.lineWidth = 1.6 * dpr; ctx.beginPath(); ctx.arc(X(p.x), fy(p.y), 9 * dpr, 0, 2 * Math.PI); ctx.stroke();
        }
      },
    });
  }

  // ── 4. sim against real per solution, and the gap over time (data-ui charts) ─────────────────────────────────────
  pairsHtml() {
    const m = this.m;
    const pts = m.points();
    if (!pts.length) {
      return `<section class="bbh" data-part="pairs"><h3 class="bbsr-h">Does sim predict real?</h3>
        <div class="bbsr-none"><b>No real row shares a pair with a sim row yet.</b> A sim row predicts a real one when both carry the same
        <code>pair</code> ("&lt;solution&gt;/&lt;task or cell&gt;"); ${plural(m.counts.sim_only || 0, 'sim-only pair')} wait for a real row.</div></section>`;
    }
    return `<div class="bbsr-two" data-part="pairs">
      <section class="bbh"><div class="bbh-box"><b>Per solution</b> · each real solution against its own sim, one dot per simulator</div>
        <h3 class="bbsr-h">Does sim predict real?</h3><p class="bbsr-q">On the dashed line y = x, sim predicts real exactly; below it, real falls short of sim.</p>
        <div class="bbsr-view" data-bbsr-view="scatter"><div class="bbsr-wait">Drawing…</div></div></section>
      <section class="bbh"><div class="bbh-box"><b>The sim-to-real gap</b> · real ÷ sim per pair, at the time of the real row</div>
        <h3 class="bbsr-h">Real ÷ sim over time</h3><p class="bbsr-q">At 1 (dashed) real matches sim; ${esc(this.gapWords())}.</p>
        <div class="bbsr-view" data-bbsr-view="gap"><div class="bbsr-wait">Drawing…</div></div></section>
    </div>`;
  }

  gapWords() {
    const g = this.m.gap();
    if (!g.length) return 'no ratio yet';
    const r = g.map((p) => p.ratio);
    return `here real is ${pct(Math.min(...r))} % to ${pct(Math.max(...r))} % of sim`;
  }

  // ── 5. small multiples ───────────────────────────────────────────────────────────────────────────────────────────
  metricsHtml() {
    const m = this.m;
    const list = m.multiples.filter((x) => x.points.length);
    const head = `<div class="bbh-box"><b>Each metric both worlds record</b> · sim (x) against real (y) per paired solution and simulator; on the dashed line they agree</div>
      <h3 class="bbsr-h">Metric by metric</h3>`;
    if (!list.length) {
      return `<section class="bbh" data-part="metrics">${head}<div class="bbsr-none"><b>No metric is recorded by both a real row and its paired sim row.</b>
        The same metric id in both worlds (<code>metrics.&lt;id&gt;</code>) is what lets them be compared.</div></section>`;
    }
    const only = m.multiples.filter((x) => !x.points.length).map((x) => x.id);
    return `<section class="bbh" data-part="metrics">${head}
      <div class="bbsr-grid">${list.map((x) => `<div class="bbsr-cell" data-metric="${esc(x.id)}"><h4>${esc(x.id)}${x.unit ? ` <span class="k">(${esc(x.unit)})</span>` : ''}${x.objective ? ' <span class="k">· the objective</span>' : ''}</h4>
        <div class="bbsr-view" data-bbsr-view="metric:${esc(x.id)}"><div class="bbsr-wait">Drawing…</div></div></div>`).join('')}</div>
      ${only.length ? `<div class="bbsr-note">Recorded by both worlds but never on a real row and its own sim row together: ${only.map(esc).join(', ')}.</div>` : ''}
    </section>`;
  }

  // ── 6. the table ─────────────────────────────────────────────────────────────────────────────────────────────────
  tableHtml() {
    return `<section class="bbh" data-part="table"><div class="bbh-box"><b>Every pair</b> · a real row and the sim rows that share its <code>pair</code>, one row per simulator; sim-only pairs after</div>
      <h3 class="bbsr-h">The pairs</h3><div class="bbsr-view" data-bbsr-view="table"><div class="bbsr-wait">Drawing…</div></div></section>`;
  }

  /** The data-ui views of parts 4 to 6, each a <data-views> with an inline .base; `data-drew` once all have drawn. */
  async mountViews(parts) {
    const hosts = [...this.querySelectorAll('[data-bbsr-view]')];
    if (!hosts.length) { this.dataset.drew = 'charts'; return; }
    const token = (this._token = (this._token || 0) + 1);
    const core = await loadViews();
    if (token !== this._token) return;
    const m = this.m, box = this.data.box || 'Box', unit = this.unit();
    const name = this.objName();
    let left = hosts.length;
    const done = () => { if (--left === 0) this.dataset.drew = 'charts'; };
    // WHY the table keeps data-ui's compact toolbar (search, the row count): dozens of sim-only pairs; a chart needs none.
    // WHY no display rule on <data-views>: it lays itself out as a flex column held to --data-height (a display: block
    // here let a 420 px table draw 1530 px of rows past its card, measured)
    const mount = (host, label, doc, rows, properties, height, toolbar = 'none') => {
      const views = document.createElement('data-views');
      views.id = `bbsr-${++uid}`;
      views.setAttribute('no-url', '');
      views.setAttribute('toolbar', toolbar);
      views.setAttribute('status', 'off');
      views.setAttribute('controls', 'off');
      views.setAttribute('aria-label', `${box}: ${label}`);
      views.style.setProperty('--data-height', `${height}px`);
      views.addEventListener('data-views-render', () => { host.querySelector('.bbsr-wait')?.remove(); host.dataset.drew = '1'; done(); }, { once: true });
      const text = `# ${box}: ${label} (bb-simreal, the Sim × Real workspace)\n${core.stringifyBase(doc)}`;
      views.baseText = text;
      views.base = core.parseBase(text);
      views.data = { id: `bb/${box}/simreal/${label}`, title: `${box}: ${label}`, titleProperty: 'id', properties, rows };
      host.append(views);
    };
    const num = (label, decimals = 3) => ({ type: 'number', label, decimals });
    const txt = (label) => ({ type: 'text', label });
    // WHY a size per simulator, largest first: two simulators that agree land on one spot, and a larger circle around a
    // smaller square keeps both visible (sppm_agent's kinematic and MuJoCo twin cells score the same 4.37)
    const SIZE = { field: 'simulator', type: 'nominal', legend: null, scale: { domain: m.simulators.map((x) => x.name), range: m.simulators.map((x, i) => Math.max(50, 280 - 180 * i)) } };
    const span = (vals) => { const v = vals.filter((x) => x > 0); return v.length ? [Math.min(...v), Math.max(...v)] : [1, 1]; };
    // y = x as a Vega-Lite rule from (lo, lo) to (hi, hi): the plot's own diagonal (data-ui's indexLine spans the dots only)
    const diag = (lo, hi) => ({ mark: { type: 'rule', strokeDash: [5, 4], strokeWidth: 1.3 },
      encoding: { x: { datum: lo, type: 'quantitative' }, y: { datum: lo, type: 'quantitative' }, x2: { datum: hi }, y2: { datum: hi } } });
    for (const host of hosts) {
      const kind = host.dataset.bbsrView;
      if (kind === 'scatter') {
        const pts = m.points();
        const all = pts.flatMap((p) => [p.sim, p.real]);
        const [a, b] = span(all);
        const log = all.every((v) => v > 0) && b / a > 20;
        const lo = log ? a / 1.6 : 0, hi = log ? b * 1.6 : b * 1.08;
        const rows = pts.map((p) => ({ id: p.id, solution: p.solution, simulator: p.simulator, cell: p.cell, sim: p.sim, real: p.real, ratio: p.ratio, real_at: p.at }));
        const enc = (f, t) => ({ field: f, type: 'quantitative', title: t, scale: { ...(log ? { type: 'log' } : { zero: true }), domain: [lo, hi] } });
        mount(host, 'sim against real', { views: [{ type: 'chart', name: 'Sim against real', chart: { layer: [
          { mark: { type: 'point', filled: false, strokeWidth: 2, opacity: 0.9 },
            encoding: { x: enc('sim', `sim ${name}${unit ? ` (${unit})` : ''}`), y: enc('real', `real ${name}${unit ? ` (${unit})` : ''}`),
              color: { field: 'simulator', type: 'nominal', title: 'simulator' }, shape: { field: 'simulator', type: 'nominal', legend: null }, size: SIZE,
              tooltip: [{ field: 'solution' }, { field: 'simulator' }, { field: 'cell', title: 'sim cell' }, { field: 'real', format: '.4g' }, { field: 'sim', format: '.4g' }, { field: 'ratio', title: 'real ÷ sim', format: '.3g' }] } },
          diag(lo, hi),
        ] } }] }, rows, { solution: txt('Solution'), simulator: txt('Simulator'), cell: txt('Sim cell'), sim: num(`Sim ${name}`), real: num(`Real ${name}`), ratio: num('Real ÷ sim'), real_at: txt('Real measured to') }, 340);
      } else if (kind === 'gap') {
        const g = m.gap();
        const rows = g.map((p) => ({ id: p.id, solution: p.solution, simulator: p.simulator, real_at: p.at, ratio: p.ratio, real: p.real, sim: p.sim }));
        mount(host, 'real over sim', { views: [{ type: 'chart', name: 'Real ÷ sim over time', chart: { layer: [
          { mark: { type: 'line', point: { size: 70, filled: true }, strokeWidth: 1.6 },
            encoding: { x: { field: 'real_at', type: 'temporal', title: 'real row (end of its window)' },
              y: { field: 'ratio', type: 'quantitative', title: 'real ÷ sim', scale: { type: 'log' } },
              color: { field: 'simulator', type: 'nominal', title: 'simulator' },
              tooltip: [{ field: 'solution' }, { field: 'simulator' }, { field: 'ratio', title: 'real ÷ sim', format: '.3g' }, { field: 'real', format: '.4g' }, { field: 'sim', format: '.4g' }] } },
          { mark: { type: 'rule', strokeDash: [5, 4], strokeWidth: 1.3 }, encoding: { y: { datum: 1, type: 'quantitative' } } },
        ] } }] }, rows, { solution: txt('Solution'), simulator: txt('Simulator'), real_at: { type: 'date', label: 'Real measured to' }, ratio: num('Real ÷ sim'), real: num(`Real ${name}`), sim: num(`Sim ${name}`) }, 340);
      } else if (kind.startsWith('metric:')) {
        const id = kind.slice(7);
        const x = m.multiples.find((q) => q.id === id);
        const all = x.points.flatMap((p) => [p.sim, p.real]);
        const [a, b] = span(all);
        const log = all.every((v) => v > 0) && b / a > 20;
        const mn = Math.min(...all), mx = Math.max(...all);
        const lo = log ? a / 1.6 : Math.min(0, mn), hi = log ? b * 1.6 : (mx > 0 ? mx * 1.1 : 1);
        const enc = (f, t) => ({ field: f, type: 'quantitative', title: t, scale: { ...(log ? { type: 'log' } : { zero: true }), domain: [lo, hi] } });
        const rows = x.points.map((p) => ({ id: p.id, solution: p.solution, simulator: p.simulator, sim: p.sim, real: p.real }));
        mount(host, `metric ${id}`, { views: [{ type: 'chart', name: id, chart: { layer: [
          { mark: { type: 'point', filled: false, strokeWidth: 2, opacity: 0.9 },
            encoding: { x: enc('sim', `sim${x.unit ? ` (${x.unit})` : ''}`), y: enc('real', `real${x.unit ? ` (${x.unit})` : ''}`),
              color: { field: 'simulator', type: 'nominal', legend: null }, shape: { field: 'simulator', type: 'nominal', legend: null }, size: SIZE,
              tooltip: [{ field: 'solution' }, { field: 'simulator' }, { field: 'real', format: '.4g' }, { field: 'sim', format: '.4g' }] } },
          diag(lo, hi),
        ] } }] }, rows, { solution: txt('Solution'), simulator: txt('Simulator'), sim: num(`Sim ${id}`), real: num(`Real ${id}`) }, 230);
      } else if (kind === 'table') {
        const rows = [];
        for (const p of m.pairs) {
          for (const s of p.sims) {
            rows.push({ id: `${p.pair} @ ${s.row.simulator}`, solution: p.solution, cell: s.row.task, simulator: s.row.simulator, rung: s.row.rung,
              real: p.realRow ? p.realRow.objective : null, sim: s.row.objective, ratio: fin(s.ratio) ? s.ratio : null,
              status: p.realRow ? (fin(s.ratio) ? 'paired' : 'no ratio') : 'sim only', real_cell: p.realRow ? p.realRow.task : null, sim_run: s.row.at });
          }
          if (p.realRow && !p.sims.length) rows.push({ id: p.pair, solution: p.solution, cell: null, simulator: null, rung: null, real: p.realRow.objective, sim: null, ratio: null, status: 'real only', real_cell: p.realRow.task, sim_run: null });
        }
        mount(host, 'pairs', { views: [{ type: 'table', name: 'Pairs', groupBy: { property: 'status', direction: 'ASC' },
          order: ['solution', 'simulator', 'cell', 'real', 'sim', 'ratio', 'rung', 'sim_run'] }] }, rows,
        { solution: txt('Solution'), simulator: txt('Simulator'), cell: txt('Sim cell'), rung: txt('Rung'), real: num(`Real ${name}`), sim: num(`Sim ${name}`),
          ratio: num('Real ÷ sim'), status: txt('Pair'), real_cell: txt('Real cell'), sim_run: { type: 'date', label: 'Sim run' } }, 460, 'compact');
      } else done();
    }
  }
}
register(BBSimReal);
