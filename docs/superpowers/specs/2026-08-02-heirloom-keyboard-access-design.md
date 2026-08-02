# Keyboard and screen-reader access

The garden is live, public, and unplayable without a pointer. Every verb is a click or a drag on
a canvas; the only keyboard-reachable things in the whole game are the drawer figures and the
`Escape` that closes a card. This spec covers making the game playable with no pointer and no
sight.

The reason that is achievable rather than aspirational: **the mechanic is already text.** Traits,
carried alleles, provenance and the deductions the notebook derives are pure string functions in
`src/game/notebook.ts`, and the field-notebook card is already real HTML with a heading and
lists. The visuals are the pleasure; the genetics are the game, and the genetics are prose. What
is missing is a way to reach any of it and a way to know what changed.

## Decisions

**Full parity, not keyboard-only.** Both operation and narration. Keyboard-only would help a
strictly smaller group and leave the more interesting half undone.

**Milestones only for anything the player did not do.** Announce what changes what the player can
do or deduce — a plant finished growing, a verb was refused. Stay silent through blooms opening,
the sway, and the background filling in. This matches the distinction the notebook already draws:
a cross is filed when the child has **grown**, not when the seed was made.

**Instructions in a visually hidden block.** The game has no menus and this does not add one,
because it adds nothing to the screen. It is also the conventional solution, which matters: a
screen-reader user arriving at an unfamiliar game already knows to look for it.

**A hidden semantic mirror, not a focusable canvas.** Real elements, in document flow, with the
canvas `aria-hidden`. The browser does focus management, browse mode keeps working, and the
drivers can query by role and accessible name.

## Structure

A new module, `garden/a11y.ts`. It builds the mirror, keeps its labels current, announces
milestones, and reports what is focused — nothing else. `garden/garden.ts` is already 1774 lines
and this is a self-contained concern with a narrow interface.

Markup in `garden/index.html`: a visually hidden intro block, a visually hidden `<ul>` of real
`<button>`s, and a visually hidden `aria-live="polite"` region. `<canvas>` becomes
`aria-hidden="true"` — it carries nothing assistive technology can use, and leaving it exposed is
noise.

**What gets a button:** all nine plots always, including empty ones, because planting requires
focusing an empty plot. Plus one button per seed actually in the tray — not twelve fixed slots.
Eight "empty slot" stops between the player and the thing they want is what makes people abandon
a mirror.

## Keys

| Key                 | Action                                                  |
| ------------------- | ------------------------------------------------------- |
| `Tab` / `Shift-Tab` | Move between plots and tray seeds                       |
| `Enter`             | Pick up the focused thing, or drop what is held onto it |
| `C`                 | Clone the focused plant                                 |
| `R`                 | Read the focused plant's card                           |
| `Escape`            | Cancel a pickup, or close the card                      |

Deliberately no arrow keys and no roving tabindex in this pass. Tab across nine to twenty-one
stops is conventional and correct, and roving tabindex is the part of this pattern that most
often ships subtly broken.

The pointer infers three different verbs from one gesture on a bloom, and the keyboard cannot:

- a click that never became a drag is a **clone**
- a drag to another flower on the **same** plant is a **self**
- a drag to a **different** plant is a **cross**

Travel distance has no keyboard analogue, so the keyboard names what the pointer infers.
`Enter`-then-`Enter` on the same plant is a self; on a different plant, a cross; `C` is a clone.
Similarly, clicking a bloom picks it up while clicking elsewhere on a plant opens its card — a
distinction focus cannot make, since focus lands on a plant and not a pixel, which is why reading
gets its own key.

## The verb dispatch is extracted, not duplicated

`release()` currently infers the verb from geometry **and** applies it, in one function of about
eighty lines. A keyboard path that re-derives which genome to cross with which would be a second
hand-maintained copy of one truth.

That is the mechanism that has bitten this repository three times already: the enumerated CI
driver list that silently lost `drive-drawer.mjs`, the `drive-persist` coverage floor re-derived
from a sample twice, and a README test count that drifted from 332 to 346. Each time the tempting
fix updated the copy; each time the fix that held removed the copy.

So this pass extracts the five verbs into named functions that both input paths call, leaving
`release()` with only the geometry that decides **which** verb a gesture meant. This is not
optional cleanup — it is the difference between one implementation of "cross" and two that drift.

## Non-disclosure applies to the mirror

The game's central rule is that traits are never disclosed before bloom: growing the plant is the
reveal, and a carrier is _defined_ by being indistinguishable.

An accessible label is exactly where that leaks. Calling `describeTraits(code)` on a plot would
hand a screen-reader player the genome of a seedling that has not come up — deleting the most
interesting locus in the game for precisely the users this feature exists to serve.

The card already gates on `isGrown` (`garden/garden.ts:865`). The mirror uses the same gate. A
growing plant is labelled `growing`, never by its traits. **This gets a negative control in the
driver, not a comment.**

## Labels and announcements

Plot buttons read position, occupancy and state: `plot 4, empty`, `plot 2, growing`, `plot 6,
white frilled, finished`. Tray buttons read the seed's short label and its origin. Labels are
rebuilt when the garden mutates or a plot's growth state changes — not per frame.

One polite live region, firing on three things: a plant finished growing, a verb succeeded, a
verb was refused.

Milestone state is keyed on `Planting` object identity in a `WeakSet`, matching the
`WeakMap`-on-`Plant` pattern `src/game/hit.ts` already uses for the memoised cull, rather than
inventing a second idiom for the same job.

Announcing growth completion shares the `isGrown` predicate with `recordGrownPlants()` but not
its bookkeeping: the notebook files evidence only for plants with a `seedId` and parents, while
the mirror announces any plant finishing. Same predicate, different question — sharing the
predicate is the point, and neither should reimplement it.

The existing `#hint` HUD text and the `learn(verb)` teaching system stay as they are, but their
strings become input-aware: a player who last used a key should be taught keys, not drags.

## Edges

- Tray full announces the refusal rather than failing silently.
- Plot buttons persist per index, so replacing a plant cannot strand focus.
- `Escape` closes the card and returns focus to the plant it described.
- A held item that stops existing — planted, spliced — clears the hold and says so.

## Testing

A new `tools/drive-keyboard.mjs`, driving purely through `page.keyboard` and querying by role and
accessible name. The glob added in PR #3 picks it up with no workflow edit, which is the first
time that change pays for itself.

Negative controls, since every driver here carries them:

- `Enter` on an empty plot holding nothing yields no seed
- `Escape` after a pickup yields no seed
- `Tab` reaches all nine plots
- an ungrown plant's label does **not** contain its traits

Plus unit tests over the label text as a pure function, and a mutation run that breaks the
`isGrown` gate to confirm the non-disclosure control fails for the stated reason. A control
nobody has watched fail is not a control.

## Deliberately not in this pass

- Arrow-key navigation and roving tabindex.
- Any narration of continuous growth progress. Nine plots each reporting progress would talk
  constantly, which is the kind of thing screen-reader users switch off.
- A visible help panel. Sighted keyboard users get no benefit from a hidden block, but a panel is
  a menu, and the no-menus rule is load-bearing enough to leave this open rather than break it
  quietly.

## Open question

Whether the drawer, already keyboard-navigable, should join the same live-region vocabulary or
keep announcing through its own `aria-expanded` tab. Deferred until the mirror exists and the two
can be heard next to each other.
