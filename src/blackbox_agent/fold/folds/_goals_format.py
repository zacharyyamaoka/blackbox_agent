"""The Goals format a box writes (viewer/CONTRACT.md §20; PICKS.md "Goals (2026-11-25)"), read into goals_core's GOAL
dicts, with every refusal a problem that names its fix. Stdlib only; not a slice itself (the leading underscore), the
reader tools/folds/goals.py folds with.

A goal is one note, `goals/<id>-<slug>.md`, its front matter in Vibe Tracks' destination keys (vt-track-1), its body
the why:

    ---
    vibe-goal: Ready for the real arm                  the title
    vibe-done-when:                                    VT's grammar, one criterion per line:
      - gate:all                                         every gate passes on every dev task
      - kpi:saturation_share_pct <= 0.5                  a gate's id = that gate tightened (never loosened)
      - kpi:tool_track_rms_mm <= 0.030                   the objective (a ledger diagnostic reads the same way)
      - feature:O1.1                                     a spec requirement, judged on the repo's tests
      - kpi:tool_track_rms_mm <= 0.05 in ruler-v2        read on a ruler that is not frozen yet: "cannot judge yet"
    vibe-target: 2026-11-27T17:00-07:00                the desired date and time (VT's date-only form reads as 23:59)
    tier: must                                         must | stretch
    set: 2026-11-24T21:30-07:00                        when it was set (the desired line starts here)
    owner: Zach                                        optional
    ---

The roadmap lives on the ideas, in the box's one ideas.md (an idea is born, tried and crossed off there; a list in the
goal would be a second place to keep in step), up to three sub-bullets under an idea:

    - [ ] Make the identification gain-portable: ...
        - Goal: G2 · step 3 · objective        it serves G2, third in G2's plan, aimed at the objective criterion
        - Effort: 45 min                       box time, bottom up (min or h); Zach's ideas are never sized
        - Expect: tool_track_rms_mm −4 %       its bet: <objective|gate> ±N % (or a range), or <spec id> → pass
        - By: 2026-11-25T21:30-07:00           when it lands (round 3, CONTRACT §27): the Planned line steps here by
                                               the Expect bet; '- By: 21:30' = that time on its goal's set day, in the
                                               goal's offset; no By = the Effort × buffer bottom-up time, drawn hollow

`· step N` only where the plan is not the file's order (stepped ideas first by N, then the rest in file order); the
criterion (`objective`, a gate id, a spec id, `gates`) is optional: an idea without one serves the goal as a whole.
Only an idea that serves a goal (a `- Goal:` line) has its Effort / Expect / By read: the same words under any other idea
are the box's own prose (old boxes wrote "- Expect: dev ... below 0.031 mm" as a prediction) and are never refused
(round 3, Zach 2026-11-25: 8 amber lines of legacy predictions at the top of his page were noise).
A note or a line this reader refuses never stops the fold: it lands in `problems` as {lint, where, what, fix}, the same
shape `blackbox check` prints ("[lint] where: what; fix: fix"), and the goal (or the link) is left out.

Reused read-only, never copied (one rule, one meaning; the way tools/folds/ideas.py imports the ideas lanes):
proposals-goals/_shared/goals_core.py (the judge: _refusal, OPS), 01-destination/format.py (VT's done-when grammar
CONDITION, the front-matter reader, dates, did-you-mean), 02-two-lines/format.py (the sub-bullet grammar: SUB,
EFFORT_LINE, PCT_BET, SPEC_BET).
"""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

BB = Path(__file__).resolve().parents[1] / "lib"  # the goals lanes' modules, copied into fold/lib/
GOALS = BB
CORE = BB / "goals_core.py"
VT = BB / "goals_vt_format.py"
BETS = BB / "goals_bets_format.py"
IDEAS = BB

NOTE = re.compile(r"^goals/(G\d+)-[^/]*\.md$")
VT_KEYS = ["vibe-goal", "vibe-done-when", "vibe-target"]
GOAL_KEYS = ["tier", "set", "owner"]
OK_KEYS = set(VT_KEYS + GOAL_KEYS + ["tags", "aliases", "title"])
REQUIRED = ["vibe-goal", "vibe-done-when", "vibe-target", "tier"]
TIERS = ["must", "stretch"]


def _module(name: str, path: Path):
    have = sys.modules.get(name)
    if have is not None and Path(getattr(have, "__file__", "") or "").resolve() == path.resolve():
        return have
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


