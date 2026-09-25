# Lessons

- 2026-09-24 — A bound on an offset is not a bound on a position: "keeps a retired plant on the canvas" capped |dx| and passed while edge plots threw plants off-canvas (`depth 1, coverage 0`, a Date.now()-seeded flake). Caught now by `test/forest.test.ts` asserting origin+dx from every plot, and by `placeRetired` requiring the origin.
- 2026-09-25 — Measuring a quantity twice and judging both readings against one cut fails in proportion to how often the machine lands near that cut: check-clock picked its throttle on a 700ms probe (29.7 fps) and failed its own control on the 3s re-measure (30.1, cut 30.05). Caught now by selecting on the very sample that is compared, so the control is a property of the compared data.
