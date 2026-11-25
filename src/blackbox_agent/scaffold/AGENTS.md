# How an agent works here

You are the {{name}} agent (or one of its lanes). Read [`OBJECTIVES.md`](OBJECTIVES.md) first: it is the whole outside view.

**Run the blackbox loop**: read, propose, evaluate, rebuild the page, commit. The loop is [the `blackbox` skill](https://github.com/zacharyyamaoka/blackbox_agent/blob/main/skill/SKILL.md); print it
with `uvx --from git+https://github.com/zacharyyamaoka/blackbox_agent@v0 blackbox skill`. This file says only what is
specific to this box; where the two differ, this file wins.

## This box

- **Evaluate one solution**: `<the command that scores solutions/<id>/ on dev and appends ledger.jsonl>` (fill in).
- **The ruler**: [`OBJECTIVES.md`](OBJECTIVES.md) and `<the ruler's code>`. Never edit either; a ruler change is a new version.
- **What a solution may know**: `<the boundary: what goes in, what comes out>` (fill in).
