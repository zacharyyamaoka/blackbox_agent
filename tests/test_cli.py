"""A fresh box builds into a site with the landing, the dashboard and the fold; an override is wired in by an import map.

    python3 -m unittest discover -s tests
"""

from __future__ import annotations

import errno
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from blackbox_agent.box import check, new  # noqa: E402
from blackbox_agent.cli import main  # noqa: E402
from blackbox_agent.site import BoxError, build, with_import_map  # noqa: E402

IDENTITY = {"GIT_AUTHOR_NAME": "blackbox test", "GIT_AUTHOR_EMAIL": "blackbox-test@localhost",
            "GIT_COMMITTER_NAME": "blackbox test", "GIT_COMMITTER_EMAIL": "blackbox-test@localhost"}


class FreshBox(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.env = dict(os.environ)
        os.environ.update(IDENTITY)
        self.box = self.root / "some_agent"
        new(self.box, owner="someone", objective="error_mm")

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.env)
        self.tmp.cleanup()

    def test_build_writes_the_landing_the_dashboard_and_the_fold(self):
        record = build(self.box, self.root / "site")
        site = self.root / "site"
        state = json.loads((site / "data" / "state.json").read_text())
        self.assertEqual(state["schema"], "bb-state/1")
        self.assertEqual(state["objective"]["name"], "error_mm")
        self.assertEqual(record["landing"], "stock")
        self.assertIn('href="dashboard/#overview"', (site / "index.html").read_text())
        self.assertIn("Some Agent", (site / "index.html").read_text())
        self.assertTrue((site / "dashboard" / "index.html").is_file())
        self.assertTrue((site / "dashboard" / "viewer" / "src" / "components" / "bb-site-nav.js").is_file())
        self.assertEqual(json.loads((site / "nav.json").read_text())["schema"], "bb-site-nav/1")
        problems, _ = check(self.box)
        self.assertEqual(problems, [])

    def test_an_override_is_one_import_map_entry_and_the_dashboard_counts_it(self):
        (self.box / "site" / "overrides").mkdir(parents=True)
        (self.box / "site" / "overrides" / "bb-site-nav.js").write_text(
            "export * from '../dashboard/viewer/src/components/bb-site-nav.js?stock';\n")
        subprocess.run(["git", "-C", str(self.box), "add", "site/overrides"], check=True)
        subprocess.run(["git", "-C", str(self.box), "commit", "-qm", "override"], check=True)
        record = build(self.box, self.root / "site")
        self.assertEqual(record["overrides"], ["bb-site-nav"])
        page = (self.root / "site" / "dashboard" / "index.html").read_text()
        self.assertIn('"./viewer/src/components/bb-site-nav.js": "../overrides/bb-site-nav.js"', page)
        self.assertIn("1 override", page)
        landing = (self.root / "site" / "index.html").read_text()
        self.assertIn('"./dashboard/viewer/src/components/bb-site-nav.js": "./overrides/bb-site-nav.js"', landing)

    def test_handoff_copies_committed_context_only_on_loopback_builds(self):
        display = 'Fixture: Δ — "Shelf" [A]'
        nav = json.loads((self.box / "site" / "nav.json").read_text())
        nav["site"]["name"] = display
        self.commit({
            "AGENTS.md": "committed operator instructions\n",
            "goals/G1-next.md": "---\nvibe-goal: Committed fixture milestone\n---\n",
            "ledger.jsonl": "\n",
            "site/nav.json": json.dumps(nav),
        }, "operator brief")
        (self.box / "AGENTS.md").write_text("uncommitted private draft\n")
        (self.box / "goals" / "G2-draft.md").write_text("uncommitted goal\n")
        for include in [False, True]:
            with self.subTest(include=include):
                site = self.root / "site"
                build(self.box, site, handoff_local=include)
                nav = json.loads((site / "nav.json").read_text())
                prompt = (site / nav["site"]["handoff"]).read_text()
                self.assertEqual(nav["site"]["name"], display)
                lines = prompt.splitlines()
                self.assertEqual(lines[0], f"# Drive {display}")
                self.assertTrue(lines[2].startswith("Ensure the chat is named: "))
                self.assertEqual(json.loads(lines[2].split(": ", 1)[1]), display)
                self.assertIn("set this chat's title", prompt)
                self.assertIn("vt bind --box . --peers --json", prompt)
                self.assertIn("blackbox skill", prompt)
                self.assertIn("vt box-work claim <idea> --box .", prompt)
                self.assertIn("vt box-work done <idea> --box .", prompt)
                self.assertIn("https://github.com/someone/some_agent", prompt)
                # The same clipboard must steer each host with its own tools, including on public builds.
                operating = prompt.split("## AGENTS.md at the dashboard snapshot", 1)[0]
                shared, codex, claude = re.split(r"(?m)^### (?:Codex|Claude Code)\n", operating)
                self.assertIn("Launch subagents for independent", shared)
                self.assertIn("verify and\n   integrate their results", shared)
                self.assertIn("claim the next eligible idea", shared)
                self.assertIn("Leave a matching paused goal paused", shared)
                for control in ("`get_goal`", "`create_goal`", "`update_goal`", "native Codex subagents", "automation tools"):
                    self.assertIn(control, codex)
                    self.assertNotIn(control, claude)
                for control in ("`GetGoal`", "`SetGoal`", "`/goal <completion condition>`", "`Agent` tool", "`/loop`"):
                    self.assertIn(control, claude)
                for host in (codex, claude):
                    self.assertIn("recurring work I explicitly requested", host)
                    self.assertIn("next run", host)
                self.assertIn("read-only or one-off assignment", prompt)
                self.assertEqual("committed operator instructions" in prompt, include)
                self.assertEqual("Committed fixture milestone" in prompt, include)
                self.assertNotIn("uncommitted private draft", prompt)
                self.assertNotIn("uncommitted goal", prompt)

    def test_an_override_naming_no_stock_component_is_refused(self):
        (self.box / "site" / "overrides").mkdir(parents=True)
        (self.box / "site" / "overrides" / "bb-nothing.js").write_text("export {};\n")
        subprocess.run(["git", "-C", str(self.box), "add", "site/overrides"], check=True)
        subprocess.run(["git", "-C", str(self.box), "commit", "-qm", "bad override"], check=True)
        with self.assertRaises(BoxError):
            build(self.box, self.root / "site")

    def commit(self, files: dict[str, str], message: str) -> None:
        for rel, text in files.items():
            (self.box / rel).parent.mkdir(parents=True, exist_ok=True)
            (self.box / rel).write_text(text)
        subprocess.run(["git", "-C", str(self.box), "add", "--", *files], check=True)
        subprocess.run(["git", "-C", str(self.box), "commit", "-qm", message], check=True)

    def test_a_box_s_own_site_index_html_never_replaces_the_stock_landing(self):
        # WHY (Zach, 2026-11-24, on robot_sdk_agent's hand-written page: "the landing page is not like the stock one I
        # designed"): a stray site/index.html used to win silently; the stock landing always builds now
        self.commit({"site/index.html": "<!doctype html><title>mine</title><p>MY OWN PAGE</p>"}, "a hand-written page")
        record = build(self.box, self.root / "site")
        landing = (self.root / "site" / "index.html").read_text()
        self.assertEqual(record["landing"], "stock")
        self.assertIn("<bb-headliner", landing)
        self.assertNotIn("MY OWN PAGE", landing)
        self.assertEqual(record["overrides"], [])
        self.assertTrue(any(d.startswith("site/index.html") for d in record["dropped"]), record["dropped"])
        problems, _ = check(self.box)
        self.assertTrue(any("site/index.html is not used" in p and "site/overrides/index.html" in p for p in problems),
                        problems)

    def test_site_overrides_index_html_replaces_the_landing_and_counts_as_an_override(self):
        self.commit({"site/overrides/index.html": "<!doctype html><title>mine</title><p>MY OWN LANDING</p>"},
                    "the box's own landing")
        record = build(self.box, self.root / "site")
        site = self.root / "site"
        self.assertEqual(record["landing"], "the box's own (site/overrides/index.html)")
        self.assertIn("MY OWN LANDING", (site / "index.html").read_text())
        self.assertFalse((site / "overrides" / "index.html").exists(), "the override is the landing, not a second page")
        self.assertEqual(record["overrides"], ["index.html"])
        page = (site / "dashboard" / "index.html").read_text()
        self.assertIn("1 override (site/overrides/)", page)
        self.assertIn("<code>index.html</code>", page)
        self.assertNotIn('type="importmap" data-blackbox-overrides', page, "no component overridden: no import map")
        problems, _ = check(self.box)
        self.assertEqual(problems, [])

    def test_a_landing_and_a_component_override_are_two_overrides(self):
        self.commit({"site/overrides/index.html": "<!doctype html><head></head><body><p>MINE</p>"
                     "<script type=module src=\"dashboard/viewer/src/components/bb-headliner.js\"></script></body>",
                     "site/overrides/bb-site-nav.js": "export * from '../dashboard/viewer/src/components/bb-site-nav.js?stock';\n"},
                    "two overrides")
        record = build(self.box, self.root / "site")
        site = self.root / "site"
        self.assertEqual(record["overrides"], ["bb-site-nav", "index.html"])
        self.assertIn("2 overrides (site/overrides/)", (site / "dashboard" / "index.html").read_text())
        landing = (site / "index.html").read_text()
        self.assertIn("MINE", landing)
        self.assertIn('"./dashboard/viewer/src/components/bb-site-nav.js": "./overrides/bb-site-nav.js"', landing)
        self.assertNotIn("index.html", json.dumps(self._import_maps(landing)), "the landing is never an import map entry")

    @staticmethod
    def _import_maps(page: str) -> list:
        return [json.loads(m) for m in re.findall(r'<script type="importmap"[^>]*>(.*?)</script>', page, re.S)]

    def serve(self, *args: str) -> subprocess.Popen:
        env = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "src")}
        return subprocess.Popen([sys.executable, "-m", "blackbox_agent", "serve", "--box", str(self.box), *args],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)

    @staticmethod
    def occupy(port: int) -> socket.socket | None:
        """A listening socket on 127.0.0.1:port; None when a peer already holds it (busy either way)."""
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.bind(("127.0.0.1", port))
        except OSError as e:
            s.close()
            if e.errno != errno.EADDRINUSE:
                raise
            return None
        s.listen(1)
        return s

    def test_serve_falls_back_to_a_free_port_when_the_default_is_busy(self):
        # WHY (Zach hit it, 2026-11-24): many servers run on this machine, and a handoff command must work on the first
        # click; `blackbox serve` crashed with Errno 98 when 8765 was taken
        held = self.occupy(8765)
        proc = self.serve()
        try:
            first = proc.stdout.readline()
            m = re.match(r"http://127\.0\.0\.1:(\d+)/", first)
            self.assertTrue(m, f"the first line is the URL: {first!r} {proc.stderr.read() if proc.poll() is not None else ''}")
            self.assertNotEqual(int(m.group(1)), 8765)
            with urllib.request.urlopen(m.group(0), timeout=10) as r:
                self.assertEqual(r.status, 200)
                self.assertIn(b"<bb-headliner", r.read())
        finally:
            proc.terminate()
            proc.wait(timeout=10)
            if held:
                held.close()

    def test_serve_on_a_busy_port_you_named_fails_and_names_the_port(self):
        held = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        held.bind(("127.0.0.1", 0))
        held.listen(1)
        port = held.getsockname()[1]
        try:
            proc = self.serve("--port", str(port))
            out, err = proc.communicate(timeout=60)
            self.assertNotEqual(proc.returncode, 0)
            self.assertIn(f"port {port} is in use", err)
            self.assertNotIn("Traceback", err)
        finally:
            held.close()

    def test_build_never_overwrites_a_folder_it_did_not_write(self):
        out = self.root / "mine"
        out.mkdir()
        (out / "keep.txt").write_text("mine")
        self.assertEqual(main(["build", "--box", str(self.box), "--out", str(out)]), 1)
        self.assertEqual((out / "keep.txt").read_text(), "mine")
        self.assertEqual(main(["build", "--box", str(self.box), "--out", str(self.box / "site")]), 1)


class ImportMap(unittest.TestCase):
    def test_a_new_map_goes_before_the_first_script(self):
        page = "<html><head><title>x</title></head><body><script type=module src=a.js></script></body></html>"
        out = with_import_map(page, {"./a.js": "./b.js"})
        self.assertLess(out.index("importmap"), out.index("src=a.js"))
        self.assertLess(out.index("importmap"), out.index("</head>"))

    def test_the_page_s_own_entries_win(self):
        page = '<head><script type="importmap">{"imports": {"./a.js": "./mine.js"}}</script></head>'
        out = with_import_map(page, {"./a.js": "./b.js", "./c.js": "./d.js"})
        self.assertIn('"./a.js": "./mine.js"', out)
        self.assertIn('"./c.js": "./d.js"', out)


if __name__ == "__main__":
    unittest.main()
