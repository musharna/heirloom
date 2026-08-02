# Pollinators

The bed sways and gusts cross it, but nothing in the garden ever does anything. And the
accumulated forest — every plant the player has bred and replaced — is scenery. It is drawn, and
that is all it is.

Pollinators address both. Insects visit the bed; occasionally one arrives carrying pollen from a
plant in the retirement log and settles on a flower, and crossing it in is the player's move.
That turns the forest from a backdrop into a pool the player can draw on, and it gives a closed
nine-plot bed a route back to genetics it has lost.

## Decisions

**One creature, three levels of consequence, frequency inversely proportional to consequence.**

- **Ambient**, common: insects drift across the bed and change nothing.
- **Carrying**, occasional: one arrives with pollen from a named retired plant and settles on a
  flower. Crossing it in is the player's decision, and the seed is theirs.
- **Acting**, rare: a carrier that is ignored and leaves has sometimes pollinated anyway.

The third tier is not a compromise between the first two. Pollination happens whether anyone is
watching, and what makes breeding _deliberate_ is a breeder intervening. The player's inaction
letting nature take its course is the mechanic, not a concession.

**Rare, deliberately.** Enough that it happens to a player and they remember it; rare enough that
the tray never fills with seeds nobody chose. A player who wants to run the garden entirely by
hand can.

**The pollen is named.** The carrier says which retired plant it came from, so a player can
decline one and wait for a better one. This discloses nothing new: the drawer already shows every
retired plant, rendered from its true genome. Withholding it here would be the game hiding
something it hands over one tab away.

**No fifth verb.** A carrier is a drag source exactly like a bloom, and `release()` already
resolves "dragged thing onto a bloom" into a cross. The carrier is simply one more thing that can
be the dragged parent.

## Structure

A new module, `src/game/pollinator.ts` — pure and canvas-free, for the same reason `hit.ts` and
`describe.ts` are: the interesting assertions are about **rules**, and a browser test per rule is
slow and proves less. Who arrives, what they carry, when they leave, and whether an ignored
carrier pollinated are all functions of state plus an injected `rand`. Rendering and animation
stay in `garden/`.

**The entity** carries a position, a target bloom, a lifetime, and optionally `pollen: string` —
a serialized genome. Ambient insects are pollinators with no pollen, so there is one entity and
one lifecycle rather than two of each.

**Pollen comes from `retirementLog`, not `garden.retired`.** This matters and is easy to get
wrong: retired plants are composited into the background on load, so `garden.retired` comes back
**empty** after a reload (`src/game/save.ts:89`). `retirementLog` is the list that survives, up
to `REPLAY_CAP` = 200 entries.

**Accessibility is a requirement, not a nicety.** A new interactive entity that exists only on
the canvas would silently regress the keyboard and screen-reader access shipped the same day. The
carrier appears in the hidden mirror as a focusable entry: `Enter` picks it up, `Enter` on a
plant crosses. Same model as a tray seed.

## Arrival

A carrier needs somewhere to land and something to carry: **at least one open bloom, and a
non-empty retirement log.** The mechanic therefore unlocks itself — a new garden has no history,
so no carriers, and the first one cannot appear until the player has replaced something. Ambient
insects have no such requirement.

## The ignored-carrier rule

A carrier lands on a **specific** bloom and sits for a bounded time.

- Dragged onto a flower: an ordinary cross, with the partner the player chose.
- Left alone: on departure, with low probability, it has pollinated **the flower it was actually
  sitting on** — never a random one. The parent is the thing the player watched it touch, which
  makes the surprise honest rather than arbitrary.

If the plant it settled on is replaced while it sits, the carrier leaves without pollinating. A
cross with a parent that is no longer there would be evidence about a plant the player can no
longer inspect.

## Starting numbers

Named here so nobody has to guess, and gathered so they can be tuned by feel without hunting
through the code. These are opening values, not findings.

| Quantity                               | Value         |
| -------------------------------------- | ------------- |
| Ambient insects on screen at once      | 0–2           |
| Mean time between carrier arrivals     | ~90 s of play |
| How long a carrier sits before leaving | ~12 s         |
| Chance an ignored carrier pollinated   | 0.15          |

At these values a carrier turns up a little under once a minute of bloom-bearing play, and about
one ignored carrier in seven leaves a seed behind — so an unattended garden gains a wild cross
every ten minutes or so, and an attended one gains however many the player chooses to take.

They live as exported constants in `src/game/pollinator.ts` so the tests reference them rather
than restating them. A test that hard-codes `0.15` stops testing the constant the moment the
constant moves.

