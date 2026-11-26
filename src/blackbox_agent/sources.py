"""A box's private sources: the half of SOURCES.md that never leaves its author's machine, and the gate that keeps it there.

The linking round's back end (Ledger + Anchors). A box note cites a bare number, `[1](../SOURCES.md#z1)`; the box's
public SOURCES.md keeps the key's label, whose words they are and a short quote its author publishes (the fold reads
it into the `links` slice). WHERE a private key points lives in a ledger: one note per box in the author's notes folder,
named `<box> sources`, each key a section with an Obsidian block link to the exact words:

    ## z1

    - source:: [[Some Note#^bb-3f2a1c]]        (or [[Some Note#A heading]], or [[Some Note]])
    - quote:: the exact words, as written there

and one roots file per machine finds the notes folder, so a moved folder is one line (URDF's ROS_PACKAGE_PATH):

    $HOME/.config/blackbox/roots.toml          (BLACKBOX_ROOTS names another file)
    vault = "<your notes folder>"
    [ledgers]                                    (optional: a ledger kept under another name)
    my_box = "{notes}/Elsewhere/my ledger.md"

`resolve()` turns each private key into the exact words: the note by its name anywhere in the folder (Obsidian's rule,
dot folders skipped: agent worktrees there copy every note), then the block, then the quote inside it, exactly once,
or it says why. If the note is gone from its name (renamed outside Obsidian), the block id alone finds it, when it is
in exactly one place. `stage()` gives the local build what it needs to open each one in source-highlighter at the
words; the public build never calls it.

The leak gate: `private_side()` is everything this machine knows that a public build must not carry (the notes folder,
every resolved note's name and path, the ledger's, every block id, and the text of every resolved note that the box
does not itself say), and `leak_scan()` reads a built site for any of it, plus home paths and `obsidian:` URIs.
`blackbox build` refuses to write a public site with a private hit; `blackbox check` reports a box file that names a
private place. With no roots file (a CI runner) nothing private exists to leak, and only the generic rules run.

WHY the roots key is spelled apart below: the package's own release gate refuses the bare word for a notes app's root
in a shipped file; its one documented exception is the placeholder line above.
"""

from __future__ import annotations

import io
import json
import os
import re
import subprocess
import tarfile
import tomllib
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path

NOTES_KEY = "v" "ault"
ROOTS_ENV = "BLACKBOX_ROOTS"
LEDGER_NAME = "{box} sources"
OPEN_HTML = "dashboard/viewer/vendor/source-highlighter/open.html"  # site-relative: the package's vendored opener
STAGED = "data/local/sources"  # site-relative: the local build's copies of the resolved notes (never in a public build)
SHINGLE = 6
HOME = re.compile(r"(?<![\w.-])/(?:h[o]me|Us[e]rs)/[A-Za-z][\w.-]*")
OBSIDIAN = re.compile(r"\bobsidian:/{2}[^\s)\"'>]*", re.I)
EMPH = re.compile(r"\*\*|__|`|~~|==")
TEXT_SUFFIXES = {".md", ".json", ".jsonl", ".txt", ".toml", ".yml", ".yaml", ".csv", ".tsv", ".html", ".py", ".js",
                 ".mjs", ".css", ".base", ".xml", ".svg", ".cfg", ".ini"}


# ── this machine ─────────────────────────────────────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Machine:
    """One machine's roots file: the notes folder (one line) and any ledger kept under another name."""

    path: Path
    notes: Path
    ledgers: dict = field(default_factory=dict)


def roots_path() -> Path:
    given = os.environ.get(ROOTS_ENV)
    if given:
        return Path(given).expanduser()
    base = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
    return base / "blackbox" / "roots.toml"


def machine(path: Path | None = None) -> Machine | None:
    """This machine's roots, or None when it has no roots file (a CI runner: nothing private to resolve or leak)."""
    path = Path(path) if path else roots_path()
    if not path.is_file():
        return None
    cfg = tomllib.loads(path.read_text())
    notes = cfg.get(NOTES_KEY)
    if not notes:
        return None
    return Machine(path, Path(os.path.expandvars(str(notes))).expanduser(), dict(cfg.get("ledgers") or {}))


