/* bb-goals.card.js: Goals round 3's drawings (viewer/CONTRACT.md §27). Pure: Node and browser, no DOM.

   Zach, 2026-11-25: "once we have that deadline set we want to see our PLANNED progress line, and then also the LINEAR
   line to see if we are progressing, and then obviously the ACTUAL line. To make the progress line, to avoid agents
   gaming it, the only way is to submit ideas that have target dates of completion and estimated improvements on the KPIs,
   so the planned line is autocomputed from the idea queue."

   Three named lines, wherever a target is drawn (a goal's card, Tracking, the panel and the full page):
     linear   dashed grey      where it stood when set → the target at the due date, straight (round 2's "planned",
                               Grove's line, renamed)
     planned  violet steps     from the ideas as committed: each idea's `- By:` and `- Expect:` (a filled dot); an idea
                               with no By lands at its Effort × buffer bottom-up time (a hollow dot: estimated)
     at set   faint violet     the plan as ideas.md stood when the goal was set (a moved goalpost shows)
     actual   solid orange     the readings; dotted on to "now" while nothing new was scored
     target   a ring at the due date, a faint guide across
   WHY a module of its own and not bb-goals.spark.js: that file is a port of goalspark.py held string for string; these
   drawings are round 3's and have no Python twin. The day data-ui grows `display: goalline` both go. */

export const COLORS = { linear: '#8e8e98', planned: '#8b5cf6', actual: '#ee7d1f', guide: '#8e8e98', pass: '#22a35a', warn: '#d9a03f', bad: '#dc4b4b' };
const FONT = 'font-family:system-ui,-apple-system,Segoe UI,sans-serif';
const ms = (s) => Date.parse(s);
const r2 = (x) => Math.round(x * 100) / 100;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const OPS = { '<=': (a, b) => a <= b, '<': (a, b) => a < b, '>=': (a, b) => a >= b, '>': (a, b) => a > b };
const SYM = { '<=': '≤', '<': '<', '>=': '≥', '>': '>' };
export const metish = (g) => String(g.status).startsWith('met');

/** A number for a card: up to 3 significant figures, never exponent for the sizes a box measures. */
export function short(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (Number.isInteger(v)) return String(v);
  const a = Math.abs(v);
  return a >= 100 ? String(Math.round(v)) : String(Number(v.toPrecision(3)));
}

/** One target in the drawings' shape, from a slice line (tools/folds/goals.py lines[], _goals_track.py's keys). */
export function targetSeries(line, goal, b, now) {
  const open = !metish(goal);
  const planned = (line.planned?.[b] || []).map((p) => ({ t: p.date, v: p.value, idea: p.idea || null, by: p.by ?? null }));
  const atSet = (line.planned_set || []).map((p) => ({ t: p.date, v: p.value, idea: p.idea || null, by: p.by ?? null }));
  return {
    kind: line.kind === 'line' ? 'line' : 'unknown', label: line.label, unit: line.unit || '', op: line.op, target: line.target,
    set: goal.set, due: goal.due, now, open, met_at: goal.met_at || null, says: line.says,
    linear: line.plan || null, planned, atSet, real: line.real || [], carry_from: line.carry_from || null, current: line.current ?? null,
  };
}

/** The goal as one line: '% of the way' (mode pct) or boxes ticked (mode ticks), the three lines. */
export function checkSeries(goal, b, now, mode = 'pct') {
  const ch = goal.check, pc = goal.planned_check || {};
  const top = mode === 'pct' ? 100 : ch.judged;
  const real = (mode === 'pct' ? ch.pct : ch.ticks) || [];
  const planned = ((mode === 'pct' ? pc.planned_pct : pc.planned_ticks)?.[b] || []).map((p) => ({ t: p[0], v: p[1], idea: p[2] || null, by: p[3] ?? null }));
  return {
    kind: ch.judged ? 'line' : 'unknown', label: mode === 'pct' ? '% of the way' : `boxes ticked, of ${top}`, unit: mode === 'pct' ? '%' : '',
    op: '>=', target: top, set: goal.set, due: goal.due, now, open: !metish(goal), met_at: goal.met_at || null, says: ch.says,
    linear: mode === 'pct' ? ch.plan_pct : ch.plan_ticks, planned, atSet: [],
    real: real.map((p) => [p[0], p[1]]), carry_from: null, current: real.length ? real.at(-1)[1] : null,
  };
}