class _Lanes:
    """The goals round's modules, each loaded once. WHY put sys.path back: 01 and 02 insert their folders at the front
    and register `goals_core` / `ideas_parse` under plain names; every import they make is at load time."""

    def __init__(self):
        path = list(sys.path)
        try:
            sys.path[:0] = [str(GOALS / "_shared"), str(IDEAS)]
            self.core = _module("goals_core", CORE)
            self.vt = _module("bbfold_goals_vt_format", VT)
            self.bets = _module("bbfold_goals_bets_format", BETS)
        finally:
            sys.path[:] = path


_lanes: _Lanes | None = None


def lanes() -> _Lanes:
    global _lanes
    if _lanes is None:
        _lanes = _Lanes()
    return _lanes


def problem(lint: str, where: str, what: str, fix: str) -> dict:
    return {"lint": lint, "where": where, "what": what, "fix": fix}


def text_of(p: dict) -> str:
    return f"[{p['lint']}] {p['where']}: {p['what']}; fix: {p['fix']}"


# ── the box's own ids ─────────────────────────────────────────────────────────────────────────────────────────────

def box_ids(state: dict, ledger: list | None = None, measurements: dict | None = None) -> dict:
    """What a goal may name, read from the folded state (and the ledger's diagnostics, when given)."""
    gates = [g["id"] for g in state.get("gates") or []]
    diags = set()
    for row in ledger or []:
        if row.get("split") == "dev":
            diags |= set((row.get("diagnostics") or {}).keys())
    obj = state.get("objective") or {}
    return {
        "objective": obj.get("name"), "ruler": obj.get("ruler"), "unit": obj.get("unit") or "",
        "gates": gates, "gate_rows": {g["id"]: g for g in state.get("gates") or []},
        "diagnostics": sorted(diags - set(gates)), "measurements": sorted(measurements or {}),
        "specs": [r["id"] for r in ((state.get("spec") or {}).get("requirements") or [])],
        "spec_rows": {r["id"]: r for r in ((state.get("spec") or {}).get("requirements") or [])},
        "ideas": [i.get("iid") or i.get("id") for i in state.get("ideas") or []],
    }


def _core_box(ids: dict) -> dict:
    """The slice of a goals_core box its refusal rule reads (gates, the ruler, the spec rows)."""
    return {"state": {"objective": {"ruler": ids["ruler"]}, "gates": list(ids["gate_rows"].values()),
                      "spec": {"requirements": list(ids["spec_rows"].values())}}}


def _near(word: str, options: list[str]) -> str | None:
    import difflib
    got = difflib.get_close_matches(word, [o for o in options if o], n=1, cutoff=0.5)
    return got[0] if got else None


# ── one vibe-done-when line ───────────────────────────────────────────────────────────────────────────────────────

