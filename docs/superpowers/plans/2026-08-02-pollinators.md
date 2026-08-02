# Pollinators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insects visit the bed; occasionally one arrives carrying pollen from a plant in the
retirement log, and crossing it into a flower is the player's move.

**Architecture:** A pure rules module (`src/game/pollinator.ts`) decides who arrives, what they
carry and whether an ignored carrier pollinated — all functions of state plus an injected `rand`.
A canvas module (`garden/insects.ts`) owns positions, motion and drawing. A carrier is a drag
source exactly like a bloom, so `release()` resolves it through the existing cross path and no
fifth verb is added.

**Tech Stack:** TypeScript 7, Vite 8, Vitest 4, Playwright 1.62. No runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-02-heirloom-pollinators-design.md`

## Global Constraints

- **Node 24 required.** Use `~/miniconda3/envs/heirloom/bin/node`; ambient `node` is v18 and the
  build fails on it. Prepend to `PATH` for every command here.
- `npx tsc --noEmit` must stay clean. **No new runtime dependencies** — `"dependencies": {}`.
- **The clock is ticks, not seconds.** `SPEED = 1.4` per frame at 60 fps ≈ **84 ticks/second**.
  All durations below are ticks.
- **Pollen comes from `retirementLog`, never `garden.retired`** — the latter is empty after a
  reload because retired plants are composited into the background.
- **Never wait on a probabilistic event in a driver.** Force the event through a test hook; test
  the probability rule as a pure function with a seeded `rand`.
- **Announcements are counted through the `MutationObserver` log, never read from
  `textContent`** — `announce()` blanks the region before refilling it on the next frame.
- **Every precondition gets a control**, so a failure can never be ambiguous between "the feature
  is broken" and "there was nothing to test".
- **A new interactive entity must reach the hidden mirror.** Canvas-only would regress the
  keyboard and screen-reader access.
- **Never `git add -A`** — `shots/` is gitignored now, but add files by name regardless.

---

### Task 1: Give `Origin` one definition

The causal fix from the spec, and independent of everything else. Do it first: the round-trip
test below **fails on today's code**, which is what proves the dormant bug is real rather than
theoretical.

**Files:**

- Modify: `src/game/garden.ts:22`
- Modify: `src/game/save.ts:173-177`
- Test: `test/save.test.ts`

**Interfaces:**

- Produces: `export const ORIGINS` (a `readonly` tuple) and `export type Origin =
(typeof ORIGINS)[number]`, both from `src/game/garden.ts`. `"wild"` is a member.

- [ ] **Step 1: Write the failing round-trip test**

Append to `test/save.test.ts`:

```ts
import { ORIGINS } from "../src/game/garden";

describe("origin round-trip", () => {
  // Table-driven over ORIGINS itself, not over a hand-written list. A test that restates the
  // origins is a THIRD copy of the thing that already drifted twice.
  it.each(ORIGINS)("survives a save and load: %s", (origin) => {
    const rand = mulberry32(3);
    let g = createGarden(XS);
    g = addSeed(g, randomGenome(rand), {
      parents: ["AAAAAAAAAAAAAA", "AAAAAAAAAAAAAA"],
      origin,
    });
    const saved = toSave(g, emptyNotebook(), []);
    const back = fromSave(JSON.parse(JSON.stringify(saved)));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.value.garden.tray[0]!.origin).toBe(origin);
  });
});
```

Match the existing imports in `test/save.test.ts` — it already imports `toSave`, `fromSave`,
`createGarden`, `addSeed`, `emptyNotebook`, `mulberry32`, `randomGenome` and `XS`. Add only
`ORIGINS`.

- [ ] **Step 2: Run it and watch `archive` fail**

```bash
export PATH="$HOME/miniconda3/envs/heirloom/bin:$PATH"
npx vitest run test/save.test.ts
```

Expected: FAIL on the `archive` case — `expected undefined to be "archive"`. Every other case
passes. This is the dormant bug, made observable. If `archive` passes, stop: the premise of this
task is wrong and the spec needs revisiting.

- [ ] **Step 3: Single-source the list**

In `src/game/garden.ts`, replace the union at line 22:

```ts
/**
 * Every legal origin, as a RUNTIME value with the type derived from it.
 *
 * It was a bare type union, and the save loader carried a second, hand-written copy to validate
 * against — because a TypeScript union does not exist at runtime and something has to check a
 * string read off disk. The two drifted: `archive` was added here and the loader never learned
 * it, so a restored plant's origin was silently dropped on reload.
 *
 * One definition, and the loader tests membership against it. Adding an origin is now one edit.
 */
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

In `src/game/save.ts`, replace lines 173-177:

```ts
const o = v["o"];
const origin = ORIGINS.includes(o as Origin) ? (o as Origin) : undefined;
```

and add `ORIGINS` to the existing import from `./garden`.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run test/save.test.ts && npx tsc --noEmit
```

Expected: every origin passes, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/game/garden.ts src/game/save.ts test/save.test.ts
git commit -m "fix: give Origin one definition, so the save loader cannot drift from it"
```

---

### Task 2: The rules, as a pure module