/** The body of one three-line chart in a w × h box at (x, y): [svg markup, title]. */
function chartBody(s, x, y, w, h, { labels = false, ring = true } = {}) {
  const pad = labels ? { l: 4, r: 10, t: 12, b: 12 } : { l: 3, r: 7, t: 4, b: 4 };
  const parts = [];
  if (s.kind !== 'line') {
    parts.push(`<rect x="${x + 3}" y="${r2(y + h / 2 - 7)}" width="${w - 9}" height="14" rx="3" fill="${COLORS.guide}" opacity=".12"/>`);
    parts.push(`<text x="${r2(x + w / 2)}" y="${r2(y + h / 2 + 3.5)}" font-size="10" text-anchor="middle" fill="${COLORS.guide}" style="${FONT}">can't judge yet</text>`);
    return parts.join('');
  }
  const times = [s.set, s.due, s.now, ...(s.met_at ? [s.met_at] : []), ...s.planned.map((p) => p.t), ...s.atSet.map((p) => p.t), ...s.real.map((p) => p[0])];
  let a = Math.min(...times.map(ms)), z = Math.max(...times.map(ms));
  if (z <= a) z = a + 60000;
  a = Math.max(a, ms(s.set) - (z - ms(s.set)) * 0.1);
  const vals = [s.target, ...s.planned.map((p) => p.v), ...s.atSet.map((p) => p.v), ...s.real.map((p) => p[1]), ...(s.linear ? s.linear.map((p) => p[1]) : [])].filter(Number.isFinite);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1e-12) { hi += (Math.abs(hi) || 1) * 0.05; lo -= (Math.abs(lo) || 1) * 0.05; }
  const m = (hi - lo) * 0.1;
  lo -= m; hi += m;
  const X = (t) => r2(x + pad.l + (Math.min(z, Math.max(a, ms(t))) - a) / (z - a) * (w - pad.l - pad.r));
  const Y = (v) => r2(y + pad.t + (hi - v) / (hi - lo) * (h - pad.t - pad.b));
  const stepPath = (pts) => pts.map((p, i) => (i ? `H${X(p[0])}V${Y(p[1])}` : `M${X(p[0])},${Y(p[1])}`)).join(' ');
  const ty = Y(s.target);
  const low = s.op === '<=' || s.op === '<';
  // the pass side of the target, faint
  parts.push(low ? `<rect x="${x + pad.l}" y="${ty}" width="${w - pad.l - pad.r}" height="${Math.max(0, r2(y + h - pad.b - ty))}" fill="${COLORS.pass}" opacity=".08"/>`
    : `<rect x="${x + pad.l}" y="${y + pad.t}" width="${w - pad.l - pad.r}" height="${Math.max(0, r2(ty - y - pad.t))}" fill="${COLORS.pass}" opacity=".08"/>`);
  parts.push(`<line x1="${x + pad.l}" y1="${ty}" x2="${x + w - pad.r}" y2="${ty}" stroke="${COLORS.guide}" stroke-width="1" stroke-dasharray="1 3" opacity=".7"/>`);
  if (s.linear) {
    const [[t0, v0], [t1, v1]] = s.linear;
    parts.push(`<line data-series="linear" x1="${X(t0)}" y1="${Y(v0)}" x2="${X(t1)}" y2="${Y(v1)}" stroke="${COLORS.linear}" stroke-width="1.4" stroke-dasharray="4 3"/>`);
  }
  if (s.atSet.length > 1) {
    parts.push(`<path data-series="planned-at-set" d="${stepPath(s.atSet.map((p) => [p.t, p.v]))}" fill="none" stroke="${COLORS.planned}" stroke-width="1.2" stroke-dasharray="2 2" opacity=".35"/>`);
  }
  if (s.planned.length) {
    const pts = s.planned.map((p) => [p.t, p.v]);
    parts.push(`<path data-series="planned" d="${stepPath(pts)}" fill="none" stroke="${COLORS.planned}" stroke-width="1.8" stroke-linejoin="round"/>`);
    const last = pts.at(-1);
    if (ms(last[0]) < ms(s.due)) parts.push(`<line x1="${X(last[0])}" y1="${Y(last[1])}" x2="${X(s.due)}" y2="${Y(last[1])}" stroke="${COLORS.planned}" stroke-width="1.2" stroke-dasharray="1.5 2.5" opacity=".8"/>`);
    for (const p of s.planned.filter((q) => q.idea)) {
      parts.push(p.by ? `<circle data-step="by" cx="${X(p.t)}" cy="${Y(p.v)}" r="2.2" fill="${COLORS.planned}"><title>${esc(p.idea)} by its - By:</title></circle>`
        : `<circle data-step="estimated" cx="${X(p.t)}" cy="${Y(p.v)}" r="2.3" fill="none" stroke="${COLORS.planned}" stroke-width="1.2"><title>${esc(p.idea)}: estimated (no - By:)</title></circle>`);
    }
  }
  if (s.real.length) {
    parts.push(`<path data-series="actual" d="${stepPath(s.real)}" fill="none" stroke="${COLORS.actual}" stroke-width="1.9" stroke-linejoin="round"/>`);
    const last = s.real.at(-1);
    if (s.open && ms(last[0]) < ms(s.now)) parts.push(`<line x1="${X(last[0])}" y1="${Y(last[1])}" x2="${X(s.now)}" y2="${Y(last[1])}" stroke="${COLORS.actual}" stroke-width="1.6" stroke-dasharray="1.5 2.2"/>`);
    const end = s.met_at ? X(s.met_at) : s.open ? X(s.now) : X(last[0]);
    parts.push(`<circle cx="${end}" cy="${Y(last[1])}" r="${s.met_at ? 2.8 : 2.3}" fill="${COLORS.actual}"/>`);
  }
  if (ring) parts.push(`<circle data-series="target" cx="${X(s.due)}" cy="${ty}" r="3" fill="none" stroke="${COLORS.guide}" stroke-width="1.4"/>`);
  if (s.open) parts.push(`<line x1="${X(s.now)}" y1="${y + pad.t - 1}" x2="${X(s.now)}" y2="${y + h - pad.b + 1}" stroke="${COLORS.guide}" stroke-width="1" stroke-dasharray="1.5 2" opacity=".8"/>`);
  if (labels) parts.push(`<text x="${x + w - 2}" y="${low ? r2(ty - 4) : r2(ty + 11)}" font-size="9.5" text-anchor="end" fill="${COLORS.guide}" style="${FONT}">${esc(SYM[s.op] || '')} ${short(s.target)}${s.unit && s.unit !== '%' ? '' : s.unit === '%' ? ' %' : ''}</text>`);
  return parts.join('');
}

