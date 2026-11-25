"""`blackbox new` (a box skeleton) and `blackbox check` (is this box in the format, and what does the package replace).

The format's lints (a named thing is a link, a relative link lands, the required paths exist) are lint.py."""

from __future__ import annotations

import json
import re
import subprocess
import tempfile
from datetime import date
from pathlib import Path

from blackbox_agent import sources
from blackbox_agent.lint import lint
from blackbox_agent.site import PAGES_LINE, PKG, STRAY_LANDING, TEMPLATE, BoxError, build, fill, git, identity, need

SCAFFOLD = PKG / "scaffold"
# scaffold file -> its path in the box (WHY renamed: a packaged dot-file can be dropped by a build backend, and a nested
# .github/ folder reads as this repo's own workflows)
RENAME = {"github/workflows/pages.yml": ".github/workflows/pages.yml", "gitignore": ".gitignore"}
# from the stock template (template/): the README's live-page line and its test, the site bar's file
FROM_TEMPLATE = ("site/nav.json", "tests/test_readme_landing_link.py")
# WHY the lookbehind: a folder named home inside a GitHub URL's path (vibetracks_agent @ ef18c13 links its stock part
# at …/vibetracks/ + home + /static/…) is a folder of a repo, not a home directory; check read it as 3 home paths
HOME_PATH = re.compile(r"(?<![\w.-])/h[o]me/[A-Za-z0-9_.-]+")
REL = re.compile(r"^(?![a-z][a-z0-9+.-]*:)(?!/)(?!.*(?:^|/)\.\.(?:/|$))\S*$", re.I)
TEXT = {".html", ".js", ".mjs", ".css", ".json", ".jsonl", ".md", ".svg", ".txt", ".xml", ".base", ".csv", ".yml", ".yaml"}


def _kind(path: str) -> str:
    return "json" if path.endswith((".json", ".jsonl")) else "html" if path.endswith(".html") else "text"


def new(dest: Path, name: str | None = None, owner: str | None = None, repo: str | None = None,
        objective: str = "score", direction: str = "lower", commit: bool = True) -> list[str]:
    """Write a box skeleton into `dest` (a new or empty folder); returns the files written."""
    dest = Path(dest).expanduser().resolve()
    if dest.exists() and any(dest.iterdir()):
        raise BoxError(f"{dest} is not empty: `blackbox new` writes a box into a new folder")
    if not re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", objective):
        raise BoxError(f"--objective {objective!r}: one identifier, like tool_track_rms_mm")
    repo = repo or dest.name
    values = {"name": name or repo.replace("_", " ").replace("-", " ").title(), "owner": owner, "repo": repo,
              "objective": objective, "direction": direction, "date": date.today().isoformat(),
              "kpi_direction": "down" if direction == "lower" else "up"}
    files: dict[str, str] = {}
    header = fill(need(TEMPLATE / "README.header.md", "the README header").read_text(), values, "text").rstrip("\n")
    files["README.md"] = header + "\n\n" + fill((SCAFFOLD / "README.body.md").read_text(), values, "text")
    for src in sorted(p for p in SCAFFOLD.rglob("*") if p.is_file() and p.name != "README.body.md"):
        rel = src.relative_to(SCAFFOLD).as_posix()
        if "__pycache__" in rel:
            continue
        out = RENAME.get(rel, rel)
        files[out] = fill(src.read_text(), values, _kind(out))
    for rel in FROM_TEMPLATE:
        files[rel] = fill(need(TEMPLATE / rel, rel).read_text(), values, _kind(rel))
    for rel, text in files.items():
        path = dest / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    if commit:
        subprocess.run(["git", "init", "-q", "-b", "main", str(dest)], check=True)
        subprocess.run(["git", "-C", str(dest), "add", "--", *sorted(files)], check=True)
        done = subprocess.run(["git", "-C", str(dest), "commit", "-q", "-m",
                               f"{values['name']}: a black-box agent box (blackbox new)"], capture_output=True, text=True)
        if done.returncode != 0:
            raise BoxError(f"the skeleton is written, but git commit failed: {done.stderr.strip()} "
                           f"(set git's user.name and user.email, then commit it yourself)")
    return sorted(files)


