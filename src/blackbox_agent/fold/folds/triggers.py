"""The `triggers` slice (viewer/CONTRACT.md §22): a box's triggers.jsonl merged per trigger, the actions catalog (stock +
the box's own actions/<id>.md), and each status change as an event in the Activity tab's log.

    def fold(facts) -> dict | None      (tools/fold_state.py runs it for every box: CONTRACT §3.3)

Absent (None) when the box has neither triggers.jsonl nor actions/: every box without them folds byte for byte as
before (Zach's rule for every additive slice; `fold_state.py --all --check`).

Shape: {rows: [...], actions: [...], counts: {<status>: n}, settle: {window_s, cap_s}, problems: [...]}.
A row is the merged trigger (_bb_trigger.parse) flattened for the Triggers tab's table, newest first:
    id, opened, t (its latest row), box, kind, title, key, track, repo, status, action (+ action_from when the kind's
    default), accept (+ accept_from), also, source_kind, source_label, source_link, routed_agent, routed_session,
    spawned, routed_dispatch, filled_agent, outcome, spec, commit, acceptance (_bb_trigger.ACCEPTANCE: met only with the
    box's own verification), verified_result / _at / _commit / _how, unmet, events, evidence[], history[], and the
    nested source, routed_to, filled_by_agent, settle, verified_by_box as written (the side panel shows them).
Stdlib only; every file through facts["tree"] (git show <ref>:<path>), never the working tree.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
import _bb_actions  # noqa: E402
import _bb_trigger  # noqa: E402
from fold_state import simple_yaml, ts as _ts  # noqa: E402  (the one front-matter reader and clock the fold uses)

PATH = "triggers.jsonl"
ACTION_NOTE = re.compile(r"^actions/[^/]+\.md$")


def box_actions(t) -> tuple[list, list[dict]]:
    out, problems = [], []
    for path in sorted(p for p in t.files if ACTION_NOTE.match(p) and not p.endswith("/README.md")):
        text = t.text(path) or ""
        m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
        a, why = _bb_actions.box_action(path, simple_yaml(m.group(1)) if m else {}, text[m.end():] if m else text)
        problems += why
        if a:
            out.append(a)
    return out, problems


def flat(tr: dict, about_url: str | None, sha: str) -> dict:
    src = tr.get("source") or {}
    routed = tr.get("routed_to") or {}
    filled = tr.get("filled_by_agent") or {}
    kind = _bb_trigger.source_kind(src)
    label = src.get(kind) if kind else None
    # WHY a scheme for what is not an address: data-ui's `display: link` draws a value as an <a> only when it is http(s)
    # or a relative path (isLinkTarget); `unit:foo.service`, `ref:4c3942d`, `path:ledger.jsonl` (no repo URL to put it
    # on) are drawn as that text, never a link that opens nothing (agent_activity_agent's gap 4)
    if kind == "url":
        link = label
    elif kind == "path" and about_url:
        link = f"{about_url}/blob/{sha}/{label}"
    else:
        link = f"{kind}:{label}" if kind else None
    unmet = _bb_trigger.unmet(tr)
    verified = _bb_trigger.verification(tr) or {}
    row = {
        "id": tr["id"], "opened": tr["opened"], "t": tr["t"], "box": tr.get("box"), "kind": tr.get("kind"),
        "title": tr.get("title"), "status": tr.get("status"),
        "action": tr.get("action"), "accept": tr.get("accept"), "also": tr.get("also") or [],
        "key": tr.get("key"), "track": tr.get("track"), "repo": tr.get("repo"),
        "source_kind": kind, "source_label": label, "source_link": link,
        "routed_agent": routed.get("agent"), "routed_session": routed.get("session"), "spawned": routed.get("spawned"),
        "routed_dispatch": routed.get("dispatch"),
        "filled_agent": filled.get("agent"), "outcome": filled.get("outcome"), "spec": filled.get("spec"),
        "commit": filled.get("commit"),
        "acceptance": _bb_trigger.acceptance(tr),
        "verified_result": verified.get("result"), "verified_at": verified.get("at"),
        "verified_commit": verified.get("commit"), "verified_how": verified.get("how"),
        "unmet": unmet, "events": (tr.get("settle") or {}).get("events"),
        "evidence": tr.get("evidence") or [], "history": tr["history"],
        "source": tr.get("source"), "routed_to": tr.get("routed_to"), "filled_by_agent": tr.get("filled_by_agent"),
        "settle": tr.get("settle"), "verified_by_box": tr.get("verified_by_box"),
    }
    for k in ("action_from", "accept_from"):
        if k in tr:
            row[k] = tr[k]
    return row


def fold(facts: dict):
    t = facts["tree"]
    state = facts["state"]
    text = t.text(PATH)
    own, problems = box_actions(t)
    if text is None and not own and not problems:
        return None
    catalog = _bb_actions.catalog(own)
    merged, more = _bb_trigger.parse(text or "", catalog, PATH)
    problems += more
    about = (state.get("about") or {}).get("url")
    rows = sorted((flat(tr, about, t.sha) for tr in merged), key=lambda r: (-_ts(r["opened"]), r["id"]))
    counts = {s: sum(1 for r in rows if r["status"] == s) for s in _bb_trigger.STATUSES}
    # the event log (Zach: "the automated trigger ... should show up in the event log"): each status change of each
    # trigger is one Activity row, when the Activity tab's rows are the fold's own (no activity.jsonl)
    act = state.get("activity")
    if isinstance(act, dict) and isinstance(act.get("recent"), list) and merged:
        events = []
        for tr in merged:
            for h in tr["history"]:
                who = (tr.get("routed_to") or {}).get("agent") if h["status"] in ("dispatched", "done") else None
                events.append({"t": h["t"], "day": h["t"][:10], "kind": "trigger",
                               "what": f"{tr.get('kind')} → {h['status']}: {tr.get('title') or tr['id']}",
                               "who": who or "trigger", "commit": None, "solution": None, "verdict": None,
                               "objective": None, "trigger": tr["id"]})
        act["recent"] = sorted(act["recent"] + events, key=lambda r: -_ts(r["t"]))
        act["rows"] = act.get("rows", 0) + len(events)
    return {"rows": rows, "actions": [a.row() for a in catalog], "counts": counts,
            "settle": {"window_s": _bb_actions.SETTLE_WINDOW_S, "cap_s": _bb_actions.SETTLE_CAP_S},
            "problems": problems}
