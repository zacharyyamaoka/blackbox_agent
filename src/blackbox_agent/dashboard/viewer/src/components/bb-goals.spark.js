/* bb-goals.spark.js: the goal sparkline, a planned line, the actual line and the estimate in a few dozen pixels
   (viewer/CONTRACT.md §25). A pure port of proposals-goals-v2/_shared/goalspark.py, string for string
   (tests/goals-spark.test.mjs runs the Python live and compares every drawing the tab ships). No DOM: Node and browser.

   The named data-ui gap `display: goalline` (cell = {plan, real, carry_from, estimate, target, now}): data-ui's table
   `display: sparkline` draws one numeric series and no target; its kpi card's spark has a target but no planned line;
   its pace view has the planned line but one reading a day and no estimate (CONTRACT §20.4). Until data-ui grows it, the
   Goals tab hands data-ui each drawing as an SVG image cell (`display: image`), which data-ui draws stock in a table cell
   and in the side panel. Kept in this one file so the day data-ui grows `goalline` it is the one file to delete.

   Encoding (the shipped viewer's tokens, mid-tones so one SVG reads on the light and the dark page):
     planned   dashed grey      where it stood at set → the target at the due date (Grove's plan line)
     actual    solid orange     the candidate's readings (a step: a best only moves on a new score); dotted on to "now"
                                while nothing new was scored (not a reading)
     estimate  violet steps     the roadmap's ideas from now (bottom-up, ×2 or ×1); dotted on to the due date
     target    ring at the due date, a faint guide across
     now       dotted hairline;  met = a filled dot where it was met

   WHY the number helpers: the SVG text is compared with Python's, so a coordinate prints as Python prints it (round(x, 2)
   half even, a float always with a point: "3.0"; an int as an int). Each interpolation below says which it is. */

const DESIRED = '#8e8e98', ESTIMATE = '#8b5cf6', REAL = '#ee7d1f';
const PASS = '#22a35a', WARN = '#d9a03f', GUIDE = '#8e8e98';
const FONT = 'font-family:system-ui,-apple-system,Segoe UI,sans-serif';

/* ── Python's number forms ─────────────────────────────────────────────────────────────────────────────────────── */

