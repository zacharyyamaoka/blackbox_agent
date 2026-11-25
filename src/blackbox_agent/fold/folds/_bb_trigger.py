"""`bb-trigger/1`: one row of a box's `triggers.jsonl` (viewer/CONTRACT.md §22). The hand-authored type, as a frozen
dataclass; `viewer/schemas/trigger.schema.json` is GENERATED from it (`python3 viewer/tools/folds/_bb_trigger.py
--schema > viewer/schemas/trigger.schema.json`; tests/test_triggers.py holds the committed file to this output).

Not a slice (the leading underscore). Stdlib only.

A trigger is new data reaching a box (a bug report, a gate turning red, a reminder, ...). `triggers.jsonl` is
append-only: the first row of an id opens the trigger (box, kind, source, status), and later rows of the same id carry
only what changed (status, routed_to, filled_by_agent, more evidence). The fold merges them in file order (`merge`).

Who fills what (Zach: "each trigger has some fields that are automatically filed in, and then some that the triggered
agent can fill in after the fact"): AUTO fields are written by whatever noticed the data (a watcher, the dispatcher);
`filled_by_agent` is written by the agent the trigger was routed to, after the fact.

The agent CLAIMS; the box VERIFIES (0.1.14, agent_activity_agent's gap 1). `filled_by_agent` names its evidence (a spec,
a gate, a receipt), but naming a spec is not running it: a condition is met only when the box itself ran the check and
wrote `verified_by_box {at, commit, result: pass, how}` in its own row, after the claim (`acceptance`). A claim alone
reads "claimed, not verified". WHY: before this, an agent could mark its own trigger met by typing a spec id.

Importable as `blackbox_agent.trigger` (package/src/blackbox_agent/trigger.py loads THIS file from the installed fold,
never a copy), so a box can `from blackbox_agent.trigger import Trigger` offline.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field, fields
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _bb_actions as actions_mod  # noqa: E402
from _bb_actions import ACCEPTS, EVIDENCE, Action  # noqa: E402

SCHEMA = "bb-trigger/1"
STATUSES = ("new", "settling", "dispatched", "done", "obsolete")
# a merged trigger's acceptance (`acceptance`), best to worst for the eye; only `met` counts as done-and-proved
ACCEPTANCE = ("met", "claimed, not verified", "verify failed", "waiting", "unmet", "not needed")
SOURCE_KINDS = ("path", "url", "unit", "ref")  # which key a source names; a source is one place
ISO = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$"
SLUG = r"^[a-z0-9][a-z0-9-]*$"
_iso = {"type": "string", "pattern": ISO}
_str = {"type": "string", "minLength": 1}
_sha = {"type": "string", "pattern": "^[0-9a-f]{7,40}$"}


def _f(schema: dict, auto: bool = True, merge: str = "replace", default=None, doc: str = ""):
    """A field with its JSON schema, who fills it (auto or the routed agent), and how a later row merges into it."""
    return field(default=default, metadata={"schema": schema, "auto": auto, "merge": merge, "doc": doc})


@dataclass(frozen=True)
class Trigger:
    """One trigger, merged from its rows. Field order = the schema's property order."""

    schema: str = _f({"const": SCHEMA}, doc="always bb-trigger/1")
    id: str = _f(_str, doc="stable across the trigger's rows, e.g. tr-20261125-0930-gate-red")
    t: str = _f(_iso, doc="when this row was written (ISO 8601 with offset)")
    box: str | None = _f(_str, doc="the box's repo name")
    kind: str | None = _f({"type": "string", "pattern": SLUG},
                          doc="new-bug-report | gate-red | regressed | unit-failed | watcher-red | feedback | reminder, or "
                              "a kind a box action names")
    title: str | None = _f({"type": "string"}, doc="one line: what happened")
    key: str | None = _f(_str, doc="the dedupe key: the noticer's own name for this new data (e.g. "
                                   "unit:foo.service:failed), so a second notice of it joins the open trigger")
    track: str | None = _f(_str, doc="the track it routes by (one agent per track)")
    repo: str | None = _f(_str, doc="the repo the new data is about, when it is not the box itself")
    source: dict | None = _f({"type": "object", "additionalProperties": False,
                              "anyOf": [{"required": [k]} for k in SOURCE_KINDS],
                              "properties": {"path": _str, "url": _str, "unit": _str, "ref": _str,
                                             "line": {"type": "integer", "minimum": 1}, "commit": _sha}},
                             merge="dict", doc="where the new data is: a path in the box (and line, commit), a url, a "
                                               "unit (e.g. foo.service) or a git ref (a sha or a name)")
    evidence: tuple = _f({"type": "array", "items": {"type": "string"}}, merge="union", default=(),
                         doc="what the noticer saw, one line or path each; the settled events' lines are appended")
    action: str | None = _f({"type": "string", "pattern": SLUG},
                            doc="the action asked for; absent = the kind's default in the actions catalog")
    accept: str | None = _f({"enum": list(ACCEPTS)}, doc="the acceptance condition; absent = the action's")
    status: str | None = _f({"enum": list(STATUSES)}, doc="new | settling | dispatched | done | obsolete")
    settle: dict | None = _f({"type": "object", "additionalProperties": False,
                              "properties": {"window_s": {"type": "integer", "minimum": 0},
                                             "cap_s": {"type": "integer", "minimum": 0},
                                             "opened": _iso, "closed": _iso,
                                             "events": {"type": "integer", "minimum": 1}}},
                             merge="dict", doc="the settling window used: each event resets window_s, cap_s ends it")
    routed_to: dict | None = _f({"type": ["object", "null"], "required": ["agent"], "additionalProperties": False,
                                 "properties": {"agent": _str, "session": {"type": ["string", "null"]},
                                                "account": {"type": ["string", "null"]},
                                                "spawned": {"type": "boolean"},
                                                "dispatch": {"type": ["string", "null"]}}},
                                merge="dict", doc="the agent (and session) it went to; spawned = a new agent was started; "
                                                  "dispatch = the dispatcher's id for the dispatch that carried it")
    filled_by_agent: dict | None = _f({"type": ["object", "null"], "additionalProperties": True,
                                       "properties": {"agent": _str, "model": {"type": "string"},
                                                      "session": {"type": "string"}, "at": _iso,
                                                      "outcome": {"type": "string"},
                                                      "spec": {"type": "string"}, "commit": {"type": "string"},
                                                      "gate": {"type": "string"}, "received_at": _iso,
                                                      "human": {"type": "string"},
                                                      "audit": {"type": "object", "required": ["verdict"],
                                                                "properties": {"by": {"type": "string"},
                                                                               "model": {"type": "string"},
                                                                               "verdict": {"enum": ["pass", "fail"]}}}}},
                                      auto=False, merge="dict",
                                      doc="written by the routed agent after the fact: outcome, and the evidence its "
                                          "acceptance condition needs (spec, gate/commit, received_at, human, audit). "
                                          "A claim: it counts only once the box verifies it (verified_by_box)")
    verified_by_box: dict | None = _f({"type": ["object", "null"], "required": ["at", "commit", "result", "how"],
                                       "additionalProperties": False,
                                       "properties": {"at": _iso, "commit": _sha, "result": {"enum": ["pass", "fail"]},
                                                      "how": _str}},
                                      doc="written by the box (its watcher or the dispatcher), never the routed agent, "
                                          "in its own row after the claim: it ran the check (how) at commit, and the "
                                          "result. The only thing that makes a condition met")

    def row(self) -> dict:
        """This trigger as one triggers.jsonl row: only the keys it sets (schema always), tuples as lists."""
        out = {}
        for f in fields(self):
            v = getattr(self, f.name)
            if v is None or v == ():
                continue
            out[f.name] = list(v) if isinstance(v, tuple) else v
        out["schema"] = out.get("schema") or SCHEMA
        return {k: out[k] for k in FIELDS if k in out}


