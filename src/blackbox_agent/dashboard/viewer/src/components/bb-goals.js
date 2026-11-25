/* <bb-goals>: the Goals tab (viewer/CONTRACT.md §20, §25). Goals round 2, PICKS.md "Goals round 2 (2026-11-25)": Zach's
   ruling, "for the goal page, I am happy for the base to be just like the other things basically just a stock data-ui
   table … then some nice presets to have: 1 is like a row view, 1 is a card view, 1 can be like the timeline view similar
   to what you have in v5, and then one … showing the spark line progress towards the goals and gates … are we basically
   tracking our goal". The default taken is the splice (proposals-goals-v2/09-splice/): ONE stock <data-views> over one
   goals .base with the presets Rows · Cards · Timeline · Tracking and one side panel, built in the page from the goals
   slice by bb-goals.rows.js (equal to 09's rows and .base; tests/goals-rows.test.mjs). Tracking draws each goal's burn-up
   with bb-goals.spark.js (the data-ui gap `display: goalline`), Timeline is V5's plan (bb-goals.plan.js, the gap
   `type: plan`), Cards and the panel's charts are data-ui's stock kpi and Vega-Lite views in each target's real units.

   Kept from round 1 (§20), above the views: the verdict (one calm line, bb-goals.model.js), "as of" and the ×2 buffer
   switch; in the panel, as sections: what it takes ("no idea aims at this", 04), 03's levers and odds with the moves
   (the `goal-odds` view below, bb-goals.odds.js's Monte Carlo) and 02's value moves, the goal hit rate by tier (01).
   WHY calm: one answer first, amber only where a goal is at risk or a line of the goals' files was refused, red only for
   a goal missed. */
import { BBElement, esc } from '../core/element.js';
import { register } from '../core/registry.js';
import { fill } from '../core/context.js';
import { loadViews } from '../core/kit.js';
import schema from './bb-goals.schema.js';
import { verdict, levers, timeMoves, clock, longClock, hours, pct } from './bb-goals.model.js';
import { simulate } from './bb-goals.odds.js';
import { goalsDataset, goalsBaseText, ODDS_SECTION } from './bb-goals.rows.js';
import { registerPlan } from './bb-goals.plan.js';

const NB = ' ';
export const PRESETS = ['Rows', 'Cards', 'Timeline', 'Tracking'];
// a click on a row that belongs to a goal (a Cards card, a chart point, a strip, a roadmap step) opens its goal (09)
const OF_A_GOAL = new Set(['reading', 'criterion', 'step', 'odds']);
const CHART = 'Each target, in its own unit: planned, actual, estimate';

/* ── 03's levers as a data-ui view (`type: goal-odds`): the panel's odds section, over the goal's odds row ───────── */

class OddsView {
  constructor(host, el) {
    this.host = host;
    this.el = el;
    el.classList.add('bbg-oddsview');
  }

  /** The reader's settings live on the tab (the panel reopens on a buffer switch; the answer slot stays as set). */
  store() {
    const tab = this.el.closest('bb-goals') || this;
    tab._lever ??= {};
    return tab._lever;
  }

