/* bb-goals.rows.js: the Goals tab's ONE stock data-ui dataset and .base, built in the page from the goals slice
   (viewer/CONTRACT.md §25). Pure: Node and browser.

   PICKS.md "Goals round 2 (2026-11-25)", Zach's ruling: "the base to be just like the other things basically just a stock
   data-ui table … some nice presets to have: 1 is like a row view, 1 is a card view, 1 can be like the timeline view
   similar to what you have in v5, and then one … showing the spark line progress towards the goals and gates". The
   default taken is the splice, proposals-goals-v2/09-splice/: Rows (07's table), Cards (08's stock kpi cards, one per
   target, in real units), Timeline (V5's plan), Tracking (07's goal rows with the burn-up image cell), and one side panel
   (07's, with 08's stock Vega-Lite charts in each target's real units). This file is 09's build.py and the parts of
   07-burn-up/build.py and 08-small-multiples/build.py it joins, in JS over the slice (tools/folds/_goals_track.py carries
   track.py's numbers and words there): spliceDataset() / spliceBaseText() equal 09's goals.rows.json, goals.rows.x1.json
   and goals.base row for row and byte for byte (tests/goals-rows.test.mjs). goalsDataset() / goalsBaseText() are the
   viewer's: the same, plus round 1's features as sections of the panel (what it takes, with "no idea aims at this"; the
   odds, its levers and the moves; the goal hit rate), and no data file of its own.

   ONE dataset, a `kind` column, a `filters:` per view, so the ×2 buffer switch (two datasets) moves every preset and the
   side panel at once:
     goal       07's goal rows (Rows, Tracking, the panel's fields)
     criterion  07's criterion rows (the panel's per-box strips for gates and specs; "how the % counts")
     step       07's roadmap rows, in plan order
     reading    08's long-format readings (Cards' kpi cards, the panel's small multiples in real units)
     plan       V5's timeline rows, for `type: plan` (bb-goals.plan.js)
     odds       (the viewer's) one per goal: 03's Monte Carlo inputs and 02's value moves, for the panel's odds section */
import { burnupSvg, stripSvg, unknownSvg, dataUri, trackLine, pyFloat, pyRound, pyRoundInt, sigFig } from './bb-goals.spark.js';
import { valueMoves } from './bb-goals.model.js';
import { goalCardSvg, cardHeight, threeSvg, targetSeries, checkSeries, CARD_W, COLORS } from './bb-goals.card.js';

/* ── track.py's words, in JS (the row builders' helpers) ───────────────────────────────────────────────────────── */

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const OPS = { '<=': (a, b) => a <= b, '<': (a, b) => a < b, '>=': (a, b) => a >= b, '>': (a, b) => a > b };
const ms = (s) => Date.parse(s);

/** An ISO date-time's own wall clock (the box's offset), as datetime.fromisoformat keeps it. */
function wall(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  return { y, mo, d, hm: `${m[4]}:${m[5]}`, wd: (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7 };
}

/** track.Clock: '05:00' today, 'Fri 17:00' within six days, else 'Sat Dec 12 17:00'. */
export class Clock {
  constructor(asOf) { this.asOf = asOf; this.now = wall(asOf); this.t = ms(asOf); }

  when(s) {
    if (!s) return '—';
    const d = wall(s), n = this.now;
    if (d.y === n.y && d.mo === n.mo && d.d === n.d) return d.hm;
    if (Math.abs(ms(s) - this.t) / 1000 < 6 * 86400) return `${DAYS[d.wd]} ${d.hm}`;
    return `${DAYS[d.wd]} ${MONTHS[d.mo - 1]} ${d.d} ${d.hm}`;
  }
}

export function span(minutes) {
  const m = pyRoundInt(Math.abs(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h >= 48) {
    const d = Math.floor(h / 24), hh = h % 24;
    return hh ? `${d} d ${hh} h` : `${d} d`;
  }
  return r && h < 10 ? `${h} h ${r} min` : `${h} h`;
}

export function num(v) {
  if (v === null || v === undefined) return '—';
  if (Number.isInteger(v)) return String(v);
  return pyFloat(sigFig(v, Math.abs(v) < 1 ? 4 : 3));
}

export function dnum(v) {
  if (v === null || v === undefined) return '—';
  return pyFloat(sigFig(Math.abs(v), 2));
}

const frac = (a, b, t) => { const total = (ms(b) - ms(a)) / 1000; return total <= 0 ? 0 : (ms(t) - ms(a)) / 1000 / total; };
/** Python's json.dumps(v, ensure_ascii=False): ', ' and ': ' separators (the .base carries 09's text byte for byte). */
function pyJson(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return `[${v.map(pyJson).join(', ')}]`;
  if (typeof v === 'object') return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${pyJson(x)}`).join(', ')}}`;
  return JSON.stringify(v);
}
const q = (s) => JSON.stringify(s);

/* ── 07 Burn-up's rows ─────────────────────────────────────────────────────────────────────────────────────────── */

// drawing sizes (07): a tall table row (64 px) shows 58 px of image, so the burn-up is drawn at that height, never scaled
const TRACK_W = 232, TRACK_H = 58, BOX_W = 112, BOX_H = 58, STRIP_W = 320, STRIP_H = 18;
const EST_PREFIX = "the roadmap's agent ideas ";
const LINK = /\[([^\]]+)\]\([^)]+\)/g;   // an idea title's markdown link, drawn as its text
const MARK_COLORS = { step: 1, finish: 1, goal: 2, due: 2, wait: 3, done: 4, met: 4 };   // V5's plan.json
const img = (svg) => dataUri(svg);
const open = (g) => g.status === 'open';
const metish = (g) => String(g.status).startsWith('met');

/** Worst first: missed, behind plan, at risk, on plan, ahead, can't judge yet, met. */
function rankOf(g, w) {
  const st = g.status, word = g.check.word;
  if (st === 'missed') return 0;
  if (word === 'behind plan') return 1;
  if (w.state === 'at risk') return 2;
  if (word === 'on plan') return 3;
  if (word === 'ahead of plan') return 4;
  if (st === 'cannot judge yet') return 5;
  return 6;
}

/** {criterion key: [share 0..1 or null, short words, long words]}: what each box adds to "% of the way". */
function counts(g) {
  const lines = Object.fromEntries(g.lines.map((t) => [t.key, t]));
  const strips = Object.fromEntries(g.strips.map((s) => [s.key, s]));
  const out = {};
  for (const c of g.criteria) {
    if (c.refusal) { out[c.key] = [null, 'left out', "left out of the %: can't be judged yet"]; continue; }
    const t = lines[c.key];
    if (t && t.kind === 'line') {
      if (OPS[t.op](t.current, t.target) || metish(g)) { out[c.key] = [1.0, '1 box', '1 whole box: it passes']; continue; }
      const v0 = t.v_set, tgt = t.target;
      const share = v0 !== tgt ? Math.max(0, Math.min(0.999, (v0 - t.current) / (v0 - tgt))) : 0;
      const u = t.unit ? ` ${t.unit}` : '';
      const p = pyRoundInt(100 * share);
      out[c.key] = [share, `${p} % of its gap`, `${p} % of its gap closed since set (${num(v0)} → ${num(tgt)}${u})`];
      continue;
    }
    const s = strips[c.key];
    const passing = Boolean(s && s.segments?.length && s.segments.at(-1).pass);
    out[c.key] = passing ? [1.0, '1 box', '1 whole box: it passes'] : [0.0, '0 of 1 box', '0 of 1 box: not yet'];
  }
  return out;
}