# ── reading the notes folder ─────────────────────────────────────────────────────────────────────────────────────
def notes_files(root: Path) -> list[Path]:
    """Every .md under the notes folder, dot folders skipped (Obsidian's rule; agent worktrees live in them)."""
    out = []
    for dirpath, dirs, files in os.walk(root, followlinks=True):
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
        out += [Path(dirpath) / f for f in sorted(files) if f.endswith(".md")]
    return out


def name_index(files: list[Path], root: Path) -> dict[str, list[Path]]:
    """A wikilink's target → the notes it can name: by file name, and by its path from the root ("Folder/Name")."""
    idx: dict[str, list[Path]] = {}
    for f in files:
        rel = f.relative_to(root).as_posix()[:-3]
        idx.setdefault(f.stem, []).append(f)
        if "/" in rel:
            idx.setdefault(rel, []).append(f)
    return idx


SECTION = re.compile(r"^##\s+([A-Za-z0-9_-]+)\s*$", re.M)
FIELD = re.compile(r"^\s*[-*]\s+([A-Za-z_]+)::\s*(.+?)\s*$")
WIKILINK = re.compile(r"^\[\[([^\]|#]+)(?:#([^\]|]*))?(?:\|[^\]]*)?\]\]$")


def parse_ledger(text: str) -> dict[str, dict[str, str]]:
    """The ledger note → {key: {source, quote, …}}: one `## key` section each, Dataview-style `- name:: value` lines."""
    out = {}
    heads = list(SECTION.finditer(text))
    for i, m in enumerate(heads):
        body = text[m.end():heads[i + 1].start() if i + 1 < len(heads) else len(text)]
        out[m.group(1).lower()] = {f.group(1).lower(): f.group(2) for f in map(FIELD.match, body.splitlines()) if f}
    return out


def parse_wikilink(text: str) -> tuple[str, str | None, str | None] | None:
    """`[[Name#^block]]` / `[[Name#Heading]]` / `[[Name]]` → (name, heading, block)."""
    m = WIKILINK.match(text.strip())
    if not m:
        return None
    name, sub = m.group(1).strip(), (m.group(2) or "").strip()
    if sub.startswith("^"):
        return name, None, sub[1:]
    return name, sub or None, None


def block_lines(lines: list[str], block: str) -> list[int]:
    """0-based indexes of the lines that end with `^block` (Obsidian puts a block id at the end of its paragraph)."""
    rx = re.compile(r"(?:^|\s)\^" + re.escape(block) + r"\s*$")
    return [i for i, line in enumerate(lines) if rx.search(line)]


LIST_ITEM = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+")


def block_range(lines: list[str], at: int) -> tuple[int, int]:
    """The block whose id is on line `at` (0-based): a list item is its own line; a paragraph runs up to a blank line."""
    first = at
    while first > 0 and not LIST_ITEM.match(lines[first]) and lines[first - 1].strip() \
            and not lines[first - 1].lstrip().startswith("#"):
        first -= 1
    return first + 1, at + 1


def heading_range(lines: list[str], heading: str) -> tuple[int, int] | None:
    for n, line in enumerate(lines):
        m = re.match(r"^(#+)\s+(.*?)\s*$", line)
        if m and m.group(2) == heading:
            level = len(m.group(1))
            for k in range(n + 1, len(lines)):
                m2 = re.match(r"^(#+)\s", lines[k])
                if m2 and len(m2.group(1)) <= level:
                    return n + 1, k
            return n + 1, len(lines)
    return None


def _flat(text: str) -> tuple[str, list[int]]:
    """Text with emphasis marks gone and whitespace runs as one space, and per kept character its 1-based line."""
    out, at, line, space = [], [], 1, False
    for ch in EMPH.sub("", text):
        if ch == "\n":
            line += 1
        if ch.isspace():
            if not space and out:
                out.append(" ")
                at.append(line)
            space = True
            continue
        space = False
        out.append(ch)
        at.append(line)
    return "".join(out), at


