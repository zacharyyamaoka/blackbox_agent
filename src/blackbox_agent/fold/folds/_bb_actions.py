"""The stock actions catalog (viewer/CONTRACT.md §22): what happens when a trigger fires, and when it counts as done.

Not a slice (the leading underscore: fold_state.py's plug-in loader skips it); the triggers fold, `blackbox check` and the
schema generator read it. Stdlib only.

Zach, Daily Note 2026-11-25 ("# feedback on agent dipatcher"): "For each type of trigger we need to have basically like a
predefined kinda like thing that happens", "so we can split like the triggers from the actions that result form them",
"thoose actions are often quite generic and the same accross all the agents", and "for each trigger mode, there needs to
be an acceptaed good as well. so like if its a bug, its when the spec now pass. (and perhaps you ask another agent to
audit the work) (and perhaps a human if its a new feature, etc) if its just like anormal hook reminder than like mabye
its just about sending a message to the other agent and confirm it was reived."

So: a trigger (new data reaching a box) has a `kind`; each kind has a default `action`; each action has an acceptance
condition `accept` (plus optional extra conditions `also`), and a trigger is `done` only with the evidence its
conditions name in `filled_by_agent` (EVIDENCE below; `blackbox check` holds a done trigger to it).

A box adds its own action as one note, `actions/<id>.md` (front matter `accept:`, `also:`, `kinds:`, `what:`, the body
the agent's instructions). It may add new kinds that way. It can never redefine a stock action: a note whose id is a
stock id is refused (a problem), and the stock action stands. WHY: one action, one meaning across every box; a box
that needs different behaviour names a new action.
"""

from __future__ import annotations

from dataclasses import dataclass

# The acceptance conditions, and the evidence each one needs in a done trigger's `filled_by_agent` (any one key).
ACCEPTS = ("spec-passes", "gate-green", "message-received", "human-review", "audit-pass")
EVIDENCE: dict[str, tuple[str, ...]] = {
    "spec-passes": ("spec",),                 # the spec id that now covers it, passing at `commit`
    "gate-green": ("gate", "commit"),         # the gate back to green, at this commit
    "message-received": ("received_at",),     # when the receiving agent confirmed it got the message
    "human-review": ("human",),               # who reviewed it, and their verdict
    "audit-pass": ("audit",),                 # {by, model, verdict: pass}: another agent audited the work
}
# The settling window the dispatcher waits before it routes: each new event resets it; the cap ends it regardless.
# Zach: "each time a new thing comes in the settling time resets. (with a maximum total waiting time to avoid getting
# stuck if like a error comes in ever 30s)". Defaults; a trigger row's `settle` records what was used.
SETTLE_WINDOW_S = 300
SETTLE_CAP_S = 1800


@dataclass(frozen=True)
class Action:
    """One action a trigger can ask for: what the routed agent does, and when it is done."""

    id: str                                   # [a-z0-9-]
    what: str                                 # one line: what the routed agent does
    accept: str                               # one of ACCEPTS: the condition that makes the trigger done
    kinds: tuple[str, ...] = ()               # the trigger kinds this action is the default for
    also: tuple[str, ...] = ()                # extra conditions (ACCEPTS) a box may require, e.g. ("audit-pass",)
    stock: bool = True                        # False for a box's own (actions/<id>.md)
    source: str | None = None                 # where a box's own action is declared

    def row(self) -> dict:
        return {"id": self.id, "what": self.what, "accept": self.accept, "also": list(self.also),
                "kinds": list(self.kinds), "stock": self.stock, "source": self.source}


# The catalog. A kind appears in exactly one action's `kinds` (its default); a trigger row may still name another action.
STOCK: tuple[Action, ...] = (
    Action("fix-and-spec", "Reproduce it, write a spec that fails on it, fix until the spec passes; link the spec from the "
                           "feedback note (bug reports are feedback tagged bug-report)", "spec-passes",
           kinds=("new-bug-report", "regressed", "unit-failed")),
    Action("restore-gate", "Find the change that turned the gate red and bring it back to green without loosening the "
                           "ruler", "gate-green", kinds=("gate-red", "watcher-red")),
    Action("feedback-to-spec", "Turn the feedback into a spec (or mark it obsolete with why), so the feedback is not lost",
           "spec-passes", kinds=("feedback",)),
    Action("review-feature", "Build the requested feature behind its spec and hand it to a human for review",
           "human-review", kinds=(), also=("spec-passes",)),
    Action("reply", "Deliver the message to the agent working on the track and get its receipt", "message-received",
           kinds=("reminder",)),
)
KINDS: tuple[str, ...] = tuple(k for a in STOCK for k in a.kinds)


def stock_ids() -> set[str]:
    return {a.id for a in STOCK}


def default_action(kind: str, actions: tuple[Action, ...] = STOCK) -> Action | None:
    return next((a for a in actions if kind in a.kinds), None)


def by_id(action_id: str, actions: tuple[Action, ...] = STOCK) -> Action | None:
    return next((a for a in actions if a.id == action_id), None)


def box_action(path: str, meta: dict, body: str) -> tuple[Action | None, list[dict]]:
    """A box's own action from `actions/<id>.md` (its front matter `meta`, read by fold_state.simple_yaml)."""
    aid = path.rsplit("/", 1)[-1][:-3]
    problems = []

    def bad(what: str, fix: str) -> None:
        problems.append({"lint": "action", "where": path, "what": what, "fix": fix})

    if aid in stock_ids():
        bad(f"redefines the stock action `{aid}`", "give the box's action a new id: a stock action means the same in "
            "every box")
        return None, problems
    if not aid or not all(c.isalnum() or c == "-" for c in aid) or aid != aid.lower():
        bad(f"`{aid}` is not an action id", "name the note actions/<id>.md, the id in [a-z0-9-]")
        return None, problems
    accept = meta.get("accept")
    if accept not in ACCEPTS:
        bad(f"accept: {accept!r} is not one of {', '.join(ACCEPTS)}", "give it the condition that makes it done")
        return None, problems
    lst = lambda v: tuple(v) if isinstance(v, list) else ((v,) if isinstance(v, str) and v else ())  # noqa: E731
    also = lst(meta.get("also"))
    for c in also:
        if c not in ACCEPTS:
            bad(f"also: {c!r} is not one of {', '.join(ACCEPTS)}", "drop it or name a condition")
    what = meta.get("what") if isinstance(meta.get("what"), str) and meta.get("what") else \
        next((l.strip() for l in body.splitlines() if l.strip() and not l.startswith("#")), aid)
    return Action(aid, what, accept, kinds=lst(meta.get("kinds")), also=tuple(c for c in also if c in ACCEPTS),
                  stock=False, source=path), problems


def catalog(box_actions: list[Action]) -> tuple[Action, ...]:
    """Stock first, then the box's own, by id. A box kind that a stock action already defaults is left to the stock
    action (first match wins in default_action)."""
    return STOCK + tuple(sorted(box_actions, key=lambda a: a.id))
