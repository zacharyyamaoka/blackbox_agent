/* <bb-needs-you>: the Receipt (viewer/CONTRACT.md §23; agent_activity_agent/proposals/needs-you P5, 90 of 100). One calm
   sentence and the two counts first, then three steps:
     1 Your call: only what cannot go ahead without him (blocking, no default, or nothing undoes it), the recommended
       answer picked;
     2 Going ahead on their own: each question with its default and when it lands, grouped by kind;
     3 Decided for you: a bank statement of what the agents already did, "All look right" per group, Undo per line.
   WHY (Zach, Daily Note 2026-11-25): "a good way for me to do the needs you review and for me to kinda like confirm what
   is has already done". The page is static and writes nothing: every button shows the exact command (or edit) that
   does it, with a Copy button, so what the page claims is what happens. Each ask is shown whole (truthful rendering).
   Layout `list` keeps the older flat list; `pill` is the one count. */
import { BBElement, esc } from '../core/element.js';
import { register } from '../core/registry.js';
import { md } from '../core/inline.js';
import { needsYou } from '../core/needs.js';
import schema from './bb-needs-you.schema.js';

const KIND = { blocked: 'Blocked', ruler: 'Ruler', test: 'Test', decision: 'Decision', gate: 'Gate', release: 'Release',
  'other-people': 'Other people', 'delete-data': 'Deleting data', secret: 'Secret', money: 'Money', hardware: 'Hardware',
  'new-track': 'Track proposal', 'new-track-requested': 'Track you asked for', 'still-important': 'Still important?' };
// the why of a no-default kind when the state carries no catalog (a state folded before the Receipt)
const FALLBACK_WHY = { blocked: 'the box cannot go on until it is answered', ruler: 'your success criteria', gate: 'your success criteria' };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Nov 27, 07:58 UTC": always UTC, so the page reads the same on every machine and in every screenshot. */
export function when(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const p = (x) => String(x).padStart(2, '0');
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}
/** A command template's `{option}` filled in. */
export const fillCommand = (cmd, option) => String(cmd || '').replaceAll('{option}', option);

function whyCall(n, kinds) {
  const why = (k) => (kinds[k] && kinds[k].why) || FALLBACK_WHY[k];
  if (n.state === 'blocking' || n.kind === 'blocked') return `Blocking: ${why('blocked')}`;
  if (n.still_stop) return `Still stop: ${why(n.kind) || 'nothing undoes it'}`;
  const k = kinds[n.kind];
  return `No default: ${k && k.default_text == null ? k.why : (FALLBACK_WHY[n.kind] || 'none was filed with it')}`;
}
const callRank = (n) => (n.state === 'blocking' || n.kind === 'blocked' ? 0 : n.still_stop ? 1 : 2);

