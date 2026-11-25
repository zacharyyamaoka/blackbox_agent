"""A box's questions and what its agents decided for Zach (viewer/CONTRACT.md §23, the Receipt). Not a slice (the leading
underscore): fold_state.py's needs_from and folds/receipt.py both read the box through here, and `blackbox check`,
`blackbox answer` and `blackbox review` hold a box to the same rules (one rule, one meaning). Stdlib only.

Two box files, both optional, both append-only:

- `needs.jsonl`: one `vt-need/1` line per version of a question, the latest line per id wins. The format is Vibe Tracks'
  (vibetracks/schemas/vt-need-1.schema.json), adopted whole as the box format, the way agent_activity_agent already
  files its needs (`aaa propose`, `aaa ask-still-important`, `aaa apply-answers`): `default: {text, option, applies_at,
  applies_when}` or null, `blocking`, `applied_default`, `answered`, `closed`. The lab adds three keys that Vibe Tracks
  passes through (its schema allows extra keys): `kind` (the catalog below), `still_stop: true` (a question nothing
  undoes) and `answer: {option, by: {human}}` (who answered, and how). viewer/schemas/need.schema.json is the line.
- `actions.jsonl`: the box's own log (agent_activity_agent's shape: `t`, `kind`, `track`, `detail`, ...). A row that
  carries an `undo` key is something an agent decided for Zach: `undo` is the exact command that reverses it, or null
  ("can't undo", e.g. a message sent). A `review` row is Zach's word on such rows, person-signed:
  `{"t", "kind": "review", "verdict": "confirmed"|"undone", "of": [ids], "by": {"human": ...}}`.

WHY (Zach, Daily Note 2026-11-25, "# Agent Activity Feedback"): "a good way for me to do the needs you review and for
me to kinda like confirm what is has already done", and needs-you kept low with "a high number of them that default
answers are being taken and proceed with". The pick: agent_activity_agent/proposals/needs-you P5 "Receipt".
"""

from __future__ import annotations

import json
import re
from datetime import datetime

SCHEMA = "vt-need/1"
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$")
ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
ASK_MAX = 300

# The stock kinds: one default per kind (proposals/needs-you §6). `default: None` = never a default: a gate or ruler
# question is his success criteria, and the still-stop list is what nothing undoes (independent RULES.md "Still stop").
# A box files the default itself (vt-need/1 `default`, with when it lands); the catalog is what it should file, and
# `blackbox check` notes a defaultable kind filed without one. WHY not filled in by the fold: a default the producer does
# not apply would say "goes ahead Thursday" while nothing goes ahead (the fold never invents).
STILL_STOP = ("release", "other-people", "delete-data", "secret", "money", "hardware")
KINDS: dict[str, dict] = {
    "new-track-requested": {"label": "Tracks you asked for", "default": {"option": "accept", "text": "Make the track", "after_h": 48},
                            "why": "archiving the track undoes it"},
    "new-track": {"label": "Agents' track proposals", "default": {"option": "later", "text": "Not now (asked again in 30 days)", "after_h": 168},
                  "why": "not a reject, so the accept rate stays yours"},
    "still-important": {"label": "Still important?", "default": {"option": "recommended", "text": "its recommendation", "after_h": 48},
                        "why": "one `vt set` undoes a pause"},
    "decision": {"label": "Decisions", "default": {"option": "recommended", "text": "its recommendation", "after_h": 48},
                 "why": "git or one command undoes it"},
    "test": {"label": "Tests", "default": {"option": "recommended", "text": "its recommendation", "after_h": 48},
             "why": "a test change is one revert"},
    "blocked": {"label": "Blocked", "default": None, "why": "the box cannot go on until it is answered"},
    "gate": {"label": "Gate questions", "default": None, "why": "your success criteria"},
    "ruler": {"label": "Ruler questions", "default": None, "why": "your success criteria"},
    "release": {"label": "Releases", "default": None, "why": "a published package cannot be unpublished"},
    "other-people": {"label": "Reaching other people", "default": None, "why": "a sent message cannot be unsent"},
    "delete-data": {"label": "Deleting data", "default": None, "why": "nothing undoes a deletion"},
    "secret": {"label": "Secrets and sign-ins", "default": None, "why": "only you hold them"},
    "money": {"label": "Money", "default": None, "why": "needs your yes"},
    "hardware": {"label": "Changing hardware", "default": None, "why": "nothing undoes a changed robot"},
}
NO_DEFAULT_KINDS = tuple(k for k, v in KINDS.items() if v["default"] is None)
VERDICTS = ("confirmed", "undone")
# the stock labels of agent_activity_agent's action kinds, for the bank-statement groups; a box's own kind reads as itself
GROUPS = {"went-ahead": "Went ahead on its default", "spawn": "Started agents", "nudge": "Nudged agents",
          "dispatch": "Dispatched work", "trigger": "Triggers handled", "propose": "Proposed tracks", "note": "Notes and holds",
          "loop": "Loop passes", "pause": "Paused tracks", "fix": "Fixes", "ack": "Held bugs", "merge": "Merged", "deploy": "Deployed",
          "message": "Messages sent"}
