/* <bb-goals>: the Goals tab (viewer/CONTRACT.md §20). PICKS.md "Goals (2026-11-25)", the splice the round picked as the
   provisional default: 02 Two lines as the hero (data-ui's stock `pace` list + the violet estimate overlay,
   bb-goals.two-lines.js: the one data-ui gap), 03 Odds' two levers (when you answer each wait, when the box runs) with
   its seeded Monte Carlo (bb-goals.odds.js) and its three moves re-simulated, 04 Gate ladder's "no idea aims at this"
   under a criterion not met that no roadmap idea names. Every word is bb-goals.model.js over the goals slice
   (tools/folds/goals.py: goals_core's judgement); nothing is typed in.

   Zach, 2026-11-25: "Each goal gets a plan. With the path to completion we have the desired and then the estimated one
   with bottom up planning…. Then we can track if goal met or not." WHY calm: one answer first, amber only where a goal
   is at risk or a line of the goals' files was refused, red only for a goal missed. */
import { BBElement, esc } from '../core/element.js';
import { register } from '../core/registry.js';
import { fill } from '../core/context.js';
import { loadViews } from '../core/kit.js';
import schema from './bb-goals.schema.js';
import { verdict, goalWord, perGoal, valueMoves, levers, timeMoves, clock, longClock, num, hours, mins, pct, OP, isMet } from './bb-goals.model.js';
import { twoLines, timeOnly } from './bb-goals.two-lines.js';
import { simulate } from './bb-goals.odds.js';