/** What the Receipt draws, from the needs and receipt slices. Pure: the node tests read it. */
export function receiptModel(d) {
  const needs = Array.isArray(d.needs) ? d.needs : [];
  const r = d.receipt || null;
  const kinds = (r && r.kinds) || {};
  const c = (r && r.counts) || {};
  const call = needs.filter((n) => !n.step || n.step === 'call').map((n, i) => ({ ...n, why: whyCall(n, kinds), i }))
    .sort((a, b) => callRank(a) - callRank(b) || a.i - b.i);
  const ahead = needs.filter((n) => n.step === 'ahead');
  const byId = Object.fromEntries(ahead.map((n) => [n.id, n]));
  const aheadGroups = r ? r.ahead.map((g) => ({ ...g, items: g.ids.map((id) => byId[id]).filter(Boolean) })) : [];
  const groups = r ? r.groups : [];
  const N = needsYou(d) ?? 0;
  const going = ahead.length;
  const decided = c.decided || 0;
  const head = N ? `${plural(N, 'thing')} need${N === 1 ? 's' : ''} you.` : 'Nothing needs you.';
  const sentence = r
    ? `${head} ${plural(going, 'question')} go${going === 1 ? 'es' : ''} ahead on their own, and the agents decided ${plural(decided, 'thing')}, ${c.undoable || 0} of them undoable.`
    : `${head} No question has a default yet, and no decision is logged with an undo.`;
  const resolved = (c.went_ahead_on_default || 0) + (c.answered || 0);
  const counts = [
    { id: 'needs_you', label: 'Needs you', value: String(N), tone: N ? 'warn' : 'good',
      detail: 'lower is better: you decide less, or autonomy grows' },
    { id: 'default_pct', label: 'Went ahead on its default', value: r && c.default_pct != null ? `${c.default_pct} %` : '—', tone: 'neutral',
      detail: r ? `${c.went_ahead_on_default || 0} of ${resolved} resolved questions · ${c.open_no_default || 0} of ${c.open || 0} open have no default`
        : 'no needs.jsonl: no question has been resolved on a default' },
  ];
  const steps = [
    { n: 1, id: 'call', title: 'Your call', count: call.length, items: call,
      lede: 'What only you can answer: blocking, no default, or nothing undoes it. The recommended answer is picked.',
      empty: 'Nothing needs your call. A question lands here when it is blocking, has no default, or is on the still-stop list (a release, other people, deleting data, a secret, money, hardware).' },
    { n: 2, id: 'ahead', title: 'Going ahead on their own', count: going, groups: aheadGroups,
      lede: 'Each takes its default at the time shown. Nothing to do; change one if you disagree.',
      empty: 'Nothing is going ahead on its own. A question lands here when needs.jsonl files it with a default and when it lands (default.applies_at), and nothing blocks it.' },
    { n: 3, id: 'decided', title: 'Decided for you', count: decided, groups,
      tally: groups.map((g) => ({ label: g.label, n: g.rows.length })),
      lede: 'What the agents already did, grouped. Confirm a group in one go; undo any line.',
      empty: 'Nothing decided for you yet. A line lands here when an agent logs an action with its undo (actions.jsonl `undo`), or a question goes ahead on its default.' },
  ];
  return { sentence, counts, steps, asOf: r ? r.as_of : d.read_at, toReview: c.to_review || 0 };
}

const copyBox = (text, label = 'Copy') => `<div class="bbr-cmd"><pre class="bb-mono">${esc(text)}</pre><button type="button" class="bbr-btn" data-copy="${esc(text)}">${label}</button></div>`;
const runNote = '<p class="bbr-run">Run it in the box’s checkout. This page writes nothing.</p>';

function legacyEdit(n) {
  if (n.source === 'status.json blocked_on') return 'Answer it, then clear blocked_on in status.json.';
  if (/^ideas\.md:\d+$/.test(n.source || '')) return `Answer it on its line, ${n.source}, and tick it (- [x]).`;
  return `Answer it where it is written: ${n.source}.`;
}

function callCard(n, s) {
  const opts = n.options || [];
  const pick = n.recommended || (n.default && n.default.option) || (opts[0] && opts[0].id);
  const radios = opts.length && n.answer_cmd ? `<div class="bbr-opts" role="radiogroup" aria-label="Answer">${opts.map((o) => `<label class="bbr-opt"><input type="radio" name="bbr-${esc(n.id)}" value="${esc(o.id)}"${o.id === pick ? ' checked' : ''} data-for="${esc(n.id)}"> ${esc(o.label)}${o.recommended ? ' <span class="bbr-rec">recommended</span>' : ''}</label>`).join('')}</div>
    <div data-answer="${esc(n.id)}" data-template="${esc(n.answer_cmd)}">${copyBox(fillCommand(n.answer_cmd, pick))}</div>${runNote}`
    : `<p class="bbr-run">${esc(legacyEdit(n))}</p>`;
  const body = [n.text && n.text !== n.ask ? `<div class="body">${md(n.text)}</div>` : '',
    n.recommendation ? `<div class="body"><b>Recommended:</b> ${md(n.recommendation)}</div>` : '',
    s.show_source ? `<div class="src bb-mono">${esc(n.source)}${n.section ? ` · ${esc(n.section)}` : ''}</div>` : ''].join('');
  return `<li class="bbr-card${callRank(n) === 0 ? ' blocking' : ''}"><div class="top"><span class="kind">${esc(KIND[n.kind] || n.kind || 'ask')}</span><span class="why">${esc(n.why)}</span></div>
    <div class="ask">${md(n.ask)}</div>${body ? `<details class="more"><summary>The question in full</summary>${body}</details>` : ''}${radios}</li>`;
}

function changeBox(n) {
  if (!n.answer_cmd || !(n.options || []).length) return '';
  return `<details class="bbr-change"><summary class="bbr-btn">Change…</summary><div class="bbr-panel">${n.options.map((o) => `<div class="bbr-optcmd"><span>${esc(o.label)}${n.default && o.id === n.default.option ? ' <span class="bbr-rec">the default</span>' : ''}</span>${copyBox(fillCommand(n.answer_cmd, o.id))}</div>`).join('')}${runNote}</div></details>`;
}

