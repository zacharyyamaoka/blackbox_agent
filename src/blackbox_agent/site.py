"""`blackbox build`: one box at one git ref -> its whole static site, ready for GitHub Pages.

    <out>/index.html              the stock landing (template/site/index.html), or the box's site/overrides/index.html
    <out>/nav.json                the box's own site/nav.json, else the stock one (the Black box only)
    <out>/data/state.json         the fold of the ref (bb-state/1), the box export's `playback` slice kept
    <out>/data/files/<path>       each picture a box's .md shows from outside site/, at its path in the box (the notes
                                  viewer draws a note's pictures from here, and site/ ones from the site)
    <out>/dashboard/              the dashboard: this package's viewer, never a copy in the box
    <out>/overrides/<tag>.js      the box's own version of one stock component, wired in by an import map
    <out>/...                     every other file of the box's site/ at the ref (its tabs, its domain dashboards)
    <out>/blackbox-build.json     what was built from what: the package version, the ref, the overrides

The landing is an override like any component (WHY, Zach 2026-11-24 on robot_sdk_agent's hand-written page: "the landing
page is not like the stock one I designed"): the stock one always builds, and only site/overrides/index.html replaces it,
counted with the box's other overrides on the dashboard. A box's plain site/index.html is not used (`blackbox check` says
so); it was the pre-package layout, where the box owned a copy of the template's landing.

Every box file is read from git at the ref, never the working tree (WHY: the same ref builds the same site, and a
peer's in-flight files never ship). The fold runs as its own process (its plug-ins load modules by path).
"""

from __future__ import annotations

import gzip
import html
import io
import json
import os
import posixpath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

from blackbox_agent import __version__

PKG = Path(__file__).resolve().parent
FOLD = PKG / "fold" / "fold_state.py"
DASHBOARD = PKG / "dashboard"
TEMPLATE = PKG / "template"
COMPONENTS = DASHBOARD / "viewer" / "src" / "components"
RECORD = "blackbox-build.json"
LANDING = "index.html"  # site/overrides/index.html: the box's own landing, the one override that is not a component
STRAY_LANDING = ("site/index.html is not used: move it to site/overrides/index.html to replace the stock landing, "
                 "or delete it")
STATE = "site/data/state.json"
JUNIT = "site/data/junit.xml"
JUNIT_DIR = "site/data/junit"  # one junit per commit (<sha7>.xml[.gz]) for the Spec page's History; a box opts in
EXPORT_SLICES = ("playback",)  # viewer CONTRACT §4: the one slice a box's own export writes into state.json
# a junit is published under the site: pytest writes the machine's hostname, and tracebacks with home paths, into it
JUNIT_LEAK = re.compile(r"hostname=|/h[o]me/")
# the README's live-page line: https://<owner>.github.io/<repo>/ (GitHub Pages; groups 1, 2 name the box), or, for a box
# hosted on Cloudflare, "Live landing page](https://<host>/)" (no groups: the box's name comes from its remote).
# WHY the label anchors the second form: the same line links github.com/…/blackbox_agent, which is no live page.
PAGES_LINE = re.compile(r"https://([A-Za-z0-9-]+)\.github\.io/([A-Za-z0-9_.-]+)/"
                        r"|Live landing page\]\(https://[a-z0-9-]+(?:\.[a-z0-9-]+)+/\)")
IMPORTMAP = re.compile(r'(<script\b[^>]*\btype=["\']importmap["\'][^>]*>)(.*?)(</script>)', re.S | re.I)


class BoxError(Exception):
    """A box that cannot be built as it is; the message says what to change."""


def git(repo: Path, *args: str, binary: bool = False):
    out = subprocess.run(["git", "-C", str(repo), *args], capture_output=True)
    if out.returncode != 0:
        raise BoxError(f"git {' '.join(args[:3])} in {repo.name}: {out.stderr.decode(errors='replace').strip()}")
    return out.stdout if binary else out.stdout.decode()


def need(path: Path, what: str) -> Path:
    if not path.exists():
        raise BoxError(f"{what} is missing from this blackbox_agent install ({path.name}); reinstall the package")
    return path


def identity(box: Path, sha: str) -> dict[str, str | None]:
    """The box's display name, GitHub owner and repo: from its origin remote, the CI's GITHUB_REPOSITORY, or its README's
    live-page line, in that order; the name from the README's title."""
    owner = repo = None
    run = subprocess.run(["git", "-C", str(box), "remote", "get-url", "origin"], capture_output=True, text=True)
    m = re.search(r"github\.com[:/]([^/]+)/([^/]+?)(?:\.git)?/?$", run.stdout.strip()) if run.returncode == 0 else None
    if m:
        owner, repo = m.group(1), m.group(2)
    elif "/" in os.environ.get("GITHUB_REPOSITORY", ""):
        owner, repo = os.environ["GITHUB_REPOSITORY"].split("/", 1)
    readme = subprocess.run(["git", "-C", str(box), "show", f"{sha}:README.md"], capture_output=True, text=True).stdout
    if not owner:
        line = PAGES_LINE.search(readme)
        if line:
            owner, repo = line.group(1), line.group(2)
    repo = repo or box.name
    title = next((l[2:].strip() for l in readme.splitlines() if l.startswith("# ")), None)
    return {"name": title or repo.replace("_", " ").replace("-", " ").title(), "owner": owner, "repo": repo}


