# Heirloom

**Play it: https://musharna.github.io/heirloom/**

A flower-breeding toy: click a bloom to take a seed, drag one bloom onto another to cross them,
plant the seed and watch what comes up. Nothing to win, nothing to lose, no menus. Retired plants
fade into a background that slowly becomes a record of everything you have ever bred.

A modernized [_Seed_](https://www.noio.nl/2007/12/seed/) (noio, 2007), rebuilt from scratch. The
original averaged numeric variables to cross two flowers; this keeps the restraint and replaces
the genetics.

## Running it

```sh
npm ci
npm run dev     # http://localhost:5173/
```

Deployed to GitHub Pages from `.github/workflows/pages.yml`, gated on typecheck and tests — a
green deploy of a broken bundle looks fine in the Actions log and is broken in a browser.

`/garden/` is the game. `/lookdev/` is a diagnostic sheet that varies one gene per panel against
a shared seed — useful for judging a single trait, useless for judging the game, since it draws
the same plant twelve times.

## The genetics

Eight loci, chosen so each contributes a different _kind_ of surprise rather than more of the
same:

| Locus         | Kind                | Effect                                                                   |
| ------------- | ------------------- | ------------------------------------------------------------------------ |
| Pigment block | discrete, dominant  | `W_` blocks anthocyanin — the flower reads white whatever hue it carries |
| Hue A, Hue B  | dosage              | Five hue classes across combined dosage 0–4                              |
| Doubling      | discrete, recessive | `dd` converts stamens to petals                                          |
| Petal shape   | allele series       | frilled > lobed > pointed > round                                        |
| Vigour        | polygenic (6 loci)  | Reaching vs compact                                                      |
| Droop         | polygenic (6 loci)  | Weeping vs upright — reads as behaviour _while growing_                  |
| Branchiness   | polygenic (6 loci)  | Branch probability per tick                                              |

Four surprise types fall out of that: a hidden recessive (`Dd` singles quietly carrying
doubling), **masking** — two white flowers can throw a coloured child, because white conceals
whatever hue it carries — dosage steps, and continuous drift through the polygenic blocks.

Traits are never disclosed before bloom. Growing the plant _is_ the reveal.

## Sharing

Every genome packs into 11 base64url characters — eight loci in 48 bits, plus a version byte and
a checksum. The code rides in the URL fragment, so it never reaches a server:

    https://musharna.github.io/heirloom/garden/#g=AWOPAIpYIKA

Growth is seeded from a hash of the genome alone, so that link grows the same plant for everyone.
The checksum matters because the packing is dense — every bit pattern is a legal genome, so
without it a mistyped link would silently hand back the wrong flower instead of an error.

## Architecture

One-way pipeline; the renderer never sees a genome.

```
Genome ──express()──▶ Phenotype ──growPlant(seed)──▶ primitives ──Canvas2D──▶ screen
   │                                                                  │
   └── inherit(A,B) + mutate ──▶ child Genome              retire ──▶ accumulation buffer
```

- `src/genome/` — loci, inheritance, mutation, expression, and an 11-character serialization
- `src/growth/` — tropism-based agent growth; tips step, bend, branch and terminate in a bloom
- `src/render/` — Canvas2D: variable-width stroke outlines, petals, the accumulating forest
- `src/game/` — plots, the seed tray, the four verbs, save/load

Growth is seeded from a hash of the **genome alone**, never the plot, so one genome means one
canonical plant and a shared link reproduces it exactly.

## Tests

```sh
npm test              # 183 unit tests
npx tsc --noEmit
```

Pure logic is unit-tested; anything touching a canvas, a pointer or localStorage is checked by a
driver that runs the real thing in a real browser:

```sh
npm run dev &     # the drivers drive a real server
npm run drive     # all three, in order
```

- `tools/drive-verbs.mjs` — clicks real flowers, asserts the four verbs fire
- `tools/drive-forest.mjs` — retires plants, reads the background buffer's pixels back
- `tools/drive-persist.mjs` — builds a garden, reloads the page, asserts it came back
- `npm run shoot` — screenshots the garden into `shots/`

Each driver carries negative controls, because a check that only ever passes proves nothing —
clicking bare sky must yield no seed, clearing storage must produce a _different_ garden, and an
empty background buffer must read as empty before any "it grew" assertion is trusted.

They take a `GARDEN_URL`, so the same checks run against the deployed site rather than only
against a dev server — a green CI run says the build succeeded, not that the site works:

```sh
GARDEN_URL=https://musharna.github.io/heirloom/garden/ npm run drive
```

Design and per-milestone outcomes, including what went wrong and why:
`docs/superpowers/specs/2026-07-29-heirloom-modern-seed-design.md`.
