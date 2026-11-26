"""The `goals` slice (viewer/CONTRACT.md §20; PICKS.md "Goals (2026-11-25)"): a box's dated goals judged against its
own ledger and tests at the ref, each with its roadmap from ideas.md and the bottom-up estimate beside the desired date.

    def fold(facts) -> dict | None      (tools/fold_state.py runs it after spec and ideas: AFTER)

Absent when the box has no goals/*.md (never an empty tab that lies), so every other box folds byte for byte as before.
Zach, 2026-11-25: "a goal is just like a bundle of spec/gates that must be passed and specific values we want to meet on
objectives. and they have a date/time of completion. For each goal then we need an associated roadmap… and then within
the idea queue you can filter to just show like the ideas associated with meeting a particular goal." Daily note: "Each
goal gets a plan. With the path to completion we have the desired and then the estimated one with bottom up planning….
Then we can track if goal met or not."

The judge is proposals-goals' own, imported read-only (one rule, one meaning): goals_core.evaluate (ONE solution meets
every solution-level criterion; specs on the repo's tests; a goal may tighten a gate, never loosen; holdout refused; a
ruler not frozen yet is "cannot judge yet" with the reason) and goals_core.bottom_up (open agent ideas' `- Effort:`
minutes × 2 from now; Zach's ideas named as waits, never sized; a step behind a wait `dated: false`). The file format
is tools/folds/_goals_format.py. What this fold adds on top, each from a proposal of the round:

- `lines` (02 Two lines): per measurable criterion, the real readings (the goal's candidate at each scored moment since
  it was set), the target reading, and the estimate as readings of `kind: estimate`, one step per agent idea of the
  roadmap moved only by the idea's own `- Expect:` bet on that line, for buffer ×2 and ×1; the pace word per buffer.
- `aimed_by` / `finding` (04 Gate ladder): which roadmap ideas name a criterion (`- Goal: G2 · O1.1`), and "no idea aims
  at this" under a criterion not met that nothing aims at, with the line to write.
- `odds` (03 Odds): the inputs of its seeded Monte Carlo (the box's own hit rate and pace spread), which the page runs.
- `kpis` gains the goal hit rate by tier (01 Destination), and each `ideas` row `goal`, `step`, `effort`, `goal_expect`,
  `aims`, `plan` (only when the box has goals/, so no other state changes).

The clock: `facts["as_of"]` (a fixture's), else the ref's commit time, so a re-fold is byte-identical; the page says
"as of" it. Never invents a number: an estimate behind Zach's waits says so; a criterion that cannot be judged says why.
"""

from __future__ import annotations

import json
import math
import re
import statistics
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _goals_format as fmt  # noqa: E402
import _goals_track as track  # noqa: E402

AFTER = ("spec", "ideas")
BUFFERS = {"x2": 2.0, "x1": 1.0}
SEED, DRAWS, CAP = 20261125, 10000, 10      # 03 Odds' Monte Carlo (seed, draws, retries per idea at most)
Z90 = 1.2815515655446004                     # the standard normal's 90th percentile


def ts(t: str) -> datetime:
    return datetime.fromisoformat(t)


def core_box(state: dict, ledger: list[dict], ideas: list[dict]) -> dict:
    """The box goals_core reads ({state, ledger, ideas}), from the folded slices."""
    reqs = []
    for r in (state.get("spec") or {}).get("requirements") or []:
        n = r.get("tests")
        # WHY a list: goals_core counts a requirement's tests with len(); the spec slice holds the count
        reqs.append({**r, "tests": list(range(n)) if isinstance(n, int) else (n or [])})
    # WHY only rows with a creation time: goals_core orders solutions by it (a box's every iteration has one today)
    its = [i for i in state.get("iterations") or [] if i.get("created")]
    model_ideas = [{"id": i.get("iid") or i["id"], "lane": i["lane"], "checked": not i["open"], "title": i["title"],
                    "status": "new-best" if i.get("outcome") == "new best" else (i.get("outcome") or ("open" if i["open"] else "done"))}
                   for i in ideas]
    return {"state": {"objective": state["objective"], "gates": state.get("gates") or [], "iterations": its,
                      "spec": {"requirements": reqs}}, "ledger": ledger, "ideas": {"ideas": model_ideas}}


