"""blackbox_agent: the shared half of every black-box agent repo.

A box (one repo per agent) holds only what is true of it: its objective and frozen ruler, its ledger, its solutions,
its domain code and what its site shows (site/nav.json, site/tabs/, site/overrides/). This package holds the rest, once:
the fold (git -> state.json), the landing page and dashboard, the site build, the reusable Pages workflow and the loop.

    blackbox build --box . --out _site      # fold HEAD, assemble the landing + dashboard + the box's own site files
    blackbox serve --box .                  # the same, served on 127.0.0.1
    blackbox new my_agent                   # a box skeleton: the stock files, an empty ledger
    blackbox check --box .                  # what the box is missing, and what the package replaces
"""

__version__ = "0.1.4"