const svg = (w, h, body, title) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img"><title>${esc(title)}</title>${body}</svg>`;

/** One three-line chart as an SVG string. */
export function threeSvg(s, w = 232, h = 58, opts = {}) {
  return svg(w, h, chartBody(s, 0, 0, w, h, opts), s.says || s.label);
}

const ROW = 64, TICKS = 24, W = 340;

/** How tall a goal's card drawing is (its targets, then one row of pass / fail ticks). */
export function cardHeight(goal) {
  return Math.max(1, goal.lines.length) * ROW + (goal.strips.length ? TICKS : 0) + 6;
}

/** A goal's card (round 3: one card per goal, Zach: "a visual overview where I can see like a KPI tracker and the status
    of the gates"): per target its name, its value now against the target in its own unit, a bar of how far it has come,
    and a three-line mini chart; under them each pass / fail box as a tick. Drawn at `height` (the tallest card's) so
    every card in the grid is the same size. */
export function goalCardSvg(goal, b, now, height = cardHeight(goal)) {
  const parts = [];
  let y = 2;
  if (!goal.lines.length) {
    parts.push(`<text x="4" y="${y + 18}" font-size="11.5" fill="${COLORS.guide}" style="${FONT}">no number to track: its boxes below</text>`);
    y += ROW;
  }
  for (const line of goal.lines) {
    const s = targetSeries(line, goal, b, now);
    const name = String(line.ref || line.label).replace(/_/g, ' ');
    const passes = s.kind === 'line' && s.current !== null && OPS[s.op]?.(s.current, s.target);
    const tone = s.kind !== 'line' ? COLORS.guide : passes ? COLORS.pass : COLORS.warn;
    const u = s.unit ? ` ${s.unit}` : '';
    parts.push(`<text x="4" y="${y + 12}" font-size="11.5" font-weight="600" fill="#7d7d88" style="${FONT}">${esc(name.length > 50 ? `${name.slice(0, 49)}…` : name)}<title>${esc(line.label)}</title></text>`);
    const now_ = s.kind === 'line' ? `${short(s.current)}${u}` : "can't judge yet";
    parts.push(`<text x="4" y="${y + 32}" font-size="12.5" font-weight="700" fill="${tone}" style="${FONT}">${esc(now_)}</text>`);
    parts.push(`<text x="4" y="${y + 46}" font-size="10.5" fill="${COLORS.guide}" style="${FONT}">target ${esc(SYM[s.op] || '')} ${esc(short(s.target))}${esc(u)}</text>`);
    // the bar: the share of the gap from where it stood at set to the target, closed (a pass is full)
    let share = 0;
    if (s.kind === 'line') {
      const v0 = s.real.length ? s.real[0][1] : s.current;
      share = passes ? 1 : v0 !== null && v0 !== s.target && s.current !== null ? Math.max(0, Math.min(1, (v0 - s.current) / (v0 - s.target))) : 0;
    }
    parts.push(`<rect x="4" y="${y + 52}" width="120" height="4" rx="2" fill="${COLORS.guide}" opacity=".18"/>`);
    parts.push(`<rect data-bar="${r2(share)}" x="4" y="${y + 52}" width="${r2(120 * share)}" height="4" rx="2" fill="${tone}"/>`);
    // WHY under the name, right of the numbers: the name spans the card (a long id overlapped the chart)
    parts.push(chartBody(s, 132, y + 17, W - 134, ROW - 21, { ring: true }));
    y += ROW;
  }
  if (goal.strips.length) {
    let x = 4;
    for (const st of goal.strips) {
      const ok = st.word === 'passes', unk = st.word === "can't judge yet";
      const glyph = unk ? '–' : ok ? '✓' : '✗';
      const label = `${glyph} ${st.key === 'gates' ? 'all gates' : st.key}`;
      const wd = 14 + label.length * 6.4;
      if (x + wd > W) break;
      parts.push(`<g data-tick="${esc(st.key)}" data-pass="${ok}"><rect x="${x}" y="${y + 3}" width="${r2(wd)}" height="18" rx="9" fill="${unk ? COLORS.guide : ok ? COLORS.pass : COLORS.warn}" opacity=".16"/>`
        + `<text x="${r2(x + 7)}" y="${y + 16}" font-size="11" fill="${unk ? COLORS.guide : ok ? COLORS.pass : COLORS.warn}" style="${FONT}">${esc(label)}</text><title>${esc(st.says)}</title></g>`);
      x += wd + 6;
    }
  }
  return svg(W, height, parts.join(''), `${goal.id} · ${goal.title}`);
}
export const CARD_W = W;