const plain = (t) => String(t || '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
const RANK = { missed: 0, open: 1, 'cannot judge yet': 2, 'met late': 3, met: 3 };
const TONE = { good: 'good', warn: 'warn', bad: 'bad', muted: 'muted' };
const NB = ' ';
const STATE_GLYPH = { pass: '✓', fail: '✗', unverified: '?', 'not run': '–', deferred: '…', 'cannot judge': '–' };
const PACE_BASE = `views:
  - type: pace
    name: Will we get there
    order: [about]
    pace:
      due: due
      status: pace
      order: [missed, at risk, cannot judge yet, on track, passes now]
      tones: { missed: bad, "at risk": warn, "cannot judge yet": muted, "on track": good, "passes now": good }
      now: now
      goal: target
      readings: readings
`;
const PACE_PROPS = { title: { type: 'text', label: 'Goal · target' }, about: { type: 'text', label: 'Where the goal stands' },
  pace: { type: 'text', label: 'Pace' }, due: { type: 'date', label: 'Due' }, now: { type: 'text', label: 'Now' },
  target: { type: 'text', label: 'Target' }, goal: { type: 'text', label: 'Goal', hidden: true } };
let uid = 0;

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
bb-goals .bbg-problems { border-left: 3px solid var(--bb-warn); padding: 4px 0 4px 12px; font-size: 13px; }
bb-goals .bbg-problems ul { margin: 4px 0 0; padding-left: 18px; }
bb-goals .bbg-problems code { font-family: var(--bb-mono); font-size: 12px; overflow-wrap: anywhere; }
bb-goals .bbg-hero { border: 1px solid var(--bb-border); border-radius: var(--bb-radius); overflow: hidden; min-width: 0; }
bb-goals .bbg-hero data-views { --data-height: auto; display: block; }
bb-goals .bbg-hero [data-id] { cursor: pointer; }
bb-goals .bbg-met { color: var(--bb-muted); font-size: 13px; margin: 0; }
bb-goals .bbg-link { font: inherit; color: var(--bb-accent); background: none; border: 0; padding: 0; cursor: pointer; text-align: left; }
bb-goals .bbg-link:hover { text-decoration: underline; }
bb-goals .st { font-weight: 600; white-space: nowrap; }
bb-goals .st::before { content: "●"; margin-right: 4px; font-size: .8em; }
bb-goals .st.good { color: var(--bb-good); } bb-goals .st.warn { color: var(--bb-warn); } bb-goals .st.bad { color: var(--bb-bad); }
bb-goals .st.muted { color: var(--bb-muted); }
bb-goals .bbg-chips { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
bb-goals .bbg-chip { font: inherit; font-size: 13px; display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 2px 6px; padding: 5px 10px;
  border: 1px solid var(--bb-border); border-radius: 999px; background: var(--bb-bg); color: var(--bb-fg); cursor: pointer; max-width: 100%; text-align: left; }
bb-goals .bbg-chip:hover { background: var(--bb-hover); }
bb-goals .bbg-chip[aria-pressed="true"] { border-color: var(--bb-fg); box-shadow: inset 0 0 0 1px var(--bb-fg); }
bb-goals .bbg-chip .t { color: var(--bb-muted); }
bb-goals .bbg-chip .time { color: var(--bb-faint); font-variant-numeric: tabular-nums; }
bb-goals .bbg-panel { border: 1px solid var(--bb-border); border-radius: var(--bb-radius); padding: 14px 16px 12px; min-width: 0; }
bb-goals .bbg-ph { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; }
bb-goals .bbg-h2 { font-size: 17px; margin: 0; }
bb-goals .bbg-gid { color: var(--bb-muted); font-weight: 600; margin-right: 4px; }
bb-goals .bbg-meta { color: var(--bb-muted); font-size: 13px; }
bb-goals .bbg-go { margin-left: auto; font-size: 13.5px; font-weight: 550; color: var(--bb-accent); text-decoration: none; white-space: nowrap; }
bb-goals .bbg-go:hover { text-decoration: underline; }
bb-goals .bbg-per { margin: 6px 0 8px; max-width: 1000px; }
bb-goals .bbg-why { color: var(--bb-muted); font-size: 13px; margin: 0 0 8px; max-width: 1000px; }
bb-goals .bbg-legend { display: flex; flex-wrap: wrap; gap: 4px 16px; align-items: center; color: var(--bb-muted); font-size: 12.5px; margin: 0 0 4px; }
bb-goals .bbg-legend .lg { white-space: nowrap; display: inline-flex; align-items: center; }
bb-goals .bbg-legend .k { display: inline-block; width: 22px; height: 0; border-top: 2px solid; margin-right: 6px; vertical-align: middle; }
bb-goals .k-real { border-color: var(--bb-best) !important; }
bb-goals .k-des { border-top-style: dashed !important; border-color: var(--bb-desired) !important; }
bb-goals .k-est { border-color: var(--bb-estimate) !important; border-top-width: 3px !important; }
bb-goals .k-aim { width: 9px !important; height: 9px !important; border: 1.5px solid var(--bb-fg) !important; border-radius: 50%; }
bb-goals .tl-fig { margin: 8px 0 0; min-width: 0; }
bb-goals .tl-fig-small { margin-top: 14px; }
bb-goals .tl-cap { font-size: 13px; display: flex; flex-wrap: wrap; gap: 2px 10px; align-items: baseline; }
bb-goals .tl-capnote { color: var(--bb-muted); }
bb-goals .tl-svg { display: block; max-width: 100%; height: auto; overflow: visible; font: 11px var(--bb-font); }
bb-goals .tl-grid { stroke: var(--bb-grid); stroke-width: 1; }
bb-goals .tl-tick, bb-goals .tl-unit { fill: var(--bb-faint); font-variant-numeric: tabular-nums; }
bb-goals .tl-tick-major { fill: var(--bb-muted); font-weight: 600; }
bb-goals .tl-grid-major { stroke: var(--bb-border); }
bb-goals .tl-lbl { fill: var(--bb-muted); font-size: 11.5px; }
bb-goals .tl-lbl-due { fill: var(--bb-fg); font-weight: 600; }
bb-goals .tl-target { stroke: var(--bb-desired); stroke-width: 1; stroke-dasharray: 1 3; }
bb-goals .tl-due { stroke: var(--bb-fg); stroke-width: 1; opacity: .5; }
bb-goals .tl-now { stroke: var(--bb-muted); stroke-width: 1; stroke-dasharray: 1 2; }
bb-goals .tl-desired { fill: none; stroke: var(--bb-desired); stroke-width: 1.6; stroke-dasharray: 6 4; }
bb-goals .tl-aim { fill: var(--bb-bg); stroke: var(--bb-fg); stroke-width: 1.6; }
bb-goals .tl-real { fill: none; stroke: var(--bb-best); stroke-width: 2; stroke-linejoin: round; }
bb-goals .tl-real-idle { fill: none; stroke: var(--bb-best); stroke-width: 2; stroke-dasharray: 2 3; opacity: .7; }
bb-goals .tl-dot { fill: var(--bb-best); }
bb-goals .tl-met { fill: none; stroke: var(--bb-good); stroke-width: 2; }
bb-goals .tl-est { fill: none; stroke: var(--bb-estimate); stroke-width: 3; stroke-linejoin: round; stroke-linecap: round; }
bb-goals .tl-est-after { fill: none; stroke: var(--bb-estimate); stroke-width: 2; stroke-dasharray: 1 4; stroke-linecap: round; opacity: .8; }
bb-goals .tl-est-end { fill: var(--bb-estimate); }
bb-goals .tl-stepdot { fill: var(--bb-bg); stroke: var(--bb-estimate); stroke-width: 2; }
bb-goals .tl-band { fill: var(--bb-estimate-fill); stroke: var(--bb-estimate); stroke-width: 1; }
bb-goals .tl-hit { fill: transparent; cursor: pointer; }
bb-goals .tl-step { outline: none; }
bb-goals .tl-step:hover .tl-hit, bb-goals .tl-step.hot .tl-hit, bb-goals .tl-step:focus-visible .tl-hit { fill: var(--bb-estimate-fill); }
bb-goals .tl-step.hot .tl-stepdot, bb-goals .tl-step:hover .tl-stepdot { fill: var(--bb-estimate); }
bb-goals .tl-gap { stroke: var(--bb-warn); stroke-width: 2; }
bb-goals .tl-note { fill: var(--bb-muted); font-size: 11.5px; }
bb-goals .tl-note-gap { fill: var(--bb-warn); font-weight: 600; }
bb-goals .tl-gap.tl-calm { stroke: var(--bb-muted); }
bb-goals .tl-note-gap.tl-calm { fill: var(--bb-muted); }
bb-goals .tl-note-wait { fill: var(--bb-estimate); }
bb-goals .tl-note-met { fill: var(--bb-good); font-weight: 600; }
bb-goals .tl-refusal { color: var(--bb-muted); margin: 4px 0 2px; font-size: 13px; }
bb-goals .bbg-sub { font-size: 14px; margin: 16px 0 6px; }
bb-goals .bbg-sum { margin: 4px 0; font-size: 13.5px; }
bb-goals .bbg-steps, bb-goals .bbg-crit { list-style: none; margin: 0 0 6px; padding: 0; display: grid; gap: 2px; }
bb-goals .bbg-step { font: inherit; width: 100%; text-align: left; display: flex; flex-wrap: wrap; gap: 0 8px; align-items: baseline; padding: 5px 8px;
  border: 0; border-radius: 6px; background: none; color: var(--bb-fg); cursor: pointer; }
bb-goals .bbg-step:hover, bb-goals .bbg-step.hot, bb-goals .bbg-step:focus-visible { background: var(--bb-estimate-fill); outline: none; }
bb-goals .bbg-n { display: inline-grid; place-items: center; min-width: 20px; height: 20px; border-radius: 10px; font-size: 11.5px; font-weight: 650;
  color: var(--bb-estimate); border: 1.5px solid var(--bb-estimate); }
bb-goals .wait .bbg-n, bb-goals .done .bbg-n { border-color: var(--bb-muted); color: var(--bb-muted); }
bb-goals .bbg-st { min-width: 0; flex: 1 1 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
bb-goals .bbg-sm { color: var(--bb-muted); font-size: 12.5px; flex: 1 1 100%; padding-left: 28px; }
bb-goals .nobet { color: var(--bb-faint); font-style: italic; }
bb-goals .bet { color: var(--bb-estimate); }
bb-goals .bbg-crit li { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 0 6px; padding: 4px 8px; border-radius: 6px; font-size: 13.5px; }
bb-goals .bbg-crit .g { font-weight: 700; text-align: center; }
bb-goals .bbg-crit .g.pass { color: var(--bb-good); } bb-goals .bbg-crit .g.fail { color: var(--bb-warn); } bb-goals .bbg-crit .g.other { color: var(--bb-muted); }
bb-goals .bbg-crit .how { grid-column: 2; color: var(--bb-muted); font-size: 12.5px; }
bb-goals .bbg-crit code, bb-goals .bbg-moves code, bb-goals .bbg-finding code { font-family: var(--bb-mono); font-size: 12px; overflow-wrap: anywhere; }
bb-goals .bbg-finding { grid-column: 2; border-left: 3px solid var(--bb-warn); padding: 2px 0 2px 8px; margin: 3px 0 2px; font-size: 12.5px; }
bb-goals .bbg-finding b { color: var(--bb-warn); }
bb-goals .bbg-levers { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: flex-end; margin: 4px 0 6px; }
bb-goals .bbg-levers label { display: grid; gap: 3px; font-size: 12.5px; color: var(--bb-muted); min-width: 0; }
bb-goals .bbg-levers label.main span { color: var(--bb-fg); font-weight: 600; }
bb-goals .bbg-levers select { font: inherit; font-size: 13.5px; padding: 5px 8px; border: 1px solid var(--bb-border); border-radius: 6px;
  background: var(--bb-bg); color: var(--bb-fg); max-width: 100%; }
bb-goals .bbg-odds { font-size: 13.5px; margin: 2px 0 4px; display: flex; flex-wrap: wrap; gap: 2px 12px; align-items: baseline; }
bb-goals .bbg-odds .q { color: var(--bb-muted); font-size: 12px; }
bb-goals .bbg-odds .p { color: var(--bb-estimate); font-weight: 700; }
bb-goals .bbg-odds .p.late { color: var(--bb-warn); }
bb-goals .bbg-oddsv { font-size: 14px; margin: 6px 0 2px; }
bb-goals .bbg-moves { border-left: 3px solid var(--bb-warn); padding: 2px 0 2px 12px; margin: 8px 0 2px; font-size: 13.5px; }
bb-goals .bbg-moves.fits { border-left-color: var(--bb-border); color: var(--bb-muted); }
bb-goals .bbg-moves ul { margin: 4px 0 0; padding-left: 18px; display: grid; gap: 5px; max-width: 1000px; }
bb-goals .bbg-moves .odd { color: var(--bb-estimate); font-weight: 650; white-space: nowrap; }
bb-goals .bbg-how { color: var(--bb-faint); font-size: 12px; margin: 6px 0 0; }
bb-goals .bbg-foot { color: var(--bb-faint); font-size: 12.5px; margin: 6px 0 0; }
@media (max-width: 640px) {
  bb-goals .bbg-panel { padding: 12px 10px 10px; }
  bb-goals .bbg-go { margin-left: 0; }
  bb-goals .bbg-sm { padding-left: 0; }
  bb-goals .bbg-st { flex-basis: 100%; white-space: normal; }
  bb-goals .bbg-levers label { flex: 1 1 100%; }
}
`;

  teardown() { this._ro?.disconnect(); this._ro = null; }

  async render() {
    const slice = this.data.goals;
    if (!slice || !Array.isArray(slice.goals)) return this.empty();
    this._slice = slice;
    this._tag ??= this.settings.buffer === 'x1' ? 'x1' : 'x2';
    const ordered = [...slice.goals].sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9));
    this._order = ordered.map((g) => g.id);
    if (!this._goal || !slice.goals.some((g) => g.id === this._goal)) {
      this._goal = slice.goals.some((g) => g.id === this.settings.goal) ? this.settings.goal : this._order[0];
    }
    const id = `bbg${++uid}`;
    const problems = slice.problems || [];
    this.innerHTML = `<div class="bbg" id="${id}">
<p class="bbg-verdict" data-verdict aria-live="polite"></p>
<p class="bbg-asof"><span>as of ${esc(longClock(slice.as_of, slice.as_of))} · ${slice.goals.length} ${slice.goals.length === 1 ? 'goal' : 'goals'} in <code>goals/</code>, judged on the box's own ledger and tests${slice.clock === 'fixture' ? ' (a fixture\'s clock)' : ''}</span>
<label class="bbg-switch"><input type="checkbox" data-buffer${this._tag === 'x2' ? ' checked' : ''}> <span>Buffer ×${esc(String(slice.buffer || 2))}</span> <small>bottom-up estimates never include all the things</small></label></p>
${problems.length ? `<div class="bbg-problems" role="note"><b>${problems.length} ${problems.length === 1 ? 'line' : 'lines'} of the goals' files refused</b> (left out until fixed):<ul>${problems.map((p) => `<li><code>[${esc(p.lint)}] ${esc(p.where)}</code>: ${esc(p.what)}; <b>fix:</b> ${esc(p.fix)}</li>`).join('')}</ul></div>` : ''}
${slice.goals.length ? `${this.settings.pace ? '<div class="bbg-hero" data-hero></div>' : ''}
<p class="bbg-met" data-met></p>
<div class="bbg-chips" role="group" aria-label="Goal" data-chips></div>
<section class="bbg-panel" data-panel aria-live="polite"></section>
<p class="bbg-foot">${esc(this.paceLine(slice))}</p>` : ''}
</div>`;
    if (!slice.goals.length) return undefined;
    this.querySelector('[data-buffer]').addEventListener('change', (e) => { this._tag = e.target.checked ? 'x2' : 'x1'; this.draw(); });
    this.addEventListener('click', (e) => this.onClick(e));
    this.draw();
    // WHY redraw on resize: the two lines are SVG drawn to the panel's own width (a phone gets a narrower axis, never a scroll)
    this._w = 0;
    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => {
      const w = this.panelWidth();
      if (Math.abs(w - this._w) > 4) { this._w = w; this.drawPanel(); }
    });
    this._ro.observe(this.querySelector('[data-panel]'));
    if (this.settings.pace) await this.mountPace();
    this.dataset.drew = 'goals';
    return undefined;
  }

  paceLine(slice) {
    const p = slice.pace || {};
    return `The box itself: ${p.agent_solutions} agent solutions, a median ${p.minutes_per_solution_median ?? '—'}${NB}min apart; ${p.new_bests} new bests of ${p.tried} ideas tried`
      + (p.idle_hours != null ? `; idle ${hours(p.idle_hours)} (last scored ${p.last_scored ? clock(p.last_scored, slice.as_of) : '—'})` : '')
      + '. Every estimate here assumes it starts now.';
  }

  panelWidth() { return Math.max(260, Math.floor((this.querySelector('[data-panel]')?.getBoundingClientRect().width || 900) - 34)); }

  goal(id = this._goal) { return this._slice.goals.find((g) => g.id === id); }

  /** The pace list's rows: one per measurable target of each goal still in play (02: a met goal past its date would read
      "days over" in red there, so met goals sit on a line under it). */
  paceRows() {
    const tag = this._tag;
    const rows = [];
    for (const g of this._slice.goals.filter((x) => !isMet(x))) {
      for (const l of g.lines || []) {
        rows.push({ id: l.id, goal: g.id, title: `${g.id} ${g.title} · ${l.ref}`,
          about: `${g.tier} · ${goalWord(g, tag).word} · ${g.passed} of ${g.total} pass · ${hours(g.hours_left)} left`,
          pace: l.pace?.[tag] || 'cannot judge yet', due: g.due,
          now: l.refusal ? l.refusal : `${num(l.current)} ${l.unit} on ${l.candidate}`,
          target: `${OP[l.op]} ${num(l.target)} ${l.unit}`.trim(),
          readings: (l.readings || []).map((r) => ({ date: r.date, value: r.value, kind: r.kind, unit: r.unit })) });
      }
    }
    return rows.length ? rows : null;
  }

  async mountPace() {
    const hero = this.querySelector('[data-hero]');
    if (!hero) return;
    const rows = this.paceRows();
    if (!rows) { hero.remove(); return; }
    const core = await loadViews();
    const views = document.createElement('data-views');
    for (const [k, v] of [['no-url', ''], ['toolbar', 'none'], ['status', 'off'], ['view', 'Will we get there']]) views.setAttribute(k, v);
    views.setAttribute('aria-label', `${this.data.box || 'Box'}: will the goals be met`);
    // a pace row picks its goal for the panel below (WHY not the stock side peek: the panel IS that row's detail)
    const pick = (e) => {
      const r = e.target.closest && e.target.closest('[data-id]');
      if (!r || !views.contains(r)) return;
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      e.stopPropagation();
      e.preventDefault();
      const row = rows.find((x) => x.id === r.dataset.id);
      if (row) { this._goal = row.goal; this.draw(); this.querySelector('[data-panel]')?.scrollIntoView({ block: 'nearest' }); }
    };
    views.addEventListener('click', pick, true);
    views.addEventListener('keydown', pick, true);
    hero.replaceChildren(views);
    views.base = core.parseBase(PACE_BASE);
    views.data = { id: `bb/${this.data.box}/goals/pace`, title: `${this.data.box} goals`, titleProperty: 'title', properties: PACE_PROPS, rows };
    this._pace = views;
  }

  draw() {
    const slice = this._slice, tag = this._tag;
    const v = verdict(slice, { buffer: tag });
    const el = this.querySelector('[data-verdict]');
    el.textContent = v.text;
    el.className = `bbg-verdict ${v.tone}`;
    const met = slice.goals.filter(isMet);
    this.querySelector('[data-met]').innerHTML = met.map((g) => {
      const w = goalWord(g, tag);
      return `<span class="st good">${esc(g.status)}</span> <button type="button" class="bbg-link" data-goal="${esc(g.id)}"><b>${esc(g.id)}</b> ${esc(g.title)}</button> · ${esc(clock(g.met_at, slice.as_of))}, ${esc(w.time)} · by <code>${esc(g.met_by)}</code>`;
    }).join('<br>') + (met.length ? ' · met goals sit under the list, since a met goal past its date would read "days over" there' : '');
    this.querySelector('[data-chips]').innerHTML = this._order.map((gid) => {
      const g = this.goal(gid), w = goalWord(g, tag);
      return `<button type="button" class="bbg-chip" data-goal="${esc(gid)}" aria-pressed="${gid === this._goal}"><b>${esc(gid)}</b> <span class="t">${esc(g.title)}</span> <span class="st ${TONE[w.tone] || 'muted'}">${esc(w.word)}</span> <span class="time">${esc(w.time)}</span></button>`;
    }).join('');
    if (this._pace) this._pace.data = { ...this._pace.data, rows: this.paceRows() || [] };
    this.drawPanel();
  }

  ideaCount(g) { return this._slice.counts?.[g.id] ?? g.roadmap.length; }

  ideasHref(gid, idea = '') {
    const pattern = this.context.links.page || '{page}.html';
    return `${fill(pattern, { page: 'ideas' })}?goal=${encodeURIComponent(gid)}${idea ? `&idea=${encodeURIComponent(idea)}` : ''}`;
  }

  drawPanel() {
    const panel = this.querySelector('[data-panel]');
    if (!panel) return;
    const g = this.goal(), tag = this._tag, asOf = this._slice.as_of, b = Number(tag.slice(1));
    const w = goalWord(g, tag);
    const width = this.panelWidth();
    const lines = [...(g.lines || [])].sort((x, y) => (x.key === 'objective' ? 0 : 1) - (y.key === 'objective' ? 0 : 1));
    const waits = (g.bottom_up[tag].waits_on_zach || []).map((x) => x.id);
    const figs = lines.map((l, k) => {
      const row = { ...l, as_of: asOf, title: `${g.id} ${g.title} · ${l.ref}` };
      if (l.refusal) {
        const bu = g.bottom_up[tag];
        const adapted = { bottom_up: { [tag]: { steps: bu.steps, waits: bu.waits_on_zach, end: bu.estimate_if_started_now } } };
        return `<figure class="tl-fig"><figcaption class="tl-cap"><b>${esc(l.ref)}</b> ${esc(OP[l.op])} ${esc(num(l.target))} ${esc(l.unit)} · <span class="st muted">cannot be drawn</span></figcaption>`
          + `<p class="tl-refusal">${esc(l.refusal)}. The time half of the estimate still holds:</p>${timeOnly(adapted, row, { buffer: b, width })}</figure>`;
      }
      const word = l.pace?.[tag];
      const end = l.estimate_value?.[tag];
      const cap = l.retro ? `real ${num((l.readings.filter((r) => r.kind === 'real').slice(-1)[0] || {}).value)} ${l.unit} vs the estimate's ${num(end)} when it was set`
        : l.passes ? `${num(l.current)} ${l.unit} on ${l.candidate}: passes now; no idea on the roadmap moves it`
          : `${num(l.current)} → ${OP[l.op]} ${num(l.target)} ${l.unit} · the estimate ends at ${num(end)}`;
      const tone = word === 'at risk' ? 'warn' : word === 'missed' ? 'bad' : word === 'cannot judge yet' ? 'muted' : 'good';
      return `<figure class="tl-fig${k ? ' tl-fig-small' : ''}"><figcaption class="tl-cap"><b>${esc(l.ref)}</b> ${esc(OP[l.op])} ${esc(num(l.target))} ${esc(l.unit)} · <span class="st ${tone}">${esc(word)}</span> <span class="tl-capnote">${esc(cap)}</span></figcaption>`
        + `${twoLines(row, { buffer: b, width, compact: k > 0, waits: l.retro ? [] : waits })}</figure>`;
    });
    panel.innerHTML = `<header class="bbg-ph"><h2 class="bbg-h2"><span class="bbg-gid">${esc(g.id)}</span>${esc(g.title)}</h2>`
      + `<span class="bbg-meta">${esc(g.tier)} · <span class="st ${TONE[w.tone] || 'muted'}">${esc(w.word)}</span> · due ${esc(clock(g.due, asOf))} · ${esc(w.time)} · set ${esc(clock(g.set, asOf))} · ${g.passed} of ${g.total} criteria pass</span>`
      + `<a class="bbg-go" href="${esc(this.ideasHref(g.id))}" data-ideas="${esc(g.id)}">Its ${this.ideaCount(g)} ideas →</a></header>`
      + `<p class="bbg-per">${esc(perGoal(g, tag, asOf))}</p>`
      + (g.why ? `<p class="bbg-why">${esc(g.why)} <span>(<code>${esc(g.path)}</code>)</span></p>` : '')
      + (figs.length ? `<p class="bbg-legend"><span class="lg"><span class="k k-real"></span>real: the candidate since it was set</span><span class="lg"><span class="k k-des"></span>desired: your date</span><span class="lg"><span class="k k-est"></span>estimate: the roadmap's ideas, ×${b}${b === 2 ? '' : ' (buffer off)'}</span><span class="lg"><span class="k k-aim"></span>target</span></p>` : '')
      + figs.join('')
      + this.stepsHtml(g, tag)
      + this.criteriaHtml(g)
      + (this.settings.levers && g.odds ? '<section data-levers></section>' : '')
      + this.valueMovesHtml(g, tag);
    if (this.settings.levers && g.odds) this.drawLevers(g);
    this.wireSteps(panel, g.id);
  }

  stepsHtml(g, tag) {
    const bu = g.bottom_up[tag], asOf = this._slice.as_of, b = Number(tag.slice(1));
    const ideas = new Map((this.data.ideas || []).map((i) => [i.iid || i.id, i]));
    // WHY plain words: an idea's title may hold Markdown links ([specs/O1.1](specs/O1.1-….md)); the list shows their text
    const title = (id) => plain(ideas.get(id)?.title || g.roadmap.find((r) => r.id === id)?.title || '');
    const bet = (id) => { const r = g.roadmap.find((x) => x.id === id); return r?.expect_text ? `bets ${r.expect_text}` : 'no number bet'; };
    if (isMet(g)) {
      const done = g.roadmap.map((r) => `<li class="done"><button type="button" class="bbg-step" data-idea="${esc(r.id)}"><span class="bbg-n">${r.step}</span><b>${esc(r.id)}</b> <span class="bbg-st">${esc(title(r.id))}</span><span class="bbg-sm">${r.effort != null ? `${mins(r.effort)} written` : 'not sized'} · ${esc(r.status || '')}</span></button></li>`);
      return `<h3 class="bbg-sub">Its roadmap, crossed off</h3><ol class="bbg-steps">${done.join('')}</ol>`;
    }
    const steps = bu.steps.map((s, k) => `<li><button type="button" class="bbg-step" data-idea="${esc(s.id)}"><span class="bbg-n">${k + 1}</span><b>${esc(s.id)}</b> <span class="bbg-st">${esc(title(s.id))}</span>`
      + `<span class="bbg-sm">${mins(s.minutes)} × ${b} = ${mins(s.buffered)} → ${s.dated ? esc(clock(s.end, asOf)) : `after ${esc(s.after_waits.join(', '))} (undated)`} · <span class="${/no number/.test(bet(s.id)) ? 'nobet' : 'bet'}">${esc(bet(s.id))}</span></span></button></li>`);
    const waits = bu.waits_on_zach.map((x) => `<li class="wait"><button type="button" class="bbg-step" data-idea="${esc(x.id)}"><span class="bbg-n" aria-hidden="true">⏸</span><b>${esc(x.id)}</b> <span class="bbg-st">${esc(x.title)}</span><span class="bbg-sm">waits on you · not sized (nobody can estimate you)</span></button></li>`);
    const unest = bu.unestimated.map((u) => `<li><span class="bbg-step"><span class="bbg-n">?</span><b>${esc(u.id)}</b> <span class="bbg-sm">${esc(u.why)}: no estimate</span></span></li>`);
    const head = bu.steps.length || bu.waits_on_zach.length
      ? `The estimate sums ${bu.steps.length} agent ${bu.steps.length === 1 ? 'idea' : 'ideas'}: ${bu.agent_minutes}${NB}min × ${b} = ${bu.buffered_minutes}${NB}min from now → ${esc(clock(bu.estimate_if_started_now, asOf))}${bu.waits_on_zach.length ? `, then ${bu.waits_on_zach.length} ${bu.waits_on_zach.length === 1 ? 'wait' : 'waits'} on you` : ''}: ${esc(bu.fits)}.`
      : 'Nothing left on its roadmap.';
    return `<h3 class="bbg-sub">Its roadmap, in plan order</h3><p class="bbg-sum">${head}</p><ol class="bbg-steps">${steps.join('')}${waits.join('')}${unest.join('')}</ol>`;
  }

  criteriaHtml(g) {
    const items = g.criteria.map((c) => {
      const cls = c.passed ? 'pass' : c.state === 'fail' ? 'fail' : 'other';
      const how = c.refusal ? c.refusal
        : c.level === 'box' ? `${c.state === 'pass' ? `its ${c.tests} tests pass` : c.tests ? `its tests: ${c.state}` : 'no test names it yet'} (the repo's tests at the ref)`
          : c.kind === 'gates' ? `${c.passed ? 'every gate passes' : 'a gate fails'} on ${c.on || 'no solution'}, the candidate`
            : `${typeof c.measured === 'number' ? `${num(c.measured)} ` : ''}on ${c.on || 'no solution'}, the candidate`;
      const aimed = c.aimed_by.length ? ` · aimed at by ${c.aimed_by.join(', ')}` : '';
      const finding = c.finding ? `<div class="bbg-finding" role="note"><b>${esc(c.finding)}</b>: ${esc(c.fix)}</div>` : '';
      return `<li><span class="g ${cls}" aria-label="${esc(c.state)}">${STATE_GLYPH[c.state] || (c.passed ? '✓' : '·')}</span><span>${esc(c.label)} <code>${esc(c.line)}</code></span><span class="how">${esc(how)}${esc(aimed)}</span>${finding}</li>`;
    });
    return `<h3 class="bbg-sub">What it takes (${g.passed} of ${g.total} pass${g.judged < g.total ? `, ${g.total - g.judged} cannot be judged yet` : ''})</h3><ul class="bbg-crit">${items.join('')}</ul>`;
  }

  valueMovesHtml(g, tag) {
    const mv = valueMoves(g, tag, this._slice.as_of);
    if (!mv.length) return '';
    return `<div class="bbg-moves"><b>It does not reach every target by ${esc(clock(g.due, this._slice.as_of))}: your moves on its own ideas</b><ul>${mv.map((m) => `<li><b>${esc(m.move)}</b>: ${m.text}</li>`).join('')}</ul></div>`;
  }

  /** 03's levers: the odds under the reader's settings, each option labelled with its own odds, the moves when it does not fit. */
  drawLevers(g) {
    const host = this.querySelector('[data-levers]');
    if (!host) return;
    const m = g.odds, lv = levers(m), asOf = this._slice.as_of;
    this._lever ??= {};
    const st = (this._lever[g.id] ??= { slots: { ...m.slots }, start: 0 });
    const opt = (list, val) => list.map((o) => `<option value="${o.min}"${o.min === val ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
    host.innerHTML = `<h3 class="bbg-sub">The odds, from the box's own history</h3><p class="bbg-oddsv" data-oddsv></p>
<div class="bbg-levers" role="group" aria-label="What you set">${m.waits.map((wid) => `<label class="main"><span>You answer <code>${esc(wid)}</code> by</span><select data-wait="${esc(wid)}" aria-label="When you answer ${esc(wid)}">${opt(lv.answer, st.slots[wid])}</select></label>`).join('')}
<label><span>The box runs from</span><select data-start aria-label="When the box runs">${opt(lv.start, st.start)}</select></label></div>
<p class="bbg-odds" data-odds></p><div data-tmoves></div>
<p class="bbg-how">Each agent idea takes its written effort × ${m.buffer === 2 ? 'the buffer' : '1'} × a spread from the box's own pace (${esc(m.sigma_text)}) and lands ${esc(m.hit_text)} times (the box's hit rate); a miss costs one more idea of the roadmap's median effort. ${m.n.toLocaleString('en-CA')} draws, seed ${m.seed} (03 Odds).</p>`;
    const update = () => {
      const settings = { buffer: this._tag === 'x2' ? m.buffer : 1, start: st.start, slots: { ...st.slots } };
      const tm = timeMoves(m, settings, simulate, { answers: lv.answer });
      const r = tm.result;
      const late = !tm.fits;
      const wid = m.waits[0];
      host.querySelector('[data-oddsv]').innerHTML = `<b>${esc(g.id)} ${esc(g.title)}: <span class="p${late ? ' late' : ''}">${pct(r.p_on_time)}</span> on time</b>`
        + (wid ? ` if you answer <code>${esc(wid)}</code> by <b>${esc(lv.label(st.slots[wid]))}</b>` : '')
        + ` — and the box${this._slice.pace?.idle_hours ? `, idle ${hours(this._slice.pace.idle_hours)},` : ''} runs from ${st.start === 0 ? 'now' : esc(lv.label(st.start))}.`;
      host.querySelector('[data-oddsv] .p')?.classList.toggle('late', late);
      host.querySelector('[data-odds]').innerHTML = `<span class="q">P10</span> <b>${esc(lv.label(r.finish.p10))}</b> <span class="q">P50</span> <b>${esc(lv.label(r.finish.p50))}</b> <span class="q">P90</span> <b>${esc(lv.label(r.finish.p90))}</b> <span class="q">vs due</span> <b>${esc(clock(g.due, asOf))}</b> <span class="q">on time</span> <span class="p${late ? ' late' : ''}">${pct(r.p_on_time)}</span> <span class="q">of ${r.n.toLocaleString('en-CA')} draws</span>`;
      const own = simulate(m, { ...settings, slots: Object.fromEntries(m.waits.map((x) => [x, st.start])) });
      host.querySelector('[data-tmoves]').innerHTML = tm.fits
        ? `<div class="bbg-moves fits">Fits: no move needed. The box's own part needs about <b>${hours((own.finish.p50 - st.start) / 60)}</b> (P90 ${hours((own.finish.p90 - st.start) / 60)}) once it runs; the date is decided by ${m.waits.length ? 'your answer and ' : ''}when the box runs.</div>`
        : `<div class="bbg-moves"><b>Does not fit: ${pct(r.p_on_time)} on time.</b> The three moves, each re-simulated on ${esc(g.id)}'s own ideas:<ul>${tm.moves.map((x) => `<li><b>${esc(x.move)}</b>: ${esc(x.text)}${x.p != null ? ` → <span class="odd">${pct(x.p)}</span> on time` : ''}</li>`).join('')}</ul></div>`;
      this.relabel(host, m, settings);
    };
    host.querySelectorAll('select[data-wait]').forEach((s) => s.addEventListener('change', () => { st.slots[s.dataset.wait] = Number(s.value); update(); }));
    host.querySelector('select[data-start]').addEventListener('change', (e) => { st.start = Number(e.target.value); update(); });
    update();
  }

  /** Each option carries its own odds under the other settings (03: the lever, read before it is pulled). */
  relabel(host, m, settings) {
    const job = (this._job = (this._job || 0) + 1);
    const lv = levers(m);
    const opts = [...host.querySelectorAll('option')];
    const step = (i) => {
      if (job !== this._job || i >= opts.length || !host.isConnected) return;
      const o = opts[i], v = Number(o.value), sel = o.parentElement;
      const over = sel.dataset.wait ? { slots: { ...settings.slots, [sel.dataset.wait]: v } } : { start: v };
      o.textContent = `${sel.dataset.wait || v ? lv.label(v) : 'now'} · ${pct(simulate(m, { ...settings, ...over }).p_on_time)}`;
      setTimeout(() => step(i + 1), 0);
    };
    step(0);
  }

  wireSteps(root, gid) {
    const mark = (id, on) => root.querySelectorAll(`[data-idea="${CSS.escape(id)}"]`).forEach((n) => n.classList.toggle('hot', on));
    for (const el of root.querySelectorAll('.tl-step, .bbg-step[data-idea]')) {
      const id = el.dataset.idea;
      el.addEventListener('mouseenter', () => mark(id, true));
      el.addEventListener('mouseleave', () => mark(id, false));
      el.addEventListener('focus', () => mark(id, true));
      el.addEventListener('blur', () => mark(id, false));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.goIdeas(gid, id); } });
    }
  }

  goIdeas(gid, idea = '') {
    const href = this.ideasHref(gid, idea);
    const go = this.context.open(this, { kind: 'page', id: 'ideas', query: { goal: gid, ...(idea ? { idea } : {}) }, href });
    return go;
  }

  onClick(e) {
    const t = e.target;
    const goal = t.closest?.('[data-goal]');
    if (goal && this.contains(goal)) { this._goal = goal.dataset.goal; this.draw(); return; }
    const link = t.closest?.('[data-ideas]');
    if (link) {
      const go = this.goIdeas(link.dataset.ideas);
      if (!go || !this.context.follow) e.preventDefault();
      return;
    }
    const step = t.closest?.('[data-idea]');
    if (step && step.closest('[data-panel]')) this.goIdeas(this._goal, step.dataset.idea);
  }
}
register(BBGoals);