def box_pace(box: dict, state: dict, as_of: str, core) -> dict:
    """goals_core.box_pace with one change: the agent's own search is the iterations of generation 1 and later (the
    population it was seeded with is generation 0). WHY: goals_core names that moment by date for the one box it was
    written for (2026-11-24T00:00); a generation is what every box's fold already reads (iterations[].gen)."""
    gen = {i["id"]: i.get("gen") or 0 for i in state.get("iterations") or []}
    sols = [s for s in core.solutions(box) if ts(s["t"]) <= ts(as_of)]
    agent = [s for s in sols if gen.get(s["id"], 0) >= 1]
    gaps = [(ts(b["t"]) - ts(a["t"])).total_seconds() / 60 for a, b in zip(agent, agent[1:])]
    ideas = box["ideas"]["ideas"]
    tried = [i for i in ideas if i["lane"] == "agent" and i["checked"] and i["status"] != "removed"]
    bests = [i for i in tried if i["status"] == "new-best"]
    last = max((s["t"] for s in sols if s["objective"] is not None), default=None)
    return {
        "agent_solutions": len(agent),
        "minutes_per_solution_median": round(statistics.median(gaps), 1) if gaps else None,
        "minutes_per_solution_p90": round(sorted(gaps)[int(0.9 * (len(gaps) - 1))], 1) if gaps else None,
        "tried": len(tried), "new_bests": len(bests),
        "hit_rate": round(len(bests) / len(tried), 3) if tried else None,
        "last_scored": last,
        "idle_hours": round((ts(as_of) - ts(last)).total_seconds() / 3600, 1) if last else None,
        "from": "iterations[].created of generation 1 and later, and ideas.md's crossed-off agent ideas (new best or not)",
    }


# ── 02 Two lines: the real, desired and estimated lines of one measurable criterion ──────────────────────────────

def _met(core, op: str, v, target) -> bool:
    return v is not None and core.OPS[op](v, target)


def _estimate(goal: dict, box: dict, links: dict, ref: str, start_t: str, start_v, buffer: float, retro: bool,
              as_of: str, core) -> dict:
    """02's estimate(): from (start_t, start_v), one step per agent idea of the roadmap, ending where bottom_up says and
    moved only by the idea's own bet on THIS line (no bet: flat). retro (a goal already met): as it stood when set."""
    if retro:
        steps, t = [], ts(goal["set"])
        for iid in goal["roadmap"]:
            m = goal["effort"].get(iid)
            if m is None:
                continue
            s = t
            t = t + timedelta(minutes=m * buffer)
            steps.append({"id": iid, "minutes": m, "buffered": m * buffer, "start": s.isoformat(), "end": t.isoformat(), "dated": True})
        bu = {"steps": steps, "waits_on_zach": [], "unestimated": [], "estimate_if_started_now": t.isoformat()}
    else:
        bu = core.bottom_up(goal, box, as_of, buffer)
    v = start_v
    out = [{"date": start_t, "value": v, "kind": "estimate", "label": "set" if retro else "now"}]
    for s in bu["steps"]:
        bet = (links.get(s["id"]) or {}).get("expect")
        lo = hi = None
        if bet and bet["kind"] == "pct" and bet["ref"] == ref and v is not None:
            lo, hi = v * (1 + bet["lo"] / 100), v * (1 + bet["hi"] / 100)
            v = (lo + hi) / 2
            said = f"bets {bet['text']}"
        elif bet and bet["kind"] == "spec":
            said = f"bets {bet['text']} (moves the checklist, not this line)"
        elif bet:
            said = f"bets {bet['text']} (another line)"
        else:
            said = "no number bet"
        out.append({"date": s["end"], "value": v, "kind": "estimate", "idea": s["id"], "start": s["start"],
                    "minutes": s["minutes"], "buffered": s["buffered"], "lo": lo, "hi": hi, "bet": said,
                    "dated": s.get("dated", True)})
    return {"readings": out, "end": bu["estimate_if_started_now"], "value": v}