function countsNote(g, clock) {
  const ch = g.check;
  if (!ch.judged) return `Nothing to add up: ${ch.says}. Each box is left out until it can be judged; the line starts once ruler v2 is frozen.`;
  const tail = ch.refused.length ? `; left out and named: ${ch.refused.join(', ')} (can't be judged yet)` : '';
  return `${ch.judged} boxes, each counted once: a box that passes is 1, a number is the share of its gap closed since the goal was set, `
    + `a spec or gate is 0 or 1${tail}. The plan line runs from where it stood when set to 100 % by ${clock.when(g.due)}.`;
}

/** The composite's actual line as measured, its carry left to the drawing (07: a trailing "now" point equal to the one
    before is not a new reading; dropping it lets the burn-up draw that stretch dotted). No value changes. */
function carried(ch, now) {
  const out = { ...ch };
  for (const key of ['pct', 'ticks']) {
    let series = [...(ch[key] || [])];
    if (series.length >= 2 && series.at(-1)[0] === now && series.at(-1)[1] === series.at(-2)[1]) series = series.slice(0, -1);
    out[key] = series;
  }
  return out;
}

function goalRow(g, b, now, crits, clock, ideasHref) {
  const w = g.words[b], ch = g.check;
  const draw = carried(ch, now);
  let pctWay, boxes;
  if (ch.judged) {
    pctWay = img(burnupSvg(draw, g, now, b, TRACK_W, TRACK_H, { mode: 'pct' }));
    boxes = img(burnupSvg(draw, g, now, b, BOX_W, BOX_H, { mode: 'ticks' }));
  } else {
    // WHY the hatched well with its words even in the table: a hatched well alone could read as "loading"
    pctWay = img(unknownSvg(ch.says, TRACK_W, TRACK_H, true));
    boxes = img(unknownSvg(ch.says, BOX_W, BOX_H, false));
  }
  let behind;
  if (open(g) && ch.judged) {
    const d = pyRound(ch.plan_pct_now - ch.pct.at(-1)[1], 1);
    behind = { value: d, text: d >= 0.5 ? `${pyRoundInt(d)} pts behind` : d <= -0.5 ? `${pyRoundInt(-d)} pts ahead` : 'on plan' };
  } else behind = { value: null, why: metish(g) ? 'met' : "can't judge yet" };
  const est = w.estimate_says ? w.estimate_says
    : metish(g) ? `${w.estimate}, ${w.gap}` : `${w.estimate}: ${w.waits} wait on you (never sized); ${w.gap}`;
  let pctNow;
  if (open(g) && ch.judged) pctNow = `${pyRoundInt(ch.pct.at(-1)[1])} % · the plan says ${pyRoundInt(ch.plan_pct_now)} %`;
  else if (metish(g)) {
    const p0 = ch.plan_pct[0][1];
    pctNow = `100 % · the plan said ${pyRoundInt(p0 + (100 - p0) * frac(g.set, g.due, g.met_at))} % by then`;
  } else pctNow = w.state;
  const refused = ch.refused;
  const countsTitle = ch.judged ? `${ch.judged} boxes, each counted once${refused.length ? ` · ${refused.length} left out` : ''}`
    : `0 boxes judged · ${refused.length} left out until ruler v2`;
  // every box in words, in written order
  const boxesMd = crits.map((c) => `- **${c.crit_label}** — ${c.crit_says.slice(c.crit_label.length + 3)} · *counts as ${c.counts_long}*`).join('\n');
  const steps = g.bottom_up[b].steps;
  return {
    id: g.id, kind: 'goal', goal: g.id, name: w.name, rank: rankOf(g, w), behind,
    pct_way: pctWay, boxes,
    pct_now: pctNow, counts_title: countsTitle, boxes_md: boxesMd,
    track: ch.word, track_says: ch.says, est_says: est,
    // WHY a short twin for the Tracking cell only: the column header already says "the roadmap's agent ideas"
    est_short: est.startsWith(EST_PREFIX) ? est.slice(EST_PREFIX.length) : est,
    due_left: { value: g.due, text: `${w.want_by} · ${!metish(g) ? w.time_left : `met ${clock.when(g.met_at)}`}` },
    want_by: { value: g.due, text: w.want_by },
    time_left: { value: pyRound(g.hours_left, 1), text: !metish(g) ? w.time_left : `met, ${w.gap}` },
    state: w.state, because: w.because, ticked: w.ticked, estimate: w.estimate, gap: w.gap,
    holds_back: w.holds_back, tier: w.tier, ideas_link: { value: ideasHref(g.id), text: w.ideas_link.text },
    counts_note: countsNote(g, clock),
    roadmap_note: steps.length || w.waits !== '—'
      ? `${w.fits} · agent work ${w.agent_minutes} ${w.buffer} · waits on you: ${w.waits} (never sized)` : w.fits,
    why: w.why, done_when: w.done_when, set_at: w.set_at, owner: w.owner, path: w.path,
    caveat: open(g) ? w.caveat : null,
  };
}

function criterionRows(g, b, now, clock) {
  const lines = Object.fromEntries(g.lines.map((t) => [t.key, t]));
  const strips = Object.fromEntries(g.strips.map((s) => [s.key, s]));
  const share = counts(g);
  return g.criteria.map((c, k) => {
    const t = lines[c.key], s = strips[c.key];
    let shape, tr, says, drawing;
    if (t !== undefined) {
      // WHY no drawing: 09 drops a number's own line drawing (08's stock chart draws it in its unit, in the panel)
      shape = 'line'; tr = t;
      says = t.says + (t.estimate_says && t.kind === 'line' && open(g) ? ` · estimate: ${t.estimate_says[b]}` : '');
    } else {
      shape = 'strip'; tr = s;
      drawing = img(stripSvg({ ...s, status: g.status }, now, b, STRIP_W, STRIP_H));
      says = s.says;
      const bet = (s.bets || {})[b];
      if (bet && open(g)) says += ` · estimate: ${bet.idea} bets it to pass by ${clock.when(bet.at)}`;
    }
    const head = !['passes', 'met'].includes(tr.word) ? tr.says.split(' · ')[0].split(': ')[0] : tr.says.split(' · ')[0];
    return {
      id: `${g.id}-c-${c.key}`, kind: 'criterion', goal: g.id, name: c.label, crit_n: k + 1, crit_shape: shape,
      ...(drawing !== undefined ? { drawing } : {}),
      crit_word: tr.word, crit_label: c.label, crit_says: `${c.label} · ${says}`, crit_head: head,
      counts_as: share[c.key][1], counts_long: share[c.key][2],
    };
  });
}

/** The roadmap in plan order (the idea queue filtered to the goal): agent ideas with their written minutes × the
    buffer and when they end if the box starts now; Zach's waits named, never sized. */