FIELDS = {f.name: f for f in fields(Trigger)}
REQUIRED_ROW = ("schema", "id", "t")                 # every row
REQUIRED_FIRST = ("box", "kind", "source", "status")  # the row that opens an id


def json_schema() -> dict:
    """The JSON schema of one triggers.jsonl row, generated from Trigger's field metadata."""
    props = {}
    for f in fields(Trigger):
        s = dict(f.metadata["schema"])
        s["description"] = f.metadata["doc"] + ("" if f.metadata["auto"] else " (filled by the routed agent)")
        props[f.name] = s
    return {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "$id": "https://blackbox-agent.local/viewer/schemas/trigger.schema.json",
        "title": "bb-trigger/1: one row of a box's triggers.jsonl (CONTRACT §22)",
        "description": "GENERATED from viewer/tools/folds/_bb_trigger.py (the Trigger dataclass): never edit by hand. "
                       "Append-only: the first row of an id also needs " + ", ".join(REQUIRED_FIRST) + "; later rows "
                       "carry what changed. Kinds, actions and acceptance: viewer/tools/folds/_bb_actions.py.",
        "type": "object",
        "required": list(REQUIRED_ROW),
        "additionalProperties": False,
        "properties": props,
    }


# ── checking one row (the same rules as the schema, said as problems) ────────────────────────────────────────────────
def _type_ok(value, s: dict) -> str | None:
    """The schema subset Trigger uses, checked in Python: a reason, or None. WHY not jsonschema: stdlib only (the fold
    runs on a CI runner's plain Python); viewer/tests/triggers.test.mjs holds this to ajv on the generated schema."""
    if "const" in s:
        return None if value == s["const"] else f"must be {s['const']!r}"
    if "enum" in s:
        return None if value in s["enum"] else f"must be one of {', '.join(map(str, s['enum']))}"
    types = s.get("type")
    types = types if isinstance(types, list) else [types] if types else []
    if value is None:
        return None if "null" in types else "must not be null"
    py = {"string": str, "integer": int, "boolean": bool, "object": dict, "array": list, "null": type(None)}
    if types and not any(isinstance(value, py[t]) and not (t == "integer" and isinstance(value, bool)) for t in types):
        return f"must be {' or '.join(types)}"
    if isinstance(value, str):
        if len(value) < s.get("minLength", 0):
            return "must not be empty"
        if "pattern" in s and not re.search(s["pattern"], value):
            return f"must match {s['pattern']}"
    if isinstance(value, int) and not isinstance(value, bool) and "minimum" in s and value < s["minimum"]:
        return f"must be ≥ {s['minimum']}"
    if isinstance(value, list) and "items" in s:
        for i, v in enumerate(value):
            why = _type_ok(v, s["items"])
            if why:
                return f"[{i}] {why}"
    if isinstance(value, dict):
        for k in s.get("required", []):
            if k not in value:
                return f"needs `{k}`"
        if "anyOf" in s and not any(all(k in value for k in alt["required"]) for alt in s["anyOf"]):
            return "needs " + " or ".join(f"`{alt['required'][0]}`" for alt in s["anyOf"])
        props = s.get("properties", {})
        for k, v in value.items():
            if k in props:
                why = _type_ok(v, props[k])
                if why:
                    return f".{k} {why}"
            elif s.get("additionalProperties") is False:
                return f"has unknown key `{k}`"
    return None