  update(input) {
    const r = input.rows[0];
    this._job = (this._job || 0) + 1;
    if (!r) { this.el.innerHTML = ''; return; }
    const moves = JSON.parse(r.odds_moves || '[]');
    const movesHtml = moves.length ? `<div class="bbg-moves"><b>It does not reach every target by ${esc(clock(r.odds_due, r.odds_due))}: your moves on its own ideas</b><ul>${moves.map((m) => `<li><b>${esc(m.move)}</b>: ${m.text}</li>`).join('')}</ul></div>` : '';
    if (!r.odds_model) {
      this.el.innerHTML = `<p class="bbg-onone">${esc(r.odds_none || 'No odds.')}</p>${movesHtml}`;
      return;
    }
    const m = JSON.parse(r.odds_model), lv = levers(m), asOf = m.origin;
    const all = this.store();
    const st = (all[r.goal] ??= { slots: { ...m.slots }, start: 0 });
    const opt = (list, val) => list.map((o) => `<option value="${o.min}"${o.min === val ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
    this.el.innerHTML = `<p class="bbg-oddsv" data-oddsv></p>
<div class="bbg-levers" role="group" aria-label="What you set">${m.waits.map((wid) => `<label class="main"><span>You answer <code>${esc(wid)}</code> by</span><select data-wait="${esc(wid)}" aria-label="When you answer ${esc(wid)}">${opt(lv.answer, st.slots[wid])}</select></label>`).join('')}
<label><span>The box runs from</span><select data-start aria-label="When the box runs">${opt(lv.start, st.start)}</select></label></div>
<p class="bbg-odds" data-odds></p><div data-tmoves></div>
<p class="bbg-how">Each agent idea takes its written effort × ${m.buffer === 2 ? 'the buffer' : '1'} × a spread from the box's own pace (${esc(m.sigma_text)}) and lands ${esc(m.hit_text)} times (the box's hit rate); a miss costs one more idea of the roadmap's median effort. ${m.n.toLocaleString('en-CA')} draws, seed ${m.seed} (03 Odds).</p>${movesHtml}`;
    const due = r.odds_due, idle = r.odds_idle, buffer = r.odds_buffer === 'x2' ? m.buffer : 1;
    const draw = () => {
      const settings = { buffer, start: st.start, slots: { ...st.slots } };
      const tm = timeMoves(m, settings, simulate, { answers: lv.answer });
      const res = tm.result, late = !tm.fits, wid = m.waits[0];
      this.el.querySelector('[data-oddsv]').innerHTML = `<b>${esc(r.goal)}: <span class="p${late ? ' late' : ''}">${pct(res.p_on_time)}</span> on time</b>`
        + (wid ? ` if you answer <code>${esc(wid)}</code> by <b>${esc(lv.label(st.slots[wid]))}</b>` : '')
        + ` — and the box${idle ? `, idle ${hours(idle)},` : ''} runs from ${st.start === 0 ? 'now' : esc(lv.label(st.start))}.`;
      this.el.querySelector('[data-odds]').innerHTML = `<span class="q">P10</span> <b>${esc(lv.label(res.finish.p10))}</b> <span class="q">P50</span> <b>${esc(lv.label(res.finish.p50))}</b> <span class="q">P90</span> <b>${esc(lv.label(res.finish.p90))}</b> <span class="q">vs due</span> <b>${esc(clock(due, asOf))}</b> <span class="q">on time</span> <span class="p${late ? ' late' : ''}">${pct(res.p_on_time)}</span> <span class="q">of ${res.n.toLocaleString('en-CA')} draws</span>`;
      const own = simulate(m, { ...settings, slots: Object.fromEntries(m.waits.map((x) => [x, st.start])) });
      this.el.querySelector('[data-tmoves]').innerHTML = tm.fits
        ? `<div class="bbg-moves fits">Fits: no move needed. The box's own part needs about <b>${hours((own.finish.p50 - st.start) / 60)}</b> (P90 ${hours((own.finish.p90 - st.start) / 60)}) once it runs; the date is decided by ${m.waits.length ? 'your answer and ' : ''}when the box runs.</div>`
        : `<div class="bbg-moves"><b>Does not fit: ${pct(res.p_on_time)} on time.</b> The three moves, each re-simulated on ${esc(r.goal)}'s own ideas:<ul>${tm.moves.map((x) => `<li><b>${esc(x.move)}</b>: ${esc(x.text)}${x.p != null ? ` → <span class="odd">${pct(x.p)}</span> on time` : ''}</li>`).join('')}</ul></div>`;
      this.relabel(m, settings);
    };
    this.el.querySelectorAll('select[data-wait]').forEach((s) => s.addEventListener('change', () => { st.slots[s.dataset.wait] = Number(s.value); draw(); }));
    this.el.querySelector('select[data-start]').addEventListener('change', (e) => { st.start = Number(e.target.value); draw(); });
    draw();
  }

