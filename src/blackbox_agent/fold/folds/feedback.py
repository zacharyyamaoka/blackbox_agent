"""The `feedback` slice's §22.4 keys (viewer/CONTRACT.md §22.4): S0's rows (fold_state.front_matter_rows, every field
unchanged) with `tags` read as a list when a note writes one tag. A note's other new keys (`status`, `obsolete_why`,
`obsolete_by`, `entered_by`, `spec`) already pass through as written; `_bb_feedback.py` defines them and `blackbox
check` holds them.

    def fold(facts) -> list | None

None (S0's slice stands) unless a row changes: a box whose notes do not write the keys folds byte for byte as before.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _bb_feedback  # noqa: E402


def fold(facts: dict):
    rows = facts["state"].get("feedback")
    if not isinstance(rows, list):
        return None
    out = [_bb_feedback.normalize(r) for r in rows]
    return out if any(a is not b for a, b in zip(out, rows)) else None
