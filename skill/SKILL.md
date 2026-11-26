---
name: blackbox
description: Drive or continue work in a blackbox_agent repository. Use for Codex or Claude Code worker goals, delegation, experiment loops, idea claims, and measurable box goals with a frozen ruler.
---

# Work a black box

A box has one objective, a frozen ruler, candidate solutions, and an append-only evaluation ledger. Read the box's
`AGENTS.md` for its commands and local rules, then `OBJECTIVES.md` for its allowed inputs, outputs, objective, and gates.
Check `PROGRESS.md`, `ideas.md`, and the latest relevant `ledger.jsonl` entries before choosing work. The box's own
instructions govern its paths and evaluation commands.

## Lead work toward a milestone

- On a continuing assignment, including Copy for AI, own the assigned or open milestone, its evidence, and
  integration. If the box has no actionable goal for your lane, choose a bounded deliverable such as a dev
  evaluation with a pre-run prediction and a recorded outcome. Keep one-off and read-only requests scoped.
- When authorized and the work separates cleanly, dispatch native subagents. Give each an independent scope,
  owned files or read-only access, and evidence to return. Start your own work this turn, verify the returned
  results, then close or release the claim. Claim the next eligible idea if the milestone is still unmet.
- Keep paused and unrelated goals intact. Complete a goal only after verifying its required evidence. If no viable
  action remains, record the blocker, what you tried, and what would unblock it. Follow the host's goal lifecycle.

### Codex

Use native subagents. Call `get_goal` and reuse a matching active Goal. With no unfinished goal, call
`create_goal` after confirming your lane. Use `update_goal` after verifying completion. For explicitly
requested recurring work, use the available app automation tools.

### Claude Code

Use the native `Agent` tool (`Task` in some builds). Read the session goal with `GetGoal` if exposed and
use `SetGoal` if offered. Confirm the accepted state. If only `/goal` is available, continue working in
the current turn and provide the exact `/goal <completion condition>` command where useful. For explicitly
requested recurring work, use session scheduling or `/loop` where supported.

On either host, look for an equivalent schedule before creating one. Confirm its cadence, next run,
scope, and stop or review condition. A finite milestone uses goal continuation. If a capability is unavailable,
report it and keep doing the work you can in the current turn.

## Register and take an idea

- In the checkout run `vt bind --box . --peers --json` when Vibe Tracks is available. Introduce your lane to reachable
  active peers through native session messaging. Check active branches and worktrees for shared files.
- Run `vt box-work show --box .`, select an unowned idea that addresses an objective or failing gate, and run
  `vt box-work claim <idea> --box .` with its Ideas board ID from the current build. If the claim conflicts, check
  the current board and pick another idea or coordinate with its owner. Include the exact gate or criterion you plan
  to move in your first chat update.
- If registration or the live board is unavailable, say what you could verify. Inspect the repo for active owners and
  take an independent lane. Use branch, commit, and evaluation evidence for that lane's status.
- After recording a verified result, run `vt box-work done <idea> --box .` for your completed claim. If you hand
  the work back to the queue, leave the checkpoint and run `vt box-work release <idea> --box .`. If completion or
  release fails, report it in the chat so the next agent can reconcile the board.

Keep the chat readable as a short activity log. Update it when you start, when work changes direction or gets blocked,
and when you have evidence. Name the idea, the gate or objective, the result when available, and the next action.

- **Starting** — “Claimed I-021. I'm testing whether the new candidate reduces `tool_track_rms_mm` on dev while the
  frozen gates pass.”
- **Blocked** — “I-021 evaluation stopped before a scorecard because the required dev input is missing. The checkout
  and command are in the checkpoint. I released the claim.”
- **Finished** — “I-021 finished. The dev scorecard and ledger row are at `<commit>`. The candidate missed the goal
  threshold, so the goal remains open.”

## Run the experiment

1. Pick a parent (best admissible or an established niche winner) and propose one change. Use the box's own creation
   command if available. The candidate's `solutions/<id>/meta.json` records `id`, `parent`, `change`, `proposed_by`
   (agent, model, session), `created`, `tags`, dotted `name` (for example `P5.s.pass3`), `summary` (at most 150
   characters), `description`, and `expect`. **Commit the prediction before evaluation.** `blackbox check` reports
   an expectation added in or after the commit that scores it.