function stepRows(g, b, clock) {
  const steps = Object.fromEntries(g.bottom_up[b].steps.map((s) => [s.id, s]));
  return [...g.roadmap].sort((x, y) => x.step - y.step).map((r) => {
    const st = steps[r.id];
    let who, effort, ends;
    if (r.lane === 'human') {
      who = 'Zach'; effort = 'never sized';
      ends = r.open ? `answer by ${clock.when(g.due)} to fit` : 'answered';
    } else {
      who = 'agent';
      const mins = r.effort;
      if (st) {
        effort = span(st.buffered);
        ends = st.dated !== false ? clock.when(st.end) : `after your ${(st.after_waits || []).join(', ')}`;
      } else {
        effort = mins && !r.open ? `${span(mins)} (done)` : (mins ? span(mins) : 'not sized');
        ends = r.status === 'new-best' ? 'done: a new best' : (!r.open ? 'done' : '—');
      }
    }
    return {
      id: `${g.id}-s-${r.id}`, kind: 'step', goal: g.id, name: r.title,
      step_n: r.step, idea: r.id, step_title: String(r.title ?? '').replace(LINK, '$1'), who, effort, ends,
      bets: r.expect_text || (r.aims ? `aims at ${r.aims}` : '—'),
    };
  });
}

function planRows(slice, b) {
  return slice.goals.flatMap((g) => g.timeline[b].map((r) => {
    const { kind, ...rest } = r;
    return { ...rest, kind: 'plan', mark: kind, name: r.label };
  }));
}

function props07(slice, b) {
  const tones = {};
  for (const g of slice.goals) {
    const w = g.words[b];
    tones[w.state] = w.tone;
    tones[g.check.word] = g.check.tone;
    for (const t of [...g.lines, ...g.strips]) if (!(t.word in tones)) tones[t.word] = t.tone;
  }
  const buf = b === 'x2' ? '× 2' : 'buffer off';
  const T = (label, kw = {}) => ({ type: 'text', label, ...kw });
  return {
    // WHY hidden: kind / goal / rank only route rows to views and order them; hidden also keeps data-ui from picking
    // `kind` ("goal") as the side panel's subtitle, so the subtitle is the goal's % sentence (track_says)
    id: T('Row', { hidden: true }), kind: T('Row kind', { hidden: true }), goal: T('Goal id', { hidden: true }),
    name: T('Goal'), track_says: T('Where it is vs the plan'),
    rank: { type: 'number', label: 'Worst first', hidden: true },
    behind: { type: 'number', label: 'Behind plan', unitText: 'pts', decimals: 1 },
    pct_way: T('% of the way', { display: 'image' }), boxes: T('Boxes', { display: 'image' }),
    track: T('vs plan', { display: 'status', tones }), pct_now: T('% of the way'), counts_title: T('Counts'),
    boxes_md: T('Every box, in words', { display: 'markdown' }), est_says: T(`Estimate (${buf})`),
    est_short: T(`Estimate: the roadmap's agent ideas (${buf})`), due_left: T('Want by'), want_by: T('Want by'),
    time_left: { type: 'number', label: 'Time left' }, state: T('State', { display: 'status', tones }), because: T('Because'),
    ticked: T('Boxes ticked'), estimate: T(`Estimate (${buf})`), gap: T('Gap'), holds_back: T('Holds it back'), tier: T('Tier'),
    ideas_link: T('Ideas', { display: 'link' }), counts_note: T('How the % counts'), roadmap_note: T('The estimate'),
    why: T('Why'), done_when: { type: 'list', label: 'Done when (as written)' }, set_at: T('Set'), owner: T('Owner'),
    path: T('The note'), caveat: T('Caveat'),
    // criterion rows (the side panel's "each box, in its own units")
    crit_n: { type: 'number', label: '#' }, crit_shape: T('Drawn as'), drawing: T('Planned, actual, estimate', { display: 'image' }),
    crit_word: T('Now', { display: 'status', tones }), crit_label: T('Box'), crit_says: T('Box · where it is'), crit_head: T('Now'),
    counts_as: T('Counts as'), counts_long: T('Counts in the % as', { hidden: true }),
    // step rows (the roadmap in plan order)
    step_n: { type: 'number', label: '#' }, idea: T('Idea'), step_title: T('What'), who: T('Who', { colors: { agent: 0, Zach: 4 } }),
    effort: T(`Effort (${buf})`), ends: T('Ends (starts now)'), bets: T('Bets on'),
    // plan rows (V5's timeline)
    lane: T('Goal'), mark: T('Kind', { colors: MARK_COLORS }), shape: T('Shape'),
    start: { type: 'date', label: 'From' }, end: { type: 'date', label: 'To' }, label: T('What'),
    minutes: { type: 'number', label: 'Effort', unitText: 'min' }, note: T('Note'),
  };
}

/* ── 08 Small multiples' readings and chart ────────────────────────────────────────────────────────────────────── */

// WHY these hexes: goalspark's mid-tones (the two-lines chart), one value that reads on the light and the dark page; a
// canvas cannot read the page's CSS tokens, so the chart carries them as written
const DESIRED = '#8e8e98', ACTUAL = '#ee7d1f', ESTIMATE = '#8b5cf6', GUIDE = '#8e8e98';
const TONE_ORDER = { bad: 0, warn: 1, neutral: 2, muted: 3, good: 4 };
const nice = (label) => label.replace(/<=/g, '≤').replace(/>=/g, '≥');
/** The box's own wall clock tagged UTC, for the chart's x (a utc scale reads the box's clock in any viewer zone). */
const boxClock = (iso) => `${iso.slice(0, 19)}Z`;

/** Worst first: missed, at risk / behind, on track, can't judge yet, met (then by hours left). */
function goalRank(g) {
  const w = g.words.x2;
  if (metish(g)) return 50;
  if (g.status === 'cannot judge yet') return 30;
  return { bad: 0, warn: 10, neutral: 20, good: 20 }[w.tone] ?? 25;
}

function lineWords(t) {
  const s = t.says;
  if (t.kind === 'unknown') return s.split(' (')[0];
  if (['behind plan', 'ahead of plan', 'on plan'].includes(t.word)) return s.split(':')[0];
  if (t.word === 'met') return s.split(' (')[0];
  return s;
}

function boxesWords(check) {
  const s = check.says;
  if (check.word === 'met') return s.split(';')[0];
  const cur = check.ticks.at(-1)[1], n = check.judged, planNow = check.plan_ticks_now;
  if (Math.abs(cur - planNow) < 1e-9) return `on plan (${cur} of ${n})`;
  return `${check.word} by ${dnum(planNow - cur)} boxes (${cur} of ${n})`;
}

function estimateWords(text) {
  if (!text || text.startsWith('met')) return null;
  const e = /ideas end (.+?)(?: at | with |$)/.exec(text);
  const end = e ? e[1].replace(/[:,]+$/, '') : 'None';
  const short = /short ([^,:;]+)/.exec(text);
  const boxes = /\((\d+ of \d+ boxes)\)/.exec(text);
  if (text.includes('with it passing')) return `ideas end ${end}: still passing`;
  const parts = [`ideas end ${end}`, ...(boxes ? [boxes[1]] : []), ...(short ? [`short ${short[1].trim()}`] : [])];
  return parts.slice(0, 1).join(': ') + (parts.length > 1 ? `: ${parts.slice(1).join(', ')}` : '');
}

