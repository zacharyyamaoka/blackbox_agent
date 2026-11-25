"""Proposal 01 · Destination: a goal is one Markdown note whose front matter is a Vibe Tracks destination
(vibe-goal, vibe-done-when, vibe-target, keys byte-identical to vt-track/1), plus the few keys a goal adds (tier, set,
owner, roadmap, effort) and the two the agent writes each tick (estimate, estimate-why). Stdlib only.

    python3 format.py migrate     # writes example/goals/*.md from ../_shared/goals.draft.json
    python3 format.py read        # prints the goals it reads back (goals_core's GOAL dicts)
    python3 format.py tick        # the agent's tick: writes estimate + estimate-why into each note, nothing else
    python3 format.py check       # read == the draft's goals (lossless), and every refusal fires with its fix

The done-when grammar is VT's own (vt-track-1.schema.json): `kpi:<id> <op> <value>`, `gate:<id>`, `feature:<id>`,
`test:<id>`, each optionally ` in <x>`. How each maps onto goals_core's criteria:

    gate:all                         every gate passes on every dev task            {"kind": "gates"}
    kpi:<gate id> <op> <value>       a gate's measure, tightened                    {"kind": "gate", ...}
    kpi:<objective> <op> <value>     the box's objective                            {"kind": "objective", ...}
    kpi:<diagnostic> <op> <value>    a reported diagnostic                          {"kind": "diagnostic", ...}
    feature:<spec id>                a spec requirement, all its tests pass         {"kind": "spec", "ref": ...}
    kpi:... in ruler-v2              read on a ruler that does not exist yet        + "ruler": "v2"
    kpi:... in holdout               refused (holdout is reporting-only)            + "split": "holdout"

WHY `gate:all`: VT's `gate:<id>` names one gate, and VT already reserves `all` to mean every member (vibetracks/spec/
config.py: "'all' is reserved: it means every suite"). Listing the five gate ids would go stale the day OBJECTIVES.md
adds a gate, and would push G2 to 9 lines, past VT's 8-line cap.
WHY a tightened gate is `kpi:`: VT's `gate:<id>` takes no number; a tighter threshold is a target on what the gate
measures, so it is VT's measure form. The fold knows it is a gate because the id is one of the box's gate ids
(OBJECTIVES.md, via state.json `gates[]`), and goals_core then refuses it if it is looser than the ruler's own.
WHY ruler v2 is ` in ruler-v2`: VT's ` in <track>` says where a number is read from; here it names the ruler that
reads it. VT gap: in VT the word after `in` must be a descendant track.
VT gap: `vibe-target` is date-only (`^\\d{4}-\\d{2}-\\d{2}$`); a goal has a time, so it is an ISO date-time with its
offset (a date alone still reads, as the end of that day).
"""

from __future__ import annotations

import copy
import difflib
import json
import os
import re
import sys
import tempfile
from datetime import datetime
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
SHARED = os.path.join(HERE, "..", "_shared")
sys.path.insert(0, SHARED)
import goals_core  # noqa: E402

GOALS_DIR = os.path.join(HERE, "example", "goals")
DRAFT = os.path.join(SHARED, "goals.draft.json")

# The keys a goal note may carry. vibe-* are VT's own, spelled as VT spells them; the rest are a goal's additions,
# un-prefixed because VT ignores un-prefixed keys (so a goal never trips VT's strict check on them).
VT_KEYS = ["vibe-goal", "vibe-done-when", "vibe-target"]
GOAL_KEYS = ["tier", "set", "owner", "roadmap", "effort"]
AGENT_KEYS = ["estimate", "estimate-why"]       # written by the agent each tick; the reader never needs them
KNOWN = VT_KEYS + GOAL_KEYS + AGENT_KEYS
REQUIRED = ["vibe-goal", "vibe-done-when", "vibe-target", "tier"]
TIERS = ["must", "stretch"]
CONDITION = re.compile(r"^(kpi:(?P<kid>[^ ]+) (?P<op>>=|<=|>|<|==) (?P<val>-?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?)"
                       r"|gate:(?P<gid>[^ ]+)|feature:(?P<fid>[^ ]+)|test:(?P<tid>[^ ]+))( in (?P<where>[a-z0-9][a-z0-9-]{0,62}))?$")


class GoalError(ValueError):
    """A note the fold refuses, with the line and the fix."""


# --------------------------------------------------------------------------------------------------- YAML subset

