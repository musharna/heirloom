# Sharing a whole garden

§7 packs a single genome into a link, and that is all sharing has ever meant here: `#g=` drops
one seed into someone's tray. A player who has spent an afternoon breeding can send one flower
out of it. The bed, the growth stages, and the accumulated forest behind them — the entire
record of having played — travel nowhere.

This adds a second kind of link. `#garden=` opens a **visit**: a read-only view of someone
else's garden as it stood when they shared it.

## Decisions

**A visit, not an import.** The link never writes to the visitor's save. This is the difference
between the two fragments the game already has, and the reasoning is recorded at
`garden/garden.ts:205`: a fragment travels, so `#new` asks before it wipes. A garden link that
overwrote would be that hazard at a whole garden's scale, arriving by a route a player has no
reason to distrust. Read-only makes the question moot rather than answered.

**Read-only by construction, not by guard.** See "Architecture" — the mechanism matters enough
to have its own section.

**Frozen growth, living motion.** A half-grown plant stays half-grown; the bed still sways and
gusts still cross it. Two clocks, and only one of them is pinned. A fully live visit would
diverge from the sender's garden the moment it opened — a visitor could watch a bloom open that
the sender has never seen, at which point it is no longer their garden. A fully static one would
be the only motionless screen in a game built on motion (§23), and would read as broken.

**The forest is capped at the depth that renders.** `BACKGROUND_REPLAY = 60`
(`src/game/save.ts:47`) already governs how many retired plants are composited on load, because
past that depth a layer has washed out to under 5% contrast. Sharing all 200 of `REPLAY_CAP`
would triple the link to transmit invisibility.

**Three things do not travel.** The tray, because a visitor cannot plant. The notebook, because
it holds deductions the player worked out rather than a garden they grew. Per-plant provenance,
for the same reason and because it costs ~20 bytes a plot.

## The code

One version byte and one checksum for the whole payload, rather than the per-genome pair that
`serialize.ts` uses — at 60-plus genomes that overhead is 20% of the link. The `BitWriter` and
`BitReader` in `src/genome/serialize.ts` are reused as-is.

| Field                                     | Bytes                 |
| ----------------------------------------- | --------------------- |
| version                                   | 1                     |
| world width                               | 2                     |
| plot count + up to 9 x (8 genome + 2 age) | 91                    |
| forest count + 60 x (8 genome + 2 x)      | 601                   |
| checksum                                  | 1                     |
| **total, base64url encoded**              | **696 -> ~928 chars** |

A plot with no occupant writes a zero genome and is skipped on read, so an empty bed costs the
same as a full one and each plot record stays fixed-width.

### The bed is not always nine plots, and that is what makes the visit a photograph

`MIN_PLOTS = 2`, `MAX_PLOTS = 9` (`src/game/layout.ts:60-61`), and the count is derived from
viewport width — a phone gets fewer plots than a desktop. So the code carries a **plot count**,
and the sender's **world width** with it.

The count is stored rather than re-derived from the width, even though `computeLayout`
(`src/game/layout.ts:66`) could compute it. Deriving would tie every existing link to the current value of `MIN_PLOT_WIDTH`
(`src/game/layout.ts:36`), so tuning that constant would silently reshape gardens shared before
the change. Stored, an old link keeps the bed it was made from.

This is load-bearing rather than bookkeeping. `fromSave` rejects a save whose plot count does not
match the current layout (`src/game/save.ts:258`), which is correct for a save: same device, and
a mismatch means something is wrong. Applied to a link, that same rule would mean a phone player
simply cannot open a desktop player's garden — killing the feature for exactly the players most
likely to be handed a link in a chat.

The visit therefore renders the **sender's** world, scaled uniformly to fit the visitor's screen.
It does not reflow to the visitor's plot count. That follows from the metaphor already chosen: a
visit is a photograph of a garden at an instant, and a photograph letterboxes rather than
reflowing. It also preserves the bed-to-forest scale gap — bed 1.00-0.86 against forest 0.82,
`src/game/layout.ts:31`, which explicitly warns against buying plots by scaling plants down —
that reflowing would distort.

**Age is clamped to `maxTick` before packing.** The raw value is `now - plantedAt`
(`src/game/garden.ts:244`) and grows without bound — a garden left open overnight would overflow
two bytes and a plant would come back mid-growth on the far side. Past `maxTick` nothing about a
plant changes, so clamping loses nothing and makes the field fixed-width.

`GENOME_VERSION` is not reused. A garden code carries its own version, bumped when this layout
changes, so an old link fails loudly instead of decoding to nonsense.

### No collision with the fragments already in use

`takeSharedGenome` matches `/[#&]g=([A-Za-z0-9_-]+)/` (`garden/garden.ts:322`) and `WANTS_FRESH`
matches `/[#&]new(&|$)/` (`:212`). Neither matches `#garden=`: the first requires `=` immediately
after `g`, and the second requires `new`. Verified rather than assumed, because a partial match
here would mean a garden link silently planting one seed instead.

## Architecture

A fourth Vite entry, `visit/`, beside `main`, `garden` and `lookdev` in `vite.config.ts`. It
imports the renderer, the background compositor and a new decoder. It does **not** import the
four verbs, the save writer, or the pollinators.

