"""A fresh box builds into a site with the landing, the dashboard and the fold; an override is wired in by an import map.

    python3 -m unittest discover -s tests
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
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

    def test_an_override_naming_no_stock_component_is_refused(self):
        (self.box / "site" / "overrides").mkdir(parents=True)
        (self.box / "site" / "overrides" / "bb-nothing.js").write_text("export {};\n")
        subprocess.run(["git", "-C", str(self.box), "add", "site/overrides"], check=True)
        subprocess.run(["git", "-C", str(self.box), "commit", "-qm", "bad override"], check=True)
        with self.assertRaises(BoxError):
            build(self.box, self.root / "site")

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