def schedule(goal: dict, box: dict, links: dict, buffer: float, retro: bool, as_of: str, core, bys: dict | None = None) -> list[dict]:
    """Round 3's Planned line, its steps (CONTRACT §27): every idea on the goal's roadmap with a committed `- By:` lands
    at that time (`by: true`); every other open agent idea lands where bottom-up puts it, Effort × buffer from now (from
    set on a goal already met), drawn hollow (`by: false`). An idea done without a By had no planned date: left out.
    Time order. `bys` overrides the ideas' By (the plan as it stood when the goal was set)."""
    bys = {iid: (links.get(iid) or {}).get("by") for iid in goal["roadmap"]} if bys is None else bys
    if retro:
        fallback, t = {}, ts(goal["set"])
        for iid in goal["roadmap"]:
            m = goal["effort"].get(iid)
            if m is None:
                continue
            s = t
            t = t + timedelta(minutes=m * buffer)
            fallback[iid] = {"start": s.isoformat(), "end": t.isoformat(), "dated": True}
    else:
        fallback = {st["id"]: st for st in core.bottom_up(goal, box, as_of, buffer)["steps"]}
    ideas = {i["id"]: i for i in box["ideas"]["ideas"]}
    out = []
    for iid in goal["roadmap"]:
        i = ideas.get(iid) or {}
        if i.get("lane") == "human":
            continue
        if bys.get(iid):
            out.append({"id": iid, "at": bys[iid], "by": True})
        elif iid in fallback:
            out.append({"id": iid, "at": fallback[iid]["end"], "by": False})
    out.sort(key=lambda st: ts(st["at"]))
    return out


def planned_line(steps: list[dict], links: dict, ref: str, start_t: str, v0) -> list[dict]:
    """[{date, value, idea?, by?, bet?}]: from where it stood at set, one step per scheduled idea, moved only by the
    idea's own `- Expect:` bet on THIS line (02's rule; no bet: flat)."""
    if v0 is None:
        return []
    v = v0
    out = [{"date": start_t, "value": v, "label": "set"}]
    for st in steps:
        bet = (links.get(st["id"]) or {}).get("expect")
        if bet and bet["kind"] == "pct" and bet["ref"] == ref:
            v = v * (1 + (bet["lo"] + bet["hi"]) / 200)
        out.append({"date": st["at"], "value": v, "idea": st["id"], "by": st["by"], "bet": (bet or {}).get("text")})
    return out


