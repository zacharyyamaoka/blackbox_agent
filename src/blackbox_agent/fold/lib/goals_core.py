"""The one truth every Goals proposal draws: a goal (normalised, whatever file it came from) judged against a box's
state.json and ledger. Stdlib only. Each proposal's own reader turns its file format into GOAL dicts; this module says
whether each criterion holds, when the goal was met, and what the box's own history says about its pace.

    python3 goals_core.py            # judges _shared/goals.draft.json against the fixture, prints a summary

A GOAL (what a reader returns):

    {"id": "G2", "title": "Ready for the real arm", "set": "2026-11-24T21:30:00-07:00", "due": "2026-11-27T17:00:00-07:00",
     "why": "...", "owner": "Zach",
     "criteria": [
        {"kind": "gates"},                                            # every gate passes on every dev task (admissible)
        {"kind": "gate", "ref": "saturation_share_pct", "op": "<=", "value": 0.5},   # a gate, tightened (never loosened)
        {"kind": "objective", "op": "<=", "value": 0.030},            # the box's objective, on the same solution
        {"kind": "diagnostic", "ref": "energy_j", "op": "<=", "value": 2000},      # a reported diagnostic, same solution
        {"kind": "spec", "ref": "O1.1"},                              # a requirement verified by the box's tests (box-level)
        {"kind": "objective", "op": "<=", "value": 0.05, "ruler": "v2"},          # needs a ruler that does not exist yet
     ],
     "roadmap": ["I-025", "I-032", "I-033", "I-026"],                 # idea ids, in plan order
     "effort": {"I-025": 45, "I-032": 20, "I-033": 20},               # minutes of box time, bottom-up (optional)
    }

WHY one solution for every solution-level criterion: a goal is met by a solution that is good enough on all of them at
once, never by the objective of one and the gates of another. Box-level criteria (specs) are judged on the repo.
WHY a goal may tighten a gate but never loosen it: the ruler is frozen; a goal is a target on what the ruler already
measures, so a looser threshold would read as a pass the ruler itself refuses.
WHY holdout is refused as a criterion: OBJECTIVES.md §4 makes holdout reporting-only; a goal on it would make it a
second dev set.
"""

from __future__ import annotations

import json
import os
import statistics
import sys
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(HERE, "fixture")
# The round's fixed clock: every proposal is judged "as of" this moment, so pages and numbers agree across variants.
AS_OF = "2026-11-25T05:00:00-07:00"

OPS = {"<=": lambda a, b: a <= b, "<": lambda a, b: a < b, ">=": lambda a, b: a >= b, ">": lambda a, b: a > b,
       "==": lambda a, b: a == b}


def ts(text: str) -> datetime:
    return datetime.fromisoformat(text)


def load(fixture: str = FIXTURE) -> dict:
    with open(os.path.join(fixture, "state.json"), encoding="utf-8") as f:
        state = json.load(f)
    ledger = []
    with open(os.path.join(fixture, "ledger.jsonl"), encoding="utf-8") as f:
        for line in f:
            if line.strip():
                ledger.append(json.loads(line))
    with open(os.path.join(fixture, "ideas.json"), encoding="utf-8") as f:
        ideas = json.load(f)
    return {"state": state, "ledger": ledger, "ideas": ideas}


def solutions(box: dict) -> list[dict]:
    """The scored population (ablations left out, as everywhere), in scoring order, each with its dev diagnostics."""
    diag = {}
    for row in box["ledger"]:
        if row.get("split") == "dev":
            diag[row["solution"]] = row.get("diagnostics") or {}
    out = []
    for it in box["state"]["iterations"]:
        out.append({
            "id": it["id"], "n": it["n"], "t": it["created"], "objective": it["objective"],
            "admissible": bool(it["admissible"]),
            "gates": {k[2:]: v for k, v in it.items() if k.startswith("g_")},
            "diagnostics": diag.get(it["id"], {}),
            "commit": (it.get("commit") or {}).get("sha", "")[:7],
        })
    out.sort(key=lambda s: (s["t"], s["n"]))
    return out


def gate_ids(box: dict) -> list[str]:
    return [g["id"] for g in box["state"]["gates"]]


def _label(c: dict, box: dict) -> str:
    unit = box["state"]["objective"].get("unit", "")
    obj = box["state"]["objective"]["name"]
    k = c["kind"]
    if k == "gates":
        return "All gates pass on every dev task"
    if k == "gate":
        g = next((g for g in box["state"]["gates"] if g["id"] == c["ref"]), {})
        return f"{c['ref']} {c['op']} {c['value']} {g.get('unit') or ''}".strip() + " (tightened)"
    if k == "objective":
        return f"{obj} {c['op']} {c['value']} {unit}" + (" on ruler v2" if c.get("ruler") == "v2" else "")
    if k in ("diagnostic", "measurement"):
        return f"{c['ref']} {c['op']} {c['value']}"
    if k == "spec":
        req = next((r for r in box["state"]["spec"]["requirements"] if r["id"] == c["ref"]), {})
        return f"Spec {req.get('name') or c['ref']} verified"
    return str(c)