def check(box: Path, ref: str = "HEAD") -> tuple[list[str], list[str]]:
    """(problems, notes) for the box at `ref`. A problem is something that keeps the box out of the format or its
    page from working; a note is what the package does for the box, or what it replaces."""
    box = Path(box).expanduser().resolve()
    problems: list[str] = []
    notes: list[str] = []
    try:
        sha = git(box, "rev-parse", f"{ref}^{{commit}}").strip()
    except BoxError as e:
        return [str(e)], notes
    tracked = set(git(box, "ls-tree", "-r", "--name-only", sha).splitlines())

    def text(path: str) -> str | None:
        if path not in tracked:
            return None
        return git(box, "show", f"{sha}:{path}")

    # the conformance lints (lint.py): missing-path, unlinked-name, broken-link; each finding is one problem
    findings, lint_notes = lint(box, sha, tracked)
    problems += [str(f) for f in findings]
    notes += lint_notes
    # private sources (sources.py): a box file that names a private place, read before the build (which refuses one)
    here = sources.machine()
    repo = identity(box, sha)["repo"]
    side = sources.private_side(None, repo, m=here, text=False) if here is not None else sources.PrivateSide()
    # WHY an obsidian: link in a box file is a note, not a problem: the format counts it as a link (a private root
    # URI, lint.py), and boxes in the format carry them; only a place this machine knows is private is a problem
    found = sources.ref_findings(box, sha, tracked, side)
    uris = [f for f in found if f[2] == "an obsidian: link"]
    if uris:
        notes.append(f"{len(uris)} obsidian: link(s) in the box's files ({', '.join(sorted({p for p, _, _ in uris})[:5])}): "
                     f"they name a notes folder on GitHub; a citation of SOURCES.md keeps that on this machine")
    for path, n, what in (f for f in found if f[2] != "an obsidian: link"):
        problems.append(f"[private-ref] {path}:{n}: names {what}; fix: cite it as [1](SOURCES.md#<key>) (the path from "
                        f"this file) and keep where the key points in the box's ledger, on this machine")
    objectives_tracked = "OBJECTIVES.md" in tracked
    readme = text("README.md")
    if readme is not None:
        lines = [l for l in readme.splitlines() if l.strip()]
        if len(lines) < 2 or not lines[0].startswith("# ") or not PAGES_LINE.search(lines[1]):
            problems.append("README.md's first line under the title does not link the live page "
                            "(https://<owner>.github.io/<repo>/, or [▶ Live landing page](https://<host>/) for a box "
                            "hosted on Cloudflare); `blackbox new` writes it")
    for n, line in enumerate((text("ledger.jsonl") or "").splitlines(), start=1):
        if line.strip():
            try:
                json.loads(line)
            except json.JSONDecodeError:
                problems.append(f"ledger.jsonl:{n} is not one JSON object")
                break
    no_proposer = []
    for meta in sorted(p for p in tracked if re.fullmatch(r"solutions/[^/]+/meta\.json", p)):
        try:
            pb = json.loads(text(meta) or "{}").get("proposed_by") or {}
        except json.JSONDecodeError:
            problems.append(f"{meta} is not JSON")
            continue
        if not (pb.get("agent") and pb.get("model")):
            no_proposer.append(meta.split("/")[1])
    if no_proposer:
        notes.append(f"{len(no_proposer)} solution(s) record no proposer (agent + model): {', '.join(no_proposer[:8])}")
    if "site/index.html" in tracked:  # the pre-package layout: the box's copy of the landing, which no longer wins
        problems.append(STRAY_LANDING)
    if "tools/bb/VENDOR.json" in tracked:
        notes.append("tools/bb/ is a vendored copy of the fold: `blackbox build` replaces it; delete it once the box's "
                     "workflow calls blackbox_agent's site.yml")
    if "site/dashboard/VENDOR.json" in tracked:
        notes.append("site/dashboard/ is a vendored copy of the viewer: `blackbox build` serves the package's instead; "
                     "delete it once the box's workflow calls blackbox_agent's site.yml")
    workflows = [p for p in tracked if re.fullmatch(r"\.github/workflows/[^/]+\.ya?ml", p)]
    if not any("/.github/workflows/site.yml@" in (text(p) or "") for p in workflows):
        notes.append("no workflow calls blackbox_agent's .github/workflows/site.yml: the live page is not built by the "
                     "package yet (README: Deploy)")

    with tempfile.TemporaryDirectory(prefix="blackbox-check-") as tmp:
        out = Path(tmp) / "site"
        try:
            record = build(box, out, sha)
        except BoxError as e:
            problems.append(f"the build fails: {e}")
            return problems, notes
        # WHY from the folded state, not a regex of OBJECTIVES.md: the fold has the one rule for naming the objective
        # (the objective line, its "(the objective)" marker, else the ranked scorecard's own); check and the page
        # must never disagree about it.
        state = json.loads((out / "data" / "state.json").read_text())
        links = state.get("links")
        if links:
            for p in links.get("problems") or []:
                if p.get("kind") == "unknown-key":
                    problems.append(f"[unknown-key] {p['path']}:{p['line']}: {p['text']}; fix: add its `## <key>` to "
                                    f"SOURCES.md, or cite a key it lists")
            n_private = len(sources.private_keys(links))
            if here is None:
                notes.append(f"private sources not checked: no roots file on this machine ({sources.roots_path()}); "
                             f"{n_private} of {len(links.get('sources') or [])} sources are private")
            elif n_private:
                res = sources.resolve(links, repo, here)
                for k in res.keys.values():
                    if k.status != "located":
                        problems.append(f"[source-unresolved] SOURCES.md#{k.key}: {k.why}; fix: the key's source:: and "
                                        f"quote:: in the ledger, or the block id in the note")
                notes.append(f"{n_private - res.broken} of {n_private} private sources resolve on this machine "
                             f"(the ledger: {res.ledger.name if res.ledger else 'none'})")
        if objectives_tracked and not ((state.get("objective") or {}).get("name")):
            problems.append("OBJECTIVES.md names no objective the fold can read: give it the line "
                            "**Objective (one number, lower is better): `<name>`**")
        notes.append(f"landing: {record['landing']}; nav.json: {record['nav']}; overrides: "
                     f"{', '.join(record['overrides']) or 'none'}")
        problems += _nav_problems(out)
        leaks = []
        for f in sorted(out.rglob("*")):
            if f.is_file() and f.suffix in TEXT and not f.relative_to(out).as_posix().startswith("dashboard/viewer/"):
                for m in HOME_PATH.finditer(f.read_text(errors="replace")):
                    leaks.append(f"{f.relative_to(out).as_posix()}: {m.group(0)}")
        if leaks:
            problems.append(f"{len(leaks)} home path(s) in the built site (a box's page may be public): "
                            + "; ".join(leaks[:5]))
    return problems, notes