def _scalar(text: str):
    t = text.strip()
    if t.startswith('"'):
        return json.loads(t)
    if t.startswith("'") and t.endswith("'"):
        return t[1:-1].replace("''", "'")
    if t.startswith("["):
        inner = t[1:-1].strip()
        return [_scalar(p) for p in _split(inner)] if inner else []
    if t.startswith("{"):
        inner = t[1:-1].strip()
        out = {}
        for part in _split(inner) if inner else []:
            k, _, v = part.partition(":")
            out[k.strip()] = _scalar(v)
        return out
    if " #" in t:
        t = t.split(" #", 1)[0].rstrip()
    return t


def _split(text: str) -> list[str]:
    """Split a flow collection's inside on top-level commas (quotes and brackets respected)."""
    parts, depth, quote, cur = [], 0, None, ""
    for ch in text:
        if quote:
            cur += ch
            if ch == quote:
                quote = None
            continue
        if ch in "\"'":
            quote = ch
        elif ch in "[{":
            depth += 1
        elif ch in "]}":
            depth -= 1
        elif ch == "," and depth == 0:
            parts.append(cur.strip())
            cur = ""
            continue
        cur += ch
    if cur.strip():
        parts.append(cur.strip())
    return parts


def split_note(text: str) -> tuple[list[str], str]:
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        raise GoalError("line 1: a goal note starts with '---' (YAML front matter)")
    for n in range(1, len(lines)):
        if lines[n].strip() == "---":
            return lines[1:n], "\n".join(lines[n + 1:])
    raise GoalError("the front matter never closes with '---'")


def parse_front(lines: list[str]) -> dict:
    """key: value, flow [..] / {..}, quoted strings, and a block list or map under an empty key."""
    out: dict = {}
    key = None
    for n, raw in enumerate(lines, 2):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        if raw[0] in " \t":
            if key is None:
                raise GoalError(f"line {n}: indented line with no key above it")
            item = raw.strip()
            if item.startswith("- "):
                if not isinstance(out[key], list):
                    out[key] = []
                out[key].append(_scalar(item[2:]))
            else:
                k, sep, v = item.partition(":")
                if not sep:
                    raise GoalError(f"line {n}: expected '- item' or 'key: value' under {key}")
                if not isinstance(out[key], dict):
                    out[key] = {}
                out[key][k.strip()] = _scalar(v)
            continue
        k, sep, v = raw.partition(":")
        if not sep:
            raise GoalError(f"line {n}: expected 'key: value'")
        key = k.strip()
        out[key] = _scalar(v) if v.strip() else None
    return out


# --------------------------------------------------------------------------------------------------- the box's ids

def box_ids(box: dict) -> dict:
    state = box["state"]
    diags = set()
    for row in box["ledger"]:
        if row.get("split") == "dev":
            diags |= set((row.get("diagnostics") or {}).keys())
    return {
        "objective": state["objective"]["name"],
        "gates": [g["id"] for g in state["gates"]],
        "diagnostics": sorted(diags - {g["id"] for g in state["gates"]}),
        "specs": [r["id"] for r in state["spec"]["requirements"]],
        "ideas": [i["id"] for i in box["ideas"]["ideas"]],
    }


def _did_you_mean(word: str, options: list[str]) -> str:
    near = difflib.get_close_matches(word, options, n=1, cutoff=0.5)
    return f" (did you mean {near[0]}?)" if near else ""


def _number(text: str) -> float:
    v = float(Decimal(text))
    return int(v) if v.is_integer() and "." not in text and "e" not in text.lower() else v


