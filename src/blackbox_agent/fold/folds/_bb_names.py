"""Human-readable iteration names (viewer/CONTRACT.md §24). Not a slice (the leading underscore): fold_state.py's
iteration rows and `blackbox check` both read a box's solutions/<id>/meta.json through here (one rule, one meaning).
Stdlib + git only.

Four optional keys of solutions/<id>/meta.json:

- `name`: a dotted id, FAMILY.VARIANT.SUBVARIANT..., e.g. `P5.s.pass3.g1.nolag`. Each segment refines the one before
  it, so the name's prefixes are the family tree: `P5` is the family, `P5.s` one variant of it, and so on. The name
  groups ideas; `parent` says which code the solution was built from. The two are reconciled, not equated: a child is
  never named as its parent or one of its parent's name-ancestors (a problem), and a child named into another family
  than its parent's is said once (a note: a new approach seeded from old code is allowed). WHY not "the parent's name
  is a prefix": Zach's own example `P5.s.pass3.g1.nolag` names p5s-pass3 under P5.s, while its parent is p5s-onefit,
  the end of a 12-step chain of kept improvements; a strict prefix would force a 13-segment name.
- `summary`: what the iteration is, like a tweet, at most SUMMARY_MAX (150) characters.
- `description`: the longer story, Markdown.
- `expect`: what the iteration is expected to achieve, stated BEFORE it is scored ("no idea, trying to see what sticks"
  is a fine prediction). It must be committed before the solution's first scored ledger row: a prediction written
  after the result is worthless, so `blackbox check` reads git history and flags one written with or after it.

WHY (Zach, Daily Note 2026-11-25, "HUman readable iteration names"): the Iterations peek showed only
`p5s-pass3-g1-nolag` and "The one change"; "when I click on it actually explain a bit like what this iteration is",
and "You should always ahead of time basically say like what you are expecting to achieve with this iteration, even
if that is I have no idea just trying to see what sticks."

A box with none of these keys folds byte for byte as before (the fold adds the fields only to a box that uses them);
a key a solution leaves out is null in its row, shown as missing, never invented.
"""

from __future__ import annotations

import json
import re

KEYS = ("name", "summary", "description", "expect")
SUMMARY_MAX = 150
SEGMENT_MAX = 32
SEGMENTS_MAX = 12
# a segment: letters and digits, with `-` or `_` inside (never first or last); `.` only between segments
SEGMENT = r"[A-Za-z0-9](?:[A-Za-z0-9_-]{0,%d}[A-Za-z0-9])?" % (SEGMENT_MAX - 2)
NAME = re.compile(r"^%s(?:\.%s){0,%d}$" % (SEGMENT, SEGMENT, SEGMENTS_MAX - 1))
NOT_STATED = "not stated before the run"
# expect_when: where the prediction sits against the solution's first scored ledger row, from git history
WHEN = {
    "before-result": "stated before the result",
    "with-result": "written in the same commit as the result",
    "after-result": "written after the result",
    "edited-after-result": "changed after the result",
    "no-result-yet": "stated; no result yet",
    "not-stated": NOT_STATED,
}
LATE = ("with-result", "after-result", "edited-after-result")


def uses_names(metas: dict[str, dict]) -> bool:
    """Does the box use the naming keys at all (any solution's meta.json has one)?"""
    return any(isinstance(m, dict) and any(k in m for k in KEYS) for m in metas.values())


def stated(v) -> bool:
    return isinstance(v, str) and v.strip() != ""


def lineage(name) -> list[str] | None:
    """`P5.s.pass3` -> ["P5", "P5.s", "P5.s.pass3"]: every ancestor prefix and the name itself; None for no valid name."""
    if not isinstance(name, str) or not NAME.match(name):
        return None
    parts = name.split(".")
    return [".".join(parts[: i + 1]) for i in range(len(parts))]


def row_fields(meta: dict, timing: dict | None) -> dict:
    """The fields an iteration (or ablation, or unscored) row gains: the four keys as written (null when left out),
    `family` (the first segment) and `lineage` (every prefix) from a valid name, and where `expect` sits in history."""
    name = meta.get("name")
    path = lineage(name)
    t = timing or {}
    return {"name": name if isinstance(name, str) else None,
            "summary": meta.get("summary") if isinstance(meta.get("summary"), str) else None,
            "description": meta.get("description") if isinstance(meta.get("description"), str) else None,
            "expect": meta.get("expect") if stated(meta.get("expect")) else None,
            "family": path[0] if path else None,
            "lineage": path or [],
            "expect_when": t.get("when") or ("no-result-yet" if stated(meta.get("expect")) else "not-stated"),
            "expect_commit": t.get("expect_commit"),
            "result_commit": t.get("result_commit")}


