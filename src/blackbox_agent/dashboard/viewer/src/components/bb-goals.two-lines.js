/* data-ui gap (CONTRACT §20): pace has no estimate line. proposals-goals/02-two-lines/two-lines.js @ 642290f, kept apart
   so it can be lifted into data-ui's pace view as its amendment (`readings[].kind: estimate`). It draws ONE line row of
   the goals slice (tools/folds/goals.py `lines[]`, with `as_of` and `title` beside it) at the row's own time resolution:

     desired    dashed --bb-desired: from the reading at the goal's set time to the target reading at its due date
     real       solid --bb-best: the candidate's readings since the goal was set (a step line: a best only moves on a
                new score), dotted on to "now" while nothing new was scored
     estimate   --bb-estimate: from now, one step per roadmap idea of the agent's, ending where bottom_up says (buffer
                ×2 or ×1) and moved by the idea's own `- Expect:` bet on THIS line; no bet, a flat step ("no number bet");
                a range bet adds its band; after the last step a dotted run to the due date, with Zach's waits named
                there and never given a length

   Changes from 02: the box's clock comes from the row's as_of offset (02 fixed −07:00), and the estimate readings are
   `row.estimate.x2 / .x1` (the slice's shape). twoLines(row, {buffer, width}) -> SVG markup; each step is a
   <g data-idea> the component wires (hover, click). Pure: no DOM, no fetch. */

const DAY = 86400000, HOUR = 3600000;
const t = (iso) => new Date(iso).getTime();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const OP = { '<=': '≤', '<': '<', '>=': '≥', '>': '>', '==': '=' };
const OPS = { '<=': (a, b) => a <= b, '<': (a, b) => a < b, '>=': (a, b) => a >= b, '>': (a, b) => a > b, '==': (a, b) => a === b };