  /** Each option carries its own odds under the other settings (03: the lever, read before it is pulled). */
  relabel(m, settings) {
    const job = (this._job = (this._job || 0) + 1);
    const lv = levers(m);
    const opts = [...this.el.querySelectorAll('option')];
    const step = (i) => {
      if (job !== this._job || i >= opts.length || !this.el.isConnected) return;
      const o = opts[i], v = Number(o.value), sel = o.parentElement;
      const over = sel.dataset.wait ? { slots: { ...settings.slots, [sel.dataset.wait]: v } } : { start: v };
      o.textContent = `${sel.dataset.wait || v ? lv.label(v) : 'now'} · ${pct(simulate(m, { ...settings, ...over }).p_on_time)}`;
      setTimeout(() => step(i + 1), 0);
    };
    step(0);
  }

  destroy() { this._job = (this._job || 0) + 1; }
}

function registerOdds(core) {
  try {
    core.registerView('goal-odds', { name: 'Odds', icon: 'dice', load: async () => OddsView });
  } catch (e) {
    if (!/already registered/.test(String(e?.message))) throw e;
  }
}

export class BBGoals extends BBElement {
  static schema = schema;
  static css = `
bb-goals { display: block; min-width: 0; --bb-desired: #71717a; --bb-estimate: #7c3aed; --bb-estimate-fill: rgba(124, 58, 237, 0.12); }
:root[data-theme="dark"] bb-goals { --bb-desired: #9a9aa3; --bb-estimate: #b18cf5; --bb-estimate-fill: rgba(177, 140, 245, 0.16); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) bb-goals { --bb-desired: #9a9aa3; --bb-estimate: #b18cf5; --bb-estimate-fill: rgba(177, 140, 245, 0.16); } }
bb-goals .bbg { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
bb-goals .bbg-verdict { font-size: 15.5px; line-height: 1.5; margin: 2px 0 0; max-width: 1000px; }
bb-goals .bbg-verdict.warn { border-left: 3px solid var(--bb-warn); padding-left: 10px; }
bb-goals .bbg-verdict.bad { border-left: 3px solid var(--bb-bad); padding-left: 10px; }
bb-goals .bbg-asof { color: var(--bb-muted); font-size: 12.5px; margin: 0; display: flex; flex-wrap: wrap; gap: 4px 14px; align-items: baseline; }
bb-goals .bbg-switch { display: inline-flex; gap: 6px; align-items: baseline; cursor: pointer; color: var(--bb-fg); font-size: 13px; }
bb-goals .bbg-switch input { accent-color: var(--bb-estimate); margin: 0; }
bb-goals .bbg-switch small { color: var(--bb-faint); }
bb-goals .bbg-legend { display: flex; flex-wrap: wrap; gap: 4px 16px; align-items: center; color: var(--bb-muted); font-size: 12.5px; margin: 0; }
bb-goals .bbg-legend .lg { display: inline-flex; align-items: center; gap: 6px; }
bb-goals .bbg-legend .k { display: inline-block; width: 18px; height: 0; border-top: 2px solid; flex: none; }
bb-goals .bbg-legend .k-des { border-top-style: dashed; border-color: var(--bb-desired); }
bb-goals .bbg-legend .k-real { border-color: #ee7d1f; }
bb-goals .bbg-legend .k-est { border-color: var(--bb-estimate); }
bb-goals .bbg-legend .k-aim { width: 8px; height: 8px; border: 1.5px solid var(--bb-desired); border-radius: 50%; }
bb-goals .bbg-problems { border-left: 3px solid var(--bb-warn); padding: 4px 0 4px 12px; font-size: 13px; }
bb-goals .bbg-problems ul { margin: 4px 0 0; padding-left: 18px; }
bb-goals .bbg-problems code { font-family: var(--bb-mono); font-size: 12px; overflow-wrap: anywhere; }
bb-goals .bbg-views { min-width: 0; }
bb-goals .bbg-foot { color: var(--bb-faint); font-size: 12.5px; margin: 6px 0 0; }
/* the panel's chart (08's small multiples) is as tall as the open goal has targets (09: 207 px each, so G3's one "can't
   judge yet" window is not a 620 px grey block); data-ui gives an embedded section view 240 px as display: block, which
   breaks the flex fill (08's gap 5), so it is flex again here */
bb-goals .dv-peek-view[data-section="${CHART}"] > data-views {
  display: flex; flex-direction: column;
  height: calc(var(--splice-targets, 3) * 207px); --data-height: calc(var(--splice-targets, 3) * 207px);
}
/* the panel's tables and the odds take their own height, so the panel scrolls once instead of each section inside it */
bb-goals .dv-peek-view[data-section="Each pass / fail box"] > data-views,
bb-goals .dv-peek-view[data-section="The roadmap, in plan order"] > data-views { height: auto; --data-height: 1200px; }
bb-goals .dv-peek-view[data-section="${ODDS_SECTION}"] > data-views { height: auto; --data-height: auto; }
/* 09: with a table's height auto, its sticky header row (z-index 2) was drawn over the panel's sticky title */
bb-goals .dv-peek header { z-index: 5; }
/* 08: calm UI. A kpi card's "bad" delta (an open target not reached yet) is a problem, not a miss, so it reads amber; red
   stays for a goal missed (data-ui's kpi has no warn tone for a delta: 08's gap 6). Its spark is the actual series. */
bb-goals .dv-view-kpi { --data-bad: var(--bb-warn); --data-series-1: #ee7d1f; }
bb-goals .vis-item.pl-flag.vis-box:not([style*="transform"]) { visibility: hidden; }
bb-goals .bbg-oddsview { padding: 2px 2px 6px; font-size: 13.5px; }
bb-goals .bbg-onone { color: var(--bb-muted); margin: 2px 0; }
bb-goals .bbg-levers { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: flex-end; margin: 4px 0 6px; }
bb-goals .bbg-levers label { display: grid; gap: 3px; font-size: 12.5px; color: var(--bb-muted); min-width: 0; }
bb-goals .bbg-levers label.main span { color: var(--bb-fg); font-weight: 600; }
bb-goals .bbg-levers select { font: inherit; font-size: 13.5px; padding: 5px 8px; border: 1px solid var(--bb-border); border-radius: 6px;
  background: var(--bb-bg); color: var(--bb-fg); max-width: 100%; }
bb-goals .bbg-odds { font-size: 13.5px; margin: 2px 0 4px; display: flex; flex-wrap: wrap; gap: 2px 12px; align-items: baseline; }
bb-goals .bbg-odds .q { color: var(--bb-muted); font-size: 12px; }
bb-goals .bbg-odds .p, bb-goals .bbg-oddsv .p { color: var(--bb-estimate); font-weight: 700; }
bb-goals .bbg-odds .p.late, bb-goals .bbg-oddsv .p.late { color: var(--bb-warn); }
bb-goals .bbg-oddsv { font-size: 14px; margin: 2px 0; }
bb-goals .bbg-moves { border-left: 3px solid var(--bb-warn); padding: 2px 0 2px 12px; margin: 8px 0 2px; font-size: 13.5px; }
bb-goals .bbg-moves.fits { border-left-color: var(--bb-border); color: var(--bb-muted); }
bb-goals .bbg-moves ul { margin: 4px 0 0; padding-left: 18px; display: grid; gap: 5px; }
bb-goals .bbg-moves .odd { color: var(--bb-estimate); font-weight: 650; white-space: nowrap; }
bb-goals .bbg-moves code, bb-goals .bbg-oddsv code { font-family: var(--bb-mono); font-size: 12px; overflow-wrap: anywhere; }
bb-goals .bbg-how { color: var(--bb-faint); font-size: 12px; margin: 6px 0 0; }
@media (max-width: 640px) { bb-goals .bbg-levers label { flex: 1 1 100%; } }
`;

