# blackbox_agent

**The shared half of every black-box agent repo, in one package: the fold that turns a box's git history into its
page's data, the landing page and dashboard, the site build, a reusable GitHub Pages workflow, and the loop an agent
runs. [▶ Live example](https://zacharyyamaoka.github.io/trajectory_tracking_agent/) (trajectory_tracking_agent).**

A black-box agent is handed a fixed objective and a ruler it cannot edit, and searches for solutions. Each one lives in
its own repo, a **box**. The box holds only what is true of it: the objective and the frozen ruler, the ledger, the
solutions, its domain code, and what its page shows. Everything else is here, once, so a fix reaches every box at its
next build.

```bash
uvx --from git+https://github.com/zacharyyamaoka/blackbox_agent@v0 blackbox --help
```

| Command | What it does |
|---|---|
| `blackbox build --box <dir> --out <dir>` | folds the box's `HEAD` into `data/state.json`, then writes its whole site: the landing, the dashboard, `nav.json`, its tabs and its other site files |
| `blackbox serve --box <dir> [--port N]` | the same build, in a temporary folder, served on `127.0.0.1` |
| `blackbox new <dir>` | a box skeleton: `OBJECTIVES.md`, `AGENTS.md`, an empty `ledger.jsonl`, `site/nav.json`, the Pages workflow; committed on `main` |
| `blackbox check --box <dir>` | is the box in the format, does its site build, does every `nav.json` link land on a page, what does the package replace |
| `blackbox skill` | prints the loop (the `blackbox` skill, [`skill/SKILL.md`](skill/SKILL.md)) |

The build reads every box file from git at the ref (`--ref`, default `HEAD`), never the working tree, so the same
commit builds the same site. It is stdlib + git, with no dependencies, so it runs on a CI runner's plain Python.

## What a box holds, what this package holds

| A box holds (it changes a score, or says what to show) | This package holds (it never changes a score) |
|---|---|
| `OBJECTIVES.md`, the ruler and scorer, gate limits: frozen | the fold (git → `state.json`, the `bb-state/1` format) |
| `ledger.jsonl`, `solutions/`, `ideas.md`, `specs/`, `feedback/`, `status.json` | the viewer: every dashboard component, the dashboard page |
| its domain code and domain dashboards | the stock landing page (a box replaces it only with `site/overrides/index.html`) |
| `site/nav.json`, `site/tabs/`, `site/overrides/` | the site build, the Pages workflow, the loop |

A shared update can change how a number looks, never the number: the ruler and the scorer stay in the box.

## Deploy: six lines in the box

`.github/workflows/pages.yml` (`blackbox new` writes it), with the box's Pages source set to "GitHub Actions":

```yaml
name: pages
on: {push: {branches: [main]}, workflow_dispatch: {}}
permissions: {contents: read, pages: write, id-token: write}
jobs:
  site:
    uses: zacharyyamaoka/blackbox_agent/.github/workflows/site.yml@v0
```

The workflow checks out the box with its full history, runs
`uvx --from git+https://github.com/zacharyyamaoka/blackbox_agent@v0 blackbox build --box . --out _site` and deploys
`_site` in a second job. **Pin it** by naming an exact version: `site.yml@v0.1.0` with `with: {ref: v0.1.0}`. `v0`
moves to every `0.x` release. A box tool the fold runs that needs a package lists exactly that in
`.github/fold-requirements.txt`.

## Change one piece: an override

`site/overrides/<tag>.js` replaces or wraps the stock component `<tag>` (any module under the viewer's
`src/components/`). `blackbox build` writes an import map into every page that loads the viewer, and the dashboard
says how many components the box overrides, so drift is a number you can see. The override reaches the stock module
by the same URL plus `?stock`:

```js
// site/overrides/bb-site-nav.js: the stock site bar, plus one thing
import { BBSiteNav } from '../dashboard/viewer/src/components/bb-site-nav.js?stock';
export * from '../dashboard/viewer/src/components/bb-site-nav.js?stock';
const stockRender = BBSiteNav.prototype.render;
BBSiteNav.prototype.render = function () { stockRender.call(this); /* the box's addition */ };
```

A file whose name starts with `_` is a helper the overrides share, not an override. A good override belongs here, in
the package, so every box gets it.

**The landing is an override too.** The stock landing always builds; `site/overrides/index.html` replaces it (served at
the site's root, so its links are written as from `site/`) and is counted with the components. A plain
`site/index.html` is not used: `blackbox check` says to move it to `site/overrides/index.html` or delete it.

## The site a build writes

```text
index.html             the landing: the goal, the progress, "Open the dashboard →" (or the box's site/overrides/index.html)
nav.json               the site bar on every page (bb-site-nav/1): the box's site/nav.json, or the Black box only
data/state.json        the fold of the commit (bb-state/1); the box export's `playback` slice is kept
dashboard/             the dashboard: the viewer's components, the stock parts they load, the tab templates
overrides/<tag>.js     the box's own components, wired in by an import map (the dashboard counts them, and the landing)
blackbox-build.json    what was built from what: this package's version, the box's commit, the overrides
```

A box's own pages (a domain dashboard, a run report) include the same site bar:

```html
<bb-site-nav src="../nav.json" current="<its id>"></bb-site-nav>
<script type="module" src="../dashboard/viewer/src/components/bb-site-nav.js"></script>
```

## The loop

`blackbox skill` prints it; [`skill/SKILL.md`](skill/SKILL.md) is a Claude Code / Codex skill (link the folder into
your skills). A box's `AGENTS.md` says "Run the blackbox loop" and then only what is specific to the box: its evaluate
command, its ruler's files, what a solution may know.

## License

MIT: [LICENSE](LICENSE).
