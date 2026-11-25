/* bb-goals' words and numbers (viewer/CONTRACT.md §20), pure: no DOM, so the node tests read them. Everything here is
   computed from the goals slice (tools/folds/goals.py: goals_core's judgement and bottom-up, 02's lines, 03's odds
   inputs); nothing is typed in. The splice of PICKS.md "Goals (2026-11-25)":
     verdict()      one calm answer first: "1 of 3 met · G2 at risk: on time, but no idea bets on its last 0.0013 mm; I-026
                    waits on you · G3 cannot be judged until ruler v2" (02's verdict, made one line)
     goalWord()     a goal's word, tone and time left (02's chips)
     perGoal()      the goal's own sentence under its title (02)
     valueMoves()   02's moves when the estimate falls short of a target: cut scope, add an agent, move the date, bet on the gap
     levers()       03's two levers: when you answer each wait, when the box runs; the options, each carrying its odds
     timeMoves()    03's three moves re-simulated when a setting does not fit (< 90 % on time)
   Times are shown on the box's own clock (the offset its as_of is written in), never the reader's. */

const HOUR = 3600000, DAY = 24 * HOUR;
const t = (iso) => new Date(iso).getTime();
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NB = ' ';

/** The box's clock offset in ms, from an ISO time written with one (…-07:00), else UTC. */
export function offsetOf(iso) {
  const m = /([+-])(\d\d):(\d\d)$/.exec(String(iso || ''));
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * HOUR + Number(m[3]) * 60000) : 0;
}
const local = (ms, off) => new Date(ms + off);
const pad = (n) => String(n).padStart(2, '0');
export const hhmm = (ms, off) => { const d = local(ms, off); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };

/** "05:40" on the as-of day, "Fri 17:00" within the week, "Dec 12 17:00" further out (02's clock). */
export function clock(iso, asOf) {
  const off = offsetOf(asOf);
  const ms = t(iso), d = local(ms, off), n = local(t(asOf), off);
  if (d.getUTCFullYear() === n.getUTCFullYear() && d.getUTCMonth() === n.getUTCMonth() && d.getUTCDate() === n.getUTCDate()) return hhmm(ms, off);
  if (Math.abs(ms - t(asOf)) < 6 * DAY) return `${WD[d.getUTCDay()]} ${hhmm(ms, off)}`;
  return `${MO[d.getUTCMonth()]} ${d.getUTCDate()} ${hhmm(ms, off)}`;
}
export function longClock(iso, asOf) {
  const off = offsetOf(asOf), d = local(t(iso), off);
  return `${WD[d.getUTCDay()]} ${MO[d.getUTCMonth()]} ${d.getUTCDate()} ${hhmm(t(iso), off)}`;
}
/** A reading as logged, to four significant figures (never 0.031333594888818476). */
export const num = (v) => (v === null || v === undefined ? '—' : Math.abs(v) < 1 ? String(Number(v.toPrecision(4))) : String(Number(v.toPrecision(3))));
const gapNum = (v) => String(Number(Math.abs(v).toPrecision(2)));
export const hours = (h) => (Math.abs(h) < 48 ? `${Number(h.toFixed(1))}${NB}h` : `${(h / 24).toFixed(1)} days`);
export const mins = (m) => (m < 90 ? `${m}${NB}min` : `${Number((m / 60).toFixed(1))}${NB}h`);
export const OP = { '<=': '≤', '<': '<', '>=': '≥', '>': '>', '==': '=' };
const OPS = { '<=': (a, b) => a <= b, '<': (a, b) => a < b, '>=': (a, b) => a >= b, '>': (a, b) => a > b, '==': (a, b) => a === b };
export const pct = (p) => (p >= 0.995 ? `>${NB}99${NB}%` : p <= 0.005 ? `<${NB}1${NB}%` : `${Math.round(p * 100)}${NB}%`);

export const isMet = (g) => g.status === 'met' || g.status === 'met late';
const ruler = (g) => {
  const r = g.criteria.find((c) => c.refusal && c.ruler);
  if (r) return `ruler ${r.ruler}`;
  return g.criteria.some((c) => c.refusal && /ruler v\d/.test(c.refusal)) ? `ruler ${/ruler (v\d+)/.exec(g.criteria.find((c) => c.refusal && /ruler v\d/.test(c.refusal)).refusal)[1]}` : null;
};
const waits = (g, tag) => (g.bottom_up[tag]?.waits_on_zach || []).map((w) => w.id);
/** The measurable lines this buffer reads at risk (02's pace word per line). */
const risky = (g, tag) => (g.lines || []).filter((l) => !l.refusal && l.pace?.[tag] === 'at risk');
const betOn = (g, ref) => (g.roadmap || []).some((r) => r.open && r.expect && r.expect.kind === 'pct' && r.expect.ref === ref);

