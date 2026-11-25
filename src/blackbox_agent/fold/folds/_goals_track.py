"""Goals round 2's tracking arithmetic, folded into the `goals` slice (viewer/CONTRACT.md §25; PICKS.md "Goals round 2
(2026-11-25)"). A port of proposals-goals-v2/_shared/track.py (never imported: the round is read-only), held to that
round's committed model.json by tests/goals-track.test.mjs, every word and number.

    enrich(goals, ideas, as_of, counts, objective)      (tools/folds/goals.py calls it last, after the ideas rows gain
                                                          their goal fields; it adds keys, it never changes one)

Zach, 2026-11-25, on the Goals tab: "one you don't quite have but I like the idea of basically like showing the spark line
progress towards the goals and gates… These graphs are great btw they are from like [High Output Management] it shows a
linear line of improvement. your planned line... and then the actual line... very powerful to at a glance see if we are
on track or not to hit our goals." Nothing is re-judged here: status, criteria, readings, the estimate (×2 and ×1) and
the ideas' goal links are the fold's own. What this adds:

    planned  a straight line from where the criterion stood when the goal was set to its target at the due date
             (Andy Grove's plan line; only where there was a gap to close: a criterion passing at set has no plan line)
    actual   the candidate's readings since set, carried flat to "now" while the box scored nothing (the carry is NOT a
             reading: `carry_from` says where measurement stops)
    vs plan  actual minus the planned line's value at now, in the criterion's own unit, said in words

per line (`kind`, `word`, `tone`, `says`, `real`, `plan`, `carry_from`, `plan_now`, `vs_plan`, `window`, `v_set`,
`passes_at_set`, `met_at`, `status`, `estimate_says` per buffer), and per goal: `strips` (each pass / fail criterion as a
strip over the goal's window: the ledger for a gate, a spec as it stands now), `check` (boxes ticked over time and the
composite "% of the way": each judged criterion counts once, passing = 1, a number = the share of its gap closed since
set, a spec = 0 or 1, a criterion that cannot be judged is left out and named; its plan and estimate per buffer),
`words` per buffer (the sentences the tab shows), `timeline` per buffer (V5's plan rows), each bottom-up step's `bets`
(the box its idea's "- Expect: O1.1 → pass" bets on) and each criterion's `track` / `track_kind`. Stdlib only.
"""

from __future__ import annotations

from datetime import datetime, timedelta

BUFFERS = ("x2", "x1")
OP = {"<=": "≤", "<": "<", ">=": "≥", ">": ">", "==": "="}
OPS = {"<=": lambda a, b: a <= b, "<": lambda a, b: a < b, ">=": lambda a, b: a >= b, ">": lambda a, b: a > b}
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


# ---- clock and words -------------------------------------------------------------------------------------------

def ts(iso: str) -> datetime:
    return datetime.fromisoformat(iso)


def iso(d: datetime) -> str:
    return d.isoformat(timespec="seconds")


class Clock:
    def __init__(self, as_of: str):
        self.now = ts(as_of)

    def when(self, s: str | None) -> str:
        """'05:00' today, 'Fri 17:00' within six days, else 'Sat Dec 12 17:00' (the box's own offset)."""
        if not s:
            return "—"
        d = ts(s)
        hm = d.strftime("%H:%M")
        if d.date() == self.now.date():
            return hm
        if abs((d - self.now).total_seconds()) < 6 * 86400:
            return f"{DAYS[d.weekday()]} {hm}"
        return f"{DAYS[d.weekday()]} {MONTHS[d.month - 1]} {d.day} {hm}"

    def hours(self, a: str, b: str | None = None) -> float:
        return ((ts(b) if b else self.now) - ts(a)).total_seconds() / 3600


def span(minutes: float) -> str:
    m = round(abs(minutes))
    if m < 60:
        return f"{m} min"
    h, r = divmod(m, 60)
    if h >= 48:
        d, hh = divmod(h, 24)
        return f"{d} d {hh} h" if hh else f"{d} d"
    return f"{h} h {r} min" if r and h < 10 else f"{h} h"


def num(v) -> str:
    if v is None:
        return "—"
    if isinstance(v, (int,)) or float(v).is_integer():
        return str(int(v))
    return str(float(f"{v:.4g}")) if abs(v) < 1 else str(float(f"{v:.3g}"))


