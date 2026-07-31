# Heirloom — a modernized _Seed_ — design

> Status: approved 2026-07-29. Working title "Heirloom" is easily renamed.

## 1. Context

[_Seed_](https://www.noio.nl/2007/12/seed/) (noio / Thomas van den Berg, December 2007) was a Flash
toy-game about breeding flowers. Its history matters to this design:

- It began as a **screensaver** — draw a few branches with bezier curves and varying branch widths,
  spawn flowers, repeat, and let older flowers fade into the background so an ever-growing forest
  accumulates.
- It rendered to `bitmapData` rather than vectors, for performance.
- The game emerged from one observation, in the author's words: _"the variables for different flowers
  could easily be averaged, creating the cross-breed of two flowers."_ A flower was a numeric genome.
- Interaction: click a flower to clone it, drag one flower onto another to crossbreed (the child
  spawns into a free patch of dirt). Seeds were physical objects you dragged to plant or splice.
  Mutation drifted lineages over generations. Flowers serialized to a shareable string.

Its enduring quality is **restraint**: one screen, no menus, no goals, no failure, endless drift —
and a background that silently becomes a portrait of everything you ever bred.

### Relationship to prior work

The user has an existing 3D flower-breeding project at `~/flower` (three.js, Mendelian genetics
engine, last commit 2026-06-13, no remote). It is **deliberately out of scope**: the user chose to
start de novo, with no code or genetics ported. It is referenced here only for one transferable
lesson — that project accumulated four consecutive critic-gated failures pursuing photoreal
procedural rose petals, and the recorded lesson was to judge pixels from the _real_ pipeline rather
than from an isolated approximation. That lesson shapes Milestone 1 below.

## 2. Goal and locked decisions

Build a browser game that keeps _Seed_'s soul and modernizes exactly three things: the genetics, the
rendering, and shareability. Each decision below was chosen explicitly, with the rationale recorded
so a later reader knows what was traded away.

| Decision      | Choice                                      | Rationale                                                                                                                                                                                                                        |
| ------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codebase      | De novo, standalone                         | User's call. No dependency on or port from `~/flower`.                                                                                                                                                                           |
| Scope         | Same soul, deeper genetics                  | One canvas, no menus, no win condition, endless drift. Modernize genetics + rendering + sharing only. Adding goals risks destroying what made _Seed_ memorable.                                                                  |
| Gene model    | Two-layer: genotype → growth program        | Alleles at named loci (plus polygenic blocks) resolve to a parameter set, which drives a developmental growth program. Buys Mendelian surprise _and_ emergent morphology. Costs one layer of indirection.                        |
| World         | One screen, accumulating background         | Fixed viewport, a handful of foreground plots; retiring flowers composite into a persistent background layer that densifies over time. Zero navigation UI, and the background becomes a record of the player's breeding history. |
| Art direction | Refined ink line-art on dark ground         | Tapered bezier strokes, layered petal shapes, muted-saturated colour, soft bloom, depth-of-field on background layers. The one style where procedural generation is a strength rather than a fight.                              |
| Growth engine | Tropism-based agent growth                  | Growing tips step, bend under tropisms, branch stochastically, terminate in a bloom. Growth animation _is_ the simulation (one system, not a replay layer), and genes read as behaviours rather than as static angles.           |
| Platform      | Browser; TypeScript + Vite; no UI framework | There is almost no UI; a framework would be pure overhead.                                                                                                                                                                       |
| Rendering API | Canvas2D + offscreen accumulation buffer    | This is the original's `bitmapData` trick and remains the correct tool: the background forest costs one texture instead of thousands of live objects. WebGL only if the Milestone 1 spike proves it necessary.                   |

## 3. Architecture

One-way pipeline. Each stage is independently testable, and the renderer never reads a genome.

```
Genome ──express()──▶ Phenotype ──sim(seed)──▶ primitives ──Canvas2D──▶ screen
   │                                                             │
   └── inherit(A,B) + mutate ──▶ child Genome        retire ──▶ accumulation buffer
```

### Modules

- **`genome/`** — the genotype layer.
  - `loci.ts` — the gene registry: locus names, allele sets, dominance relations, which phenotype
    field each feeds. Single source of truth; everything else derives from it.
  - `genome.ts` — a `Genome` is diploid: two alleles per discrete locus, plus polygenic blocks
    (fixed-length arrays of `+`/`−` small-effect elements, one array per quantitative trait).
  - `inherit.ts` — meiosis. Independent assortment per discrete locus (one allele drawn from each
    parent); polygenic blocks recombine element-wise. Returns a child `Genome`.
  - `mutate.ts` — low per-allele mutation rate. Pigment mutation is **loss-biased** (loss of
    function is far likelier than gain in real pigment pathways), so pale/white recurs naturally
    without being authored.
  - `serialize.ts` — `Genome` ↔ compact URL-safe string, versioned.
- **`phenotype/`** — `express.ts` is a pure function `Genome → Phenotype`: applies per-locus
  dominance, sums polygenic blocks, then applies **epistasis** (see §5). `Phenotype` is a flat
  struct of numbers and enums — tropism weights, branching parameters, taper, bloom parameters. It
  contains no genetic concepts, so the growth engine cannot accidentally depend on the gene model.
- **`growth/`** — the simulation.
  - `agent.ts` — a growing tip: position, direction, width, age, depth, remaining vigour.
  - `sim.ts` — steps every live tip per tick (see §6). Emits drawable primitives incrementally.
  - `bloom.ts` — given a terminated tip and the phenotype, lays out petals and emits their shapes.
- **`render/`** — Canvas2D.
  - `strokes.ts` — takes the polyline of per-tick segments emitted by the sim (§6), smooths it
    (Catmull-Rom through the tick points), and fills the resulting variable-width outline polygon.
    Varying width is the original's signature move; a constant-width `lineTo` will not read
    correctly. Note the curve is _emergent from the growth path_, not authored as cubic bezier
    control points — the implementer fits nothing.
  - `stage.ts` — three layers: background accumulation buffer, mid-ground recently-retired plants,
    live foreground plants. Compositing, vignette, soft bloom.
  - `accumulate.ts` — retirement: composite a plant once into the background buffer at reduced
    contrast, blurred, and colour-mixed toward the background hue, so successive generations recede.
- **`game/`** — `garden.ts` (plots, occupancy, ages, retirement policy), `seeds.ts` (the seed tray),
  `actions.ts` (the four verbs), `persist.ts` (localStorage).
- **`ui/`** — seed tray strip, hover/inspect readout, share button. No menus, no modal dialogs.

## 4. Interaction — the four verbs

All direct manipulation. No buttons drive gameplay.

| Verb   | Gesture                       | Effect                                                                      |
| ------ | ----------------------------- | --------------------------------------------------------------------------- |
| Clone  | click a bloom                 | Produces a seed of that genome, with mutation applied.                      |
| Cross  | drag bloom A onto bloom B     | Produces a child seed from `inherit(A, B)` + mutation.                      |
| Plant  | drag a seed onto a plot       | Seed germinates; the plant grows on screen, revealing its traits over time. |
| Splice | drag a seed onto another seed | Crosses two genomes without planting either.                                |

Traits are **not** disclosed before bloom. The reveal-by-growing is the pacing mechanism.

## 5. Genetics content

Eight loci, chosen so that each contributes a _different kind_ of surprise rather than more of the
same. Deliberately small; extending is cheap, and an over-large gene set makes nothing legible.

| Locus         | Symbol | Kind                | Alleles                                                 | Inheritance            | Effect                                                                                              |
| ------------- | ------ | ------------------- | ------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------- |
| Pigment block | `W`    | discrete            | `W` (block), `w` (permit)                               | `W` dominant           | `W_` → no anthocyanin; flower reads white/cream **regardless of hue loci**. `ww` → hue expressed.   |
| Hue A         | `H1`   | discrete, dosage    | `H1`, `h1`                                              | additive dosage        | Contributes to hue class.                                                                           |
| Hue B         | `H2`   | discrete, dosage    | `H2`, `h2`                                              | additive dosage        | Contributes to hue class.                                                                           |
| Doubling      | `D`    | discrete            | `D` (single), `d` (double)                              | `d` recessive          | `dd` → stamens convert to petals (ABC-model behaviour): petal count multiplies, stamen ring absent. |
| Petal shape   | `P`    | allele series       | `P^f` frilled > `P^l` lobed > `P^p` pointed > `p` round | hierarchical dominance | Selects the petal outline control points.                                                           |
| Vigour        | `V*`   | polygenic block (6) | `+` / `−`                                               | additive               | Internode length and total growth ticks → reaching vs compact.                                      |
| Droop         | `G*`   | polygenic block (6) | `+` / `−`                                               | additive               | Gravitropism weight → weeping vs upright. Reads as behaviour _while growing_.                       |
| Branchiness   | `B*`   | polygenic block (6) | `+` / `−`                                               | additive               | Branch probability per tick.                                                                        |

This yields four distinct surprise types from eight loci:

1. **Hidden recessive** — `Dd` singles carrying doubling; `dd` appears unannounced a generation later.
2. **Masking (epistasis)** — the headline mechanic. A white `W_` flower conceals whatever hue genes
   it carries, so **white × white can throw colour** when the two whites carry different hidden
   hues. Real biology, and the best "gasp" available for the cost.
3. **Dosage** — `H1`/`H2` give five discrete hue classes across combined dosage 0–4.
4. **Continuous drift** — the three polygenic blocks move habit gradually across generations.

Hue is deliberately **discrete (five classes)** rather than continuous: discrete classes make
Mendelian inheritance _visible_, which is the entire point of choosing a two-layer gene model. A
continuous hue would smear segregation into indistinguishable near-misses.

## 6. Growth simulation

A tip carries `{ pos, dir, width, age, depth, vigourLeft }`. Per tick, for each live tip:

1. **Step** — advance `pos` along `dir` by a step length scaled from vigour and depth.
2. **Tropisms** — rotate `dir` by the weighted sum of gravitropism (toward down), phototropism
   (toward the light direction), and a stiffness term that damps change. Weights come from the
   phenotype, so a lineage's _habit_ is genetic.
3. **Taper** — multiply `width` by the taper factor.
4. **Branch** — with the phenotype's branch probability (attenuated by depth), spawn a child tip at
   ±`branchAngle` with reduced width and `depth + 1`.
5. **Terminate** — when `width` falls below the minimum or `vigourLeft` is exhausted, emit a bloom
   at the tip via `bloom.ts`.

Each tick emits one `StrokeSegment` per live tip: `{ x0, y0, x1, y1, w0, w1, depth }`. Bloom layout
uses whorls (1 for singles, 3–5 for `dd`), golden-angle phyllotaxis (137.5°) with a per-whorl phase
offset, petal outlines from the `P` allele, and colour from the hue class with a depth-driven ramp so
inner petals read darker.

**Determinism** is a hard requirement: the growth RNG is seeded from a hash of **the genome alone**,
so one genome has exactly one canonical plant — a shared link reproduces the same plant for everybody,
and a lineage stays visually recognizable across generations. The plot index must **not** feed the
growth RNG: if it did, the same genome would grow differently per plot and both properties would
break. The cost is that two copies of one genome would render identically, so per-plot variety comes
from **presentation only** — slight scale, horizontal mirror, and lean — applied after growth and
deliberately outside the genome-determined structure.

## 7. Persistence and sharing

- **Save (localStorage):** genomes and ages of live plants with their plot assignments, the seed
  tray's genomes, and a capped replay list of retired genomes and their seeds. The background buffer
  is **regenerated from the replay list on load**, not stored as an image — smaller, and it survives
  a change in render parameters.
- **Share:** a versioned byte-packing of the genome, base64url-encoded. Eight loci pack into a dozen
  or so bytes, i.e. a short link.

## 8. Milestones

1. **Spike — render and judge the real growth engine.** Hard-coded phenotypes → grown plants →
   inspect actual output and iterate art direction against it. **DONE; the critic gate was retired
   on 2026-07-30 — see §13.** Leaves were pulled into this milestone on 2026-07-29.
2. **Genome logic, TDD** — `loci`, `genome`, `inherit`, `mutate`, `express`, `serialize`. Pure, no
   rendering. **DONE 2026-07-30 — see §14.**
3. **Wiring** — genes → growth; garden plots; the four verbs. **DONE 2026-07-30 — see §15.**
   grows from `express(genome)` seeded by `genomeSeed(genome)`. The four verbs are not built.\_
4. **Accumulation** — retirement, background compositing, depth-of-field. **DONE 2026-07-30 — see §16.**
5. **Sharing and persistence** — URL round-trip, localStorage. **DONE 2026-07-30 — see §17.**

Milestone 1 first is not incidental: it front-loads the only risk that can invalidate the whole
visual premise.

## 9. Testing

Pure logic under **vitest** (chosen over `node --test` because §2 fixes the stack as TypeScript + Vite, and vitest executes TS directly with no separate build or loader step):

- Segregation ratios over N crosses (statistical, with a fixed seed).
- `serialize` round-trip for randomly generated genomes.
- Epistasis truth table: every `W`/hue combination maps to the expected visible colour.
- Growth determinism: identical `(phenotype, seed)` produces an identical stroke list.

Then a Playwright canvas-hash smoke test to catch render regressions.

Two controls are mandatory, per the project's real-execution doctrine:

- The segregation test must first be **run against a deliberately broken `inherit`** (e.g. one that
  always takes parent A's allele) and confirmed to fail _for the stated reason_. A test never seen
  failing is not evidence.
- The epistasis test carries a **positive control** asserting that coloured × coloured still yields
  colour, inside the same test. Otherwise a broken harness that produces white unconditionally would
  read as "masking works".

## 10. Error handling

There is no network and no external system, so the surface is small. The one untrusted input is a
**shared genome URL**: validate the version tag, the locus set, and allele legality, then reject
visibly (a toast naming what failed) rather than silently substituting defaults. Fails loud.

## 11. Non-goals

No 3D. No score, goals, progression, or unlocks. No seasons or plant death pressure — the original's
tone is pressure-free. No multiplayer or server. No sound in the initial build. No UI framework. No
port of `~/flower`.

## 12. Known risks

- **Tropism tuning.** Agent growth is not guaranteed to produce _pretty_ plants; it needs tuning.
  Milestone 1 exists to discover this early rather than after the game is wired.
- **Gene-set size.** Eight loci may prove too few to keep breeding interesting for long. Cheap to
  extend, so starting small is the right bet.
- **Background muddiness.** Many accumulated layers could converge to grey soup. Mitigation:
  colour-mix each retirement toward a single background hue and cap the number of composited layers.

## 13. Milestone 1 outcome — and why the critic gate was retired

**Status: Milestone 1 complete. The five-criterion critic gate is RETIRED and must not be
reinstated without the user's explicit say-so.**

### What happened

Four independent critic rounds were run (reports in the job tmp dir, summarised below). All
four returned **0 of 5 criteria PASS**. Each round nonetheless found real, pixel-measured
defects, and each was fixed at its cause:

| Round | Headline defect                                                           | Fix                                                                                                                                                                      |
| ----- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Petals were rounded squares in a pinwheel — measured aspect **1.05**      | Obovate profile; width set as a fraction of length                                                                                                                       |
| 2     | `lobed` petals were axis-aligned stair-steps detached from the receptacle | Amplitude envelope fading to zero at base and apex; 96 samples                                                                                                           |
| 3     | "No ink contour on anything"                                              | Traced to a **contradiction in the art direction**: dark ink on a near-black ground is invisible by construction. The contour was rendering at 1px and could not be seen |
| 4     | Light rim "reads as glow, not linework"                                   | The 1px rim was drowned by an 18–27px halo whose area equalled the whole drawn plant                                                                                     |

### Why it was retired

The user retired the gate on 2026-07-30, unconvinced it was working. On inspection that was
correct, and the provenance is the reason:

- The **idea** of an independent visual critic comes from the user's own doctrine
  (`CLAUDE.md`, `feedback_independent_critic_gate.md`) and remains sound.
- The **five criteria did not.** They were authored in the implementation plan
  (`2026-07-29-heirloom-m1-growth-spike.md:1542-1546`) by the same agent doing the work, and
  were never reviewed by the user — the spec's own bar was only the phrase "until this looks
  good".
- They were **tightened mid-loop, against the work**: "terminating into the ground" was added
  to criterion 2 during round 3, and "does every bloom have a visible centre" to criterion 3
  during round 4. Both became FAIL reasons in the very round they were introduced.
- They are **all-or-nothing across twelve panels**, so one bad panel zeroes a criterion. At the
  final 0/5, 7 of 12 panels read as plants and 7 of 11 axes passed — the score did not track
  the state of the work.

**Lesson for later milestones:** an independent critic is valuable for _finding_ defects in
rendered output and should keep being used that way. It is not valuable as a pass/fail gate
when the rubric is self-authored, unreviewed, and mutable. Judge with the critic; decide with
the user.

### Final state of the spike

Twelve phenotype panels, one shared seed, exactly one parameter varied per panel. Contour
lines are chosen by **contrast with their own fill** (light rim on mid-tone fills, dark rim on
the pale white morph — a fixed-lightness rim provably cannot draw both). Glow radius and alpha
cut hard so linework survives. Occluded blooms are culled, which fixed centre "bead chains" and
opened the canopy so branch geometry reads. Ground is an irregular lit crest, not a flat bar.
73 tests; `tsc --noEmit` clean on TypeScript 7.

### Known residual defects (backlog, not blockers)

> **Superseded 2026-07-30 by §19.** Entries 1 and 2 were RETRACTED on measurement — already
> fixed, and carried forward unverified for three sessions. The rest were addressed.

1. Stem outline jitters — width oscillates up to ±33% of local width between adjacent rows,
   because outlines are built per-tick rather than as one continuous smoothed path.
2. Back-row petals inside a dense bloom still read as rounded quadrilaterals.
3. Petal fills are flat — no intra-petal shading, so a single bloom has limited depth.
4. Foliage is sparse relative to flower area, and leaf blades are identical stamps.
5. Colour is vivid rather than muted-saturated; hue variants hold identical S and V, so `blue`
   reads slightly electric.

## 14. Milestone 2 outcome — the genome layer

Built 2026-07-30 at `7996ae5`, wired into the garden at `33feb9a`. 123 tests, `tsc --noEmit`
clean. Files: `src/genome/{loci,genome,express,serialize}.ts`.

Both §9 controls are **in-suite and machine-checked**, not one-time manual observations. The
segregation assertion is pointed at two deliberately broken `inherit`s and must reject both — and
it matches the failure **message** rather than using a bare `.toThrow()`, which any `TypeError`
from a mis-shaped fixture would satisfy. The epistasis test carries its coloured × coloured
positive control inline. Six mutants (always-white, inverted dominance, dropped hue locus,
dominant-not-recessive doubling, no checksum, skipped version check) were all killed.

### What the tests could not see

The genome layer passed 115 unit tests and then produced **seven near-identical white plants** the
moment it drove the real renderer. Two separate defects, both properties of a **distribution**
while every test asserted only reachability:

- `W` is dominant, so a uniform allele frequency masks 3/4 of the population.
- A polygenic block of twelve fair coins is a binomial concentrated on dosage 6 (sd 1.7 of a 0..12
  range), so every founder got the same mid-range habit.

Founder frequencies are now explicit and derived rather than assumed. `W` sits at 0.08. The `P`
weights are solved backwards from wanting all four shapes equally often, because a **dominance
series does not give equal shapes from equal frequencies** — the top allele shows whenever either
copy carries it. Each polygenic block draws one frequency per founder and then its loci at that
frequency, making marginal dosage exactly uniform over 0..12 (a beta(1,1)-binomial).

That is a claim about **founders only**. `inherit` still mixes blocks locus-by-locus, so a
breeding population drifts back toward a normal distribution — which is correct, and is what will
make selection feel like it is doing something.

**The transferable lesson:** a reachability test ("all five hue classes appear over 400 draws")
passes while the distribution is unusable. Where the visible property IS the distribution, assert
the distribution — and pair each such assertion with a control pointed at the generator that
produced the bad output, so it cannot quietly stop discriminating. Eight such tests now exist.

### Deferred

`mutate` and `inherit` are correct but **unreached by any verb** — nothing in the UI breeds yet.
Milestone 3 (the four verbs) is what exercises them against a player.

## 15. Milestone 3 outcome — the four verbs

Built 2026-07-30 at `c36bd78`. 151 tests, `tsc --noEmit` clean. Files: `src/game/{garden,hit}.ts`,
a rewritten `garden/garden.ts`, and `tools/drive-verbs.mjs`.

All four verbs of §4 are live. Which one fires is decided on RELEASE, from travel distance and
what sits under the pointer — deciding on press would commit to a clone before knowing whether a
cross was starting.

State and hit-testing are pure and canvas-free, so the verbs are unit-testable without a DOM.
`shownBlooms()` runs the **same occlusion cull as the renderer**, so the player can never click a
flower that is not on screen.

### Decisions taken here, with their rationale

- **Dropping onto an occupied plot retires the occupant** rather than refusing. Refusing lets the
  bed fill up permanently after six plants, and §11 rules out the alternative valve (death on a
  timer). The displaced genome lands in `retired` — exactly Milestone 4's input. Because this is
  the only destructive verb, the target ring turns **amber** and the hint says REPLACE.
- **The tray evicts its oldest seed at capacity** instead of refusing a new one. §11 fixes the
  tone as pressure-free; a full tray that rejects a cross turns a click into a failure state.
- **`plotAt` derives its reach from the widest gap between adjacent plots**, not a constant. A
  fixed 95px radius cannot tell "dropped between two plots" from "dropped nowhere near the
  garden": at 200px spacing it opened a 10px dead band in every gap where a drop silently did
  nothing. Both the fix and a control pinning the old behaviour are in the suite.

### The harness lesson (worth more than the feature)

A mutation run over the verb driver reported `clone disabled → 3 checks failed` and then
`cross/plant/splice disabled → 0 checks failed`, which read as three surviving mutants. All three
results were **meaningless**: the revert step had reset an uncommitted file, so the driver crashed
on startup and printed nothing, and `grep -c '^FAIL'` counts zero for a crash exactly as it does
for a pass.

**A harness that reports "0 failures" must first prove it RAN.** The fixed version requires a
sentinel line from the driver before it will trust a count, and runs an unmutated baseline first.
Re-run that way, all five mutants (including `CLICK_SLOP = 0`) were killed.

Second lesson, same incident: `git checkout -- <file>` reverts to the **committed** state, which
for a file rewritten but not yet committed means discarding the whole rewrite. Commit before
mutating, always.

### Deferred

Retired genomes accumulate in `garden.retired` and are never drawn — that is Milestone 4. Nothing
persists across a reload, and the share codes are shown but not yet in the URL (Milestone 5).

## 16. Milestone 4 outcome — the accumulating forest

Built 2026-07-30. 163 tests, `tsc --noEmit` clean. Files: `src/render/{forest,accumulate}.ts`.

A plant displaced from a plot is composited ONCE into an offscreen buffer and then exists only
as pixels — the original's `bitmapData` trick. Keeping retired plants as live objects would mean
re-rendering thousands of stroke outlines every frame after an hour of play; here the entire
history costs one `drawImage` regardless of its size. The trade is that a composited plant can
never change again, which is exactly what "retired" means.

**Depth without a z-order.** Each retirement washes the whole buffer once toward the ground
colour (`source-atop`, so only existing pixels are touched) and then draws itself at full
strength on top. Depth then falls out of how many retirements have happened since — one
`fillRect` instead of N re-draws, and "older flowers fade into the background" is the literal
implementation rather than a simulation of it.

Placement is derived from the genome hash, never `Math.random()`: §7 regenerates the background
from a replay list on load, and random placement would reshuffle the player's entire history on
every reload.

### The visual set the numbers, not the other way round

The first placement ranges (alpha 0.58–0.78, scale 0.78–0.94) passed every test in the file and
produced a background that competed with the foreground — the live bed stopped being the subject
of its own picture. Nothing in the suite was measuring _does it recede_, only _does it vary_, and
variation is not depth. Ranges are now alpha 0.28–0.50, scale 0.64–0.82, blur 1.1–3.0, with an
explicit subordination test so a later tweak cannot quietly undo it.

### One unclamped interpolation killed the whole game

The flash ring computed `radius = 10 + 34 * (1 - k)` with `k = (until - now) / 34`. The guard
`now < until` bounds `k` below but **not above**, so a clock moving backwards gave `k > 1.29` and
a radius of −44. `arc()` throws on a negative radius — and a throw inside the `requestAnimationFrame`
callback means the loop is never rescheduled, so the entire game froze with a blank-looking canvas
and no visible cause. It also masked the forest bug being investigated at the time: compositing
happens in `frame()`, so with the loop dead only one plant ever reached the buffer, which read as
"accumulation is broken" rather than "rendering is dead".

Two lessons: **clamp every interpolation regardless of what the surrounding guard seems to
guarantee**, and a rAF loop is a single point of failure for everything drawn.

### Deferred

Nothing persists across a reload, and the share codes are displayed but not in the URL. That is
Milestone 5, the last one.

## 17. Milestone 5 outcome — persistence and sharing

Built 2026-07-30 at `c2b376c`. 175 tests, `tsc --noEmit` clean. Files: `src/game/save.ts`,
`tools/drive-persist.mjs`.

localStorage holds **genomes, not geometry**. Plants are re-expressed and re-grown on load,
which is what lets a saved garden survive a change to the growth engine or the renderer; storing
geometry would pin every past plant to the code that drew it. The background is likewise rebuilt
from the replay list rather than stored as an image, capped at 60 entries — beyond that a layer
has washed below 5% contrast anyway, so the cap costs nothing visible.

Sharing puts the genome in the URL **fragment**, so it never reaches a server.

Every failure is named and shown in amber: a wrong save version, a corrupt genome in a named
plot or tray slot, a rejected share link, a failed write. A save that silently resets is the
worst outcome available here — the player loses a breeding history, is told nothing, and the bug
that ate it leaves no trace.

### Three bugs no fixture could have caught

1. **The history eraser.** Deriving the save's replay list from `garden.retired` looks obviously
   correct and would have deleted the player's whole background one session at a time: a
   restored garden's `retired` is EMPTY, because its plants went straight into the buffer. The
   first save after each reload would write `replay: []`. The caller now owns the running log.
2. **The silent share link.** The fragment was read only at module load. Changing a fragment does
   not reload a page, so a link pasted into a tab that already had the garden open did nothing at
   all — silently, which is the worst way for a feature not to work. Now also handled on
   `hashchange`, with the fragment cleared afterwards so a refresh cannot plant the gift twice.
3. **A shadowed global.** A module-level `history` array shadowed `window.history`, which would
   have made `history.replaceState` a method call on an array.

### Verification

A 14-check driver builds a garden through the real verbs, waits out the save debounce, reloads
the page, and asserts the same plants came back — with a negative control proving those
assertions FAIL when storage is cleared (otherwise a game that regenerated an identical garden
from a fixed seed would pass with localStorage doing nothing), and both genome-rejection paths
exercised separately, since all-zero bytes trip the version check before the checksum is reached.

Mutation results: `replay dropped`, `version check skipped`, `save never written` and `share link
ignored` were all killed by the driver. `ages not restored` **survived the driver** and is killed
by the unit suite instead — the correct division, since age arithmetic lives in `save.ts` and the
driver's job is the reload path.

## 18. Status

All five milestones are built. What the original had and this now also has: click-to-clone,
drag-to-crossbreed, seeds as objects, an accumulating background, a shareable genome string, and
endless pressure-free drift. What it adds: a real Mendelian gene model with dominance, an allele
series, dosage and epistasis, in place of averaged numbers — extended in §21 with inflorescence
architecture, merosity, linkage and a recessive lethal.

Residual visual backlog remains as recorded in §13 — stem outline jitter, back-row petal shape,
sparse and identical leaf stamps, and colour that is vivid rather than muted-saturated.

> **Superseded.** §19 re-measured this backlog and retracted two of its five entries as
> already-fixed; §20 records the responsive-layout work and §21 the deeper genetics. Read those
> first.

## 19. Visual pass — and a retracted backlog

Done 2026-07-30. 183 tests, `tsc --noEmit` clean, all three drivers pass.

### Two of the five defects did not exist

§13.1 claimed stem outlines jittered "up to ±33% of local width... because outlines are built
per-tick rather than as one continuous smoothed path". **Measured: 0.0% width error, 0.7%
step-to-step oscillation.** `paintPlant` already built one outline per chain; the defect had been
fixed by earlier smoothing work and the entry was never updated. It was then quoted three times
in later sessions as though still true. §13.2 (back-row petals as rounded quadrilaterals) was
likewise not reproducible — the obovate profile had resolved it.

**A backlog is a claim like any other, and the Iron Law applies to it.** Re-measure before
working from an entry, and especially before quoting one.

### What the magnification actually showed

The §13 list was written from full-frame screenshots, where a bloom is ~40px across. At 4x
(`tools/zoom.mjs`) the dominant defect was not on the list at all: **stems and leaves were flat
ribbons** — one fill colour plus a rim, no shading — and between them they are most of a plant's
area. No amount of petal work would have fixed that.

- **Stems** are now shaded with nested strips at falling alpha, offset along the LIT side as the
  stroke curves. A single band leaves a hard polygon edge that reads as a stripe painted on;
  three approximate a curved surface. A gradient would be better but cannot follow a curve.
- **Leaves** gained a curved midline, pinnate veins angled forward, a lit-to-shadow gradient, and
  per-leaf variation in fatness, serration and curl. Length and angle alone had left every blade
  the same outline at a different size, which at magnification is one stamp repeated.
- **Lighting** comes from one shared `LIGHT` vector. Lighting each element in its own local frame
  is what makes procedural art read as a sheet of decals: a stem lit from its own left and a leaf
  lit from its own left face different real directions the moment either rotates.
- **Colour** is per-hue. Equal HSL saturation does not give equal perceived intensity — at S=72
  blue and violet read like UI accent colours while coral read like a flower. Each class now
  carries its own S and L, pulled hardest where the hue is least forgiving.
- **Petal rim width scales with the petal.** A fixed 1px rim is correct at one size only; on a
  doubled bloom's inner whorl a petal is ~3px wide and the outline claimed most of its area, so
  those flowers rendered as white filigree with a trace of colour.
- **`pointed` widened 0.6 → 0.76.** A lanceolate profile already tapers at both ends, and the
  width multiplier narrowed it again: five of them rendered as an asterisk, not a flower.

### The rim rule was a threshold pretending to be a measurement

`petalRim` flipped to a dark rim above lightness 76. That held only while every hue shared one
lightness. The moment violet and blue moved lighter, their innermost whorls landed at 74 — just
under the line — and kept a light rim with 51 units of contrast against a 55-unit requirement.

It now compares both candidate rims and returns whichever has more contrast. No threshold to
tune, and a later colour change cannot knock it out of range. The function's own docstring had
said contrast decides; it just never measured it.

Found by extending the rim test to sweep all five hue classes instead of the default one — the
single-hue sweep left four fills unchecked.

## 20. Responsive layout — the world adapts to the viewport

Done 2026-07-30. 200 tests, `tsc --noEmit` clean, all four drivers pass, deployed and verified
live.

The world had been three constants: 1180 x 470 with soil at 390, and six plot positions hand-set
at 135/317/499/681/863/1045. That is correct for exactly one screen. After the aspect fix a phone
got the same world scaled down undistorted — a 396x158 strip, legible but not playable.

`src/game/layout.ts` now derives all of it from the viewport, pure and DOM-free so the whole rule
is testable:

| viewport                | world    | plots |
| ----------------------- | -------- | ----- |
| desktop 1440x900        | 1180x470 | 6     |
| phone landscape 863x360 | 847x430  | 4     |
| phone portrait 412x839  | 396x470  | 2     |

The desktop row reproduces the hand-tuned positions exactly, which is the point — a
generalisation that silently changes the number it was generalising FROM is a regression dressed
up as a refactor.

**Height is clamped to a narrow band (430–470) while width is not.** A plant is ~250px tall
whatever the screen is, so height is not a free parameter: below 430 the canopy runs out of
headroom, above 470 the extra is empty sky. A tall portrait phone gets letterboxing rather than a
taller world, because a taller world is just more darkness.

### Rotation is a reshape, not a rescale

A phone rotated to landscape has room for four plots where portrait had two. Rotating back has to
put two plants somewhere. `relayout()` retires the surplus into the background — the same fate as
any plant the player replaces — rather than deleting them, and re-grows each retired plant at a
clamped x before compositing so landscape geometry never lands in a portrait buffer. The
background buffer is rebuilt from the replay log at the new size.

### Three bugs the existing tests could not see

- **`placeRetired` scattered a fixed ±170px** — 29% of a 1180-wide desktop world, but 86% of a
  396-wide phone world. Retired plants were flung clean off the canvas: the background came back
  `depth 1, coverage 0`, layers composited and drawn nowhere. Every existing forest test passed,
  because they all ran at the default world width. Scatter is now a fraction of world width.
- **Surplus plants carried landscape geometry into a portrait world**, yielding 157 covered
  pixels where a correct rebuild gives tens of thousands.
- **The rotation check was vacuous.** With one plant and 4→2 plots the surplus assertion read
  `0 >= -1` and passed on any implementation, including one that deletes plants outright. The
  driver now fills the landscape bed first, so surplus > 0 and the number means something.

### The coverage threshold had to be scale-free

A first `coverage > 1000` floor sat _inside_ the legitimate range: measured correct runs gave 826,
23,816 and 34,849 depending on which genomes happened to retire — a compact droopy plant at
depth 1 covers two orders of magnitude fewer pixels than a large bush. The buggy run gave 157. The
floor is now 0.05% of the buffer's own pixel area, which separates those populations with margin
and survives a change of world size.

### A mutation test that reverted an uncommitted file

Twice. `git checkout -- <file>` discarded an entire uncommitted rewrite the first time; the second
time it was a silent no-op on an _untracked_ file, so four mutations accumulated and the harness
scored a file that no longer resembled the one under test. Both were invisible because
`grep -c '^FAIL'` returns 0 for a crash exactly as it does for a pass.

The rules that came out of it: **commit before mutating**, verify each revert with
`git diff --quiet`, and require a sentinel line proving the harness actually RAN before trusting
any "0 failures" count. All five layout mutants were killed once the harness was real.

## 21. Deeper genetics — architecture, merosity, linkage and a lethal

Done 2026-07-30. 254 tests, `tsc --noEmit` clean, all four drivers pass, 19/19 mutants killed.

§12 flagged eight loci as possibly too few. The sharper version of that complaint: the genetics
were already deeper than the original's, but the _plants_ were not. Every flower was solitary,
five-petalled and alive, so two plants differing at four loci could still be told apart only by
colour — and colour is the first thing to go when a plant is a thumbnail in the background
forest.

### The three new loci

- **`I`, inflorescence** — umbel > raceme > spike > solitary. Flowers now sit _along_ a shoot or
  clustered at its tip, not only at terminals. Arrangement is what a person reads first about a
  plant and it survives being shrunk; this is the locus that earns the milestone.
- **`N`, petal count** — 12 > 8 > 6 > 5, an allele series rather than a polygenic dial. Merosity
  in real flowers is discrete and heritable, and a discrete series is also the only version a
  player can count. A polygenic petal count lands on 6.4 and reads as noise.
- **`L`, chlorophyll** — `ll` seedlings come up albino and die. This is the only locus that makes
  CARRIERS matter: every other gene shows what it is, but `Ll` is indistinguishable from `LL`,
  so the sole evidence is a quarter of a self-cross coming up dead. That is the inference Mendel
  had to make, and nothing else in the game asks for it.

Founders are filtered so `ll` never appears at generation zero. That is ascertainment, not a
fudge — a founder collection is a collection of plants that _grew_.

### Linkage: making a goal cost something

`inherit` no longer assorts freely. Each discrete locus sits on a chromosome, and a gamete is
made by walking it and switching homolog at each interval with that interval's recombination
fraction. Independent assortment is `r = 0.5`, so the old behaviour is _contained_ in the new
model rather than replaced by it.

The reason is that free assortment has no hard crosses. Any combination is reachable in two
generations, so nothing is ever a project. With `D`–`N` tight at 0.06, a parent carrying doubling
on one homolog and twelve petals on the other needs a crossover to pass both, and about one
gamete in seventeen does. The player produces a lot of nearly-right flowers first — and that run,
not the payoff, is what makes the payoff land.

### A trade, so there is no single right answer

Clustered architectures carry proportionally smaller flowers (umbel 0.58, spike 0.66, raceme
0.72). Without it a twelve-flowered raceme of full-size blooms is strictly the best genotype,
every player converges on it, and open-ended breeding is over. The penalty is ordered by how
many flowers the form carries, and bounded below so a floret never stops being a flower.

### Format v2, and old links still open

58 payload bits, 14 characters. A version-1 link decodes through a separate branch and fills the
three new loci with `i`/`n`/`L` — not neutral defaults, but the alleles every v1 plant implicitly
had, so an old link grows the flower it always grew. An upgrade that quietly handed back a
different plant would be worse than refusing the link, because nobody could tell it had happened.

The v1 compatibility vector in the tests is a real string emitted by the v1 encoder, recovered
from git. It is the only expected value in that file not read off the implementation it checks,
and therefore the only one that is evidence about the _format_ rather than about the current
encoder agreeing with itself.

### Four defects, and where each was actually found

None of these were found by reading the code.

**Mutation testing found two.** The raceme ripeness test passed with the ripeness gradient
deleted — it was measuring "the terminal flower is a bud and sits at the top", which produces a
size gradient all by itself, not the lateral ripening it claimed. And the cluster size trade,
a load-bearing balance decision, had no test at all: removing it left everything green.

**Measuring the render pipeline found one.** The renderer culls any bloom closer to another than
0.62 of a radius, and an umbel's florets are _supposed_ to touch. Their spacing came out at 5.7px
against a 5.8px threshold, so a third of every umbel was grown and then silently discarded before
being drawn — the one architecture defined by clustering was the one the anti-clustering rule
ate. Fixed at the geometry, not by weakening a cull that solitary flowers still need. **Every
test in the file measured what `growPlant` RETURNS; none measured what reaches the canvas.**

**Looking at the lookdev sheet found the rest**, including a regression this spec had explicitly
warned against one section earlier. §20 records the rule that a generalisation must reproduce the
numbers it generalises from. The new petal-width rule holds angular _fill_ constant and does
reproduce the tuned 0.66 at five petals and 0.42 at nine — and then silently broke buds, which
have three petals whatever the genotype, and three petals sharing a circle solve to a width 1.31×
their own length. A petal wider than it is long. On a twelve-petal plant those blobs sat beside
narrow open stars and the plant read as two species on one stem.

The comment directly above that line claimed the generalisation had not moved a tuned number.
**Writing the rule down, in the right file, one section earlier, did not prevent the violation —
and neither did asserting the two cases the comment named.** The bud was a third case nobody
thought to check, and only a picture showed it.

Alongside it: leaves were sized off `bloomRadius`, so the cluster trade shrank every clustered
plant's _foliage_ by up to 40% as a side effect, reintroducing §19's "blob on a stick" from a
direction nothing was watching; and a bushy umbel put a full plate of florets on all thirty of
its terminals and read as coral. Side axes now carry a reduced head — not a full one, and not a
solitary flower, since gating the head off scattered the flowers back across the plant's height
and measurably undid the "all at one point" signature.

## 22. The field notebook — making the depth legible without giving it away

Done 2026-07-30. 279 tests, `tsc --noEmit` clean, five drivers pass, 26/26 mutants killed.

§21 added eleven loci, a linkage map and a hidden carrier. The player could see none of it. A
plant showed its phenotype and nothing else, there was no record of what had been crossed with
what, and — worst — no way to tell a carrier from a clear plant even after breeding the very
evidence that proved it. The most interesting locus in the game was invisible in both
directions.

### The refusal is the design

Printing a genotype would have been one function call. It would also have deleted the albinism
locus outright, because **a carrier is defined by being indistinguishable**. Hand over `Ll` for
free and nobody ever has to breed a plant to find out what it is.

So the card shows what has been OBSERVED and what those observations entail. One rule covers all
eight discrete loci: a child expresses the most dominant allele it holds, so if a child is more
recessive than its parent, the allele the parent contributed cannot have been the one it shows —
it must be carrying a second, hidden one. An albino seedling proves _both_ its parents carry `l`.

It claims only what follows. From a frilled parent and a pointed child, "pointed petals or
plainer" — never a guess at the exact allele. And every claim carries its evidence count, because
the honest caveat is that `crossOf` mutates after inheriting, so roughly one deduction in a few
hundred rests on a mutation. One odd seedling is a curiosity; three is a genotype.

### Selfing existed as a hole in the design

Dragging a flower onto its own plant did nothing. That was not a missing convenience — selfing is
_the_ classic test for a hidden recessive, and without it the albinism locus was a fact about the
world with no instrument for investigating it. A carrier selfed throws the recessive in a quarter
of its seedlings; no other move available to the player comes close.

A clone cannot do this job, and the card says so: "a cutting of a coral umbel — same plant, no
new evidence". That line exists because clicking a flower repeatedly is the most natural thing to
try, and it is the one action that can never answer anything.

### Evidence is filed on GROWTH, not on crossing

A cross is recorded when its child has finished growing, not when the seed was made. Filing at
cross time would let the player deduce a parent's hidden alleles from a seed they never planted —
the disclosure §4 forbids, arriving by a longer route — and would remove the reason to plant
anything. An albino counts: it never blooms, but it finishes growing, and it is the single most
informative thing that can happen in this garden.

Save format v2 carries the notebook and each seed's provenance, and still reads v1. It also fixed
a latent bug the notebook turned into a data-losing one: the loader restarted the seed counter at
`tray.length + 1` on every load, so two sessions would both mint a seed 3 and the second one's
outcome would be silently discarded as a duplicate observation.

### What the drivers found that nothing else could

**The inspect gesture was unreachable.** The first design was "click the plant somewhere that is
not a flower". That works on a sparse plant and fails completely on the plants §21 made possible:
a bushy raceme carries sixty-eight flowers and leaves almost no bare stem. Every attempt to open
a card landed on a bloom and took a seed instead. Press-and-hold replaced it — it consumes no
gesture the game already uses, needs no on-screen control, and works identically under a finger
and a mouse.

**Then the gesture cancelled itself.** The hold opened the card; the `pointerup` that ended the
hold was read as a tap on the plant and toggled it straight back off. The card appeared and
vanished inside one gesture.

**Then the hit box was wrong in a way that made the gesture positional.** `plantAt` measured the
plant's bounding box from its STEMS, so a flower on a long pedicel — or an entire umbel's plate —
fell outside it. Holding a stem opened the card; holding a flower at the canopy edge did nothing
and cloned instead. Two behaviours decided by where the flower happened to be, and neither
asserted anywhere.

That last one surfaced through a control that had started passing for the wrong reason.
`drag(a, a, 2)` was written to check "a zero-distance drag is a click, not a cross" — and its
down-to-up interval measured **554ms**, past the press threshold. It had quietly become a test of
the inspect gesture, still passing whenever the flower fell outside the hit box. Both gestures are
now pinned separately, because they are separated only by duration and a change to the threshold
would otherwise eat one of them silently.

### And a fixed threshold that had already been fixed once

`drive-persist.mjs` asserted `forestCoverage > 1000`. Measured across seven runs the legitimate
range is **114 to 15,672** — genome-dependent, with real runs at 1,703 and 2,733 sitting just over
a floor that was already inside the population it was meant to accept. The 114 run was a correct
rebuild of a genuinely tiny plant, which §21 made more likely by adding albino seedlings.

This is the _same defect_, in the same words, that §20 records finding and fixing in
`check-viewports.mjs`. It was left standing in the sibling file. **Fixing a bug in one place is
not fixing the bug** — the lesson from §20 was written down and did not travel to the file next
to it.

## 23. Motion — and the frame rate it exposed

Done 2026-07-31. 317 tests, `tsc --noEmit` clean, six drivers pass, 37/37 mutants killed.

The garden held perfectly still between clicks and retirement was a hard cut. It read as a
diagram of a garden rather than as one.

### Paint-time only, and that is the architecture

§6 makes growth a pure function of the genome so a shared link grows the same plant for
everyone. Motion that touched `Plant` would either break that or have to be replayed exactly,
and both are worse than the alternative: nothing in `motion.ts` is ever written back, and a test
asserts that growth output is byte-identical whatever the clock says.

Sway is an **affine shear anchored at the plant's base** — every point moves sideways in
proportion to its height above the root. That is one `ctx.transform` for a whole plant, so
stems, leaves, flowers and the gradients inside them all bend together, and **`paintPlant`
needed no change at all**. Which in turn means the background composites the resting pose for
free: `Forest.retire` calls `paintPlant` directly, so a plant cannot be frozen mid-lean.

Amplitude is deliberately small. Hit-testing uses resting coordinates, so every pixel of sway is
a pixel of disagreement between where a flower is drawn and where it can be clicked.

Per-plant phase comes from the genome hash, so a shared plant sways identically wherever it is
opened, and two clones move in lockstep — correct, since they are the same plant.

### The frame rate was already broken

Motion is worth nothing at 11 frames per second, and that is what the bed was running at. **The
problem predated motion**: 9 fps measured on the deployed pre-motion build. §21 multiplied the
flower count by roughly five and nothing downstream was rebuilt for it.

A pass-by-pass profile settled it rather than a guess: **67% of the paint budget was petals** —
149 blooms per frame, each rebuilding a gradient per petal, on top of 365 stroke outlines for
stems and flower stalks.

None of that work changes. Once a plant has finished growing and its last flower has opened, its
picture is fixed forever, and every frame was re-deriving an identical image. Rendering it once
into an offscreen canvas turns a plant from thousands of path fills into one `drawImage`.
**Measured 13 → 60 fps.**

The cache is keyed on the `Plant` object, so nothing has to remember to invalidate it: a re-grown
plant is a different object and the old entry is collected with the plant it belonged to.

### `ctx.filter` blurs every operation separately

The recede animation cost **765ms per frame**. `applyPlacement` sets `ctx.filter = blur(...)`,
and a canvas filter forces each subsequent drawing operation into its own layer to be blurred
independently — so blurring a vector plant blurs several hundred paths one at a time. The garden
dropped to two frames a second and the animation never completed.

A receding plant has by definition finished growing, so it always has a cached picture. Blurring
that is one operation.

**And the driver was making it worse.** It polled `__state()` to ask whether the recede had
finished, and `__state()` reads the whole background buffer back with `getImageData` to report
coverage. Polling a megapixel readback once per frame starved the very loop it was waiting on:
asking whether the animation had finished was part of why it had not.

### The trade, stated

A sheared bitmap is softer than sheared vector art. It is invisible at 1× and visible at 4×, so
`tools/zoom.mjs` now magnifies the blit rather than the linework. The lookdev sheet calls
`paintPlant` directly and remains the sharp reference for judging render quality.

### What has to be true at both ends of an animation

`lerpPlacement` has to be the exact identity at u = 0 and exactly the reserved placement at
u = 1. Neither endpoint had a test, and both are visible: the first is a jump on the frame the
player drops a seed, the second a jump at the handover from the animation to the composited
buffer. The placement is also **reserved when the plant leaves the bed**, not computed on
arrival — several plants can be receding at once, so the layer index the buffer would compute
later is not the one the animation eased toward.

## 24. Hardening — a long session, a phone, and a retracted defect

Done 2026-07-31. 320 tests, `tsc --noEmit` clean, seven drivers pass.

Three items, chosen because they were the least exciting available and the two previous
"harden" items had both turned out to be real bugs. So did these.

### Nothing had ever been run for more than a few minutes

Every driver built a garden of five or six plants and stopped, which meant **every unbounded
thing in the codebase had been measured exactly once, at zero**. `tools/soak.mjs` plays
hundreds of rounds and watches what grows that should not. It found three defects, none of
which any short test could have seen.

**The garden never saved while you played.** A trailing debounce with no ceiling never fires as
long as the player keeps acting, because every action resets it. 150 rounds at ~420ms each
wrote _nothing at all_ for the entire run — the save appeared only once the driver stopped. An
engaged player closing the tab would have lost the lot. The debounce is capped at 5s now and
flushed on `visibilitychange`/`pagehide`, which are the events that actually fire when a phone
app is swiped away. **The bug is that the next action arrives**, which is precisely why
single-action testing cannot find it.

**Every retirement froze the page for seconds.** `Forest.retire` still painted a vector plant
under `ctx.filter`, and §23 had already established that a canvas filter blurs every drawing
operation separately. 6–9 seconds per replacement — and sixty in a row when a saved background
is rebuilt on load. It composites the cached bitmap now: ~420ms per round, flat across 150.

**`garden.retired` grew without bound**, holding the heaviest objects in the game, and since
the render cache is keyed on the plant object, each one also pinned an offscreen canvas. It is
a queue now, drained every frame, with a separate counter for "how many have you replaced".
`retirementLog` is capped in memory too rather than only on save — `relayout` re-grows one
plant per entry, so an afternoon's play would have turned rotating a phone into a freeze that
got worse the longer you had been enjoying yourself.

Measured after: heap stable, save bounded at ~15KB, relayout 8.8ms, 61fps.

### The phone, and two fixes that did not fix

60fps in a headless browser on a sixteen-core laptop proves very little. Under CPU throttling
the garden ran at 25fps at 4× and 14fps at 6×. Two mechanisms were tried and **both were
measured and both failed**:

- **Lower the drawing resolution**, on the theory that the bottleneck was pixels. At two
  different device ratios the canvas held the _same_ 0.36 megapixels and ran at 29.9 and 44.4
  fps. The compositor works at the device's physical resolution whatever our backing store is,
  so shrinking it bought nothing and cost sharpness.
- **Draw every other frame.** The loop rate duly doubled, 28 → 45fps — and the rate at which
  anything actually _changed on screen_ fell from 28 to 22. Halving the draws halved what the
  player sees; the loop being idle the rest of the time is worth nothing to them.

Both are reverted. A drawn frame costs ~27ms on a 4×-slowed phone, of which under 4ms is
JavaScript; the rest is rasterising and compositing a full-screen canvas. The remaining lever
is dirty-rectangle rendering, which sway makes genuinely hard. The numbers are now guarded at
~23fps (4×) and ~17fps (6×) — slow, and playable, since nothing here is timed or needs aim.

### A defect that was not one

The spike architecture was recorded as reading "as a dense mass rather than countable flowers",
carried in the backlog, and offered as work twice. **Measured, it is not the outlier.** Mean
nearest-neighbour distance in flower diameters: umbel 0.43, spike 0.49, raceme 0.56 — the spike
sits _between_ the two forms that read fine, and its flower band is genuinely narrower than a
raceme's, which is what makes a spike a spike. Lupin, veronica and plantain all look like this.

It was a preference stated as a defect. Retracted, with the measurement kept as a real guard:
if any architecture ever _does_ pack tighter than the others, that number will say so. This is
the second time in this project that a backlog entry survived unexamined into a work plan and
then evaporated on contact with a measurement (§19 retracted two of five).

### The same class of bug, a third and fourth time

Every driver hand-rolled its pointer gestures, so adding press-and-hold silently reinterpreted
any click slower than 450ms as an inspect — and the resulting failures read as "the bed would
not fill" and "the recede never happened". `tools/gestures.mjs` is now the one place that knows
what a tap is.

And a control this session's own save work broke: the `pagehide` flush fired during the
driver's reload and wrote back the garden it had just cleared, so the negative control was
handing storage a value it had been told to forget and then reporting that storage worked. It
clears through CDP from a blank page now.