function aheadGroup(g) {
  return `<details class="bbr-group"><summary><span class="chev" aria-hidden="true">▸</span><span class="gl">${esc(g.label)}</span><span class="n">${g.items.length}</span>
    <span class="def"><span aria-hidden="true">◇</span> “${esc(g.default_text)}”${g.soonest ? `, first lands ${esc(when(g.soonest))}` : ''}</span></summary>
    <ol class="bbr-rows">${g.items.map((n) => `<li class="bbr-row"><span class="t bb-mono">${esc(n.lands ? when(n.lands) : (n.default && n.default.applies_when) || '')}</span><div class="w"><div>${md(n.ask)}</div><div class="sub">◇ ${esc(n.default ? n.default.text : '')}</div></div><div class="act">${changeBox(n)}</div></li>`).join('')}</ol></details>`;
}

function decidedRow(r) {
  const status = r.review ? `<span class="bbr-rev ${esc(r.review.verdict)}">${r.review.verdict === 'confirmed' ? '✓ confirmed' : '↩ undone'}</span>` : '';
  let act = '';
  if (r.review && r.review.verdict === 'undone') act = '';
  else if (r.undo_cmd) act = `<details class="bbr-change"><summary class="bbr-btn">Undo</summary><div class="bbr-panel">${copyBox(r.undo_cmd.join('\n'))}<p class="bbr-run">The first line undoes it; the second records that you did. Run them in the box’s checkout. This page writes nothing.</p></div></details>`;
  else if (r.group === 'went-ahead' && r.answer_cmd && (r.options || []).length) act = `<details class="bbr-change"><summary class="bbr-btn">Undo</summary><div class="bbr-panel"><p class="bbr-run">Answer it another way; your answer overrides the default.</p>${r.options.map((o) => `<div class="bbr-optcmd"><span>${esc(o.label)}</span>${copyBox(fillCommand(r.answer_cmd, o.id))}</div>`).join('')}${runNote}</div></details>`;
  else if (!r.undoable) act = '<span class="bbr-cant">can’t undo</span>';
  return `<li class="bbr-row${r.review ? ` reviewed ${esc(r.review.verdict)}` : ''}"><span class="t bb-mono">${esc(when(r.t))}</span><div class="w"><div>${md(r.title)}</div>${r.track ? `<div class="sub">${esc(r.track)}</div>` : ''}</div><div class="act">${status}${act}</div></li>`;
}

function decidedGroup(g, open) {
  const confirm = g.confirm_cmd
    ? `<details class="bbr-change bbr-confirm"><summary class="bbr-btn">✓ All look right</summary><div class="bbr-panel">${copyBox(g.confirm_cmd)}<p class="bbr-run">Records that you confirmed the ${plural(g.to_review.length, 'line')} not yet reviewed. Run it in the box’s checkout. This page writes nothing.</p></div></details>`
    : '<span class="bbr-done">all reviewed</span>';
  return `<details class="bbr-group"${open ? ' open' : ''}><summary><span class="chev" aria-hidden="true">▸</span><span class="gl">${esc(g.label)}</span><span class="n">${g.rows.length}</span>${g.to_review.length && g.to_review.length !== g.rows.length ? `<span class="def">${g.to_review.length} to review</span>` : ''}</summary>
    <div class="bbr-gact">${confirm}</div><ol class="bbr-rows">${g.rows.map(decidedRow).join('')}</ol></details>`;
}