def dnum(v) -> str:
    """A difference: two significant figures (0.00015 mm, 0.0013 mm), so the amount reads at a glance."""
    if v is None:
        return "—"
    return str(float(f"{abs(v):.2g}"))


def frac(a: datetime, b: datetime, t: datetime) -> float:
    total = (b - a).total_seconds()
    return 0.0 if total <= 0 else (t - a).total_seconds() / total


# ---- one target line (a measurable criterion) --------------------------------------------------------------------

def line_track(line: dict, goal: dict, clock: Clock) -> dict:
    """Planned vs actual vs estimate for one measurable criterion of a goal (the fold's lines[] row)."""
    gset, due, now = ts(goal["set"]), ts(goal["due"]), clock.now
    out = {
        "id": line["id"], "goal": goal["id"], "key": line["key"], "ref": line["ref"], "label": line["label"],
        "unit": line.get("unit") or "", "op": line.get("op"), "target": line.get("target"),
        "set": goal["set"], "due": goal["due"], "status": goal["status"], "refusal": line.get("refusal"),
    }
    if line.get("refusal"):
        out.update(kind="unknown", word="can't judge yet", tone="muted",
                   says=f"can't judge yet: {line['refusal']}", real=[], plan=None, estimate={b: [] for b in BUFFERS},
                   window=[goal["set"], goal["due"]], carry_from=None, plan_now=None, vs_plan=None)
        return out
    reals = [(r["date"], r["value"]) for r in line["readings"] if r.get("kind") == "real" and r.get("value") is not None]
    target = line["target"]
    op = line["op"]
    better_low = op in ("<=", "<")
    v_set = reals[0][1] if reals else None
    current = line.get("current")
    passes_at_set = v_set is not None and OPS[op](v_set, target)
    met_at = goal.get("met_at")
    open_goal = not goal["status"].startswith("met")
    last_t = reals[-1][0] if reals else None
    carry_from = last_t if (open_goal and last_t and ts(last_t) < now) else None
    plan = None if passes_at_set or v_set is None else [[goal["set"], v_set], [goal["due"], target]]
    # WHY none on a met goal: nothing is left to estimate; the fold still carries its roadmap's steps from set
    est = {b: ([[p["date"], p["value"]] + ([p["idea"]] if p.get("idea") else []) for p in line["estimate"][b]] if open_goal else [])
           for b in BUFFERS}
    est_end = {b: line["estimate_end"][b] for b in BUFFERS}
    ends = [due] + ([ts(met_at)] if met_at else []) + [ts(e) for e in est_end.values() if e]
    window = [goal["set"], iso(max(ends))]

    plan_now = vs_plan = None
    unit = out["unit"]
    u = f" {unit}" if unit and unit != "%" else (" %" if unit == "%" else "")
    if not open_goal:
        early = clock.hours(met_at, goal["due"]) * 60 if met_at else 0
        word, tone = ("met", "good")
        says = f"met {clock.when(met_at)} by {goal.get('met_by')}, {span(early)} early" if met_at else "met"
        # at the moment it was met, where the plan said it would be
        if plan and met_at:
            p = v_set + (target - v_set) * frac(gset, due, ts(met_at))
            says += f" (the plan said {num(p)}{u} by then)"
    elif current is not None and OPS[op](current, target):
        word, tone = "passes", "good"
        margin = abs(target - current)
        says = f"passes: {num(current)}{u}, {dnum(margin)}{u} inside {OP[op]} {num(target)}"
    else:
        f = min(1.0, max(0.0, frac(gset, due, now)))
        plan_now = v_set + (target - v_set) * f
        diff = current - plan_now  # >0 is behind for lower-is-better
        behind = diff > 0 if better_low else diff < 0
        gap = abs(target - current)
        if abs(diff) < 1e-12:
            word, tone, rel = "on plan", "neutral", "on plan"
        else:
            word = "behind plan" if behind else "ahead of plan"
            tone = "warn" if behind else "good"
            rel = f"{word} by {dnum(diff)}{u}"
        says = f"{rel}: {num(current)}{u} now, the plan says {num(plan_now)}{u} by {clock.when(iso(now))}; {dnum(gap)}{u} to go"
        vs_plan = diff if better_low else -diff
    out.update(kind="line", word=word, tone=tone, says=says, real=[[t, v] for t, v in reals], plan=plan,
               estimate=est, estimate_end=est_end, estimate_value=line.get("estimate_value"),
               pace=line.get("pace"), gap=line.get("gap"), gap_pct=line.get("gap_pct"),
               current=current, v_set=v_set, passes_at_set=passes_at_set, carry_from=carry_from,
               window=window, plan_now=plan_now, vs_plan=vs_plan, met_at=met_at)
    # what the estimate does to this line, per buffer
    out["estimate_says"] = {}
    for b in BUFFERS:
        ev = line.get("estimate_value", {}).get(b)
        if not open_goal:
            out["estimate_says"][b] = "met: no estimate needed"
        elif ev is not None and OPS[op](ev, target):
            out["estimate_says"][b] = f"the roadmap's ideas end {clock.when(est_end[b])} with it passing"
        elif ev is not None:
            out["estimate_says"][b] = (f"the roadmap's ideas end {clock.when(est_end[b])} at {num(ev)}{u}: short "
                                       f"{dnum(target - ev)}{u}, no idea bets on it")
        else:
            out["estimate_says"][b] = "no estimate"
    return out


