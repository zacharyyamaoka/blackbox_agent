"""`bb-trigger/1` for a box's own code: the `Trigger` dataclass and the helpers to check a row and append it to the box's
triggers.jsonl (viewer CONTRACT §22). Offline, stdlib only, once the package is installed:

    from blackbox_agent.trigger import Trigger, append
    append(box_dir, Trigger(id="tr-20261125-0930-unit", box="my_agent", kind="unit-failed",
                            source={"unit": "foo.service"}, status="new", key="unit:foo.service:failed"))

One source of truth: this module holds no format of its own. It loads the fold's `_bb_trigger.py` (and `_bb_actions.py`)
from the installed fold (`fold/folds/`, shipped byte for byte from the lab's viewer/tools/folds/ by
tools/publish_package.py), so the class a box writes with is the class the fold and `blackbox check` read with.
tests/test_package_triggers.py holds the shipped file to the lab's and this module's `Trigger` to the fold's.
"""

from __future__ import annotations

import importlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _folds_dir() -> Path:
    """The installed fold's folds/ (fold/folds/); in the lab's own checkout, viewer/tools/folds/ (package/ has no fold/)."""
    for d in (HERE / "fold" / "folds", HERE.parents[2] / "viewer" / "tools" / "folds"):
        if (d / "_bb_trigger.py").is_file():
            return d
    raise ImportError("blackbox_agent.trigger: the fold's _bb_trigger.py is not installed beside this module")


def _load():
    folds = _folds_dir()
    saved = list(sys.path)
    try:
        # WHY the same module names box.py's `_fold_modules` uses: one module object per process, whichever loads first
        sys.path[:0] = [str(folds), str(folds.parent)]
        return [importlib.import_module(n) for n in ("_bb_trigger", "_bb_actions", "fold_state")]
    finally:
        sys.path[:] = saved


_trigger, actions, _fold_state = _load()

Trigger = _trigger.Trigger
SCHEMA = _trigger.SCHEMA
STATUSES = _trigger.STATUSES
ACCEPTANCE = _trigger.ACCEPTANCE
SOURCE_KINDS = _trigger.SOURCE_KINDS
json_schema = _trigger.json_schema
row_problems = _trigger.row_problems
parse = _trigger.parse
acceptance = _trigger.acceptance
unmet = _trigger.unmet

PATH = "triggers.jsonl"

__all__ = ["Trigger", "SCHEMA", "STATUSES", "ACCEPTANCE", "SOURCE_KINDS", "json_schema", "row_problems", "parse",
           "acceptance", "unmet", "validate", "append", "box_catalog", "actions"]


def box_catalog(box: str | Path) -> tuple:
    """The actions catalog a box's rows are checked against: the stock actions, then the box's own actions/<id>.md
    (read from its working tree here; the fold reads the same notes at a git ref)."""
    own = []
    for note in sorted(Path(box).glob("actions/*.md")):
        if note.name == "README.md":
            continue
        text = note.read_text()
        m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
        a, _ = actions.box_action(f"actions/{note.name}", _fold_state.simple_yaml(m.group(1)) if m else {},
                                  text[m.end():] if m else text)
        if a:
            own.append(a)
    return actions.catalog(own)


def _as_row(row) -> dict:
    out = row.row() if isinstance(row, Trigger) else dict(row)
    out.setdefault("schema", SCHEMA)
    if not out.get("t"):
        out["t"] = datetime.now().astimezone().isoformat(timespec="seconds")
    # the schema's key order, then anything unknown (kept, so validate names it rather than silently dropping it)
    return {**{k: out[k] for k in _trigger.FIELDS if k in out}, **{k: v for k, v in out.items() if k not in _trigger.FIELDS}}


def validate(row, existing: str = "", catalog: tuple | None = None) -> list[str]:
    """What is wrong with `row` as the next line of a triggers.jsonl that holds `existing`: the schema, the first row of
    an id naming box / kind / source / status, a kind and action in `catalog` (default: the stock actions), a done
    trigger carrying its claim. [] = it may be appended. Problems the file already had are not this row's."""
    row = row.row() if isinstance(row, Trigger) else row
    why = row_problems(row)
    if why:
        return why
    lines = existing.splitlines()
    n = len(lines) + 1
    _, problems = parse("\n".join([*lines, json.dumps(row)]) + "\n", catalog or actions.STOCK)
    return [f"{p['what']} (fix: {p['fix']})" for p in problems if p["where"] == f"triggers.jsonl:{n}"]


def append(box: str | Path, row) -> dict:
    """Append one row (a Trigger or a dict; `schema` and `t` filled in when absent) to `box`/triggers.jsonl after
    checking it against the file and the box's catalog. Raises ValueError, writing nothing, when it would be a refused
    line. Returns the row as written. The box still commits the file itself."""
    path = Path(box) / PATH
    existing = path.read_text() if path.is_file() else ""
    out = _as_row(row)
    why = validate(out, existing, box_catalog(box))
    if why:
        raise ValueError(f"{PATH}: not appended: " + "; ".join(why))
    with path.open("a") as f:
        if existing and not existing.endswith("\n"):
            f.write("\n")
        f.write(json.dumps(out, ensure_ascii=False) + "\n")
    return out