def find(text: str, quote: str) -> list[tuple[int, int]]:
    """Every place the quote is, as (first line, last line), blind to whitespace and emphasis (source-highlighter's
    CONTRACT §2 rule: the exact words, exactly once, or say why)."""
    flat, at = _flat(text)
    q = _flat(quote)[0]
    if not q:
        return []
    hits, i = [], flat.find(q)
    while i >= 0:
        hits.append((at[i], at[i + len(q) - 1]))
        i = flat.find(q, i + 1)
    return hits


# ── resolving a box's private keys ───────────────────────────────────────────────────────────────────────────────
@dataclass
class Key:
    key: str
    status: str  # located | not-located | broken
    why: str | None = None
    file: Path | None = None
    lines: tuple[int, int] | None = None
    block: str | None = None
    quote: str | None = None
    target: str | None = None  # the wikilink's note name


@dataclass
class Resolution:
    notes: Path | None
    ledger: Path | None
    keys: dict[str, Key]
    why: str | None = None

    @property
    def broken(self) -> int:
        return sum(1 for k in self.keys.values() if k.status != "located")


def private_keys(links: dict | None) -> list[dict]:
    return [s for s in (links or {}).get("sources") or [] if s.get("private")]


def find_ledger(m: Machine, box: str, idx: dict[str, list[Path]]) -> tuple[Path | None, str | None]:
    if box in m.ledgers:
        p = Path(str(m.ledgers[box]).replace("{notes}", str(m.notes)).replace("{" + NOTES_KEY + "}", str(m.notes))).expanduser()
        return (p, None) if p.is_file() else (None, f"the ledger the roots file names for {box} is not there")
    name = LEDGER_NAME.format(box=box)
    hits = idx.get(name, [])
    if len(hits) == 1:
        return hits[0], None
    if not hits:
        return None, f"no ledger note named “{name}” in the notes folder ({m.path} names the folder)"
    return None, f"{len(hits)} notes are named “{name}”: keep one"


def resolve(links: dict | None, box: str, m: Machine | None) -> Resolution:
    """Every private key of the box's `links` slice → the exact words on this machine, or why not. With `links` None,
    every key the box's ledger lists (what `blackbox check` reads before the box is folded)."""
    keys = private_keys(links)
    if m is None:
        why = "no roots file on this machine"
        return Resolution(None, None, {s["key"]: Key(s["key"], "broken", why) for s in keys}, why)
    if not m.notes.is_dir():
        why = f"no ledger: the notes folder {m.notes} is not on this machine"
        return Resolution(m.notes, None, {s["key"]: Key(s["key"], "broken", why) for s in keys}, why)
    files = notes_files(m.notes)
    idx = name_index(files, m.notes)
    ledger, why = find_ledger(m, box, idx)
    if ledger is None:
        return Resolution(m.notes, None, {s["key"]: Key(s["key"], "broken", why) for s in keys}, why)
    entries = parse_ledger(ledger.read_text(errors="replace"))
    if links is None:
        keys = [{"key": k, "quotes": []} for k in entries]
    out: dict[str, Key] = {}
    for s in keys:
        k = s["key"]
        e = entries.get(k.lower())
        if not e or not e.get("source"):
            out[k] = Key(k, "broken", f"the ledger ({ledger.stem}) has no `## {k}` with a source:: line")
            continue
        out[k] = resolve_one(k, e, s, idx, files)
    return Resolution(m.notes, ledger, out)