def problem(lint: str, where: str, what: str, fix: str) -> dict:
    return {"lint": lint, "where": where, "what": what, "fix": fix}


def name_problem(name) -> str | None:
    """Why `name` is not a dotted name, or None when it is."""
    if not isinstance(name, str):
        return f"`name` is {type(name).__name__}, not text"
    if not NAME.match(name):
        return (f"`name` {name!r} is not FAMILY.VARIANT.SUB...: segments of letters and digits (`-` or `_` inside), "
                f"joined by `.`, each at most {SEGMENT_MAX} characters, at most {SEGMENTS_MAX} segments")
    return None


def meta_problems(metas: dict[str, dict]) -> list[dict]:
    """The format rules on every solution's naming keys, one problem each: the grammar, the 150 characters, text where
    text is due, one name per solution, and a name that never contradicts `parent` (a child is never named as its
    parent or one of its parent's name-ancestors)."""
    out = []
    names: dict[str, str] = {}
    for sid in sorted(metas):
        m = metas[sid]
        where = f"solutions/{sid}/meta.json"
        if not isinstance(m, dict):
            continue
        if "name" in m:
            why = name_problem(m["name"])
            if why:
                out.append(problem("names", where, why, "rename it, e.g. `P5.s.pass3` (family P5, variant s, sub-variant pass3)"))
            elif m["name"] in names:
                out.append(problem("names", where, f"`name` {m['name']!r} is also {names[m['name']]}'s",
                                   "give each solution its own name: add a segment that says how they differ"))
            else:
                names[m["name"]] = sid
        for key in ("summary", "description", "expect"):
            if key in m and m[key] is not None and not isinstance(m[key], str):
                out.append(problem("names", where, f"`{key}` is {type(m[key]).__name__}, not text", f"write `{key}` as one string"))
        s = m.get("summary")
        if isinstance(s, str) and len(s) > SUMMARY_MAX:
            out.append(problem("names", where, f"`summary` is {len(s)} characters, over {SUMMARY_MAX}",
                               f"cut it to {SUMMARY_MAX} (a tweet); the rest belongs in `description`"))
    for sid, m, p, pname in named_pairs(metas, names):
        if pname == m["name"] or pname.startswith(m["name"] + "."):
            out.append(problem("names", f"solutions/{sid}/meta.json",
                               f"`name` {m['name']!r} is its parent {p}'s name or an ancestor of it ({pname!r})",
                               f"a child's name sits under its parent's family: name it {pname.split('.')[0]}.<...>, or fix `parent`"))
    return out


def named_pairs(metas: dict[str, dict], names: dict[str, str]):
    """(id, meta, parent id, parent's name) for every validly named solution whose parent is validly named too."""
    for sid in sorted(metas):
        m = metas[sid]
        if not isinstance(m, dict) or names.get(m.get("name")) != sid:
            continue
        p = m.get("parent")
        pm = metas.get(p) if isinstance(p, str) else None
        pname = pm.get("name") if isinstance(pm, dict) else None
        if isinstance(pname, str) and names.get(pname) == p:
            yield sid, m, p, pname


def family_notes(metas: dict[str, dict]) -> list[str]:
    """A child named into another family than its parent's: allowed (a new approach seeded from old code), said once."""
    names = {m["name"]: sid for sid, m in sorted(metas.items()) if isinstance(m, dict) and not name_problem(m.get("name"))}
    moved = [f"{sid} ({m['name']}, from {p}'s {pname})" for sid, m, p, pname in named_pairs(metas, names)
             if m["name"].split(".")[0] != pname.split(".")[0]]
    if not moved:
        return []
    return [f"{len(moved)} solution(s) start a new family from their parent's code: {', '.join(moved[:5])}"
            f"{'' if len(moved) <= 5 else ', ...'} (the name groups ideas; `parent` says which code it was built from)"]


# ── where `expect` sits in history ───────────────────────────────────────────────────────────────────────────────
def scored(row: dict) -> bool:
    """A ledger row that scores a solution: it names one and carries a number."""
    v = row.get("objective")
    return bool(row.get("solution")) and isinstance(v, (int, float)) and not isinstance(v, bool) and v == v


def _json(text: str):
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return None


