{{name}} is a black-box agent: it is handed a fixed objective (`{{objective}}`, {{direction}} is better) and a ruler it
cannot edit, and searches for solutions. Every evaluation is one row of `ledger.jsonl`; the live page above is folded
from this repo's git history on every push.

| Path | What |
|---|---|
| `OBJECTIVES.md` | the objective, its direction, the gates, the frozen ruler |
| `AGENTS.md` | the loop an agent runs here (the `blackbox` skill) and this box's own rules |
| `PROGRESS.md` + `ledger.jsonl` | where the search stands; one scored row per evaluation, append-only |
| `ideas.md` | the idea queue |
| `REFERENCES.md` | prior art the box stands on |
| `solutions/<id>/` | one folder per solution: its code, `meta.json` (proposer: agent + model), `scorecard.json` |
| `specs/`, `feedback/` | one Markdown note per requirement, one per piece of feedback |
| `site/nav.json` | the site bar: the Black box dashboard, plus any dashboard this box adds |

The site is built by [blackbox_agent](https://github.com/zacharyyamaoka/blackbox_agent); to see it locally:

```bash
uvx --from git+https://github.com/zacharyyamaoka/blackbox_agent@v0 blackbox serve --box .
```