def row_problems(row) -> list[str]:
    """What is wrong with one parsed triggers.jsonl row, by the schema alone (no catalog, no other rows)."""
    if not isinstance(row, dict):
        return ["is not a JSON object"]
    out = [f"needs `{k}`" for k in REQUIRED_ROW if k not in row]
    for k, v in row.items():
        if k not in FIELDS:
            out.append(f"has unknown key `{k}` (bb-trigger/1 keys: {', '.join(FIELDS)})")
            continue
        why = _type_ok(v, FIELDS[k].metadata["schema"])
        if why:
            out.append(f"`{k}` {why}")
    return out


# ── the file: parse, check against the catalog and the other rows, merge ─────────────────────────────────────────────
def parse(text: str, catalog: tuple[Action, ...] = actions_mod.STOCK, path: str = "triggers.jsonl"):
    """(merged triggers in first-seen order, problems). A bad row is a problem and is left out; never stops the fold."""
    problems: list[dict] = []
    kinds = {k for a in catalog for k in a.kinds}
    ids = {a.id for a in catalog}
    merged: dict[str, dict] = {}

    def bad(n: int, what: str, fix: str) -> None:
        problems.append({"lint": "trigger", "where": f"{path}:{n}", "what": what, "fix": fix})

    for n, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as e:
            bad(n, f"is not one JSON object ({e.msg})", "one bb-trigger/1 object per line")
            continue
        why = row_problems(row)
        if why:
            bad(n, "; ".join(why), "write the row as viewer/schemas/trigger.schema.json says (CONTRACT §22)")
            continue
        first = row["id"] not in merged
        if "verified_by_box" in row and "filled_by_agent" in row:
            bad(n, "carries both the agent's claim (filled_by_agent) and the box's verification (verified_by_box)",
                "the box writes verified_by_box in its own row, after it ran the check the claim names")
            continue
        if first:
            missing = [k for k in REQUIRED_FIRST if row.get(k) is None]
            if missing:
                bad(n, f"opens `{row['id']}` without {', '.join(f'`{k}`' for k in missing)}",
                    "the first row of an id names box, kind, source and status")
                continue
        if row.get("kind") is not None and row["kind"] not in kinds:
            bad(n, f"kind `{row['kind']}` is in no action's kinds ({', '.join(sorted(kinds))})",
                "use a stock kind, or add actions/<id>.md with `kinds: [" + row["kind"] + "]`")
            continue
        if row.get("action") is not None and row["action"] not in ids:
            bad(n, f"action `{row['action']}` is not in the actions catalog ({', '.join(sorted(ids))})",
                "name a stock action, or add actions/<id>.md")
            continue
        merged[row["id"]] = _merge(merged.get(row["id"]), row, n)
    out = []
    for tr in merged.values():
        _complete(tr, catalog)
        miss = unmet(tr, catalog)
        if tr.get("status") == "done" and miss:
            bad(tr["_lines"][-1], f"`{tr['id']}` is done without the evidence its acceptance needs: "
                f"filled_by_agent.{' / '.join(miss)}",
                "the routed agent writes that evidence before it marks the trigger done (CONTRACT §22)")
        out.append(tr)
    return out, problems


