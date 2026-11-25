"""`blackbox check`'s conformance lints: what a box's docs and files must do to be in the format, read from git at a ref.

    unlinked-name   a `code span` in a tracked .md (outside a fence and outside a link's text) names a file or folder the
                    box tracks, or a folder on this machine (~/<repo>), and is not a link
    broken-link     a relative link or picture in a tracked .md lands on no file tracked at the ref; one that leaves the
                    box (../ past its root) is the same problem, said so
    missing-path    a path the format requires (REQUIRED) is not tracked

Which links count: a relative path that lands on a tracked file, or any absolute URI, a private root's included (a note
or a chat only one machine can open, e.g. chat://…). Whether such a root resolves is its resolver's business; this only
asks that the named thing is one click away. (WHY no other root is named here: the publish's leak scan refuses the word
for a notes app's root in a shipped file.)

WHY (Zach, /rate bad, Daily Note Nov 24 2026, "# Vibe tracks agent feedback"): "these files should have been linked...
it needs a linter for repos that can see if they meeting the thing or not, and it should have caught that these files
where not linked". vibetracks_agent @ 12bcb3e read "the box is in the format" with 124 unlinked names in its README
Files table, REFERENCES.md, AGENTS.md and docs, and NOTES.md pictures at ../assets/, outside the repo.

The first two rules are lifted from vibetracks_agent's tests/test_docs_link_what_they_name.py @ ef18c13
(github.com/zacharyyamaoka/vibetracks_agent, written the same night), its semantics kept: what counts as naming a
path, the placeholder rule, the exemptions. Generalised for every box, each change said where it is made:
- the frozen files are the ones the box pins by sha256 (its hard-coded OBJECTIVES.md and specs/ are what that box pins);
- a fence may be indented (a fence inside a list item is still code);
- `~/<repo>`, a placeholder, names no folder (by the placeholder rule it reads as the home folder itself);
- a link may be written <path>, URL-escaped, root-relative (/path), to the box itself (./), or by reference ([x][r]).
"""

from __future__ import annotations

import hashlib
import posixpath
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote

from blackbox_agent.site import BoxError

# The format (the lab README, "The format"): what every box tracks. WHY these: the loop reads or writes each one every
# round (the skill: read OBJECTIVES.md, PROGRESS.md, ideas.md; write solutions/<id>/, ledger.jsonl, PROGRESS.md,
# status.json) and `blackbox new` writes each. The page draws an empty state for the OPTIONAL ones, which a box adds
# when it has them (robot_sdk_agent has no specs/ or feedback/ yet, and is in the format).
REQUIRED = ("README.md", "OBJECTIVES.md", "AGENTS.md", "PROGRESS.md", "ledger.jsonl", "ideas.md", "REFERENCES.md",
            "status.json", "solutions/")
OPTIONAL = ("specs/", "feedback/", "NOTES.md", "notes/", "site/nav.json", "site/tabs/", "site/overrides/")
LINTS = {
    "unlinked-name": "a named file, folder or repo is a link",
    "broken-link": "a relative link lands on a file the box tracks",
    "missing-path": "the format's required paths exist",
    "home-path": "no tracked text file names a machine's home directory",
}
# WHY every tracked file, not only the built site (2026-11-25): trajectory_tracking_agent's public main carried a
# home path in a .py docstring from a5d5982 while check read only the site. Lifted from that box's own
# tests/test_no_private_paths.py: a line that defines or names the guard is the one exemption. Machine home paths
# only (Linux and macOS); a box's other private names are its own test's to forbid. The pattern is spelled so this
# file never matches itself.
HOME = re.compile(r"(?<![\w.-])/(?:h[o]me|Us[e]rs)/[A-Za-z][\w.-]*")
GUARD = re.compile(r"re\.compile\(|FORBIDDEN|PRIVATE|LEAK|HOME_PATH")
BINARY = re.compile(r"\.(png|jpe?g|gif|webp|bmp|avif|ico|svg|mp4|webm|mov|m4v|ogv|pdf|rrd|npz|npy|gz|zip|whl|"
                    r"woff2?|ttf|otf|pkl|pt|onnx|bin)$", re.I)
