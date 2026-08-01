# Garden Capacity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the garden more plots and a bigger tray, and add a drawer that brings any retired bloom back.

**Architecture:** Three independent changes against an existing codebase. Plot count and tray capacity are constant changes plus one derived-geometry fix in a pure function. The drawer is a DOM panel following the existing `#card` pattern, reading the `retirementLog` list that is _already_ persisted, so there is no schema change and no new storage.

**Tech Stack:** TypeScript 7, Vite 8, Vitest 4, Playwright 1.62, Canvas2D. Node 24 — the repo's conda env is `heirloom`; the system Node is 18 and fails with `SyntaxError: ... 'node:util' does not provide an export named 'styleText'`. Prefix `PATH` with `~/miniconda3/envs/heirloom/bin`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-01-heirloom-garden-capacity-design.md`. Read it before starting.
- **Branch:** `garden/capacity`, based on `m1-growth-spike`. PR #2, draft.
- **`SAVE_VERSION` stays at 2.** No save-schema change anywhere in this plan. An existing garden must load and arrive with its drawer already populated.
- **Never push to main/master, force-push, or merge.**
- **Plants keep full size.** Do not introduce a global plant scale. The bed runs `scale 1.00–0.86` against the forest's `0.82–0.64`, and the 0.86/0.82 gap is what keeps live plants legible as the subject. If a shrink ever becomes necessary the forest range must move in step.
- **§4 holds:** traits are never disclosed before bloom. Drawer entries are plants that already bloomed, so showing them is fine; a tray seed's traits are not.
- **Every driver carries negative controls.** A check that only ever passes proves nothing.
- **Never trust a test you have not seen fail.** Where red-green is impossible (Task 3), a mutation control is mandatory.
- Run `npm test` and `npx tsc --noEmit` before every commit.

## Corrections to the spec, discovered while planning

Three claims in the spec are wrong or imprecise. They are corrected here, and Task 8 fixes the spec text.

1. **`MIN_PLOT_WIDTH ~115` gives 8 plots, not 9.** With `W = 1180`, `inset = min(135, 165.2) = 135`, `usable = 910`, the formula `floor(910 / 115) + 1 = 8`. Nine needs **110** (`floor(910/110) + 1 = 9`).
2. **The derived tray gap is not a bug fix.** At `TRAY_CAP = 12` the fixed 30px gap still fits a 360px world — the row spans x=6 to x=354. The derived gap removes the silent overflow cliff at 14, making the constant tunable. Worth doing; not a repair.
3. **The `archive` evidence test cannot be "seen failing" against unfixed code.** `garden/garden.ts:931` already reads `if (!p || p.seedId === undefined || !p.parents) continue;`, and a `ReplayEntry` carries no parents, so a restored plant is excluded **by construction**. It is a regression guard, and it gets a mutation control instead of a red phase.

---

### Task 1: Tray capacity

**Files:**

- Modify: `src/game/garden.ts:88`
- Modify: `src/game/hit.ts:103-113`
- Test: `test/game.test.ts` (append)

**Interfaces:**

- Consumes: nothing.
- Produces: `TRAY_CAP = 12`; `traySlot(i: number, w: number, h: number): TrayLayout` unchanged in signature, gap now derived from `w`.

- [ ] **Step 1: Write the failing test**

Append to `test/game.test.ts`:

```ts
describe("tray geometry", () => {
  it("keeps every slot inside the world at the narrowest layout", () => {
    const w = 360;
    for (let i = 0; i < TRAY_CAP; i++) {
      const s = traySlot(i, w, 430);
      expect(s.x - s.radius, `slot ${i} left`).toBeGreaterThanOrEqual(0);
      expect(s.x + s.radius, `slot ${i} right`).toBeLessThanOrEqual(w);
    }
  });

  it("still uses the full 30px gap on a desktop world", () => {
    expect(traySlot(1, 1180, 470).x - traySlot(0, 1180, 470).x).toBeCloseTo(30);
  });

  it("holds twelve seeds", () => {
    expect(TRAY_CAP).toBe(12);
  });
});
```