# ---- a pass / fail criterion (all gates, a spec) as a strip over time -------------------------------------------

def strip_track(c: dict, goal: dict, clock: Clock, steps: dict) -> dict:
    """State over the goal's window: from the fold's history for a solution-level criterion (the gates), the repo's
    state now for a spec (specs have no history in the fold: said, never drawn backwards)."""
    gset, now = ts(goal["set"]), clock.now
    out = {"id": f"{goal['id']}-{c['key']}", "goal": goal["id"], "key": c["key"], "label": c["label"],
           "line": c.get("line"), "state": c["state"], "refusal": c.get("refusal"), "aimed_by": c.get("aimed_by", []),
           "finding": c.get("finding"), "set": goal["set"], "due": goal["due"], "kind": "strip"}
    if c.get("refusal"):
        out.update(segments=[], word="can't judge yet", tone="muted", says=f"can't judge yet: {c['refusal']}",
                   history="none")
        return out
    segs = []
    if c["level"] == "solution":
        k = f"c{c['i']}"
        hist = goal["history"]
        before = [h for h in hist if ts(h["t"]) <= gset and k in h]
        since = [h for h in hist if ts(h["t"]) > gset and k in h]
        pts = ([(goal["set"], before[-1][k])] if before else []) + [(h["t"], h[k]) for h in since]
        for (t0, v), nxt in zip(pts, pts[1:] + [(iso(now), None)]):
            segs.append({"from": t0, "to": nxt[0], "pass": bool(v >= 1.0), "measured": True})
        out["history"] = "ledger"
    else:
        segs.append({"from": goal["set"], "to": iso(now), "pass": c["state"] == "pass", "measured": False})
        out["history"] = "now only"
    if not goal["status"].startswith("met") and segs and ts(segs[-1]["to"]) < now:
        segs[-1]["to"] = iso(now)
    if goal["status"].startswith("met"):
        # a met goal's strip ends at its due date: what came after is no longer this goal's business
        segs = [{**g, "to": min(g["to"], goal["due"], key=ts)} for g in segs if ts(g["from"]) < ts(goal["due"])]
    # an idea that bets this box → pass, by when (per buffer)
    bets = {}
    for b in BUFFERS:
        for st in steps[b]:
            if st.get("bets") == c["key"]:
                bets[b] = {"idea": st["id"], "at": st["end"], "dated": st.get("dated", True)}
    passing = c["state"] == "pass"
    if passing:
        word, tone = "passes", "good"
        says = "passes on every dev task since set" if c["level"] == "solution" else f"passes now ({c.get('tests', '')} tests)"
    else:
        word, tone = "not yet", "warn"
        aim = ", ".join(c.get("aimed_by") or []) or "no idea"
        says = (f"{c['state']}: {c.get('tests', 0) if 'tests' in c else 0} tests yet; {aim} aims at it" if c["level"] == "box"
                else f"failing; {aim} aims at it")
        if c.get("finding"):
            says += f" ({c['finding']})"
    if c["level"] == "box":
        says += " · a spec has no history in the fold: drawn as it stands now, not backwards"
    out.update(segments=segs, word=word, tone=tone, says=says, bets=bets)
    return out


# ---- the goal: checklist and % of the way over time --------------------------------------------------------------