function readingRowsOf(g, b, grank, now, clock) {
  const gid = g.id;
  const openGoal = !metish(g);
  const rows = [];
  let k = 0;
  const add = (chart, targetName, rank, series, at, value, note = null, end = null, kw = {}) => {
    k += 1;
    rows.push({ id: `rd-${gid}-${String(k).padStart(3, '0')}`, kind: 'reading', goal: gid, chart, target_name: targetName,
      name: `${targetName} · ${series}`, rank, series, t: boxClock(at), at, t_end: end ? boxClock(end) : null, value,
      when: clock.when(at), note, ...kw });
  };
  const seriesOf = (chart, name, rank, plan, real, carry, est, due, target, better, unit, metAt = null, current = null) => {
    if (plan) for (const p of plan) add(chart, name, rank, 'planned', p[0], p[1]);
    for (const [at, v] of real) add(chart, name, rank, 'actual', at, v, null, null, { kpi_value: { value: v, unit }, target_v: target, better });
    if (carry) for (const [at, v] of carry) add(chart, name, rank, 'carried', at, v);
    if (est.length) {
      for (const p of est) add(chart, name, rank, 'estimate', p[0], p[1], p.length > 2 ? p[2] : null);
      const last = est.at(-1);
      if (ms(last[0]) < ms(due)) { add(chart, name, rank, 'hold', last[0], last[1]); add(chart, name, rank, 'hold', due, last[1]); }
    }
    add(chart, name, rank, 'target', due, target);
    if (metAt) {
      const hit = real.find(([at]) => ms(at) >= ms(metAt));
      add(chart, name, rank, 'met', metAt, hit ? hit[1] : (real.length ? real.at(-1)[1] : null), 'met');
    }
    if (openGoal) add(chart, name, rank, 'now', now, current, 'now');
  };
  const tracks = g.lines.map((l) => trackLine(l, g)).map((t) => [TONE_ORDER[t.tone] ?? 3, t]);
  tracks.sort((x, y) => x[0] - y[0]);
  // the check (boxes ticked) sits right after the goal's worst line: it holds the gates and specs
  const items = tracks.map(([, t]) => ['line', t]);
  if (g.check.judged) items.splice(items.length ? 1 : 0, 0, ['boxes', g.check]);
  let sub = 0;
  for (const [kind, t] of items) {
    sub += 1;
    const rank = grank[gid] * 100 + sub;
    if (kind === 'line') {
      const name = `${gid} · ${nice(t.label)}`;
      const est = estimateWords((t.estimate_says || {})[b]);
      const chart = `${name}\n${lineWords(t)}${est ? `\n${est}` : ''}`;
      if (t.kind === 'unknown') {
        // nothing measured, nothing drawn as measured: the window it would be judged in, its target, now
        add(chart, name, rank, 'unknown', g.set, null, "can't judge yet", g.due);
        add(chart, name, rank, 'target', g.due, t.target);
        add(chart, name, rank, 'now', now, null, 'now');
        add(chart, name, rank, 'actual', now, null, null, null, { kpi_value: { value: null, unit: t.unit, why: t.says }, target_v: t.target,
          better: t.op === '<=' || t.op === '<' ? 'lower' : 'higher' });
        continue;
      }
      const better = t.op === '<=' || t.op === '<' ? 'lower' : 'higher';
      const carry = t.carry_from ? [t.real.at(-1), [now, t.real.at(-1)[1]]] : null;
      seriesOf(chart, name, rank, t.plan, t.real, carry, t.estimate[b] || [], g.due, t.target, better, t.unit, t.met_at ?? null, t.current ?? null);
    } else {
      const c = t, n = c.judged;
      const name = `${gid} · boxes ticked, of ${n}`;
      const est = estimateWords((c.est_says || {})[b]);
      const chart = `${name}\n${boxesWords(c)}${est ? `\n${est}` : ''}`;
      const ticks = c.ticks;
      const [real, carry] = openGoal && ticks.length >= 2 ? [ticks.slice(0, -1), ticks.slice(-2)] : [ticks, null];
      seriesOf(chart, name, rank, c.plan_ticks, real.map(([a, v]) => [a, v]), carry, c.est_ticks[b] || [], g.due, n, 'higher', 'boxes',
        g.met_at ?? null, ticks.length ? ticks.at(-1)[1] : null);
    }
  }
  return rows;
}

/** The small multiples: one Vega-Lite layer per series, faceted by target (independent x and y). 08's chart_spec. */
export function chartSpec(columns = null) {
  const f = (s) => ({ filter: `datum.series == '${s}'` });
  // WHY padding: a target ring on a cell's right edge overhung it by 7 px and the last ring was clipped (08)
  const x = { field: 't', type: 'temporal', title: null, scale: { type: 'utc', padding: 8 },
    // WHY a 24-hour label: the words say 'Fri 17:00'; Vega's default says '05 PM'. A midnight tick names the day
    axis: { labelOverlap: true, tickCount: 4, labelFontSize: 10, ticks: false, domain: false,
      labelExpr: "utchours(datum.value) == 0 && utcminutes(datum.value) == 0 ? utcFormat(datum.value, '%a %d') : utcFormat(datum.value, '%H:%M')" } };
  // WHY the y labels inside the plot: every small multiple has its own y axis and data-ui budgets the width of one (08)
  const y = { field: 'value', title: null, scale: { zero: false, padding: 6 },
    axis: { tickCount: 3, labelFontSize: 9.5, labelAlign: 'left', labelBaseline: 'bottom', labelPadding: -3,
      ticks: false, domain: false, format: '~g', labelOpacity: 0.85, minExtent: 0, maxExtent: 0 } };
  // WHY sort by a calculated copy of rank: data-ui hoists the facet before it collects the fields a datum carries (08)
  const facet = { field: 'chart', type: 'nominal', title: null, sort: { field: 'worst_first', op: 'min' },
    header: { labelAngle: 0, labelAlign: 'left', labelAnchor: 'start', labelFontSize: 11.5,
      labelLineHeight: 15, labelPadding: 6, labelExpr: "split(datum.value, '\\n')",
      // WHY the cell's width: Vega widens a facet column to its longest header line (08)
      labelLimit: { expr: 'child_width' } } };
  if (columns) facet.columns = columns;
  return {
    transform: [{ calculate: 'datum.rank', as: 'worst_first' }],
    layer: [
      { transform: [f('unknown')], mark: { type: 'rect', fill: GUIDE, opacity: 0.13 }, encoding: { x, x2: { field: 't_end' }, facet } },
      { transform: [f('target')], mark: { type: 'rule', stroke: GUIDE, strokeDash: [1, 3], opacity: 0.7 }, encoding: { y } },
      { transform: [f('planned')], mark: { type: 'line', stroke: DESIRED, strokeDash: [4, 3], strokeWidth: 1.4 }, encoding: { x, y } },
      { transform: [f('hold')], mark: { type: 'line', stroke: ESTIMATE, strokeDash: [1.5, 2.5], strokeWidth: 1.3, opacity: 0.85 }, encoding: { x, y } },
      { transform: [f('estimate')], mark: { type: 'line', stroke: ESTIMATE, strokeWidth: 1.8, interpolate: 'step-after' }, encoding: { x, y } },
      { transform: [f('carried')], mark: { type: 'line', stroke: ACTUAL, strokeDash: [1.5, 2.2], strokeWidth: 1.7 }, encoding: { x, y } },
      { transform: [f('actual')], mark: { type: 'line', stroke: ACTUAL, strokeWidth: 2, interpolate: 'step-after' }, encoding: { x, y } },
      { transform: [f('actual')], mark: { type: 'point', filled: true, fill: ACTUAL, stroke: ACTUAL, size: 20, opacity: 1 }, encoding: { x, y } },
      { transform: [{ filter: "datum.series == 'estimate' && datum.note != null" }],
        mark: { type: 'point', filled: true, fill: ESTIMATE, stroke: ESTIMATE, size: 18, opacity: 1 }, encoding: { x, y } },
      { transform: [f('met')], mark: { type: 'point', filled: true, fill: ACTUAL, stroke: ACTUAL, size: 60, opacity: 1 }, encoding: { x, y } },
      { transform: [f('target')], mark: { type: 'point', shape: 'circle', filled: false, stroke: DESIRED, strokeWidth: 1.6, size: 70, opacity: 1 }, encoding: { x, y } },
      { transform: [f('now')], mark: { type: 'rule', stroke: GUIDE, strokeDash: [1.5, 2], opacity: 0.9 }, encoding: { x } },
      { transform: [f('now')], mark: { type: 'text', text: 'now', fill: GUIDE, fontSize: 10, align: 'left', baseline: 'top', dx: 3, dy: 2 },
        encoding: { x, y: { value: 0 } } },
      { transform: [f('unknown')], mark: { type: 'text', fill: GUIDE, fontSize: 11, align: 'left', baseline: 'middle', dx: 6 },
        encoding: { x, y: { value: 34 }, text: { field: 'note' } } },
    ],
    resolve: { scale: { x: 'independent', y: 'independent' } },
  };
}

