# Heirloom

**Play it: https://musharna.github.io/heirloom/**

A flower-breeding toy: click a bloom to take a seed, drag one bloom onto another to cross them,
plant the seed and watch what comes up. Nothing to win, nothing to lose, no menus. Retired plants
fade into a background that slowly becomes a record of everything you have ever bred.

A modernized [_Seed_](https://www.noio.nl/2007/12/seed/) (noio, 2007), rebuilt from scratch. The
original averaged numeric variables to cross two flowers; this keeps the restraint and replaces
the genetics.

The bed sways, gusts cross it, flowers open as they come out, and a replaced plant recedes into
the background rather than cutting to it. All of it is paint-time only — growth stays a pure
function of the genome, so a shared link grows the same plant however long you watch it.

## Running it

```sh
npm ci
npm run dev     # http://localhost:5173/
```

Deployed to GitHub Pages from `.github/workflows/pages.yml`, gated on typecheck and tests — a
green deploy of a broken bundle looks fine in the Actions log and is broken in a browser.

`/garden/` is the game. `/visit/` is the read-only view a `#garden=` link opens. `/lookdev/` is a
diagnostic sheet that varies one gene per panel against a shared seed — useful for judging a
single trait, useless for judging the game, since it draws the same plant eighteen times.

## The genetics

Eleven loci, chosen so each contributes a different _kind_ of surprise rather than more of the
same:

| Locus         | Kind                | Effect                                                                   |
| ------------- | ------------------- | ------------------------------------------------------------------------ |
| Pigment block | discrete, dominant  | `W_` blocks anthocyanin — the flower reads white whatever hue it carries |
| Hue A, Hue B  | dosage              | Five hue classes across combined dosage 0–4                              |
| Doubling      | discrete, recessive | `dd` converts stamens to petals                                          |
| Petal shape   | allele series       | frilled > lobed > pointed > round                                        |
| Inflorescence | allele series       | umbel > raceme > spike > solitary — _where_ the flowers sit              |
| Petal count   | allele series       | 12 > 8 > 6 > 5                                                           |
| Chlorophyll   | recessive lethal    | `ll` seedlings come up albino and die; `Ll` carriers are invisible       |
| Vigour        | polygenic (6 loci)  | Reaching vs compact                                                      |
| Droop         | polygenic (6 loci)  | Weeping vs upright — reads as behaviour _while growing_                  |
| Branchiness   | polygenic (6 loci)  | Branch probability per tick                                              |

Six surprise types fall out of that: a hidden recessive (`Dd` singles quietly carrying
doubling), **masking** — two white flowers can throw a coloured child, because white conceals
whatever hue it carries — dosage steps, continuous drift through the polygenic blocks, a
**carrier** you can only detect by breeding it, and **linkage**.

Traits are never disclosed before bloom. Growing the plant _is_ the reveal.

### The field notebook

Press and hold a plant to read it. The card shows what the plant is showing, where it came
from, and — this is the point — **what you have proved it must be carrying**.

It never prints a genotype. A carrier is _defined_ by being indistinguishable, so handing over
`Ll` for free would delete the most interesting locus in the game. Instead the notebook records
what you crossed and what grew, and derives only what follows: a child more recessive than its
parent proves the parent carries something hidden. An albino seedling convicts **both** its
parents. Every claim carries its evidence count.

Which is why **selfing** exists — drag a flower onto its own plant. A carrier selfed throws the
recessive in a quarter of its seedlings, and no other move reveals as much. A clone cannot do
it at all, being genetically its parent, and the card says so.

### Linkage

The discrete loci do not assort independently. They sit on a map, and a gamete is made by
walking each chromosome and switching homolog at each interval with that interval's
recombination fraction:

| Chromosome                    | r    | What it means at the bed                                      |
| ----------------------------- | ---- | ------------------------------------------------------------- |
| pigment block — inflorescence | 0.12 | "white, and in an umbel" is a goal rather than a coin flip    |
| doubling — petal count        | 0.06 | tight: the full doubled twelve-petal flower is a real project |
| hue A — hue B                 | 0.30 | loose: an achieved colour breeds truer instead of regressing  |

Independent assortment is the special case `r = 0.5`, so the old behaviour is contained in this
one rather than replaced by it. The point is that linkage makes a breeding goal _cost_
something: two desirable alleles on opposite homologs of a tight interval need a crossover to
come together, so at `r = 0.06` about one gamete in seventeen carries both. The near-miss run is
what makes the payoff land.

## Sharing

Every genome packs into 14 base64url characters — eleven loci in 58 bits, plus a version byte
and a checksum. The code rides in the URL fragment, so it never reaches a server:

    https://musharna.github.io/heirloom/garden/#g=Anv_9wggGDcB1A

Links from before the gene set grew still open: an 11-character version-1 code decodes and fills
the three newer loci with the alleles every version-1 plant implicitly had — solitary,
five-petalled, viable — so it grows the same flower it always did.

Growth is seeded from a hash of the genome alone, so that link grows the same plant for everyone.
The checksum matters because the packing is dense — every bit pattern is a legal genome, so
without it a mistyped link would silently hand back the wrong flower instead of an error.

### Sharing the whole garden

A second kind of link sends the bed and the forest behind it, not one flower. **Copy a link to
this garden** sits at the head of the drawer, and `#garden=` opens a **visit**: someone else's
garden as it stood the moment they shared it, at the plot count and world size it had on their
screen rather than reflowed to yours — a photograph letterboxes, it does not rearrange the
subject.

    https://musharna.github.io/heirloom/visit/#garden=<code>

Growth is frozen and motion is not: a half-grown plant stays half-grown, and the bed still sways.
A live visit would drift away from the garden it was sent from — you would watch a bloom open
that the sender has never seen — and a still one would be the only motionless screen in the game.

A visit **never writes to your own garden**, and that is a property of the module graph rather
than a flag: the visit is a separate page that does not import the four verbs, the save writer,
or the pollinators. A guard can be forgotten in one of six places; a function that is not on the
graph cannot be called at all. There is a test that walks the import graph and says so.

The tray and the notebook do not travel — a visitor cannot plant, and the notebook holds
deductions the player worked out rather than a garden they grew.

## The drawer

Planting over a flower used to end it: the plant receded into the background and there was no
way back. Now every plant you replace keeps. The tab at the bottom of the screen opens a drawer
of everything you have retired, newest first, each shown as the flower it actually was — the
thumbnail is grown from the same genome, so it is that plant and not something like it.

Clicking one puts a **copy** back in your tray. The entry stays where it is, because a drawer
that emptied as you used it would recreate the loss it exists to remove.

Restoring is not a new observation, and the field notebook knows it. Bringing the same flower
back five times does not produce five proofs that its parent was hiding something — the
deductions stay honest.

Nothing new is stored to make this work. The garden already kept the genome of every retired
plant, to rebuild the background; the drawer just shows you that list. So a garden you grew
before this existed opens with its history already in it.

## Pollinators

Insects drift through the bed. Occasionally one arrives carrying pollen from a plant you retired
— the garden already keeps every retired genome to rebuild the background, so nothing new is
stored — and settles on a flower. It says which plant the pollen came from. Drag it onto any
bloom to cross that pollen in, and the seed is yours.

Ignore it and it leaves. Sometimes it turns out to have pollinated the flower it was sitting on
anyway, and a seed appears you did not ask for. That is the point rather than a concession:
pollination happens whether you are watching, and what makes breeding _deliberate_ is that you
intervened.

It cannot happen in a new garden. A carrier needs a retirement log to draw from and an open
flower to land on, so the first one cannot arrive until you have replaced something.

## Starting over

The garden saves itself and comes back when you return. To wipe it and start fresh, add `#new`
to the URL:

    https://musharna.github.io/heirloom/garden/#new

It asks first, because a fragment travels — a link with `#new` on the end would otherwise delete
the garden of everyone who opened it. Everything goes: plants, seeds, the background, and the
notebook. What survives is the first-run pass, on the grounds that someone asking for a new
garden already knows how to plant a seed.

There is deliberately no button for this. The game has no menus, and a permanent "delete
everything" control does not belong on a screen whose whole design is that it has none.

## Without a pointer

Tab moves between the nine plots and the seed tray. Enter picks up a plant or a seed and Enter
again drops it — onto another plant to cross them, onto the same plant to self it, onto a plot to
sow a seed, onto another seed to splice them. `C` clones, `R` reads the field notebook, Escape
cancels.

The canvas is hidden from screen readers and a parallel list of buttons carries the garden
instead. Those labels obey the same rule the rest of the game does: a plant is not named until it
has finished growing, and a seed is never named at all. Growing the plant is the reveal, and an
accessible label is the easiest place to give that away by accident — so that is a negative
control in the driver, not a comment.

A plant finishing is announced, and so is the tray discarding its oldest seed, which it has
always done silently.

## Architecture

One-way pipeline; the renderer never sees a genome.

```
Genome ──express()──▶ Phenotype ──growPlant(seed)──▶ primitives ──Canvas2D──▶ screen
   │                                                                  │
   └── inherit(A,B) + mutate ──▶ child Genome              retire ──▶ accumulation buffer
```

- `src/genome/` — loci, a linkage map, meiosis, mutation, expression, and serialization
- `src/growth/` — tropism-based agent growth; tips step, bend, branch and terminate in a bloom
- `src/render/` — Canvas2D: variable-width stroke outlines, petals, the accumulating forest
- `src/game/` — plots, the seed tray, the four verbs, save/load

Growth is seeded from a hash of the **genome alone**, never the plot, so one genome means one
canonical plant and a shared link reproduces it exactly.

## Tests

```sh
npm test
npx tsc --noEmit
```

Pure logic is unit-tested; anything touching a canvas, a pointer or localStorage is checked by a
driver that runs the real thing in a real browser:

```sh
npm run dev &     # the drivers drive a real server
npm run drive     # every one of them, in order
```

They run in CI against a production build, and the deploy waits for them — typecheck,
unit tests and a successful build all pass on a game that renders nothing and responds to no
click, so before this a render regression shipped green. Every `drive-*.mjs` is picked up by a
glob rather than named in a list, because the list is what went wrong: `drive-drawer.mjs` was
written after the workflow and shipped ungated, and nothing compared the two. `npm run drive`
now derives its list from the same directory, so CI and the local run cannot disagree about what
a driver is — and the runner is called `run-drivers.mjs` rather than `drive-all.mjs` precisely so
it does not match that glob itself and get run alongside the drivers it spawns.

- `tools/drive-verbs.mjs` — clicks real flowers, asserts the four verbs fire
- `tools/drive-forest.mjs` — retires plants, reads the background buffer's pixels back
- `tools/drive-persist.mjs` — builds a garden, reloads the page, asserts it came back
- `tools/drive-notebook.mjs` — selfs a plant, grows the seedling, reads the card
- `tools/drive-drawer.mjs` — retires plants, reopens them from the drawer, checks the thumbnails
  are different plants and that a restore adds no false evidence
- `tools/drive-keyboard.mjs` — plays the garden with no pointer: tabs to a plot, crosses two
  plants, and asserts an ungrown plant is never named
- `tools/drive-pollinator.mjs` — forces a carrier, crosses its pollen in by mouse and by
  keyboard, and asserts an ignored one leaves a seed only when it pollinated
- `tools/drive-visit.mjs` — two browser contexts, a sender and a visitor who already has a
  different garden of their own; asserts the visited bed is the sender's plant for plant, that
  the visitor's save is byte-identical afterwards, and that growth is frozen while motion is not
- `tools/check-motion.mjs` — asserts the scene moves, the geometry does not, and it runs at 60fps
- `tools/check-phone.mjs` — mobile viewport under CPU throttling, with measured floors
- `npm run soak` — plays hundreds of rounds; watches save size, heap and frame rate
- `npm run measure` — depth cues in the rendered pixels, with one genome in every plot
- `tools/check-viewports.mjs` — real device viewports; aspect distortion and rotation
- `npm run shoot` — screenshots the garden into `shots/`

Each driver carries negative controls, because a check that only ever passes proves nothing —
clicking bare sky must yield no seed, clearing storage must produce a _different_ garden, and an
empty background buffer must read as empty before any "it grew" assertion is trusted.

They take a `GARDEN_URL`, so the same checks run against the deployed site or against a local
preview of the real production bundle, not only against a dev server:

```sh
GARDEN_URL=https://musharna.github.io/heirloom/garden/ npm run drive

npm run build && npm run preview &                      # what CI does
GARDEN_URL=http://localhost:4173/heirloom/garden/ npm run drive
```

`check-phone.mjs` is the one that stays local. Its floors are a population measured on one
machine under CPU throttling, and a shared CI runner is several times slower before any throttle
is applied — a frame-rate threshold does not travel between machines.

Design and per-milestone outcomes are tracked internally.

Milestone history, including the reverts: [`CHANGELOG.md`](CHANGELOG.md).

## Licence

[MIT](LICENSE). Take it apart, grow something else from it.

_Seed_ is noio's. This is a de novo reimplementation built from playing it and from what has been
written about it — no original code, art or assets were used, and the licence above covers this
work only.
