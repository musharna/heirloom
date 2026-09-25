# Lessons

- 2026-09-24 — A bound on an offset is not a bound on a position: "keeps a retired plant on the canvas" capped |dx| and passed while edge plots threw plants off-canvas (`depth 1, coverage 0`, a Date.now()-seeded flake). Caught now by `test/forest.test.ts` asserting origin+dx from every plot, and by `placeRetired` requiring the origin.