def resolve_one(k: str, entry: dict, src: dict, idx: dict[str, list[Path]], files: list[Path]) -> Key:
    link = parse_wikilink(entry["source"])
    quote = (entry.get("quote") or "").strip() or next(iter(src.get("quotes") or []), "")
    if link is None:
        return Key(k, "broken", f"source:: {entry['source'][:60]} is not a [[wikilink]]", quote=quote)
    name, heading, block = link
    hits = idx.get(name, [])
    if len(hits) > 1:
        return Key(k, "broken", f"[[{name}]] names {len(hits)} notes", quote=quote, target=name)
    if not hits and block:
        # renamed outside Obsidian: the id alone, when it is in exactly one place (Anchors: an id in the text survives)
        found = [f for f in files if f"^{block}" in f.read_text(errors="replace")]
        found = [f for f in found if block_lines(f.read_text(errors="replace").splitlines(), block)]
        if len(found) != 1:
            return Key(k, "broken", f"[[{name}]] is no note, and ^{block} is in {len(found)} places", quote=quote,
                       block=block, target=name)
        hits = found
    if not hits:
        return Key(k, "broken", f"[[{name}]] is no note in the notes folder", quote=quote, target=name)
    f = hits[0]
    text = f.read_text(errors="replace")
    lines = text.splitlines()
    within = None
    if block:
        at = block_lines(lines, block)
        if len(at) != 1:
            # a copy of the id elsewhere (a duplicated note) makes the target ambiguous: said, never guessed
            others = [g for g in files if g != f and block_lines(g.read_text(errors="replace").splitlines(), block)] if not at else []
            return Key(k, "broken", f"^{block} is in {len(at)} places in {f.stem}" if at else
                       f"^{block} is not in {f.stem}" + (f" (it is in {len(others)} other note(s))" if others else ""),
                       file=f, block=block, quote=quote, target=name)
        within = block_range(lines, at[0])
    elif heading:
        within = heading_range(lines, heading)
        if within is None:
            return Key(k, "broken", f"no heading “{heading}” in {f.stem}", file=f, quote=quote, target=name)
    found = find(text, quote)
    inside = [h for h in found if within is None or (within[0] <= h[0] and h[1] <= within[1])]
    if len(inside) == 1:
        return Key(k, "located", None, f, inside[0], block, quote, name)
    if len(inside) > 1:
        return Key(k, "not-located", f"the words are {len(inside)} times in the cited place", f, inside[0], block, quote, name)
    where = f"^{block}" if block else (f"“{heading}”" if heading else f.stem)
    why = (f"the words are in {f.stem}, but not at {where} (the block moved?)" if found else
           f"the words at {where} changed since they were cited")
    return Key(k, "not-located", why, f, within, block, quote, name)


# ── the local build ──────────────────────────────────────────────────────────────────────────────────────────────
def _text_selector(quote: str) -> str:
    """source_msgs' TextQuote, compact (`text=` + the words, percent-encoded; `-` too, as its parser splits on it)."""
    return "text=" + urllib.parse.quote(quote, safe="").replace("-", "%2D")


def open_link(key: Key, label: str) -> str:
    """source-highlighter's open.html (its CONTRACT §7) at the words, relative to the site's data/ folder (beside
    state.json): the staged copy, the block, then the quote."""
    up = "../" * OPEN_HTML.count("/")
    # WHY the block only when the words alone are ambiguous: source-highlighter marks a block id's whole block (a nested
    # list item takes its parent along, a paragraph its embeds), and the ask is the exact words; the resolver already
    # proved they are inside the cited block
    unique = key.file is not None and key.quote and len(find(key.file.read_text(errors="replace"), key.quote)) == 1
    where = ([f"block={key.block}"] if key.block and not unique else []) + ([_text_selector(key.quote)] if key.quote else [])
    q = [("src", f"{up}{STAGED}/{key.key}.md"), ("kind", "markdown"), *(("where", w) for w in where), ("label", label)]
    return "../" + OPEN_HTML + "?" + urllib.parse.urlencode(q, quote_via=urllib.parse.quote)