def condition(text: str, ids: dict, where: str) -> dict:
    """One vibe-done-when line → one goals_core criterion, or a refusal naming the fix."""
    m = CONDITION.match(text.strip())
    if not m:
        raise GoalError(f"{where}: '{text}' is not VT's done-when grammar: kpi:<id> <op> <value> | gate:<id> | "
                        f"feature:<id> | test:<id>, optionally ' in <x>'")
    extra = {}
    if m["where"]:
        if m["where"] == "holdout":
            extra["split"] = "holdout"
        elif m["where"].startswith("ruler-"):
            extra["ruler"] = m["where"][len("ruler-"):]
        else:
            raise GoalError(f"{where}: '{text}': ' in {m['where']}' names no ruler; a goal reads one box, so the only "
                            f"places are ruler-<version> (e.g. ruler-v2)")
    if m["gid"]:
        if m["gid"] == "all":
            return {"kind": "gates", **extra}
        hint = f"kpi:{m['gid']} <= <tighter value>" if m["gid"] in ids["gates"] else "gate:all"
        raise GoalError(f"{where}: '{text}': a goal does not pick single gates (the rest would be dropped, a loosened "
                        f"ruler). Write gate:all for every gate, and {hint} to tighten one"
                        + ("" if m["gid"] in ids["gates"] else f"; no gate named {m['gid']}{_did_you_mean(m['gid'], ids['gates'])}"))
    if m["fid"]:
        if m["fid"] not in ids["specs"]:
            raise GoalError(f"{where}: '{text}': no requirement {m['fid']} in specs/{_did_you_mean(m['fid'], ids['specs'])}")
        return {"kind": "spec", "ref": m["fid"], **extra}
    if m["tid"]:
        raise GoalError(f"{where}: '{text}': a single test is not judged here yet; name the spec it verifies, "
                        f"feature:<spec id> (specs: {', '.join(ids['specs'][:4])}, …)")
    kid, op, value = m["kid"], m["op"], _number(m["val"])
    if kid == ids["objective"]:
        return {"kind": "objective", "op": op, "value": value, **extra}
    if kid in ids["gates"]:
        return {"kind": "gate", "ref": kid, "op": op, "value": value, **extra}
    if kid in ids["diagnostics"]:
        return {"kind": "diagnostic", "ref": kid, "op": op, "value": value, **extra}
    every = [ids["objective"], *ids["gates"], *ids["diagnostics"]]
    raise GoalError(f"{where}: '{text}': this box measures no {kid}{_did_you_mean(kid, every)}. Objective: "
                    f"{ids['objective']}; gates: {', '.join(ids['gates'])}; diagnostics: {', '.join(ids['diagnostics'])}")


def _when(text, where: str, key: str) -> str:
    t = str(text).strip()
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", t):
            t += "T23:59:00" + goals_core.AS_OF[-6:]          # VT's date-only form: the end of that day, box time
        dt = datetime.fromisoformat(t)
    except ValueError as e:
        raise GoalError(f"{where}: {key}: '{text}' is not an ISO date-time (2026-11-27T17:00-07:00)") from e
    if dt.tzinfo is None:                                     # no offset written: the box's clock (AS_OF's offset)
        dt = datetime.fromisoformat(dt.isoformat() + goals_core.AS_OF[-6:])
    return dt.isoformat()


def note_to_goal(path: str, text: str, ids: dict, box: dict) -> dict:
    name = os.path.basename(path)
    gid = name.split("-", 1)[0]
    if not re.fullmatch(r"G\d+", gid):
        raise GoalError(f"{name}: the file name starts with the goal's id, G<n>-<words>.md")
    front, body = split_note(text)
    meta = parse_front(front)
    for k in meta:
        if k.startswith("vibe-") and k not in VT_KEYS:
            raise GoalError(f"{name}: '{k}' is not a destination key; a goal note uses {', '.join(VT_KEYS)}"
                            f"{_did_you_mean(k, VT_KEYS)}")
        if not k.startswith("vibe-") and k not in KNOWN and k not in ("tags", "aliases"):
            raise GoalError(f"{name}: unknown key '{k}'{_did_you_mean(k, KNOWN)}")
    for k in REQUIRED:
        if meta.get(k) in (None, "", []):
            raise GoalError(f"{name}: '{k}' is missing")
    if meta["tier"] not in TIERS:
        raise GoalError(f"{name}: tier '{meta['tier']}' is not one of {', '.join(TIERS)}")
    lines = meta["vibe-done-when"] if isinstance(meta["vibe-done-when"], list) else [meta["vibe-done-when"]]
    if len(lines) > 8:
        raise GoalError(f"{name}: vibe-done-when has {len(lines)} lines; VT's cap is 8")
    criteria = [condition(str(c), ids, f"{name} vibe-done-when[{i}]") for i, c in enumerate(lines)]
    roadmap = [str(i) for i in (meta.get("roadmap") or [])]
    for iid in roadmap:
        if iid not in ids["ideas"]:
            raise GoalError(f"{name}: roadmap names {iid}, which is not in ideas.md{_did_you_mean(iid, ids['ideas'])}")
    effort = {str(k): _number(str(v)) for k, v in (meta.get("effort") or {}).items()}
    for iid in effort:
        if iid not in roadmap:
            raise GoalError(f"{name}: effort names {iid}, which is not on this goal's roadmap")
    goal = {
        "id": gid, "title": str(meta["vibe-goal"]), "tier": meta["tier"], "owner": str(meta.get("owner") or ""),
        "set": _when(meta["set"], name, "set") if meta.get("set") else None,
        "due": _when(meta["vibe-target"], name, "vibe-target"),
        "why": body.strip(), "criteria": criteria, "roadmap": roadmap, "effort": effort,
    }
    # The ruler stays untouched: goals_core's own refusals that can never become true (a loosened gate, holdout) stop
    # the note; the ones that are only "not yet" (ruler v2, a deferred spec) load, and the page shows them as such.
    for i, c in enumerate(criteria):
        why = goals_core._refusal(c, box)
        if why and not (c.get("ruler") or (c["kind"] == "spec" and "deferred" in why)):
            raise GoalError(f"{name} vibe-done-when[{i}] '{lines[i]}': {why}")
    return goal