def fill(text: str, values: dict, kind: str) -> str:
    """{{name}} / {{owner}} / {{repo}} filled, escaped for the file they land in (html or json)."""
    def one(m: re.Match) -> str:
        v = str(values.get(m.group(1)) or m.group(1).upper())
        return html.escape(v) if kind == "html" else json.dumps(v)[1:-1] if kind == "json" else v
    return re.sub(r"\{\{(\w+)\}\}", one, text)


def _relative(target: str, page_dir: str) -> str:
    r = posixpath.relpath(target, page_dir or ".")
    return r if r.startswith("../") else "./" + r


def with_import_map(page: str, imports: dict[str, str]) -> str:
    """The page with `imports` in its import map: merged into the page's own (its own entries win), else a new map
    placed before the page's first script (or at the end of its <head>), as the packaging spike's override page has it."""
    m = IMPORTMAP.search(page)
    if m:
        try:
            doc = json.loads(m.group(2) or "{}")
        except json.JSONDecodeError as e:
            raise BoxError(f"a page's own import map is not JSON ({e}): fix it, or drop site/overrides/") from e
        merged = {**imports, **(doc.get("imports") or {})}
        doc["imports"] = merged
        return page[:m.start(2)] + "\n" + json.dumps(doc, indent=1) + "\n" + page[m.end(2):]
    tag = ('<script type="importmap" data-blackbox-overrides>\n' + json.dumps({"imports": imports}, indent=1)
           + "\n</script>\n")
    low = page.lower()
    head_end, first_script = low.find("</head>"), low.find("<script")
    if head_end != -1 and (first_script == -1 or head_end < first_script):
        at = head_end
    elif first_script != -1:
        at = first_script
    else:
        at = max(low.find("<body"), 0)
    return page[:at] + tag + page[at:]


def _extract(box: Path, sha: str, paths: list[str], into: Path) -> None:
    if not paths:
        return
    blob = git(box, "archive", "--format=tar", sha, "--", *paths, binary=True)
    with tarfile.open(fileobj=io.BytesIO(blob)) as tar:
        tar.extractall(into, filter="data")


def _prepare_out(box: Path, out: Path, tracked: list[str]) -> None:
    """Refuse an --out that would overwrite the box, or a folder this command did not write."""
    if out == box or box.is_relative_to(out):
        raise BoxError(f"--out {out} would hold the box itself: pick a folder of its own (e.g. _site)")
    if out.is_relative_to(box):
        rel = out.relative_to(box).as_posix()
        if any(p == rel or p.startswith(rel + "/") for p in tracked):
            raise BoxError(f"--out {rel} holds files the box tracks: pick an untracked folder (e.g. _site)")
    if out.exists() and any(out.iterdir()) and not (out / RECORD).exists():
        raise BoxError(f"--out {out} is not empty and was not written by blackbox build: refusing to replace it")


def fold(box: Path, sha: str, cwd: Path, junit: str | None, junit_dir: str | None) -> dict:
    """bb-state/1 of the box at sha, by the package's fold, run in its own process from `cwd` (the junit paths are
    relative to it, and land in state.json as written: never an absolute path, which would name the runner's home)."""
    cmd = [sys.executable, str(need(FOLD, "the fold")), "--repo", str(box), "--ref", sha]
    if junit:
        cmd += ["--junit", junit]
    if junit_dir:
        cmd += ["--junit-dir", junit_dir]
    out = cwd / "state.fold.json"
    run = subprocess.run([*cmd, "--out", str(out)], capture_output=True, text=True, cwd=cwd)
    if run.returncode != 0 or not out.exists():
        raise BoxError(f"the fold failed (exit {run.returncode}):\n{run.stderr.strip()[-3000:]}")
    state = json.loads(out.read_text())
    out.unlink()
    if state.get("schema") != "bb-state/1" or (state.get("source") or {}).get("ref") != sha:
        raise BoxError(f"the fold's output is not a bb-state/1 fold of {sha[:7]}")
    return state