PICTURE = re.compile(r"\.(png|jpe?g|gif|webp|svg|bmp|avif|mp4|webm|mov|m4v|ogv)$", re.I)

# lifted (test_docs_link_what_they_name.py @ ef18c13); FENCE takes an indented fence too
FENCE = re.compile(r"^[ \t]*(```|~~~).*?^[ \t]*\1[^\n]*$", re.M | re.S)
LINK = re.compile(r"!?\[((?:[^\[\]]|\[[^\]]*\])*)\]\((<[^>\n]*>|[^)\s]+)(?:\s+\"[^\"]*\")?\)")
REF_LINK = re.compile(r"!?\[((?:[^\[\]]|\[[^\]]*\])*)\]\[([^\]\n]*)\]")
REF_DEF = re.compile(r"^[ ]{0,3}\[([^\]\n]+)\]:[ \t]*(<[^>\n]*>|\S+)", re.M)
CODE = re.compile(r"`([^`\n]+)`")
SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*:", re.I)
# WHY written ~[/]: a literal tilde-slash in a shipped file reads as a home path to the publish's leak scan
MACHINE = re.compile(r"~[/](?=[^.<\s])")
HEX64 = re.compile(r"\b[0-9a-f]{64}\b")


@dataclass(frozen=True)
class Finding:
    lint: str
    where: str  # file:line, or the path for missing-path
    what: str
    fix: str

    def __str__(self) -> str:
        return f"[{self.lint}] {self.where}: {self.what}; fix: {self.fix}"


def _git(box: Path, *args: str, stdin: bytes | None = None) -> bytes:
    """git's stdout; exit 1 with nothing on stderr is `git grep` finding nothing."""
    run = subprocess.run(["git", "-C", str(box), *args], input=stdin, capture_output=True)
    if run.returncode not in (0, 1) or (run.returncode == 1 and run.stderr):
        raise BoxError(f"git {' '.join(args[:3])} in {Path(box).name}: {run.stderr.decode(errors='replace').strip()}")
    return run.stdout


def blobs(box: Path, sha: str, paths: list[str]) -> dict[str, bytes]:
    """Each path's bytes at `sha`, in one `git cat-file --batch` (a box can hold a few hundred docs)."""
    if not paths:
        return {}
    out = _git(box, "cat-file", "--batch", stdin="".join(f"{sha}:{p}\n" for p in paths).encode())
    got, at = {}, 0
    for p in paths:
        nl = out.index(b"\n", at)
        head = out[at:nl].split()
        if len(head) < 3 or head[1] == b"missing":
            at = nl + 1
            continue
        size = int(head[2])
        got[p] = out[nl + 1:nl + 1 + size]
        at = nl + 1 + size + 1
    return got


def folders(files: set[str]) -> set[str]:
    return {"/".join(f.split("/")[:i]) + "/" for f in files for i in range(1, f.count("/") + 1)}


def pinned(box: Path, sha: str, docs: dict[str, bytes]) -> list[str]:
    """The docs whose sha256 the box itself records in a tracked text file (a ruler manifest, a vendored part's
    manifest): frozen, so they gain links only with a new pin (a ruler bump), never in place."""
    found = set(HEX64.findall(_git(box, "grep", "-I", "-h", "-o", "-w", "-E", "[0-9a-f]{64}", sha, "--").decode()))
    return sorted(p for p, b in docs.items() if hashlib.sha256(b).hexdigest() in found)


def _dir(doc: str) -> str:
    return doc.rsplit("/", 1)[0] + "/" if "/" in doc else ""