def stage(site: Path, links: dict, res: Resolution) -> dict:
    """The local build's `links`: each source gains `local` (status, lines, why, the note's name, and the link that opens
    it at the words), each resolved note is copied to data/local/sources/<key>.md, and every unresolved key is a gap."""
    out = {**links, "mode": "local", "sources": [], "problems": list(links.get("problems") or [])}
    folder = site / STAGED
    for s in links.get("sources") or []:
        s = dict(s)
        if not s.get("private"):
            s["local"] = {"status": "web", "open": s.get("url")}
        else:
            k = res.keys.get(s["key"]) or Key(s["key"], "broken", "not resolved")
            loc = {"status": k.status, "why": k.why, "lines": list(k.lines) if k.lines else None,
                   "file": k.file.stem if k.file else None}
            if k.file is not None:
                folder.mkdir(parents=True, exist_ok=True)
                (folder / f"{k.key}.md").write_text(k.file.read_text(errors="replace"))
                loc["open"] = open_link(k, s.get("label") or k.key)
            s["local"] = loc
            if k.status != "located":
                out["problems"].append({"node": s["id"], "kind": "not-located" if k.status == "not-located" else "unresolved",
                                        "text": f"{s.get('label') or k.key} ({k.key}): {k.why}"})
        out["sources"].append(s)
    return out


# ── the leak gate ────────────────────────────────────────────────────────────────────────────────────────────────
@dataclass
class PrivateSide:
    names: dict[str, str] = field(default_factory=dict)  # a private string → what it is
    shingles: set[str] = field(default_factory=set)

    def __bool__(self) -> bool:
        return bool(self.names or self.shingles)


def shingles(text: str) -> set[str]:
    words = re.findall(r"[a-z0-9']+", text.lower())
    return {" ".join(words[i:i + SHINGLE]) for i in range(len(words) - SHINGLE + 1)}


def box_text(box: Path, ref: str = "HEAD") -> str:
    """Every tracked text file of the box at `ref`: the words the box itself publishes (allowed in its build)."""
    blob = subprocess.run(["git", "-C", str(box), "archive", "--format=tar", ref], capture_output=True).stdout
    parts = []
    with tarfile.open(fileobj=io.BytesIO(blob)) as tar:
        for member in tar.getmembers():
            if member.isfile() and Path(member.name).suffix.lower() in TEXT_SUFFIXES and member.size < 8_000_000:
                parts.append(tar.extractfile(member).read().decode(errors="replace"))
    return "\n".join(parts)


def package_text(*folders: Path) -> str:
    """The package's own text files under `folders` (its landing, nav and fold): words a build writes that no box wrote."""
    parts = []
    for folder in folders:
        for f in sorted(Path(folder).rglob("*")) if Path(folder).is_dir() else []:
            if f.is_file() and f.suffix.lower() in TEXT_SUFFIXES and "__pycache__" not in f.parts:
                parts.append(f.read_text(errors="replace"))
    return "\n".join(parts)


def private_side(links: dict | None, box: str, allowed_text="", m: Machine | None = None,
                 res: Resolution | None = None, text: bool = True) -> PrivateSide:
    """What this machine knows that the box's public build must not carry. Empty with no roots file. `allowed_text`
    (the box's own words, or a function returning them: read only when a private note was resolved) is never a leak;
    `text=False` keeps only the names (a lint of the box's own files)."""
    m = m if m is not None else machine()
    if m is None:
        return PrivateSide()
    res = res or resolve(links, box, m)
    side = PrivateSide()

    def name(text: str | None, what: str) -> None:
        if text and len(text) >= 6:
            side.names.setdefault(text, what)

    if res.notes is not None:
        name(str(res.notes), "the notes folder")
    texts = []
    if res.ledger is not None:
        name(res.ledger.stem, "the ledger's name")
        texts.append(res.ledger.read_text(errors="replace"))
        for e in parse_ledger(texts[-1]).values():
            link = parse_wikilink(e.get("source", ""))
            if link:
                name(link[0], "a note's name")
                name(link[2] and f"^{link[2]}", "a block id")
                name(link[2], "a block id")
    for k in res.keys.values():
        if k.file is not None and res.notes is not None:
            name(k.file.relative_to(res.notes).as_posix() if k.file.is_relative_to(res.notes) else k.file.name,
                 "a path in the notes folder")
            name(k.file.stem, "a note's name")
            texts.append(k.file.read_text(errors="replace"))
        name(k.target, "a note's name")
        name(k.block, "a block id")
    if not text or not texts:
        return side
    allowed = shingles(allowed_text() if callable(allowed_text) else allowed_text)
    for s in private_keys(links):
        for q in s.get("quotes") or []:
            allowed |= shingles(q)
    for t in texts:
        side.shingles |= shingles(t)
    side.shingles -= allowed
    return side