2. Run the box's evaluator on dev. Preserve its allowed input boundary and keep the objective, ruler, gates, and
   evaluation data fixed. Use holdout only to report a finished solution. A ruler revision is separate work.
3. Keep the outcome, including a losing run. The box records the scorecard, appends to `ledger.jsonl`, and refreshes
   `PROGRESS.md` and `status.json`. Keep every scored ledger row. A new best must beat the prior best by more than
   a relative `1e-9`. Ablations explain results and use the `ablation` tag.
4. Cross off a tried idea with its solution ID and add the next useful idea where warranted. Preserve earlier queue
   entries. Attach feedback using the box's existing format. If test coverage changed, update existing spec-to-test
   links in the same commit so the displayed spec status derives from the new evidence.
5. Rebuild with the box's documented commands. Use `blackbox check --box .` and `blackbox serve --box .` when
   available. Inspect the resulting dashboard; its build and test artifacts have their own revisions. If required
   checks or data are unavailable, report the missing evidence and leave the result unverified. Commit only the
   paths you own. Keep machine-specific paths and private context out of public site artifacts.

## Set a goal and link the plan

Use the box's actual objective, gate IDs, scorecard diagnostics, and spec requirement IDs. Translate the requested
outcome into a target with a due date. Keep the baseline, unit, measurement source and ruler version traceable to
the box. Goals can tighten a frozen gate. Requesting a looser gate or a new measurement is a separate ruler decision.

A goal file is `goals/<id>-<slug>.md`. This example uses real trajectory-tracking criterion IDs. Substitute the IDs
measured by the current box.

```markdown
---
vibe-goal: Ready for the real arm
vibe-done-when:
  - gate:all
  - kpi:tool_track_rms_mm <= 0.030
  - feature:O1.1
vibe-target: 2026-12-04T17:00-08:00
tier: must
set: 2026-11-25T16:30-08:00
---

The goal requires both the dev trajectory score and the repository requirement.
```

Add roadmap sub-bullets to the relevant entries in `ideas.md`:

```markdown
  - Goal: G2 · step 1 · objective
  - Effort: 45 min
  - Expect: tool_track_rms_mm −4 %
  - By: 2026-11-25T21:30-08:00
```

Give each idea that serves a goal a `- By:` (when it will land; `- By: 21:30` means that time on the goal's set day) and
an `- Expect:` bet. The Goals page draws the Planned line only from those committed lines, so a plan is changed in
`ideas.md`, in git, where the change is visible. An idea without a `- By:` lands at its effort × the buffer and is drawn
as an estimate.

Set `tier` to `must` or `stretch`. Use `step N` when the plan differs from file order. Use exact criterion IDs where an
idea addresses a gate, diagnostic or spec. Name human waits and leave their duration open. Keep effort and predictions
separate from measured values. One candidate must satisfy all solution-level criteria on dev; the box's test evidence
judges spec criteria. Build and check the goal. If a metric or ruler is unavailable, report that the goal cannot yet be
judged and cite the missing measurement instead of assigning a value.

## Scenario checks

- A Codex worker with an open milestone and no chat Goal creates the Goal with a verification condition and starts
  the work this turn. A missed target leaves the Goal active and the worker takes another viable action.
- A matching active Goal is reused. A paused or unrelated Goal stays intact. A read-only audit stays read-only.
- A worker has two independent lanes. Actual subagent calls name their scopes and evidence. The main agent
  verifies their results, records the outcome, and advances to the next eligible idea if the goal remains open.
- A Claude worker uses its own tools, or keeps working and reports command-only goal activation. A recurring
  assignment reuses or creates one confirmed schedule. A finite milestone has no new schedule.
- A fresh box with no actionable goal gets a bounded deliverable. Without Goal tools, the worker executes the
  deliverable in the current turn.
- Two agents choose the same idea. The accepted claim has one owner, and the other agent takes a different lane.
- The local board is unavailable. The chat names the gap and identifies the branch and checkpoint used to coordinate.
- A goal names an unknown metric. The check reports it and the agent leaves that criterion unverified.
- A dev candidate loses. Its prediction predates evaluation, the frozen ruler stays fixed, and the scorecard and ledger
  let the next agent resume.
