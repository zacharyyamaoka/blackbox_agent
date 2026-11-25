---
name: blackbox
description: The black-box agent loop (read, propose one solution, evaluate it on dev with the box's frozen ruler, rebuild the page's data, commit) for any repo in the blackbox_agent format (OBJECTIVES.md + ledger.jsonl + solutions/). Use when a box's AGENTS.md says "run the blackbox loop", or when asked to improve a box's objective.
---

# The blackbox loop

A **box** is one repo: a fixed objective and a ruler it cannot edit (`OBJECTIVES.md`), a scored population
(`solutions/`, `ledger.jsonl`), and a live page folded from its git history. The box's `AGENTS.md` says what is
specific to it: the command that evaluates a solution, the ruler's files, what a solution may know, its lessons so
far. Where the box's `AGENTS.md` and this skill differ, the box wins.

## The loop

1. **Read.** `OBJECTIVES.md` first: it is the whole outside view. Then `PROGRESS.md` (where the search stands),
   `ideas.md` (the queue) and the leaderboard (the box's own command, or the newest rows of `ledger.jsonl`).
2. **Propose one solution.** Pick one idea from `ideas.md`, or propose one. Write it as `solutions/<id>/` with a
   `meta.json`: `id`, `parent` (the best, or a niche winner), `change` (the one change, in words), `proposed_by`
   (`agent`, `model`, `session`), `created`, `tags`. Use the box's own `new` command when it has one; a solution
   without a proposer is refused.
3. **Evaluate it on dev**, with the box's evaluate command (its `AGENTS.md`). That writes
   `solutions/<id>/scorecard.json`, appends one row to `ledger.jsonl` (append-only: never edit or delete a row) and
   refreshes `PROGRESS.md` and `status.json`. Never evaluate on holdout to choose.
4. **Rebuild the page's data**, win or lose. The box's own site build writes what it exports into `site/data/`, and
   `site/data/junit.xml`: the test run the Spec page reads, with pytest's hostname dropped and paths made relative,
   because the page may be public. Look at the page before you commit:
   `uvx --from git+https://github.com/zacharyyamaoka/blackbox_agent@v0 blackbox serve --box .`
   (`blackbox check --box .` says what the box is missing). CI re-folds `site/data/state.json` from every pushed
   commit (`.github/workflows/pages.yml` calls blackbox_agent's `site.yml`), so the live page is never behind `main`;
   CI never re-runs the tests, so the Spec page is only as fresh as the `junit.xml` you commit.
5. **Commit** the solution with what it changed, by pathspec: `git add -- solutions/<id> site/data` (a new folder is
   untracked), then `git commit -m "<id>: <change> -> <objective>" -- solutions/<id> ledger.jsonl PROGRESS.md
   status.json ideas.md site/data specs feedback`. Never `git add -A`: other lanes may share the index.
6. **Update `ideas.md`.** Cross off what you tried with the solution id that tried it, and add what the result
   suggests. Never delete a line.

Then go round again. State lives in files, so any session can stop at any point (a rate limit, a crash) and the next
one resumes from `ledger.jsonl`, `solutions/` and `ideas.md` without a handover.

## Rules every box shares

- **Never edit the ruler**: `OBJECTIVES.md` and the ruler's code and data (the box's `AGENTS.md` names them). A ruler
  change is a new version, proposed for the box's owner, never made inside a solution.
- **Learn only through the boundary** `OBJECTIVES.md` §1 draws: never read the truth the ruler scores against, from
  any file of a solution (helpers included).
- **Never select on holdout.** It is scored only to report a finished solution.
- **One change per solution**, named in `meta.json`'s `change`, so the lineage reads as a story.
- **Keep the losers.** A discarded solution's scorecard tells the next agent what not to try.
- **A float tie is not progress**: a new best beats the last by more than a relative 1e-9.
- **Ablations are tagged `ablation`** in `meta.json`: they explain the best, they are not search progress.
- **Feedback is a file**: `feedback/<date>-<slug>.md` (Observed / Desired / Why) when you act on it.
- **A spec changes with its tests**: when a test starts or stops proving a requirement, edit that
  `specs/<id>-*.md`'s `tests:` in the same commit. Never type a status; the page derives it.
- **The page may be public**: nothing under `site/` names a home directory, a hostname or a private repo.
- **A named thing is a link**: a file, folder, repo or note the box's docs name is a link, never bare `code`. The box's
  own files are relative links (`` [`ideas.md`](ideas.md) ``), a repo is its GitHub URL, and a note or chat only one
  machine can open is a private root URI. Pictures live inside the box (`site/assets/`), never at `../`. `blackbox
  check` fails on an unlinked name or a link that lands on nothing, with the fix for each.

## The page: what the box holds, what the package holds

The box holds only what is true of it. blackbox_agent builds the rest at every push:

| The box holds | blackbox_agent builds |
|---|---|
| `site/nav.json` (the site bar: the Black box, plus the box's own dashboards) | the landing page, unless the box overrides it with `site/overrides/index.html` (a plain `site/index.html` is not used) |
| `site/tabs/`, its domain dashboards under `site/` | the dashboard (`dashboard/`), every viewer component |
| `site/overrides/<tag>.js`: its own version of one stock component | the import map that swaps it in, and the count on the page |
| `site/data/` slices its own export writes (`playback`), `junit.xml` | `data/state.json`, folded from the pushed commit |

An override wraps or replaces one stock component. It reaches the stock module by the same URL plus `?stock`, which
the import map leaves alone:

```js
// site/overrides/bb-site-nav.js
import { BBSiteNav } from '../dashboard/viewer/src/components/bb-site-nav.js?stock';
export * from '../dashboard/viewer/src/components/bb-site-nav.js?stock';
const stockRender = BBSiteNav.prototype.render;
BBSiteNav.prototype.render = function () { stockRender.call(this); /* the box's one addition */ };
```

The stock import paths are relative to `site/overrides/`. Promote a good override into blackbox_agent so every box
gets it.
