# solutions/

One folder per solution: its code, `meta.json` (`id`, `parent`, `change`, `proposed_by`: agent + model, `created`,
`tags`, and the names: `name` a dotted `FAMILY.VARIANT...` id, `summary` at most 150 characters, `description`, and
`expect`, the prediction, committed before the solution is scored) and the ruler's `scorecard.json`. Keep the losers: a discarded scorecard tells the next agent what not to try.