def _nav_problems(site: Path) -> list[str]:
    """nav.json is the site bar's file (bb-site-nav/1, viewer CONTRACT §18) and every link in it is a page of the site."""
    try:
        nav = json.loads((site / "nav.json").read_text())
    except (OSError, json.JSONDecodeError) as e:
        return [f"site/nav.json: {e}"]
    out = []
    if nav.get("schema") != "bb-site-nav/1":
        out.append(f"site/nav.json: schema {nav.get('schema')!r}, not bb-site-nav/1")
    dashboards = nav.get("dashboards") or []
    ids = [d.get("id") for d in dashboards]
    if sorted(nav.get("order") or []) != sorted(ids):
        out.append("site/nav.json: `order` must list every dashboard id once")
    if (nav.get("site") or {}).get("home") not in ids:
        out.append("site/nav.json: site.home is not one of the dashboards")
    if not any(d.get("tabs") == "viewer" for d in dashboards):
        out.append("site/nav.json: no dashboard has tabs: viewer (the Black box)")

    def page(href: str) -> Path:
        path = site / href.split("#")[0].split("?")[0]
        return path / "index.html" if href.endswith("/") or path.is_dir() else path

    for d in dashboards:
        for item in [d, *(d.get("pages") or [])]:
            href = item.get("href") or ""
            if not REL.match(href):
                out.append(f"site/nav.json: {item.get('id')}: {href!r} is not a path inside the site")
            elif not page(href).is_file():
                out.append(f"site/nav.json: {item.get('id')}: {href} is not a page of the built site")
    landing = (nav.get("site") or {}).get("landing")
    if landing and not page(landing).is_file():
        out.append(f"site/nav.json: site.landing {landing} is not a page of the built site")
    return out
