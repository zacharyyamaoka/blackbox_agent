"""The `links` slice (bb-links/1): where a box's words came from, folded from its public files alone.

The linking round's back end (proposals-linking: Ledger + Anchors, PICKS). A note cites with a bare number,
`… calculated. [1](../SOURCES.md#z1)`; the box's SOURCES.md keeps, per key, the label, whose words they are and the
short quote its author publishes:

    ## z1

    - label: Zach, his notes, Nov 24
    - whose: his words
    - quote: “One of the KPIS should be …”
    - url: https://…              (a public page; without it the source is private)

Where a private key points (the note and the exact words) is NOT in the box: it lives in a ledger note on the author's
machine, which `blackbox serve` resolves (the package's sources.py) and `blackbox build` never reads. So this fold is
the public half, and the same on CI as on his machine.

Slice: {schema, from, sources[], nodes[], cites[], edges[], objective, answer{spec, feedback}, problems[]}.
- nodes: the objective, each spec (specs/*.md, its `id`) and each piece of feedback (feedback/*.md, its `id`);
- cites: one per citation, {path, node, line, n, key, context} (context: the cited sentence, the box's own words);
- edges: objective → its page (`explained_by`), spec → feedback (`from_feedback`: the feedback's `specs:` or a link to
  it), note → source (`cites`);
- objective: the spec whose front matter says `objective: <name>` (else one titled with the name) is its page;
- answer: Matrix's one line per tab ("3 of 4 specs trace to Zach's own words · 1 to nothing yet");
- problems: a spec traced to nothing, feedback that cites nothing, a citation to a key SOURCES.md does not list.

None when the box has no SOURCES.md and cites nothing, so every box that has not adopted it folds byte-identically.
WHY "his words" by `whose`: the reader's question is whether a requirement goes back to what Zach said, not merely to
some file (CRITERIA F4: "2 of 5 specs trace to Zach's own words … 1 to nothing yet").
"""

from __future__ import annotations

import posixpath
import re
import subprocess
from pathlib import PurePosixPath

SOURCES = "SOURCES.md"
CITE = re.compile(r"\[([^\]\n]{1,12})\]\(<?((?:\.{1,2}/)*)SOURCES\.md#([A-Za-z0-9_-]+)>?\)")
LINK = re.compile(r"\[[^\]\n]*\]\(<?([^)\s>]+\.md)(?:#[^)\s>]*)?>?\)")
SECTION = re.compile(r"^##\s+([A-Za-z0-9_-]+)\s*$", re.M)
FIELD = re.compile(r"^\s*[-*]\s+([A-Za-z_]+)::?\s+(.+?)\s*$")
CODE = re.compile(r"`[^`\n]*`")
FENCE = re.compile(r"^[ \t]*(```|~~~).*?^[ \t]*\1[^\n]*$", re.M | re.S)


def unquote(text: str) -> str:
    t = text.strip()
    pairs = (("“", "”"), ('"', '"'), ("‘", "’"), ("'", "'"))
    for a, b in pairs:
        if len(t) >= 2 and t.startswith(a) and t.endswith(b):
            return t[len(a):-len(b)].strip()
    return t


def parse_sources(text: str) -> list[dict]:
    """SOURCES.md → one row per `## key` section, in the file's order."""
    out = []
    heads = list(SECTION.finditer(text))
    for i, m in enumerate(heads):
        body = text[m.end():heads[i + 1].start() if i + 1 < len(heads) else len(text)]
        fields: dict[str, list[str]] = {}
        for line in body.splitlines():
            f = FIELD.match(line)
            if f:
                fields.setdefault(f.group(1).lower(), []).append(f.group(2))
        key = m.group(1)
        whose = (fields.get("whose") or [""])[0].strip()
        url = (fields.get("url") or [None])[0]
        url = url.strip("<>") if url else None
        out.append({"key": key, "label": (fields.get("label") or [key])[0].strip(), "whose": whose,
                    "his": whose.lower().startswith("his"), "quotes": [unquote(q) for q in fields.get("quote", [])],
                    "url": url, "private": url is None, "id": f"source:{key}"})
    return out