def criterion(line: str, ids: dict, where: str) -> tuple[dict | None, dict | None]:
    """A done-when line -> (goals_core criterion, None) or (None, problem). VT's grammar, 01's regex."""
    m = lanes().vt.CONDITION.match(line.strip())
    if not m:
        return None, problem("goal-criterion", where, f"'{line}' is not Vibe Tracks' done-when grammar",
                             "write gate:all, kpi:<id> <op> <value> or feature:<spec id>, optionally ' in ruler-<version>'")
    extra = {}
    if m["where"]:
        if m["where"] == "holdout":
            extra["split"] = "holdout"
        elif m["where"].startswith("ruler-"):
            extra["ruler"] = m["where"][len("ruler-"):]
        else:
            return None, problem("goal-criterion", where, f"'{line}': ' in {m['where']}' names no ruler",
                                 f"drop ' in {m['where']}', or write ' in ruler-<version>' (e.g. ruler-v2) for a ruler not frozen yet")
    if m["gid"]:
        if m["gid"] == "all":
            c = {"kind": "gates", **extra}
        else:
            known = m["gid"] in ids["gates"]
            near = None if known else _near(m["gid"], ids["gates"])
            return None, problem("goal-criterion", where,
                                 f"'{line}': a goal does not pick single gates (the others would drop out: a loosened ruler)"
                                 + ("" if known else f"; no gate named {m['gid']}"),
                                 "write gate:all for every gate" + (f", and kpi:{m['gid']} <= <a tighter value> to tighten it" if known
                                                                    else f" (gates: {', '.join(ids['gates'])}" + (f"; did you mean {near}?" if near else "") + ")"))
    elif m["fid"]:
        if m["fid"] not in ids["specs"]:
            near = _near(m["fid"], ids["specs"])
            return None, problem("goal-criterion", where, f"'{line}': no requirement {m['fid']} in specs/",
                                 f"write feature:{near}" if near else f"write a spec id ({', '.join(ids['specs'][:6])}, …)")
        c = {"kind": "spec", "ref": m["fid"], **extra}
    elif m["tid"]:
        return None, problem("goal-criterion", where, f"'{line}': a single test is not judged on its own",
                             "name the requirement it verifies, feature:<spec id>")
    else:
        kid, op, value = m["kid"], m["op"], lanes().vt._number(m["val"])
        if kid == ids["objective"]:
            c = {"kind": "objective", "op": op, "value": value, **extra}
        elif kid in ids["gates"]:
            c = {"kind": "gate", "ref": kid, "op": op, "value": value, **extra}
        elif kid in ids["diagnostics"]:
            c = {"kind": "diagnostic", "ref": kid, "op": op, "value": value, **extra}
        elif kid in ids.get("measurements", []):
            c = {"kind": "measurement", "ref": kid, "op": op, "value": value, **extra}
        else:
            every = [ids["objective"], *ids["gates"], *ids["diagnostics"]]
            near = _near(kid, every)
            return None, problem("goal-criterion", where, f"'{line}': this box measures no {kid}",
                                 (f"write kpi:{near} {op} {m['val']} (the nearest id)" if near else "name what the box measures")
                                 + f"; objective {ids['objective']}, gates {', '.join(ids['gates'])}"
                                 + (f", diagnostics {', '.join(ids['diagnostics'])}" if ids["diagnostics"] else ""))
    # goals_core's own refusals that can never become true stop the line; "not yet" ones (ruler v2, a deferred spec)
    # load and read "cannot judge yet" with the reason
    why = lanes().core._refusal(c, _core_box(ids))
    if why and c.get("split") == "holdout":
        return None, problem("goal-criterion", where, f"'{line}': {why}",
                             f"drop ' in holdout' (a goal reads the dev split the ruler ranks on), or drop the line")
    if why and c["kind"] == "gate" and "loosen" in why:
        g = ids["gate_rows"][c["ref"]]
        return None, problem("goal-criterion", where, f"'{line}': {why}",
                             f"write kpi:{c['ref']} {g['op']} <a value inside the ruler's {g['threshold']:g}>, or drop the line")
    return c, None


def key_of(c: dict, ids: dict) -> str:
    """The id an idea's `- Goal: G2 · <key>` names a criterion by: objective, gates, a gate / diagnostic / spec id."""
    return {"gates": "gates", "objective": "objective"}.get(c["kind"]) or c["ref"]


# ── one goal note ─────────────────────────────────────────────────────────────────────────────────────────────────

def read_note(path: str, text: str, ids: dict) -> tuple[dict | None, list[dict]]:
    vt = lanes().vt
    m = NOTE.match(path)
    if not m:
        return None, [problem("goal-note", path, "a goal note's name starts with its id", "rename it goals/G<n>-<words>.md")]
    gid = m.group(1)
    try:
        front, body = vt.split_note(text)
        meta = vt.parse_front(front)
    except vt.GoalError as e:
        return None, [problem("goal-note", path, str(e), "open the note with a --- front-matter block of key: value lines")]
    probs = []
    for k in meta:
        if k not in OK_KEYS:
            near = _near(k, sorted(OK_KEYS))
            probs.append(problem("goal-note", path, f"unknown key '{k}'", f"write {near}" if near else
                                 f"use {', '.join(VT_KEYS + GOAL_KEYS)} (the roadmap lives on the ideas: - Goal: {gid})"))
    for k in REQUIRED:
        if meta.get(k) in (None, "", []):
            probs.append(problem("goal-note", path, f"'{k}' is missing", f"add {k}: to the front matter"))
    if meta.get("tier") not in (None, "", []) and meta["tier"] not in TIERS:
        probs.append(problem("goal-note", path, f"tier '{meta['tier']}' is neither must nor stretch", "write tier: must or tier: stretch"))
    when = {}
    for key, name in (("vibe-target", "due"), ("set", "set")):
        if meta.get(key):
            try:
                when[name] = vt._when(meta[key], path, key)
            except vt.GoalError as e:
                probs.append(problem("goal-note", path, str(e).split(": ", 1)[-1], f"write {key}: 2026-11-27T17:00-07:00"))
    if probs:
        return None, probs
    lines = meta["vibe-done-when"] if isinstance(meta["vibe-done-when"], list) else [meta["vibe-done-when"]]
    lines = [str(x) for x in lines]
    criteria = []
    for i, line in enumerate(lines):
        c, p = criterion(line, ids, f"{path} vibe-done-when[{i}]")
        if p:
            probs.append(p)
        else:
            criteria.append(c)
    if probs:
        return None, probs
    why = next((part.strip() for part in body.strip().split("\n\n") if part.strip()), "")
    goal = {"id": gid, "title": str(meta["vibe-goal"]), "tier": meta["tier"], "owner": str(meta.get("owner") or ""),
            "set": when.get("set"), "due": when["due"], "why": why, "path": path, "done_when": lines,
            "criteria": criteria, "keys": [key_of(c, ids) for c in criteria], "roadmap": [], "effort": {}}
    if goal["set"] is None:
        goal["set"] = goal["due"]  # WHY: no set time, no desired line to draw; the goal still judges
    return goal, []