**Files:**

- Create: `src/game/pollinator.ts`
- Create: `test/pollinator.test.ts`

**Interfaces:**

- Consumes: `ReplayEntry` from `src/game/save`.
- Produces, for Tasks 3-6:
  - `AMBIENT_MAX = 2`, `CARRIER_INTERVAL_TICKS = 7560`, `CARRIER_SIT_TICKS = 1008`,
    `POLLINATED_CHANCE = 0.15`
  - `canCarrierArrive(log: ReplayEntry[], openBlooms: number): boolean`
  - `pickPollen(log: ReplayEntry[], rand: () => number): string | null`
  - `didPollinate(rand: () => number): boolean`

- [ ] **Step 1: Write the failing tests**

Create `test/pollinator.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mulberry32 } from "../src/rng";
import type { ReplayEntry } from "../src/game/save";
import {
  CARRIER_SIT_TICKS,
  POLLINATED_CHANCE,
  canCarrierArrive,
  didPollinate,
  pickPollen,
} from "../src/game/pollinator";

const log: ReplayEntry[] = [
  { g: "AAAAAAAAAAAAAA", x: 10 },
  { g: "BBBBBBBBBBBBBB", x: 20 },
];

describe("canCarrierArrive", () => {
  it("needs somewhere to land AND something to carry", () => {
    expect(canCarrierArrive(log, 4)).toBe(true);
  });

  it("refuses when the retirement log is empty", () => {
    // A new garden has no history, so the mechanic unlocks itself rather than needing a flag.
    expect(canCarrierArrive([], 4)).toBe(false);
  });

  it("refuses when nothing is in bloom", () => {
    expect(canCarrierArrive(log, 0)).toBe(false);
  });
});

describe("pickPollen", () => {
  it("returns a genome that is actually in the log", () => {
    const rand = mulberry32(1);
    for (let i = 0; i < 50; i++) {
      expect(log.map((e) => e.g)).toContain(pickPollen(log, rand));
    }
  });

  it("returns null for an empty log rather than throwing", () => {
    expect(pickPollen([], mulberry32(1))).toBeNull();
  });
});

describe("didPollinate", () => {
  it("fires at about POLLINATED_CHANCE over many draws", () => {
    // Measured, not asserted at one draw: a single call tests the RNG, not the rule.
    const rand = mulberry32(9);
    let hits = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) if (didPollinate(rand)) hits++;
    expect(hits / n).toBeGreaterThan(POLLINATED_CHANCE - 0.02);
    expect(hits / n).toBeLessThan(POLLINATED_CHANCE + 0.02);
  });

  it("is referenced from the constant, so tuning it cannot silently break the test", () => {
    expect(POLLINATED_CHANCE).toBeGreaterThan(0);
    expect(POLLINATED_CHANCE).toBeLessThan(1);
  });
});

describe("timings", () => {
  it("expresses sitting time in ticks, not seconds", () => {
    // SPEED is 1.4 per frame at 60fps, so ~84 ticks a second; 12s is ~1008.
    expect(CARRIER_SIT_TICKS).toBeGreaterThan(800);
    expect(CARRIER_SIT_TICKS).toBeLessThan(1200);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run test/pollinator.test.ts
```

Expected: FAIL — cannot resolve `../src/game/pollinator`.

- [ ] **Step 3: Write the module**

Create `src/game/pollinator.ts`:

```ts
import type { ReplayEntry } from "./save";

/**
 * The rules for pollinators: who can arrive, what they carry, and whether an ignored one
 * pollinated anyway.
 *
 * Pure and canvas-free, like `hit.ts` and `describe.ts`. The interesting assertions here are
 * about RULES, and a browser test per rule is slow and proves less — in particular, a driver
 * that waited for a 0.15-probability event to happen would be a flaky test by construction.
 *
 * The numbers are opening values chosen by feel, not findings. They live here as exported
 * constants so the tests reference them rather than restating them: a test that hard-codes 0.15
 * stops testing the constant the moment the constant moves.
 *
 * Durations are TICKS. `SPEED` is 1.4 per frame at 60fps, so a second is about 84 ticks.
 */

/** Insects with no pollen, drifting through. */
export const AMBIENT_MAX = 2;

/** Mean gap between carrier arrivals — about 90 seconds of bloom-bearing play. */
export const CARRIER_INTERVAL_TICKS = 7560;

/** How long a carrier sits before giving up and leaving — about 12 seconds. */
export const CARRIER_SIT_TICKS = 1008;

/** Chance that a carrier which was ignored turns out to have pollinated anyway. */
export const POLLINATED_CHANCE = 0.15;

/**
 * A carrier needs somewhere to land and something to carry.
 *
 * The empty-log case is why the mechanic needs no unlock flag: a new garden has no history, so
 * no carrier can arrive until the player has replaced something.
 */
export function canCarrierArrive(
  log: ReplayEntry[],
  openBlooms: number,
): boolean {
  return log.length > 0 && openBlooms > 0;
}

/** A serialized genome from the retirement log, or null when there is nothing to draw from. */
export function pickPollen(
  log: ReplayEntry[],
  rand: () => number,
): string | null {
  if (log.length === 0) return null;
  return log[Math.floor(rand() * log.length)]!.g;
}

/** Did an ignored carrier pollinate on its way out? */
export function didPollinate(rand: () => number): boolean {
  return rand() < POLLINATED_CHANCE;
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run test/pollinator.test.ts && npx tsc --noEmit
```