// WHY the box's own clock, not the reader's: a goal is judged "as of" one moment, written with the box's offset
let TZ = -7 * HOUR;
const setClock = (asOf) => { const m = /([+-])(\d\d):(\d\d)$/.exec(String(asOf || '')); TZ = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * HOUR + Number(m[3]) * 60000) : 0; };
const local = (ms) => new Date(ms + TZ);
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const hhmm = (ms) => { const d = local(ms); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
export function clock(iso, asOf) {
  setClock(asOf);
  const ms = t(iso), d = local(ms), n = local(t(asOf));
  const sameDay = d.getUTCFullYear() === n.getUTCFullYear() && d.getUTCMonth() === n.getUTCMonth() && d.getUTCDate() === n.getUTCDate();
  if (sameDay) return hhmm(ms);
  if (Math.abs(ms - t(asOf)) < 6 * DAY) return `${WD[d.getUTCDay()]} ${hhmm(ms)}`;
  return `${MO[d.getUTCMonth()]} ${d.getUTCDate()} ${hhmm(ms)}`;
}
export const num = (v) => (v === null || v === undefined ? '—' : Math.abs(v) < 1 ? Number(v.toPrecision(4)).toString() : Number(v.toPrecision(3)).toString());

function ticks(lo, hi, n) {
  const span = hi - lo || Math.abs(hi) || 1;
  const step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= step0) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

function timeTicks(t0, t1, width) {
  const span = t1 - t0, room = Math.max(2, Math.floor(width / 90));
  const steps = [HOUR / 2, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 3 * DAY, 7 * DAY];
  const step = steps.find((s) => span / s <= room) || 14 * DAY;
  const out = [];
  // aligned on the box's local clock (midnight / the hour)
  let first = Math.ceil((t0 + TZ) / step) * step - TZ;
  // WHY the day at midnight: a multi-day axis of bare "06:00"s does not say which day
  const day = (ms) => { const d = local(ms); return `${WD[d.getUTCDay()]} ${d.getUTCDate()}`; };
  for (let x = first; x <= t1; x += step) out.push({ ms: x, label: step >= DAY || (span > DAY && hhmm(x) === '00:00') ? day(x) : hhmm(x), major: hhmm(x) === '00:00' });
  return out;
}

/** The two lines of one line row as SVG. opts: {buffer: 2|1, width, compact}. */
export function twoLines(row, { buffer = 2, width = 900, compact = false, waits = [] } = {}) {
  const tag = buffer === 2 ? 'x2' : 'x1';
  const asOf = row.as_of;
  setClock(asOf);
  const real = (row.readings || []).filter((r) => r.kind === 'real' && r.value !== null);
  const target = (row.readings || []).find((r) => r.kind === 'target');
  const est = (row.estimate && row.estimate[tag]) || row[`estimate_${tag}`] || [];
  const H = compact ? 132 : 236;
  const M = { l: 58, r: compact ? 12 : 16, t: 26, b: 26 };
  const W = Math.max(280, width);
  const pw = W - M.l - M.r, ph = H - M.t - M.b;

  const estEnd = est.length ? t(est[est.length - 1].date) : null;
  const t0 = t(row.set), t1 = Math.max(t(row.due), estEnd || 0, row.retro ? 0 : t(asOf));
  const vals = [...real.map((r) => r.value), ...(target ? [target.value] : []), ...est.flatMap((e) => [e.value, e.lo, e.hi]).filter((v) => typeof v === 'number')];
  let y0 = Math.min(...vals), y1 = Math.max(...vals);
  const pad = (y1 - y0) * 0.12 || Math.abs(y1) * 0.1 || 1;
  y0 -= pad; y1 += pad;
  if (Math.min(...vals) >= 0 && y0 < 0) y0 = 0;
  const X = (ms) => M.l + (pw * (ms - t0)) / (t1 - t0 || 1);
  const Y = (v) => M.t + ph - (ph * (v - y0)) / (y1 - y0 || 1);
  const f = (n) => n.toFixed(1);
  const parts = [];

  // grid: time ticks on the box's clock, three value ticks
  for (const k of timeTicks(t0, t1, pw)) {
    parts.push(`<line class="tl-grid${k.major ? ' tl-grid-major' : ''}" x1="${f(X(k.ms))}" x2="${f(X(k.ms))}" y1="${M.t}" y2="${M.t + ph}"/>`
      + `<text class="tl-tick${k.major ? ' tl-tick-major' : ''}" x="${f(X(k.ms))}" y="${H - 8}" text-anchor="middle">${esc(k.label)}</text>`);
  }
  for (const v of ticks(y0, y1, compact ? 2 : 4)) {
    if (v < y0 || v > y1) continue;
    parts.push(`<line class="tl-grid" x1="${M.l}" x2="${M.l + pw}" y1="${f(Y(v))}" y2="${f(Y(v))}"/>`
      + `<text class="tl-tick" x="${M.l - 6}" y="${f(Y(v) + 3.5)}" text-anchor="end">${esc(num(v))}</text>`);
  }
  parts.push(`<text class="tl-unit" x="${M.l - 6}" y="${M.t - 10}" text-anchor="end">${esc(row.unit || '')}</text>`);

  // the target: a rule at its value and the aim at the due date
  if (target) {
    parts.push(`<line class="tl-target" x1="${M.l}" x2="${M.l + pw}" y1="${f(Y(target.value))}" y2="${f(Y(target.value))}"/>`);
  }
  // the due date and now
  const label = (x, text, cls) => {
    const anchor = x > M.l + pw - 70 ? 'end' : x < M.l + 70 ? 'start' : 'middle';
    return `<text class="${cls}" x="${f(x)}" y="${M.t - 10}" text-anchor="${anchor}">${esc(text)}</text>`;
  };
  parts.push(`<line class="tl-due" x1="${f(X(t(row.due)))}" x2="${f(X(t(row.due)))}" y1="${M.t - 4}" y2="${M.t + ph}"/>`);
  parts.push(label(X(t(row.due)), `due ${clock(row.due, asOf)}`, 'tl-lbl tl-lbl-due'));
  const nowIn = t(asOf) >= t0 && t(asOf) <= t1;
  if (nowIn) {
    parts.push(`<line class="tl-now" x1="${f(X(t(asOf)))}" x2="${f(X(t(asOf)))}" y1="${M.t - 4}" y2="${M.t + ph}"/>`);
    // WHY a short word when it sits beside the due label: both are the top edge's only labels
    const nearDue = Math.abs(X(t(asOf)) - X(t(row.due))) < 90;
    const nearSet = X(t(asOf)) - M.l < 130;
    if (!nearDue && !nearSet) parts.push(label(X(t(asOf)), `now ${clock(asOf, asOf)}`, 'tl-lbl'));
    parts.push(label(M.l, nearSet && !nearDue ? `set ${clock(row.set, asOf)} · now ${clock(asOf, asOf)}` : `set ${clock(row.set, asOf)}`, 'tl-lbl tl-lbl-set'));
  } else {
    parts.push(label(M.l, `set ${clock(row.set, asOf)}`, 'tl-lbl tl-lbl-set'));
  }

  // desired: Zach's line, top-down (not for a target the candidate already meets: no path left to want)
  if (target && real.length && (!row.passes || row.retro)) {
    parts.push(`<path class="tl-desired" d="M${f(X(t(row.set)))},${f(Y(real[0].value))}L${f(X(t(target.date)))},${f(Y(target.value))}"/>`);
  }
  if (target) parts.push(`<circle class="tl-aim" cx="${f(X(t(target.date)))}" cy="${f(Y(target.value))}" r="4"/>`);

  // estimate: one step per idea; a step's hit area is its own time span, so hovering names the idea
  if (est.length) {
    let d = `M${f(X(t(est[0].date)))},${f(Y(est[0].value))}`;
    for (const e of est.slice(1)) d += `H${f(X(t(e.date)))}V${f(Y(e.value))}`;
    const steps = [];
    est.slice(1).forEach((e, k) => {
      const xa = X(t(e.start)), xb = X(t(e.date));
      const band = typeof e.lo === 'number' ? `<rect class="tl-band" x="${f(xb - 3)}" width="6" y="${f(Math.min(Y(e.lo), Y(e.hi)))}" height="${f(Math.abs(Y(e.lo) - Y(e.hi)))}"/>` : '';
      steps.push(`<g class="tl-step" data-idea="${esc(e.idea)}" tabindex="0" role="button" aria-label="${esc(`Step ${k + 1}: ${e.idea}, ${e.minutes} min × ${buffer} = ${e.buffered} min, ends ${clock(e.date, asOf)}, ${e.bet}. Opens it on the Ideas tab.`)}">`
        + `<rect class="tl-hit" x="${f(xa)}" width="${f(Math.max(6, xb - xa))}" y="${M.t}" height="${ph}"/>`
        + `${band}<circle class="tl-stepdot" cx="${f(xb)}" cy="${f(Y(e.value))}" r="3"/></g>`);
    });
    parts.push(`<path class="tl-est" d="${d}"/>`);
    const end = est[est.length - 1];
    if (t(end.date) < t(row.due)) {
      parts.push(`<path class="tl-est-after" d="M${f(X(t(end.date)))},${f(Y(end.value))}H${f(X(t(row.due)))}"/>`);
      // Zach's waits: named where the agent's work ends, never given a length
      if (waits.length && !compact) {
        const above = Y(end.value) - M.t > 20;
        parts.push(`<text class="tl-note tl-note-wait" x="${f(X(t(end.date)) + 8)}" y="${f(Y(end.value) + (above ? -8 : 16))}">then ${esc(waits.join(', '))} ${waits.length === 1 ? 'waits' : 'wait'} on you: not sized</text>`);
      }
    }
    parts.push(...steps);
    parts.push(`<path class="tl-est-end" d="M${f(X(t(end.date)))},${f(Y(end.value) - 5)}l5,5l-5,5l-5,-5z"><title>estimate ends ${esc(clock(end.date, asOf))} (×${buffer})</title></path>`);
    // the gap at the due date, when the estimate does not reach the target
    if (target && !OPS[row.op](end.value, target.value)) {
      const xd = X(t(row.due)) - 8;
      parts.push(`<path class="tl-gap${row.retro ? ' tl-calm' : ''}" d="M${f(xd)},${f(Y(end.value))}V${f(Y(target.value))}"/>`
        + `<text class="tl-note tl-note-gap${row.retro ? ' tl-calm' : ''}" x="${f(xd - 6)}" y="${f((Y(end.value) + Y(target.value)) / 2 + 4)}" text-anchor="end">${esc(`${row.retro ? 'the estimate at set: ' : ''}short ${Number(Math.abs(end.value - target.value).toPrecision(2))} ${row.unit || ''}${est.some((e) => typeof e.lo === 'number') ? '' : ': no idea bets on it'}`)}</text>`);
    }
  }
  // real: a step line (a best only moves when a solution is scored), then dotted to now while nothing new came
  if (real.length) {
    let d = `M${f(X(t(real[0].date)))},${f(Y(real[0].value))}`;
    for (const r of real.slice(1)) d += `H${f(X(t(r.date)))}V${f(Y(r.value))}`;
    parts.push(`<path class="tl-real" d="${d}"/>`);
    for (const r of real) parts.push(`<circle class="tl-dot" cx="${f(X(t(r.date)))}" cy="${f(Y(r.value))}" r="2.2"><title>${esc(`${r.solution || ''} ${num(r.value)} ${row.unit || ''} at ${clock(r.date, asOf)}`)}</title></circle>`);
    const last = real[real.length - 1];
    if (!row.retro && t(last.date) < t(asOf)) {
      parts.push(`<path class="tl-real-idle" d="M${f(X(t(last.date)))},${f(Y(last.value))}H${f(X(t(asOf)))}"/>`);
    }
    // the moment it was met (the first reading on target)
    if (row.retro && target) {
      const hit = real.find((r) => OPS[row.op](r.value, target.value));
      if (hit) {
        parts.push(`<circle class="tl-met" cx="${f(X(t(hit.date)))}" cy="${f(Y(hit.value))}" r="5.5"/>`
          + `<text class="tl-note tl-note-met" x="${f(X(t(hit.date)) + 9)}" y="${f(Y(hit.value) - 8)}">met ${esc(clock(hit.date, asOf))} · ${esc(hit.solution || '')}</text>`);
      }
    }
  }

  const aria = `${row.title}: real ${real.length} readings, latest ${num(real.length ? real[real.length - 1].value : null)}; target ${target ? num(target.value) : 'none'} by ${clock(row.due, asOf)}; estimate ${est.length ? `${est.length - 1} steps to ${clock(est[est.length - 1].date, asOf)}, ending at ${num(est[est.length - 1].value)}` : 'none'}`;
  return `<svg class="tl-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(aria)}">${parts.join('')}</svg>`;
}

/** A goal whose line cannot be drawn (no ruler yet): the estimate on time alone, its waits named at the end. */
export function timeOnly(goal, row, { buffer = 2, width = 900 } = {}) {
  const tag = buffer === 2 ? 'x2' : 'x1';
  const bu = goal.bottom_up[tag];
  const asOf = row.as_of;
  setClock(asOf);
  const H = 74, M = { l: 58, r: 16, t: 22, b: 22 };
  const W = Math.max(280, width), pw = W - M.l - M.r;
  const t0 = t(row.set), t1 = t(row.due);
  const X = (ms) => M.l + (pw * (ms - t0)) / (t1 - t0 || 1);
  const f = (n) => n.toFixed(1);
  const parts = [];
  for (const k of timeTicks(t0, t1, pw)) parts.push(`<line class="tl-grid" x1="${f(X(k.ms))}" x2="${f(X(k.ms))}" y1="${M.t}" y2="${H - M.b}"/><text class="tl-tick" x="${f(X(k.ms))}" y="${H - 6}" text-anchor="middle">${esc(k.label)}</text>`);
  parts.push(`<line class="tl-now" x1="${f(X(t(asOf)))}" x2="${f(X(t(asOf)))}" y1="${M.t - 4}" y2="${H - M.b}"/><text class="tl-lbl" x="${f(X(t(asOf)))}" y="${M.t - 8}" text-anchor="start">now ${esc(clock(asOf, asOf))}</text>`);
  parts.push(`<line class="tl-due" x1="${f(X(t1))}" x2="${f(X(t1))}" y1="${M.t - 4}" y2="${H - M.b}"/><text class="tl-lbl tl-lbl-due" x="${f(X(t1))}" y="${M.t - 8}" text-anchor="end">due ${esc(clock(row.due, asOf))}</text>`);
  const yb = M.t + 12;
  for (const s of bu.steps) {
    const xa = X(t(s.end) - s.buffered * 60000), xb = X(t(s.end));
    parts.push(`<g class="tl-step" data-idea="${esc(s.id)}" tabindex="0" role="button" aria-label="${esc(`${s.id}, ${s.minutes} min × ${buffer}, ends ${clock(s.end, asOf)}`)}"><rect class="tl-hit" x="${f(xa)}" width="${f(Math.max(8, xb - xa))}" y="${M.t}" height="${H - M.t - M.b}"/><path class="tl-est" d="M${f(xa)},${yb}H${f(Math.max(xa + 4, xb))}"/></g>`);
  }
  if (bu.waits.length) {
    const xe = X(t(bu.end));
    parts.push(`<path class="tl-est-after" d="M${f(xe)},${yb}H${f(X(t1))}"/><text class="tl-note" x="${f(xe + 8)}" y="${yb + 16}">then ${esc(bu.waits.map((w) => w.id).join(', '))} wait on you: not sized</text>`);
  }
  return `<svg class="tl-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(`${goal.id} estimate on time alone: agent work ends ${clock(bu.end, asOf)}; waits on Zach: ${bu.waits.map((w) => w.id).join(', ') || 'none'}`)}">${parts.join('')}</svg>`;
}

export { OP };
