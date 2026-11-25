"""The `simreal` slice (viewer/CONTRACT.md §21): a box's simulated results beside its real ones, for the stock Sim × Real
workspace (`<bb-simreal>`, the box's site at simreal/).

Zach, 2026-11-25: "Real is what matters at the end of the day, but often its the simulated things we get performance on
first." ... "Lets have a Sim X Real Tab basically then we add as a workspace ... This is good as it keeps the blackbox
dashboard simpler". So the slice is read beside the Black box slices and changes none of them.

The ledger contract (accepted 2026-11-25, additive; the first box to write it is sppm_agent):
- a row may carry `world: "real" | "sim"`; a row without it is real. A sim row carries `sim: {name, rung, profile}`, and
  a box may run several simulators;
- real rows keep `split: "dev"` (and "holdout"), sim rows use `split: "sim"` (a sim hold-out is `"sim-holdout"`), so the
  fold's ranks() ranks real rows only, with no change;
- `pair`: one key shared by a sim row and the real row it predicts (same solution, same task or cell);
- the same metric ids in both worlds; OBJECTIVES.md may name the objective's world (`world: real`).

What the slice holds, all read from the ledger and never invented:
- `rows`: the real rows the Black box dashboard ranks (one per iteration: the newest ranking row on the current ruler,
  the fold's own rule) and every sim row on that ruler (the newest per pair, simulator and split), each with its
  objective, its numeric metrics, and `at`: the time its result describes, the first of `source.started_at` (a run's
  start), `window.end` (the end of the window a real row measured) and `t` (when it was scored), named in `at_from`;
- `pairs`: one per pair key, its real row (or none yet), its sim rows, and real ÷ sim per simulator (null with a why when
  either side has no number, or sim scored 0);
- `metrics`: every metric id the rows record, how many rows of each world record it, `shared` when both do, and which one
  is the objective's own (`objective_metric`: the id whose value is the row's objective on every row that has both);
- `simulators`, `counts`, and `objective_world` (OBJECTIVES.md's `world:` word, else null).

None when the ledger holds no sim row: every box without one folds byte for byte as before.
"""

from __future__ import annotations

import importlib.util
import math
import re
from pathlib import Path

# the fold's own helpers (one ranking rule, one units table), loaded from beside this folder: viewer/tools/ in the lab,
# fold/ in the package and tools/bb/viewer/tools/ in a box that vendors the fold
_FS = None


def _fs():
    global _FS
    if _FS is None:
        spec = importlib.util.spec_from_file_location("bb_fold_state_for_simreal", Path(__file__).resolve().parents[1] / "fold_state.py")
        _FS = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_FS)
    return _FS


# OBJECTIVES.md's word for the objective's world: a line (or list item) of its own that starts with it, "- **world: real.**"
# (WHY a line start: sppm_agent's table names a sim-only solution `world: sim` in a cell, which is not the objective's)
WORLD = re.compile(r"^[ \t]*(?:[-*][ \t]+)?\**[ \t]*world:[ \t]*\**[ \t]*(real|sim)\b", re.I | re.M)


def _num(v):
    if v is None or isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return v if math.isfinite(v) else None


def _when(r: dict) -> tuple[str | None, str | None]:
    src = r.get("source") if isinstance(r.get("source"), dict) else {}
    if isinstance(src.get("started_at"), str):
        return src["started_at"], "source.started_at"
    win = r.get("window") if isinstance(r.get("window"), dict) else {}
    if isinstance(win.get("end"), str):
        return win["end"], "window.end"
    return (r.get("t"), "t") if isinstance(r.get("t"), str) else (None, None)


def _row(r: dict, world: str, line: int, n: int | None) -> dict:
    sim = r.get("sim") if isinstance(r.get("sim"), dict) else {}
    at, at_from = _when(r)
    out = {"id": None, "world": world, "split": r.get("split"), "solution": r.get("solution"), "pair": r.get("pair"),
           "task": r.get("task"), "simulator": sim.get("name") if world == "sim" else None,
           "rung": sim.get("rung") if world == "sim" else None, "profile": sim.get("profile") if world == "sim" else None,
           "n": n, "objective": _num(r.get("objective")),
           "admissible": r.get("admissible") if isinstance(r.get("admissible"), bool) else None,
           "at": at, "at_from": at_from, "ruler": r.get("ruler"), "line": line,
           "metrics": {k: _num(v) for k, v in (r.get("metrics") or {}).items()} if isinstance(r.get("metrics"), dict) else {}}
    win = r.get("window")
    if isinstance(win, dict) and isinstance(win.get("start"), str) and isinstance(win.get("end"), str):
        out["window"] = {"start": win["start"], "end": win["end"]}
    if r.get("why_null"):
        out["why_null"] = r["why_null"]
    # one id per row: a real row is its solution (the iteration the Black box dashboard opens); a sim row names its
    # solution, simulator and cell
    out["id"] = r.get("solution") if world == "real" else " · ".join(str(x) for x in (r.get("solution"), sim.get("name"), r.get("task")))
    return out