export class BBNeedsYou extends BBElement {
  static schema = schema;
  static css = `
bb-needs-you { display: block; min-width: 0; }
bb-needs-you .bbn-head { display: flex; align-items: baseline; gap: 8px; margin: 0 0 8px; }
bb-needs-you .bbn-head h3 { margin: 0; font-size: 16px; }
bb-needs-you .bbn-head .n { color: var(--bb-muted); font-size: 13px; }
bb-needs-you ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
bb-needs-you .bbn-list li { border: 1px solid var(--bb-border); border-radius: calc(var(--bb-radius) + 2px); padding: 8px 12px; min-width: 0; }
bb-needs-you .bbn-list li.blocked { border-color: color-mix(in srgb, var(--bb-warn) 60%, var(--bb-border)); background: color-mix(in srgb, var(--bb-warn) 8%, var(--bb-bg)); }
bb-needs-you summary { cursor: pointer; list-style: none; }
bb-needs-you summary::-webkit-details-marker { display: none; }
bb-needs-you .bbn-list summary { display: flex; gap: 8px; align-items: baseline; }
bb-needs-you .ask { font-weight: 550; overflow-wrap: anywhere; }
bb-needs-you .kind { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--bb-muted); border: 1px solid var(--bb-border); border-radius: 6px; padding: 0 5px; flex: none; }
bb-needs-you .body { margin: 6px 0 0; color: var(--bb-fg); font-size: 13.5px; line-height: 1.5; overflow-wrap: anywhere; }
bb-needs-you .src { color: var(--bb-muted); font-size: 12px; margin-top: 4px; }
bb-needs-you .more { display: inline-block; margin-top: 6px; font-size: 13px; }
bb-needs-you .more > summary { color: var(--bb-accent); }
bb-needs-you .pill { display: inline-flex; gap: 8px; align-items: center; padding: 6px 12px; border-radius: 16px; border: 1px solid var(--bb-border); text-decoration: none; color: var(--bb-fg); }
bb-needs-you .pill.on { border-color: var(--bb-warn); background: color-mix(in srgb, var(--bb-warn) 10%, var(--bb-bg)); }
bb-needs-you .bbr-answer { font-size: 17px; line-height: 1.45; margin: 0 0 4px; overflow-wrap: anywhere; }
bb-needs-you .bbr-sub { color: var(--bb-muted); font-size: 12.5px; margin: 0 0 12px; }
bb-needs-you .bbr-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin: 0 0 18px; }
bb-needs-you .bbr-kpi { border: 1px solid var(--bb-border); border-radius: calc(var(--bb-radius) + 2px); padding: 10px 14px; background: var(--bb-card); min-width: 0; }
bb-needs-you .bbr-kpi.warn { border-color: color-mix(in srgb, var(--bb-warn) 55%, var(--bb-border)); }
bb-needs-you .bbr-kpi .lbl { color: var(--bb-muted); font-size: 12.5px; }
bb-needs-you .bbr-kpi .val { font-size: 28px; font-weight: 650; line-height: 1.2; font-variant-numeric: tabular-nums; }
bb-needs-you .bbr-kpi .dir { color: var(--bb-muted); font-size: 12px; overflow-wrap: anywhere; }
bb-needs-you .bbr-step { margin: 0 0 18px; }
bb-needs-you .bbr-step > h3 { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font-size: 16px; }
bb-needs-you .bbr-step > h3 .num { display: inline-flex; width: 22px; height: 22px; border-radius: 50%; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; background: var(--bb-subtle); color: var(--bb-muted); flex: none; }
bb-needs-you .bbr-step > h3 .n { color: var(--bb-muted); font-weight: 500; font-size: 13px; }
bb-needs-you .lede { color: var(--bb-muted); font-size: 13px; margin: 0 0 8px; }
bb-needs-you .bbr-empty { color: var(--bb-muted); font-size: 13px; border: 1px dashed var(--bb-border); border-radius: calc(var(--bb-radius) + 2px); padding: 10px 12px; margin: 0; }
bb-needs-you .bbr-card { border: 1px solid var(--bb-border); border-radius: calc(var(--bb-radius) + 2px); padding: 10px 12px; min-width: 0; background: var(--bb-card); }
bb-needs-you .bbr-card.blocking { border-color: color-mix(in srgb, var(--bb-warn) 60%, var(--bb-border)); }
bb-needs-you .bbr-card .top { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; margin: 0 0 4px; }
bb-needs-you .bbr-card .why { color: var(--bb-muted); font-size: 12.5px; }
bb-needs-you .bbr-opts { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 8px 0 6px; font-size: 13.5px; }
bb-needs-you .bbr-opt { display: inline-flex; gap: 5px; align-items: center; cursor: pointer; }
bb-needs-you .bbr-rec { font-size: 11px; color: var(--bb-good); border: 1px solid color-mix(in srgb, var(--bb-good) 50%, var(--bb-border)); border-radius: 6px; padding: 0 4px; }
bb-needs-you .bbr-cmd { display: flex; gap: 6px; align-items: stretch; min-width: 0; margin: 4px 0; }
bb-needs-you .bbr-cmd pre { flex: 1; min-width: 0; margin: 0; padding: 6px 8px; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--bb-subtle); border-radius: var(--bb-radius); }
bb-needs-you .bbr-btn { font: inherit; font-size: 12.5px; color: var(--bb-fg); background: var(--bb-bg); border: 1px solid var(--bb-border); border-radius: var(--bb-radius); padding: 3px 9px; cursor: pointer; white-space: nowrap; display: inline-block; }
bb-needs-you .bbr-btn:hover { background: var(--bb-hover); }
bb-needs-you .bbr-run { color: var(--bb-muted); font-size: 12px; margin: 2px 0 0; }
bb-needs-you .bbr-group { border: 1px solid var(--bb-border); border-radius: calc(var(--bb-radius) + 2px); margin: 0 0 6px; background: var(--bb-card); min-width: 0; }
bb-needs-you .bbr-group > summary { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; padding: 8px 12px; }
bb-needs-you .bbr-group > summary .chev { color: var(--bb-muted); transition: transform .15s; display: inline-block; }
bb-needs-you .bbr-group[open] > summary .chev { transform: rotate(90deg); }
bb-needs-you .bbr-group .gl { font-weight: 600; }
bb-needs-you .bbr-group .n { color: var(--bb-muted); font-size: 13px; }
bb-needs-you .bbr-group .def { color: var(--bb-muted); font-size: 12.5px; overflow-wrap: anywhere; }
bb-needs-you .bbr-gact { padding: 0 12px 6px; }
bb-needs-you .bbr-rows { gap: 0; padding: 0 12px 6px; }
bb-needs-you .bbr-row { display: grid; grid-template-columns: 128px minmax(0, 1fr) auto; gap: 4px 10px; align-items: baseline; padding: 6px 0; border-top: 1px solid var(--bb-rule, var(--bb-border)); font-size: 13.5px; }
bb-needs-you .bbr-row .t { color: var(--bb-muted); font-size: 11.5px; }
bb-needs-you .bbr-row .w { min-width: 0; overflow-wrap: anywhere; }
bb-needs-you .bbr-row .sub { color: var(--bb-muted); font-size: 12px; }
bb-needs-you .bbr-row .act { display: flex; gap: 6px; align-items: baseline; justify-content: flex-end; flex-wrap: wrap; }
bb-needs-you .bbr-row.reviewed .w { color: var(--bb-muted); }
bb-needs-you .bbr-row.undone .w > div:first-child { text-decoration: line-through; }
bb-needs-you .bbr-change { display: contents; }
/* WHY: an open Undo / Change… takes a line of its own under the row, so the row's words keep their width (at 390 px a
   panel beside them squeezed them to one letter a line) */
bb-needs-you .bbr-row:has(.bbr-change[open]) .act { grid-column: 1 / -1; justify-content: flex-start; }
bb-needs-you .bbr-panel { flex-basis: 100%; width: 100%; text-align: left; padding: 6px 0 2px; }
bb-needs-you .bbr-optcmd > span { font-size: 12.5px; }
bb-needs-you .bbr-cant, bb-needs-you .bbr-done { color: var(--bb-muted); font-size: 12px; }
bb-needs-you .bbr-rev { font-size: 12px; color: var(--bb-muted); }
bb-needs-you .bbr-rev.confirmed { color: var(--bb-good); }
bb-needs-you .bbr-tally { display: flex; gap: 6px; flex-wrap: wrap; margin: 0 0 8px; }
bb-needs-you .bbr-tally span { font-size: 12.5px; border: 1px solid var(--bb-border); border-radius: 12px; padding: 1px 9px; color: var(--bb-muted); }
bb-needs-you .bbr-tally b { color: var(--bb-fg); }
@media (max-width: 640px) {
  bb-needs-you .bbr-row { grid-template-columns: minmax(0, 1fr) auto; }
  bb-needs-you .bbr-row .t { grid-column: 1 / -1; }
  bb-needs-you .bbr-answer { font-size: 16px; }
}
`;