/** The goal's state in a word, its tone (calm unless it is a problem) and its time. */
export function goalWord(g, tag = 'x2', asOf = g.as_of) {
  if (isMet(g)) {
    const early = (t(g.due) - t(g.met_at)) / HOUR;
    return { word: g.status, tone: g.status === 'met' ? 'good' : 'warn', time: early >= 0 ? `${hours(early)} early` : `${hours(-early)} late` };
  }
  if (g.status === 'missed') return { word: 'missed', tone: 'bad', time: `${hours(-g.hours_left)} over` };
  if (g.status === 'cannot judge yet') return { word: 'cannot judge yet', tone: 'muted', time: `${hours(g.hours_left)} left` };
  const late = g.bottom_up[tag] && t(g.bottom_up[tag].estimate_if_started_now) > t(g.due);
  const r = risky(g, tag).length || late;
  return { word: r ? 'at risk' : 'on track', tone: r ? 'warn' : 'good', time: `${hours(g.hours_left)} left` };
}

/** One clause per goal that is not met, worst first: what holds it back, in words. */
function clause(g, tag, asOf) {
  if (g.status === 'cannot judge yet') {
    const r = ruler(g);
    return { rank: 2, tone: 'muted', text: `${g.id} cannot be judged ${r ? `until ${r}` : 'yet'}` };
  }
  if (g.status === 'missed') return { rank: 0, tone: 'bad', text: `${g.id} missed (due ${clock(g.due, asOf)})` };
  const bu = g.bottom_up[tag];
  const late = t(bu.estimate_if_started_now) > t(g.due);
  const w = waits(g, tag);
  const tail = w.length ? `; ${w.join(', ')} ${w.length === 1 ? 'waits' : 'wait'} on you` : '';
  const r = risky(g, tag)[0];
  if (r) {
    const what = betOn(g, r.ref) ? `its bets fall ${gapNum(r.estimate_value[tag] - r.target)} ${r.unit} short` : `no idea bets on its last ${gapNum(r.gap)} ${r.unit}`;
    return { rank: 1, tone: 'warn', text: `${g.id} at risk: ${late ? `late (its roadmap ends ${clock(bu.estimate_if_started_now, asOf)})` : 'on time'}, but ${what}${tail}` };
  }
  if (late) return { rank: 1, tone: 'warn', text: `${g.id} at risk: its roadmap ends ${clock(bu.estimate_if_started_now, asOf)}, after its due ${clock(g.due, asOf)}${tail}` };
  const unaimed = g.criteria.filter((c) => c.finding);
  if (unaimed.length) return { rank: 1, tone: 'warn', text: `${g.id} at risk: no idea aims at ${unaimed.map((c) => c.key).join(', ')}${tail}` };
  return { rank: 3, tone: 'good', text: `${g.id} on track${tail}` };
}

/** The tab's one answer: how many are met, then each goal that is not, worst first. */
export function verdict(slice, { buffer = 'x2' } = {}) {
  const goals = slice.goals || [];
  const met = goals.filter(isMet).length;
  const parts = goals.filter((g) => !isMet(g)).map((g) => clause(g, buffer, slice.as_of)).sort((a, b) => a.rank - b.rank);
  const problems = (slice.problems || []).length;
  const text = [`${met} of ${goals.length} met`, ...parts.map((p) => p.text)].join(' · ')
    + (problems ? ` · ${problems} ${problems === 1 ? 'line' : 'lines'} of the goals' files refused` : '');
  const tone = parts.some((p) => p.tone === 'bad') ? 'bad' : parts.some((p) => p.tone === 'warn') || problems ? 'warn' : 'calm';
  return { text, tone, parts };
}