Expected: all PASS, typecheck clean.

- [ ] **Step 5: Watch the probability test fail**

Temporarily set `POLLINATED_CHANCE = 0.9`, re-run, and confirm the distribution test fails — a
20,000-draw test that cannot fail is a slow way of asserting nothing. Restore `0.15` and re-run.

- [ ] **Step 6: Commit**

```bash
git add src/game/pollinator.ts test/pollinator.test.ts
git commit -m "feat: the pollinator rules, as a pure module with a seeded rand"
```

---

### Task 3: Insects in the garden

**Files:**

- Create: `garden/insects.ts`
- Modify: `garden/garden.ts` — frame loop and test hooks
- Create: `tools/drive-pollinator.mjs`

**Interfaces:**

- Consumes: Task 2's constants and `pickPollen`.
- Produces, for Tasks 4-6:
  - `type Insect = { x: number; y: number; vx: number; vy: number; pollen: string | null; plotIndex: number; sitUntil: number }`
  - `updateInsects(now: number, w: number, h: number): Insect[]` — advances motion, drops
    expired insects, returns the live list
  - `spawnAmbient(w: number, h: number, rand: () => number): void`
  - `spawnCarrier(pollen: string, plotIndex: number, at: { x: number; y: number }, now: number): Insect`
  - `insects(): Insect[]`
  - `takeExpired(): Insect[]` — carriers that left this frame, for Task 6
  - `drawInsects(ctx: CanvasRenderingContext2D): void`
  - `removeInsect(i: Insect): void`

- [ ] **Step 1: Write the driver's controls, and watch them fail**

Create `tools/drive-pollinator.mjs`:

```js
/**
 * Real-execution check for pollinators.
 *
 * The unit suite proves the RULES — who may arrive, what they carry, how often an ignored
 * carrier pollinates. It cannot prove a carrier ever reaches the screen, can be picked up, or
 * produces a seed with the right parents. Those sit between the rule and the player.
 *
 * Nothing here waits on a probabilistic event. Carriers are forced through `__spawnCarrier`,
 * and the 0.15 rule is tested as a pure function in test/pollinator.test.ts.
 */
import { chromium } from "playwright";

const URL = process.env.GARDEN_URL ?? "http://localhost:5173/garden/";
const browser = await chromium.launch();
const page = await browser.newPage({
  viewportSize: { width: 1220, height: 640 },
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(URL, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => window.__ready === true, { timeout: 15000 });

let failures = 0;
function check(label, ok, detail = "") {
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!ok) failures++;
}

const state = () => page.evaluate(() => window.__state());
const bugs = () => page.evaluate(() => window.__insects());

// ── CONTROLS FIRST ───────────────────────────────────────────────────────────────────────────
// A fresh garden has no retirement log, so no carrier may exist. If one did, every "a carrier
// arrived" assertion below would pass on a broken spawner.
check(
  "CONTROL: a fresh garden has no retirement log",
  (await state()).retired === 0,
);
check(
  "CONTROL: and therefore no carrier",
  (await bugs()).filter((b) => b.pollen).length === 0,
  JSON.stringify(await bugs()),
);

// Retire a plant so there is pollen to carry.
await page.evaluate(() => window.__seek(window.__now() + 100000));
await page.waitForTimeout(200);
const codes = await page.evaluate(() => window.__codes().plots);
const donor = codes.find(Boolean);
check("CONTROL: a donor genome exists to carry", Boolean(donor), String(donor));

const spawned = await page.evaluate((g) => window.__spawnCarrier(g), donor);
check("a forced carrier appears", spawned === true);
const carriers = (await bugs()).filter((b) => b.pollen);
check(
  "the carrier is carrying the donor genome",
  carriers[0]?.pollen === donor,
  `${carriers.length} carrier(s), pollen ${carriers[0]?.pollen}`,
);

check("no page errors", errors.length === 0, errors.join(" · "));
await browser.close();
console.log(failures ? `${failures} FAILED` : "all pollinator checks passed");
process.exit(failures ? 1 : 0);
```

```bash
npm run dev &
sleep 6
node tools/drive-pollinator.mjs
```

Expected: FAIL on `a forced carrier appears` — `window.__insects` and `window.__spawnCarrier` do
not exist yet.

- [ ] **Step 2: Write `garden/insects.ts`**