def build(box: Path, out: Path, ref: str = "HEAD", local: bool = False) -> dict:
    """Write the box's site at `ref` into `out` (replacing an earlier build there); returns blackbox-build.json.

    Public by default: a box's private sources (sources.py) are their labels and quotes only, and on a machine with a
    roots file the build refuses to write a site that carries anything private (the leak gate). `local=True` (what
    `blackbox serve` builds) resolves each private source through this machine's ledger and stages it beside the page,
    so every citation opens at its words; such a site is never published."""
    box, out = Path(box).expanduser().resolve(), Path(out).expanduser().resolve()
    if not box.is_dir():
        raise BoxError(f"{box}: no such folder")
    if Path(git(box, "rev-parse", "--show-toplevel").strip()).resolve() != box:
        raise BoxError(f"{box} is not the top of a git repository (a box is one repo)")
    sha = git(box, "rev-parse", f"{ref}^{{commit}}").strip()
    tracked = git(box, "ls-tree", "-r", "--name-only", sha).splitlines()
    _prepare_out(box, out, tracked)
    who = identity(box, sha)
    record = {"schema": "blackbox-build/1", "package": f"blackbox-agent {__version__}", "box": who["name"],
              "repo": f"{who['owner']}/{who['repo']}" if who["owner"] else who["repo"], "ref": sha,
              "landing": None, "nav": None, "overrides": [], "dropped": [], "junit": None, "kept": [], "carried": [],
              "links": None}
    with tempfile.TemporaryDirectory(prefix="blackbox-build-") as tmp:
        root = Path(tmp)
        site = root / "site"
        site.mkdir()
        _extract(box, sha, ["site"] if any(p.startswith("site/") for p in tracked) else [], root)
        # the package's slot: a box's vendored copy of the viewer (the pre-package layout) is replaced, never served
        if (site / "dashboard").exists():
            shutil.rmtree(site / "dashboard")
            record["dropped"].append("site/dashboard/ (the box's copy of the viewer; this package's replaces it)")
        # WHY: a note's picture is read from the note's own folder, as GitHub reads it; one under site/ is already in the
        # site, any other the box tracks is carried here, where viewer/src/core/notes.js (mediaUrl) looks for it
        from blackbox_agent.lint import named_pictures

        record["carried"] = [p for p in named_pictures(box, sha, set(tracked)) if not p.startswith("site/")]
        _extract(box, sha, record["carried"], site / "data" / "files")

        junit = site / "data" / "junit.xml"
        junit_arg = junit_dir_arg = None
        if junit.exists():
            if JUNIT_LEAK.search(junit.read_text(errors="replace")):
                raise BoxError(f"{JUNIT} names a host or a home path: rebuild it with the box's own site build")
            junit_arg, record["junit"] = JUNIT, JUNIT
        history = site / "data" / "junit"
        if history.is_dir():
            # WHY the ref's own run from the committed junit.xml: the run committed with a commit is that commit's run
            if junit.exists() and not any((history / f"{sha[:7]}{ext}").exists() for ext in (".xml", ".xml.gz")):
                (history / f"{sha[:7]}.xml.gz").write_bytes(gzip.compress(junit.read_bytes(), mtime=0))
            for f in sorted(history.iterdir()):
                raw = gzip.decompress(f.read_bytes()) if f.name.endswith(".gz") else f.read_bytes()
                if JUNIT_LEAK.search(raw.decode(errors="replace")):
                    raise BoxError(f"{JUNIT_DIR}/{f.name} names a host or a home path: rebuild it with the box's site build")
            junit_dir_arg = JUNIT_DIR
        fresh = fold(box, sha, root, junit_arg, junit_dir_arg)
        shown = subprocess.run(["git", "-C", str(box), "show", f"{sha}:{STATE}"], capture_output=True, text=True)
        committed = json.loads(shown.stdout) if shown.returncode == 0 and shown.stdout.strip() else {}
        carry = {k: committed[k] for k in EXPORT_SLICES if k in committed and k not in fresh}
        state: dict = {}
        for key, value in fresh.items():
            if key == "source":
                state.update(carry)
            state[key] = value
        state.update({k: v for k, v in carry.items() if k not in state})
        record["kept"] = sorted(carry)
        (site / "data").mkdir(parents=True, exist_ok=True)
        from blackbox_agent import sources

        here = sources.machine()
        links = state.get("links")
        if links is not None:
            n_private = len(sources.private_keys(links))
            if local and here is not None:
                res = sources.resolve(links, who["repo"], here)
                state["links"] = sources.stage(site, links, res)
                record["links"] = {"mode": "local", "sources": len(links.get("sources") or []), "private": n_private,
                                   "located": n_private - res.broken, "broken": res.broken}
            else:
                record["links"] = {"mode": "public", "sources": len(links.get("sources") or []), "private": n_private,
                                   "located": None, "broken": None}
        (site / "data" / "state.json").write_text(json.dumps(state, indent=1, ensure_ascii=False) + "\n")

        values = {"name": who["name"], "owner": who["owner"], "repo": who["repo"]}
        if (site / "index.html").exists():
            (site / "index.html").unlink()
            record["dropped"].append(f"site/index.html ({STRAY_LANDING.split(': ', 1)[1]})")
        own = site / "overrides" / LANDING
        if own.is_file():
            # the box's landing is served at the site's root, so its relative links are written as from site/
            own.replace(site / "index.html")
            if not any(own.parent.iterdir()):
                own.parent.rmdir()
            record["landing"] = f"the box's own (site/overrides/{LANDING})"
        else:
            (site / "index.html").write_text(fill(need(TEMPLATE / "site" / "index.html", "the landing").read_text(), values, "html"))
            record["landing"] = "stock"
        if (site / "nav.json").exists():
            record["nav"] = "the box's own (site/nav.json)"
        else:
            (site / "nav.json").write_text(fill(need(TEMPLATE / "site" / "nav.json", "nav.json").read_text(), values, "json"))
            record["nav"] = "stock"
        shutil.copytree(need(DASHBOARD, "the dashboard"), site / "dashboard",
                        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))

        components = _overrides(site)
        record["overrides"] = sorted(components + ([LANDING] if record["landing"] != "stock" else []))
        if components:
            _wire_overrides(site, components)
        if record["overrides"]:
            _count_overrides(site, record["overrides"])
        (site / ".nojekyll").write_text("")
        (site / RECORD).write_text(json.dumps(record, indent=1) + "\n")
        if here is not None and not (record["links"] or {}).get("mode") == "local":
            # the leak gate: nothing this machine knows privately may be in a public build (WHY refuse, not scrub: a
            # scrubbed page would read as complete; the fix belongs in the box's files, which check names)
            # allowed: the box's own words, and the package's (its landing, nav and fold write English of their own,
            # which may share a run of words with a note: the stock landing did, on blackbox_agent_agent)
            side = sources.private_side(links, who["repo"], lambda: sources.box_text(box, sha) + "\n"
                                        + sources.package_text(TEMPLATE, FOLD.parent), here)
            hits = [h for h in sources.leak_scan(site, side) if "a private name" in h or "private text" in h]
            if hits:
                raise BoxError(f"refusing to write a public build: {len(hits)} private item(s) would leave this machine "
                               f"({'; '.join(hits[:5])}); `blackbox check` names the box's lines (private-ref)")
        if out.exists():
            shutil.rmtree(out)
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(site, out)
    return record