/** repr(float(x)): the shortest round-trip digits, always with a point or an exponent ("3.0", "1e+16", "1.5e-05"). */
export function pyFloat(x) {
  if (Object.is(x, -0)) return '-0.0';
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'nan' : x > 0 ? 'inf' : '-inf';
  const [mant, e] = x.toExponential().split('e');
  const exp = Number(e);
  const neg = mant.startsWith('-');
  const digits = mant.replace('-', '').replace('.', '');
  let s;
  if (exp >= -4 && exp < 16) {
    if (exp >= 0) {
      const whole = digits.slice(0, exp + 1).padEnd(exp + 1, '0');
      s = `${whole}.${digits.slice(exp + 1) || '0'}`;
    } else s = `0.${'0'.repeat(-exp - 1)}${digits}`;
  } else {
    s = `${digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  return (neg ? '-' : '') + s;
}

/** Python's round(x, nd) for nd ≥ 1: correctly rounded, an exact tie to the even digit (toFixed rounds a tie up). */
export function pyRound(x, nd) {
  const long = x.toFixed(Math.min(100, nd + 40));
  const dot = long.indexOf('.');
  let r = Number(x.toFixed(nd));
  if (/^50*$/.test(long.slice(dot + 1 + nd))) {
    const trunc = long.slice(0, dot + 1 + nd);
    if (Number(trunc.at(-1)) % 2 === 0) r = Number(trunc);
  }
  // WHY: toFixed drops the sign of a negative that rounds to zero; Python keeps it (round(-0.001, 2) is -0.0)
  return r === 0 && (x < 0 || Object.is(x, -0)) ? -0 : r;
}

/** Python's round(x) to an int: half even (Math.round rounds a half up). */
export function pyRoundInt(x) {
  const f = Math.floor(x), d = x - f;
  return d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1);
}

/** float(f"{v:.{p}g}"): p significant figures, half even. */
export function sigFig(v, p) {
  if (v === 0) return v;
  const exp = Number(v.toExponential().split('e')[1]);
  const nd = p - 1 - exp;
  if (nd >= 1) return pyRound(v, nd);
  const k = 10 ** -nd;
  return pyRoundInt(v / k) * k;
}

const g3 = (v) => sigFig(v, 3);

const F = pyFloat;                                   // a Python float, printed
const I = (n) => String(n);                          // a Python int, printed
const maxNum = (a, b) => (b > a ? b : a);            // Python max(a, b): the first of two equal
const minNum = (a, b) => (b < a ? b : a);            // Python min(a, b): the first of two equal
/** max(int, float) printed: the int when it wins (or ties, being first), else the float. */
const maxIF = (n, x) => (x > n ? F(x) : I(n));

function fmt(v) {                                     // goalspark._fmt
  if (Number.isInteger(v)) return String(v);
  return F(g3(v));
}

const tsec = (s) => Date.parse(s) / 1000;            // datetime.fromisoformat(s).timestamp()
const latest = (list) => list.reduce((a, b) => (tsec(b) > tsec(a) ? b : a)); // max(list, key=_t), the first of equals

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

class Frame {
  constructor(x0, x1, y0, y1, w, h, pad = [3, 3, 3, 3]) {
    this.a = tsec(x0);
    this.b = tsec(x1);
    if (this.b <= this.a) this.b = this.a + 1;
    let lo = minNum(y0, y1), hi = maxNum(y0, y1);
    if (hi - lo < 1e-12) {
      const nhi = hi + (Math.abs(hi) || 1) * 0.05, nlo = lo - (Math.abs(lo) || 1) * 0.05;
      hi = nhi; lo = nlo;
    }
    const m = (hi - lo) * 0.08;
    this.lo = lo - m;
    this.hi = hi + m;
    this.w = w; this.h = h;
    [this.l, this.r, this.t, this.bt] = pad;
  }

  x(s) {
    const v = typeof s === 'string' ? tsec(s) : s;
    return pyRound(this.l + (v - this.a) / (this.b - this.a) * (this.w - this.l - this.r), 2);
  }

  y(v) {
    return pyRound(this.t + (this.hi - v) / (this.hi - this.lo) * (this.h - this.t - this.bt), 2);
  }
}

const svgOf = (w, h, body, title) => `<svg xmlns="http://www.w3.org/2000/svg" width="${I(w)}" height="${I(h)}" viewBox="0 0 ${I(w)} ${I(h)}" `
  + `role="img"><title>${esc(title)}</title>${body}</svg>`;

/** A step-after path through (t, v) points. */
function step(points, f) {
  return points.map(([t, v], i) => (i === 0 ? `M${F(f.x(t))},${F(f.y(v))}` : `H${F(f.x(t))}V${F(f.y(v))}`)).join(' ');
}

function nowLine(f, now, labels) {
  const x = f.x(now);
  let out = `<line x1="${F(x)}" y1="${I(f.t - 1)}" x2="${F(x)}" y2="${I(f.h - f.bt + 1)}" stroke="${GUIDE}" stroke-width="1" stroke-dasharray="1.5 2" opacity=".8"/>`;
  if (labels) out += `<text x="${F(x + 3)}" y="${I(f.t + 8)}" font-size="9.5" fill="${GUIDE}" style="${FONT}">now</text>`;
  return out;
}

const OPS = { '<=': '≤', '>=': '≥', '<': '<', '>': '>' };

/** One measurable criterion (a line of the slice, through trackLine()): planned vs actual vs estimate. */
export function lineSvg(t, now, b = 'x2', w = 168, h = 40, { labels = false } = {}) {
  const pad = labels ? [4, 8, 12, 12] : [3, 6, 4, 4];
  if (t.kind !== 'line') return unknownSvg(t.says, w, h, labels);
  const est = t.estimate[b] || [];
  const vals = [...t.real.map(([, v]) => v), t.target, ...est.map((p) => p[1]), ...(t.plan ? [t.plan[0][1]] : [])];
  const x1 = latest([t.window[1], t.due]);
  const f = new Frame(t.window[0], x1, vals.reduce(minNum), vals.reduce(maxNum), w, h, pad);
  const body = [];
  const ty = f.y(t.target);
  const betterLow = t.op === '<=' || t.op === '<';
  // the pass side of the target, faint: where the line has to get to
  if (betterLow) body.push(`<rect x="${I(f.l)}" y="${F(ty)}" width="${I(f.w - f.l - f.r)}" height="${maxIF(0, f.h - f.bt - ty)}" fill="${PASS}" opacity=".08"/>`);
  else body.push(`<rect x="${I(f.l)}" y="${I(f.t)}" width="${I(f.w - f.l - f.r)}" height="${maxIF(0, ty - f.t)}" fill="${PASS}" opacity=".08"/>`);
  body.push(`<line x1="${I(f.l)}" y1="${F(ty)}" x2="${I(f.w - f.r)}" y2="${F(ty)}" stroke="${GUIDE}" stroke-width="1" stroke-dasharray="1 3" opacity=".7"/>`);
  if (t.plan) {
    const [[a, va], [z, vz]] = t.plan;
    body.push(`<line x1="${F(f.x(a))}" y1="${F(f.y(va))}" x2="${F(f.x(z))}" y2="${F(f.y(vz))}" stroke="${DESIRED}" stroke-width="1.4" stroke-dasharray="4 3"/>`);
  }
  if (est.length) {
    const pts = est.map((p) => [p[0], p[1]]);
    body.push(`<path d="${step(pts, f)}" fill="none" stroke="${ESTIMATE}" stroke-width="1.8" stroke-linejoin="round"/>`);
    const last = pts.at(-1);
    if (tsec(last[0]) < tsec(t.due)) {
      body.push(`<line x1="${F(f.x(last[0]))}" y1="${F(f.y(last[1]))}" x2="${F(f.x(t.due))}" y2="${F(f.y(last[1]))}" stroke="${ESTIMATE}" stroke-width="1.2" stroke-dasharray="1.5 2.5" opacity=".85"/>`);
    }
    for (const p of est.slice(1)) body.push(`<circle cx="${F(f.x(p[0]))}" cy="${F(f.y(p[1]))}" r="1.6" fill="${ESTIMATE}"/>`);
  }
  if (t.real.length) {
    body.push(`<path d="${step(t.real, f)}" fill="none" stroke="${REAL}" stroke-width="1.9" stroke-linejoin="round"/>`);
    const lastReal = t.real.at(-1);
    if (t.carry_from) {
      const v = lastReal[1];
      body.push(`<line x1="${F(f.x(lastReal[0]))}" y1="${F(f.y(v))}" x2="${F(f.x(now))}" y2="${F(f.y(v))}" stroke="${REAL}" stroke-width="1.6" stroke-dasharray="1.5 2.2"/>`);
    }
    if (t.met_at) {
      const hit = t.real.find(([tt]) => tsec(tt) >= tsec(t.met_at));
      const mv = hit ? hit[1] : lastReal[1];
      body.push(`<circle cx="${F(f.x(t.met_at))}" cy="${F(f.y(mv))}" r="2.8" fill="${REAL}"/>`);
    } else {
      const x = t.carry_from ? f.x(now) : f.x(lastReal[0]);
      body.push(`<circle cx="${F(x)}" cy="${F(f.y(lastReal[1]))}" r="2.3" fill="${REAL}"/>`);
    }
  }
  body.push(`<circle cx="${F(f.x(t.due))}" cy="${F(ty)}" r="3" fill="none" stroke="${GUIDE}" stroke-width="1.4"/>`);
  if (!t.met_at) body.push(nowLine(f, now, labels));
  if (labels) {
    const op = OPS[t.op] ?? '';
    body.push(`<text x="${I(f.w - 2)}" y="${F(betterLow ? ty - 4 : ty + 11)}" font-size="9.5" text-anchor="end" fill="${GUIDE}" style="${FONT}">${op} ${fmt(t.target)}</text>`);
    if (t.real.length) {
      const v0 = t.real[0][1];
      const y0 = f.y(v0);
      body.push(`<text x="${I(f.l)}" y="${F(y0 > 14 ? y0 - 4 : y0 + 11)}" font-size="9.5" fill="${REAL}" style="${FONT}">${fmt(v0)}</text>`);
    }
  }
  return svgOf(w, h, body.join(''), t.says);
}

/** A pass / fail criterion (a strip of the slice): green where it passed, amber where it did not, hatched where the
    fold has no history (a spec is known only as it stands now); a violet diamond where an idea bets it to pass. */
export function stripSvg(s, now, b = 'x2', w = 168, h = 14) {
  if (!s.segments?.length) return unknownSvg(s.says, w, h, false);
  const met = String(s.status ?? '').startsWith('met')
    || (s.segments.every((g) => tsec(g.to) <= tsec(s.due)) && tsec(now) > tsec(s.due));
  const f = new Frame(s.set, met ? s.due : latest([s.due, now]), 0, 1, w, h, [3, 6, 2, 2]);
  const body = [`<defs><pattern id="h" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`
    + `<rect width="4" height="4" fill="${GUIDE}" opacity=".10"/><line x1="0" y1="0" x2="0" y2="4" stroke="${GUIDE}" stroke-width="1.4" opacity=".45"/></pattern></defs>`];
  const y = f.t, bh = h - f.t - f.bt;
  for (const seg of s.segments) {
    const x0 = f.x(seg.from), x1 = f.x(seg.to);
    if (seg.measured) {
      body.push(`<rect x="${F(x0)}" y="${I(y)}" width="${maxIF(1, x1 - x0)}" height="${I(bh)}" rx="2" fill="${seg.pass ? PASS : WARN}" opacity=".85"/>`);
    } else {
      body.push(`<rect x="${F(x0)}" y="${I(y)}" width="${maxIF(1, x1 - x0)}" height="${I(bh)}" rx="2" fill="url(#h)"/>`);
      body.push(`<circle cx="${F(x1)}" cy="${F(y + bh / 2)}" r="${F(bh / 2 - 0.5)}" fill="${seg.pass ? PASS : WARN}"/>`);
    }
  }
  const bet = (s.bets || {})[b];
  if (bet) {
    const bx = f.x(bet.at);
    const d = F(bh / 2 + 0.5);
    body.push(`<line x1="${F(f.x(now))}" y1="${F(y + bh / 2)}" x2="${F(bx)}" y2="${F(y + bh / 2)}" stroke="${ESTIMATE}" stroke-width="1.4" stroke-dasharray="1.5 2"/>`);
    body.push(`<path d="M${F(bx)},${F(y - 0.5)} l${d},${d} l-${d},${d} l-${d},-${d}z" fill="${ESTIMATE}"/>`);
  }
  body.push(`<line x1="${F(f.x(s.due))}" y1="0" x2="${F(f.x(s.due))}" y2="${I(h)}" stroke="${GUIDE}" stroke-width="1.2"/>`);
  if (!met) body.push(nowLine(f, now, false));
  return svgOf(w, h, body.join(''), s.says);
}

/** The goal as one line (the slice's check): '% of the way' (mode pct) or boxes ticked (mode ticks), planned from where
    it stood at set to all of it by the due date. */
export function burnupSvg(check, goal, now, b = 'x2', w = 168, h = 40, { mode = 'pct', labels = false } = {}) {
  if (!check.judged) return unknownSvg(check.says, w, h, labels);
  let real = mode === 'pct' ? check.pct : check.ticks;
  const plan = mode === 'pct' ? check.plan_pct : check.plan_ticks;
  const est = (mode === 'pct' ? check.est_pct : check.est_ticks)[b] || [];
  const top = mode === 'pct' ? 100 : check.judged;
  const ends = [goal.due, ...est.map((p) => p[0]), ...(goal.met_at ? [goal.met_at] : [])];
  const pad = labels ? [4, 8, 12, 12] : [3, 6, 4, 4];
  const f = new Frame(goal.set, latest(ends), 0, top, w, h, pad);
  const body = [`<line x1="${I(f.l)}" y1="${F(f.y(top))}" x2="${I(f.w - f.r)}" y2="${F(f.y(top))}" stroke="${GUIDE}" stroke-width="1" stroke-dasharray="1 3" opacity=".7"/>`];
  const [[a, va], [z, vz]] = plan;
  body.push(`<line x1="${F(f.x(a))}" y1="${F(f.y(va))}" x2="${F(f.x(z))}" y2="${F(f.y(vz))}" stroke="${DESIRED}" stroke-width="1.4" stroke-dasharray="4 3"/>`);
  if (est.length) {
    const pts = est.map((p) => [p[0], p[1]]);
    body.push(`<path d="${step(pts, f)}" fill="none" stroke="${ESTIMATE}" stroke-width="1.8"/>`);
    const last = pts.at(-1);
    if (tsec(last[0]) < tsec(goal.due)) {
      body.push(`<line x1="${F(f.x(last[0]))}" y1="${F(f.y(last[1]))}" x2="${F(f.x(goal.due))}" y2="${F(f.y(last[1]))}" stroke="${ESTIMATE}" stroke-width="1.2" stroke-dasharray="1.5 2.5" opacity=".85"/>`);
    }
    for (const p of est.slice(1)) body.push(`<circle cx="${F(f.x(p[0]))}" cy="${F(f.y(p[1]))}" r="1.6" fill="${ESTIMATE}"/>`);
  }
  const open = !String(goal.status).startsWith('met');
  // WHY: the checklist ends an open goal's series with its state AT now; that point is a carry, not a reading (G2 scored
  // nothing since set), so it draws dotted like every per-box line (07 found it, 2026-11-25)
  if (open && real.length >= 2 && tsec(real.at(-1)[0]) >= tsec(now) && real.at(-1)[1] === real.at(-2)[1]) real = real.slice(0, -1);
  body.push(`<path d="${step(real, f)}" fill="none" stroke="${REAL}" stroke-width="1.9"/>`);
  const lastReal = real.at(-1);
  if (open && tsec(lastReal[0]) < tsec(now)) {
    body.push(`<line x1="${F(f.x(lastReal[0]))}" y1="${F(f.y(lastReal[1]))}" x2="${F(f.x(now))}" y2="${F(f.y(lastReal[1]))}" stroke="${REAL}" stroke-width="1.6" stroke-dasharray="1.5 2.2"/>`);
  }
  const endX = goal.met_at ? f.x(goal.met_at) : f.x(now);
  body.push(`<circle cx="${F(endX)}" cy="${F(f.y(lastReal[1]))}" r="${goal.met_at ? '2.8' : '2.3'}" fill="${REAL}"/>`);
  body.push(`<circle cx="${F(f.x(goal.due))}" cy="${F(f.y(top))}" r="3" fill="none" stroke="${GUIDE}" stroke-width="1.4"/>`);
  if (open) body.push(nowLine(f, now, labels));
  if (labels) {
    const unit = mode === 'pct' ? ' %' : ` of ${top}`;
    body.push(`<text x="${I(f.w - 2)}" y="${F(f.y(top) - 4)}" font-size="9.5" text-anchor="end" fill="${GUIDE}" style="${FONT}">${I(top)}${unit}</text>`);
    body.push(`<text x="${I(f.l)}" y="${F(f.y(real[0][1]) - 4)}" font-size="9.5" fill="${REAL}" style="${FONT}">${fmt(real[0][1])}${mode === 'pct' ? ' %' : ''}</text>`);
  }
  return svgOf(w, h, body.join(''), check.says);
}

/** Nothing to draw yet: a hatched well, never a line drawn as if measured. */
export function unknownSvg(says, w, h, labels) {
  const half = h / 2 - 2;
  const m = 7 <= half ? I(7) : F(half);                 // min(7, h / 2 - 2): the int when it wins or ties
  const mv = 7 <= half ? 7 : half;
  let body = `<defs><pattern id="u" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`
    + `<line x1="0" y1="0" x2="0" y2="5" stroke="${GUIDE}" stroke-width="1.2" opacity=".35"/></pattern></defs>`
    + `<rect x="3" y="${F(h / 2 - mv)}" width="${I(w - 9)}" height="${7 <= half ? I(2 * 7) : F(2 * mv)}" rx="3" fill="url(#u)"/>`;
  void m;
  if (labels) body += `<text x="${F(w / 2)}" y="${F(h / 2 + 3.5)}" font-size="10" text-anchor="middle" fill="${GUIDE}" style="${FONT}">can't judge yet</text>`;
  return svgOf(w, h, body, says);
}

/* urllib.parse.quote(svg, safe="/:=,.-()';"): the always-safe ASCII letters, digits and _.-~ plus those */
const SAFE = new Set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-/~:=,()\';'); // WHY '/' before '~': the publish leak scan reads '~' + '/' as a home path
const ENC = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

/** An SVG as a data: URL for a data-ui `display: image` cell or a card's `image` property. */
export function dataUri(svg) {
  let out = '';
  for (const byte of ENC.encode(svg)) {
    const c = String.fromCharCode(byte);
    out += byte < 128 && SAFE.has(c) ? c : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return `data:image/svg+xml;utf8,${out}`;
}

/** The slice's line (tools/folds/_goals_track.py) in the shape the drawings read: the slice keeps 02's estimate readings
    ({date, value, kind, idea}); a drawing reads them as [date, value, idea], and none on a goal already met. */
export function trackLine(line, goal) {
  const open = !String(goal.status).startsWith('met');
  const est = {};
  for (const b of ['x2', 'x1']) {
    est[b] = line.refusal || !open ? [] : (line.estimate?.[b] || []).map((p) => [p.date, p.value, ...(p.idea ? [p.idea] : [])]);
  }
  return { ...line, estimate: est };
}
