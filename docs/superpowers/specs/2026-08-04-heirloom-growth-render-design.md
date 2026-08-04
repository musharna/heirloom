# Smooth growth — design

**Goal:** a plant should grow at the frame rate the rest of the game runs at. Today the bed drops
to ~6.5fps for roughly 8 seconds after every planting, and it is the most visible flaw left in a
game that is otherwise finished.

**Architecture:** stop repainting a plant from scratch on every frame of its growth. Keep one
offscreen layer per drawing pass so new growth is added to the right layer instead of forcing a
full redraw, and give each flower its own small bitmap so the opening animation becomes a scaled
blit rather than a petal repaint.

**Tech stack:** unchanged — TypeScript, canvas 2D, Vite, vitest, Playwright drivers.

---

## 1. Why, in numbers

Everything here was measured on 2026-08-04 against the live build. The full record, including the
approaches these numbers killed, is §27 of `2026-07-29-heirloom-modern-seed-design.md`.

| what                       | measurement                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| growth-phase frame rate    | 5.6fps at the worst pinned tick; 6.5–7.9fps worst free-running bucket; ~5.0s below 30fps per planting |
| settled frame rate         | 60.1–60.4fps                                                                                          |
| frame budget during growth | 170.6ms script in a 179.1ms frame (95%)                                                               |
| where it goes              | `fill` 41.7%, `petalPath` 14.7%, `lineTo` 5.7%, `buildOutline` 1.7%                                   |
| flowers vs stems           | flowers cost ~5x stems (29.4% vs 5.4% inclusive)                                                      |

The finding that isolates the cause: **at growth tick 100 the bed runs at 8.3fps and at tick 140
it runs at 60.4fps with the identical 366 blooms on screen.** Same geometry, same scene. The only
thing that changes is `untilTick < settledTick` flipping in `paintPlantCached`
(`src/render/cache.ts:61`). The cost is the uncached path, not scene complexity.

### Approaches these measurements ruled out

- **Reduce petal path samples.** `petalPath(spec, samples = 96)` uses 96 samples for every petal
  regardless of size, and the median petal is 4.21px **wide**. Causal, but measured at
  **1.23–1.50x** with a 6x sample cut — `fill` is rasterisation-bound, not path-complexity-bound.
  A size-proportional version would be less, since large petals keep their samples. Real, and
  nowhere near the ~10x needed.
- **Cache the stems pass, repaint flowers live.** Structurally the soundest split, since
  `paintPlant` draws stems before flowers. Worth **~6.5% of the frame.**
- **Lower resolution / draw every other frame.** Already measured and reverted in §24.
- **Rebuild the cache periodically.** A plant stale by even a few ticks is far from that frame's
  true paint, which the fidelity bar below forbids.

## 2. The fidelity bar

**Growth frames must be no further from a direct paint than settled plants already are through
`paintPlantCached`, measured with the same instrument.**

This is not a budget chosen to fit the implementation. Compositing through an offscreen surface
costs up to **3/255 on ~11% of channels** — measured with a control that routes the _same_
drawing through one intermediate canvas with no pass-splitting at all, so the cost is intrinsic to
8-bit premultiplied compositing rather than to this architecture. Splitting into three pass layers
adds ~1.5 percentage points on top.

Pixel-identical is therefore impossible for any design here, and sway forces the issue: a plant
must be painted at rest and sheared as a blit, so there is no version that accumulates directly on
the live canvas. `paintPlantCached` already pays this cost for every settled plant, and that
shipped and was accepted.

**The opening animation is the one deliberate relaxation.** A flower mid-opening is painted from
its own bitmap rather than re-derived, so it carries resampling error the rest of the plant does
not. It was reviewed visually before being accepted: three bloom archetypes spanning the measured
population (3 petals — the mode at 48%; 12 — upper quartile; 27 — the doubled tail) at opening 0.32
and 1.00, magnified 9x nearest-neighbour over a common backdrop. Worst single pixel 21–56/255, and
the two arms were indistinguishable by eye at every archetype. The relaxation applies only while a
flower is opening — `OPEN_TICKS = 26` ticks, ~1.5s — and never to a settled plant.