def _overrides(site: Path) -> list[str]:
    """The stock components the box overrides: site/overrides/<tag>.js, one per component (an _underscore file is a
    helper they share, not an override)."""
    folder = site / "overrides"
    if not folder.is_dir():
        return []
    stock = {p.stem for p in COMPONENTS.glob("*.js")}
    tags = sorted(p.stem for p in folder.glob("*.js") if not p.name.startswith("_"))
    unknown = [t for t in tags if t not in stock]
    if unknown:
        raise BoxError(f"site/overrides/{unknown[0]}.js names no stock component (the stock ones: "
                       f"{', '.join(sorted(stock))}); a shared helper's name starts with _")
    return tags


def _wire_overrides(site: Path, tags: list[str]) -> None:
    """One import map per page that loads the viewer: each stock component's URL -> the box's file (the packaging
    spike's mechanism). The override reaches the stock module by the same URL plus ?stock, which the map leaves alone."""
    for page in sorted(site.rglob("*.html")):
        rel = page.relative_to(site).as_posix()
        if rel.startswith("dashboard/viewer/"):
            continue
        text = page.read_text(errors="replace")
        if rel != "dashboard/index.html" and "dashboard/viewer/" not in text:
            continue
        page_dir = posixpath.dirname(rel)
        imports = {_relative(f"dashboard/viewer/src/components/{t}.js", page_dir): _relative(f"overrides/{t}.js", page_dir)
                   for t in tags}
        page.write_text(with_import_map(text, imports))


def _count_overrides(site: Path, overrides: list[str]) -> None:
    """The dashboard says how many stock parts the box replaces (its components and its landing), and which."""
    # WHY on the page: drift is a number you can see, not a surprise (packaging report, "Hackable in three steps")
    page = site / "dashboard" / "index.html"
    text = page.read_text(errors="replace")
    words = ", ".join(f"<code>{html.escape(t)}</code>" for t in overrides)
    note = (f'<p data-blackbox-overrides style="max-width:1120px;margin:24px auto;padding:0 16px;box-sizing:border-box;'
            f'color:var(--bb-muted,#71717a);font:12px/1.5 var(--bb-font,system-ui,sans-serif)">'
            f'{len(overrides)} override{"s" if len(overrides) != 1 else ""} (site/overrides/): {words}</p>\n')
    at = text.lower().rfind("</body>")
    page.write_text(text[:at] + note + text[at:] if at != -1 else text + note)
