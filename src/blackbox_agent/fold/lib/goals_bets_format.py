"""Proposal 02 · Two lines — the file format. The roadmap lives on the ideas (idea → goal); a goal is a small note.

    python3 format.py migrate   # writes example/ from ../_shared/goals.draft.json + the fixture's ideas.md
    python3 format.py read      # prints the goals (and each idea's goal links) read back from example/
    python3 format.py strip     # prints example/ideas.md with this format's lines removed (== the fixture's ideas.md)
    python3 format.py check     # read == the draft's goals, strip == the original, byte for byte

The idea queue stays the box's one ideas.md. Under an idea, up to three sub-bullets beside the round's `- Rung:` /
`- Needs:` convention (PICKS.md, Idea queue row):

    - [ ] Make the identification gain-portable: fit ... Expect: if it works, one model for every rung ... ^I-025
        - Goal: G2 · step 3        it serves goal G2 (goals/G2.md), third in G2's plan; more goals, more lines
        - Effort: 45 min           box time it needs, bottom up (min or h); none: the estimate names it unestimated
        - Expect: O1.1 → pass      its bet, read by the estimate line: `<objective|gate id> <signed %>` (a range:
                                   `−10 to −20 %`) or `<spec id> → pass`; no line: the step is drawn flat, "no number bet"

Plan order is file order. `· step N` reorders a goal's ideas only when its plan differs from the file's order (G2 and
G3 here; G1's plan is the file's order, so it carries no steps): stepped ideas first by N, then the rest in file order.
WHY the link on the idea and not a list in the goal: an idea is born, tried and crossed off in ideas.md; a roadmap
list in a second file would be a second place to keep in step (criteria fr3: one list of ideas, never a second
roadmap file). The `^I-NNN` block ids are round 1's convention (stamped once, on every idea, so [[ideas#^I-025]] links).

A goal is goals/<id>.md, front matter only, Vibe Tracks' keys where they exist (vt-track-1 schema):

    vibe-goal: Ready for the real arm      the title
    tier: must | stretch
    set / due: ISO date-times              WHY not vibe-target: it is a date; G1 was due at noon
    vibe-done-when:                        ids only, never a restated threshold of the ruler's own:
      - gate:all                           every gate passes on every dev task
      - kpi:saturation_share_pct <= 0.5    a kpi on a gate id = that gate tightened (a looser one is refused)
      - kpi:tool_track_rms_mm <= 0.03      the objective; `kpi:tool_track_rms_mm@v2` = on ruler v2
      - feature:O1.1                       a spec requirement, verified by the box's own tests

Ids are resolved against the box (state.json's objective, gates and specs; the ledger's diagnostics): an unknown one is
refused with the fix. Met / not met is never written here: goals_core computes it. Stdlib only.
"""

from __future__ import annotations

import sys

sys.dont_write_bytecode = True  # WHY: importing the shared modules must not write __pycache__ outside this folder

import json  # noqa: E402
import os  # noqa: E402
import re  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SHARED = os.path.join(HERE, "..", "_shared")
sys.path.insert(0, SHARED)
sys.path.insert(0, HERE)  # ideas_parse sits beside this file in fold/lib/

import goals_core  # noqa: E402
from ideas_parse import parse, stamp_ids, strip_ids  # noqa: E402

FIXTURE_MD = os.path.join(SHARED, "fixture", "ideas.md")
FIXTURE_JSON = os.path.join(SHARED, "fixture", "ideas.json")
DRAFT = os.path.join(SHARED, "goals.draft.json")
EXAMPLE = os.path.join(HERE, "example")
INDENT = "    "
SUB = re.compile(r"^\s+- (Goal|Effort|Expect):\s*(.*?)\s*$")
GOAL_LINE = re.compile(r"^(?:\[\[)?(G\d+)(?:\]\])?(?:\s*·\s*step\s+(\d+))?$")
EFFORT_LINE = re.compile(r"^(\d+(?:\.\d+)?)\s*(min|h)$")
PCT_BET = re.compile(r"^([A-Za-z_][\w.@]*)\s+([+−-]\d+(?:\.\d+)?)(?:\s+to\s+([+−-]\d+(?:\.\d+)?))?\s*%$")
SPEC_BET = re.compile(r"^(O\d+(?:\.\d+)*)\s*→\s*pass$")
SPEC_IN_WORDS = re.compile(r"Expect:\s*(O\d+(?:\.\d+)*)\s+unverified\s*→\s*pass")
KEYS = ("id", "title", "tier", "owner", "set", "due", "why", "criteria", "roadmap", "effort")