def _target(c: dict):
    """The goal's own threshold for a criterion (never the measured value written beside it)."""
    return c["target"] if "target" in c else c["value"]


def _sol_value(c: dict, s: dict):
    """(value, passed) of one solution-level criterion on one solution; value None = not recorded (fails closed)."""
    k = c["kind"]
    if k == "gates":
        return (1.0 if s["admissible"] else 0.0), s["admissible"]
    if k == "objective":
        v = s["objective"]
        return v, (v is not None and OPS[c["op"]](v, _target(c)))
    if k == "gate":
        # the ledger's diagnostics carry the gate's measure under the same name where the ruler reports it
        v = s["diagnostics"].get(c["ref"])
        ok = s["gates"].get(c["ref"]) == "pass" and v is not None and OPS[c["op"]](v, _target(c))
        return v, ok
    if k == "diagnostic":
        v = s["diagnostics"].get(c["ref"])
        return v, (v is not None and OPS[c["op"]](v, _target(c)))
    raise ValueError(k)


def _refusal(c: dict, box: dict) -> str | None:
    """Why a criterion cannot be judged at all (named, never filled in), else None."""
    if c.get("split") == "holdout":
        return "holdout is reporting-only (OBJECTIVES.md §4): a goal on it would make it a second dev set"
    if c.get("ruler") and c["ruler"] != box["state"]["objective"].get("ruler"):
        return f"ruler {c['ruler']} does not exist yet (OBJECTIVES.md §5 defers it); measurable once it is frozen"
    if c["kind"] == "gate":
        g = next((g for g in box["state"]["gates"] if g["id"] == c["ref"]), None)
        if g is None:
            return f"no gate named {c['ref']} in OBJECTIVES.md"
        loose = (g["op"] in ("<=", "<") and c["value"] > g["threshold"]) or (g["op"] in (">=", ">") and c["value"] < g["threshold"])
        if loose:
            return f"looser than the ruler's own {g['op']} {g['threshold']}: a goal may tighten a gate, never loosen it"
    if c["kind"] == "spec":
        req = next((r for r in box["state"]["spec"]["requirements"] if r["id"] == c["ref"]), None)
        if req is None:
            return f"no requirement {c['ref']} in specs/"
        if req.get("verb") == "deferred":
            return f"{c['ref']} is deferred to ruler v2 (specs/{c['ref']}): no test can verify it on ruler v1"
    return None


def _spec_state(c: dict, box: dict):
    req = next(r for r in box["state"]["spec"]["requirements"] if r["id"] == c["ref"])
    res = req.get("result")  # pass | fail | unverified
    return res, res == "pass", req


