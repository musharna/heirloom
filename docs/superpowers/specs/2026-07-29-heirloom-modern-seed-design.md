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
   grows from `express(genome)` seeded by `genomeSeed(genome)`. The four verbs are not built._
4. **Accumulation** — retirement, background compositing, depth-of-field.
5. **Sharing and persistence** — URL round-trip, localStorage.

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