def _read(path: str) -> str:
    with open(path, encoding="utf-8", newline="") as f:
        return f.read()


def _write(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def _minus(v: float) -> str:
    return f"{v:+g}".replace("-", "−")


# ---- the goal note ------------------------------------------------------------------------------------------------

def criterion_text(c: dict, box: dict) -> str:
    """One criterion dict as its vibe-done-when line (ids only)."""
    obj = box["state"]["objective"]["name"]
    k = c["kind"]
    if k == "gates":
        return "gate:all"
    if k == "spec":
        return f"feature:{c['ref']}"
    if k == "objective":
        return f"kpi:{obj}{'@' + c['ruler'] if c.get('ruler') else ''} {c['op']} {c['value']!r}"
    if k in ("gate", "diagnostic"):
        return f"kpi:{c['ref']} {c['op']} {c['value']!r}"
    raise ValueError(f"no file form for criterion kind {k!r}")


def criterion_of(line: str, box: dict) -> dict:
    """A vibe-done-when line back to a criterion dict, resolved against the box. Unknown ids raise with the fix."""
    state = box["state"]
    obj = state["objective"]["name"]
    gates = [g["id"] for g in state["gates"]]
    specs = [r["id"] for r in state["spec"]["requirements"]]
    diags = sorted({k for row in box["ledger"] for k in (row.get("diagnostics") or {})})
    if line == "gate:all":
        return {"kind": "gates"}
    m = re.match(r"^feature:(\S+)$", line)
    if m:
        if m.group(1) not in specs:
            raise ValueError(f"{line}: no requirement {m.group(1)} in specs/ (known: {', '.join(specs)})")
        return {"kind": "spec", "ref": m.group(1)}
    m = re.match(r"^kpi:([^\s@]+)(?:@(\w+))?\s+(<=|<|>=|>|==)\s+(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)$", line)
    if not m:
        raise ValueError(f"{line!r}: write gate:all, feature:<spec id> or kpi:<id> <op> <number>")
    ref, ruler, op, value = m.group(1), m.group(2), m.group(3), float(m.group(4))
    if ref == obj:
        return {"kind": "objective", "op": op, "value": value, **({"ruler": ruler} if ruler else {})}
    if ruler:
        raise ValueError(f"{line}: only the objective ({obj}) takes @<ruler>")
    if ref in gates:
        return {"kind": "gate", "ref": ref, "op": op, "value": value}
    if ref in diags:
        return {"kind": "diagnostic", "ref": ref, "op": op, "value": value}
    raise ValueError(f"{line}: {ref} is not the objective ({obj}), a gate ({', '.join(gates)}) or a ledger "
                     f"diagnostic ({', '.join(diags)})")


def goal_note(g: dict, box: dict) -> str:
    done = "\n".join(f"  - {criterion_text(c, box)}" for c in g["criteria"])
    return (f"---\nvibe-goal: {g['title']}\ntier: {g['tier']}\nowner: {g['owner']}\nset: {g['set']}\ndue: {g['due']}\n"
            f"vibe-done-when:\n{done}\n---\n{g['why']}\n\n"
            f"Its roadmap is every idea in ideas.md with `- Goal: {g['id']}` under it, in plan order. Whether it is met is "
            f"computed from the ledger and the tests, never written here.\n")


def read_note(text: str, gid: str, box: dict) -> dict:
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    if not m:
        raise ValueError(f"goals/{gid}.md: no front matter between --- lines")
    front, body = m.group(1), m.group(2)
    meta: dict = {}
    key = None
    for line in front.split("\n"):
        item = re.match(r"^\s+-\s+(.*)$", line)
        if item and key:
            meta[key].append(item.group(1).strip())
            continue
        kv = re.match(r"^([\w-]+):\s*(.*)$", line)
        if not kv:
            raise ValueError(f"goals/{gid}.md: cannot read front-matter line {line!r}")
        key, value = kv.group(1), kv.group(2).strip()
        meta[key] = value if value else []
    missing = [k for k in ("vibe-goal", "tier", "set", "due", "vibe-done-when") if k not in meta]
    if missing:
        raise ValueError(f"goals/{gid}.md: add {', '.join(missing)} to its front matter")
    if meta["tier"] not in ("must", "stretch"):
        raise ValueError(f"goals/{gid}.md: tier is must or stretch, not {meta['tier']!r}")
    why = body.split("\n\n")[0].strip()
    return {"id": gid, "title": meta["vibe-goal"], "tier": meta["tier"], "owner": meta.get("owner", ""),
            "set": meta["set"], "due": meta["due"], "why": why,
            "criteria": [criterion_of(c, box) for c in meta["vibe-done-when"]]}


# ---- the idea sub-bullets -----------------------------------------------------------------------------------------

def bet_of(idea_json: dict, text: str, objective: str) -> str | None:
    """The structured bet an idea's own words already make, or None: a signed % on the objective, or a spec → pass."""
    e = idea_json.get("expect") or {}
    if e.get("lo") is not None:
        lo, hi = e["lo"], e["hi"]
        return f"{objective} {_minus(lo)} %" if hi in (None, lo) else f"{objective} {_minus(lo)} to {_minus(hi)} %"
    m = SPEC_IN_WORDS.search(text)
    return f"{m.group(1)} → pass" if m else None


def migrate(draft: dict | None = None, box: dict | None = None) -> dict[str, str]:
    """{relative path: text} of example/ from the draft and the fixture's ideas.md (nothing written here)."""
    draft = draft or json.loads(_read(DRAFT))
    box = box or goals_core.load()
    original = _read(FIXTURE_MD)
    ideas_json = {i["id"]: i for i in box["ideas"]["ideas"]}
    by_line = {i["line"]: i["id"] for i in box["ideas"]["ideas"] if i["line"]}
    doc0 = parse(original)
    text = stamp_ids(original, {x.index: by_line[x.line_no] for x in doc0.ideas if x.line_no in by_line})
    doc = parse(text)
    position = {x.block_id: x.index for x in doc.ideas}
    subs: dict[str, list[str]] = {}
    for g in draft["goals"]:
        plan = g["roadmap"]
        in_file = sorted(plan, key=lambda i: position[i])
        stepped = plan != in_file   # WHY: steps only where the plan is not the file's order (the minimal diff)
        for n, iid in enumerate(plan, 1):
            subs.setdefault(iid, []).append(f"- Goal: {g['id']}" + (f" · step {n}" if stepped else ""))
    efforts = {}
    for g in draft["goals"]:
        for iid, m in g.get("effort", {}).items():
            if efforts.get(iid, m) != m:
                raise ValueError(f"{iid}: two goals give it different efforts; effort is the idea's, one number")
            efforts[iid] = m
    objective = box["state"]["objective"]["name"]
    for iid in subs:
        if iid in efforts:
            subs[iid].append(f"- Effort: {efforts[iid]:g} min")
        idea = next(x for x in doc.ideas if x.block_id == iid)
        bet = bet_of(ideas_json[iid], idea.text, objective)
        if bet:
            subs[iid].append(f"- Expect: {bet}")
    for idea in reversed(doc.ideas):
        lines = subs.get(idea.block_id or "")
        if not lines:
            continue
        last = idea.line_no - 1 + len(idea.raw.splitlines(keepends=True)) - 1
        line = doc.lines[last]
        ending = line[len(line.rstrip("\r\n")):]
        assert ending, "an idea on the file's last line without a newline: the undo could not be exact"
        doc.lines[last + 1:last + 1] = [INDENT + s + ending for s in lines]
    out = {"ideas.md": doc.render()}
    for g in draft["goals"]:
        out[f"goals/{g['id']}.md"] = goal_note(g, box)
    return out


def strip(text: str) -> str:
    """example/ideas.md without this format's sub-bullets and block ids: the box's ideas.md as it was."""
    return strip_ids("".join(ln for ln in text.splitlines(keepends=True) if not SUB.match(ln.rstrip("\r\n"))))


def _minutes(value: str, where: str) -> float:
    m = EFFORT_LINE.match(value)
    if not m:
        raise ValueError(f"{where}: '- Effort: {value}': write minutes or hours, e.g. '- Effort: 45 min' or '1.5 h'")
    n = float(m.group(1)) * (60 if m.group(2) == "h" else 1)
    return int(n) if n == int(n) else n


def _bet(value: str, where: str, box: dict) -> dict:
    state = box["state"]
    m = PCT_BET.match(value)
    if m:
        ref = m.group(1)
        known = [state["objective"]["name"]] + [g["id"] for g in state["gates"]]
        if ref not in known:
            raise ValueError(f"{where}: '- Expect: {value}': {ref} is not the objective or a gate ({', '.join(known)})")
        lo = float(m.group(2).replace("−", "-"))
        hi = float(m.group(3).replace("−", "-")) if m.group(3) else lo
        return {"kind": "pct", "ref": ref, "lo": lo, "hi": hi, "text": value}
    m = SPEC_BET.match(value)
    if m:
        if m.group(1) not in [r["id"] for r in state["spec"]["requirements"]]:
            raise ValueError(f"{where}: '- Expect: {value}': no requirement {m.group(1)} in specs/")
        return {"kind": "spec", "ref": m.group(1), "text": value}
    raise ValueError(f"{where}: '- Expect: {value}': write '<objective or gate> −4 %' (a range: '−10 to −20 %') "
                     f"or '<spec id> → pass'; or delete the line (no number bet)")


def read(folder: str = EXAMPLE, box: dict | None = None) -> dict:
    """{"goals": [goal dicts, as goals_core reads them], "ideas": {I-NNN: {goals, steps, effort, expect, index}}}."""
    box = box or goals_core.load()
    gdir = os.path.join(folder, "goals")
    notes = {f[:-3]: _read(os.path.join(gdir, f)) for f in sorted(os.listdir(gdir)) if f.endswith(".md")}
    goals = {gid: read_note(text, gid, box) for gid, text in notes.items()}
    doc = parse(_read(os.path.join(folder, "ideas.md")))
    ideas: dict[str, dict] = {}
    for idea in doc.ideas:
        if not idea.block_id:
            continue
        rec = {"goals": [], "steps": {}, "effort": None, "expect": None, "index": idea.index}
        where = f"ideas.md line {idea.line_no} (^{idea.block_id})"
        for line in idea.raw.splitlines()[1:]:
            m = SUB.match(line)
            if not m:
                continue
            key, value = m.groups()
            if key == "Goal":
                g = GOAL_LINE.match(value)
                if not g:
                    raise ValueError(f"{where}: '- Goal: {value}': write '- Goal: G2' or '- Goal: G2 · step 1'")
                if g.group(1) not in goals:
                    raise ValueError(f"{where}: '- Goal: {g.group(1)}': there is no goals/{g.group(1)}.md "
                                     f"(goals: {', '.join(goals)}); add the note or fix the id")
                rec["goals"].append(g.group(1))
                if g.group(2):
                    rec["steps"][g.group(1)] = int(g.group(2))
            elif key == "Effort":
                rec["effort"] = _minutes(value, where)
            else:
                rec["expect"] = _bet(value, where, box)
        ideas[idea.block_id] = rec
    for gid, g in goals.items():
        mine = [(iid, r) for iid, r in ideas.items() if gid in r["goals"]]
        # stepped ideas first by their step, the rest after them in file order
        mine.sort(key=lambda x: (0, x[1]["steps"][gid], x[1]["index"]) if gid in x[1]["steps"] else (1, 0, x[1]["index"]))
        g["roadmap"] = [iid for iid, _ in mine]
        g["effort"] = {iid: r["effort"] for iid, r in mine if r["effort"] is not None}
    return {"goals": [goals[k] for k in sorted(goals, key=lambda s: int(s[1:]))], "ideas": ideas}


def check(folder: str = EXAMPLE) -> list[str]:
    """Every difference between what example/ reads back and the draft's goals, and whether strip is exact."""
    box = goals_core.load()
    draft = json.loads(_read(DRAFT))["goals"]
    got = {g["id"]: g for g in read(folder, box)["goals"]}
    bad = []
    for want in draft:
        have = got.get(want["id"])
        if not have:
            bad.append(f"{want['id']}: not read back")
            continue
        for k in KEYS:
            if have.get(k) != want.get(k):
                bad.append(f"{want['id']}.{k}: read {have.get(k)!r}, draft {want.get(k)!r}")
    if set(got) - {g["id"] for g in draft}:
        bad.append(f"extra goals read: {sorted(set(got) - {g['id'] for g in draft})}")
    if strip(_read(os.path.join(folder, "ideas.md"))) != _read(FIXTURE_MD):
        bad.append("strip(example/ideas.md) is not the fixture's ideas.md byte for byte")
    return bad


def main(argv: list[str]) -> int:
    cmd = argv[1] if len(argv) > 1 else "check"
    if cmd == "migrate":
        for rel, text in migrate().items():
            _write(os.path.join(EXAMPLE, rel), text)
            print("wrote", os.path.join("example", rel))
        bad = check()
        print("check:", "lossless" if not bad else bad)
        return 1 if bad else 0
    if cmd == "read":
        print(json.dumps(read(), ensure_ascii=False, indent=1))
        return 0
    if cmd == "strip":
        sys.stdout.write(strip(_read(os.path.join(EXAMPLE, "ideas.md"))))
        return 0
    if cmd == "check":
        bad = check()
        print("check:", "lossless (3 goals == goals.draft.json; strip == fixture ideas.md)" if not bad else "\n".join(bad))
        return 1 if bad else 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