def lines_of(goal: dict, ev: dict, box: dict, links: dict, ids: dict, as_of: str, core, history: dict | None = None) -> list[dict]:
    is_met = ev["status"].startswith("met")
    times = [goal["set"]] + [h["t"] for h in ev["history"] if ts(goal["set"]) < ts(h["t"]) <= ts(as_of)]
    out = []
    for c in ev["criteria"]:
        if c["kind"] not in ("objective", "gate", "diagnostic", "measurement"):
            continue
        ref = ids["objective"] if c["kind"] == "objective" else c["ref"]
        unit = ids["unit"] if c["kind"] == "objective" else ((ids["gate_rows"].get(c["ref"]) or {}).get("unit") or fmt_unit(c["ref"]))
        key = fmt.key_of(c, ids)
        line = {"id": f"{goal['id']}-{key}{'-' + c['ruler'] if c.get('ruler') else ''}", "goal": goal["id"], "key": key, "ref": ref,
                "label": c["label"], "unit": unit, "op": c["op"], "target": c["target"], "set": goal["set"], "due": goal["due"]}
        if c["refusal"]:
            line.update(refusal=c["refusal"], readings=[], estimate={"x2": [], "x1": []}, pace={"x2": "cannot judge yet", "x1": "cannot judge yet"},
                        current=None, candidate=None, passes=None, gap=None, gap_pct=None, retro=False,
                        planned={"x2": [], "x1": []}, planned_set=None)   # round 3: nothing measured, no Planned line yet
            out.append(line)
            continue
        real = []
        if c["kind"] == "measurement":
            real = [{"date": sample["t"], "value": sample["value"], "kind": "real", "benchmark_revision": sample["ref"], "unit": unit}
                    for sample in box["measurements"][ref]["samples"] if ts(sample["t"]) <= ts(as_of)]
        else:
            for t in times:  # the goal's candidate at each moment: ONE solution, as the goal is judged (02)
                e = core.evaluate(goal, box, t)
                cc = e["criteria"][c["i"]]
                real.append({"date": t, "value": cc.get("measured"), "kind": "real", "solution": cc.get("on"), "unit": unit})
        real = [r for r in real if r["value"] is not None]
        cur = c["measured"]
        passes = _met(core, c["op"], cur, c["target"])
        est, words = {}, {}
        for tag, b in BUFFERS.items():
            start_t = goal["set"] if is_met else as_of
            start_v = (real[0]["value"] if real else cur) if is_met else cur
            e = _estimate(goal, box, links, ref, start_t, start_v, b, is_met, as_of, core)
            est[tag] = e
            if is_met:
                w = "met"
            elif ts(as_of) > ts(goal["due"]):
                w = "missed"
            elif passes:
                w = "passes now"
            elif _met(core, c["op"], e["value"], c["target"]) and ts(e["end"]) <= ts(goal["due"]):
                w = "on track"
            else:
                w = "at risk"
            words[tag] = w
        gap = None if passes or cur is None else c["target"] - cur
        # round 3 (CONTRACT §27): Linear (Grove's straight line, _goals_track's `plan`), Planned (from the ideas' By and
        # Expect, from set) and Planned as it stood when the goal was set (ideas.md at that commit), per buffer
        v0 = real[0]["value"] if real else cur
        planned = {tag: planned_line(schedule(goal, box, links, b, is_met, as_of, core), links, ref, goal["set"], v0)
                   for tag, b in BUFFERS.items()}
        planned_set = None
        if history:
            planned_set = planned_line(schedule(history["goal"], box, history["links"], BUFFERS["x2"], True, as_of, core,
                                                bys={iid: (history["links"].get(iid) or {}).get("by") for iid in history["goal"]["roadmap"]}),
                                       history["links"], ref, goal["set"], v0)
        line["planned"] = planned
        line["planned_set"] = planned_set
        line.update(refusal=None, readings=real + [{"date": goal["due"], "value": c["target"], "kind": "target", "unit": unit}],
                    estimate={t: e["readings"] for t, e in est.items()}, estimate_end={t: e["end"] for t, e in est.items()},
                    estimate_value={t: e["value"] for t, e in est.items()}, pace=words, current=cur, candidate=c.get("on"),
                    passes=passes, gap=gap, gap_pct=None if gap is None or not cur else round(100 * gap / cur, 1), retro=is_met)
        out.append(line)
    return out


def fmt_unit(ref: str) -> str:
    for suffix, unit in (("_mm", "mm"), ("_pct", "%"), ("_ms", "ms"), ("_deg", "°"), ("_s", "s"), ("_j", "J")):
        if ref.endswith(suffix):
            return unit
    return ""