// 08's reading columns, hidden as 08 hid them (a hidden property is never offered under "N more properties")
const READING_PROPS = ['chart', 'target_name', 'series', 't', 't_end', 'value', 'when', 'kpi_value', 'at', 'target_v', 'better'];
const PROPS_08 = {
  chart: { type: 'text', label: 'Target' }, target_name: { type: 'text', label: 'Target' }, series: { type: 'text', label: 'Series' },
  t: { type: 'date', label: 'Time (box clock)' }, t_end: { type: 'date', label: 'Until', hidden: true },
  value: { type: 'number', label: 'Value' }, when: { type: 'text', label: 'When' },
  kpi_value: { type: 'number', label: 'Now', digits: 4 }, at: { type: 'date', label: 'Read at' },
  target_v: { type: 'number', label: 'Target' }, better: { type: 'text', label: 'Better', hidden: true },
};
const CHART_SECTION = 'Each target, in its own unit: planned, actual, estimate';

/* ── 09 Splice: the dataset and the .base ──────────────────────────────────────────────────────────────────────── */

/** 09's dataset for one buffer (x2 | x1): 07's goal / criterion / step rows, 08's readings, V5's plan rows. */
export function spliceDataset(slice, b, { ideasHref = (g) => `#ideas?goal=${g}`, id = 'goals-09-splice' } = {}) {
  const now = slice.as_of, clock = new Clock(now);
  const rows = [], rest = [];
  for (const g of slice.goals) {
    const crits = criterionRows(g, b, now, clock);
    rows.push(goalRow(g, b, now, crits, clock, ideasHref));
    rest.push(...crits, ...stepRows(g, b, clock));
  }
  // 08's readings, worst first (its own goal order: by rank, then hours left; a stable sort)
  const order = [...slice.goals].sort((x, y) => goalRank(x) - goalRank(y) || x.hours_left - y.hours_left);
  const grank = Object.fromEntries(order.map((g, i) => [g.id, i]));
  const readings = order.flatMap((g) => readingRowsOf(g, b, grank, now, clock));
  // how many small multiples the panel's chart draws for each goal (the tab sizes the chart by it)
  for (const goal of rows) goal.n_targets = new Set(readings.filter((r) => r.goal === goal.id).map((r) => r.target_name)).size;
  rows.push(...rest, ...readings, ...planRows(slice, b));
  const properties = props07(slice, b);
  for (const k of READING_PROPS) properties[k] = { ...PROPS_08[k], hidden: true };
  properties.n_targets = { type: 'number', label: 'Targets charted', hidden: true };
  return { id, title: 'Goals', titleProperty: 'name', properties, rows };
}

const REC07_HEAD = `    record:
      sections:
        - { name: Where it stands, properties: [state, because, est_says, want_by, time_left, holds_back] }`;
const REC07_TAIL = `        - name: Each pass / fail box
          view: { type: table, name: Boxes, filters: 'kind == "criterion" && goal == this.id && crit_shape == "strip"', order: [drawing, crit_label, counts_as], sort: [{ property: crit_n, direction: ASC }], display: { drawing: image }, rowHeight: medium, columnSize: { drawing: 200, crit_label: 190, counts_as: 104 } }
        - { name: "How the % counts", properties: [counts_note, boxes_md] }
        - name: The roadmap, in plan order
          properties: [roadmap_note, ideas_link]
          view: { type: table, name: Roadmap, filters: 'kind == "step" && goal == this.id', order: [step_n, idea, step_title, who, effort, ends, bets], sort: [{ property: step_n, direction: ASC }], rowHeight: medium, wrap: true, columnSize: { step_n: 44, idea: 62, step_title: 164, who: 58, effort: 74, ends: 100, bets: 110 } }
        - { name: The goal as written, properties: [why, done_when, set_at, tier, owner, path, caveat] }`;

/** The one side panel, the same from every preset (09: 07's, with 08's stock chart in real units after "Where it stands"). */
function spliceRecord() {
  const chart = { type: 'chart', name: 'Its targets', filters: 'kind == "reading" && goal == this.id',
    sort: [{ property: 'rank', direction: 'ASC' }], style: { chrome: 'minimal' },
    chart: chartSpec(1), hover: { title: 'target_name', fields: ['series', 'when', 'value', 'note'] } };
  return `${REC07_HEAD}\n        - name: ${q(CHART_SECTION)}\n          view: ${pyJson(chart)}\n${REC07_TAIL}`;
}

const CARDS_08 = `  - type: kpi
    name: Cards
    filters: 'kind == "reading" && series == "actual"'
    groupBy: { property: target_name }
    sort:
      - { property: rank, direction: ASC }
      - { property: t, direction: ASC }
    kpi:
      value: { property: kpi_value }
      target: target_v
      compare: { against: target, better: better }
      spark: { x: at, y: value }
`;

