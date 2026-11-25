"""The site: a landing page, the dashboard, one bar (blackbox_agent's template; its viewer CONTRACT §18).

site/index.html is the landing ("Open the dashboard →" opens dashboard/#overview); site/dashboard/ is the black-box
viewer, vendored by blackbox_agent's tools/vendor_viewer.py and never edited here (re-vendor); site/nav.json is the one
file the bar on every page reads. A domain dashboard joins with one nav.json entry, and its pages include the bar:

    <bb-site-nav src="../nav.json" current="<its id>"></bb-site-nav>
    <script type="module" src="../dashboard/viewer/src/components/bb-site-nav.js"></script>
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import pytest

SITE = Path(__file__).resolve().parents[1] / "site"
DASHBOARD = SITE / "dashboard"
REL = re.compile(r"^(?![a-z][a-z0-9+.-]*:)(?!/)(?!.*(?:^|/)\.\.(?:/|$))\S*$", re.I)


def _page(href: str) -> Path:
    path = SITE / href.split("#")[0].split("?")[0]
    return path / "index.html" if href.endswith("/") or path.is_dir() else path


def test_nav_json_is_the_site_bar_file_and_every_link_is_a_page_of_the_site():
    nav = json.loads((SITE / "nav.json").read_text())
    assert nav["schema"] == "bb-site-nav/1"
    ids = [d["id"] for d in nav["dashboards"]]
    assert sorted(nav["order"]) == sorted(ids) and nav["site"]["home"] in ids
    assert any(d.get("tabs") == "viewer" for d in nav["dashboards"]), "the Black box (the viewer) is a dashboard"
    seen = set()
    for d in nav["dashboards"]:
        for item in [d, *d.get("pages", [])]:
            assert item["id"] not in seen, item["id"]
            seen.add(item["id"])
            assert REL.match(item["href"]), item
            if d.get("tabs") == "viewer" and not (DASHBOARD / "VENDOR.json").exists():
                continue  # the dashboard's page arrives with the vendored viewer (its own test below says so)
            assert _page(item["href"]).is_file(), f"{item['id']}: {item['href']} is not a page of site/"
    assert _page(nav["site"]["landing"]).is_file()


def test_the_landing_opens_the_dashboard():
    html = (SITE / "index.html").read_text()
    assert "<bb-site-nav" not in html, "the landing keeps its own bar (the dashboards' bar links back to it)"
    if re.search(r"""<meta\s+name=["']bb-landing["']\s+content=["']own\b""", html, re.I):
        return  # the box says this page is its own, on purpose (blackbox_agent's apply_template.py keeps it)
    # the stock landing's skeleton, however the box grows the page: "Open the dashboard →" and the Ticker (bb-headliner)
    assert 'href="dashboard/#overview" data-open-dashboard' in html, "the landing opens the dashboard"
    assert "<bb-headliner" in html, ("the landing shows the progress (the stock Ticker), or says it is the box's own: "
                                     '<meta name="bb-landing" content="own: <why>">')


@pytest.mark.skipif(not (DASHBOARD / "VENDOR.json").exists(), reason="vendor the viewer: python3 ~/blackbox_agent/tools/vendor_viewer.py --box .")
def test_the_dashboard_is_the_viewer_as_vendored_never_edited():
    meta = json.loads((DASHBOARD / "VENDOR.json").read_text())
    listed = {row["path"]: row["sha256"] for row in meta["files"]}
    problems = [f"edited or missing: {path}" for path, digest in listed.items()
                if not (DASHBOARD / path).is_file() or hashlib.sha256((DASHBOARD / path).read_bytes()).hexdigest() != digest]
    problems += [f"not vendored: {p.relative_to(DASHBOARD)}" for p in DASHBOARD.rglob("*")
                 if p.is_file() and p.name != "VENDOR.json" and p.relative_to(DASHBOARD).as_posix() not in listed]
    assert not problems, problems[:20]
    assert "index.html" in listed and "viewer/src/components/bb-site-nav.js" in listed