  render() {
    const s = this.settings;
    const d = this.data;
    this.id = this.id || 'needs';
    if (s.layout === 'pill') {
      const n = needsYou(d) ?? 0;
      this.innerHTML = `<a class="pill${n ? ' on' : ''}" href="${esc(s.href || '#needs')}">${esc(s.title)} <b>${n}</b>${n ? '' : ' · nothing waiting'}</a>`;
      return;
    }
    if (s.layout === 'list') return this.renderList(s);
    if (!Array.isArray(d.needs) && !d.receipt) return this.empty(this.schema.empty, 'No needs slice in this state.');
    const m = receiptModel(d);
    const [first, ...rest] = m.sentence.split(/(?<=\.) /);
    const step = (x, inner) => `<section class="bbr-step" data-step="${x.n}"><h3><span class="num">${x.n}</span>${esc(x.title)} <span class="n">${x.count}</span></h3>
      ${x.count ? `<p class="lede">${esc(x.lede)}</p>${inner}` : `<p class="bbr-empty">${esc(x.empty)}</p>`}</section>`;
    const [s1, s2, s3] = m.steps;
    const cards = s1.items.slice(0, s.limit).map((n) => callCard(n, s)).join('');
    const hidden = s1.items.slice(s.limit);
    const one = `<ol class="bbr-cards">${cards}</ol>${hidden.length ? `<details class="more"><summary>${plural(hidden.length, 'more question')}</summary><ol class="bbr-cards">${hidden.map((n) => callCard(n, s)).join('')}</ol></details>` : ''}`;
    const two = s2.groups.map(aheadGroup).join('');
    const three = `<div class="bbr-tally">${s3.tally.map((t) => `<span>${esc(t.label)} <b>${t.n}</b></span>`).join('')}</div>${s3.groups.map((g, i) => decidedGroup(g, i === 0)).join('')}`;
    this.innerHTML = `<div class="bbr">
      <div class="bbn-head"><h3>${esc(s.title)}</h3></div>
      <p class="bbr-answer"><b>${esc(first)}</b> ${esc(rest.join(' '))}</p>
      <p class="bbr-sub">As of ${esc(when(m.asOf))}, the commit this page was built from. The buttons below show the command that does each thing; the page itself writes nothing.</p>
      <div class="bbr-kpis">${m.counts.map((k) => `<div class="bbr-kpi ${k.tone}" data-count="${k.id}"><div class="lbl">${esc(k.label)}</div><div class="val">${esc(k.value)}</div><div class="dir">${esc(k.detail)}</div></div>`).join('')}</div>
      ${step(s1, one)}${step(s2, two)}${step(s3, three)}</div>`;
    this.bind();
  }