/** 09's goals.base (07's Rows, Timeline and Tracking; 08's kpi Cards; the splice's panel on every view). */
export function spliceBaseText(slice, { record = spliceRecord(), data = true } = {}) {
  const lanes = `[${slice.goals.map((g) => q(`${g.id} · ${g.title}`)).join(', ')}]`;
  // WHY no `plan.window` (round 3, Zach's daily note: see "the start and end"): V5's "zoom to the work" opened on an
  // empty slice when no goal was open (now … now + 1 h); data-ui's timeline (57bfaf6, defaultWindow) fits every item's
  // start and end into 75 % of the width, which bb-goals.plan.js falls back to when no window is set
  const g3 = slice.goals.find((g) => !g.check.judged);
  const leftOut = g3 ? ` (${g3.id}: ${g3.check.says})` : '';
  const intro = `**% of the way**, one line per goal so every goal reads on one axis whatever its units: each box counts once (a box that passes is 1, a spec or gate 0 or 1), a number counts the share of its gap closed since the goal was set, and a box that can't be judged is left out and named${leftOut}. Click a goal for each box in its own units.`;
  // WHY no comment header: 09's names its build files; the test compares everything below it, byte for byte
  return `${data ? 'data: goals.rows.json\n' : ''}open: side
views:
  - type: table
    name: Rows
    filters: 'kind == "goal"'
    order: [name, state, because, ticked, want_by, estimate, gap, time_left, holds_back, tier, ideas_link]
    sort:
      - { property: rank, direction: ASC }
      - { property: behind, direction: DESC }
    rowHeight: medium
    wrap: true
    display: { state: status, ideas_link: link, boxes_md: markdown }
    columnSize: { name: 200, state: 128, because: 260, ticked: 120, want_by: 120, estimate: 170, gap: 160, time_left: 120, holds_back: 280, tier: 80, ideas_link: 110 }
${record}
${CARDS_08}${record}
  - type: plan
    name: Timeline
    filters: 'kind == "plan"'
    start: start
    end: end
    title: label
    groupBy: { property: lane }
    groupOrder: ${lanes}
    color: mark
    zoom: { min: PT10M, max: P60D }
    plan:
      shape: shape
      now: ${q(slice.as_of)}
${record}
  - type: table
    name: Tracking
    filters: 'kind == "goal"'
    order: [name, pct_way, track, track_says, est_short, boxes, due_left]
    sort:
      - { property: rank, direction: ASC }
      - { property: behind, direction: DESC }
    rowHeight: tall
    display: { pct_way: image, boxes: image, track: status, boxes_md: markdown, ideas_link: link }
    columnSize: { name: 136, pct_way: 240, track: 118, track_says: 200, est_short: 290, boxes: 112, due_left: 106 }
    intro:
      text: ${q(intro)}
${record}
`;
}

/* ── the viewer's panel: round 1's features as sections ────────────────────────────────────────────────────────── */

export const ODDS_SECTION = "The odds, from the box's own history";
const TAKES = '        - { name: What it takes, properties: [takes_md] }';
const ODDS = `        - name: ${q(ODDS_SECTION)}\n          view: { type: goal-odds, name: Odds, filters: 'kind == "odds" && goal == this.id' }`;
const AS_WRITTEN = '        - { name: The goal as written, properties: [why, done_when, set_at, tier, owner, path, caveat] }';

/** The viewer's panel: the splice's, then round 1's "what it takes" (04's "no idea aims at this"), 03's odds with 02's
    value moves (left out with the tab's `levers` setting off), and the goal as written with 01's hit rate for its tier. */
function goalsRecord(odds = true) {
  const rec = recordR3(spliceRecord());
  if (!rec.endsWith(AS_WRITTEN)) throw new Error("the splice's panel changed its last section");
  return `${rec.slice(0, -AS_WRITTEN.length)}${TAKES}\n${odds ? `${ODDS}\n` : ''}${AS_WRITTEN.replace('caveat]', 'caveat, tier_hit]')}`;
}

/** The viewer's .base: the splice's presets and panel, no data file (the tab hands data-ui the rows); round 3 (§27):
    Cards is one card per goal, the panel's chart draws linear / planned / actual, and a goal's record has a page (its
    full-page dashboard, `full_href`), which data-ui offers in the panel's header as "Open as page" (⤢). */
export function goalsBaseText(slice, { odds = true } = {}) {
  const text = spliceBaseText(slice, { record: goalsRecord(odds), data: false });
  const cards = `${CARDS_08}${goalsRecord(odds)}`;
  if (!text.includes(cards) || !text.startsWith('open: side\n')) throw new Error("the splice's Cards preset or its open: changed");
  return text.replace('open: side\n', 'open: { mode: side, url: full_href }\n').replace(cards, `${cardsR3(slice)}${goalsRecord(odds)}`);
}

/* ── Goals round 3 (CONTRACT §27): one card per goal, three named lines, the full page ─────────────────────────── */

export const CHART_R3 = 'Each target, in its own unit: linear, planned, actual';

/** Cards (Zach, 2026-11-25: "on the goal page I still want to keep everything grouped together by goals… almost like an
    overview of the goals"): data-ui's stock cards view over the goal rows, one card each: its name, its state word,
    when it is due and the time left, the boxes ticked, "Open full page ↗", and the card's drawing (bb-goals.card.js:
    a KPI tracker per target, the pass / fail boxes as ticks). Every card is drawn as tall as the tallest. */
function cardsR3(slice) {
  const h = Math.max(...slice.goals.map(cardHeight), 60);
  const ratio = Math.min(2.5, Math.max(0.25, Math.round((h / CARD_W) * 1000) / 1000));
  return `  - type: cards
    name: Cards
    filters: 'kind == "goal"'
    order: [name, state, due_left, ticked, full_link]
    image: card_img
    imageFit: contain
    imageAspectRatio: ${ratio}
    cardSize: 360
    sort:
      - { property: rank, direction: ASC }
      - { property: behind, direction: DESC }
    display: { state: status, full_link: link }
`;
}

/** The panel's chart, round 3: 08's small multiples with linear (dashed grey), planned (violet steps: a filled dot where
    an idea's - By: dates it, a hollow one where only its effort does), the plan as it stood at set (faint), actual. */
export function chartSpecR3(columns = null) {
  const base = chartSpec(columns);
  const f = (sname) => ({ filter: `datum.series == '${sname}'` });
  const enc = (l) => l.encoding;
  const x = enc(base.layer[2]).x, y = enc(base.layer[2]).y;
  const keep = base.layer.filter((l) => !/'(planned|hold|estimate)'/.test(JSON.stringify(l.transform)));
  const at = keep.findIndex((l) => /'carried'/.test(JSON.stringify(l.transform)));
  keep.splice(at, 0,
    { transform: [f('linear')], mark: { type: 'line', stroke: COLORS.linear, strokeDash: [4, 3], strokeWidth: 1.4 }, encoding: { x, y } },
    { transform: [f('plan_set')], mark: { type: 'line', stroke: COLORS.planned, strokeDash: [2, 2], strokeWidth: 1.2, opacity: 0.4, interpolate: 'step-after' }, encoding: { x, y } },
    { transform: [f('planned')], mark: { type: 'line', stroke: COLORS.planned, strokeWidth: 1.8, interpolate: 'step-after' }, encoding: { x, y } },
    { transform: [{ filter: "datum.series == 'planned' && datum.step == 'by'" }], mark: { type: 'point', filled: true, fill: COLORS.planned, stroke: COLORS.planned, size: 26, opacity: 1 }, encoding: { x, y } },
    { transform: [{ filter: "datum.series == 'planned' && datum.step == 'estimated'" }], mark: { type: 'point', filled: false, stroke: COLORS.planned, strokeWidth: 1.4, size: 30, opacity: 1 }, encoding: { x, y } });
  return { ...base, layer: keep };
}