def goal_steps(goal: dict, ideas: dict) -> dict:
    """bottom_up's steps per buffer, each with the box it bets on (from the idea's own '- Expect: O1.1 → pass')."""
    out = {}
    for b in BUFFERS:
        rows = []
        for st in goal["bottom_up"][b]["steps"]:
            idea = ideas.get(st["id"], {})
            ge = idea.get("goal_expect") or ""
            bets = ge.split("→")[0].strip() if "→ pass" in ge else None
            rows.append({**st, "bets": bets, "expect": ge or None})
        out[b] = rows
    return out


def checklist_track(goal: dict, lines: list[dict], strips: list[dict], steps: dict, clock: Clock) -> dict:
    """Boxes ticked over time (each judged criterion one box) and the composite '% of the way'."""
    gset, due, now = ts(goal["set"]), ts(goal["due"]), clock.now
    judged = [c for c in goal["criteria"] if not c.get("refusal")]
    refused = [c for c in goal["criteria"] if c.get("refusal")]
    n = len(judged)
    if not n:
        return {"judged": 0, "total": len(goal["criteria"]), "refused": [c["key"] for c in refused],
                "ticks": [], "pct": [], "plan_ticks": None, "plan_pct": None, "est_ticks": {}, "est_pct": {},
                "word": "can't judge yet", "tone": "muted",
                "says": f"can't judge yet: {len(refused)} of {len(refused)} boxes wait on ruler v2 (not frozen yet)"}
    by_key = {t["key"]: t for t in lines}
    strip_by = {s["key"]: s for s in strips}
    # moments: set, every real reading since set, every strip change, now (or met)
    moments = {goal["set"]}
    for t in lines:
        moments |= {r[0] for r in t.get("real", []) if ts(r[0]) >= gset}
    for s in strips:
        moments |= {seg["from"] for seg in s.get("segments", []) if ts(seg["from"]) >= gset}
    end = ts(goal["met_at"]) if goal.get("met_at") else now
    moments = sorted((m for m in moments if ts(m) <= max(end, gset)), key=ts)
    if iso(end) not in moments and end > gset:
        moments.append(iso(end))

    def at(c, m):
        """(ticked 0/1, progress 0..1) of one criterion at moment m."""
        mt = ts(m)
        if c["key"] in by_key and by_key[c["key"]]["kind"] == "line":
            t = by_key[c["key"]]
            vals = [v for (tt, v) in t["real"] if ts(tt) <= mt]
            v = vals[-1] if vals else t.get("v_set")
            if v is None:
                return 0, 0.0
            ok = OPS[t["op"]](v, t["target"])
            if ok:
                return 1, 1.0
            v0 = t["v_set"]
            span_ = (v0 - t["target"])
            return 0, max(0.0, min(0.999, (v0 - v) / span_)) if span_ else 0.0
        s = strip_by.get(c["key"])
        segs = [g for g in (s or {}).get("segments", []) if ts(g["from"]) <= mt]
        ok = bool(segs and segs[-1]["pass"])
        return (1, 1.0) if ok else (0, 0.0)

    ticks, pct = [], []
    for m in moments:
        res = [at(c, m) for c in judged]
        ticks.append([m, sum(r[0] for r in res)])
        pct.append([m, round(100 * sum(r[1] for r in res) / n, 1)])
    t0, p0 = ticks[0][1], pct[0][1]
    plan_ticks = [[goal["set"], t0], [goal["due"], n]]
    plan_pct = [[goal["set"], p0], [goal["due"], 100.0]]
    # the estimate: from now, +1 box (and its share) at each step that bets a box to pass
    est_ticks, est_pct = {}, {}
    open_goal = not goal["status"].startswith("met")
    for b in BUFFERS:
        if not open_goal:
            est_ticks[b], est_pct[b] = [], []
            continue
        tk, pc = ticks[-1][1], pct[-1][1]
        et, ep = [[iso(now), tk]], [[iso(now), pc]]
        done = set()
        for st in steps[b]:
            key = st.get("bets")
            if key and key not in done:
                c = next((c for c in judged if c["key"] == key), None)
                if c is not None and at(c, iso(now))[0] == 0:
                    tk += 1
                    pc += round(100 * (1 - at(c, iso(now))[1]) / n, 1)
                    done.add(key)
            et.append([st["end"], tk, st["id"]])
            ep.append([st["end"], round(pc, 1), st["id"]])
        est_ticks[b], est_pct[b] = et, ep
    f_now = min(1.0, max(0.0, frac(gset, due, now)))
    plan_pct_now = round(p0 + (100 - p0) * f_now, 1)
    plan_ticks_now = t0 + (n - t0) * f_now
    cur_t, cur_p = ticks[-1][1], pct[-1][1]
    if not open_goal:
        met_f = frac(gset, due, ts(goal["met_at"])) if goal.get("met_at") else 1
        word, tone = "met", "good"
        says = (f"met {clock.when(goal['met_at'])}: 100 % of the way {span(clock.hours(goal['met_at'], goal['due']) * 60)} "
                f"early; the plan said {round(p0 + (100 - p0) * met_f)} % by then")
    else:
        d = cur_p - plan_pct_now
        word = "on plan" if abs(d) < 0.5 else ("behind plan" if d < 0 else "ahead of plan")
        tone = "warn" if d <= -0.5 else ("good" if d >= 0.5 else "neutral")
        says = (f"{round(cur_p)} % of the way ({cur_t} of {n} boxes); the plan says {round(plan_pct_now)} % by "
                f"{clock.when(iso(now))}: " + (f"{abs(round(d))} points behind" if d <= -0.5 else
                                               f"{round(d)} points ahead" if d >= 0.5 else "on plan"))
    if refused:
        says += f" · {len(refused)} box{'es' if len(refused) > 1 else ''} left out: can't be judged yet"
    est_says = {}
    for b in BUFFERS:
        if not open_goal or not est_pct[b]:
            est_says[b] = None
            continue
        last = est_pct[b][-1]
        lt = est_ticks[b][-1][1]
        waits = [w["id"] for w in goal["bottom_up"][b]["waits_on_zach"]]
        est_says[b] = (f"the roadmap's agent ideas end {clock.when(last[0])} at {round(last[1])} % ({lt} of {n} boxes)"
                       + (f", then {', '.join(waits)} wait{'s' if len(waits) == 1 else ''} on you (not sized)" if waits else "")
                       + ("" if lt == n else f"; short {n - lt} box{'es' if n - lt > 1 else ''}: no idea bets on "
                          + ", ".join(c["key"].replace("objective", "the objective") for c in judged
                                      if not any(st.get("bets") == c["key"] for st in steps[b]) and at(c, iso(now))[0] == 0)))
    return {"judged": n, "total": len(goal["criteria"]), "refused": [c["key"] for c in refused],
            "ticks": ticks, "pct": pct, "plan_ticks": plan_ticks, "plan_pct": plan_pct,
            "plan_pct_now": plan_pct_now, "plan_ticks_now": round(plan_ticks_now, 2),
            "est_ticks": est_ticks, "est_pct": est_pct, "est_says": est_says,
            "word": word, "tone": tone, "says": says}