def front(text: str) -> tuple[dict, str, int]:
    """(front matter as flat key → str | list, body, the body's first line number)."""
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return {}, text, 1
    meta: dict = {}
    key = None
    for line in m.group(1).splitlines():
        if re.match(r"^\s+-\s+", line) and key:
            meta[key] = (meta[key] if isinstance(meta.get(key), list) else []) + [line.split("-", 1)[1].strip().strip("\"'")]
            continue
        km = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
        if not km:
            continue
        key, v = km.group(1), km.group(2).strip()
        if v.startswith("[") and v.endswith("]"):
            meta[key] = [x.strip().strip("\"'") for x in v[1:-1].split(",") if x.strip()]
        else:
            meta[key] = v.strip("\"'") if v else []
    return meta, text[m.end():], m.group(0).count("\n") + 1


def title_of(body: str, fallback: str) -> str:
    return next((l[2:].strip() for l in body.splitlines() if l.startswith("# ")), fallback)


def sentence(line: str, at: int) -> str:
    """The sentence around a citation, as the box wrote it, citations kept (a reader of a mention sees the context)."""
    text = re.sub(r"^\s*(?:[-*>]\s+|\d+\.\s+)*", "", line).strip()
    return text if len(text) <= 200 else text[:197].rstrip() + "…"


def lands(note: str, prefix: str) -> bool:
    """Does `<prefix>SOURCES.md` from `note` land on the box's own SOURCES.md (its root)?"""
    return posixpath.normpath(posixpath.join(posixpath.dirname(note), prefix + SOURCES)) == SOURCES