/** The goal's own sentence under its title (02's per-goal line). */
export function perGoal(g, tag, asOf) {
  const bu = g.bottom_up[tag];
  const b = Number(tag.slice(1));
  if (isMet(g)) {
    const early = (t(g.due) - t(g.met_at)) / HOUR;
    return `Met ${longClock(g.met_at, asOf)} by ${g.met_by}, ${hours(Math.abs(early))} ${early >= 0 ? 'before' : 'after'} its due ${clock(g.due, asOf)}. Its estimate is drawn as it stood when it was set (${clock(g.set, asOf)}).`;
  }
  if (g.status === 'cannot judge yet') {
    const ref = g.criteria.find((c) => c.refusal);
    const w = waits(g, tag);
    return `Cannot be judged yet: ${ref.refusal}.`
      + (bu.steps.length ? ` Its agent work (${bu.steps.map((s) => s.id).join(', ')}) ${bu.steps.some((s) => !s.dated) ? `waits behind ${w.join(', ')}` : `ends ${clock(bu.estimate_if_started_now, asOf)}`} (×${b})` : '')
      + (w.length ? `; ${w.length} ${w.length === 1 ? 'idea waits' : 'ideas wait'} on you (${w.join(', ')}), never sized.` : '.');
  }
  const late = t(bu.estimate_if_started_now) > t(g.due);
  const w = waits(g, tag);
  let s = `${late ? 'Late' : 'On time'}: its ${bu.steps.length} agent ${bu.steps.length === 1 ? 'idea ends' : 'ideas end'} ${clock(bu.estimate_if_started_now, asOf)} (${mins(bu.agent_minutes)} × ${b}), ${hours(Math.abs(bu.slack_hours))} ${late ? 'after' : 'before'} ${clock(g.due, asOf)}`
    + (w.length ? `, then ${w.join(', ')} ${w.length === 1 ? 'waits' : 'wait'} on you` : '') + '.';
  const r = risky(g, tag)[0];
  if (r) s += ` Short on ${r.ref}: ${num(r.current)} vs ${OP[r.op]} ${num(r.target)} ${r.unit}, and ${betOn(g, r.ref) ? 'its bets do not close' : 'no idea on its roadmap bets on'} the last ${gapNum(r.gap)} ${r.unit} (${Math.abs(r.gap_pct)} %).`;
  return s;
}

/** Two agents, longest first (02's "add an agent"): the makespan in buffered minutes. */
export function twoLanes(steps) {
  const lanes = [0, 0];
  for (const s of [...steps].sort((a, b) => b.buffered - a.buffered)) lanes[lanes.indexOf(Math.min(...lanes))] += s.buffered;
  return Math.max(...lanes);
}
/** v rounded UP to three significant figures (0.031334 -> 0.0314): a target today's value meets as written. */
const ceil3 = (v) => { const k = 10 ** (Math.floor(Math.log10(Math.abs(v))) - 2); return String(Number((Math.ceil(v / k) * k).toPrecision(3))); };

/** 02's moves, on the goal's own ideas, when its estimate falls short of a target or ends after the date. [] when it fits. */
export function valueMoves(g, tag, asOf) {
  if (isMet(g) || g.status !== 'open') return [];
  const bu = g.bottom_up[tag];
  const line = risky(g, tag)[0];
  const late = t(bu.estimate_if_started_now) > t(g.due);
  if (!line && !late) return [];
  const out = [];
  if (line) {
    const rest = g.criteria.filter((c) => !c.passed && c.key !== line.key).map((c) => {
      const step = bu.steps.find((s) => (g.roadmap.find((r) => r.id === s.id) || {}).aims === c.key);
      return step ? `${c.key} with ${step.id} at ${clock(step.end, asOf)}` : `${c.key}: no idea aims at it`;
    });
    out.push({ move: 'Cut scope', text: `drop <code>kpi:${line.ref} ${line.op} ${line.target}</code> from ${g.path}, or relax it to ${ceil3(line.current)}, which today's best already meets.`
      + (rest.length ? ` What is left lands on its own: ${rest.join(', ')}` : '') + (waits(g, tag).length ? `; then ${waits(g, tag).join(', ')} waits on you.` : '.') });
  }
  if (bu.steps.length > 1) {
    const end = new Date(t(asOf) + twoLanes(bu.steps) * 60000).toISOString();
    const longest = [...bu.steps].sort((a, b) => b.buffered - a.buffered)[0];
    out.push({ move: 'Add an agent', text: `a second agent takes ${longest.id} beside the rest: the roadmap ends ${clock(end, asOf)} instead of ${clock(bu.estimate_if_started_now, asOf)}${line && !late ? '. That buys time, not the missing bet.' : '.'}` });
  }
  out.push(late ? { move: 'Move the date', text: `to ${longClock(bu.estimate_if_started_now, asOf)} (the estimate, ×${tag.slice(1)}), ${hours((t(bu.estimate_if_started_now) - t(g.due)) / HOUR)} later.` }
    : { move: 'Move the date', text: `not the lever: ${hours(bu.slack_hours)} of slack after the estimate. A later date helps only if a new idea bets on the gap.` });
  if (line && !betOn(g, line.ref)) {
    out.push({ move: 'Or bet on the gap', text: `no idea on ${g.id}'s roadmap bets a number on ${line.ref}: it needs ${String(line.gap_pct).replace('-', '−')} % (${num(line.current)} → ${num(line.target)}). Write one, with <code>- Goal: ${g.id} · ${line.key}</code> and <code>- Expect: ${line.ref} −N %</code> under it.` });
  }
  return out;
}