def read_notes(notes: dict[str, str], ids: dict) -> dict:
    """{path: text} of goals/*.md -> {"goals": [...] in id order, "problems": [...]}."""
    goals, probs, seen = [], [], {}
    for path in sorted(notes, key=lambda p: (int(NOTE.match(p).group(1)[1:]) if NOTE.match(p) else 10 ** 9, p)):
        g, p = read_note(path, notes[path], ids)
        probs += p
        if g is None:
            continue
        if g["id"] in seen:
            probs.append(problem("goal-note", path, f"a second note for {g['id']} (the first is {seen[g['id']]})",
                                 f"give it its own id, goals/G{max(int(x[1:]) for x in seen) + 1}-…md"))
            continue
        seen[g["id"]] = path
        goals.append(g)
    return {"goals": goals, "problems": probs}


# ── the ideas' sub-bullets ────────────────────────────────────────────────────────────────────────────────────────

ALIAS = {"gate:all": "gates", "all": "gates"}
BY = re.compile(r"^\s+- By:\s*(.*?)\s*$")
BY_CLOCK = re.compile(r"^(\d{1,2}):(\d{2})$")
BY_FIX = "write '- By: 2026-11-25T21:30-07:00' (a date-time with its offset) or '- By: 21:30' (that time on its goal's set day)"


def by_time(value: str, goal_set: str) -> str | None:
    """A `- By:` value -> an ISO date-time with offset, or None when it is not one. '21:30' = that wall time on the
    goal's set day in the goal's offset; a date-time without an offset takes the goal's offset."""
    from datetime import datetime
    v = value.strip()
    gs = datetime.fromisoformat(goal_set)
    m = BY_CLOCK.match(v)
    try:
        if m:
            h, mi = int(m.group(1)), int(m.group(2))
            if h > 23 or mi > 59:
                return None
            return gs.replace(hour=h, minute=mi, second=0, microsecond=0).isoformat()
        dt = datetime.fromisoformat(v.replace(" ", "T", 1))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=gs.tzinfo)
    return dt.isoformat()


