"""The `task_results` slice (viewer/CONTRACT.md §28): one row per ITERATION × scorecard × task, for the Iterations
tab's Iteration × Dataset views (a leaderboard pivot whose rows are iterations and whose columns are deployment › split
› dataset › task kind › task) and the rail's column facets (Dataset, Split, Task kind, Speed).

Generic over every dataset a box's scorecards carry: every `solutions/<id>/scorecard*.json` of a scored iteration is
read (the dev one, a holdout one, one per extra dataset or speed a box adds), and its columns are what the card itself
says: `deployment.name`, `dataset.name`, `split` (the card's, else its dataset's), `dataset.speed` where the box records
one. Nothing names trajectory_tracking_agent's ur5e_alone / workspace / v2: a box that scores a second dataset gets a
second column group with no change here. WHY (Zach, 2026-11-25): "Iteration x Dataset basically … as simple as just
adding these views to the iteration page … and then kinda like enriching the filter with that information", and "lots
of filters on the rows, but no filters on the columns! I should be able to select which different datasets etc I want
to be comparing it on."

A row: `solution`, `n` (the iteration's number), `deployment`, `dataset`, `split`, `speed` (only where the card names
one), `kind`, `task`, `value` (the task's own objective, as the ruler wrote it), `gates_passed` / `gates` (its verdicts), `gates_failed` (only where one failed).
The iteration's own fields (verdict, family, proposer, dev error …) are NOT copied here: the viewer joins them by
`solution` (one row per iteration already holds them), and derives the row's `id`, its `iteration` label and its
`dataset_split` (one line per dataset · split on Progress by dataset): every byte here is one per task, and
trajectory_tracking_agent has ~2,000 of them.

It also ENRICHES each iterations[] row (the semi-join a rail needs, CONTRACT §28.2): `dataset`, `split`, `kind` and,
where any card names one, `speed`, each the sorted list of values its task results cover; and `model`, the name's first
two segments (`P5.s` of `P5.s.pass3`; `P5` of `P5`), where the box names its iterations (§24) — so ONE rail facet means
the same on both grains. A box whose scorecards carry no task list (robot_controllers, a pass/fail-only card) gets no slice and its
rows are untouched (every such state folds byte for byte as before).

Never invents a number: a task without a finite objective has `value: null`; a card that names no dataset is
labelled by its own file name (`scorecard_fast`), never by a guessed dataset.
"""

from __future__ import annotations

import math
import re

CARD = re.compile(r"^solutions/([^/]+)/(scorecard[^/]*)\.json$")


def _num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else None


def _str(v):
    return v if isinstance(v, str) and v.strip() else None


def _model(name):
    if not isinstance(name, str):
        return None
    return ".".join(name.split(".")[:2])  # a one-segment name (a family's root) is its own model


def _card_order(path: str) -> tuple:
    """The plain scorecard first, then the others by name (scorecard_holdout, scorecard_fast …)."""
    stem = CARD.match(path).group(2)
    return (stem != "scorecard", stem)


def fold(facts: dict):
    state = facts.get("state") or {}
    t = facts.get("tree")
    its = state.get("iterations") or []
    if t is None or not its or "metas" not in facts:  # robot_controllers' grade: no scorecards
        return None
    by_id = {r["id"]: r for r in its}
    cards: dict[str, list[str]] = {}
    for p in t.files:
        m = CARD.match(p)
        if m and m.group(1) in by_id:
            cards.setdefault(m.group(1), []).append(p)
    rows: list[dict] = []
    cover: dict[str, dict[str, set]] = {}
    for it in sorted(its, key=lambda r: -(r.get("n") or 0)):  # newest first, as the Iterations list is
        sid = it["id"]
        for path in sorted(cards.get(sid, []), key=_card_order):
            card = t.json(path)
            if not isinstance(card, dict) or not isinstance(card.get("tasks"), list):
                continue
            dep = card.get("deployment") if isinstance(card.get("deployment"), dict) else {}
            ds = card.get("dataset") if isinstance(card.get("dataset"), dict) else {}
            dataset = _str(ds.get("name"))
            stem = None if dataset else CARD.match(path).group(2)  # a card that names no dataset: its file, said as such
            split = _str(card.get("split")) or _str(ds.get("split"))
            speed = _num(ds.get("speed"))
            for task in card["tasks"]:
                if not isinstance(task, dict) or not _str(task.get("task")):
                    continue
                verdicts = task.get("verdicts") if isinstance(task.get("verdicts"), dict) else {}
                failed = sorted(g for g, ok in verdicts.items() if ok is False)
                row = {"solution": sid, "n": it.get("n"), "deployment": _str(dep.get("name")), "dataset": dataset or stem,
                       "split": split}
                if speed is not None:
                    row["speed"] = speed
                row.update({"kind": _str(task.get("kind")), "task": task["task"], "value": _num(task.get("objective")),
                            "gates_passed": sum(1 for ok in verdicts.values() if ok is True), "gates": len(verdicts)})
                if failed:
                    row["gates_failed"] = failed
                rows.append(row)
                c = cover.setdefault(sid, {"dataset": set(), "split": set(), "kind": set(), "speed": set()})
                for k in ("dataset", "split", "kind", "speed"):
                    if row.get(k) is not None:
                        c[k].add(row[k])
    if not rows:
        return None
    any_speed = any("speed" in r for r in rows)
    for it in its:
        c = cover.get(it["id"])
        if "name" in it:  # §24's naming keys: the model is the name's first two segments
            it["model"] = _model(it.get("name"))
        for k in ("dataset", "split", "kind") + (("speed",) if any_speed else ()):
            it[k] = sorted(c[k]) if c else []
    return rows