RECENT_DAYS = 7  # a reviewed line stays on the receipt this long; an unreviewed one stays until he reviews it


def is_still_stop(need: dict) -> bool:
    return bool(need.get("still_stop")) or need.get("kind") in STILL_STOP


def ts(value) -> datetime | None:
    if isinstance(value, str) and ISO.match(value):
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    return None


# ── needs.jsonl ──────────────────────────────────────────────────────────────────────────────────────────────────────
def need_problems(row) -> list[tuple[str, str]]:
    """(what, fix) for one parsed needs.jsonl line, by viewer/schemas/need.schema.json and the kind rules."""
    if not isinstance(row, dict):
        return [("is not a JSON object", "one vt-need/1 object per line")]
    out = []
    for k in ("schema", "id", "t", "ask"):
        if k not in row:
            out.append((f"needs `{k}`", "every line has schema, id, t and ask (vt-need/1)"))
    if "schema" in row and row["schema"] != SCHEMA:
        out.append((f"`schema` must be {SCHEMA!r}", f"write \"schema\": \"{SCHEMA}\""))
    if "id" in row and not (isinstance(row["id"], str) and ID.match(row["id"])):
        out.append(("`id` must match [A-Za-z0-9._-]{1,64}", "a short stable id, e.g. still-important-detection"))
    for k in ("t", "created", "answered", "applied_default", "closed"):
        v = row.get(k)
        if k in row and not (ts(v) or (v is None and k != "t") or (v is True and k in ("answered", "applied_default", "closed"))):
            out.append((f"`{k}` must be an ISO time with its offset", "e.g. 2026-11-25T15:12:27Z"))
    if "ask" in row and not (isinstance(row["ask"], str) and 0 < len(row["ask"]) <= ASK_MAX):
        out.append((f"`ask` must be one line of 1-{ASK_MAX} characters", "the question's title; the rest goes in question_md"))
    if "blocking" in row and not isinstance(row["blocking"], bool):
        out.append(("`blocking` must be true or false", "true only when the loop cannot climb a rung, package or gate"))
    if "kind" in row and not (isinstance(row["kind"], str) and re.match(r"^[a-z0-9][a-z0-9-]*$", row["kind"])):
        out.append(("`kind` must be a lowercase slug", "a stock kind: " + ", ".join(KINDS)))
    options = row.get("options")
    ids = []
    if options is not None:
        if not isinstance(options, list) or not all(isinstance(o, dict) and isinstance(o.get("id"), str) and isinstance(o.get("label"), str)
                                                       for o in options):
            out.append(("`options` must be a list of {id, label, recommended?}", "vt-need/1 options"))
        else:
            ids = [o["id"] for o in options]
    d = row.get("default")
    if d is not None:
        if not isinstance(d, dict) or not isinstance(d.get("text"), str) or not d.get("text"):
            out.append(("`default` must be null or {text, option, applies_at | applies_when}", "vt-need/1 default"))
        else:
            if not (ts(d.get("applies_at")) or (isinstance(d.get("applies_when"), str) and d["applies_when"])):
                out.append((f"`{row.get('id')}` has a default but not when it lands",
                            "add default.applies_at (an ISO time) or default.applies_when, or silence never moves it"))
            if ids and d.get("option") is not None and d["option"] not in ids:
                out.append((f"default.option `{d['option']}` is not one of its options ({', '.join(ids)})", "name one option id"))
            if row.get("kind") in NO_DEFAULT_KINDS or row.get("still_stop"):
                why = KINDS.get(row.get("kind"), {}).get("why") or "nothing undoes it"
                out.append((f"`{row.get('id')}` is a {row.get('kind') if row.get('kind') in KINDS else 'still-stop'} question and "
                            f"gets no default ({why})", "file it with \"default\": null: it waits for him"))
    ans = row.get("answer")
    if ans is not None:
        if not isinstance(ans, dict) or not isinstance((ans.get("by") or {}).get("human"), str):
            out.append(("`answer` must be {option, by: {human}}", "an answer is a person's (`blackbox answer` writes it)"))
        elif ids and ans.get("option") not in ids:
            out.append((f"answer.option `{ans.get('option')}` is not one of its options ({', '.join(ids)})", "name one option id"))
    return out