```ts
import { AMBIENT_MAX, CARRIER_SIT_TICKS } from "../src/game/pollinator";

/**
 * Insects: their positions, motion and drawing.
 *
 * Deliberately separate from `src/game/pollinator.ts`, which owns the RULES. This file cannot be
 * unit-tested without a canvas and the rules can, so the split follows the same line `hit.ts`
 * draws — pure decisions on one side, pixels on the other.
 *
 * One entity, not two. An ambient insect is a carrier with no pollen, so there is a single
 * lifecycle rather than two that drift.
 */
export type Insect = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Serialized genome, or null for an ambient insect that is just passing through. */
  pollen: string | null;
  /** Which plot's flower it settled on. -1 for ambient. */
  plotIndex: number;
  /** Tick at which it gives up and leaves. */
  sitUntil: number;
};

let live: Insect[] = [];
let expired: Insect[] = [];

export const insects = (): Insect[] => live;

export function spawnAmbient(w: number, h: number, rand: () => number): void {
  if (live.filter((i) => !i.pollen).length >= AMBIENT_MAX) return;
  const fromLeft = rand() < 0.5;
  live.push({
    x: fromLeft ? -20 : w + 20,
    y: h * (0.25 + rand() * 0.4),
    vx: (fromLeft ? 1 : -1) * (0.3 + rand() * 0.4),
    vy: 0,
    pollen: null,
    plotIndex: -1,
    sitUntil: Number.MAX_SAFE_INTEGER,
  });
}

export function spawnCarrier(
  pollen: string,
  plotIndex: number,
  at: { x: number; y: number },
  now: number,
): Insect {
  const bug: Insect = {
    x: at.x,
    y: at.y,
    vx: 0,
    vy: 0,
    pollen,
    plotIndex,
    sitUntil: now + CARRIER_SIT_TICKS,
  };
  live.push(bug);
  return bug;
}

/** Remove one insect — used when its pollen has been taken. */
export function removeInsect(i: Insect): void {
  live = live.filter((x) => x !== i);
}

/**
 * Advance motion and retire anything finished.
 *
 * Carriers that time out move to `expired` rather than simply vanishing, because whether they
 * pollinated on the way out is a decision the caller has to make once, on the frame they leave.
 */
export function updateInsects(now: number, w: number, _h: number): Insect[] {
  const gone: Insect[] = [];
  live = live.filter((i) => {
    if (i.pollen) {
      if (now >= i.sitUntil) {
        gone.push(i);
        return false;
      }
      return true;
    }
    i.x += i.vx;
    i.y += Math.sin(i.x * 0.05) * 0.4;
    return i.x > -40 && i.x < w + 40;
  });
  expired.push(...gone);
  return live;
}

/** Carriers that left this frame, cleared on read. */
export function takeExpired(): Insect[] {
  const out = expired;
  expired = [];
  return out;
}

/**
 * Two strokes and a body, in the ink language the rest of the game uses.
 *
 * A carrier gets a filled abdomen so it reads as different from an ambient one without needing a
 * label — the label is for the mirror, and the mirror is for people who cannot see this.
 */
export function drawInsects(ctx: CanvasRenderingContext2D): void {
  for (const i of live) {
    ctx.save();
    ctx.translate(i.x, i.y);
    ctx.strokeStyle = "rgba(255,246,224,0.85)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.ellipse(0, 0, 3.2, 2, 0, 0, Math.PI * 2);
    if (i.pollen) {
      ctx.fillStyle = "rgba(255,226,150,0.9)";
      ctx.fill();
    }
    ctx.stroke();
    const flap = Math.sin(i.x * 0.6) * 2.2;
    ctx.beginPath();
    ctx.moveTo(-1, -1);
    ctx.quadraticCurveTo(-4, -4 - flap, -7, -1);
    ctx.moveTo(1, -1);
    ctx.quadraticCurveTo(4, -4 - flap, 7, -1);
    ctx.stroke();
    ctx.restore();
  }
}
```

- [ ] **Step 3: Wire into the frame loop and add the hooks**

In `garden/garden.ts`, add the import:

```ts
import {
  drawInsects,
  insects,
  removeInsect,
  spawnAmbient,
  spawnCarrier,
  takeExpired,
  updateInsects,
  type Insect,
} from "./insects";
import {
  canCarrierArrive,
  pickPollen,
  CARRIER_INTERVAL_TICKS,
} from "../src/game/pollinator";
```

Immediately after the existing `forest.draw(ctx);` call in the frame loop, add:

```ts
updateInsects(now, W, H);
// Ambient insects are cheap and constant; carriers are rare and gated. One in roughly
// CARRIER_INTERVAL_TICKS frames, which at 84 ticks a second is about once every 90 seconds.
if (rand() < 0.004) spawnAmbient(W, H, rand);
if (
  rand() < SPEED / CARRIER_INTERVAL_TICKS &&
  canCarrierArrive(retirementLog, bloomCount())
) {
  const pollen = pickPollen(retirementLog, rand);
  const spot = anyOpenBloom();
  if (pollen && spot) spawnCarrier(pollen, spot.plotIndex, spot, now);
}
drawInsects(ctx);
```

and two small helpers beside `plantAt`:

```ts
/** How many flowers are currently open anywhere in the bed. */
function bloomCount(): number {
  return garden.plots.reduce(
    (n, p) => n + (p.occupant ? bloomsOf(p.occupant, now).length : 0),
    0,
  );
}

/** A drawn bloom to land on, in canvas space, or null when nothing is open. */
function anyOpenBloom(): { plotIndex: number; x: number; y: number } | null {
  const all = garden.plots.flatMap((plot, plotIndex) => {
    const occ = plot.occupant;
    if (!occ) return [];
    const base = occ.plant.segments[0];
    const anchor = { x: base?.x0 ?? 0, y: base?.y0 ?? 0 };
    const d = bedDepth(plotIndex);
    return bloomsOf(occ, now).map((b) => {
      const at = toCanvasSpace(b.center, anchor, d);
      return { plotIndex, x: at.x, y: at.y };
    });
  });
  return all.length ? (all[Math.floor(rand() * all.length)] ?? null) : null;
}
```

Add to the `Object.assign(window, {...})` hook block:

```ts
  /** Live insects, so a driver can see one without waiting for a rare random event. */
  __insects: () =>
    insects().map((i) => ({ x: i.x, y: i.y, pollen: i.pollen, plotIndex: i.plotIndex })),
  /** Force a carrier onto a real open bloom. Returns false when nothing is in bloom. */
  __spawnCarrier: (pollen: string) => {
    const spot = anyOpenBloom();
    if (!spot) return false;
    spawnCarrier(pollen, spot.plotIndex, spot, now);
    return true;
  },
```

- [ ] **Step 4: Run the driver**

```bash
npx tsc --noEmit
node tools/drive-pollinator.mjs
```

Expected: every line PASS.

- [ ] **Step 5: Commit**

```bash
git add garden/insects.ts garden/garden.ts tools/drive-pollinator.mjs
git commit -m "feat: insects in the bed, and carriers that settle on a real bloom"
```

---

### Task 4: Cross a carrier in with the pointer

**Files:**

- Modify: `garden/garden.ts` — `Drag` type, `pointerdown`, `release()`
- Modify: `tools/drive-pollinator.mjs`

**Interfaces:**

- Consumes: `doCross` (already in `garden/garden.ts`), `Insect`, `removeInsect`.
- Produces: `insectAt(p: Vec2): Insect | null`, and a `Drag` variant
  `{ kind: "pollen"; bug: Insect; from: Vec2 }`.

- [ ] **Step 1: Write the failing assertions**

Append to `tools/drive-pollinator.mjs`, before the `no page errors` check:

```js
// ── CROSSING IT IN ───────────────────────────────────────────────────────────────────────────
const at = (b) => ({ x: b.x, y: b.y });
const blooms = () => page.evaluate(() => window.__blooms());

// NEGATIVE CONTROL: a carrier dragged onto bare sky must yield nothing.
const before = (await state()).tray;
let bug = (await bugs()).find((b) => b.pollen);
await page.mouse.move(bug.x, bug.y);
await page.mouse.down();
await page.mouse.move(30, 30, { steps: 8 });
await page.mouse.up();
check(
  "CONTROL: a carrier dropped on sky yields no seed",
  (await state()).tray === before,
  `tray ${before} -> ${(await state()).tray}`,
);

// Dragged onto a flower it crosses.
bug = (await bugs()).find((b) => b.pollen);
check("CONTROL: the carrier survived the failed drag", Boolean(bug));
const target =
  (await blooms()).find((b) => b.plotIndex !== bug.plotIndex) ??
  (await blooms())[0];
await page.mouse.move(bug.x, bug.y);
await page.mouse.down();
await page.mouse.move(target.x, target.y, { steps: 10 });
await page.mouse.up();
check(
  "dragging a carrier onto a flower makes a seed",
  (await state()).tray === before + 1,
  `tray ${before} -> ${(await state()).tray}`,
);
check(
  "and the carrier is gone once its pollen is taken",
  (await bugs()).filter((b) => b.pollen).length === 0,
);

const origins = await page.evaluate(() => window.__origins());
check(
  "the seed is recorded as a wild cross",
  origins.includes("wild"),
  origins.join(","),
);
```

```bash
node tools/drive-pollinator.mjs
```

Expected: FAIL from `dragging a carrier onto a flower makes a seed` onward. The sky control may
already pass — it is a control, not a feature.

- [ ] **Step 2: Make a carrier a drag source**

In `garden/garden.ts`, extend the `Drag` union:

```ts
type Drag =
  | { kind: "bloom"; plotIndex: number; genome: Genome; from: Vec2 }
  | { kind: "seed"; id: number; from: Vec2 }
  | { kind: "pollen"; bug: Insect; from: Vec2 }
  | null;
```

Add the hit test beside `plantAt`:

```ts
/** The carrier under a point, or null. Ambient insects are not draggable — they carry nothing. */
function insectAt(p: Vec2): Insect | null {
  for (const i of insects()) {
    if (!i.pollen) continue;
    if (Math.hypot(p.x - i.x, p.y - i.y) <= 12) return i;
  }
  return null;
}
```

In `pointerdown`, test for a carrier **before** the bloom test — a carrier sits on top of a
flower, so testing blooms first would always pick the flower underneath it:

```ts
const carrier = insectAt(p);
if (carrier) {
  drag = { kind: "pollen", bug: carrier, from: p };
  return;
}
```

In `release()`, add a branch before the bloom branch:

```ts
if (d.kind === "pollen") {
  const onto = bloomAt(garden, p, now, 1.15, localToPlot);
  // No partner, no cross. The carrier stays put so a fumbled drag costs nothing.
  if (!onto) return;
  const partner = garden.plots[onto.plotIndex]!.occupant!.genome;
  const pollen = parseGenome(d.bug.pollen);
  if (pollen.ok !== true) return;
  doCross(pollen.genome, partner, p, "wild");
  removeInsect(d.bug);
  return;
}
```

Give `doCross` an origin parameter, defaulting to the existing behaviour so the four verbs are
untouched:

```ts
function doCross(
  a: Genome,
  b: Genome,
  at: Vec2,
  origin: Origin = "cross",
): void {
  garden = addSeed(garden, crossOf(a, b, rand), {
    parents: [serialize(a), serialize(b)],
    origin,
  });
  learn("cross");
  flash = { at, until: now + FLASH_TICKS };
}
```

Add the test hook:

```ts
  /** Tray seed origins, so a driver can assert provenance without decoding a save. */
  __origins: () => garden.tray.map((s) => s.origin ?? "none"),
```

Note the field name. `parseGenome` returns
`{ ok: true; genome: Genome } | { ok: false; error: string }`
(`src/genome/serialize.ts:147`), so the genome is `pollen.genome` — **not** `pollen.value`, which
is the shape `fromSave` uses and the easy thing to write from memory. The narrowing on
`ok !== true` is what makes the field reachable at all.

- [ ] **Step 3: Run both drivers**

```bash
npx tsc --noEmit
node tools/drive-pollinator.mjs
node tools/drive-verbs.mjs
```

Expected: both fully PASS. `drive-verbs` matters — `pointerdown` and `release()` are shared with
the four existing verbs.

- [ ] **Step 4: Commit**

```bash
git add garden/garden.ts tools/drive-pollinator.mjs
git commit -m "feat: drag a carrier onto a flower to cross its pollen in"
```

---

### Task 5: The carrier in the mirror

**Files:**

- Modify: `src/game/describe.ts`
- Modify: `test/describe.test.ts`
- Modify: `garden/garden.ts` — `syncA11y`, `activate`
- Modify: `tools/drive-pollinator.mjs`

**Interfaces:**

- Consumes: `plotLabel`, `seedLabel`, `syncMirror`, `Target`.
- Produces: `carrierLabel(pollenCode: string): string`; `Target` gains
  `{ kind: "carrier"; index: number }`.

- [ ] **Step 1: Write the failing label test**

Append to `test/describe.test.ts`:

```ts
import { carrierLabel } from "../src/game/describe";

describe("carrierLabel", () => {
  it("names the plant the pollen came from", () => {
    const rand2 = mulberry32(21);
    const g = randomGenome(rand2);
    const code = serialize(g);
    expect(carrierLabel(code)).toContain(shortLabel(code));
    expect(carrierLabel(code)).toContain("pollen");
  });
});
```

Naming the source is deliberate and consistent: the drawer already shows every retired plant
rendered from its true genome, so this discloses nothing new.

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run test/describe.test.ts
```

Expected: FAIL — `carrierLabel` is not exported.

- [ ] **Step 3: Add the label**

In `src/game/describe.ts`:

```ts
/**
 * What a pollen carrier reads as in the mirror.
 *
 * Names its source, unlike `seedLabel`, and the difference is not an inconsistency. A tray seed
 * is anonymous because the game never shows what a seed is; a retired plant is already fully
 * disclosed by the drawer, which renders every one of them from its real genome. Withholding it
 * here would hide something the game hands over one tab away.
 */
export function carrierLabel(pollenCode: string): string {
  return `a pollinator carrying pollen from a ${shortLabel(pollenCode)}`;
}
```

- [ ] **Step 4: Put carriers in the mirror**

In `garden/a11y.ts`, extend `Target`:

```ts
export type Target =
  | { kind: "plot"; index: number }
  | { kind: "seed"; index: number }
  | { kind: "carrier"; index: number };
```

and widen `targetOf`'s guard to accept `"carrier"`.

Change `syncMirror` to take a third list, and update `syncA11y` in `garden/garden.ts`:

```ts
function syncA11y(): void {
  const carriers = insects().filter((i) => i.pollen);
  const sig =
    `${garden.tray.length}|${carriers.length}|` +
    garden.plots
      .map((p) => (!p.occupant ? "-" : isGrown(p.occupant, now) ? "g" : "w"))
      .join("");
  if (sig === a11ySig) return;
  a11ySig = sig;
  syncMirror(
    garden.plots.map((p, i) => plotLabel(i, p.occupant, now)),
    garden.tray.map((_, i) => seedLabel(i, garden.tray.length)),
    carriers.map((c) => carrierLabel(c.pollen!)),
  );
}
```

In `activate`, handle a held carrier crossing into a plot:

```ts
  if (from.kind === "carrier" && t.kind === "plot") {
    const bug = insects().filter((i) => i.pollen)[from.index];
    if (!bug || !occ) return;
    const pollen = parseGenome(bug.pollen!);
    if (pollen.ok !== true) return;
    doCross(pollen.genome, occ.genome, at, "wild");
    removeInsect(bug);
    announce("crossed in the pollen");
  } else if (...) // existing branches unchanged