def fold(facts: dict):
    ledger, state = facts.get("ledger"), facts["state"]
    if not ledger or not any(r.get("world") == "sim" for r in ledger):
        return None
    fs = _fs()
    split = (state.get("objective") or {}).get("split")
    ranking = [r for r in ledger if r.get("world") != "sim" and fs.ranks(r, split)]
    ruler = ranking[-1].get("ruler") if ranking else next((r.get("ruler") for r in reversed(ledger) if r.get("world") == "sim"), None)
    lines = {id(r): i for i, r in enumerate(ledger, 1)}

    # real: the row each iteration was ranked on (fold_standard's dev[sid]: the newest ranking row on the current ruler)
    dev: dict[str, dict] = {}
    for r in ranking:
        if r.get("ruler") == ruler:
            dev[r["solution"]] = r
    real = [_row(dev[i["id"]], "real", lines[id(dev[i["id"]])], i.get("n")) for i in state.get("iterations") or [] if i["id"] in dev]

    # sim: every sim row on the current ruler, the newest per (pair, simulator, split) when one was scored twice
    keep: dict[tuple, dict] = {}
    superseded = other_ruler = 0
    for r in ledger:
        if r.get("world") != "sim":
            continue
        if r.get("ruler") not in (ruler, None):
            other_ruler += 1
            continue
        key = (r.get("pair"), (r.get("sim") or {}).get("name") if isinstance(r.get("sim"), dict) else None, r.get("split"), r.get("task"), r.get("solution"))
        if key in keep:
            superseded += 1
        keep[key] = r
    sim = sorted((_row(r, "sim", lines[id(r)], None) for r in keep.values()), key=lambda x: x["line"])
    rows = real + sim
    by_id = {}
    for x in rows:  # a second row with one id (two sims of one cell named alike) keeps its line, so ids stay unique
        if x["id"] in by_id:
            x["id"] = f"{x['id']} · line {x['line']}"
        by_id[x["id"]] = x

    # pairs: real-paired first (in iteration order), then the sim-only ones in ledger order
    pairs: dict[str, dict] = {}
    for x in rows:
        if not x["pair"]:
            continue
        p = pairs.setdefault(x["pair"], {"pair": x["pair"], "solution": x["solution"], "task": None, "real": None, "sim": [],
                                         "ratios": []})
        if x["world"] == "real":
            p["real"], p["task"] = x["id"], x["task"]
        elif x["split"] == "sim":
            p["sim"].append(x["id"])
    for p in pairs.values():
        r = by_id[p["real"]] if p["real"] else None
        if p["task"] is None and p["sim"]:
            p["task"] = by_id[p["sim"][0]]["task"]
        if r is None:
            continue
        for sid in p["sim"]:
            s = by_id[sid]
            q = {"simulator": s["simulator"], "sim": sid, "real_over_sim": None}
            if r["objective"] is None or s["objective"] is None:
                q["why"] = "the real row has no objective" if r["objective"] is None else "the sim row has no objective"
            elif s["objective"] == 0:
                q["why"] = "sim scored 0: no ratio"
            else:
                q["real_over_sim"] = r["objective"] / s["objective"]
            p["ratios"].append(q)
    order = sorted(pairs.values(), key=lambda p: (p["real"] is None, by_id[p["real"]]["n"] if p["real"] else 0,
                                                  min(by_id[i]["line"] for i in p["sim"]) if p["sim"] else 0))

    # metrics: each id the rows record, per world; the objective's own id; shared = recorded in both worlds
    seen: list[str] = []
    for x in rows:
        for k in x["metrics"]:
            if k not in seen:
                seen.append(k)
    count = {w: {k: sum(1 for x in rows if x["world"] == w and x["metrics"].get(k) is not None) for k in seen} for w in ("real", "sim")}
    both = [x for x in rows if x["objective"] is not None]
    obj_metric = next((k for k in seen if count["real"][k] and count["sim"][k]
                       and all(x["metrics"].get(k) == x["objective"] for x in both if x["metrics"].get(k) is not None)), None)
    metrics = [{"id": k, "unit": fs.unit_of(k) or None, "real": count["real"][k], "sim": count["sim"][k],
                "shared": bool(count["real"][k] and count["sim"][k]), "objective": k == obj_metric} for k in seen]
    metrics.sort(key=lambda m: (not m["objective"], not m["shared"]))

    simulators: dict[str, dict] = {}
    for x in sim:
        s = simulators.setdefault(x["simulator"], {"name": x["simulator"], "rows": 0, "rungs": [], "profiles": []})
        s["rows"] += 1
        for k, v in (("rungs", x["rung"]), ("profiles", x["profile"])):
            if v is not None and v not in s[k]:
                s[k].append(v)
    text = facts["tree"].text("OBJECTIVES.md") if "OBJECTIVES.md" in facts["tree"].fileset else None
    m = WORLD.search(text or "")
    return {
        "schema": "bb-simreal/1",
        "from": "ledger.jsonl: the real rows the box ranks, and its rows with world: sim, joined by pair",
        "ruler": ruler,
        "objective_world": m.group(1).lower() if m else None,
        "objective_metric": obj_metric,
        "counts": {"real": len(real), "sim": len(sim), "sim_holdout": sum(1 for x in sim if x["split"] != "sim"),
                   "pairs": len(order), "paired": sum(1 for p in order if p["real"] and p["sim"]),
                   "sim_only": sum(1 for p in order if not p["real"]), "real_only": sum(1 for p in order if p["real"] and not p["sim"]),
                   "superseded": superseded, "other_ruler": other_ruler},
        "simulators": list(simulators.values()),
        "metrics": metrics,
        "pairs": order,
        "rows": rows,
    }
