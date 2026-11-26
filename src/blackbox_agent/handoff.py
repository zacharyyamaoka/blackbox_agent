"""The paste-ready handoff for a stock Blackbox page, taken from its build ref."""

import json
from pathlib import Path
from textwrap import dedent


FILES = ("OBJECTIVES.md", "AGENTS.md", "PROGRESS.md", "ideas.md", "README.md", "status.json")
PATH = "data/agent-handoff.md"


def prompt(who: dict, ref: str, context: dict[str, str], latest_score: str = "") -> str:
    repo = f"https://github.com/{who['owner']}/{who['repo']}" if who["owner"] else who["repo"]
    title = json.dumps(who["name"], ensure_ascii=False)
    heading = " ".join(who["name"].splitlines())
    # WHY spell out the host controls: the repo goal and Ideas board do not activate a chat goal or run a worker.
    brief = dedent(f"""\
        # Drive {heading}

        Ensure the chat is named: {title}
        Use the host's rename action to set this chat's title to the exact value of that JSON string.
        If the current host has no rename action, continue with the work.

        Drive this black box toward a verified milestone. I am asking you to pursue a persistent goal in this chat,
        work through eligible ideas, and dispatch native subagents for independent parts of the work.
        If I separately give you a read-only or one-off assignment, keep that scope and leave existing Goals alone.

        - Repository: {repo}
        - Dashboard snapshot: `{ref}`. Read the current checkout and ledger before making decisions.

        ## Work the box

        1. Locate the repo by its remote or use your existing checkout. In that checkout, run
           `vt bind --box . --peers --json` to register this session and find active peers on this exact track.
           If this session's identity is missing, use its verified native session ID with `--sid`.
           If Vibe Tracks is unavailable, continue using the box's repo and any existing peer directory.
        2. Use `active_peers` to introduce yourself via native session messaging. Use Codex thread messaging for a
           verified Codex thread, or Claude's agent directory and SendMessage for a verified Claude session. Include
           your intended lane and ask what they already own. Coordinate before editing a shared seam. If a route is
           unavailable, state that and check the repo's current branches and worktrees.
        3. Read `OBJECTIVES.md` and `AGENTS.md` first. Run `blackbox skill` if installed for the shared operating
           instructions. Read the box's goals, `PROGRESS.md`, `ideas.md`, `status.json`, and relevant `ledger.jsonl`
           entries. Choose the requested milestone or an actionable open goal, with evidence and fixed constraints.
           If neither exists, pick one bounded deliverable, such as a dev evaluation with a prediction, scorecard,
           and ledger entry. Select an eligible unowned idea for that milestone and confirm ownership. If the board
           is available, run
           `vt box-work show --box .` and `vt box-work claim <idea> --box .` with the current board's idea ID.
           If the claim conflicts, pick another eligible idea. Start the work this turn.
        4. The main agent owns the goal and integration. Launch subagents for independent verification, experiments,
           or implementation lanes that can progress without conflicting edits. Assign each an idea or task, owned
           files or a read-only scope, and the evidence to return. Keep working on the part you own, then verify and
           integrate their results. Report actual delegation and results in the chat.
        5. Run the repo's real checks. Keep its ruler fixed and its ledger append-only. Report the idea ID, gate or
           metric, result, and next action. Record the evidence and run `vt box-work done <idea> --box .`
           for finished work, or leave a checkpoint and run `vt box-work release <idea> --box .` when handing it back.
           If the milestone is still unmet, claim the next eligible idea and continue. A failed attempt is a
           checkpoint. If no viable action remains, record the actual blocker and follow the host's goal lifecycle.

        ## Host controls

        Use the section for this chat's host. If a capability is missing, say what is unavailable and do the
        authorized work you can in the current turn. Leave a matching paused goal paused until I ask to resume it.
        If a different goal owns the chat, keep it intact and take only a compatible action. Honor one-off and
        read-only requests without starting a goal or schedule.

        ### Codex

        - Call `get_goal`. Reuse a matching active Goal. After confirming your lane, call `create_goal` if
          there is no unfinished Goal. Call `update_goal` to complete it only after verifying the stated result.
        - Use native Codex subagents for the independent assignments above.
        - For recurring work I explicitly requested, use the app's automation tools where available. Check
          for an existing equivalent schedule first. Keep a single confirmed schedule with the agreed cadence,
          next run, work to perform, and a stop or review condition. A finite goal uses goal continuation.

        ### Claude Code

        - Inspect the session goal with `GetGoal` if exposed. Use `SetGoal` where offered to propose the
          selected milestone and evidence. Confirm what the host actually accepted. The corresponding
          user command is `/goal <completion condition>`. If the host only exposes the command, keep working
          now and give that exact command for the current milestone where useful. Preserve other active goals.
        - Use Claude's native `Agent` tool (named `Task` in some builds) for the independent assignments above.
        - For recurring work I explicitly requested, use Claude's session scheduling tools or `/loop` where
          supported. Check existing schedules first, confirm the cadence and next run, and include a stop or
          review condition. Use the session goal for a finite completion condition.
        """).strip()
    sections = [f"## {name} at the dashboard snapshot\n\n{text}" for name, text in context.items()]
    if latest_score:
        sections.append(f"## Latest recorded evaluation\n\n{latest_score}")
    return "\n\n".join([brief, *sections]) + "\n"


def write(box: Path, ref: str, tracked: set[str], site: Path, who: dict, *, include_context: bool) -> str:
    """Write the handoff and return the exact stock prefix for the private prose scan."""
    from blackbox_agent.site import git

    context = {}
    latest_score = ""
    # WHY local only: the handoff can include the box's working instructions. A public dashboard already has a repo
    # link, but building it must not silently publish new source files or expand private citation targets.
    if include_context:
        goals = sorted(name for name in tracked if Path(name).parent == Path("goals") and name.endswith(".md"))
        context = {name: git(box, "show", f"{ref}:{name}").rstrip() for name in (*FILES, *goals) if name in tracked}
        if "ledger.jsonl" in tracked:
            latest_score = next((line for line in reversed(git(box, "show", f"{ref}:ledger.jsonl").splitlines())
                                 if line.strip()), "")

    nav = site / "nav.json"
    try:
        doc = json.loads(nav.read_text(encoding="utf-8"))
    except ValueError:
        return ""  # The site bar and blackbox check already report malformed navigation.
    if not isinstance(doc, dict) or not isinstance(doc.get("site"), dict):
        return ""  # The site bar and blackbox check already report malformed navigation.
    # WHY use the site name: a box may give its dashboard a title distinct from the README.
    name = doc["site"].get("name")
    shown = {**who, "name": name} if isinstance(name, str) and name.strip() else who
    stock = prompt(shown, ref, {})
    (site / PATH).write_text(prompt(shown, ref, context, latest_score) if context or latest_score else stock,
                             encoding="utf-8")
    doc["site"]["handoff"] = PATH
    nav.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return stock