def note_extras(text: str) -> dict:
    """What the agent wrote into the note, and the done-when lines as written (for display)."""
    meta = parse_front(split_note(text)[0])
    lines = meta["vibe-done-when"] if isinstance(meta["vibe-done-when"], list) else [meta["vibe-done-when"]]
    return {"estimate": meta.get("estimate"), "estimate_why": meta.get("estimate-why"), "done_when": [str(x) for x in lines]}


def read(folder: str = GOALS_DIR, box: dict | None = None) -> list[dict]:
    box = box or goals_core.load()
    ids = box_ids(box)
    goals = []
    for name in sorted(os.listdir(folder), key=lambda n: (int(re.match(r"G(\d+)", n)[1]) if re.match(r"G\d+", n) else 1e9, n)):
        if not name.endswith(".md"):
            continue
        path = os.path.join(folder, name)
        with open(path, encoding="utf-8") as f:
            goals.append(note_to_goal(path, f.read(), ids, box))
    return goals


# --------------------------------------------------------------------------------------------------- writing

def _num_text(v) -> str:
    return str(v) if isinstance(v, (Decimal, int)) else repr(v)


def condition_text(c: dict, objective: str) -> str:
    where = f" in ruler-{c['ruler']}" if c.get("ruler") else (" in holdout" if c.get("split") == "holdout" else "")
    k = c["kind"]
    if k == "gates":
        return "gate:all" + where
    if k == "spec":
        return f"feature:{c['ref']}" + where
    ref = objective if k == "objective" else c["ref"]
    return f"kpi:{ref} {c['op']} {_num_text(c['value'])}" + where


def _short(iso: str) -> str:
    """2026-11-27T17:00:00-07:00 → 2026-11-27T17:00-07:00 (seconds only when they are not zero)."""
    dt = datetime.fromisoformat(iso)
    return dt.isoformat(timespec="minutes" if dt.second == 0 else "seconds")


