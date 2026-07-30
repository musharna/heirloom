# Heirloom — a modernized *Seed* — design

> Status: approved 2026-07-29. Working title "Heirloom" is easily renamed.

## 1. Context

[*Seed*](https://www.noio.nl/2007/12/seed/) (noio / Thomas van den Berg, December 2007) was a Flash
toy-game about breeding flowers. Its history matters to this design:

- It began as a **screensaver** — draw a few branches with bezier curves and varying branch widths,
  spawn flowers, repeat, and let older flowers fade into the background so an ever-growing forest
  accumulates.
- It rendered to `bitmapData` rather than vectors, for performance.
- The game emerged from one observation, in the author's words: *"the variables for different flowers
  could easily be averaged, creating the cross-breed of two flowers."* A flower was a numeric genome.
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
procedural rose petals, and the recorded lesson was to judge pixels from the *real* pipeline rather
than from an isolated approximation. That lesson shapes Milestone 1 below.

## 2. Goal and locked decisions

Build a browser game that keeps *Seed*'s soul and modernizes exactly three things: the genetics, the
rendering, and shareability. Each decision below was chosen explicitly, with the rationale recorded
so a later reader knows what was traded away.

| Decision | Choice | Rationale |
| --- | --- | --- |
| Codebase | De novo, standalone | User's call. No dependency on or port from `~/flower`. |
| Scope | Same soul, deeper genetics | One canvas, no menus, no win condition, endless drift. Modernize genetics + rendering + sharing only. Adding goals risks destroying what made *Seed* memorable. |
| Gene model | Two-layer: genotype → growth program | Alleles at named loci (plus polygenic blocks) resolve to a parameter set, which drives a developmental growth program. Buys Mendelian surprise *and* emergent morphology. Costs one layer of indirection. |
| World | One screen, accumulating background | Fixed viewport, a handful of foreground plots; retiring flowers composite into a persistent background layer that densifies over time. Zero navigation UI, and the background becomes a record of the player's breeding history. |
| Art direction | Refined ink line-art on dark ground | Tapered bezier strokes, layered petal shapes, muted-saturated colour, soft bloom, depth-of-field on background layers. The one style where procedural generation is a strength rather than a fight. |
| Growth engine | Tropism-based agent growth | Growing tips step, bend under tropisms, branch stochastically, terminate in a bloom. Growth animation *is* the simulation (one system, not a replay layer), and genes read as behaviours rather than as static angles. |
| Platform | Browser; TypeScript + Vite; no UI framework | There is almost no UI; a framework would be pure overhead. |
| Rendering API | Canvas2D + offscreen accumulation buffer | This is the original's `bitmapData` trick and remains the correct tool: the background forest costs one texture instead of thousands of live objects. WebGL only if the Milestone 1 spike proves it necessary. |

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
    correctly. Note the curve is *emergent from the growth path*, not authored as cubic bezier
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

| Verb | Gesture | Effect |
| --- | --- | --- |
| Clone | click a bloom | Produces a seed of that genome, with mutation applied. |
| Cross | drag bloom A onto bloom B | Produces a child seed from `inherit(A, B)` + mutation. |
| Plant | drag a seed onto a plot | Seed germinates; the plant grows on screen, revealing its traits over time. |
| Splice | drag a seed onto another seed | Crosses two genomes without planting either. |

Traits are **not** disclosed before bloom. The reveal-by-growing is the pacing mechanism.

## 5. Genetics content

Eight loci, chosen so that each contributes a *different kind* of surprise rather than more of the
same. Deliberately small; extending is cheap, and an over-large gene set makes nothing legible.

| Locus | Symbol | Kind | Alleles | Inheritance | Effect |
| --- | --- | --- | --- | --- | --- |
| Pigment block | `W` | discrete | `W` (block), `w` (permit) | `W` dominant | `W_` → no anthocyanin; flower reads white/cream **regardless of hue loci**. `ww` → hue expressed. |
| Hue A | `H1` | discrete, dosage | `H1`, `h1` | additive dosage | Contributes to hue class. |
| Hue B | `H2` | discrete, dosage | `H2`, `h2` | additive dosage | Contributes to hue class. |
| Doubling | `D` | discrete | `D` (single), `d` (double) | `d` recessive | `dd` → stamens convert to petals (ABC-model behaviour): petal count multiplies, stamen ring absent. |
| Petal shape | `P` | allele series | `P^f` frilled > `P^l` lobed > `P^p` pointed > `p` round | hierarchical dominance | Selects the petal outline control points. |
| Vigour | `V*` | polygenic block (6) | `+` / `−` | additive | Internode length and total growth ticks → reaching vs compact. |
| Droop | `G*` | polygenic block (6) | `+` / `−` | additive | Gravitropism weight → weeping vs upright. Reads as behaviour *while growing*. |
| Branchiness | `B*` | polygenic block (6) | `+` / `−` | additive | Branch probability per tick. |

This yields four distinct surprise types from eight loci:

1. **Hidden recessive** — `Dd` singles carrying doubling; `dd` appears unannounced a generation later.
2. **Masking (epistasis)** — the headline mechanic. A white `W_` flower conceals whatever hue genes
   it carries, so **white × white can throw colour** when the two whites carry different hidden
   hues. Real biology, and the best "gasp" available for the cost.
3. **Dosage** — `H1`/`H2` give five discrete hue classes across combined dosage 0–4.
4. **Continuous drift** — the three polygenic blocks move habit gradually across generations.

Hue is deliberately **discrete (five classes)** rather than continuous: discrete classes make
Mendelian inheritance *visible*, which is the entire point of choosing a two-layer gene model. A
continuous hue would smear segregation into indistinguishable near-misses.

## 6. Growth simulation

A tip carries `{ pos, dir, width, age, depth, vigourLeft }`. Per tick, for each live tip:

1. **Step** — advance `pos` along `dir` by a step length scaled from vigour and depth.
2. **Tropisms** — rotate `dir` by the weighted sum of gravitropism (toward down), phototropism
   (toward the light direction), and a stiffness term that damps change. Weights come from the
   phenotype, so a lineage's *habit* is genetic.
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
   inspect actual output and iterate art direction against it. **Gate: an independent visual critic
   pass**, because builder-bias on rendered output is a perception failure that self-review does not
   catch (project precedent; see §1). Nothing further is built until this looks good.
2. **Genome logic, TDD** — `loci`, `genome`, `inherit`, `mutate`, `express`, `serialize`. Pure, no
   rendering.
3. **Wiring** — genes → growth; garden plots; the four verbs.
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
  always takes parent A's allele) and confirmed to fail *for the stated reason*. A test never seen
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

- **Tropism tuning.** Agent growth is not guaranteed to produce *pretty* plants; it needs tuning.
  Milestone 1 exists to discover this early rather than after the game is wired.
- **Gene-set size.** Eight loci may prove too few to keep breeding interesting for long. Cheap to
  extend, so starting small is the right bet.
- **Background muddiness.** Many accumulated layers could converge to grey soup. Mitigation:
  colour-mix each retirement toward a single background hue and cap the number of composited layers.