The alternative was a `visiting` flag inside `garden/garden.ts`, and it is a much smaller diff.
It was rejected on mechanism. The flag would have to be honoured in pointer handling, the tick
loop, the save scheduler, the pollinator spawner, the a11y mirror and the drawer — six guards,
each of which can be forgotten, and whose failure is silent: a missed guard writes a stranger's
garden over the visitor's own. That is the shape this project has already been bitten by four
times (the CI driver list, the coverage floor, the README count, the `Origin` union) — two
sources of truth about one rule, with nothing comparing them. A separate entry point removes the
mechanism instead of guarding it, because a function that is not on the module graph cannot be
called by accident.

The decoder is its own module, `src/game/postcard.ts`, which never touches `localStorage`. Not
"does not call the save writer" — does not import it.

**A shared `src/scene.ts` comes out of `garden/garden.ts`**: canvas sizing, layout, and the
motion clock, which both entries need. That file is 2,210 lines, more than three times the next
largest in the project, and this is the seam it has wanted for a while. Extraction only — no
behaviour change, so the existing drivers are the regression test for it.

## Producing the link

A line at the head of the drawer: **copy a link to this garden**.

The drawer is already the garden's history — `renderDrawer` lists every entry in the retirement
log (`garden/garden.ts:1346`), which is exactly what the link carries. It is already
`role="dialog"` with a keyboard-reachable tab (`garden/index.html:294-297`), so the button joins
the tab order for free and needs no new chrome on a screen designed to have almost none.

Clicking the sky was considered and rejected: empty-space clicks are already the dismiss gesture
(`garden/garden.ts:992`), and overloading them would break the one interaction a panel over a
game board has to have.

Copying reuses the bloom card's existing path, including its fallback — clipboard access is
permission-gated, and the current code already shows the URL when it is denied
(`garden/garden.ts:1832-1842`).

## The visit

A strip across the top: **you're visiting a shared garden**, with **return to your own garden**
beside it — or **start your own garden** when the visitor has no save. Persistent, because the
read-only mode is persistent: a notice that faded would leave someone clicking at an
unresponsive garden with no way to find out why. This is a mode indicator, not a menu.

**Screen-reader parity.** The visit carries the hidden mirror, but as a **list rather than
buttons** — there is nothing to activate. A blind visitor hears the bed they are visiting.
Shipping a visual-only feature one day after building the mirror would undo the point of having
built it.

## Failure

Every failure is named and shown, per §10 and the project's fail-loud rule. A malformed
`#garden=` says what was wrong with it — the shape `takeSharedGenome` already uses for
`that shared link is not a genome — <error>` — and offers to start a garden, rather than
rendering an empty one and letting the player conclude the sender's garden is bare.

Nothing about a failed visit touches the visitor's save, which is true by construction rather
than by handling.

## Testing

Unit tests over `postcard.ts`: every genome survives the round trip byte-exact, age clamps at
`maxTick`, the forest caps at 60, a garden with an empty forest round-trips, a bare bed
round-trips, and both a bad version byte and a bad checksum are rejected by name.

Then `tools/drive-visit.mjs`, driving two browser contexts — a sender, and a visitor who
**already has a different garden of their own**.

Negative controls, since every driver here carries them:

- **the visitor's `localStorage` is byte-identical after the visit.** The one that matters:
  silent overwrite is the failure the architecture exists to prevent.
- a garbage `#garden=` names the failure and wipes nothing
- clicking a bloom during a visit yields no seed
- the same plant's growth stage is unchanged across two samples taken seconds apart
- **the visited bed matches the sender's actual genome codes**, not merely "the bed filled in" —
  which would pass just as well on a bed of random plants. A count cannot distinguish the right
  content from any content.
- a garden shared from a 9-plot world opens intact in a 2-plot viewport, and vice versa. The
  cross-device case is the one a real link exercises and the one a same-device test cannot see.

Plus a mutation run that makes the visit call the save writer, to confirm the `localStorage`
control fails **for the stated reason**. A control nobody has watched fail is not a control.

Three defects in this codebase in the last two days were tests that passed while broken, so:

- any mouse aiming maps canvas coordinates to page coordinates before clicking. Raw canvas
  coordinates do not throw — they land somewhere else, and the controls then pass for the wrong
  reason.
- announcements are counted through the `MutationObserver` log, never read from `textContent`.
- every precondition gets its own assertion. A conditional precondition disarms the check it
  guards and reports the result as though the feature were broken.

## Known limitation, stated rather than implied

An ungrown plant must ship its genome or it cannot be drawn at all. A determined visitor could
therefore extract a trait the sender cannot see yet. §4's non-disclosure governs what the game
shows, and the visit reuses the same `isGrown` gate (`src/game/garden.ts:244`), so nothing is
displayed early — but a published link is inspectable text, and this is an accepted limit of
sharing rather than a hole to be quietly hoped over.

## Deliberately not in this pass

- Taking cuttings from a visited garden. It needs a rule for what taking means when you are not
  in your own garden, and the read-only visit is worth having on its own first.
- Sharing the tray or the notebook.
- Any server, shortener, or stored garden. The code lives in the fragment and never leaves the
  browser, which is what makes the whole feature free to host.
- Visiting a garden from inside the drawer of your own — a gallery of gardens is a different
  feature.