function recordR3(text) {
  const from = text.indexOf(`        - name: ${q(CHART_SECTION)}\n`);
  const to = text.indexOf('\n', text.indexOf('          view: ', from)) + 1;
  if (from < 0 || to <= 0) throw new Error("the splice's chart section moved");
  const chart = { type: 'chart', name: 'Its targets', filters: 'kind == "reading" && goal == this.id',
    sort: [{ property: 'rank', direction: 'ASC' }], style: { chrome: 'minimal' },
    chart: chartSpecR3(1), hover: { title: 'target_name', fields: ['series', 'when', 'value', 'note'] } };
  return `${text.slice(0, from)}        - name: ${q(CHART_R3)}\n          view: ${pyJson(chart)}\n${text.slice(to)}`;
}

/** The splice's dataset with round 3's lines: the reading series `planned` (round 2's Grove line) is renamed `linear`;
    the estimate (and its hold) gives way to `planned` from the slice's lines[].planned (the ideas' By and Expect) and
    `plan_set` (the plan as ideas.md stood at set); Tracking's drawings and each goal's card draw the same three lines. */
function round3(ds, slice, b, fullHref) {
  const now = slice.as_of;
  const byGoal = Object.fromEntries(slice.goals.map((g) => [g.id, g]));
  const h = Math.max(...slice.goals.map(cardHeight), 60);
  const charts = new Map();
  const rows = [];
  for (const r of ds.rows) {
    if (r.kind === 'goal') {
      const g = byGoal[r.id];
      r.card_img = dataUri(goalCardSvg(g, b, now, h));
      r.full_link = { value: fullHref(g.id), text: 'Open full page ↗' };
      r.full_href = fullHref(g.id);
      if (g.check.judged) {
        r.pct_way = dataUri(threeSvg(checkSeries(g, b, now, 'pct'), TRACK_W, TRACK_H));
        r.boxes = dataUri(threeSvg(checkSeries(g, b, now, 'ticks'), BOX_W, BOX_H));
      }
    }
    if (r.kind === 'reading') {
      if (r.series === 'estimate' || r.series === 'hold') continue;
      if (r.series === 'planned') r.series = 'linear';
      if (!charts.has(r.target_name)) charts.set(r.target_name, { chart: r.chart, rank: r.rank, goal: r.goal, at: rows.length });
    }
    rows.push(r);
  }
  // the planned series per chart, inserted after the chart's own rows
  const adds = [];
  for (const [name, c] of charts) {
    const g = byGoal[c.goal];
    let s = null;
    if (/ · boxes ticked, of \d+$/.test(name)) s = checkSeries(g, b, now, 'ticks');
    else {
      const line = g.lines.find((l) => name === `${g.id} · ${l.label.replace(/<=/g, '≤').replace(/>=/g, '≥')}`);
      if (line && line.kind === 'line') s = targetSeries(line, g, b, now);
    }
    if (!s) continue;
    let k = 0;
    const add = (series, p) => {
      k += 1;
      adds.push({ id: `rd-${g.id}-${name.length}-${series}-${String(k).padStart(3, '0')}`, kind: 'reading', goal: g.id, chart: c.chart, target_name: name,
        name: `${name} · ${series}`, rank: c.rank, series, t: `${p.t.slice(0, 19)}Z`, at: p.t, t_end: null, value: p.v,
        when: new Clock(now).when(p.t), note: p.idea ? `${p.idea}${p.by ? ' · by its - By:' : ' · estimated: no - By:'}` : (series === 'plan_set' ? 'the plan when set' : null),
        step: p.idea ? (p.by ? 'by' : 'estimated') : null });
    };
    for (const p of s.planned) add('planned', p);
    for (const p of s.atSet) add('plan_set', p);
  }
  rows.push(...adds);
  ds.rows = rows;
  Object.assign(ds.properties, {
    card_img: { type: 'text', label: 'The goal at a glance', display: 'image' },
    full_link: { type: 'text', label: 'Full page', display: 'link' },
    full_href: { type: 'text', label: 'Its page', hidden: true },
    step: { type: 'text', label: 'Dated by', hidden: true },
  });
  return ds;
}

const GLYPH = { pass: '✓', fail: '✗', unverified: '?', 'not run': '–', deferred: '…', 'cannot judge': '–' };

/** Round 1's "what it takes" in words: each criterion, what decides it, the idea aiming at it, and under a red one nothing
    aims at, 04's finding with the line to write. */
function takesMd(g) {
  return g.criteria.map((c) => {
    // WHY measurement first (round 3, found on trajectory_tracking_agent's G1): a benchmark reading sits at the box's
    // level but has no tests; it read "its undefined tests pass"
    const how = c.refusal ? c.refusal
      : c.kind === 'measurement' ? `${typeof c.measured === 'number' ? `${num(c.measured)}, ` : ''}${c.passed ? 'passes' : 'not yet'} (goals/metrics.json, its newest reading)`
      : c.level === 'box' ? `${c.state === 'pass' ? `its ${c.tests} tests pass` : c.tests ? `its tests: ${c.state}` : 'no test names it yet'} (the repo's tests at the ref)`
        : c.kind === 'gates' ? `${c.passed ? 'every gate passes' : 'a gate fails'} on ${c.on || 'no solution'}, the candidate`
          : `${typeof c.measured === 'number' ? `${num(c.measured)} ` : ''}on ${c.on || 'no solution'}, the candidate`;
    const aimed = c.aimed_by.length ? ` · aimed at by ${c.aimed_by.join(', ')}` : '';
    const finding = c.finding ? `\n  - **${c.finding}**: ${c.fix}` : '';
    return `- ${GLYPH[c.state] || (c.passed ? '✓' : '·')} **${c.label}** \`${c.line}\` — ${how}${aimed}${finding}`;
  }).join('\n');
}

/** 01's goal hit rate for a goal's tier: met by its date ÷ settled (met or missed), from the slice's own goals. */
function tierHit(slice, g) {
  const mine = slice.goals.filter((x) => x.tier === g.tier);
  const settled = mine.filter((x) => ['met', 'met late', 'missed'].includes(x.status));
  const hit = settled.filter((x) => x.status === 'met');
  const label = g.tier === 'must' ? 'must-meet goals hit' : `${g.tier} goals hit`;
  const rest = mine.filter((x) => !settled.includes(x)).map((x) => `${x.id} ${x.status}`).join(', ');
  return settled.length ? `${label}: ${Math.round(100 * hit.length / settled.length)} % (${hit.length} of ${settled.length} settled)${rest ? `; ${rest}` : ''}`
    : `${label}: none settled yet${rest ? ` (${rest})` : ''}`;
}