def parse_needs(text: str | None, path: str = "needs.jsonl") -> tuple[list[dict], list[dict]]:
    """(the latest line per id, in first-seen order, each with `_line`; problems). A bad line is a problem and is left
    out; never stops the fold."""
    latest: dict[str, dict] = {}
    problems: list[dict] = []
    for n, line in enumerate((text or "").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as e:
            problems.append({"lint": "needs", "where": f"{path}:{n}", "what": f"is not one JSON object ({e.msg})",
                             "fix": "one vt-need/1 object per line"})
            continue
        why = need_problems(row)
        if why:
            problems += [{"lint": "needs", "where": f"{path}:{n}", "what": w, "fix": f} for w, f in why]
            continue
        latest[row["id"]] = {**row, "_line": n}  # a dict keeps an id at its first-seen place
    return list(latest.values()), problems


def need_state(need: dict, now: datetime | None) -> str:
    """vt-need/1's group, first match wins: done > answered > defaulted > blocking > no_default > waiting."""
    if need.get("closed"):
        return "done"
    if need.get("answered") or need.get("answer"):
        return "answered"
    d = need.get("default") or {}
    due = ts(d.get("applies_at"))
    if need.get("applied_default") or (due is not None and now is not None and due <= now):
        return "defaulted"
    if need.get("blocking"):
        return "blocking"
    if not need.get("default"):
        return "no_default"
    return "waiting"


def step_of(need: dict, state: str) -> str | None:
    """Which step of the Receipt: `call` (only he can: blocking, no default, or still-stop), `ahead` (goes ahead on its
    default by itself), `decided` (went ahead on its default), None (answered or closed: off the receipt)."""
    if state in ("done", "answered"):
        return None
    if state == "defaulted":
        return "decided"
    if state in ("blocking", "no_default") or is_still_stop(need):
        return "call"
    return "ahead"


def answer_command(track: str | None, need_id: str) -> str:
    """The exact command that answers a need, with `{option}` for the option's id. A box whose status.json names its
    Vibe Tracks track (links.track) answers there, as `vt answer` does today; any other box appends the answer line
    with `blackbox answer`, run in its checkout."""
    if track:
        return f"vt answer {track} {need_id} option {{option}}"
    return f"blackbox answer --box . {need_id} {{option}}"


def need_row(need: dict, state: str, step: str, track: str | None) -> dict:
    """One open question as the needs slice carries it (CONTRACT §23.2)."""
    options = [{"id": o["id"], "label": o["label"], **({"recommended": True} if o.get("recommended") else {})}
               for o in need.get("options") or []]
    d = need.get("default")
    kind = need.get("kind") or "decision"
    return {
        "ask": need["ask"], "text": need.get("question_md"), "source": f"needs.jsonl:{need['_line']}", "section": None,
        "kind": kind, "id": need["id"], "state": state, "step": step, "still_stop": is_still_stop(need),
        "blocking": bool(need.get("blocking")), "created": need.get("created"),
        "default": ({"text": d["text"], "option": d.get("option"), "applies_at": d.get("applies_at"),
                     "applies_when": d.get("applies_when")} if d else None),
        "lands": (d or {}).get("applies_at"),
        "recommendation": need.get("recommendation_md"),
        "options": options,
        "recommended": next((o["id"] for o in options if o.get("recommended")), None),
        "evidence": list(need.get("evidence") or []),
        "answer_cmd": answer_command(track, need["id"]),
    }


# ── actions.jsonl ────────────────────────────────────────────────────────────────────────────────────────────────────
def action_problems(row) -> list[tuple[str, str]]:
    """(what, fix) for one actions.jsonl row the Receipt reads: a row with `undo`, or a review. Any other row is the
    box's own log and is not checked here."""
    if not isinstance(row, dict):
        return [("is not a JSON object", "one object per line")]
    out = []
    if row.get("kind") == "review":
        if not ts(row.get("t")):
            out.append(("a review needs `t`, an ISO time with its offset", "blackbox review writes it"))
        if row.get("verdict") not in VERDICTS:
            out.append((f"a review's `verdict` must be one of {', '.join(VERDICTS)}", "blackbox review confirmed|undone <id>..."))
        if not (isinstance(row.get("of"), list) and row["of"] and all(isinstance(i, str) for i in row["of"])):
            out.append(("a review's `of` must list the ids it reviews", "blackbox review writes it"))
        if not isinstance((row.get("by") or {}).get("human"), str) or "agent" in (row.get("by") or {}):
            out.append(("a review is a person's: `by` must be {human: <name>}, never an agent",
                        "only he confirms or undoes; an agent never reviews its own decision"))
        return out
    if "undo" in row:
        if not ts(row.get("t")):
            out.append(("a decided row needs `t`, an ISO time with its offset", "e.g. 2026-11-25T15:12:27Z"))
        if not (isinstance(row.get("detail"), str) and row["detail"].strip()):
            out.append(("a decided row needs `detail`: what was decided, in one line", "the line he reads on the receipt"))
        if row["undo"] is not None and not (isinstance(row["undo"], str) and row["undo"].strip()):
            out.append(("`undo` must be the exact command that reverses it, or null (can't undo)", "e.g. vt set <track> status --unset"))
        if "id" in row and not (isinstance(row["id"], str) and ID.match(row["id"])):
            out.append(("`id` must match [A-Za-z0-9._-]{1,64}", "or leave it out: the line's id is then its time and kind"))
    return out


def action_id(row: dict, seen: set[str]) -> str:
    """A decided row's id: its own `id`, else `a-<time digits>-<kind>` (and -2, -3 for a second row in the same second):
    stable, because the file is append-only."""
    base = row.get("id") or f"a-{re.sub(r'[^0-9]', '', row.get('t') or '')[:14]}-{re.sub(r'[^a-z0-9-]', '', str(row.get('kind') or 'action'))}"
    out, k = base, 2
    while out in seen:
        out, k = f"{base}-{k}", k + 1
    seen.add(out)
    return out


def parse_actions(text: str | None, path: str = "actions.jsonl") -> tuple[list[dict], dict[str, dict], list[dict]]:
    """(the decided rows in file order, each with `id` and `_line`; the latest review per id; problems)."""
    decided: list[dict] = []
    reviews: dict[str, dict] = {}
    problems: list[dict] = []
    seen: set[str] = set()
    for n, line in enumerate((text or "").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as e:
            problems.append({"lint": "actions", "where": f"{path}:{n}", "what": f"is not one JSON object ({e.msg})",
                             "fix": "one object per line"})
            continue
        why = action_problems(row)
        if why:
            problems += [{"lint": "actions", "where": f"{path}:{n}", "what": w, "fix": f} for w, f in why]
            continue
        if not isinstance(row, dict):
            continue
        if row.get("kind") == "review":
            for i in row["of"]:
                reviews[i] = {"verdict": row["verdict"], "t": row["t"], "by": row["by"]["human"]}
        elif "undo" in row:
            decided.append({**row, "id": action_id(row, seen), "_line": n})
    return decided, reviews, problems


def review_command(verdict: str, ids: list[str]) -> str:
    return f"blackbox review --box . {verdict} {' '.join(ids)}"