# ---- the V5 timeline rows (the Timeline preset) ---------------------------------------------------------------------

def timeline_rows(goal: dict, ideas: dict, b: str, clock: Clock, lane: str) -> list[dict]:
    """V5's shapes from the fold: band (set → want by), done (measured), bar (an agent idea from now), later (behind a
    wait), wait (Zach's, never sized), flags (want by, estimate, met)."""
    bu = goal["bottom_up"][b]
    rows = []

    def row(kind, shape, rid, start, end, label, **kw):
        rows.append({"id": rid, "goal": goal["id"], "lane": lane, "kind": kind, "shape": shape, "start": start,
                     "end": end, "label": label, "idea": kw.pop("idea", None), "minutes": kw.pop("minutes", None),
                     "note": kw.pop("note", None)})

    row("goal", "band", f"tl-{goal['id']}", goal["set"], goal["due"], lane,
        note=f"wanted: set {clock.when(goal['set'])} → want by {clock.when(goal['due'])}")
    done = [ideas[d["id"]] for d in bu["done"] if d["id"] in ideas and ideas[d["id"]].get("closed_t")]
    done.sort(key=lambda r: r["closed_t"])
    if done:
        a, z = done[0]["closed_t"], done[-1]["closed_t"]
        row("done", "bar" if ts(z) > ts(a) else "tick", f"tl-{goal['id']}-done", a, z if ts(z) > ts(a) else None,
            f"{len(done)} ideas done (measured)", minutes=sum((r.get("effort") or 0) for r in done),
            note="done, at each idea's scored time: " + ", ".join(f"{r['iid']} {clock.when(r['closed_t'])}" for r in done))
    waits = bu["waits_on_zach"]
    dated = [s for s in bu["steps"] if s.get("dated", True)]
    later = [s for s in bu["steps"] if not s.get("dated", True)]
    for s in dated:
        row("step", "bar", f"tl-{goal['id']}-{s['id']}", s["start"], s["end"],
            f"{s['id']} · {span(s['minutes'])} × {bu['buffer']:g}", idea=s["id"], minutes=s["minutes"],
            note=f"estimate: {s['title']} · {span(s['minutes'])} written, {span(s['buffered'])} with the buffer")
    ask_from = dated[-1]["end"] if dated else clock.now.isoformat()
    for w in waits:
        row("wait", "wait", f"tl-{goal['id']}-{w['id']}", ask_from, goal["due"], f"{w['id']} waits on Zach · not sized",
            idea=w["id"], note=f"{w['title']} · Zach's: never sized · answer by {clock.when(goal['due'])} to fit")
    for s in later:
        start = iso(ts(goal["due"]) - timedelta(minutes=s["buffered"]))
        row("step", "later", f"tl-{goal['id']}-{s['id']}", start, goal["due"],
            f"{s['id']} · {span(s['minutes'])} × {bu['buffer']:g} · after Zach", idea=s["id"], minutes=s["minutes"],
            note=f"estimate behind Zach's {', '.join(s.get('after_waits') or [])}: drawn at the latest it can start")
    row("due", "flag", f"tl-{goal['id']}-due", goal["due"], None, f"want by {clock.when(goal['due'])}",
        note="desired: Zach's date")
    if goal["status"].startswith("met"):
        row("met", "flag", f"tl-{goal['id']}-met", goal["met_at"], None, f"met {clock.when(goal['met_at'])}",
            note=f"met by {goal['met_by']} (measured, the ledger)")
    elif dated:
        row("finish", "flag", f"tl-{goal['id']}-finish", dated[-1]["end"], None, f"estimate {clock.when(dated[-1]['end'])}",
            note="estimated end of the agent's work ahead of any wait on Zach, if the box starts now")
    return rows