def _as_path(span: str, doc_dir: str, files: set[str], dirs: set[str]) -> str | None:
    """The tracked path a code span names (relative to the box's root or to the doc's folder), else None. Lifted."""
    name = span.split("<")[0].strip()
    if not name or " " in name or name.startswith(("-", "/")):
        return None
    for base in ("", doc_dir):
        cand = (base + name) if base else name
        if cand in files or cand in dirs or (cand + "/") in dirs:
            return cand
    return None


def _target(raw: str) -> str:
    return raw[1:-1].strip() if raw.startswith("<") and raw.endswith(">") else raw


def _resolve(target: str, doc_dir: str) -> tuple[str, bool]:
    """(the box path a relative link lands on, whether it left the box on the way)."""
    path = unquote(target.split("#")[0].split("?")[0])
    parts: list[str] = []
    left = False
    for piece in (path.lstrip("/") if path.startswith("/") else doc_dir + path).split("/"):
        if piece == "..":
            if parts:
                parts.pop()
            else:
                left = True
        elif piece not in ("", "."):
            parts.append(piece)
    return "/".join(parts), left


def _link_as(span: str, path: str, doc_dir: str, is_dir: bool) -> str:
    rel = posixpath.relpath(path.rstrip("/"), doc_dir.rstrip("/") or ".")
    return f"[`{span}`]({rel}{'/' if is_dir else ''})"


def doc_findings(doc: str, text: str, files: set[str], dirs: set[str], sha: str = "") -> list[Finding]:
    """unlinked-name and broken-link for one doc (`text`, its path `doc`) of a box tracking `files`."""
    out: list[Finding] = []
    doc_dir = _dir(doc)
    body = FENCE.sub(lambda m: "\n" * m.group(0).count("\n"), text)
    defs = {m.group(1).strip().lower(): (m.start(), _target(m.group(2))) for m in REF_DEF.finditer(body)}
    linked = [(m.start(), m.end()) for m in LINK.finditer(body)]
    linked += [(m.start(), m.end()) for m in REF_LINK.finditer(body) if (m.group(2) or m.group(1)).strip().lower() in defs]
    linked += [(m.start(), m.end()) for m in REF_DEF.finditer(body)]

    def line(pos: int) -> int:
        return body.count("\n", 0, pos) + 1

    for m in CODE.finditer(body):
        if any(a <= m.start() < b for a, b in linked):
            continue
        span = m.group(1)
        where = f"{doc}:{line(m.start())}"
        if MACHINE.match(span):  # WHY not dot folders (.cache, .gitconfig): machine state, nothing to open
            out.append(Finding("unlinked-name", where, f"names `{span}` (a folder on this machine) without linking it",
                               "link it where a reader can open it: its GitHub repo, or a private root URI "
                               "(chat://… and the like) for a folder only this machine has"))
        elif (path := _as_path(span, doc_dir, files, dirs)) is not None:
            is_dir = path not in files
            out.append(Finding("unlinked-name", where,
                               f"names `{span}` (a {'folder' if is_dir else 'file'} of the box) without linking it",
                               f"link it as {_link_as(span, path, doc_dir, is_dir)}"))
    links = [(m.start(), f"{'picture' if m.group(0).startswith('!') else 'link'} `{_target(m.group(2))}`",
              _target(m.group(2))) for m in LINK.finditer(body)]
    links += [(pos, f"link `[{key}]: {target}`", target) for key, (pos, target) in defs.items()]
    for pos, shown, target in sorted(links):
        if not target or SCHEME.match(target) or target.startswith(("#", "//")):
            continue
        resolved, left = _resolve(target, doc_dir)
        if not left and (resolved == "" or resolved in files or (resolved + "/") in dirs):
            continue
        name = resolved.rsplit("/", 1)[-1]
        same = sorted(f for f in files if f.rsplit("/", 1)[-1] == name) if name else []
        hint = (f"{same[0]} is tracked: link it as {posixpath.relpath(same[0], doc_dir.rstrip('/') or '.')}"
                if len(same) == 1 else "commit the file into the box, or point the link at one it tracks")
        what = (f"{shown} leaves the box (../ past its root)" if left
                else f"{shown} lands on no file tracked{f' at {sha[:7]}' if sha else ''}")
        out.append(Finding("broken-link", f"{doc}:{line(pos)}", what, hint))
    return out