def plan_at_set(t, goal: dict, rows: list[dict], ids: dict, box: dict) -> dict | None:
    """The goal's roadmap as ideas.md stood when the goal was set (the newest commit at or before `set` that touched
    ideas.md), read with the same reader: {goal (its roadmap and effort then), links}. WHY: the Planned line is computed
    from the ideas as committed; drawing the plan as it stood at set beside it makes a moved goalpost visible (Zach,
    2026-11-25: "to avoid agents gaming it"). An idea of then is matched to today's by its title; None when the history
    cannot be read (a fixture overlay, a shallow clone)."""
    try:
        sha = t.git("log", "-1", f"--before={goal['set']}", "--format=%H", t.sha, "--", "ideas.md").strip()
        if not sha:
            return None
        text = t.git("show", f"{sha}:ideas.md")
    except Exception:  # noqa: BLE001 - no history is "not shown", never a failed fold
        return None
    parse = fmt._module("ideas_parse", fmt.IDEAS / "ideas_parse.py").parse
    by_title = {r.get("title"): (r.get("iid") or r["id"]) for r in rows}
    then = []
    for idea in parse(text).ideas:
        then.append({"line": idea.line_no, "iid": by_title.get(idea.title) or f"then-{idea.index + 1}", "lane": idea.lane,
                     "title": idea.title})
    g = {**goal, "roadmap": [], "effort": {}}
    links = fmt.read_links(text, then, [g], ids, box)["ideas"]
    return {"goal": g, "links": links, "commit": sha[:7]}


# ── 03 Odds: the Monte Carlo's inputs (the page runs it; tests/goals.test.mjs holds JS == 03's Python) ───────────

def odds_model(goal: dict, ev: dict, box: dict, pace: dict, as_of: str) -> dict | None:
    if ev["status"] != "open" or not pace.get("hit_rate") or not pace.get("minutes_per_solution_median"):
        return None
    ideas = {i["id"]: i for i in box["ideas"]["ideas"]}
    steps, waits, unsized = [], [], []
    for iid in goal["roadmap"]:
        i = ideas.get(iid)
        if i is None:
            unsized.append(iid)
            continue
        if i["checked"] or i["status"] == "removed":
            continue
        if i["lane"] == "human":
            steps.append({"id": iid, "kind": "wait"})
            waits.append(iid)
        elif iid in goal["effort"]:
            steps.append({"id": iid, "kind": "agent", "min": goal["effort"][iid]})
        else:
            unsized.append(iid)
    if unsized or not any(s["kind"] == "agent" for s in steps):
        return None
    now = ts(as_of)
    # WHY the next 09:00 at least an hour away: 03's default slot (Wed 09:00 at 05:00), a working morning, never "now"
    nine = now.replace(hour=9, minute=0, second=0, microsecond=0)
    if nine < now + timedelta(hours=1):
        nine += timedelta(days=1)
    efforts = list(goal["effort"].values())
    p90, med = pace["minutes_per_solution_p90"], pace["minutes_per_solution_median"]
    return {"seed": SEED, "n": DRAWS, "cap": CAP, "hit": pace["hit_rate"], "hit_text": f"{pace['new_bests']} of {pace['tried']}",
            "sigma": math.log(p90 / med) / Z90 if p90 and med else 0.0,
            "sigma_text": f"p90/median {p90}/{med} min per solution",
            "retry": statistics.median(efforts) if efforts else None, "buffer": 2.0, "start": 0.0,
            "due": (ts(goal["due"]) - now).total_seconds() / 60, "set": (ts(goal["set"]) - now).total_seconds() / 60,
            "steps": steps, "waits": waits, "slots": {w: (nine - now).total_seconds() / 60 for w in waits}, "origin": as_of}


# ── 01 Destination: the goal hit rate by tier, on the Overview ───────────────────────────────────────────────────

def hit_kpis(goals: list[dict]) -> list[dict]:
    out = []
    for tier, label in (("must", "Must-meet goals hit"), ("stretch", "Stretch goals hit")):
        mine = [g for g in goals if g["tier"] == tier]
        if not mine:
            continue
        settled = [g for g in mine if g["status"] in ("met", "met late", "missed")]
        hit = [g for g in settled if g["status"] == "met"]
        rest = ", ".join(f"{g['id']} {g['status']}" for g in mine if g not in settled)
        k = {"id": f"goal_hit_{tier}", "label": label, "value": round(100 * len(hit) / len(settled)) if settled else None,
             "unit": f"% · {len(hit)} of {len(settled)} settled" if settled else "", "decimals": 0, "better": "higher", "spark": [],
             "from": "hit = met by its date ÷ settled (met or missed), goals/*.md judged by goals_core" + (f"; {rest}" if rest else ""),
             "delta": rest or None, "tone": "neutral", "source": "goals/*.md"}
        if not settled:
            k["why"] = f"none settled yet ({rest})"
        out.append(k)
    return out