Add `traySlot` to the existing `../src/game/hit` import and `TRAY_CAP` to the `../src/game/garden` import at the top of the file if they are not already there.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/game.test.ts -t "holds twelve seeds"`
Expected: FAIL — `expected 8 to be 12`.

- [ ] **Step 3: Raise the cap**

`src/game/garden.ts:88` — change the value and extend the existing comment:

```ts
export const TRAY_CAP = 12;
```

Append to that doc comment:

> Twelve rather than eight because the ratio is what matters: 8 against 6 plots and 12 against 9 are both 1.3 seeds per plot, but with nine plots the tray also drains faster.

- [ ] **Step 4: Derive the gap**

`src/game/hit.ts`, replace the body of `traySlot`:

```ts
export function traySlot(i: number, w: number, h: number): TrayLayout {
  const radius = 9;
  // Derived, not fixed at 30. At TRAY_CAP 12 a fixed gap still fits the 360px minimum world,
  // but 14 would overflow it silently — the row would be 390 wide in a 360 world and the
  // outermost seeds would sit off-screen, unclickable, with nothing to say why. Deriving it
  // means the cap can be tuned without that cliff.
  const gap = Math.min(30, (w - 40) / (TRAY_CAP - 1));
  const width = (TRAY_CAP - 1) * gap;
  return {
    x: w / 2 - width / 2 + i * gap,
    y: h - 26,
    slot: i,
    radius,
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/game/garden.ts src/game/hit.ts test/game.test.ts
git commit -m "feat(tray): twelve seeds, and a gap derived from the world width"
```

---

### Task 2: More plots

**Files:**

- Modify: `src/game/layout.ts:20,45`
- Test: `test/layout.test.ts` (append)

**Interfaces:**

- Consumes: nothing.
- Produces: `MIN_PLOT_WIDTH = 110`, `MAX_PLOTS = 9`. `computeLayout` signature unchanged.

- [ ] **Step 1: Write the failing test**

Append to `test/layout.test.ts` inside the existing `describe("computeLayout", ...)`:

```ts
it("gives a desktop world nine plots", () => {
  expect(computeLayout(1440, 900).plotXs.length).toBe(9);
});

it("gives a phone more than the old two", () => {
  expect(computeLayout(412, 839).plotXs.length).toBeGreaterThanOrEqual(3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/layout.test.ts -t "nine plots"`
Expected: FAIL — `expected 6 to be 9`.

- [ ] **Step 3: Change the constants**

`src/game/layout.ts`:

```ts
/**
 * Horizontal room one plant needs before its canopy starts colliding with a neighbour.
 *
 * Was 175, measured when the bed was a FLAT PLANE. `src/render/bed.ts` gave the bed depth in a
 * later milestone and `paintOrder` now paints furthest-first, so a nearer plant OCCLUDES a
 * further one instead of interpenetrating it. Overlap that used to look broken now reads as
 * depth, which is what makes tighter packing available at full plant size.
 *
 * 110 rather than a rounder number because it is the value that yields nine plots on a 1180
 * world: floor(910 / 110) + 1 = 9.
 */
export const MIN_PLOT_WIDTH = 110;
```

and:

```ts
export const MAX_PLOTS = 9;
```

- [ ] **Step 4: Run the tests**

Run: `npm test && npx tsc --noEmit`
Expected: all pass. `test/layout.test.ts` already asserts every plot stays inside the world with canopy room — if that one now fails, the inset or the bound is the thing to fix, not this test.

- [ ] **Step 5: Verify it does not read as clutter — this is the whole gamble**

```bash
export PATH="$HOME/miniconda3/envs/heirloom/bin:$PATH"
npm run dev &
npm run measure
```

`tools/measure-depth.mjs` renders depth cues with one genome in every plot, so genetics cannot be mistaken for position. Read the output: nearer plants must still measurably occlude further ones at the new spacing (913/8 ≈ 114px apart, down from 182px).

**If it reads as clutter, drop `MAX_PLOTS` to 8 and re-measure. Do not fix it by scaling plants down** — see Global Constraints.

- [ ] **Step 6: Verify clicking still works in a crowded bed**

Run: `node tools/drive-verbs.mjs`
Expected: PASS. `bloomAt` picks the closest centre rather than the first hit, which is what should carry this. If it fails, that is the real finding and it belongs in the PR before anything else is built.

- [ ] **Step 7: Commit**

```bash
git add src/game/layout.ts test/layout.test.ts
git commit -m "feat(bed): nine plots at full plant size, since depth now handles overlap"
```

---

### Task 3: The `archive` origin

**Files:**

- Modify: `src/game/garden.ts:16` (the `Origin` union), `src/game/garden.ts:115-127` (`addSeed`)
- Test: `test/game.test.ts` (append)

**Interfaces:**

- Consumes: `TRAY_CAP` from Task 1.
- Produces: `Origin` gains `"archive"`. `addSeed(g, genome, from?: { parents?: [string, string]; origin: Origin }): Garden` — widened so origin can be supplied without parents. `Provenance` is unchanged and still used by the cross/self/clone paths.

- [ ] **Step 1: Write the failing test**

Append to `test/game.test.ts`:

```ts
describe("archive seeds", () => {
  it("carries an origin but no parents, so it can never become evidence", () => {
    const g0 = createGarden([100, 200]);
    const g1 = addSeed(g0, randomGenome(mulberry32(7)), { origin: "archive" });
    const seed = g1.tray[0]!;
    expect(seed.origin).toBe("archive");
    expect(seed.parents).toBeUndefined();
  });

  it("still records parents for a real cross", () => {
    const rand = mulberry32(9);
    const a = randomGenome(rand);
    const b = randomGenome(rand);
    const g = addSeed(createGarden([100]), a, {
      parents: [serialize(a), serialize(b)],
      origin: "cross",
    });
    expect(g.tray[0]!.parents).toEqual([serialize(a), serialize(b)]);
    expect(g.tray[0]!.origin).toBe("cross");
  });
});
```

The second test is the positive control: it must pass in the same file that asserts the negative, or a broken `addSeed` would read as "archive seeds are safe."

Imports, if `test/game.test.ts` does not already have them. Note `mulberry32` lives at **`src/rng.ts`**, not under `src/genome/`:

```ts
import { mulberry32 } from "../src/rng";
import { randomGenome } from "../src/genome/genome";
import { serialize } from "../src/genome/serialize";
import { addSeed, createGarden } from "../src/game/garden";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/game.test.ts -t "archive"`
Expected: FAIL — TypeScript rejects `"archive"` as an `Origin`, and `{ origin }` without `parents` does not satisfy `Provenance`.

- [ ] **Step 3: Widen the union**

`src/game/garden.ts`, the `Origin` type:

```ts
export type Origin = "founder" | "clone" | "self" | "cross" | "archive";
```

Append to its doc comment:

> `archive` is a plant restored from the drawer. Distinct from `clone` because cloning MUTATES — a cloned entry would hand back a different flower than the one the player picked out of the drawer, which is the one thing a drawer must not do. Distinct from `founder` because that asserts a plant with no history, and this one has plenty; it simply is not a new observation.

- [ ] **Step 4: Widen `addSeed`**

```ts
export function addSeed(
  g: Garden,
  genome: Genome,
  from?: { parents?: [string, string]; origin: Origin },
): Garden {
  const seed: Seed = {
    id: g.nextSeedId,
    genome,
    ...(from?.parents ? { parents: from.parents } : {}),
    ...(from ? { origin: from.origin } : {}),
  };
  const tray = [...g.tray, seed];
  return {
    ...g,
    tray: tray.length > TRAY_CAP ? tray.slice(tray.length - TRAY_CAP) : tray,
    nextSeedId: g.nextSeedId + 1,
  };
}
```

One code path, not two: an `addArchiveSeed` twin would duplicate the eviction rule, and the two would drift.

- [ ] **Step 5: Run the tests**

Run: `npm test && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/game/garden.ts test/game.test.ts
git commit -m "feat(seed): an archive origin that carries no parents"
```

---

### Task 4: The drawer panel

**Files:**

- Modify: `garden/index.html` (CSS block and body)
- Modify: `garden/garden.ts` (state, render, open/close, test hooks)
- Modify: `src/game/save.ts:29` (`REPLAY_CAP`)

**Interfaces:**

- Consumes: `retirementLog: ReplayEntry[]` (already exists in `garden/garden.ts:141`).
- Produces: `window.__drawer(): { open: boolean; entries: number }` test hook. `openDrawer()`, `closeDrawer()`, `renderDrawer()` module-local.

- [ ] **Step 1: Raise the replay cap**

`src/game/save.ts:29`:

```ts
export const REPLAY_CAP = 200;
```

Append to its doc comment:

> Raised from 60 when the drawer made this list player-facing. It was sized to bound the save when it fed only the background wash, where entries past a few dozen are invisible anyway. Now it is the archive, and the cap is what the player can get back. 200 genome strings is ~2.8KB — irrelevant beside the plants themselves.

- [ ] **Step 2: Add the panel markup**

`garden/index.html`, immediately after the `#card` div:

```html
<button id="drawer-tab" aria-expanded="false" aria-controls="drawer">
  drawer
</button>
<div id="drawer" hidden role="dialog" aria-label="retired plants"></div>
```

- [ ] **Step 3: Add the CSS**

`garden/index.html`, inside the existing `<style>` block, after the `#card` rules. Deliberately borrows `#card`'s palette so the two read as the same voice:

```css
/* The drawer. Like #card, this is HTML rather than canvas — it is a browsable list, and a
   list drawn into a canvas can be neither scrolled by the browser nor read aloud. */
#drawer-tab {
  position: fixed;
  z-index: 5;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  border-bottom: 0;
  border-radius: 3px 3px 0 0;
  opacity: 0.55;
  padding: 3px 14px;
}
#drawer-tab:hover {
  opacity: 1;
}
#drawer {
  position: fixed;
  z-index: 6;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: 46vh;
  overflow-y: auto;
  background: #141a1d;
  border-top: 1px solid #33413a;
  box-shadow: 0 -6px 22px rgb(0 0 0 / 55%);
  padding: 12px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 10px;
}
#drawer[hidden] {
  display: none;
}
#drawer figure {
  margin: 0;
  cursor: pointer;
  border: 1px solid #26312c;
  border-radius: 3px;
  padding: 4px;
  text-align: center;
}
#drawer figure:hover {
  border-color: #55705f;
}
#drawer figcaption {
  font-size: 11px;
  opacity: 0.6;
  margin-top: 3px;
}
#drawer canvas {
  width: 100%;
  height: 84px;
  display: block;
}
#drawer .empty {
  grid-column: 1 / -1;
  opacity: 0.55;
  text-align: center;
  padding: 14px;
}
```

- [ ] **Step 4: Wire open/close in `garden/garden.ts`**

Near the existing `cardEl` declaration (`garden/garden.ts:820`):

```ts
const drawerEl = document.getElementById("drawer")!;
const drawerTabEl = document.getElementById("drawer-tab")!;
let drawerOpen = false;

function renderDrawer(): void {
  if (!drawerOpen) {
    drawerEl.hidden = true;
    drawerTabEl.setAttribute("aria-expanded", "false");
    return;
  }
  drawerEl.hidden = false;
  drawerTabEl.setAttribute("aria-expanded", "true");
  if (retirementLog.length === 0) {
    drawerEl.innerHTML =
      '<p class="empty">nothing retired yet — plant over a flower and it will keep here</p>';
    return;
  }
  // Newest first: the plant you just displaced is the one you are most likely to want back.
  drawerEl.innerHTML = retirementLog
    .map(
      (e, i) =>
        `<figure data-code="${e.g}" data-i="${i}" tabindex="0">` +
        `<canvas width="192" height="168"></canvas>` +
        `<figcaption>${shortLabel(e.g)}</figcaption></figure>`,
    )
    .reverse()
    .join("");
}

function openDrawer(): void {
  drawerOpen = true;
  closeCard(); // two panels over one small garden is one too many
  renderDrawer();
}

function closeDrawer(): void {
  drawerOpen = false;
  renderDrawer();
}

drawerTabEl.addEventListener("click", () => {
  if (drawerOpen) closeDrawer();
  else openDrawer();
});
```

`shortLabel` is already imported at `garden/garden.ts:20`.

- [ ] **Step 5: Close it when the garden is clicked**

Find the existing handler that closes panels on a click outside a plant (`garden/garden.ts:647`, the branch whose comment reads "anywhere else it closes whatever is open"). Add `closeDrawer();` alongside the existing `closeCard();` in that same branch. Do not add a new listener — reuse the one that already implements this behaviour.

- [ ] **Step 6: Add the test hook**

In the `Object.assign(window, { ... })` block, beside `__card` (`garden/garden.ts:1551`):

```ts
__drawer: () => ({
  open: drawerOpen,
  entries: drawerEl.querySelectorAll("figure").length,
}),
```

- [ ] **Step 7: Verify by hand**

```bash
export PATH="$HOME/miniconda3/envs/heirloom/bin:$PATH"
npm run dev
```

Open `http://localhost:5173/garden/`. The tab opens and closes the panel; with a fresh garden it says nothing is retired; after planting over a plant, one entry appears with a caption and an empty canvas. Thumbnails come in Task 5.

- [ ] **Step 8: Commit**

```bash
git add garden/index.html garden/garden.ts src/game/save.ts
git commit -m "feat(drawer): a panel over the retirement log, captions only"
```

---

### Task 5: Thumbnails

**Files:**

- Create: `src/render/thumb.ts`
- Modify: `garden/garden.ts` (paint on open)
- Test: `test/thumb.test.ts`

**Interfaces:**

- Consumes: `plantBounds(plant: Plant): Bounds` and `paintPlant(ctx, plant, untilTick?)` from `src/render/stage`; `grow` from `src/game/garden`; `parseGenome` from `src/genome/serialize`.
- Produces: `fitPlant(b: Bounds, w: number, h: number, pad?: number): Fit` — pure, testable without a DOM. `paintThumb(canvas: HTMLCanvasElement, code: string): boolean` — returns false for an unparseable code.

- [ ] **Step 1: Write the failing test**

Create `test/thumb.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fitPlant } from "../src/render/thumb";

describe("fitPlant", () => {
  it("fits a tall plant by its limiting dimension", () => {
    const f = fitPlant({ minX: -20, minY: -200, maxX: 20, maxY: 0 }, 96, 84, 0);
    // 40 wide by 200 tall into 96x84: height is limiting, 84/200 = 0.42.
    expect(f.scale).toBeCloseTo(0.42);
  });

  it("centres what it fits", () => {
    const f = fitPlant({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 200, 100, 0);
    // Square into a wide box: scale 1, so 100 wide centred in 200 leaves 50 either side.
    expect(f.scale).toBeCloseTo(1);
    expect(f.dx).toBeCloseTo(50);
    expect(f.dy).toBeCloseTo(0);
  });

  it("never returns a zero or negative scale for a degenerate plant", () => {
    const f = fitPlant({ minX: 0, minY: 0, maxX: 0, maxY: 0 }, 96, 84, 0);
    expect(f.scale).toBeGreaterThan(0);
  });
});
```

The third case is the one that matters: `plantBounds` returns all zeroes for an empty plant, and a zero scale makes a canvas some engines reject outright — the same failure `paintPlantCached` already guards against.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/thumb.test.ts`
Expected: FAIL — `Cannot find module '../src/render/thumb'`.

- [ ] **Step 3: Write the module**

Create `src/render/thumb.ts`:

```ts
import { parseGenome } from "../genome/serialize";
import { grow } from "../game/garden";
import { paintPlant, plantBounds, type Bounds, type Fit } from "./stage";

/**
 * Fit a plant's bounding box into a thumbnail, preserving aspect.
 *
 * Pure and separate from the painting so it can be tested without a canvas. The degenerate
 * case is real: `plantBounds` returns all zeroes for a plant with no geometry, and scaling by
 * the resulting 0 produces a transform some engines reject.
 */
export function fitPlant(b: Bounds, w: number, h: number, pad = 6): Fit {
  const bw = Math.max(1, b.maxX - b.minX);
  const bh = Math.max(1, b.maxY - b.minY);
  const scale = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
  return {
    scale,
    dx: (w - bw * scale) / 2 - b.minX * scale,
    dy: (h - bh * scale) / 2 - b.minY * scale,
  };
}

/**
 * Paint the plant a genome code grows into, into a thumbnail canvas.
 *
 * Growth is a pure function of the genome (§6), so this reproduces exactly the plant the
 * player retired — not something merely similar. Returns false rather than throwing on a bad
 * code: a drawer with one corrupt entry should show the other 199.
 */
export function paintThumb(canvas: HTMLCanvasElement, code: string): boolean {
  const parsed = parseGenome(code);
  if (!parsed.ok) return false;

  const ctx = canvas.getContext("2d");
  if (!ctx) return false;

  const planting = grow(parsed.genome, 0, 0);
  const fit = fitPlant(
    plantBounds(planting.plant),
    canvas.width,
    canvas.height,
  );

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(fit.dx, fit.dy);
  ctx.scale(fit.scale, fit.scale);
  // Fully grown: every flower open. A thumbnail of a half-grown plant would misrepresent what
  // the player gets back.
  paintPlant(ctx, planting.plant, planting.maxTick);
  ctx.restore();
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/thumb.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Paint lazily from the drawer**

In `garden/garden.ts`, add the import:

```ts
import { paintThumb } from "../src/render/thumb";
```

and, after the `drawerEl.innerHTML = ...` assignment in `renderDrawer`, attach the observer:

```ts
// Lazily, and once. Growing and painting 200 plants on open would freeze the frame; growing
// the eight that are actually on screen does not. Memoised by the browser: a figure is only
// observed until it paints, then unobserved.
const io = new IntersectionObserver(
  (entries, obs) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const fig = entry.target as HTMLElement;
      const canvas = fig.querySelector("canvas");
      const code = fig.dataset["code"];
      if (canvas && code) paintThumb(canvas as HTMLCanvasElement, code);
      obs.unobserve(fig);
    }
  },
  { root: drawerEl },
);
drawerEl.querySelectorAll("figure").forEach((f) => io.observe(f));
```

- [ ] **Step 6: Verify by hand**

With `npm run dev` running, retire several plants and open the drawer. Thumbnails paint as they scroll into view, and each is recognisably the flower that was retired. Scroll fast — nothing should stall.

- [ ] **Step 7: Commit**

```bash
git add src/render/thumb.ts test/thumb.test.ts garden/garden.ts
git commit -m "feat(drawer): lazy thumbnails, grown from the genome that made them"
```

---

### Task 6: Restore from the drawer

**Files:**

- Modify: `garden/garden.ts` (click handler in the drawer)

**Interfaces:**

- Consumes: `addSeed(g, genome, { origin: "archive" })` from Task 3; `parseGenome`.
- Produces: `window.__restoreFirst(): boolean` test hook, so the driver can restore without depending on pixel coordinates inside a scrolling panel.

- [ ] **Step 1: Add the click handler**

In `garden/garden.ts`, after the `IntersectionObserver` wiring in `renderDrawer`:

```ts
drawerEl.querySelectorAll("figure").forEach((f) => {
  f.addEventListener("click", () =>
    restoreFromDrawer((f as HTMLElement).dataset["code"]),
  );
});
```

and beside `openDrawer`:

```ts
/**
 * Put a copy of an archived plant back in the tray.
 *
 * A COPY: the entry stays in the drawer. A drawer that emptied as it was used would recreate
 * the loss it exists to remove.
 *
 * No parents, deliberately. A restored plant is the same observation the player already made,
 * not a new one — see `Origin.archive`. `garden/garden.ts`'s notebook filing skips any planting
 * without parents, so this is excluded from evidence by construction.
 */
function restoreFromDrawer(code: string | undefined): boolean {
  if (!code) return false;
  const parsed = parseGenome(code);
  if (!parsed.ok) {
    // Loud, per §10 and the shared-link path this mirrors: name what failed rather than
    // returning silently, or one corrupt entry looks like a dead click.
    notice = `that entry is unreadable — ${parsed.error}`;
    return false;
  }
  garden = addSeed(garden, parsed.genome, { origin: "archive" });
  closeDrawer();
  scheduleSave();
  return true;
}
```

`notice` is a module-level **string variable** (`garden/garden.ts:143`), not a function — assign to it, do not call it. This mirrors `takeSharedGenome` at `garden/garden.ts:287-294` exactly, which is the same operation from a different source: parse an untrusted code, `garden = addSeed(...)`, set `notice`, `scheduleSave()`.

- [ ] **Step 2: Add the test hook**

Beside `__drawer`:

```ts
__restoreFirst: () => {
  const first = drawerEl.querySelector("figure") as HTMLElement | null;
  return first ? restoreFromDrawer(first.dataset["code"]) : false;
},
```

- [ ] **Step 3: Verify by hand**

Retire a plant, open the drawer, click its thumbnail. A seed appears in the tray, the drawer closes, and the entry is **still there**. Plant the seed: the flower that comes up is the one in the thumbnail.

- [ ] **Step 4: Commit**

```bash
git add garden/garden.ts
git commit -m "feat(drawer): restoring copies a plant back into the tray"
```

---

### Task 7: The driver

**Files:**

- Create: `tools/drive-drawer.mjs`
- Modify: `package.json` (the `drive` script)
- Modify: `.github/workflows/drivers.yml` — **only if PR #1 has merged.** See Dependency below.

**Interfaces:**

- Consumes: `window.__drawer()`, `window.__restoreFirst()`, and the existing `__ready`, `__state`, `__notebook`, `__plantInto`, `__seek`, `__retiredTotal` hooks.
- Produces: an executable that exits non-zero on failure.

- [ ] **Step 1: Write the driver**

Create `tools/drive-drawer.mjs`, following `tools/drive-notebook.mjs`'s structure exactly — same `GARDEN_URL` default, same `check()` helper, same `pageerror` capture, same `waitForFunction(() => window.__ready === true)` preamble, same `localStorage.clear()` + reload:

```js
/**
 * Real-execution check for the drawer.
 *
 * The unit suite proves `fitPlant` centres a box and that an archive seed carries no parents.
 * It cannot prove a player can GET a plant back: that needs a retirement to reach the replay
 * log, the log to reach the panel, a thumbnail to actually paint, and a restore to land a
 * seed in the tray without contaminating the notebook. Every one of those sits between the
 * player and the flower, and a fixture exercises none of them.
 */

// ... preamble copied from drive-notebook.mjs ...

const drawer = () => page.evaluate(() => window.__drawer());
const notebook = () => page.evaluate(() => window.__notebook());
const state = () => page.evaluate(() => window.__state());

// NEGATIVE CONTROL, before anything else. If an empty garden already reported entries, every
// "it has entries" assertion below would pass on a broken drawer.
await page.click("#drawer-tab");
check("an empty garden has an empty drawer", (await drawer()).entries === 0);
await page.click("#drawer-tab");

// Retire plants by planting over occupied plots.
const retiredBefore = await page.evaluate(() => window.__retiredTotal());
for (let i = 0; i < 3; i++) {
  await page.evaluate((p) => window.__plantInto(p), 0);
  await page.evaluate(() => window.__seek(400));
}
const retiredAfter = await page.evaluate(() => window.__retiredTotal());
check(
  "planting over a plant retires it",
  retiredAfter > retiredBefore,
  `${retiredBefore} -> ${retiredAfter}`,
);

await page.click("#drawer-tab");
const open = await drawer();
check(
  "the drawer lists what was retired",
  open.open && open.entries > 0,
  `entries=${open.entries}`,
);

// A thumbnail that never painted is a transparent canvas, and a caption alone would still
// have made the assertion above pass.
const painted = await page.evaluate(() => {
  const c = document.querySelector("#drawer figure canvas");
  if (!c) return -1;
  const px = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let lit = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] > 8) lit++;
  return lit;
});
check(
  "a thumbnail actually paints pixels",
  painted > 50,
  `${painted} lit pixels`,
);

const crossesBefore = (await notebook()).crosses;
const trayBefore = (await state()).tray;
check(
  "restoring puts a seed in the tray",
  await page.evaluate(() => window.__restoreFirst()),
);
check("the tray grew by one", (await state()).tray === trayBefore + 1);

// The entry must SURVIVE being taken, or the drawer recreates the loss it exists to remove.
await page.click("#drawer-tab");
check(
  "the entry is still in the drawer after restoring",
  (await drawer()).entries === open.entries,
);
await page.click("#drawer-tab");

// THE ONE THAT MATTERS. A restored plant is an observation already made; counting it again
// would manufacture proof that its parent carries a recessive.
await page.evaluate(() => window.__plantInto(1));
await page.evaluate(() => window.__seek(400));
check(
  "a restored plant adds no notebook evidence",
  (await notebook()).crosses === crossesBefore,
  `${crossesBefore} -> ${(await notebook()).crosses}`,
);

check("no page errors", errors.length === 0, errors.join("; "));
await browser.close();
process.exit(failures ? 1 : 0);
```

Before writing, confirm the real shapes of `window.__state()` and `window.__notebook()` at `garden/garden.ts:1399` and `:1542` and use their actual field names — `state().tray` and `notebook().crosses` are the expected ones but **verify, do not assume**.

- [ ] **Step 2: Run it green**

```bash
export PATH="$HOME/miniconda3/envs/heirloom/bin:$PATH"
npm run dev &
node tools/drive-drawer.mjs
```

Expected: every line PASS.

- [ ] **Step 3: The mutation control — this replaces the red phase**

The evidence assertion cannot be seen failing against unfixed code, because `garden/garden.ts:931` already skips parentless plantings. So prove the test _can_ fail by breaking the guard it depends on.

Temporarily edit `garden/garden.ts:931`, removing the parents check:

```ts
if (!p || p.seedId === undefined) continue;
```

Run: `node tools/drive-drawer.mjs`
Expected: **FAIL** on `a restored plant adds no notebook evidence`.

If it still passes, the driver is not testing what it claims and must be fixed before going on. **Revert the mutation** and confirm the file is byte-identical:

```bash
git diff --exit-code garden/garden.ts && echo "clean"
```

- [ ] **Step 4: Add it to the drive script**

`package.json`, append to the `drive` chain:

```
&& node tools/drive-drawer.mjs
```

Place it before `check-phone.mjs`, keeping the behavioural drivers together.

- [ ] **Step 5: Run every driver**

```bash
npm run drive
```

Expected: all eight PASS. Task 2 tightened the bed, so watch `drive-verbs` in particular.

- [ ] **Step 6: Commit**

```bash
git add tools/drive-drawer.mjs package.json
git commit -m "test(drawer): a driver, with the evidence guard proven by mutation"
```

**Dependency:** `.github/workflows/drivers.yml` exists only on the `ci/drivers` branch (PR #1, unmerged). If #1 has merged by now, rebase and add `- run: node tools/drive-drawer.mjs` to the driver list in that workflow, in the same commit. If it has not, say so in the PR — this work is ungated until it does.

---

### Task 8: Reconcile the spec and the README

**Files:**

- Modify: `docs/superpowers/specs/2026-08-01-heirloom-garden-capacity-design.md`
- Modify: `README.md`

- [ ] **Step 1: Correct the three spec errors**

Apply the three corrections listed at the top of this plan: `MIN_PLOT_WIDTH` is 110 (115 yields 8), the derived tray gap is insurance rather than a repair, and the archive evidence check is a regression guard with a mutation control rather than a red-green cycle. Correct them in place — a spec that stays wrong after the code proves it wrong is worse than no spec.

- [ ] **Step 2: Update the README**

The `## Tests` section lists the drivers; add `drive-drawer.mjs`. The count "all seven, in order" becomes eight. If Task 7's CI wiring happened, the line about six drivers running in CI becomes seven.

Add a short paragraph under `## Starting over` or beside it describing the drawer: every plant you replace keeps, and the tab at the bottom brings it back.

- [ ] **Step 3: Verify the counts are true**

```bash
grep -c "^&& node tools/\|node tools/" package.json
ls tools/drive-*.mjs tools/check-*.mjs
```

Do not write a number you have not counted. A README that claims eight drivers while shipping seven is the same class of error as the "Not published" README that shipped alongside a live 0.2.0.

- [ ] **Step 4: Commit and push**

```bash
git add docs/superpowers/specs/2026-08-01-heirloom-garden-capacity-design.md README.md
git commit -m "docs: correct the spec against what implementation proved"
git push
```

- [ ] **Step 5: Update PR #2**

Mark it ready for review only if the user asks; it stays a draft otherwise. Post a comment summarising: the measured plot-count outcome from Task 2 Step 5, whether `MAX_PLOTS` landed at 9 or fell back to 8, and the mutation-control result from Task 7 Step 3.

---

## Self-review

**Spec coverage.** §1 plots → Task 2. §2 tray → Task 1. §3 drawer surface → Task 4; contents/no-schema-change → Task 4 Step 1; thumbnails → Task 5; restore + `archive` origin → Tasks 3 and 6. Testing section → Tasks 1, 2, 3, 5 (unit) and 7 (driver). Dependency note → Task 7. Spec corrections → Task 8. No section is unimplemented.

**Placeholders.** None. Every code step carries the code. Two names that this plan originally guessed were checked against the live source and corrected: `mulberry32` is at `src/rng.ts` (not `src/genome/rng.ts`), and `notice` is a string variable at `garden/garden.ts:143` (not a function). One deliberate read-first instruction remains, in Task 7 Step 1 — confirm the field names returned by `window.__state()` and `window.__notebook()` at `garden/garden.ts:1399` and `:1542`. That is an instruction to read a named line, not a gap.

**Type consistency.** `TRAY_CAP` is used by `traySlot` (Task 1) and `addSeed` (Task 3) — same import. `Origin` gains `"archive"` in Task 3 and is used in Task 6. `fitPlant`/`paintThumb` are defined in Task 5 and consumed in Tasks 5 and 6. `Bounds` and `Fit` come from `src/render/stage` and are used unchanged. `__drawer`/`__restoreFirst` are defined in Tasks 4 and 6 and consumed in Task 7.

**Out of scope, per the spec:** search, filtering, sorting beyond retirement order, pinning, provenance on entries, manual deletion, any progression or unlock mechanic.