## 3. Architecture

### 3.1 What is safe to cache, and why

`paintPlant` (`src/render/stage.ts:363`) is **five global passes**, not one traversal: stems
(depth-sorted, deepest first), leaves, all bloom halos, all petals, all centres. The pass
boundaries are load-bearing and each is a recorded bug fix — interleaving halos with petals erased
ink contours, and drawing each centre after its own petals let the next bloom bury it.

Two properties make incremental caching sound:

1. **Source-over compositing is associative.** Drawing a pass into a transparent layer and
   compositing it is equivalent to drawing it directly, up to the 8-bit quantisation priced above.
   One layer per pass therefore preserves the global pass order exactly, which appending into a
   single bitmap would destroy.
2. **The drawn bloom set is append-only.** `cullOccludedBlooms` (`src/render/stage.ts:161`) is
   greedy over its input array, so each bloom's keep/drop decision depends only on blooms _before_
   it. Its input is `plant.blooms` filtered by tick, which preserves order. And `plant.blooms`,
   `plant.segments` and `plant.leaves` are all emitted in non-decreasing tick order by the growth
   loop (`src/growth/sim.ts:280`) — verified empirically across 200 random genomes. So a bloom,
   once drawn, is never dropped as growth continues, and later blooms only ever append.

Without (2), a bloom could vanish from the kept set as growth added a neighbour, and every baked
layer would be wrong. It is the load-bearing fact of this design.

### 3.2 The layers

Per plant, five offscreen layers matching the five passes. Each frame:

1. Advance to `untilTick`. Determine what is newly visible since the last update — segments,
   leaves and blooms whose tick falls in `(lastTick, untilTick]`.
2. Draw only those new items into their own layers.
3. Composite the five layers in pass order onto the target.

A chain that is still growing cannot be appended to, because its outline is rebuilt from the whole
smoothed chain and re-drawing it would double-paint. Chains are therefore split: a chain whose last
segment tick has passed is **terminated** and baked; a chain still growing is drawn live each frame
into a sixth, transient layer that is cleared every frame and composited at the stem layer's
position.

**The live stem set is NOT negligible at the moment it matters, and the plan must not assume it
is.** A first pass at this spec claimed growing chains fall to zero before the bloom cost peaks;
the measurement says otherwise. Counting chains whose last segment tick has not yet passed, across
six plants: 543 at tick 50, 326 at 60, 100 at 70, 21 at 80, 0 at 90 — against the bloom peak at
tick 70. They overlap. That count is also an over-estimate, because it includes chains that have
not started yet and so are not drawn, which means **the true live-stem cost is unmeasured**.
Stems are only ~5.4% of the frame, so this is unlikely to dominate, but the implementation must
measure the live stem set directly rather than inherit either number here.

### 3.3 Opening flowers

A flower's opening animation is `ctx.scale(o, o * squash)` about its own centre with fixed
geometry underneath (`withBloomTransform` in `src/render/stage.ts`). So:

- When a bloom first becomes visible, paint it once into a small per-bloom bitmap at scale 1.
- While it is opening, blit that bitmap with the same transform instead of repainting its petals.
- Once `untilTick - b.tick >= OPEN_TICKS` the bloom is final: bake it into the shared petal layer
  and drop its per-bloom bitmap.

This is what converts the dominant cost. At the worst moment 265 of 389 drawn blooms are
mid-animation (68%), and through most of growth it is 68–100%; those stop being vector repaints.

Halos and centres follow the same rule in their own layers, so the global order — all halos under
all petals, all centres above them — is preserved for opening and settled blooms alike.

### 3.4 Settled plants

Unchanged. Once a plant passes `settledTick(maxTick)` it uses the existing `paintPlantCached`
path. The layers are released at that point; nothing about the settled render moves.

## 4. Files

