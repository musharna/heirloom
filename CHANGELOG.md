# Changelog

Heirloom has no versioned releases. It ships continuously to GitHub Pages from the default
branch, so the units here are **milestones**, newest first, dated by the commits that closed
them. Where a milestone retracted or reverted something, that is recorded too — a changelog that
only lists what worked is a marketing document.

## The clock measures time — 2026-08-04

- Growth, sway, gusts, insects and the recede animation were all driven by a counter that
  advanced a fixed amount **once per animation frame**. Every duration in the game was therefore
  a function of how fast the renderer happened to be: measured, the clock advanced ~1.4 ticks per
  frame at 6.5fps and at 60fps alike, so a plant took ~8.5s to grow on this machine and would
  have taken ~1.65s on one that held 60fps throughout. An animation with no defined length.
- Fixed by measuring elapsed time instead — and it needed **two** rates, not one. The coupling
  had been doing real work by accident: growth is expensive and settled painting is cheap, so
  the frame rate was itself an unintended tempo control, slow while a plant unfurled and fast
  once the bed settled. A single time-based rate reproduces neither end. Motion runs at 84 ticks
  a second, which is the old 1.4 per frame at 60fps exactly, so a settled bed is unchanged;
  growth runs at 17, the average the old clock actually achieved across a full growth span.
- Growth is now **even**, where it used to run at ~71 ticks/s in the first half-second and crawl
  to ~12.4 once the bed reached full complexity. It also stopped stretching itself: slow frames
  used to slow the clock, so the expensive stretch lasted longer than its tick span implied —
  ~7.5s below 30fps before, ~5.0s after, with no change to the renderer at all.
- The carrier gate was `SPEED / CARRIER_INTERVAL_TICKS`, a per-frame probability with the same
  defect, so pollinators arrived at whatever rate the machine drew at. Gated on elapsed ticks now.
- Pausing on a hidden tab is handled on `visibilitychange`, **not** by the frame cap. The
  tempting cap of ~100ms would have been wrong and measurably so: a growing bed's frames are
  154ms, so it would have throttled the clock on exactly the machine and moment this change
  exists to fix. A duration cannot tell an unrendered tab from a slow frame; the browser says
  which it is. The cap remains at 250ms as a backstop for stalls the event does not cover.
- All 37 uses of the old clock in `garden.ts` were classified as growth or motion **against the
  compiler**, by renaming the variable so every site became a build error, rather than by eye.
- `tools/check-clock.mjs` is the new gate, and it runs in CI where `check-phone.mjs` does not:
  what it asserts is portable, because a clock that measures time keeps its rate in ticks per
  second on any machine. Its stronger second assertion — that the rate survives a change of
  frame rate — searches for a usable CPU throttle and says SKIP out loud if the machine has no
  headroom, rather than passing quietly.
- The 436 existing tests all passed against the broken clock and against the fix alike, which is
  the whole reason the new gate had to be seen failing before it was trusted. Both it and the
  unit tests were run against a deliberately reverted, frame-counted clock and confirmed to fail
  for the stated reason, with their controls still passing.

## Garden sharing — 2026-08-02

- `#garden=` opens a **visit**: someone else's bed and the forest behind it, read-only, frozen at
  the moment they shared it. Growth is pinned and motion still runs — two clocks, and only one of
  them stops. A live visit would drift away from the garden it was sent from; a still one would
  be the only motionless screen in the game.
- A new page, `/visit/`, rather than a `visiting` flag inside the garden. Read-only is a property
  of the module graph: the visit does not import the four verbs, the save writer, or the
  pollinators, so no guard can be forgotten in one of six places. `test/visit-isolation.test.ts`
  walks the transitive import graph and names the offending path if one ever appears.
- A codec, `src/game/postcard.ts`, packs a whole garden into a URL fragment: the sender's world
  size and plot count, each occupied plot with its index, genome and age, and the forest to the
  depth that actually renders. 708 bytes at most, ~944 characters, and nothing leaves the browser.
  Empty plots are transmitted as an absence rather than a sentinel genome — every bit pattern is a
  legal genome, so a "zero genome" placeholder would have decoded to a real white flower.
- **Copy a link to this garden** at the head of the drawer, which is already the garden's history.
- The genome bit layout now has one definition, shared by the single-flower codec and the
  postcard. Two copies would have decoded each other's genomes into different, perfectly valid,
  checksum-passing flowers.
- The draw half of the garden's frame loop is extracted to `src/scene.ts`, so both pages paint
  through one renderer rather than two that drift.
- Fixed: `npm run drive` still named all seven drivers by hand while CI had already moved to a
  glob — the two lists that this project's deploy gate exists because of. Both derive from the
  directory now. The runner is named `run-drivers.mjs`, outside the `drive-*` glob, because a
  runner that matched it would have been executed as a driver too, double-running the whole suite
  silently.
- Fixed: `visit/` was never in `tsconfig`'s include list, so `tsc --noEmit` — the first half of
  `npm run build` — had been skipping a production entry point since the page was added. Found
  while deliberately sabotaging `visit.ts` to watch a control fail, and noticing the sabotage was
  not typechecked either.
- Four checks prescribed by the design documents **could not fail**, and were replaced rather than
  kept: a frozen-growth control that compared genomes (which do not change with age), a
  paint-order check that diffed a render seeded from the wall clock, a module-graph check that
  was a grep of one file, and a decoder that dropped malformed input silently. The full list, with
  why each was wrong, is recorded in the design and plan documents under "Corrected during
  implementation".

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
