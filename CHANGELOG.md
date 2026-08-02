# Changelog

Heirloom has no versioned releases. It ships continuously to GitHub Pages from the default
branch, so the units here are **milestones**, newest first, dated by the commits that closed
them. Where a milestone retracted or reverted something, that is recorded too — a changelog that
only lists what worked is a marketing document.

## Pollinators — 2026-08-02

- Insects visit the bed. Occasionally one carries pollen from a plant in the retirement log and
  settles on a flower; drag it onto any bloom to cross it in. No fifth verb — a carrier is a drag
  source like a bloom, resolved through the existing cross path.
- An ignored carrier sometimes turns out to have pollinated the flower it was sitting on,
  producing a seed recorded as a wild cross with honest parentage.
- Carriers reach the keyboard and the screen reader, not only the canvas.
- Fixed: `Origin` was written down twice — a type union and a save-loader whitelist — and had
  already drifted, so a plant restored from the drawer lost its origin on every reload. The
  origins now have one definition and the loader derives from it, which makes the next
  divergence impossible rather than merely detectable.

## Keyboard and screen-reader access — 2026-08-02

- The garden is playable with no pointer. Tab moves, Enter picks up and drops, `C` clones, `R`
  reads the field notebook, Escape cancels.
- The canvas is hidden from assistive technology and a parallel list of buttons carries the bed
  and the tray. Labels obey non-disclosure: a plant is not named until it has finished growing,
  and a seed is never named — verified by mutation at both the unit and the browser layer.
- A plant finishing is announced, and so is the tray discarding its oldest seed, which it has
  always done silently.
- The five verbs were extracted out of the pointer handler so both input paths call one
  implementation rather than two that drift.
- Fixed, in the tests rather than the game: a "not announced twice" control that passed on broken
  code, because it sampled a live region that blanks between announcements instead of counting
  them.

## Deploy gate and performance — 2026-08-01

- The behavioural drivers now gate the deploy. Typecheck, unit tests and a successful build all
  pass on a game that renders nothing and responds to no click, so before this a render
  regression shipped green.
- Fixed: `vite preview` runs with `command === "serve"`, so the config mounted the built site at
  `/` while its own `<script src>` was baked at `/heirloom/`. Every asset returned the SPA index
  fallback with a 200 and the page was blank. Nothing that tests the dev server can see this.
- The gate globs `tools/drive-*.mjs` rather than naming each driver. The enumerated list was
  written before `drive-drawer.mjs` existed and nothing compared it against `package.json`, so
  the drawer shipped live with its driver ungated.
- Performance: the bloom occlusion cull is memoised per plant instead of recomputed every frame.
  It is O(n²) and ran once per plot per frame purely to place a hover ring — 33 ms/frame at 800
  blooms, against a 16.7 ms budget.
- Performance: the accumulated background is rebuilt across frames on a 6 ms budget instead of
  blocking before first paint. Time to interactive with a full history went from ~1792 ms to
  628 ms. The background now fades in over roughly six seconds rather than being complete at
  1.8 s — the same work, spread out.

## Garden capacity — 2026-08-01

- Nine plots, up from six, at full plant size. Depth ordering already paints furthest-first, so
  overlap reads as occlusion; the old minimum plot width had been measured on a flat bed.
- Twelve-seed tray, up from eight, with slot spacing derived from the world width so the row
  cannot run off a narrow screen.
- A drawer over the retirement log: every past plant, filed automatically, reopenable into the
  tray. Thumbnails are grown lazily from the genome that made them.
- Restoring from the drawer adds no false evidence to the notebook — an archive seed carries no
  parents, so it cannot be mistaken for a cross you made.

## Visual depth — 2026-07-31

- The bed has depth and the ground casts a shadow under it.
- Light through the petals, and a horizon behind the bed.
- `#new` starts a fresh garden.

## Hardening — 2026-07-31

- Fixed three defects that only a long session surfaced.
- Phone frame-rate floors re-derived as a population from both machines, after the original
  single-machine thresholds proved unportable.
- **Reverted** two performance changes that measurement showed did not fix anything, and
  retracted one previously recorded defect.

## Motion — 2026-07-30

- The garden moves.
- Performance: 11 fps to 60 fps, and retiring a plant no longer stalls the loop.

## Field notebook — 2026-07-30

- Shows what you have deduced, not what the genome says.
- Fixed: the read gesture was unreachable, and then cancelled itself.

## Deeper genetics — 2026-07-30

- Inflorescence, merosity, linkage, and a recessive lethal.
- Fixed: a third of every umbel was culled before it was drawn.
- Three render defects found by the lookdev contact sheet that no assertion had caught.

## Responsive layout — 2026-07-30

- World geometry derived from the viewport rather than fixed.
- Fixed: the canvas was squashed to a third of its width on a phone.

## Persistence and sharing — 2026-07-30

- Gardens survive a reload, and a garden can be shared by link.
- Multi-page production build and a Pages workflow.

## The accumulating forest — 2026-07-30

- Retired plants composite into the background instead of disappearing.

## The four verbs — 2026-07-30

- Clone, cross, plant, splice.
- Fixed: a destructive drop happened with no warning.

## The genome layer — 2026-07-30

- Eight loci: inherit, mutate, express, serialize.
- The bed grows from real genomes, with a corrected founder distribution.

## Growth spike and render foundation — 2026-07-29

- Tropism-based tip simulation; bloom layout with whorls and golden-angle phyllotaxis.
- Ink line-art on a dark ground: chain grouping, Catmull-Rom smoothing, variable-width outlines,
  petal outlines per shape allele, foliage, calyx, nodding blooms.
- **Rebuilt** the petal primitive and compositing outright after an independent critic pass
  returned 0 of 5.
- Resolved the dark-ink-on-dark-ground contradiction with light-rim linework; killed the halo,
  made rims contrast-relative, and culled occluded blooms.