# ── the fold ──────────────────────────────────────────────────────────────────────────────────────────────────────

def read_measurements(raw: str) -> dict:
    if not raw:
        return {}
    doc = json.loads(raw)
    if doc.get("schema") != "bb-goal-metrics/1" or not isinstance(doc.get("metrics"), dict):
        raise ValueError("expected bb-goal-metrics/1 with a metrics object")
    for name, series in doc["metrics"].items():
        if not re.fullmatch(r"[a-z][a-z0-9_]*", name) or not isinstance(series, dict) or not isinstance(series.get("samples"), list):
            raise ValueError(f"invalid measurement series {name!r}")
        times = set()
        for sample in series["samples"]:
            if (not isinstance(sample, dict) or not isinstance(sample.get("t"), str) or
                    type(sample.get("value")) not in (float, int) or not math.isfinite(sample["value"]) or
                    not isinstance(sample.get("ref"), str) or not sample["ref"]):
                raise ValueError(f"{name} needs timestamp, finite value and revision for every sample")
            when = ts(sample["t"])
            if when.tzinfo is None or when in times:
                raise ValueError(f"{name} needs distinct timestamps with offsets")
            times.add(when)
    return doc["metrics"]


def fold(facts: dict) -> dict | None:
    t, state = facts["tree"], facts["state"]
    paths = [p for p in t.files if re.fullmatch(r"goals/[^/]+\.md", p) and p.lower() != "goals/readme.md"]
    if not paths or "objective" not in state:
        return None
    as_of = facts.get("as_of") or state["read_at"]
    core = fmt.lanes().core
    rows = state.get("ideas") or []
    box = core_box(state, facts.get("ledger") or [], rows)
    metric_path = "goals/metrics.json"
    metric_problem = []
    try:
        box["measurements"] = read_measurements(t.text(metric_path) if metric_path in t.fileset else "")
    except (ValueError, TypeError, AttributeError) as exc:
        box["measurements"] = {}
        metric_problem = [fmt.problem("goal-metrics", metric_path, str(exc), "record measured samples with a time, value and revision")]
    ids = fmt.box_ids(state, facts.get("ledger") or [], box["measurements"])
    read = fmt.read_notes({p: t.text(p) or "" for p in paths}, ids)
    goals, problems = read["goals"], metric_problem + read["problems"]
    ideas_text = t.text("ideas.md") if "ideas.md" in t.fileset else ""
    linked = fmt.read_links(ideas_text or "", rows, goals, ids, box)
    links, problems = linked["ideas"], problems + linked["problems"]
    pace = box_pace(box, state, as_of, core)
    by_iid = {i["id"]: i for i in box["ideas"]["ideas"]}

    out = []
    for g in goals:
        ev = core.evaluate(g, box, as_of)
        bus = {tag: core.bottom_up(g, box, as_of, b) for tag, b in BUFFERS.items()}
        for bu in bus.values():
            for st in bu["steps"]:
                if (links.get(st["id"]) or {}).get("by"):
                    st["by"] = links[st["id"]]["by"]   # additive: only a step whose idea commits a By carries it
        is_met = ev["status"].startswith("met")
        planned_steps = {tag: [{**st, "bet": (links.get(st["id"]) or {}).get("expect_text")}
                               for st in schedule(g, box, links, b, is_met, as_of, core)] for tag, b in BUFFERS.items()}
        plan = {iid: n for n, iid in enumerate(g["roadmap"], 1)}
        roadmap = []
        for iid in g["roadmap"]:
            i, ln = by_iid.get(iid) or {}, links.get(iid) or {}
            roadmap.append({"id": iid, "step": plan[iid], "written_step": (ln.get("steps") or {}).get(g["id"]), "title": i.get("title"),
                            **({"by": ln["by"], "by_text": ln["by_text"]} if ln.get("by") else {}),
                            "lane": i.get("lane"), "open": not i.get("checked", True), "status": i.get("status"),
                            "effort": g["effort"].get(iid), "aims": (ln.get("aims") or {}).get(g["id"]),
                            "expect": ln.get("expect"), "expect_text": ln.get("expect_text")})
        crit = []
        for c, key, line in zip(ev["criteria"], g["keys"], g["done_when"]):
            aimed = [r["id"] for r in roadmap if r["aims"] == key]
            open_aimed = [r["id"] for r in roadmap if r["aims"] == key and r["open"]]
            finding = fix = None
            if not c["passed"] and not aimed:
                finding = "no idea aims at this"
                fix = f"add '- Goal: {g['id']} · {key}' under an idea in ideas.md that would build what it needs"
            elif not c["passed"] and not open_aimed:
                finding = "every idea aimed here was tried"
                fix = f"queue another idea with '- Goal: {g['id']} · {key}' under it"
            crit.append({**{k: v for k, v in c.items() if k != "value"}, "key": key, "line": line,
                         "aimed_by": aimed, "finding": finding, "fix": fix})
        goal = {"id": g["id"], "title": g["title"], "tier": g["tier"], "owner": g["owner"], "set": g["set"], "due": g["due"],
                "why": g["why"], "path": g["path"], "done_when": g["done_when"],
                **{k: ev[k] for k in ("status", "met_at", "met_by", "hours_left", "passed", "judged", "total", "candidate", "history")},
                "criteria": crit, "roadmap": roadmap, "effort": g["effort"], "bottom_up": bus,
                "planned_steps": planned_steps,
                "lines": lines_of(g, ev, box, links, ids, as_of, core, plan_at_set(t, g, rows, ids, box)),
                "odds": odds_model(g, ev, box, pace, as_of)}
        out.append(goal)

    # the ideas rows gain the goal fields (only here: a box with no goals/ never reaches this line)
    order = {g["id"]: {iid: n for n, iid in enumerate(g["roadmap"], 1)} for g in goals}
    for r in rows:
        iid = r.get("iid") or r["id"]
        ln = links.get(iid) or {}
        gs = [gid for gid in ln.get("goals", []) if gid in order]
        r["goal"] = gs
        r["step"] = order[gs[0]][iid] if gs else None
        r["effort"] = ln.get("effort")
        r["goal_expect"] = ln.get("expect_text")
        r["aims"] = (ln.get("aims") or {}).get(gs[0]) if gs else None
        r["plan"] = "; ".join(f"{gid} · step {order[gid][iid]} of {len(order[gid])}" for gid in gs) or "no goal"
    state["kpis"] = (state.get("kpis") or []) + hit_kpis(out)
    obj = state["objective"]
    counts = {**{g["id"]: sum(1 for r in rows if g["id"] in r["goal"]) for g in goals}, "none": sum(1 for r in rows if not r["goal"])}
    # round 2's tracking (CONTRACT §25): last, once the ideas rows carry their goal fields (a step's bet is its idea's)
    track.enrich(out, rows, as_of, counts, obj.get("name") or "the objective")
    return {"schema": "bb-goals/1", "from": "goals/*.md + ideas.md (- Goal: / - Effort: / - Expect:)", "as_of": as_of,
            "clock": "fixture" if facts.get("as_of") else "the ref's commit time", "buffer": core.BUFFER,
            "objective": {"name": obj.get("name"), "unit": obj.get("unit"), "direction": obj.get("direction"), "ruler": obj.get("ruler")},
            "pace": pace, "goals": out, "problems": problems, "counts": counts}