  teardown() {
    this._mo?.disconnect(); this._mo = null;
  }

  async render() {
    const slice = this.data.goals;
    if (!slice || !Array.isArray(slice.goals)) return this.empty();
    this._slice = slice;
    this._tag ??= this.settings.buffer === 'x1' ? 'x1' : 'x2';
    const problems = slice.problems || [];
    this.innerHTML = `<div class="bbg">
<p class="bbg-verdict" data-verdict aria-live="polite"></p>
<p class="bbg-asof"><span>as of ${esc(longClock(slice.as_of, slice.as_of))} · ${slice.goals.length} ${slice.goals.length === 1 ? 'goal' : 'goals'} in <code>goals/</code>, judged on the box's own ledger and tests${slice.clock === 'fixture' ? ' (a fixture\'s clock)' : ''}</span>
<label class="bbg-switch"><input type="checkbox" data-buffer${this._tag === 'x2' ? ' checked' : ''}> <span>Buffer ×${esc(String(slice.buffer || 2))}</span> <small>bottom-up estimates never include all the things</small></label></p>
${slice.goals.length ? `<p class="bbg-legend"><span class="lg"><i class="k k-des"></i>planned: where it stood when set → the target by your date</span><span class="lg"><i class="k k-real"></i>actual: the best candidate since set (dotted = nothing scored since)</span><span class="lg"><i class="k k-est"></i>estimate: the roadmap's ideas, bottom-up</span><span class="lg"><i class="k k-aim"></i>target</span></p>` : ''}
${problems.length ? `<div class="bbg-problems" role="note"><b>${problems.length} ${problems.length === 1 ? 'line' : 'lines'} of the goals' files refused</b> (left out until fixed):<ul>${problems.map((p) => `<li><code>[${esc(p.lint)}] ${esc(p.where)}</code>: ${esc(p.what)}; <b>fix:</b> ${esc(p.fix)}</li>`).join('')}</ul></div>` : ''}
${slice.goals.length ? `<div class="bbg-views" data-views-host></div><p class="bbg-foot">${esc(this.paceLine(slice))}</p>` : ''}
</div>`;
    this.drawVerdict();
    if (!slice.goals.length) return undefined;
    this.querySelector('[data-buffer]').addEventListener('change', (e) => this.setBuffer(e.target.checked ? 'x2' : 'x1'));
    await this.mountViews();
    this.dataset.drew = 'goals';
    return undefined;
  }

  paceLine(slice) {
    const p = slice.pace || {};
    return `The box itself: ${p.agent_solutions} agent solutions, a median ${p.minutes_per_solution_median ?? '—'}${NB}min apart; ${p.new_bests} new bests of ${p.tried} ideas tried`
      + (p.idle_hours != null ? `; idle ${hours(p.idle_hours)} (last scored ${p.last_scored ? clock(p.last_scored, slice.as_of) : '—'})` : '')
      + '. Every estimate here assumes it starts now.';
  }

  drawVerdict() {
    const v = verdict(this._slice, { buffer: this._tag });
    const el = this.querySelector('[data-verdict]');
    el.textContent = v.text;
    el.className = `bbg-verdict ${v.tone}`;
  }

  ideasHref(gid, idea = '') {
    const pattern = this.context.links.page || '{page}.html';
    return `${fill(pattern, { page: 'ideas' })}?goal=${encodeURIComponent(gid)}${idea ? `&idea=${encodeURIComponent(idea)}` : ''}`;
  }

  rowsFor(tag) {
    return goalsDataset(this._slice, tag, { ideasHref: (g) => this.ideasHref(g), id: `bb/${this.data.box}/goals` });
  }

  /** ONE stock <data-views>: the presets as tabs, the one side panel (open: side). */
  async mountViews() {
    const host = this.querySelector('[data-views-host]');
    const core = await loadViews();
    registerPlan(core);
    registerOdds(core);
    const views = document.createElement('data-views');
    for (const [k, v] of [['no-url', ''], ['views', 'tabs'], ['view-counts', '']]) views.setAttribute(k, v);
    views.setAttribute('aria-label', `${this.data.box || 'Box'}: goals`);
    views.addEventListener('data-views-open', (e) => this.onOpen(e));
    // "its N ideas →" (a link cell in Rows and in the panel) opens the Ideas tab filtered to that goal, the page's way
    views.addEventListener('click', (e) => this.onLink(e), true);
    const rendered = new Promise((done) => views.addEventListener('data-views-render', done, { once: true }));
    host.replaceChildren(views);
    views.base = core.parseBase(goalsBaseText(this._slice, { odds: this.settings.levers !== false }));
    views.data = this.rowsFor(this._tag);
    this._views = views;
    // the panel's chart is as tall as the open goal has targets (09: build.py writes n_targets on each goal row)
    this._mo?.disconnect();
    this._mo = new MutationObserver(() => this.sizeChart());
    this._mo.observe(views, { childList: true, subtree: true });
    await rendered;
    const want = PRESETS.includes(this.settings.view) ? this.settings.view : 'Rows';
    if (views.view?.name !== want) views.selectView(want);
    if (this.settings.goal && views.row(this.settings.goal)) views.openPeek(this.settings.goal);
  }

  sizeChart() {
    const views = this._views;
    const host = views?.querySelector(`.dv-peek-view[data-section="${CHART}"] > data-views`);
    const id = views?.peeked?.id;
    const r = host && id ? views.row(id) : null;
    const n = r && (r.values || r).n_targets;
    if (n && host.style.getPropertyValue('--splice-targets') !== String(n)) host.style.setProperty('--splice-targets', String(n));
  }

  /** One side panel: a card, chart point, strip, roadmap step or Timeline bar of a goal opens that goal (09, V5). */
  onOpen(e) {
    const row = e.detail?.row;
    const v = row && (row.values || row);
    const views = this._views;
    if (!v || !views) return;
    const tl = typeof v.id === 'string' && /^tl-(G\d+)/.exec(v.id);
    const goal = OF_A_GOAL.has(v.kind) ? v.goal : tl ? tl[1] : null;
    if (goal && goal !== v.id && views.row(goal)) setTimeout(() => views.openPeek(goal), 0);
  }

  onLink(e) {
    const a = e.target.closest?.('a[href]');
    if (!a || !this.contains(a)) return;
    const href = a.getAttribute('href') || '';
    const m = /[?&]goal=([^&#]+)/.exec(href);
    if (!m || !/ideas/.test(href)) return;
    const gid = decodeURIComponent(m[1]);
    const go = this.goIdeas(gid);
    if (!go || !this.context.follow) e.preventDefault();
    e.stopPropagation();
  }

  /** The buffer moves every preset and the open panel at once (two datasets; the panel reopens on the new rows). */
  setBuffer(tag) {
    if (tag === this._tag) return;
    this._tag = tag;
    this.drawVerdict();
    const views = this._views;
    if (!views) return;
    const open = views.peeked;
    views.data = this.rowsFor(tag);
    // WHY reopen: an open side panel kept the ×2 words after the swap (06 found it)
    if (open?.id && views.row(open.id)) setTimeout(() => views.openPeek(open.id), 0);
  }

  goIdeas(gid, idea = '') {
    const href = this.ideasHref(gid, idea);
    return this.context.open(this, { kind: 'page', id: 'ideas', query: { goal: gid, ...(idea ? { idea } : {}) }, href });
  }
}
register(BBGoals);