def read_links(ideas_text: str, rows: list[dict], goals: list[dict], ids: dict, core_box: dict) -> dict:
    """ideas.md's - Goal: / - Effort: / - Expect: lines -> {iid: {goals, steps, aims, effort, expect, expect_text}},
    every goal's roadmap (plan order) and effort filled in, and the problems. `rows` = the ideas slice (line -> iid)."""
    bets = lanes().bets
    sys.path.insert(0, str(IDEAS))
    try:
        parse = _module("ideas_parse", IDEAS / "ideas_parse.py").parse
    finally:
        sys.path.remove(str(IDEAS))
    by_line = {r["line"]: r for r in rows if r.get("line")}
    by_id = {g["id"]: g for g in goals}
    links: dict[str, dict] = {}
    probs = []
    for idea in parse(ideas_text).ideas:
        row = by_line.get(idea.line_no)
        if row is None:
            continue
        iid = row.get("iid") or row["id"]
        rec = {"goals": [], "steps": {}, "aims": {}, "effort": None, "expect": None, "expect_text": None, "index": idea.index}
        held = []   # the Effort / Expect / By problems, kept only if the idea serves a goal (round 3)
        by_raw = None
        for k, raw in enumerate(idea.raw.splitlines()[1:], 1):
            bm = BY.match(raw)
            if bm:
                by_raw = (bm.group(1), f"ideas.md:{idea.line_no + k}")
                continue
            m = bets.SUB.match(raw)
            if not m:
                continue
            key, value = m.groups()
            where = f"ideas.md:{idea.line_no + k}"
            if key == "Goal":
                parts = [p.strip() for p in value.split("·")]
                gm = re.fullmatch(r"(?:\[\[)?(G\d+)(?:\]\])?", parts[0])
                if not gm:
                    probs.append(problem("goal-idea", where, f"'- Goal: {value}' names no goal id",
                                         "write '- Goal: G2', '- Goal: G2 · step 1' or '- Goal: G2 · step 1 · objective'"))
                    continue
                gid = gm.group(1)
                if gid not in by_id:
                    probs.append(problem("goal-idea", where, f"'- Goal: {value}': there is no goals/{gid}-….md",
                                         f"add the note, or write one of {', '.join(by_id) or 'no goal yet'}"))
                    continue
                rec["goals"].append(gid)
                for part in parts[1:]:
                    sm = re.fullmatch(r"step\s+(\d+)", part)
                    if sm:
                        rec["steps"][gid] = int(sm.group(1))
                        continue
                    want = ALIAS.get(part, "objective" if part == ids["objective"] else part)
                    if want in by_id[gid]["keys"]:
                        rec["aims"][gid] = want
                    else:
                        near = _near(part, by_id[gid]["keys"])
                        probs.append(problem("goal-idea", where, f"'- Goal: {value}': {gid} has no criterion '{part}'",
                                             f"write one of {', '.join(by_id[gid]['keys'])}" + (f" (did you mean {near}?)" if near else "")))
            elif key == "Effort":
                try:
                    rec["effort"] = bets._minutes(value, where)
                except ValueError as e:
                    held.append(problem("goal-idea", where, f"'- Effort: {value}' is not a duration",
                                        str(e).split(": ", 2)[-1].replace("write ", "write ", 1)))
            else:
                pm = bets.PCT_BET.match(value)
                if pm and pm.group(1) in set(ids.get("measurements") or []) | set(ids.get("diagnostics") or []):
                    # WHY (round 3, trajectory_tracking_agent's G2 / G3 at f9b372a): a goal's targets may be benchmark
                    # readings (goals/metrics.json) or ledger diagnostics, and its Planned line steps on their bets too;
                    # 02's reader knows only the objective and the gates
                    lo = float(pm.group(2).replace("−", "-"))
                    hi = float(pm.group(3).replace("−", "-")) if pm.group(3) else lo
                    rec["expect"] = {"kind": "pct", "ref": pm.group(1), "lo": lo, "hi": hi, "text": value}
                    rec["expect_text"] = value
                    continue
                try:
                    rec["expect"] = bets._bet(value, where, core_box)
                    rec["expect_text"] = value
                except ValueError as e:
                    held.append(problem("goal-idea", where, f"'- Expect: {value}' is not a bet the line can read",
                                        str(e).split("': ", 1)[-1]))
        if not rec["goals"]:
            # WHY: an idea that serves no goal is not on any roadmap; its Effort / Expect / By are its own prose
            rec["effort"] = rec["expect"] = rec["expect_text"] = None
            held, by_raw = [], None
        probs += held
        if by_raw is not None:
            when = by_time(by_raw[0], by_id[rec["goals"][0]]["set"])
            if when is None:
                probs.append(problem("goal-idea", by_raw[1], f"'- By: {by_raw[0]}' is not a time", BY_FIX))
            else:
                rec["by"] = when
                rec["by_text"] = by_raw[0]
        if row.get("lane") == "human" and rec["effort"] is not None:
            # WHY: nobody can estimate Zach; an Effort under one of his ideas would read as a date
            probs.append(problem("goal-idea", f"ideas.md:{idea.line_no}", f"{iid} is Zach's (Suggestions for Zach) and carries an Effort",
                                 "delete its '- Effort:' line: his ideas are named as waits, never sized"))
            rec["effort"] = None
        links[iid] = rec
    for g in goals:
        mine = [(iid, r) for iid, r in links.items() if g["id"] in r["goals"]]
        # 02's rule: stepped ideas first by their step, then the rest in file order
        mine.sort(key=lambda x: (0, x[1]["steps"][g["id"]], x[1]["index"]) if g["id"] in x[1]["steps"] else (1, 0, x[1]["index"]))
        g["roadmap"] = [iid for iid, _ in mine]
        g["effort"] = {iid: r["effort"] for iid, r in mine if r["effort"] is not None}
    return {"ideas": links, "problems": probs}