/** 03's levers: when the reader answers each wait, when the box runs. Minutes after as_of on the box's clock: every
    four hours to the due date, the working mornings and evenings, the due itself and the morning after (an answer can
    come late). Each option is re-labelled with its odds by the component. */
export function levers(model) {
  const off = offsetOf(model.origin), o = t(model.origin);
  const at = (min) => new Date(o + min * 60000);
  const label = (min) => { const d = local(o + min * 60000, off); return `${WD[d.getUTCDay()]} ${hhmm(o + min * 60000, off)}`; };
  const marks = new Set();
  // the next 09:00 and 17:00 of each day from now to a day past the due
  const first = local(o, off);
  const midnight = o - (first.getUTCHours() * 60 + first.getUTCMinutes()) * 60000 - first.getUTCSeconds() * 1000;
  for (let d = 0; midnight + d * DAY <= o + (model.due + 24 * 60) * 60000; d++) {
    for (const h of [9, 13, 17]) { const m = (midnight + d * DAY + h * HOUR - o) / 60000; if (m > 0) marks.add(m); }
  }
  const answer = [...marks, model.due].filter((m) => m > 0 && m <= model.due + 24 * 60).sort((a, b) => a - b);
  const start = [0, ...[...marks].filter((m) => m > 0 && m < model.due)].sort((a, b) => a - b);
  const def = Object.values(model.slots)[0];
  if (def !== undefined && !answer.includes(def)) answer.push(def), answer.sort((a, b) => a - b);
  return { answer: answer.map((m) => ({ min: m, label: label(m), at: at(m).toISOString() })),
    start: start.map((m) => ({ min: m, label: m === 0 ? 'now' : label(m), at: at(m).toISOString() })), label };
}

/** 03's moves for one setting that does not fit (< 90 % on time), re-simulated on the goal's own ideas. */
export function timeMoves(model, settings, simulate, { answers = [] } = {}) {
  const r = simulate(model, settings);
  if (r.p_on_time >= 0.9) return { fits: true, p: r.p_on_time, result: r, moves: [] };
  const lv = levers(model);
  const wait = model.waits[0];
  const slot = wait ? settings.slots?.[wait] ?? model.slots[wait] : null;
  const newDue = Math.ceil(r.finish.p90 / 60) * 60;
  const moved = simulate(model, { ...settings, due: newDue });
  const date = { move: 'Move the date', text: `due ${lv.label(newDue)} (this setting's P90, to the hour)`, p: moved.p_on_time };
  if (wait && slot > model.due) {
    const sooner = answers.map((a) => a.min).filter((m) => m <= model.due).pop();
    const soon = sooner === undefined ? null : simulate(model, { ...settings, slots: { ...(settings.slots || {}), [wait]: sooner } });
    return { fits: false, p: r.p_on_time, result: r, binds: 'answer', moves: [
      ...(soon ? [{ move: 'Answer sooner', text: `answer ${wait} by ${lv.label(sooner)}`, p: soon.p_on_time }] : []), date,
      { move: 'Cut scope or add an agent', text: `cannot help: the goal cannot finish before your answer, however fast the box's part goes`, p: null }] };
  }
  const cuts = model.steps.filter((s) => s.kind === 'agent').map((s) => ({ id: s.id, min: s.min, r: simulate(model, { ...settings, cut: [s.id] }) }))
    .sort((a, b) => b.r.p_on_time - a.r.p_on_time || a.min - b.min);
  const two = simulate(model, { ...settings, lanes: 2 });
  return { fits: false, p: r.p_on_time, result: r, binds: 'box', moves: [
    { move: 'Cut scope', text: `drop ${cuts[0].id} (${cuts[0].min} min written), its criterion left open`, p: cuts[0].r.p_on_time },
    { move: 'Add an agent', text: 'run the agent ideas on 2 lanes in plan order', p: two.p_on_time }, date] };
}

/** The ideas rows of one goal, in plan order (the Ideas tab's filter); 'none' = the ideas that serve no goal. */
export function ideasOf(ideas, goal) {
  if (goal === 'none') return ideas.filter((i) => Array.isArray(i.goal) && !i.goal.length);
  return ideas.filter((i) => Array.isArray(i.goal) && i.goal.includes(goal)).sort((a, b) => (a.goal[0] === goal ? a.step : 0) - (b.goal[0] === goal ? b.step : 0));
}
export { OPS };