# ---- the goal's words (the tab's sentences) ------------------------------------------------------------------------

def goal_words(goal: dict, lines: list[dict], check: dict, b: str, clock: Clock, n_ideas: int, objective: str) -> dict:
    bu = goal["bottom_up"][b]
    st = goal["status"]
    holds = [c for c in goal["criteria"] if c.get("refusal") is None and c["state"] != "pass"]
    refused = [c for c in goal["criteria"] if c.get("refusal")]
    waits = [w["id"] for w in bu["waits_on_zach"]]
    # the tracking word: the goal's worst line or box, the fold's own pace words where it has them
    line_paces = [t.get("pace", {}).get(b) for t in lines if t["kind"] == "line"]
    if st.startswith("met"):
        word, tone = st, "good"
        because = f"{clock.when(goal['met_at'])} by {goal['met_by']}, {span(clock.hours(goal['met_at'], goal['due']) * 60)} early"
    elif st == "cannot judge yet":
        word, tone = "can't judge yet", "muted"
        because = "ruler v2 does not exist yet" + (f"; {len(waits)} asks on it are yours" if waits else "")
    elif st == "missed":
        word, tone, because = "missed", "bad", f"due {clock.when(goal['due'])}"
    elif "at risk" in line_paces:
        word, tone = "at risk", "warn"
        short = next(t for t in lines if t.get("pace", {}).get(b) == "at risk")
        because = (f"on time, but no idea bets on its last {dnum(short['target'] - short['current'])} "
                   f"{short['unit']}" + (f"; {', '.join(waits)} waits on you" if waits else ""))
    else:
        word, tone = "on track", "good"
        because = bu["fits"]
    est_end = bu["estimate_if_started_now"] if bu["steps"] else None
    if st.startswith("met"):
        estimate, gap = f"met {clock.when(goal['met_at'])}", f"{span(clock.hours(goal['met_at'], goal['due']) * 60)} early"
    elif st == "cannot judge yet":
        estimate = f"after your {len(waits)} answers, then {span(bu['buffered_minutes'])}" if waits else span(bu["buffered_minutes"])
        gap = f"≤ {span(bu['slack_hours'] * 60)} to spare, if you answer now"
    else:
        estimate = clock.when(est_end) + (f" + {len(waits)} wait on you" if waits else "") if est_end else "nothing sized"
        gap = f"{span(bu['slack_hours'] * 60)} to spare" if bu["slack_hours"] >= 0 else f"{span(-bu['slack_hours'] * 60)} late"
    hl = goal["hours_left"]
    time_left = f"{span(hl * 60)} left" if hl >= 0 else f"due {span(-hl * 60)} ago"
    holds_back = ", ".join(_short(c, objective) for c in holds) if holds else ("—" if not refused else "")
    if refused:
        holds_back = (holds_back + "; " if holds_back else "") + ", ".join(_short(c, objective) for c in refused) + ": not before ruler v2"
    return {
        "name": f"{goal['id']} · {goal['title']}", "state": word, "tone": tone, "because": because,
        "tier": goal["tier"], "want_by": clock.when(goal["due"]), "set_at": clock.when(goal["set"]),
        "estimate": estimate, "gap": gap, "time_left": time_left, "holds_back": holds_back or "—",
        "ticked": f"{goal['passed']} of {goal['total']}" + (f" · {len(refused)} can't judge" if refused else ""),
        "ideas_link": {"value": f"#ideas?goal={goal['id']}", "text": f"its {n_ideas} ideas →"},
        "waits": ", ".join(waits) or "—", "buffer": f"× {bu['buffer']:g}", "agent_minutes": span(bu["agent_minutes"]),
        "fits": bu["fits"], "caveat": bu.get("caveat"), "why": goal.get("why"), "path": goal.get("path"),
        "done_when": goal.get("done_when"), "owner": goal.get("owner"),
        "progress": check.get("says"), "progress_word": check.get("word"), "progress_tone": check.get("tone"),
        "estimate_says": (check.get("est_says") or {}).get(b),
    }