def slug(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")


def render(goal: dict, objective: str, estimate: tuple[str, str] | None = None) -> str:
    q = lambda s: json.dumps(s, ensure_ascii=False)  # noqa: E731  YAML double-quoted = JSON's escapes
    out = ["---", f"vibe-goal: {goal['title']}", "vibe-done-when:"]
    out += [f"  - {condition_text(c, objective)}" for c in goal["criteria"]]
    out += [f"vibe-target: {_short(goal['due'])}", f"tier: {goal['tier']}"]
    if goal.get("set"):
        out.append(f"set: {_short(goal['set'])}")
    if goal.get("owner"):
        out.append(f"owner: {goal['owner']}")
    out.append("roadmap: [" + ", ".join(goal.get("roadmap", [])) + "]")
    if goal.get("effort"):
        out.append("effort: {" + ", ".join(f"{k}: {_num_text(v)}" for k, v in goal["effort"].items()) + "}")
    if estimate:
        out += [f"estimate: {estimate[0]}", f"estimate-why: {q(estimate[1])}"]
    out += ["---", "", goal.get("why", "").strip(), ""]
    return "\n".join(out)


def migrate(folder: str = GOALS_DIR) -> list[str]:
    with open(DRAFT, encoding="utf-8") as f:
        draft = json.load(f, parse_float=Decimal)       # keeps 0.030 as written, not 0.03
    objective = goals_core.load()["state"]["objective"]["name"]
    os.makedirs(folder, exist_ok=True)
    for old in os.listdir(folder):
        if old.endswith(".md"):
            os.remove(os.path.join(folder, old))
    written = []
    for g in draft["goals"]:
        path = os.path.join(folder, f"{g['id']}-{slug(g['title'])}.md")
        with open(path, "w", encoding="utf-8") as f:
            f.write(render(g, objective))
        written.append(path)
    return written


# --------------------------------------------------------------------------------------------------- the agent's tick

def _clock(iso: str) -> str:
    dt = datetime.fromisoformat(iso)
    return f"{dt:%H:%M} {dt:%b} {dt.day}"


def _hours(h: float) -> str:
    return f"{abs(h):.1f} h"


def estimate_word(goal: dict, box: dict, as_of: str = goals_core.AS_OF) -> tuple[str, str]:
    """The agent's stated estimate and its one-sentence why, from goals_core (evaluate + bottom_up, buffer ×2)."""
    ev = goals_core.evaluate(copy.deepcopy(goal), box, as_of)
    bu = goals_core.bottom_up(goal, box, as_of)
    if ev["status"].startswith("met"):
        early = (datetime.fromisoformat(goal["due"]) - datetime.fromisoformat(ev["met_at"])).total_seconds() / 3600
        return (_short(ev["met_at"]), f"Met at {_clock(ev['met_at'])} by {ev['met_by']} (measured, not estimated), "
                f"{_hours(early)} {'before' if early >= 0 else 'after'} the target; nothing left on its roadmap to estimate.")
    undated = [s for s in bu["steps"] if not s.get("dated", True)]
    if undated:
        # plan order puts agent work behind Zach's waits: no date can be written, only what it waits for and then how long
        after = undated[0]["after_waits"]
        more = sum(s["buffered"] for s in undated)
        dated = [s for s in bu["steps"] if s.get("dated", True)]
        lead = (f"{', '.join(s['id'] for s in dated)} first, done {_clock(dated[-1]['end'])}; " if dated else "")
        return (f"after {', '.join(after)}, then {more:g} min",
                f"{lead}{', '.join(after)} wait{'s' if len(after) == 1 else ''} on Zach and {'is' if len(after) == 1 else 'are'} not sized, "
                f"so no date: after {'it' if len(after) == 1 else 'them'}, "
                + ", ".join(f"{s['id']} {s['minutes']:g}" for s in undated) + f" agent minutes × {bu['buffer']:g} buffer = {more:g} min.")
    steps = ", ".join(f"{s['id']} {s['minutes']:g}" for s in bu["steps"])
    sentence = (f"{bu['agent_minutes']:g} agent minutes ({steps}) × {bu['buffer']:g} buffer from {_clock(as_of)}"
                if bu["steps"] else f"no agent work left on its roadmap, from {_clock(as_of)}")
    if bu["unestimated"]:
        sentence += "; " + ", ".join(u["id"] for u in bu["unestimated"]) + " not estimated"
    if bu["waits_on_zach"]:
        ws = [w["id"] for w in bu["waits_on_zach"]]
        sentence += f"; {', '.join(ws)} wait{'s' if len(ws) == 1 else ''} on Zach and {'is' if len(ws) == 1 else 'are'} not sized"
    return _short(bu["estimate_if_started_now"]), sentence + "."


def tick(folder: str = GOALS_DIR, as_of: str = goals_core.AS_OF) -> list[tuple[str, str, str]]:
    """Rewrite only the estimate and estimate-why lines of each note; every other byte stays as Zach left it."""
    box = goals_core.load()
    goals = {g["id"]: g for g in read(folder, box)}
    done = []
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".md"):
            continue
        path = os.path.join(folder, name)
        with open(path, encoding="utf-8") as f:
            text = f.read()
        when, why = estimate_word(goals[name.split("-", 1)[0]], box, as_of)
        front, body = split_note(text)
        kept = [ln for ln in front if not re.match(r"^(estimate|estimate-why):", ln)]
        shown = when if re.match(r"\d{4}-", when) else json.dumps(when, ensure_ascii=False)
        kept += [f"estimate: {shown}", f"estimate-why: {json.dumps(why, ensure_ascii=False)}"]
        new = "\n".join(["---", *kept, "---"]) + "\n" + body
        if new != text:
            with open(path, "w", encoding="utf-8") as f:
                f.write(new)
        done.append((name, when, why))
    return done


# --------------------------------------------------------------------------------------------------- check

