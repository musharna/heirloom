# Garden capacity: more plots, a bigger tray, and a drawer

**Date:** 2026-08-01
**Status:** approved, not yet implemented
**Supersedes nothing.** Extends `2026-07-29-heirloom-modern-seed-design.md`; every principle there still holds except the no-menus rule, which this narrows deliberately (§3).

## Why

First play-through by someone who did not build the game. The report was that the garden has
too few slots, and on being asked which of four pinches actually bit, three of them did:

1. **Blooms are lost permanently.** Planting over a plant retires it into the background for
   good, and nothing brings it back.
2. **Not enough room to work.** A desktop gets 6 plots. A breeding project holds two parents,
   leaving ~4 for seedlings — against a tight-linkage target (`r = 0.06`) that needs roughly
   seventeen gametes to hit.
3. **The 8-seed tray.** Crosses pile up faster than they can be planted, and at the cap the
   oldest seed is silently evicted.

The fourth option — wanting a lever for its own sake, an expansion to earn or unlock — was
**not** selected. No progression system is designed here, and none should be added.

Two shapes were offered and both were chosen: an explicit drawer, and raising the numbers. A
third (reclaiming blooms by clicking them in the accumulated background) was rejected and is
not designed here.

## §1 — More plots

`MIN_PLOT_WIDTH: 175 -> ~115`, `MAX_PLOTS: 6 -> 9`, at **full plant size**.

The 175 is documented as the room a canopy needs before colliding with a neighbour. That was
measured when the bed was a flat plane. `src/render/bed.ts` gave the bed depth in a later
milestone, and `paintOrder` now returns plot indices furthest-first, so a nearer plant **occludes** a
further one. Overlap that used to read as interpenetration should now read as depth. The
constant that sets the plot count therefore predates the mechanism that makes it unnecessary.

That is a hypothesis about rendering, not a fact, so it gets measured: `npm run measure`
renders depth cues with one genome in every plot precisely so genetics cannot be mistaken for
position. If nine at full size reads as clutter, fall back to eight.

### Do not solve this by scaling plants down

The obvious alternative — shrink plants ~85% and fit more — **breaks the background**, and the
numbers are in `bed.ts`:

```
bed:    scale 1.00 – 0.86   alpha 1.00 – 0.84
forest: scale 0.82 – 0.64   alpha 0.50 – 0.28
```

The gap between **0.86 and 0.82** is load-bearing: the bed's furthest plant has to stay clearly
in front of the forest's nearest layer or the two read as one continuous field, collapsing the
distinction the whole accumulation mechanic rests on. A global 0.85 puts the bed's far end at
0.73 — inside the forest's range.

If a shrink ever becomes necessary, the forest range must move in step to preserve that gap.
Do not change one without the other.

### Risk

Tighter packing makes clicking a specific bloom harder in a crowded bed. `bloomAt` already
picks the closest centre rather than the first hit, added for this reason, so it should hold —
but it is the thing most likely to degrade. `drive-verbs.mjs` is the check.

## §2 — The tray

`TRAY_CAP: 8 -> 12`, and `traySlot`'s gap becomes derived instead of constant:

```ts
const gap = Math.min(30, (w - 40) / (TRAY_CAP - 1));
```

Today the gap is hardcoded at 30, making the row `(TRAY_CAP - 1) * 30` wide. At 12 slots that
is 330px, which fits a 360-wide phone with 12px to spare; at 14 it would not fit at all.
Desktop is unchanged; narrow screens tighten rather than overflow. The function stays pure and
shared between renderer and hit test, which is why it exists.

Twelve because the **ratio** is what matters. 8 seeds against 6 plots is 1.3 per plot; 12
against 9 is the same 1.3 — but with nine plots the tray also drains faster.

### Silent eviction stays

At the cap the oldest seed is dropped rather than the new cross refused. The existing rationale
holds: refusing turns a click into a failure state, and §11 of the design fixes the tone as
pressure-free.

Routing evicted seeds into the drawer was considered and rejected. A seed has not bloomed, so
§4 (traits are never disclosed before bloom) means its drawer entry could show only provenance
and no picture — a worse thing to browse than nothing.

If eviction still bites at 12, the next move is to make it **visible** — the oldest seed
visibly fading as it goes — not to hide it in an archive of flowers the player has never seen.

## §3 — The drawer

This narrows the no-menus principle. That is a deliberate, player-requested exception, not an
erosion: the garden itself gains no menu, no HUD and no buttons. One panel, for one job.

### Surface

A DOM panel `#drawer`, following `#card` exactly — `innerHTML`, hidden/shown, styled in CSS,
nothing canvas-side, so it costs no frame time while closed. A small persistent handle at the
bottom edge opens it. Clicking the garden closes it, reusing the existing panel-dismiss path.

### Contents: no new storage

`retirementLog` is already `ReplayEntry[] = { g: string, x: number }[]`, already persisted,
already ordered by retirement. Raise `REPLAY_CAP` from 60 and the drawer is that list rendered.

**`SAVE_VERSION` stays at 2.** No schema change; existing saves load untouched and arrive with
their history intact rather than starting empty.

### Thumbnails

Each entry shows the actual flower — a list of 14-character codes is useless for choosing.
Growth is a pure deterministic function of the genome, so a thumbnail is `growPlant` plus a
small render. Sixty of those on open is far too slow, so: one `<canvas>` per entry, painted
lazily via `IntersectionObserver` as it scrolls into view, memoised by genome string. Cost is
bounded by what is being looked at, not by how much has been bred.

### Restoring copies, and must not count as evidence

Taking an entry puts a seed in the tray carrying the same genome. It needs a **new `Origin`
value, `archive`**:

- not `clone`, which applies mutation and would hand back a different flower than the one
  picked;
- not `founder`, which asserts no parents.

It must be **excluded from notebook evidence**. The notebook derives carrier proofs from
observed offspring, and a restored plant is the same observation already made, not a new one.
Through the normal path, re-planting one flower five times would manufacture five independent
proofs that its parent carries a recessive — quietly corrupting the deductions that are the
most interesting thing in the game.

### Out of scope

Search, filtering, sorting beyond retirement order, pinning, provenance on entries, manual
deletion. None were asked for.

## Testing

A seventh driver, `tools/drive-drawer.mjs`:

- retire plants, open the drawer, assert thumbnails paint **non-blank** pixels;
- restore an entry, assert the grown plant is genetically identical to the original;
- negative controls, per existing convention: an empty drawer must read as empty _before_ any
  "it has entries" assertion is trusted, and a restore must **not** increment the notebook's
  evidence count.

That last assertion is written and **seen failing against un-fixed code** before the `archive`
exclusion is wired. A test never seen fail proves nothing.

Unit tests cover the pure parts: cap eviction order, `archive` excluded from `carriedBy` and
`offspringCount`, and tray gap derivation at both 360 and 1180.

### Dependency

`drive-drawer.mjs` joins CI via `.github/workflows/drivers.yml`, which exists only on the
`ci/drivers` branch (PR #1, unmerged). Until that merges, the new driver is local-only and this
work is **not** gated. Merge #1 first, or rebase.