def evaluate(goal: dict, box: dict, as_of: str = AS_OF) -> dict:
    now = ts(as_of)
    sols = [s for s in solutions(box) if ts(s["t"]) <= now]
    crit = []
    for i, c in enumerate(goal["criteria"]):
        crit.append({**c, "i": i, "label": c.get("label") or _label(c, box), "refusal": _refusal(c, box),
                     "level": "box" if c["kind"] in ("spec", "measurement") else "solution"})
    sol_crit = [c for c in crit if c["level"] == "solution" and not c["refusal"]]
    benchmark = box.get("measurements", {})
    latest = max((sample for c in crit if c["kind"] == "measurement"
                  for sample in benchmark.get(c["ref"], {}).get("samples", []) if ts(sample["t"]) <= now),
                 key=lambda sample: ts(sample["t"]), default=None)

    # Per solution: how many solution-level criteria it meets. The candidate = most met, then best objective.
    scored = []
    for s in sols:
        vals = [_sol_value(c, s) for c in sol_crit]
        scored.append((s, vals, sum(1 for _, ok in vals if ok)))
    direction = box["state"]["objective"].get("direction", "lower")
    def key(x):
        s, _, met = x
        o = s["objective"] if s["objective"] is not None else float("inf")
        return (-met, o if direction.startswith("low") else -o)
    cand = sorted(scored, key=key)[0] if scored else None

    # The criteria now, on the candidate (solution-level) or the repo (box-level).
    # WHY `target` and `measured`: the goal's own threshold arrives as `value`, and the first version wrote the measured
    # value over it (lane 02 caught it, 2026-11-25). `target` keeps what the goal asks, `measured` what the box shows;
    # `value` stays the measured one so pages built against the first goals.json keep working.
    for c in crit:
        c["target"] = c.get("value")
        if c["refusal"]:
            c.update(state="cannot judge", value=None, measured=None, passed=None)
            continue
        if c["kind"] == "measurement":
            samples = benchmark.get(c["ref"], {}).get("samples", [])
            # WHY compare one benchmark revision: a good value from an old build cannot fill a missing result.
            last = max((s for s in samples if latest and s["ref"] == latest["ref"] and ts(s["t"]) <= now),
                       key=lambda s: ts(s["t"]), default=None)
            if last is None:
                c.update(refusal="No benchmark reading recorded yet", state="cannot judge", value=None, measured=None, passed=None)
            else:
                value = last["value"]
                passed = OPS[c["op"]](value, c["target"])
                c.update(state="pass" if passed else "fail", value=value, measured=value, passed=passed,
                         observed_at=last["t"], benchmark_revision=last["ref"])
            continue
        if c["level"] == "box":
            res, ok, req = _spec_state(c, box)
            c.update(state="pass" if ok else res, value=res, measured=res, passed=ok, tests=len(req.get("tests") or []))
            continue
        j = sol_crit.index(c)
        v, ok = cand[1][j]
        c.update(state="pass" if ok else "fail", value=v, measured=v, passed=ok, on=cand[0]["id"])

    # History: for each scored moment, the best any solution so far does on each criterion, and whether ONE
    # solution so far meets every solution-level criterion at once.
    history, met_at, met_by = [], None, None
    seen = []
    for s, vals, met in scored:
        seen.append((s, vals, met))
        best_met = max(m for _, _, m in seen)
        point = {"t": s["t"], "solution": s["id"], "met": best_met, "of": len(sol_crit)}
        for c in sol_crit:
            j = sol_crit.index(c)
            vs = [vv[j][0] for _, vv, _ in seen if vv[j][0] is not None]
            if vs:
                better_low = c.get("op", ">=") in ("<=", "<")
                point[f"c{c['i']}"] = min(vs) if better_low else max(vs)
        history.append(point)
        if met_at is None and sol_crit and met == len(sol_crit):
            met_at, met_by = s["t"], s["id"]

    box_ok = all(c["passed"] for c in crit if c["level"] == "box" and not c["refusal"])
    refused = [c for c in crit if c["refusal"]]
    all_now = all(c["passed"] for c in crit if not c["refusal"])
    due = ts(goal["due"])
    if refused:
        status = "cannot judge yet"
    elif all_now and box_ok:
        # met when the last box-level criterion and the solution-level ones all held; box-level history is the repo's
        measured_at = [c["observed_at"] for c in crit if c.get("observed_at")]
        if measured_at:
            met_at = max([*measured_at, *([met_at] if met_at else [])], key=ts)
            met_by = met_by or latest["ref"]
        status = "met" if (met_at is None or ts(met_at) <= due) else "met late"
    elif now > due:
        status = "missed"
    else:
        status = "open"
    passed = sum(1 for c in crit if c.get("passed"))
    judged = sum(1 for c in crit if not c["refusal"])
    return {
        "id": goal["id"], "title": goal["title"], "set": goal["set"], "due": goal["due"], "as_of": as_of,
        "why": goal.get("why", ""), "owner": goal.get("owner", ""),
        "status": status, "met_at": met_at if status.startswith("met") else None, "met_by": met_by if status.startswith("met") else None,
        "hours_left": round((due - now).total_seconds() / 3600, 1),
        "passed": passed, "judged": judged, "total": len(crit),
        "candidate": cand[0]["id"] if cand else None,
        "criteria": crit, "history": history,
        "roadmap": goal.get("roadmap", []), "effort": goal.get("effort", {}),
    }


def box_pace(box: dict, as_of: str = AS_OF) -> dict:
    """What the box's own history says about its pace: the bottom-up estimate's prior. Every number from the files."""
    sols = [s for s in solutions(box) if ts(s["t"]) <= ts(as_of)]
    agent = [s for s in sols if ts(s["t"]) >= ts("2026-11-24T00:00:00-07:00")]   # the agent's own search (gen 1+)
    gaps = [(ts(b["t"]) - ts(a["t"])).total_seconds() / 60 for a, b in zip(agent, agent[1:])]
    ideas = box["ideas"]["ideas"]
    tried = [i for i in ideas if i["lane"] == "agent" and i["checked"] and i["status"] != "removed"]
    bests = [i for i in tried if i["status"] == "new-best"]
    last_move = max((s["t"] for s in sols if s["objective"] is not None), default=None)
    return {
        "agent_solutions": len(agent),
        "minutes_per_solution_median": round(statistics.median(gaps), 1) if gaps else None,
        "minutes_per_solution_p90": round(sorted(gaps)[int(0.9 * (len(gaps) - 1))], 1) if gaps else None,
        "tried": len(tried), "new_bests": len(bests),
        "hit_rate": round(len(bests) / len(tried), 3) if tried else None,
        "last_scored": last_move,
        "idle_hours": round((ts(as_of) - ts(last_move)).total_seconds() / 3600, 1) if last_move else None,
        "from": "iterations[].created (state.json @ 924f5fc) and ideas.md statuses (ideas_model)",
    }