FIELDS = ["id", "title", "tier", "set", "due", "criteria", "roadmap", "effort", "owner", "why"]


def _norm(goal: dict) -> dict:
    g = json.loads(json.dumps({k: goal.get(k) for k in FIELDS}, default=float))
    for c in g["criteria"]:
        if "value" in c:
            c["value"] = float(c["value"])
    g["effort"] = {k: float(v) for k, v in (g["effort"] or {}).items()}
    return g


def check() -> None:
    with open(DRAFT, encoding="utf-8") as f:
        draft = json.load(f)["goals"]
    box = goals_core.load()
    got = read(GOALS_DIR, box)
    assert [g["id"] for g in got] == [g["id"] for g in draft], ([g["id"] for g in got], [g["id"] for g in draft])
    for a, b in zip(got, draft):
        na, nb = _norm(a), _norm(b)
        for k in FIELDS:
            assert na[k] == nb[k], f"{a['id']}.{k}: read {na[k]!r} != draft {nb[k]!r}"
    # migrate → read is lossless from a fresh folder too (not only the ticked example)
    with tempfile.TemporaryDirectory() as tmp:
        migrate(tmp)
        assert [_norm(g) for g in read(tmp, box)] == [_norm(g) for g in draft], "fresh migrate does not read back"

    ids = box_ids(box)
    head = "---\nvibe-goal: x\nvibe-target: 2026-11-27T17:00-07:00\ntier: must\nvibe-done-when:\n  - {}\n---\n"
    refusals = {
        "kpi:tool_track_rms <= 0.03": "did you mean tool_track_rms_mm",
        "kpi:saturation_share_pct <= 3": "never loosen",
        "kpi:tool_track_rms_mm <= 0.03 in holdout": "holdout is reporting-only",
        "feature:O9.9": "no requirement O9.9",
        "gate:stop_error_max_mm": "kpi:stop_error_max_mm <= <tighter value>",
        "test:test_boundary": "name the spec it verifies",
        "kpi:tool_track_rms_mm <= 0.03 in arm": "names no ruler",
        "kpi:tool_track_rms_mm < = 0.03": "not VT's done-when grammar",
    }
    for line, needle in refusals.items():
        try:
            note_to_goal("G9-x.md", head.format(line), ids, box)
        except GoalError as e:
            assert needle in str(e), f"{line}: refused, but without '{needle}': {e}"
        else:
            raise AssertionError(f"{line}: not refused")
    for text, needle in [(head.format("gate:all").replace("tier: must", "tier: maybe"), "not one of must, stretch"),
                         (head.format("gate:all").replace("vibe-goal", "vibe-gaol"), "did you mean vibe-goal"),
                         (head.format("gate:all").replace("---\n", "---\nroadmap: [I-099]\n", 1), "not in ideas.md")]:
        try:
            note_to_goal("G9-x.md", text, ids, box)
        except GoalError as e:
            assert needle in str(e), f"refused, but without '{needle}': {e}"
        else:
            raise AssertionError(f"not refused: {needle}")
    # "not yet" loads: ruler v2 and a deferred spec are cannot-judge, never a refusal
    ok = note_to_goal("G9-x.md", head.format("kpi:tool_track_rms_mm <= 0.05 in ruler-v2").replace(
        "  - kpi", "  - feature:O5.1\n  - kpi"), ids, box)
    assert ok["criteria"] == [{"kind": "spec", "ref": "O5.1"}, {"kind": "objective", "op": "<=", "value": 0.05, "ruler": "v2"}]
    # a date-only vibe-target (VT's own form) still reads
    assert note_to_goal("G9-x.md", head.format("gate:all").replace("2026-11-27T17:00-07:00", "2026-11-27"), ids, box)["due"] \
        == "2026-11-27T23:59:00-07:00"
    print(f"check: {len(got)} goals read back == goals.draft.json ({', '.join(FIELDS)}); "
          f"{len(refusals) + 3} refusals fire with their fix; ruler v2 / deferred spec load as not-yet")


def main(argv: list[str]) -> int:
    cmd = argv[1] if len(argv) > 1 else "read"
    if cmd == "migrate":
        for p in migrate():
            print("wrote", os.path.relpath(p, HERE))
    elif cmd == "read":
        print(json.dumps(read(), indent=1, ensure_ascii=False))
    elif cmd == "tick":
        for name, when, why in tick():
            print(f"{name}: estimate {when} · {why}")
    elif cmd == "check":
        check()
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