def _merge(cur: dict | None, row: dict, line: int) -> dict:
    cur = dict(cur) if cur else {"_lines": [], "history": [], "opened": row["t"]}
    for k, v in row.items():
        how = FIELDS[k].metadata["merge"]
        if how == "dict" and isinstance(v, dict) and isinstance(cur.get(k), dict):
            cur[k] = {**cur[k], **v}
        elif how == "union":
            cur[k] = list(dict.fromkeys([*(cur.get(k) or []), *v]))
        else:
            cur[k] = v
    if "status" in row:
        cur["history"] = [*cur["history"], {"t": row["t"], "status": row["status"]}]
    cur["_lines"] = [*cur["_lines"], line]
    # a verification covers the claim as it stood when it was written; a later claim needs a new one
    if "filled_by_agent" in row:
        cur["_claimed"] = line
    if "verified_by_box" in row:
        cur["_verified"] = line
    return cur


def _complete(tr: dict, catalog: tuple[Action, ...]) -> None:
    """The defaults the catalog gives a trigger that did not name them: its kind's action, that action's accept."""
    if tr.get("action") is None:
        a = actions_mod.default_action(tr["kind"], catalog)
        tr["action"], tr["action_from"] = (a.id if a else None), "kind default"
    a = actions_mod.by_id(tr["action"], catalog) if tr.get("action") else None
    if tr.get("accept") is None:
        tr["accept"], tr["accept_from"] = (a.accept if a else None), "action default"
    tr["also"] = list(a.also) if a else []


def unmet(tr: dict, catalog: tuple[Action, ...] = actions_mod.STOCK) -> list[str]:
    """The evidence keys a trigger still lacks for its acceptance (accept + the action's also), one entry per unmet
    condition (its keys joined by '|' when any one will do)."""
    got = tr.get("filled_by_agent") or {}
    out = []
    for cond in [tr.get("accept"), *tr.get("also", [])]:
        if cond is None:
            continue
        keys = EVIDENCE[cond]
        if cond == "audit-pass":
            ok = isinstance(got.get("audit"), dict) and got["audit"].get("verdict") == "pass"
        else:
            ok = any(got.get(k) for k in keys)
        if not ok:
            out.append("|".join(keys))
    return out


def verification(tr: dict) -> dict | None:
    """The box's verification that still covers the claim (written after its latest filled_by_agent row), or None."""
    v = tr.get("verified_by_box")
    if not isinstance(v, dict) or tr.get("_verified", 0) < tr.get("_claimed", 0):
        return None
    return v


def acceptance(tr: dict, catalog: tuple[Action, ...] = actions_mod.STOCK) -> str:
    """met only when the claim is complete AND the box verified it (result pass); one of ACCEPTANCE. MUTATION-TESTED
    (tests/test_triggers.py::test_an_agents_claim_alone_never_reads_as_met): a claim alone never reads met."""
    if tr.get("status") == "obsolete":
        return "not needed"
    v = verification(tr)
    if v and v.get("result") == "fail":
        return "verify failed"
    if not unmet(tr, catalog):
        return "met" if v and v.get("result") == "pass" else "claimed, not verified"
    return "unmet" if tr.get("status") == "done" else "waiting"


def source_kind(src) -> str | None:
    """Which place a source names (SOURCE_KINDS, first present wins)."""
    return next((k for k in SOURCE_KINDS if isinstance(src, dict) and src.get(k)), None)


if __name__ == "__main__":
    if sys.argv[1:] == ["--schema"]:
        sys.stdout.write(json.dumps(json_schema(), indent=2, ensure_ascii=False) + "\n")
    else:
        sys.exit("usage: _bb_trigger.py --schema   (prints viewer/schemas/trigger.schema.json)")