def timings(git, sha: str, metas: dict[str, dict]) -> dict[str, dict]:
    """solution id -> {when, expect_commit, result_commit} for every solution, read from git history up to `sha`:
    `git(*args) -> str` runs git in the box. The result commit is the first commit whose ledger.jsonl holds a scored
    row for the solution; the expect commit the first whose meta.json states `expect`. Commits are ordered by
    `git rev-list --topo-order`. Read only for a box that uses the naming keys."""
    order = {c: i for i, c in enumerate(git("rev-list", "--topo-order", "--reverse", sha).split())}
    want = {sid for sid, m in metas.items() if isinstance(m, dict)}
    first_score: dict[str, str] = {}
    for c in git("log", "--reverse", "--format=%H", sha, "--", "ledger.jsonl").split():
        if want <= set(first_score):
            break
        try:
            text = git("show", f"{c}:ledger.jsonl")
        except Exception:  # noqa: BLE001 (deleted at that commit; the caller's git raises its own error type)
            continue
        for line in text.splitlines():
            r = _json(line) if line.strip() else None
            if isinstance(r, dict) and scored(r) and r["solution"] in want:
                first_score.setdefault(r["solution"], c)
    out = {}
    for sid in sorted(want):
        expect_now = metas[sid].get("expect")
        result = first_score.get(sid)
        t = {"when": None, "expect_commit": None, "result_commit": result[:7] if result else None}
        if not stated(expect_now):
            t["when"] = "not-stated"
            out[sid] = t
            continue
        first, before = None, None  # the first commit stating expect; the expect text as of the last commit before the result
        for c in git("log", "--reverse", "--format=%H", sha, "--", f"solutions/{sid}/meta.json").split():
            try:
                m = _json(git("show", f"{c}:solutions/{sid}/meta.json"))
            except Exception:  # noqa: BLE001
                m = None
            e = m.get("expect") if isinstance(m, dict) else None
            if first is None and stated(e):
                first = c
            if result and order.get(c, -1) < order.get(result, -1):
                before = e
        t["expect_commit"] = first[:7] if first else None
        if not result:
            t["when"] = "no-result-yet"
        elif first is None or order.get(first, -1) > order[result]:
            t["when"] = "after-result"
        elif first == result:
            t["when"] = "with-result"
        elif before != expect_now:
            t["when"] = "edited-after-result"
        else:
            t["when"] = "before-result"
        out[sid] = t
    return out


def timing_problems(times: dict[str, dict]) -> list[dict]:
    """One problem per solution whose prediction was written with, after, or changed after its first result."""
    out = []
    fixes = {
        "with-result": "commit `expect` (with `name` and `summary`) before the evaluation's commit, then score it",
        "after-result": "a prediction written after the result is worthless: leave `expect` out (the page says "
                        f"\"{NOT_STATED}\") and state it first next time",
        "edited-after-result": "put back the `expect` that was committed before the result; write what you learned in "
                               "`description`",
    }
    for sid in sorted(times):
        t = times[sid]
        if t["when"] in LATE:
            what = {"with-result": f"expect written in the same commit as the result ({t['result_commit']})",
                    "after-result": f"expect written after the result (result {t['result_commit']}, expect {t['expect_commit']})",
                    "edited-after-result": f"expect changed after the result ({t['result_commit']})"}[t["when"]]
            out.append(problem("expect", f"solutions/{sid}/meta.json", what, fixes[t["when"]]))
    return out


def box_problems(git, sha: str, metas: dict[str, dict]) -> tuple[list[dict], list[str]]:
    """(problems, notes) for `blackbox check`: the format rules, and the prediction's timing from git history. A box
    that names no solution gets one note (the keys are optional), never a problem."""
    if not metas:
        return [], []
    if not uses_names(metas):
        return [], [f"{len(metas)} solution(s) carry no `name`, `summary` or `expect` (viewer CONTRACT §24): the "
                    "Iterations tab shows their bare ids; `python3 tools/suggest_names.py --box .` in the blackbox_agent "
                    "lab drafts dotted names from their parent chains"]
    problems = meta_problems(metas)
    problems += timing_problems(timings(git, sha, metas))
    bare = sorted(sid for sid, m in metas.items() if isinstance(m, dict) and not stated(m.get("expect")))
    notes = family_notes(metas)
    if bare:
        notes.append(f"{len(bare)} solution(s) state no `expect` ({', '.join(bare[:8])}{'' if len(bare) <= 8 else ', ...'}): "
                     f"their pages say \"{NOT_STATED}\"")
    return problems, notes