## Provenance, and a list that has already drifted

A pollinator cross is a real cross with real parents, so the notebook files real evidence and
every deduction stays sound. It takes a new origin, `"wild"`.

`Origin` is maintained in **two** places: the union in `src/game/garden.ts:22`, and a runtime
whitelist in the save loader at `src/game/save.ts:175`. The whitelist accepts `clone`, `self`,
`cross` and `founder` — it does **not** accept `archive`, which is a legal origin the drawer
sets.

**Root cause:** a restored plant's origin is lost across a reload because the set of legal origins
is written down twice and nothing compares the two copies.

Established rather than assumed. `archive` entered the union in `bd3ab66`, a commit that touched
only `src/game/garden.ts` and `test/game.test.ts` and never opened `save.ts`; the whitelist line
has been edited exactly once, in `d2b0fba`, which predates it. Deliberate exclusion was ruled out
by an asymmetry: `save.ts:124` and `:129` serialise `origin` **unconditionally**, including
`archive`, while `:175` refuses to read it back — write-then-silently-drop is not a design, and
`bd3ab66` shipped a test asserting the value is set.

It is dormant today, verified by enumerating every read of `.origin`: the sole behavioural
consumer is `garden/garden.ts:1106`, gated on `occ.parents`, which an archive seed never has.

It would not stay dormant. A `wild` seed **does** carry parents, so the same drift would drop the
origin on reload and the card would describe a wild cross as a founder.

### The fix is to remove the second list, not to detect it

This is the fourth appearance in this project of one mechanism — two hand-maintained lists with
nothing comparing them — after the enumerated CI drivers, the coverage floor and the README test
count. Each earlier time, the fix that held removed the copy.

A table-driven round-trip test over every `Origin` was the first thing considered here, and it is
**not** the causal fix. It leaves both lists standing: a future origin still needs two edits, and
the test only converts a silent failure into a loud one. That is a tripwire, not mechanism
removal.

The causal fix is to give the legal origins **one** definition and derive the validator from it.
A TypeScript union does not exist at runtime, which is precisely why a second, runtime copy got
written in the first place — so the single source has to be the runtime value:

```ts
export const ORIGINS = [
  "founder",
  "clone",
  "self",
  "cross",
  "archive",
  "wild",
] as const;
export type Origin = (typeof ORIGINS)[number];
```

and the loader tests membership against `ORIGINS` instead of restating it. Adding an origin then
becomes one edit, and divergence becomes impossible rather than merely detectable. Roughly six
lines across two files — no larger than the band-aid it replaces.

The round-trip test still ships, demoted to what it actually is: a cheap regression guard on top
of a fix that has already made the failure structurally impossible.

## Persistence

Nothing new is stored. Pollinators are ephemeral and a reload clears any in flight; only the seed
a wild cross produced is saved, and that is an ordinary seed. Randomness is drawn from the
existing `rand`, already seeded from the wall clock (`garden/garden.ts:143`), so this introduces
no new determinism promise and breaks none — a shared genome link still grows the same plant.

## Announcements

A carrier arriving and a wild cross both change what the player can do or deduce, so both reach
the live region. Ambient insects stay silent, consistent with the milestones-only rule.

This is load-bearing for a screen-reader player: they cannot see a seed appear, so without an
announcement they are the one player who would never learn a wild cross happened at all.

## Testing

Shaped by three test defects found in this codebase on the same day.

**The driver will not wait on a probabilistic event.** That is a flaky test by construction. It
gets a hook to force a carrier with injected pollen, and the probability rule is unit-tested
directly against `pollinator.ts` with a seeded `rand` instead of being sampled through a browser.

**Announcements are counted through the `MutationObserver` log, never read from `textContent`.**
`announce()` blanks the live region before refilling it on the next frame, so a sampled read
lands in that gap and reports silence.

**Every precondition gets a control.** A conditional precondition silently disarms the assertion
it guards, and reports the resulting failure as though the feature were broken.

Negative controls:

- no carrier arrives when the retirement log is empty
- no carrier arrives when nothing is in bloom
- an ignored carrier that does not pollinate leaves no seed
- a carrier dragged onto bare sky yields nothing
- every `Origin` value survives a save/load round trip

## Deliberately not in this pass

- Any means of refusing a wild cross. The real-world equivalent is bagging a flower; it is a
  fifth verb in a game that deliberately has four, and tier three is rare enough not to need a
  counter yet.
- Pollinator variety with different behaviour. One creature, drawn with some variation, until
  there is a reason for a second.
- Persisting pollinators across a reload.
- Any change to how the forest is drawn.
