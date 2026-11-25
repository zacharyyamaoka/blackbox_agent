4. Rebuild the page's data and commit it with the solution, win or lose: the box's site build writes `site/data/`
   (`state.json`, and `junit.xml`, the test run the Spec page reads, written with pytest's hostname dropped and paths
   relative, since it is public), then commit `site/data` with the solution.
   CI re-folds `site/data/state.json` from the pushed commit anyway (`.github/workflows/pages.yml`, with the fold
   vendored in `tools/bb/`), so the live page is never behind `main`. CI cannot re-run the tests (the box's deps are
   local path deps), so the Spec page is only as fresh as the `junit.xml` you commit.
