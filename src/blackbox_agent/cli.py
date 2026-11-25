"""The `blackbox` command: build, serve, new and check a black-box agent box."""

from __future__ import annotations

import argparse
import errno
import functools
import http.server
import shutil
import signal
import sys
import tempfile
from pathlib import Path

from blackbox_agent import __version__
from blackbox_agent.site import PKG, BoxError, build

SKILL = PKG / "skill" / "SKILL.md"
DEFAULT_PORT = 8765


def _build(a: argparse.Namespace) -> int:
    record = build(Path(a.box), Path(a.out), a.ref)
    print(f"{a.out}: {record['box']} @ {record['ref'][:7]}; landing {record['landing']}, nav.json {record['nav']}, "
          f"overrides: {', '.join(record['overrides']) or 'none'}"
          + (f"; kept {', '.join(record['kept'])} from the committed state.json" if record["kept"] else "")
          + (f"; dropped {'; '.join(record['dropped'])}" if record["dropped"] else "")
          + (f"; carried {len(record['carried'])} picture(s) the docs show into data/files/" if record.get("carried") else ""))
    return 0


def _server(port: int | None, handler) -> http.server.ThreadingHTTPServer:
    """A server on 127.0.0.1: the port asked for; with none asked, 8765, else any free one.
    WHY (Zach hit it, 2026-11-24): many servers run on this machine, and a handoff command must work on the first click;
    only a port the user named may refuse to start, and it says which."""
    try:
        return http.server.ThreadingHTTPServer(("127.0.0.1", DEFAULT_PORT if port is None else port), handler)
    except OSError as e:
        if e.errno != errno.EADDRINUSE:
            raise
        if port is not None:
            raise BoxError(f"port {port} is in use: name another --port, or leave --port out to get a free one") from None
        return http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)


def _serve(a: argparse.Namespace) -> int:
    tmp = Path(tempfile.mkdtemp(prefix="blackbox-serve-"))
    # WHY: a plain `kill` (SIGTERM) must remove the temporary build too, as Ctrl-C does
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    try:
        out = tmp / "site"
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(out))
        with _server(a.port, handler) as server:  # bound before the build: a busy --port fails at once
            record = build(Path(a.box), out, a.ref)
            port = server.server_address[1]
            print(f"http://127.0.0.1:{port}/  {record['box']} @ {record['ref'][:7]} (dashboard: /dashboard/; "
                  f"Ctrl-C stops it)" + (f"; {DEFAULT_PORT} was busy" if a.port is None and port != DEFAULT_PORT else ""),
                  flush=True)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return 0


def _new(a: argparse.Namespace) -> int:
    from blackbox_agent.box import new

    files = new(Path(a.dir), a.name, a.owner, a.repo, a.objective, a.direction, commit=not a.no_git)
    print(f"{a.dir}: {len(files)} files ({', '.join(files)})" + ("" if a.no_git else ", committed on main"))
    print("next: write OBJECTIVES.md (the objective, the gates, the ruler), then AGENTS.md's domain rules; "
          "`blackbox serve --box " + a.dir + "` shows the page")
    return 0


LINT_LISTED = 20  # per lint; `--all` lists every one


def _check(a: argparse.Namespace) -> int:
    import re

    from blackbox_agent.box import check

    problems, notes = check(Path(a.box), a.ref)
    for n in notes:
        print(f"note: {n}")
    # WHY capped per lint, with the count: a box new to the lints can have a hundred of one kind, and the first screen
    # must still show every kind of problem (and the fix for each)
    by_lint: dict[str, list[str]] = {}
    for p in problems:
        m = re.match(r"\[([a-z-]+)\] ", p)
        by_lint.setdefault(m.group(1) if m else "", []).append(p)
    for lint, found in by_lint.items():
        shown = found if a.all or not lint else found[:LINT_LISTED]
        for p in shown:
            print(f"PROBLEM: {p}")
        if len(found) > len(shown):
            print(f"PROBLEM: [{lint}] ... and {len(found) - len(shown)} more ({len(found)} in all; "
                  f"`blackbox check --all` lists every one)")
    print(f"{len(problems)} problem(s)" if problems else "the box is in the format")
    return 1 if problems else 0


def _skill(a: argparse.Namespace) -> int:
    if a.path:
        print(SKILL)
    else:
        sys.stdout.write(SKILL.read_text())
    return 0


def parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="blackbox",
        description="The shared half of every black-box agent repo: fold a box's git history into its page, "
                    "build the landing + dashboard, start a box, check one.")
    ap.add_argument("--version", action="version", version=f"blackbox-agent {__version__}")
    sub = ap.add_subparsers(dest="command", required=True, metavar="command")

    p = sub.add_parser("build", help="fold the box's ref into state.json and write its whole site to --out")
    p.add_argument("--box", default=".", help="the box (a git repo; default: the current directory)")
    p.add_argument("--out", required=True, help="the folder to write the site to (e.g. _site)")
    p.add_argument("--ref", default="HEAD", help="the box commit to build (default HEAD; never the working tree)")
    p.set_defaults(run=_build)

    p = sub.add_parser("serve", help="build the box into a temporary folder and serve it on 127.0.0.1")
    p.add_argument("--box", default=".")
    p.add_argument("--port", type=int, default=None,
                   help=f"default {DEFAULT_PORT}, or a free port when {DEFAULT_PORT} is busy; a port you name must be free "
                        "(0 picks a free one)")
    p.add_argument("--ref", default="HEAD")
    p.set_defaults(run=_serve)

    p = sub.add_parser("new", help="write a box skeleton (the stock files, an empty ledger) into a new folder")
    p.add_argument("dir")
    p.add_argument("--name", help="the box's display name (default: from the folder's name)")
    p.add_argument("--owner", help="its GitHub owner, for the README's live-page line")
    p.add_argument("--repo", help="its GitHub repo name (default: the folder's name)")
    p.add_argument("--objective", default="score", help="the one number the box optimizes (default: score)")
    p.add_argument("--direction", choices=["lower", "higher"], default="lower")
    p.add_argument("--no-git", action="store_true", help="do not git init and commit the skeleton")
    p.set_defaults(run=_new)

    p = sub.add_parser("check", help="is the box in the format (every named file is a link, every relative link lands, "
                                     "the required paths exist), does its site build, what does the package replace")
    p.add_argument("--box", default=".")
    p.add_argument("--ref", default="HEAD")
    p.add_argument("--all", action="store_true", help=f"list every lint finding (default: the first {LINT_LISTED} of each)")
    p.set_defaults(run=_check)

    p = sub.add_parser("skill", help="print the blackbox loop (the skill: read, propose, evaluate, rebuild, commit)")
    p.add_argument("--path", action="store_true", help="print the SKILL.md path instead (to link it as a skill)")
    p.set_defaults(run=_skill)
    return ap


def main(argv: list[str] | None = None) -> int:
    a = parser().parse_args(argv)
    try:
        return a.run(a)
    except BoxError as e:
        print(f"blackbox {a.command}: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
