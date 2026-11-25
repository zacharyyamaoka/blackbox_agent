# fold/: one box at one git ref -> state.json (bb-state/1)

Stdlib + git, read-only on the box: every file through `git show <ref>:<path>` and `git log <ref>`, never the working
tree, so the same ref folds to the same bytes. It reads the box's metrics and provenance (README, OBJECTIVES.md,
status.json, ledger.jsonl, solutions/*/meta.json and scorecards, ideas.md, specs/, feedback/, git log), never a
solution's code, and never invents a number: what it cannot read is left out, or null with a `why`.

```bash
python3 fold_state.py --repo <box> --ref HEAD --out state.json [--junit site/data/junit.xml] [--junit-dir site/data/junit]
```

`--junit`, `--junit-dir` and `--spec-map` are relative to the working directory, and land in state.json as written:
`blackbox build` runs the fold from a copy of the box's tree, so they read `site/data/...`.

| File | What |
|---|---|
| `fold_state.py` | the driver: the standard box and robot_controllers' population grade |
| `fold_runs.py` | the codec for a box's saved playback (bb-run/1 records) |
| `folds/<slice>.py` | one plug-in per slice of state.json, `def fold(facts) -> object` (a new file is a new slice) |
| `lib/` | the modules the slices share: the ideas.md parser and model, the roadmap and its rows, the junit reader, the ablation study's analysis |

Released from the blackbox_agent lab, where the design rounds that produced `lib/` live; every release is tested to fold
each registered box byte-identically to the lab's own fold. Fix the fold there, not in a copy.