def fold(facts: dict):
    t = facts["tree"]
    # WHY git grep first: a box that cites nothing must fold byte-identically (its `source.read` list included), so no
    # note is read until the box is known to use SOURCES.md
    run = subprocess.run(["git", "-C", t.repo, "grep", "-l", "-F", "SOURCES.md#", t.sha, "--", "*.md"],
                         capture_output=True, text=True)
    citing = {line.split(":", 1)[1] for line in run.stdout.splitlines() if ":" in line}
    if SOURCES not in t.fileset and not citing:
        return None
    sources = parse_sources(t.text(SOURCES) or "") if SOURCES in t.fileset else []
    notes = sorted({p for p in t.files if re.fullmatch(r"(specs|feedback)/[^/]+\.md", p)} | citing - {SOURCES})
    texts = {p: t.text(p) or "" for p in notes}
    by_key = {s["key"]: s for s in sources}

    nodes: list[dict] = []
    node_of: dict[str, str] = {}  # path → node id
    obj = (facts.get("state") or {}).get("objective") or {}
    obj_name = obj.get("name")
    nodes.append({"id": "objective", "kind": "objective", "title": obj_name})
    meta_of: dict[str, dict] = {}
    for folder, kind in (("specs", "spec"), ("feedback", "feedback")):
        for path in sorted((p for p in notes if re.fullmatch(rf"{folder}/[^/]+\.md", p) and not p.endswith("/README.md")),
                           key=lambda p: [int(x) if x.isdigit() else x for x in re.split(r"(\d+)", p)]):
            meta, body, _ = front(texts[path])
            nid = f"{kind}:{meta.get('id') or PurePosixPath(path).stem}"
            nodes.append({"id": nid, "kind": kind, "title": title_of(body, PurePosixPath(path).stem), "path": path})
            node_of[path] = nid
            meta_of[nid] = meta
    for s in sources:
        nodes.append({"id": s["id"], "kind": "source", "title": s["label"]})

    cites, edges, problems = [], [], []
    seen_edge = set()

    def edge(a: str, b: str, rel: str) -> None:
        if (a, b, rel) not in seen_edge:
            seen_edge.add((a, b, rel))
            edges.append({"from": a, "to": b, "rel": rel})

    for path in sorted(texts):
        text = FENCE.sub(lambda m: "\n" * m.group(0).count("\n"), texts[path])
        for n_line, line in enumerate(text.splitlines(), start=1):
            scan = CODE.sub(lambda c: " " * len(c.group(0)), line)  # a citation shown as `code` is an example, not one
            for m in CITE.finditer(scan):
                if not lands(path, m.group(2)):
                    continue  # a link to some other SOURCES.md: lint's broken-link says so
                key = m.group(3)
                nid = node_of.get(path)
                cites.append({"path": path, "node": nid, "line": n_line, "n": m.group(1), "key": key,
                              "context": sentence(line, m.start())})
                if key not in by_key:
                    problems.append({"node": nid or path, "kind": "unknown-key", "path": path, "line": n_line,
                                     "text": f"[{m.group(1)}] in {path}:{n_line} names {key}, which SOURCES.md does not list"})
                elif nid:
                    edge(nid, f"source:{key}", "cites")
            for m in LINK.finditer(scan):
                target = posixpath.normpath(posixpath.join(posixpath.dirname(path), m.group(1)))
                a, b = node_of.get(path), node_of.get(target)
                if a and b and a.startswith("spec:") and b.startswith("feedback:"):
                    edge(a, b, "from_feedback")
    for nid, meta in meta_of.items():
        if nid.startswith("feedback:"):
            for spec in meta.get("specs") or meta.get("spec") or []:
                if f"spec:{spec}" in meta_of:
                    edge(f"spec:{spec}", nid, "from_feedback")

    page = next((n for n in nodes if n["kind"] == "spec" and obj_name and meta_of[n["id"]].get("objective") == obj_name), None)
    page = page or next((n for n in nodes if n["kind"] == "spec" and obj_name and obj_name in n["title"]), None)
    if page:
        edge("objective", page["id"], "explained_by")
    objective = {"name": obj_name, "node": page["id"] if page else None, "path": page["path"] if page else None}

    def cited(nid: str) -> list[dict]:
        return [by_key[e["to"].split(":", 1)[1]] for e in edges if e["from"] == nid and e["rel"] == "cites"]

    def via_feedback(nid: str) -> list[str]:
        return [e["to"] for e in edges if e["from"] == nid and e["rel"] == "from_feedback"]

    specs = [n for n in nodes if n["kind"] == "spec"]
    his = other = none = 0
    for s in specs:
        reach = cited(s["id"]) + [x for fb in via_feedback(s["id"]) for x in cited(fb)]
        if any(r["his"] for r in reach):
            his += 1
        elif reach or via_feedback(s["id"]):
            other += 1
        else:
            none += 1
            problems.append({"node": s["id"], "kind": "no-source",
                             "text": f"{s['id'].split(':', 1)[1]} names no feedback and no source: where it came from is not written down"})
    feedback = [n for n in nodes if n["kind"] == "feedback"]
    fb_his = 0
    for f in feedback:
        reach = cited(f["id"])
        if any(r["his"] for r in reach):
            fb_his += 1
        elif not reach:
            problems.append({"node": f["id"], "kind": "no-source", "text": f"{f['id'].split(':', 1)[1]} cites no source"})
    parts = [f"{his} of {len(specs)} spec{'s' if len(specs) != 1 else ''} trace to Zach's own words"]
    if other:
        parts.append(f"{other} to another source")
    if none:
        parts.append(f"{none} to nothing yet")
    answer = {"spec": {"text": " · ".join(parts) if specs else "No specs yet", "his": his, "other": other, "none": none,
                       "of": len(specs)},
              "feedback": {"text": (f"{fb_his} of {len(feedback)} piece{'s' if len(feedback) != 1 else ''} of feedback "
                                    f"cite{'s' if len(feedback) == 1 else ''} where Zach said it") if feedback else "No feedback yet",
                           "his": fb_his, "of": len(feedback)}}
    order = {n["id"]: i for i, n in enumerate(nodes)}
    problems.sort(key=lambda p: (order.get(p["node"], len(order)), p.get("line") or 0))
    return {"schema": "bb-links/1", "mode": "public", "from": SOURCES if sources else None, "sources": sources,
            "nodes": nodes, "cites": cites, "edges": edges, "objective": objective, "answer": answer, "problems": problems}