/** Why a goal has no odds, said (03 runs only for an open goal whose agent ideas are all sized). */
function oddsNone(g, clock) {
  if (metish(g)) return `No odds: met ${clock.when(g.met_at)} by ${g.met_by}.`;
  if (g.status === 'cannot judge yet') return 'No odds until it can be judged: its criteria wait on a ruler that is not frozen yet.';
  if (g.status === 'missed') return `No odds: missed its date (${clock.when(g.due)}).`;
  return 'No odds: some of its roadmap ideas are not sized, or none is the agent\'s.';
}

/** The viewer's dataset: the splice's, plus round 1's fields on each goal row and one odds row per goal. */
export function goalsDataset(slice, b, { ideasHref = (g) => `#ideas?goal=${g}`, fullHref = (g) => `#goals?goal=${g}&full=1`, id = 'goals' } = {}) {
  const ds = round3(spliceDataset(slice, b, { ideasHref, id }), slice, b, fullHref);
  const clock = new Clock(slice.as_of);
  for (const r of ds.rows) {
    if (r.kind !== 'goal') continue;
    const g = slice.goals.find((x) => x.id === r.id);
    r.takes_md = takesMd(g);
    r.tier_hit = tierHit(slice, g);
  }
  const odds = slice.goals.map((g) => ({
    id: `${g.id}-odds`, kind: 'odds', goal: g.id, name: `${g.id} · the odds`, odds_buffer: b,
    odds_model: g.odds ? JSON.stringify(g.odds) : null, odds_none: g.odds ? null : oddsNone(g, clock),
    odds_moves: JSON.stringify(valueMoves(g, b, slice.as_of)), odds_due: g.due, odds_idle: slice.pace?.idle_hours ?? null,
  }));
  // WHY right after the goals' steps, before the readings: an embedded view filters by kind, so the place only keeps the
  // dataset readable; the splice's rows keep their order
  const at = ds.rows.findIndex((r) => r.kind === 'reading');
  ds.rows.splice(at < 0 ? ds.rows.length : at, 0, ...odds);
  Object.assign(ds.properties, {
    takes_md: { type: 'text', label: 'What it takes', display: 'markdown' },
    tier_hit: { type: 'text', label: 'Goals of its tier hit' },
    odds_buffer: { type: 'text', label: 'Buffer', hidden: true }, odds_model: { type: 'text', label: 'Odds model', hidden: true },
    odds_none: { type: 'text', label: 'No odds', hidden: true }, odds_moves: { type: 'text', label: 'Moves', hidden: true },
    odds_due: { type: 'date', label: 'Due', hidden: true }, odds_idle: { type: 'number', label: 'Idle hours', hidden: true },
  });
  return ds;
}

/* ── Goals round 3: the goal's full page (CONTRACT §27) ────────────────────────────────────────────────────────── */

/** The side panel's sections, read from the viewer's own .base record (never re-written): [{name, properties, view}]. */
export function panelSections(slice, { odds = true } = {}) {
  const text = goalsBaseText(slice, { odds });
  const rec = text.slice(text.indexOf('    record:\n'), text.indexOf('\n  - type: cards'));
  const out = [];
  for (const m of rec.matchAll(/^ {8}- (\{ name: (.+?), properties: \[([^\]]*)\] \}|name: (.+))$\n?((?: {10}.+\n?)*)/gm)) {
    const name = (m[2] ?? m[4]).replace(/^"(.*)"$/, (_, x) => JSON.parse(`"${x}"`));
    const body = m[5] || '';
    const props = m[3] ?? (/^ {10}properties: \[([^\]]*)\]/m.exec(body)?.[1] ?? null);
    const view = /^ {10}view: (.+)$/m.exec(body)?.[1] ?? null;
    out.push({ name, properties: props ? props.split(',').map((x) => x.trim()).filter(Boolean) : [], view });
  }
  return out;
}

/** A field as markdown for a text panel (the panel's field list, read from the same row and labels). */
function fieldMd(v, p) {
  if (v === null || v === undefined || v === '') return null;
  if (Array.isArray(v)) return v.map((x) => `\n  - ${String(x)}`).join('');
  if (typeof v === 'object') return p?.display === 'link' && v.value ? `[${v.text || v.value}](${v.value})` : String(v.text ?? v.value ?? '');
  return String(v);
}

const PANEL_SIZE = { // the grid: [w of 12, h in rows of 110 px] per section, by its place in the panel
  'Where it stands': [5, 3], 'Each pass / fail box': [6, 3], 'How the % counts': [6, 3], 'The roadmap, in plan order': [6, 3],
  'What it takes': [6, 4], [ODDS_SECTION]: [6, 6], 'The goal as written': [12, 3],
};

/** The goal's full page as a data-ui dashboard .base (`layout:` over `views:`): every section of the side panel, in its
    order, as one panel of the grid; a section's embedded view with `this.id` bound to the goal, a section's fields as a
    text panel. WHY from the record and not a second list: the panel and the page can never drift apart. */
export function fullPageBase(slice, gid, ds, { odds = true } = {}) {
  const row = ds.rows.find((r) => r.id === gid && r.kind === 'goal');
  const props = ds.properties;
  const views = [], panels = [];
  const g = slice.goals.find((x) => x.id === gid);
  for (const sec of panelSections(slice, { odds })) {
    // a section with nothing for this goal is left out (a goal with no pass / fail box); no odds is said in two rows
    if (sec.name === 'Each pass / fail box' && !g.strips.length) continue;
    const [w, h0] = sec.name === CHART_R3 ? [7, Math.max(3, 2 * (row.n_targets || 1))] : (PANEL_SIZE[sec.name] || [6, 3]);
    const h = sec.name === ODDS_SECTION && !g.odds ? 2 : h0;
    const md = sec.properties.map((k) => [props[k]?.label || k, fieldMd(row[k], props[k])]).filter(([, v]) => v)
      .map(([label, v]) => (/^\s*- |\n/.test(v) ? `**${label}**\n\n${v.replace(/^\n/, '').replace(/^ {2}- /gm, '- ')}` : `**${label}**: ${v}`)).join('\n\n');
    if (md || !sec.view) panels.push({ text: `### ${sec.name}\n\n${md || '—'}`, w });
    if (sec.view) {
      // `this.id` bound to the goal, quoted for where it sits (a JSON string in a flow-JSON view, a YAML '…' otherwise)
      const view = sec.view.replace(/this\.id/g, sec.view.startsWith('{"') ? JSON.stringify(q(gid)).slice(1, -1) : q(gid));
      // the section's view, renamed to its section (the panel names it; one name per view)
      views.push(`  - ${view.replace(/("name"|name): ("[^"]*"|[^,]+),/, `$1: ${q(sec.name)},`)}`);
      panels.push({ view: sec.name, w, h, title: sec.name });
    }
  }
  return `data: goals.json
open: side
layout:
  columns: 12
  rowHeight: 110
  panels:
${panels.map((p) => `    - ${pyJson(p)}`).join('\n')}
views:
${views.join('\n')}
`;
}