  bind() {
    this.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', (e) => {
      e.preventDefault();
      const text = b.getAttribute('data-copy');
      const done = () => { b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1500); };
      const pre = b.parentElement.querySelector('pre');
      const select = () => { const r = document.createRange(); r.selectNodeContents(pre); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, select);
      else select();
    }));
    this.querySelectorAll('input[type=radio][data-for]').forEach((input) => input.addEventListener('change', () => {
      const box = this.querySelector(`[data-answer="${CSS.escape(input.dataset.for)}"]`);
      if (!box) return;
      const cmd = fillCommand(box.dataset.template, input.value);
      box.querySelector('pre').textContent = cmd;
      box.querySelector('[data-copy]').setAttribute('data-copy', cmd);
    }));
  }

  renderList(s) {
    const all = (this.data.needs || []).slice().sort((a, b) => (b.kind === 'blocked') - (a.kind === 'blocked'));
    if (!all.length) return this.empty(this.schema.empty, 'No open line under “Suggestions for Zach” in ideas.md, no open question in needs.jsonl, and status.json is not blocked.');
    const shown = all.slice(0, s.limit);
    this.innerHTML = `<div class="bbn-head"><h3>${esc(s.title)}</h3><span class="n">${all.length} open</span></div>
      <ol class="bbn-list">${shown.map((n) => `<li class="${n.kind === 'blocked' ? 'blocked' : ''}"><details>
        <summary><span class="kind">${esc(KIND[n.kind] || n.kind || 'ask')}</span><span class="ask">${md(n.ask)}</span></summary>
        ${n.text && n.text !== n.ask ? `<div class="body">${md(n.text)}</div>` : ''}
        ${s.show_source ? `<div class="src bb-mono">${esc(n.source)}${n.section ? ` · ${esc(n.section)}` : ''}</div>` : ''}
      </details></li>`).join('')}</ol>
      ${all.length > shown.length ? `<a class="more" href="${esc(s.href || '#needs')}">${all.length - shown.length} more</a>` : ''}`;
  }
}
register(BBNeedsYou);
