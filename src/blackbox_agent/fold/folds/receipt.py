"""The `receipt` slice (viewer/CONTRACT.md §23): what <bb-needs-you> draws as the Receipt. The two counts (needs you:
only what cannot go ahead without him; went ahead on its default, of the questions resolved), step 2's questions grouped
by kind with their default and the soonest time one lands, step 3's bank statement (what an agent decided for him, with
the undo per line and the review per group), the kind catalog and the problems.

Reads `needs.jsonl` (the latest vt-need/1 line per id) and the rows of `actions.jsonl` that carry `undo` or are reviews,
through folds/_bb_needs.py. Absent when the box has no needs.jsonl and its actions.jsonl names no decision: every such
box folds byte for byte as before. The clock is the ref's commit time (the needs slice uses the same), so a re-fold is
byte-identical.
"""

from __future__ import annotations

import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _bb_needs as nm  # noqa: E402


def _decided_need(need: dict, track: str | None) -> dict:
    d = need.get("default") or {}
    at = need["applied_default"] if nm.ts(need.get("applied_default")) else d.get("applies_at")
    others = [{"id": o["id"], "label": o["label"]} for o in need.get("options") or [] if o["id"] != d.get("option")]
    return {"id": need["id"], "t": at, "title": f"{need['ask']} → {d.get('text')}", "group": "went-ahead",
            "track": need.get("track"), "kind": need.get("kind") or "decision", "undo": None, "undoable": True,
            "undo_cmd": None, "default_option": d.get("option"), "options": others,
            "answer_cmd": nm.answer_command(track, need["id"]), "source": f"needs.jsonl:{need['_line']}"}


def _decided_action(row: dict) -> dict:
    undo = row.get("undo")
    return {"id": row["id"], "t": row["t"], "title": row["detail"], "group": str(row.get("group") or row.get("kind") or "action"),
            "track": row.get("track"), "kind": row.get("kind"), "undo": undo, "undoable": undo is not None,
            "undo_cmd": [undo, nm.review_command("undone", [row["id"]])] if undo is not None else None,
            "source": f"actions.jsonl:{row['_line']}"}


def fold(facts: dict):
    t = facts["tree"]
    actions_text = None
    # WHY peek before reading: a box's log that names no decision (no `undo`, no review) is not read for the receipt,
    # so it stays out of state.source.read and the box folds byte for byte as it did before the Receipt
    if "actions.jsonl" in t.fileset:
        raw = t.git("show", f"{t.sha}:actions.jsonl")
        if '"undo"' in raw or '"review"' in raw:
            actions_text = t.text("actions.jsonl")
    need_text = t.text("needs.jsonl")
    if need_text is None and actions_text is None:
        return None
    status = facts.get("status") or {}
    track = (status.get("links") or {}).get("track")
    clock = t.date()
    now = nm.ts(clock)
    needs, need_problems = nm.parse_needs(need_text)
    actions, reviews, action_problems = nm.parse_actions(actions_text)
    open_rows = facts["state"].get("needs") or []

    states = [(n, nm.need_state(n, now)) for n in needs]
    went = [n for n, s in states if s == "defaulted"]
    answered = [n for n, s in states if s == "answered"]

    rows = [_decided_need(n, track) for n in went] + [_decided_action(a) for a in actions]
    recent = now - timedelta(days=nm.RECENT_DAYS) if now else None
    for r in rows:
        r["review"] = reviews.get(r["id"])
    # a reviewed line stays a week; one he has not reviewed stays until he does
    rows = [r for r in rows if not r["review"] or recent is None or (nm.ts(r["review"]["t"]) or now) >= recent]
    groups: dict[str, list] = {}
    for r in rows:
        groups.setdefault(r["group"], []).append(r)
    out_groups = []
    for gid, grows in groups.items():
        grows.sort(key=lambda r: (r["t"] or "", r["source"]), reverse=True)
        todo = [r["id"] for r in grows if not r["review"]]
        out_groups.append({"id": gid, "label": nm.GROUPS.get(gid, gid.replace("-", " ").capitalize()), "rows": grows,
                           "to_review": todo, "confirm_cmd": nm.review_command("confirmed", todo) if todo else None})
    out_groups.sort(key=lambda g: g["rows"][0]["t"] or "", reverse=True)  # the group with the newest line first,
    out_groups.sort(key=lambda g: g["id"] != "went-ahead")                 # after the questions that went ahead

    ahead: dict[str, list] = {}
    for n in open_rows:
        if n.get("step") == "ahead":
            ahead.setdefault(n["kind"], []).append(n)
    ahead_groups = []
    for kind, items in ahead.items():
        items.sort(key=lambda n: (n["lands"] or "9999", n["id"]))
        ahead_groups.append({"kind": kind, "label": (nm.KINDS.get(kind) or {}).get("label") or kind.replace("-", " ").capitalize(),
                             "default_text": items[0]["default"]["text"], "soonest": items[0]["lands"],
                             "ids": [n["id"] for n in items]})
    ahead_groups.sort(key=lambda g: (g["soonest"] or "9999", g["kind"]))

    resolved = len(went) + len(answered)
    call = [n for n in open_rows if n.get("step", "call") == "call"]
    counts = {
        "needs_you": len(call),
        "going_ahead": sum(len(g["ids"]) for g in ahead_groups),
        "decided": len(rows),
        "undoable": sum(1 for r in rows if r["undoable"]),
        "to_review": sum(1 for r in rows if not r["review"]),
        "confirmed": sum(1 for r in rows if (r["review"] or {}).get("verdict") == "confirmed"),
        "undone": sum(1 for r in rows if (r["review"] or {}).get("verdict") == "undone"),
        "went_ahead_on_default": len(went),
        "answered": len(answered),
        "default_pct": round(100 * len(went) / resolved) if resolved else None,
        "open": len(open_rows),
        "open_no_default": sum(1 for n in open_rows if not n.get("default")),
    }
    kinds = {k: {"label": v["label"], "default_text": (v["default"] or {}).get("text"),
                 "after_h": (v["default"] or {}).get("after_h"), "why": v["why"]} for k, v in nm.KINDS.items()}
    return {"as_of": clock, "track": track, "counts": counts, "ahead": ahead_groups, "groups": out_groups, "kinds": kinds,
            "still_stop": list(nm.STILL_STOP), "problems": need_problems + action_problems}
