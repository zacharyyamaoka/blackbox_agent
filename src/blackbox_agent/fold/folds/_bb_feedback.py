"""The feedback note's front-matter keys (viewer/CONTRACT.md §22.4): the type, and the check `blackbox check` runs.

Not a slice (the leading underscore). Stdlib only.

Zach, Daily Note 2026-11-25: "bugs are just a special case of feedback... So we can put them into the feedback table, tag
it with bug report, it can link to the source. and we need to make sure to the feedback table to addd a column that
links the feedback to a spec. Turning the feedback into spec is how we make it not lossy. Also for the feedback table we
can support like a obsolte feedback state. that shows like greyed out or crosseed out. we still keep it tracked bu just
the feedback no longers applies type thing... and of course like before for the feedback table you say like wether user
enter, AI entered, etc..."

Every key is optional; a note without them folds exactly as before. The keys a note already writes (`from`, whose words;
`filed_by` + `model`, which agent filed it; `source`; `spec`/`specs`; `became`) keep their meaning.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, fields

BUG = "bug-report"
STATUSES = ("open", "obsolete")
ENTERED_BY = ("user", "ai")
TAG = re.compile(r"^[a-z0-9][a-z0-9-]*$")


@dataclass(frozen=True)
class FeedbackKeys:
    """The keys §22.4 adds to a feedback note's front matter (each optional)."""

    tags: tuple[str, ...] = ()        # `tags: [bug-report]`: a bug report is feedback tagged bug-report (needs `source`)
    spec: tuple[str, ...] = ()        # the spec id(s) it became (existing key; `specs` reads the same): the spec link
    status: str = "open"              # open | obsolete: an obsolete note is kept and drawn struck through
    obsolete_why: str | None = None   # why it no longer applies (required with status: obsolete)
    obsolete_by: str | None = None    # optional: what replaced it (a spec id, another feedback note's path)
    entered_by: str | None = None     # user | ai: who typed it in (beside `from`, whose words, and `filed_by`, which agent)


KEYS = tuple(f.name for f in fields(FeedbackKeys))


def as_list(v) -> list:
    return v if isinstance(v, list) else [v] if isinstance(v, str) and v else []


def normalize(row: dict) -> dict:
    """The row with `tags` as a list when the note wrote it as one value. Only keys the note wrote are touched: a row
    without them comes back unchanged (the same object), so an old box folds byte for byte."""
    if "tags" in row and not isinstance(row["tags"], list):
        return {**row, "tags": as_list(row["tags"])}
    return row


def problems(path: str, meta: dict) -> list[dict]:
    """What is wrong with one note's §22.4 keys, each {lint, where, what, fix}."""
    out = []

    def bad(what: str, fix: str) -> None:
        out.append({"lint": "feedback-keys", "where": path, "what": what, "fix": fix})

    tags = as_list(meta.get("tags")) if "tags" in meta else []
    if "tags" in meta and not tags and meta.get("tags") != []:
        bad(f"tags: {meta.get('tags')!r} is not a list of tags", "write tags: [bug-report] (lowercase, a-z 0-9 -)")
    for tag in tags:
        if not isinstance(tag, str) or not TAG.match(tag):
            bad(f"tag {tag!r} is not a tag", f"lowercase, a-z 0-9 -; a bug report is `{BUG}`")
    if BUG in tags and not as_list(meta.get("source")):
        bad("is tagged bug-report but names no source", "add `source: [<the report's path or url>]`: a bug report links to "
            "where it came from")
    if "status" in meta and meta["status"] not in STATUSES:
        bad(f"status: {meta['status']!r} is not one of {', '.join(STATUSES)}", "open (the default) or obsolete")
    if meta.get("status") == "obsolete" and not (isinstance(meta.get("obsolete_why"), str) and meta["obsolete_why"]):
        bad("is obsolete without obsolete_why", "say why it no longer applies: obsolete_why: <one line>")
    if "obsolete_why" in meta and meta.get("status") != "obsolete":
        bad("has obsolete_why but status is not obsolete", "set status: obsolete, or drop obsolete_why")
    if "entered_by" in meta and meta["entered_by"] not in ENTERED_BY:
        bad(f"entered_by: {meta['entered_by']!r} is not one of {', '.join(ENTERED_BY)}",
            "user (a person typed it) or ai (an agent wrote it)")
    for key in ("spec", "specs"):
        if key in meta and not isinstance(meta[key], list) and not (isinstance(meta[key], str) and meta[key]):
            bad(f"{key}: {meta[key]!r} is not a list of spec ids", f"write {key}: [O4.3]")
    return out