def lint(box: Path, sha: str, tracked: set[str]) -> tuple[list[Finding], list[str]]:
    """(findings, notes) for the box at `sha`: every lint, README.md's findings first, then by path and line."""
    box = Path(box)
    dirs = folders(tracked)
    findings: list[Finding] = []
    notes: list[str] = []
    for path in REQUIRED:
        there = (path in dirs) if path.endswith("/") else (path in tracked)
        if not there:
            fix = (f"commit at least {path}README.md (`blackbox new` writes one)" if path.endswith("/")
                   else "`blackbox new` writes the stock one: copy it from a fresh box")
            findings.append(Finding("missing-path", path, f"the format requires it and the box tracks no "
                                    f"{'file under it' if path.endswith('/') else 'such file'}", fix))
    docs = blobs(box, sha, sorted(p for p in tracked if p.endswith(".md")))
    frozen = set(pinned(box, sha, docs))
    if frozen:
        by_dir: dict[str, list[str]] = {}
        for p in sorted(frozen):
            by_dir.setdefault(_dir(p), []).append(p)
        shown = [f"{d} ({len(ps)})" if len(ps) > 1 else ps[0] for d, ps in by_dir.items()]
        notes.append(f"{len(frozen)} doc(s) pinned by sha256 in the box are frozen and not linted (they change only with "
                     f"a new pin, e.g. a ruler bump): {', '.join(shown[:8])}{' …' if len(shown) > 8 else ''}")
    order = sorted(docs, key=lambda p: (p != "README.md", p))
    for doc in order:
        if doc in frozen:
            continue
        findings += doc_findings(doc, docs[doc].decode(errors="replace"), tracked, dirs, sha)
    findings += home_findings(box, sha, tracked)
    return findings, notes


def home_findings(box: Path, sha: str, tracked: set[str]) -> list[Finding]:
    """A machine's home path in any tracked text file (the box may be public, now or later)."""
    out: list[Finding] = []
    texts = blobs(box, sha, sorted(p for p in tracked if not BINARY.search(p)))
    for path, raw in sorted(texts.items()):
        try:
            body = raw.decode("utf-8")
        except UnicodeDecodeError:
            continue
        for n, line in enumerate(body.splitlines(), start=1):
            m = HOME.search(line)
            if m and not GUARD.search(line):
                out.append(Finding("home-path", f"{path}:{n}", f"names a machine's home directory `{m.group(0)}`",
                                   "name the repo, or a root the box resolves per machine, instead of the path"))
    return out


def named_pictures(box: Path, sha: str, tracked: set[str]) -> list[str]:
    """Every tracked picture or video a tracked .md shows (`![alt](path)`, `![[path]]`), as its path in the box: what
    `blackbox build` carries into the site for the notes viewer (viewer/src/core/notes.js mediaUrl)."""
    docs = blobs(box, sha, sorted(p for p in tracked if p.endswith(".md")))
    out = set()
    for doc, raw in docs.items():
        body = FENCE.sub("", raw.decode(errors="replace"))
        targets = [_target(m.group(2)) for m in LINK.finditer(body) if m.group(0).startswith("!")]
        targets += [m.group(1).split("|")[0].strip() for m in re.finditer(r"!\[\[([^\]\n]+)\]\]", body)]
        for t in targets:
            if not t or SCHEME.match(t) or t.startswith(("#", "//")) or not PICTURE.search(t.split("#")[0].split("?")[0]):
                continue
            path, left = _resolve(t, _dir(doc))
            if not left and path in tracked:
                out.add(path)
    return sorted(out)