- **Create `src/render/growing.ts`** — the layered growth cache. Owns the per-pass layers, the
  per-bloom bitmaps, the incremental update, and the composite. One responsibility: draw a plant
  that is still changing.
- **Modify `src/render/cache.ts`** — `paintPlantCached` currently falls straight through to
  `paintPlant` below the settle tick (`:61`). It routes to `growing.ts` instead. Its signature does
  not change, so `src/scene.ts` is untouched.
- **Modify `src/render/stage.ts`** — extract the per-pass bodies of `paintPlant` so both the
  monolithic painter and the layered one call the same drawing code. `paintPlant` must keep working
  unchanged: it is what `forest.retire` composites with and what the lookdev sheet calls.
- **Create `test/growing.test.ts`** — unit coverage for the append-only and ordering invariants.
- **Create `tools/check-growth.mjs`** — the frame-rate and fidelity gate.

Extraction is the risk point in `stage.ts`. The passes share `opening()`, the culled bloom list and
`withBloomTransform`; those become parameters rather than closures, and the refactor must be
pixel-neutral on its own before any caching is added.

## 5. Verification

**The existing suite cannot catch a regression here.** 443 tests pass against both the current
renderer and, as the clock work demonstrated, against a broken version of the thing under test. So:

- **Fidelity, settled:** a settled plant painted through the new path must match one painted
  through `paintPlant` within the compositing floor (max 3/255). The instrument is the
  render-layer A/B harness that measured a 0.000 noise floor on the petal-shading work.
- **Fidelity, growing:** same comparison at a sweep of growth ticks. The opening-bloom relaxation
  means the bound there is the measured 21–56/255 worst pixel, asserted as a ceiling.
- **Ordering:** an explicit test that a bloom present at tick T is still present at every tick
  after T, across many random genomes. This is §3.1(2) and the design fails without it.
- **Performance:** `tools/check-growth.mjs` asserts the growth phase clears the same 30fps floor
  `tools/check-motion.mjs` already asserts for the settled bed (`:139`), measured with the growth
  clock pinned so the check does not depend on how fast the machine happens to grow.
- **Motion:** growth captured as a frame sequence both ways and compared at 1x, unmagnified. The
  visual review that approved the opening relaxation was static, and motion is the one thing a
  still comparison cannot answer.
- **Every gate must be seen failing** against a deliberately broken version before it is trusted,
  and each negative assertion needs a positive control in the same test.

## 6. Risks

- **The refactor of `paintPlant` is the largest risk**, not the caching. It touches the one
  function that decides what the game looks like. Mitigation: land the extraction as its own
  change, proven pixel-neutral, before any layer exists.
- **Memory.** Five layers plus up to a few hundred small bitmaps per growing plant, times six
  plants. Bitmaps are released as blooms settle, and layers are released at the settle tick, but
  the peak needs measuring on the phone profile (`tools/check-phone.mjs`), not assumed.
- **An unexplained measurement.** Supersampling the per-bloom bitmaps did not reduce error
  monotonically — S=3 and S=6 behaved unlike S=1, 2, 4. The design does not depend on
  supersampling, so this is not blocking, but it means the resampling behaviour is not fully
  understood and the visual review, not the numbers, is what accepted this trade.
- **Untested at scale and at dpr.** The visual review was one bloom at a time at dpr 1. The real
  case is ~265 at once at dpr up to 2.6. The motion check above covers this; if it fails, the
  fallback is the animation-timing lever — shortening `OPEN_TICKS` or staggering bloom ticks so
  fewer flowers animate at once, which costs no fidelity at all but changes how coming-into-flower
  looks.

## 7. Non-goals

- Changing what a plant looks like when settled.
- Changing growth timing, tempo or the opening curve. The clock work of 2026-08-04 set those
  deliberately and this design must not move them.
- Speeding up `forest.retire`, `paintThumb` or the visit page. All are one-shot, not per-frame.
- Reducing bloom counts or petal geometry. That is content, not rendering.