```

and allow picking one up in the `if (!held)` branch — a carrier always holds something, so it
needs no occupancy check.

- [ ] **Step 5: Assert it in the driver**

Append to `tools/drive-pollinator.mjs`:

```js
// ── KEYBOARD ─────────────────────────────────────────────────────────────────────────────────
await page.evaluate((g) => window.__spawnCarrier(g), donor);
await page.waitForTimeout(120);
const names = await page.evaluate(() =>
  [...document.querySelectorAll("#mirror button")].map((b) =>
    b.textContent.trim(),
  ),
);
check(
  "the carrier is in the mirror",
  names.some((n) => n.includes("pollen")),
  names.join(" | "),
);

const trayBefore = (await state()).tray;
const carrierIdx = names.findIndex((n) => n.includes("pollen"));
await page.evaluate(
  (i) => document.querySelectorAll("#mirror button")[i].focus(),
  carrierIdx,
);
await page.keyboard.press("Enter");
const plotIdx = names.findIndex((n) => /^plot \d+, .*finished$/.test(n));
await page.evaluate(
  (i) => document.querySelectorAll("#mirror button")[i].focus(),
  plotIdx,
);
await page.keyboard.press("Enter");
check(
  "a carrier can be crossed in from the keyboard",
  (await state()).tray === trayBefore + 1,
  `tray ${trayBefore} -> ${(await state()).tray}`,
);
```

```bash
npx tsc --noEmit
node tools/drive-pollinator.mjs
node tools/drive-keyboard.mjs
```

Expected: both fully PASS.

- [ ] **Step 6: Commit**

```bash
git add src/game/describe.ts test/describe.test.ts garden/a11y.ts garden/garden.ts tools/drive-pollinator.mjs
git commit -m "feat: carriers reach the keyboard and the screen reader, not just the canvas"
```

---

### Task 6: The ignored carrier, announcements, and docs

**Files:**

- Modify: `garden/garden.ts`
- Modify: `tools/drive-pollinator.mjs`
- Modify: `package.json`, `README.md`, `CHANGELOG.md`

- [ ] **Step 1: Write the failing assertions**

Append to `tools/drive-pollinator.mjs`:

```js
// ── THE IGNORED CARRIER ──────────────────────────────────────────────────────────────────────
// Counted through the observer, never sampled: announce() blanks the region before refilling it
// on the next frame, so a textContent read lands in the gap and reports silence.
await page.evaluate(() => {
  window.__saidLog = [];
  const el = document.getElementById("say");
  new MutationObserver(() => {
    const t = el.textContent.trim();
    if (t) window.__saidLog.push(t);
  }).observe(el, { childList: true, characterData: true, subtree: true });
});

await page.evaluate((g) => window.__spawnCarrier(g), donor);
await page.waitForTimeout(150);
check(
  "a carrier arriving is announced",
  (await page.evaluate(() => window.__saidLog)).some((t) =>
    t.includes("pollen"),
  ),
  (await page.evaluate(() => window.__saidLog)).join(" | "),
);

// Force the outcome rather than waiting for a 0.15 event: the probability itself is unit-tested.
const trayPre = (await state()).tray;
await page.evaluate(() => window.__expireCarriers(true));
await page.waitForTimeout(150);
check(
  "an ignored carrier that pollinated leaves a seed",
  (await state()).tray === trayPre + 1,
);
check(
  "and says so",
  (await page.evaluate(() => window.__saidLog)).some((t) =>
    t.includes("pollinated"),
  ),
);

// NEGATIVE CONTROL: the same path with the roll going the other way must leave nothing.
await page.evaluate((g) => window.__spawnCarrier(g), donor);
await page.waitForTimeout(120);
const trayPre2 = (await state()).tray;
await page.evaluate(() => window.__expireCarriers(false));
await page.waitForTimeout(150);
check(
  "CONTROL: an ignored carrier that did NOT pollinate leaves nothing",
  (await state()).tray === trayPre2,
  `tray ${trayPre2} -> ${(await state()).tray}`,
);
```

- [ ] **Step 2: Implement departure and announcements**

In `garden/garden.ts`, after `updateInsects(now, W, H)` in the frame loop:

```ts
for (const gone of takeExpired()) resolveDeparture(gone, didPollinate(rand));
```

and the function itself:

```ts
/**
 * A carrier has left. Did it pollinate on the way out?
 *
 * The parent is the flower it was ACTUALLY SITTING ON, never a random one — the surprise has to
 * be honest, and the player watched it settle there. If that plant has since been replaced the
 * cross is abandoned: evidence about a plant that is no longer inspectable is evidence the
 * player cannot act on.
 */
