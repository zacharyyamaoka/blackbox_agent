# template/: the files a black-box repo copies

`python3 ~/blackbox_agent/tools/apply_template.py --box ~/<box>` writes each file below into the box (the name, owner and
repo filled in; a file that already differs is kept unless `--force`), then vendors the fold (`tools/bb/`) and the
viewer (`site/dashboard/`). Commit them in the box. A second run changes nothing.

**A new box runs it first**, on the fresh repo, before writing any page: never hand-write `site/`. A `site/index.html`
without the stock skeleton (the Ticker `<bb-headliner>` and "Open the dashboard →") is **NOT STOCK**: the run names it and
exits 1 (`--force` replaces it; `<meta name="bb-landing" content="own: <why>">` keeps a page that is the box's own on
purpose). `--check` writes nothing and names every way a box differs from the stock site. WHY (2026-11-24):
robot_sdk_agent was built by hand "in the trajectory_tracking_agent format" and shipped a hand-written page, no hero, no
dashboard; a private box's own page was kept in one printed line, exit 0.

| File | What it is |
|---|---|
| `README.header.md` | the README's title and its first line: the live landing page and this format |
| `.github/workflows/pages.yml` | GitHub Pages from `main`, re-folding `site/data/state.json` from the pushed commit first |
| `tests/test_readme_landing_link.py` | holds the README's first line |
| `site/index.html` | **the landing page**: the box's own bar ("Open the dashboard →" and GitHub top right), the goal (the fold's `about.remit`), the hero (the box's saved runs replayed by `bb-evidence` when its state lists any, else the Ticker: the progress from the ledger, which names the objective while nothing is scored), How it's scored (the objective and every gate, `bb-gates` tiles), every dashboard of `nav.json` in the footer. The box owns it from here: grow it with its own story (trajectory_tracking_agent's plays its saved runs), keeping the Ticker and "Open the dashboard →" |
| `site/nav.json` | **the site bar's one file** (`bb-site-nav/1`, viewer CONTRACT §18): the box's name and its dashboards. It starts with the Black box only |
| `tests/test_site_dashboard.py` | nav.json's links are pages of the site; the landing opens the dashboard; `site/dashboard/` is the viewer as vendored |
| `AGENTS.step4.md` | how the box's loop words its site step |

## The site: a landing page, the dashboard, one bar

Zach, 2026-11-24: "I 100% like the separate landing page and then the open the dashboard button" (proposals-landing 02),
and the bar is lane NAV's **01 Two rows** (PICKS.md): nothing on the left; the brand row holds the dashboards, the row below
the open dashboard's own tabs, folding into More ▾.

```text
site/index.html        the landing (its own bar; the dashboards' bar links back here by the box's name)
site/nav.json          the bar's file: every page reads it
site/dashboard/        the Black box: the viewer, vendored (never edit; re-vendor: tools/vendor_viewer.py --box .)
site/data/state.json   the fold (CI re-folds it on every push)
site/<dashboard>/      a domain dashboard the box adds: its pages include the bar
```

**Add a dashboard** (a page another repo builds, a stock viewer dropped into `site/`): one entry in `nav.json`'s
`dashboards` and its id in `order`:

```json
{ "id": "coverage", "label": "Trajectory coverage", "short": "Coverage", "group": "domain", "icon": "coverage",
  "href": "deployments/", "about": "What the ruler's trajectories visit.", "by": "traj_compare's coverage workbench",
  "pages": [{ "id": "deployments", "label": "Deployments", "href": "deployments/" },
            { "id": "datasets-ur5e", "label": "Datasets · UR5e", "href": "datasets/ur5e/", "match": "datasets/" }] }
```

and each of its pages includes the bar right after `<body>`, paths relative to that page (the box's build writes it;
trajectory_tracking_agent's is `tools/site_bar.py`):

```html
<bb-site-nav src="../nav.json" current="coverage"></bb-site-nav>
<script type="module" src="../dashboard/viewer/src/components/bb-site-nav.js"></script>
```

`here="Run · <task>"` names a page below a tab (a run report); `theme="light"` says the page has no dark mode (the bar
stays light there and remembers the reader's pick for the other pages). Every page stays its own URL, so its own deep
links survive a reload, Back is the browser's, and nothing needs a symlink (GitHub Pages serves `site/` only).