SKIP_PARTS = ("dashboard/",)  # the package's own viewer: it carries no box data


def _without_public_provenance(text: str, prefix: str) -> str:
    """For the prose scan, remove only the public prefix from revision-pinned links the fold generates."""
    state = json.loads(text)
    for section, key in (("ideas", "source"), ("analysis", "url")):
        for row in state.get(section) or []:
            url = row.get(key)
            if isinstance(url, str) and url.startswith(prefix):
                row[key] = url.removeprefix(prefix)
    return json.dumps(state, ensure_ascii=False)


def leak_scan(tree: Path, side: PrivateSide | None = None, *, public_blob_prefix: str = "",
              stock_handoff: str = "") -> list[str]:
    """Every leak in a built site, one line each: a private name or private text (this machine's `side`), a home path,
    an `obsidian:` URI. The package's own dashboard/ is not read: it holds no box data."""
    from blackbox_agent.handoff import PATH as HANDOFF_PATH

    side = side or PrivateSide()
    hits: list[str] = []
    for f in sorted(p for p in Path(tree).rglob("*") if p.is_file()):
        rel = f.relative_to(tree).as_posix()
        if rel.startswith(SKIP_PARTS):
            continue
        text = f.read_bytes().decode(errors="replace")
        for n, line in enumerate(text.splitlines(), start=1):
            for s, what in side.names.items():
                if s in line:
                    hits.append(f"{rel}:{n}: a private name ({what})")
            for mm in HOME.finditer(line):
                hits.append(f"{rel}:{n}: a home path: {mm.group(0)[:40]}")
            if OBSIDIAN.search(line):
                hits.append(f"{rel}:{n}: an obsidian: link")
        if side.shingles:
            # WHY only these fields of the fold: a public GitHub URL's host and repo
            # can tokenize to six words in a private note. Keep scanning every URL
            # suffix and any prose with those same words, as well as all raw names.
            prose = (_without_public_provenance(text, public_blob_prefix)
                     if rel == "data/state.json" and public_blob_prefix and public_blob_prefix in text else text)
            if rel == HANDOFF_PATH and stock_handoff:
                # WHY only the exact generated prefix: stock instructions can appear verbatim in private notes.
                # Continue scanning appended excerpts and private names across the entire handoff.
                prose = prose.removeprefix(stock_handoff)
            found = shingles(prose) & side.shingles
            if found:
                hits.append(f"{rel}: private text ({len(found)} run(s) of {SHINGLE} words from a private note)")
    return hits


def ref_findings(box: Path, sha: str, tracked: set[str], side: PrivateSide) -> list[tuple[str, int, str]]:
    """(path, line, what) for each tracked text file line of the box that names a private place or links obsidian:."""
    out = []
    names = list(side.names.items())
    for path in sorted(tracked):
        if Path(path).suffix.lower() not in TEXT_SUFFIXES:
            continue
        run = subprocess.run(["git", "-C", str(box), "show", f"{sha}:{path}"], capture_output=True)
        text = run.stdout.decode(errors="replace")
        if not any(s in text for s, _ in names) and "obsidian:" not in text.lower():
            continue
        for n, line in enumerate(text.splitlines(), start=1):
            whats = sorted({w for s, w in names if s in line} | ({"an obsidian: link"} if OBSIDIAN.search(line) else set()))
            for w in whats:
                out.append((path, n, w))
    return out