function resolveDeparture(bug: Insect, pollinated: boolean): void {
  if (!pollinated || !bug.pollen) return;
  const occ = garden.plots[bug.plotIndex]?.occupant;
  if (!occ) return;
  const pollen = parseGenome(bug.pollen);
  if (pollen.ok !== true) return;
  doCross(pollen.genome, occ.genome, { x: bug.x, y: bug.y }, "wild");
  announce("a pollinator pollinated a flower before it left");
  afterVerb();
}
```

Announce arrivals where carriers are spawned, in both the random path and `__spawnCarrier`:

```ts
announce(carrierLabel(pollen));
```

Add the test hook:

```ts
  /** Expire every carrier now, with the pollination roll forced. Removes the wait on a 0.15 event. */
  __expireCarriers: (pollinated: boolean) => {
    for (const bug of insects().filter((i) => i.pollen)) {
      removeInsect(bug);
      resolveDeparture(bug, pollinated);
    }
  },
```

- [ ] **Step 3: Run everything**

```bash
npx tsc --noEmit
node tools/drive-pollinator.mjs
npm test
```

Expected: driver fully PASS; unit suite green.

- [ ] **Step 4: Register the driver and document it**

In `package.json`, add `node tools/drive-pollinator.mjs && ` to the `drive` script after
`drive-keyboard.mjs`. **Do not edit `.github/workflows/drivers.yml`** — the glob picks it up, and
the floor of 5 still holds at seven drivers.

In `README.md`, add to the driver list:

```markdown
- `tools/drive-pollinator.mjs` — forces a carrier, crosses its pollen in by mouse and by
  keyboard, and asserts an ignored one leaves a seed only when it pollinated
```

and a short section after "The drawer":

```markdown
## Pollinators

Insects drift through the bed. Occasionally one arrives carrying pollen from a plant you retired
— the garden already keeps every retired genome to rebuild the background, so nothing new is
stored — and settles on a flower. Drag it onto any bloom to cross that pollen in.

Ignore it and it leaves. Sometimes it turns out to have pollinated the flower it was sitting on
anyway, and a seed appears you did not ask for. That is the point: pollination happens whether
you are watching, and what makes breeding deliberate is that you intervened.

It cannot happen in a new garden. A carrier needs a retirement log to draw from, so the first one
cannot arrive until you have replaced something.
```

In `CHANGELOG.md`, add a section at the top under the heading:

```markdown
## Pollinators — 2026-08-02

- Insects visit the bed. Occasionally one carries pollen from a plant in the retirement log and
  settles on a flower; drag it onto any bloom to cross it in. No fifth verb — a carrier is a drag
  source like a bloom.
- An ignored carrier sometimes turns out to have pollinated the flower it sat on, producing a
  seed recorded as a wild cross with honest parentage.
- Carriers reach the keyboard and the screen reader, not only the canvas.
- Fixed: `Origin` was defined twice — a type union and a save-loader whitelist — and had already
  drifted, so a plant restored from the drawer lost its origin on reload. The origins now have
  one definition and the loader derives from it.
```

- [ ] **Step 5: Full production run**

```bash
npm run build
npx vite preview --port 4173 --strictPort &
sleep 5
GARDEN_URL=http://localhost:4173/heirloom/garden/ npm run drive
```

Expected: every driver PASS against the real production bundle, exit 0.

- [ ] **Step 6: Commit and open a draft PR**

```bash
git add garden/garden.ts tools/drive-pollinator.mjs package.json README.md CHANGELOG.md
git commit -m "feat: an ignored carrier sometimes pollinates anyway, and says so"
git push -u origin feat/pollinators
gh pr create --draft --base m1-growth-spike --title "feat: pollinators"
```

---

## Self-review

**Spec coverage.** Three tiers → Task 3 (ambient, carrier) and Task 6 (acting). Named pollen →
Task 5's `carrierLabel`. No fifth verb → Task 4 reuses `release()`. Pollen from `retirementLog` →
Task 3's frame-loop wiring. Arrival conditions → Task 2's `canCarrierArrive`, unit-tested for
both refusal cases. Ignored-carrier parent is the flower it sat on → Task 6's `resolveDeparture`,
including the replaced-plant abandonment. `wild` origin and the single-source fix → Task 1.
Persistence unchanged → nothing in any task writes to the save beyond an ordinary seed.
Announcements → Task 6. Accessibility → Task 5. Starting numbers → Task 2's exported constants.

**Not covered, deliberately:** refusing a wild cross, pollinator variety, persisting insects
across reload, and any change to how the forest is drawn — all listed as out of scope.

**Types.** `Insect` is defined in Task 3 and used in Tasks 4, 5, 6. `Target` gains `"carrier"` in
Task 5. `Origin` and `ORIGINS` come from Task 1 and are used by Task 4's `doCross` signature.
`carrierLabel` is defined in Task 5 and used in Tasks 5 and 6. `pickPollen`, `canCarrierArrive`
and `didPollinate` come from Task 2 and are used in Tasks 3 and 6. `syncMirror` takes a third
argument from Task 5 onward — its two existing call sites are both inside `syncA11y`.

**One risk worth naming.** Task 4 tests a carrier before the bloom underneath it in
`pointerdown`. If that ordering is got wrong the carrier becomes unclickable and the failure
looks like "the drag does nothing", which is why the driver asserts the carrier still exists
after the sky-drop control — a missing carrier there points at hit-test ordering rather than at
the cross.