# WHY 2x: Zach, BAM plan note (Nov 23, L2199-2200): bottom-up estimates "habitually never include all the things", so
# a 2x buffer. Every proposal states the buffer beside its estimate and lets the reader switch it off.
BUFFER = 2.0


def bottom_up(goal: dict, box: dict, as_of: str = AS_OF, buffer: float = BUFFER) -> dict:
    """The estimate rolled up from the goal's roadmap: the agent's open ideas' minutes (× buffer) from now, the ideas
    with no estimate named, and Zach's open ideas named as waits (never given a duration: nobody can estimate him)."""
    ideas = {i["id"]: i for i in box["ideas"]["ideas"]}
    effort = goal.get("effort", {})
    steps, t = [], ts(as_of)
    agent_min = 0
    unestimated, waits, done = [], [], []
    for iid in goal.get("roadmap", []):
        i = ideas.get(iid)
        if i is None:
            unestimated.append({"id": iid, "why": "no such idea in ideas.md"})
            continue
        is_open = not i["checked"] and i["status"] not in ("removed",)
        row = {"id": iid, "title": i["title"], "lane": i["lane"], "open": is_open, "status": i["status"]}
        if not is_open:
            done.append(row)
            continue
        if i["lane"] == "human":
            waits.append(row)
            continue
        m = effort.get(iid)
        if m is None:
            unestimated.append({**row, "why": "no effort written for it"})
            continue
        agent_min += m
        start = t
        t = t + timedelta(minutes=m * buffer)
        # WHY after_waits: in plan order a step behind one of Zach's waits cannot honestly be dated (lane 02 caught
        # G3's I-021 "done by 07:00" behind four of his decisions). Its start/end stay as if he answered now, so pages
        # built on the first goals.json keep drawing; `dated: false` says they are conditional on him.
        behind = [w["id"] for w in waits]
        steps.append({**row, "minutes": m, "buffered": m * buffer, "start": start.isoformat(), "end": t.isoformat(),
                      "after_waits": behind, "dated": not behind})
    due = ts(goal["due"])
    # WHY a word, not a bool: a wait on Zach has no duration, so "fits" can only ever be conditional on him.
    if not steps and not waits and not unestimated:
        # WHY: a roadmap with nothing open has no estimate to fit (G1 read "does not fit" though it was met; lane 01)
        fits = "nothing left on the roadmap"
    elif t > due:
        fits = "does not fit"
    elif unestimated:
        fits = "unknown: " + ", ".join(u["id"] for u in unestimated) + " not estimated"
    elif waits:
        fits = "fits if Zach answers " + ", ".join(w["id"] for w in waits)
        undated = sum(st["buffered"] for st in steps if not st["dated"])
        if undated:
            fits += f", then {undated:g} min more"
    else:
        fits = "fits"
    return {
        "buffer": buffer, "agent_minutes": agent_min, "buffered_minutes": agent_min * buffer,
        "estimate_if_started_now": t.isoformat(), "fits": fits,
        "slack_hours": round((due - t).total_seconds() / 3600, 1),
        "steps": steps, "unestimated": unestimated, "waits_on_zach": waits, "done": done,
        "caveat": ("the box has scored nothing for {h} h; the estimate assumes it starts now".format(
            h=box_pace(box, as_of)["idle_hours"])),
    }


def idea_rows(box: dict) -> list[dict]:
    """The idea queue as rows (the same fields the viewer's ideas slice reads), keyed by I-0xx."""
    return box["ideas"]["ideas"]


def main() -> None:
    box = load()
    with open(os.path.join(HERE, "goals.draft.json"), encoding="utf-8") as f:
        goals = json.load(f)["goals"]
    print(json.dumps(box_pace(box), indent=1))
    for g in goals:
        r = evaluate(g, box)
        print(f"\n{r['id']} {r['title']}: {r['status']} · {r['passed']}/{r['judged']} judged ({r['total']} total) · "
              f"{r['hours_left']} h left · candidate {r['candidate']} · met_at {r['met_at']}")
        for c in r["criteria"]:
            print(f"   {c['state']:>14}  {c['label']}  value={c.get('value')}  {c.get('refusal') or ''}")
        b = bottom_up(g, box)
        print(f"   bottom-up: {b['agent_minutes']} min × {b['buffer']} → {b['estimate_if_started_now']} · fits {b['fits']}"
              f" · slack {b['slack_hours']} h · waits on Zach {[w['id'] for w in b['waits_on_zach']]}"
              f" · unestimated {[u['id'] for u in b['unestimated']]} · done {len(b['done'])}")


if __name__ == "__main__":
    sys.exit(main())