def _short(c: dict, objective: str) -> str:
    # WHY `objective` (the slice's objective name) where track.py names tool_track_rms_mm: an objective criterion has no
    # ref of its own; the box's objective is its name, which for trajectory_tracking_agent is that same id
    if c["kind"] == "objective":
        return f"{c.get('ref') or objective} {num(c.get('measured'))} vs {OP.get(c.get('op'), '')} {num(c.get('target'))}" \
            if c.get("measured") is not None else c["label"]
    if c["kind"] == "spec":
        return f"{c['key']} ({c.get('tests', 0)} tests)" if not c.get("refusal") else c["key"]
    return c["key"]


# ---- the fold's entry point ----------------------------------------------------------------------------------------

def enrich(goals: list[dict], ideas_rows: list[dict], as_of: str, counts: dict, objective: str) -> None:
    """Adds round 2's tracking to each goal of the slice, in place (additive: no existing key changes value)."""
    clock = Clock(as_of)
    ideas = {r.get("iid") or r["id"]: r for r in ideas_rows}
    for g in goals:
        steps = goal_steps(g, ideas)
        tracks = [line_track(line, g, clock) for line in g["lines"]]
        line_keys = {t["key"] for t in tracks}
        strips = [strip_track(c, g, clock, steps) for c in g["criteria"] if c["key"] not in line_keys]
        check = checklist_track(g, tracks, strips, steps, clock)
        lane = f"{g['id']} · {g['title']}"
        words = {b: goal_words(g, tracks, check, b, clock, counts.get(g["id"], 0), objective) for b in BUFFERS}
        timeline = {b: timeline_rows(g, ideas, b, clock, lane) for b in BUFFERS}
        for line, t in zip(g["lines"], tracks):
            # WHY not `estimate`: the slice's estimate is 02's readings; the drawings read them as [date, value, idea]
            line.update({k: v for k, v in t.items() if k != "estimate"})
        for c in g["criteria"]:
            tr = next((t for t in tracks if t["key"] == c["key"]), None) or next((s for s in strips if s["key"] == c["key"]), None)
            c["track"], c["track_kind"] = (tr["id"], tr["kind"]) if tr else (None, None)
        for b in BUFFERS:
            g["bottom_up"][b]["steps"] = steps[b]
        g["strips"], g["check"], g["words"], g["timeline"] = strips, check, words, timeline
