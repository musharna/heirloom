# Keyboard and Screen-Reader Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the garden playable with no pointer and no sight — every verb operable from the
keyboard, and the state of the bed legible to a screen reader.

**Architecture:** A visually hidden mirror of real `<button>` elements, one per plot and per tray
seed, sits in normal document flow while the canvas becomes `aria-hidden`. The browser handles
focus; a new `garden/a11y.ts` owns the mirror's construction, labels and announcements. The five
verbs are extracted out of the pointer handler first so both input paths call one implementation.

**Tech Stack:** TypeScript 7, Vite 8, Vitest 4 for units, Playwright 1.62 drivers against a real
browser. No runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-02-heirloom-keyboard-access-design.md`

## Global Constraints

- **Node 24 is required.** Use `~/miniconda3/envs/heirloom/bin/node`; ambient `node` is v18 and
  `npm run build` fails on it. Prepend to `PATH` for every command in this plan.
- `npx tsc --noEmit` must stay clean. TypeScript 7, `strict`.
- **No new runtime dependencies.** `package.json` has `"dependencies": {}` and it stays empty.
- **Non-disclosure is absolute.** Never call `shortLabel()` or `describeTraits()` on a plant that
  is not `isGrown`, and never on a tray seed at all. Traits are revealed by growing the plant.
- Tray labels carry **position only** (`seed 3 of 5`). A sighted player cannot tell their seeds
  apart; parity means equal, not better.
- **Every driver carries negative controls, and controls run first.** An empty state must read as
  empty before any "it worked" assertion is trusted.
- New drivers are picked up automatically by the glob in `.github/workflows/drivers.yml`. Do not
  edit that workflow. Its floor of `5` still holds with a sixth driver.
- **Never `git add -A`.** `shots/forest.png` and `shots/verbs.png` regenerate on driver runs and
  must stay out of commits. Add files by name.

---

### Task 1: Extract the five verbs out of the pointer handler

A pure refactor with no behaviour change. It exists so Task 4 has something to call: a keyboard
path that re-derives which genome crosses with which would be a second hand-maintained copy of
one truth.

**Files:**

- Modify: `garden/garden.ts` — `release()` at 659-742

**Interfaces:**

- Consumes: existing module-scope `garden`, `rand`, `now`, `flash`, `plotXs`, `SOIL`,
  `learn()`, and the imports `addSeed`, `cloneOf`, `crossOf`, `plantSeed`, `spliceSeeds`,
  `serialize`.
- Produces, for Task 4:
  - `doCross(a: Genome, b: Genome, at: Vec2): void`
  - `doSelf(g: Genome, at: Vec2): void`
  - `doClone(g: Genome, at: Vec2): void`
  - `doSplice(aId: number, bId: number, at: Vec2): void`
  - `doPlant(seedId: number, plotIndex: number): void`

- [ ] **Step 1: Establish the baseline is green before touching anything**

```bash
export PATH="$HOME/miniconda3/envs/heirloom/bin:$PATH"
npm run dev &
sleep 3
node tools/drive-verbs.mjs
```

Expected: every line `PASS`, exit 0. This refactor has no new test — `drive-verbs.mjs` already
exercises all four verbs through the pointer, and it is the gate. A baseline you have not seen
green cannot tell you whether you broke something.

- [ ] **Step 2: Add the five verb functions above `release()`**

Insert immediately before `function release(e: PointerEvent): void {`:

```ts
/**
 * The five verbs, each one applied.
 *
 * Split out of `release()` because the keyboard has to fire the same verbs, and the version of
 * this that lived inside the pointer handler could only be reached by inferring a verb from
 * geometry. Two input paths separately deciding "which genome crosses with which" is a second
 * hand-maintained copy of one truth — the mechanism that has already cost this project the
 * enumerated CI driver list, the drive-persist coverage floor, and a README test count.
 *
 * `release()` keeps the geometry that decides WHICH verb a gesture meant. These decide what
 * each verb DOES. `at` is only where the confirmation ring is drawn, so the keyboard can pass a
 * plot's own position and get the same feedback without a pointer.
 */
function doCross(a: Genome, b: Genome, at: Vec2): void {
  garden = addSeed(garden, crossOf(a, b, rand), {
    parents: [serialize(a), serialize(b)],
    origin: "cross",
  });
  learn("cross");
  flash = { at, until: now + FLASH_TICKS };
}

function doSelf(g: Genome, at: Vec2): void {
  garden = addSeed(garden, crossOf(g, g, rand), {
    parents: [serialize(g), serialize(g)],
    origin: "self",
  });
  learn("self");
  flash = { at, until: now + FLASH_TICKS };
}

function doClone(g: Genome, at: Vec2): void {
  garden = addSeed(garden, cloneOf(g, rand), {
    parents: [serialize(g), serialize(g)],
    origin: "clone",
  });
  learn("clone");
  flash = { at, until: now + FLASH_TICKS };
}

function doSplice(aId: number, bId: number, at: Vec2): void {
  garden = spliceSeeds(garden, aId, bId, rand);
  flash = { at, until: now + FLASH_TICKS };
}

function doPlant(seedId: number, plotIndex: number): void {
  garden = plantSeed(garden, seedId, plotIndex, SOIL, now);
  learn("plant");
  flash = { at: { x: plotXs[plotIndex]!, y: SOIL }, until: now + FLASH_TICKS };
}
```

- [ ] **Step 3: Replace the bodies inside `release()` with calls**

The bloom branch becomes:

```ts
if (d.kind === "bloom") {
  const onto = bloomAt(garden, p, now, 1.15, localToPlot);
  if (onto && onto.plotIndex !== d.plotIndex) {
    doCross(d.genome, garden.plots[onto.plotIndex]!.occupant!.genome, p);
  } else if (onto && travelled >= CLICK_SLOP) {
    doSelf(d.genome, p);
  } else if (travelled < CLICK_SLOP) {
    doClone(d.genome, p);
  }
  return;
}
```

and the seed branch:

```ts
const onto = seedAt(garden, p, W, H);
if (onto !== null && onto !== d.id) {
  doSplice(d.id, onto, p);
  return;
}
const plot = plotAt(garden, p);
if (plot !== null && p.y < SOIL + 24) doPlant(d.id, plot);
```

**Keep every existing comment** in `release()` explaining why the branches are ordered as they
are — the CROSS/SELF/CLONE distinction by travel distance, and the "only a drop above the tray
line plants" note. Move them onto the branch they describe. They are the record of why this
is not simpler, and deleting them is how it gets re-simplified wrongly later.

- [ ] **Step 4: Verify behaviour did not change**

```bash
npx tsc --noEmit
node tools/drive-verbs.mjs
```

Expected: typecheck clean; every line `PASS`. Identical output to Step 1.

- [ ] **Step 5: Commit**

```bash
git add garden/garden.ts
git commit -m "refactor: extract the five verbs so both input paths call one implementation"
```

---

### Task 2: Pure label text, with the non-disclosure gate

**Files:**

- Create: `src/game/describe.ts`
- Create: `test/describe.test.ts`

**Interfaces:**

- Consumes: `isGrown`, `Planting`, `Seed` from `src/game/garden`; `shortLabel` from
  `src/game/notebook`; `serialize` from `src/genome/serialize`.
- Produces, for Tasks 3 and 5:
  - `plotLabel(index: number, occ: Planting | null, now: number): string`
  - `seedLabel(index: number, total: number): string`
  - `grownLine(index: number, occ: Planting, now: number): string`

- [ ] **Step 1: Write the failing tests**

Create `test/describe.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mulberry32 } from "../src/rng";
import { grow, type Planting } from "../src/game/garden";
import { randomGenome } from "../src/genome/genome";
import { serialize } from "../src/genome/serialize";
import { shortLabel } from "../src/game/notebook";
import { plotLabel, seedLabel, grownLine } from "../src/game/describe";

const SOIL = 400;
const rand = mulberry32(7);
const planting = (): Planting => ({
  ...grow(randomGenome(rand), 100, SOIL),
  plantedAt: 0,
});

describe("plotLabel", () => {
  it("names an empty plot by its one-based position", () => {
    expect(plotLabel(0, null, 0)).toBe("plot 1, empty");
    expect(plotLabel(8, null, 0)).toBe("plot 9, empty");
  });

  it("says only 'growing' before the plant has finished", () => {
    const p = planting();
    expect(plotLabel(1, p, 0)).toBe("plot 2, growing");
  });

  it("NEVER leaks a trait word before the plant has finished", () => {
    // The control that matters. Traits are revealed by growing the plant; a label that names
    // them hands a screen-reader player a genome a sighted player cannot see, which deletes
    // the carrier locus for exactly the users this feature exists to serve.
    const p = planting();
    const traits = shortLabel(serialize(p.genome));
    const label = plotLabel(1, p, 0);
    for (const word of traits.split(" ")) {
      expect(label).not.toContain(word);
    }
  });

  it("names the plant once it has finished", () => {
    const p = planting();
    const label = plotLabel(5, p, p.maxTick);
    expect(label).toContain("plot 6");
    expect(label).toContain(shortLabel(serialize(p.genome)));
    expect(label).toContain("finished");
  });
});

describe("seedLabel", () => {
  it("carries position only, never traits or origin", () => {
    expect(seedLabel(2, 5)).toBe("seed 3 of 5");
  });
});

describe("grownLine", () => {
  it("announces which plot finished and what it turned out to be", () => {
    const p = planting();
    const line = grownLine(3, p, p.maxTick);
    expect(line).toContain("plot 4");
    expect(line).toContain(shortLabel(serialize(p.genome)));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH="$HOME/miniconda3/envs/heirloom/bin:$PATH"
npx vitest run test/describe.test.ts
```

Expected: FAIL — cannot resolve `../src/game/describe`.

- [ ] **Step 3: Write the implementation**

Create `src/game/describe.ts`:

```ts
import { isGrown, type Planting } from "./garden";
import { shortLabel } from "./notebook";
import { serialize } from "../genome/serialize";

/**
 * Accessible labels for the hidden mirror.
 *
 * Pure and canvas-free, for the same reason `hit.ts` is: the interesting assertions here are
 * about WORDS, and a Playwright test per phrasing is slow and proves less than a unit test.
 *
 * The `isGrown` gate is the whole point of this module. `describeTraits` and `shortLabel` will
 * happily decode any genome handed to them — they are used by the card, which only ever renders
 * a grown plant (`garden/garden.ts:865`). Nothing stops a caller pointing them at a seedling,
 * and the mirror is the one place that would plausibly try.
 */
export function plotLabel(
  index: number,
  occ: Planting | null,
  now: number,
): string {
  const n = index + 1;
  if (!occ) return `plot ${n}, empty`;
  if (!isGrown(occ, now)) return `plot ${n}, growing`;
  return `plot ${n}, ${shortLabel(serialize(occ.genome))}, finished`;
}

/**
 * Position only, deliberately.
 *
 * Seeds are drawn as generic seeds and the HUD shows only an opaque share code, so naming a
 * seed's traits or its parentage would tell a screen-reader player something no sighted player
 * can know. The tray is genuinely hard to keep track of as a result — for everyone equally. If
 * that proves unplayable the fix is to disclose seed origin in the GAME, and let this follow.
 */
export function seedLabel(index: number, total: number): string {
  return `seed ${index + 1} of ${total}`;
}

/** What the live region says when a plant finishes growing. */
export function grownLine(index: number, occ: Planting, now: number): string {
  if (!isGrown(occ, now)) return "";
  return `plot ${index + 1} finished: ${shortLabel(serialize(occ.genome))}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run test/describe.test.ts && npx tsc --noEmit
```

Expected: all PASS, typecheck clean.

- [ ] **Step 5: Watch the non-disclosure control fail**

A control nobody has seen fail is not a control. Temporarily break the gate in
`src/game/describe.ts`:

```ts
if (!isGrown(occ, now)) return `plot ${n}, growing`; // <- comment this line out
```

```bash
npx vitest run test/describe.test.ts
```

Expected: FAIL, specifically `NEVER leaks a trait word before the plant has finished`, and no
other test. Then restore the line and re-run to confirm green.

- [ ] **Step 6: Commit**

```bash
git add src/game/describe.ts test/describe.test.ts
git commit -m "feat: accessible label text, gated so traits cannot leak before bloom"
```

---

### Task 3: The hidden mirror, and the driver's controls

**Files:**

- Modify: `garden/index.html` — body, and the `<style>` block
- Create: `garden/a11y.ts`
- Modify: `garden/garden.ts` — import and call `mountMirror` / `syncMirror`
- Create: `tools/drive-keyboard.mjs`

**Interfaces:**

- Consumes: `plotLabel`, `seedLabel` from Task 2.
- Produces, for Tasks 4 and 5:
  - `mountMirror(onAct: (t: Target) => void): void`
  - `syncMirror(plots: PlotView[], seeds: number): void` where
    `type PlotView = { label: string }` and `seeds` is the tray count
  - `type Target = { kind: "plot"; index: number } | { kind: "seed"; index: number }`
  - `focusedTarget(): Target | null`
  - `announce(text: string): void` (defined here, used in Task 5)

- [ ] **Step 1: Add the markup and the hidden style**

In `garden/index.html`, add to the `<style>` block:

```css
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
```

`clip-path: inset(50%)` rather than the older `clip: rect(...)`, which is deprecated. Do not use
`display: none` or `visibility: hidden` — both remove the element from the accessibility tree,
which is the opposite of what this is for.

Replace the `<canvas>` line and add the mirror, immediately after it:

```html
<div id="wrap"><canvas id="c" aria-hidden="true"></canvas></div>
<div class="sr">
  <h1>Heirloom, a flower breeding garden</h1>
  <p>
    Nine plots and a seed tray. Tab moves between them. Enter picks up a plant
    or a seed and Enter again drops it: onto another plant to cross them, onto
    the same plant to self it, onto a plot to sow a seed, onto another seed to
    splice them. C clones the plant you are on. R reads its field notebook card.
    Escape cancels, or closes the card.
  </p>
  <p>
    A plant's traits are not named until it has finished growing, and seeds are
    never named. Growing the plant is how you find out what it is.
  </p>
</div>
<ul id="mirror" class="sr"></ul>
<div id="say" class="sr" aria-live="polite" aria-atomic="true"></div>
```

- [ ] **Step 2: Write the driver's controls, and watch them fail**

Create `tools/drive-keyboard.mjs`:

```js
/**
 * Real-execution check for keyboard and screen-reader access.
 *
 * The unit suite proves `plotLabel` refuses to name an ungrown plant. It cannot prove a player
 * can REACH a plot without a pointer: that needs the mirror to exist, to be in the accessibility
 * tree, to carry accessible names, and to be reachable by Tab in an order that matches the bed.
 * Every one of those sits between the player and the garden, and a fixture exercises none.
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
await page.evaluate(() => {
  localStorage.clear();
  localStorage.removeItem("heirloom.learned.v1");
});
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
const names = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("#mirror button")].map((b) =>
      b.textContent.trim(),
    ),
  );

// ── CONTROLS FIRST ───────────────────────────────────────────────────────────────────────────
// The canvas must be OUT of the accessibility tree before any "the mirror is reachable" claim
// is trusted; an exposed canvas would make the tree look populated whether the mirror works or
// not.
check(
  "the canvas is hidden from assistive technology",
  (await page.getAttribute("#c", "aria-hidden")) === "true",
);

const labels = await names();
check(
  "one button per plot",
  labels.filter((l) => l.startsWith("plot ")).length === 9,
  `saw ${labels.filter((l) => l.startsWith("plot ")).length}`,
);

// NON-DISCLOSURE. The single most important assertion in this file.
const before = await state();
const growing = await page.evaluate(() => {
  const g = window.__codes().plots.findIndex((c) => c !== null);
  return g;
});
check(
  "a garden starts with plants in it, so the next check is not vacuous",
  growing >= 0,
  `first occupied plot ${growing}`,
);
```

```bash
export PATH="$HOME/miniconda3/envs/heirloom/bin:$PATH"
npm run dev &
sleep 3
node tools/drive-keyboard.mjs
```

Expected: FAIL on `one button per plot` — the mirror does not exist yet. The canvas check may
already pass from Step 1; that is fine, it is a control, not a feature.

- [ ] **Step 3: Write `garden/a11y.ts`**

```ts
/**
 * The hidden semantic mirror.
 *
 * Real buttons in document flow, not a focusable canvas with a roving cursor. The browser then
 * owns focus order, focus restoration and browse mode — three things that are easy to
 * reimplement and hard to reimplement correctly — and Playwright can drive this by role and
 * accessible name instead of by pixel geometry.
 *
 * Not positioned over the canvas. Plots are drawn through a depth transform at responsive
 * geometry, so overlaying would mean syncing 21 elements against world layout forever, and the
 * focus ring is drawn in canvas anyway.
 */
export type Target =
  | { kind: "plot"; index: number }
  | { kind: "seed"; index: number };

const mirror = document.getElementById("mirror")!;
const say = document.getElementById("say")!;

let act: (t: Target) => void = () => {};

const targetOf = (el: HTMLElement): Target | null => {
  const kind = el.dataset["kind"];
  const index = Number(el.dataset["index"]);
  if (kind !== "plot" && kind !== "seed") return null;
  return { kind, index };
};

export function mountMirror(onAct: (t: Target) => void): void {
  act = onAct;
  // Delegated, so rebuilding the list never has to re-bind anything. A per-button listener is
  // how a rebuild silently drops the handlers for whichever buttons it replaced.
  mirror.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest("button");
    if (!el) return;
    const t = targetOf(el as HTMLElement);
    if (t) act(t);
  });
}

export function focusedTarget(): Target | null {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el.tagName !== "BUTTON" || !mirror.contains(el)) return null;
  return targetOf(el);
}

/**
 * Rebuild the labels.
 *
 * Reuses the existing button when the count has not changed, so focus survives. Rebuilding the
 * list wholesale on every sync would move focus back to the body every time a plant grew, which
 * reads as the page fighting the player.
 */
export function syncMirror(plotLabels: string[], seedLabels: string[]): void {
  const want = plotLabels.length + seedLabels.length;
  if (mirror.children.length !== want) {
    mirror.innerHTML = "";
    for (let i = 0; i < want; i++) {
      const li = document.createElement("li");
      li.appendChild(document.createElement("button"));
      mirror.appendChild(li);
    }
  }
  const all = [...plotLabels, ...seedLabels];
  [...mirror.querySelectorAll("button")].forEach((b, i) => {
    const isPlot = i < plotLabels.length;
    b.type = "button";
    b.dataset["kind"] = isPlot ? "plot" : "seed";
    b.dataset["index"] = String(isPlot ? i : i - plotLabels.length);
    const text = all[i] ?? "";
    if (b.textContent !== text) b.textContent = text;
  });
}

/**
 * Say something once, politely.
 *
 * Cleared and re-set on the next frame because a live region whose text is replaced with an
 * IDENTICAL string announces nothing — two plants finishing with the same description would be
 * one announcement, and the player would never learn the second had happened.
 */
export function announce(text: string): void {
  say.textContent = "";
  requestAnimationFrame(() => {
    say.textContent = text;
  });
}
```

- [ ] **Step 4: Wire it into the frame loop**

In `garden/garden.ts`, add the import beside the other local imports:

```ts
import {
  mountMirror,
  syncMirror,
  focusedTarget,
  announce,
  type Target,
} from "./a11y";
```

and the import from Task 2:

```ts
import { plotLabel, seedLabel } from "../src/game/describe";
```

Add a sync helper and call it wherever `scheduleSave()` is already called, plus once at startup:

```ts
/**
 * Push the garden's current state into the mirror.
 *
 * Called on mutation and on growth transitions, NOT per frame. The labels only change when the
 * garden changes or a plant crosses `isGrown`, and rebuilding 21 strings sixty times a second
 * to discover they are identical is the same waste the bloom cull was memoised to avoid.
 */
function syncA11y(): void {
  syncMirror(
    garden.plots.map((p, i) => plotLabel(i, p.occupant, now)),
    garden.tray.map((_, i) => seedLabel(i, garden.tray.length)),
  );
}
```

Call `mountMirror(...)` once at startup with a no-op for now — Task 4 supplies the real handler:

```ts
mountMirror(() => {});
syncA11y();
```

- [ ] **Step 5: Finish the driver's controls and run**

Append to `tools/drive-keyboard.mjs`:

```js
// An ungrown plant must not be named. Seek the clock back to zero so every plant is a seedling,
// then assert no plot label contains any word from its own plant's description.
await page.evaluate(() => window.__seek(0));
await page.waitForTimeout(60);
const codes = await page.evaluate(() => window.__codes().plots);
const seedlingLabels = await names();
let leaked = "";
for (let i = 0; i < codes.length; i++) {
  if (!codes[i]) continue;
  const label = seedlingLabels[i] ?? "";
  if (!/^plot \d+, growing$/.test(label)) leaked = `plot ${i + 1}: "${label}"`;
}
check('an ungrown plant is labelled only "growing"', leaked === "", leaked);

// Tab order reaches every plot.
await page.evaluate(() => document.body.focus());
const reached = new Set();
for (let i = 0; i < 40; i++) {
  await page.keyboard.press("Tab");
  const t = await page.evaluate(() => {
    const el = document.activeElement;
    return el && el.closest("#mirror") ? el.textContent.trim() : null;
  });
  if (t && t.startsWith("plot ")) reached.add(t);
}
check(
  "Tab reaches all nine plots",
  reached.size === 9,
  `reached ${reached.size}`,
);

check("no page errors", errors.length === 0, errors.join(" · "));
await browser.close();
console.log(failures ? `${failures} FAILED` : "all good");
process.exit(failures ? 1 : 0);
```

```bash
node tools/drive-keyboard.mjs
```

Expected: every line `PASS`.

- [ ] **Step 6: Watch the non-disclosure control fail in the browser too**

The unit control in Task 2 proves the function. This proves the wiring. Temporarily change
`syncA11y` to pass a clock that makes everything look grown:

```ts
    garden.plots.map((p, i) => plotLabel(i, p.occupant, Number.MAX_SAFE_INTEGER)),
```

```bash
node tools/drive-keyboard.mjs
```

Expected: FAIL on `an ungrown plant is labelled only "growing"`, naming the offending plot, and
nothing else. Restore `now` and re-run to confirm green.

- [ ] **Step 7: Commit**

```bash
git add garden/index.html garden/a11y.ts garden/garden.ts tools/drive-keyboard.mjs
git commit -m "feat: a hidden semantic mirror of the bed, reachable by Tab"
```

---

### Task 4: The verbs on keys

**Files:**

- Modify: `garden/garden.ts` — the `mountMirror` call and a new `keydown` listener
- Modify: `tools/drive-keyboard.mjs` — append verb assertions

**Interfaces:**

- Consumes: `doCross`, `doSelf`, `doClone`, `doSplice`, `doPlant` (Task 1); `focusedTarget`,
  `syncMirror` (Task 3).
- Produces: `window.__held()` returning `null | { kind: "plot" | "seed"; index: number }`, for
  the driver to assert a pickup happened without inspecting private state.

- [ ] **Step 1: Write the failing verb assertions**

Append to `tools/drive-keyboard.mjs`, before the `no page errors` check:

```js
// ── VERBS ────────────────────────────────────────────────────────────────────────────────────
const focusPlot = async (n) => {
  await page.evaluate((i) => {
    document.querySelectorAll("#mirror button")[i].focus();
  }, n);
};

// NEGATIVE CONTROL: Enter on an empty plot, holding nothing, must do nothing at all.
const empty = (await state()).empty;
const trayBefore = (await state()).tray;
await focusPlot(empty);
await page.keyboard.press("Enter");
check(
  "Enter on an empty plot holding nothing makes no seed",
  (await state()).tray === trayBefore,
  `tray ${trayBefore} -> ${(await state()).tray}`,
);

// NEGATIVE CONTROL: Escape after a pickup must abandon it.
const occupied = (await state()).occupied;
await focusPlot(occupied[0]);
await page.keyboard.press("Enter");
check(
  "Enter on a plant picks it up",
  (await page.evaluate(() => window.__held())) !== null,
);
await page.keyboard.press("Escape");
check(
  "Escape drops what was held",
  (await page.evaluate(() => window.__held())) === null,
);
check("a cancelled pickup makes no seed", (await state()).tray === trayBefore);

// CROSS: two different plants.
await focusPlot(occupied[0]);
await page.keyboard.press("Enter");
await focusPlot(occupied[1]);
await page.keyboard.press("Enter");
check(
  "Enter, Enter across two plants crosses them",
  (await state()).tray === trayBefore + 1,
  `tray ${(await state()).tray}`,
);

// SELF: same plant twice.
const beforeSelf = (await state()).tray;
await focusPlot(occupied[0]);
await page.keyboard.press("Enter");
await page.keyboard.press("Enter");
check(
  "Enter twice on one plant selfs it",
  (await state()).tray === beforeSelf + 1,
);

// CLONE.
const beforeClone = (await state()).tray;
await focusPlot(occupied[0]);
await page.keyboard.press("c");
check("C clones the focused plant", (await state()).tray === beforeClone + 1);

// PLANT: a held seed onto an empty plot.
const beforePlant = await state();
await page.evaluate(() => {
  document.querySelectorAll("#mirror button")[9].focus();
});
await page.keyboard.press("Enter");
await focusPlot(beforePlant.empty);
await page.keyboard.press("Enter");
check(
  "a held seed plants into an empty plot",
  (await state()).planted === beforePlant.planted + 1,
);

// READ.
await focusPlot(occupied[0]);
await page.keyboard.press("r");
check(
  "R opens the card",
  (await page.getAttribute("#card", "hidden")) === null,
);
await page.keyboard.press("Escape");
check(
  "Escape closes the card",
  (await page.getAttribute("#card", "hidden")) !== null,
);
```

```bash
node tools/drive-keyboard.mjs
```

Expected: FAIL from `Enter on a plant picks it up` onward — `window.__held` is not defined and no
key does anything.

- [ ] **Step 2: Add the held state and the key handler**

In `garden/garden.ts`, beside the other module state:

```ts
/**
 * What the keyboard is holding, which is the keyboard's analogue of `drag`.
 *
 * Deliberately separate from `drag` rather than shared. `drag` carries a canvas origin point
 * used to tell a click from a drag, and there is no such thing for a key. Folding them together
 * would mean inventing a fake origin, and the CROSS/SELF/CLONE distinction that reads travel
 * distance would then be reading a number nobody measured.
 */
let held: Target | null = null;
```

Then the handler:

```ts
/**
 * The keyboard's verbs.
 *
 * The pointer infers three different verbs from one gesture on a bloom — a click is CLONE, a
 * drag within a plant is SELF, a drag to another plant is CROSS — using distance travelled. A
 * key has no travel, so the keyboard NAMES what the pointer infers rather than guessing at it.
 */
window.addEventListener("keydown", (e) => {
  const t = focusedTarget();
  if (!t) return;

  if (e.key === "Escape") {
    if (held) {
      held = null;
      announce("put it back");
    } else closeCard();
    e.preventDefault();
    return;
  }

  const occ = t.kind === "plot" ? garden.plots[t.index]?.occupant : null;
  const at = { x: plotXs[t.index] ?? W / 2, y: SOIL };

  if (e.key === "r" || e.key === "R") {
    if (t.kind !== "plot" || !occ) return;
    inspecting = t.index;
    learn("read");
    renderCard();
    e.preventDefault();
    return;
  }

  if (e.key === "c" || e.key === "C") {
    if (t.kind !== "plot" || !occ) return;
    doClone(occ.genome, at);
    announce("cloned");
    afterVerb();
    e.preventDefault();
    return;
  }

  if (e.key !== "Enter") return;
  e.preventDefault();

  if (!held) {
    if (t.kind === "plot" && !occ) return;
    held = t;
    announce(t.kind === "plot" ? "picked up a flower" : "picked up a seed");
    return;
  }

  if (held.kind === "plot" && t.kind === "plot") {
    const from = garden.plots[held.index]?.occupant;
    if (!from) {
      held = null;
      return;
    }
    if (t.index === held.index) {
      doSelf(from.genome, at);
      announce("selfed");
    } else if (occ) {
      doCross(from.genome, occ.genome, at);
      announce("crossed");
    } else {
      held = null;
      return;
    }
  } else if (held.kind === "seed" && t.kind === "plot") {
    const seed = garden.tray[held.index];
    if (seed) {
      doPlant(seed.id, t.index);
      announce("planted");
    }
  } else if (held.kind === "seed" && t.kind === "seed") {
    const a = garden.tray[held.index];
    const b = garden.tray[t.index];
    if (a && b && a.id !== b.id) {
      doSplice(a.id, b.id, at);
      announce("spliced");
    }
  } else {
    held = null;
    return;
  }
  held = null;
  afterVerb();
});

/** Everything a verb has to do afterwards, in one place, so the next verb cannot forget one. */
function afterVerb(): void {
  syncA11y();
  scheduleSave();
}
```

Replace the placeholder `mountMirror(() => {})` so a click in the mirror routes through the same
path a key does:

```ts
mountMirror((t) => {
  const el = document.activeElement as HTMLElement | null;
  el?.blur();
  void t;
});
```

and add the test hook, inside the existing `Object.assign(window, {...})` block:

```ts
  __held: () => held,
```

- [ ] **Step 3: Run the driver**

```bash
npx tsc --noEmit
node tools/drive-keyboard.mjs
```

Expected: every line `PASS`, including the two negative controls.

- [ ] **Step 4: Confirm the pointer still works**

```bash
node tools/drive-verbs.mjs
```

Expected: every line `PASS`. The verbs are shared now, so a keyboard change can break the mouse.

- [ ] **Step 5: Commit**

```bash
git add garden/garden.ts tools/drive-keyboard.mjs
git commit -m "feat: the four verbs on keys, naming what the pointer infers from travel"
```

---

### Task 5: Milestones in the live region

**Files:**

- Modify: `garden/garden.ts` — a growth-transition watcher and the tray-overflow announcement
- Modify: `tools/drive-keyboard.mjs` — append announcement assertions

**Interfaces:**

- Consumes: `grownLine` (Task 2), `announce` (Task 3), `isGrown`, `TRAY_CAP`.
- Produces: nothing new.

- [ ] **Step 1: Write the failing announcement assertions**

Append to `tools/drive-keyboard.mjs`, before the `no page errors` check:

```js
// ── MILESTONES ───────────────────────────────────────────────────────────────────────────────
const said = () =>
  page.evaluate(() => document.getElementById("say").textContent.trim());

// CONTROL: the region must be empty before any "it announced" claim is trusted.
await page.evaluate(() => {
  document.getElementById("say").textContent = "";
});
check("the live region starts empty", (await said()) === "");

// Drive the clock past every plant's growth and expect exactly one finished announcement.
await page.evaluate(() => window.__seek(0));
await page.waitForTimeout(60);
await page.evaluate(() => window.__seek(100000));
await page.waitForTimeout(200);
const finished = await said();
check(
  "a plant finishing is announced",
  /^plot \d+ finished: /.test(finished),
  finished,
);

// A full tray DISCARDS the oldest seed rather than refusing. Fill it and expect to be told.
await page.evaluate(() => {
  document.getElementById("say").textContent = "";
});
const occ2 = (await state()).occupied;
for (let i = 0; i < 14; i++) {
  await page.evaluate((n) => {
    document.querySelectorAll("#mirror button")[n].focus();
  }, occ2[0]);
  await page.keyboard.press("c");
}
check(
  "the tray is capped",
  (await state()).tray === 12,
  `tray ${(await state()).tray}`,
);
check(
  "overflowing the tray says a seed was lost",
  (await said()).includes("oldest"),
  await said(),
);
```

```bash
node tools/drive-keyboard.mjs
```

Expected: FAIL on `a plant finishing is announced` and on the overflow line.

- [ ] **Step 2: Add the growth watcher**

In `garden/garden.ts`, beside the other module state:

```ts
/**
 * Plants whose completion has already been announced.
 *
 * Keyed on the `Planting` object rather than on a plot index or a seed id, matching the
 * `WeakMap`-on-`Plant` pattern `src/game/hit.ts` uses for the memoised cull. A plot index would
 * re-announce every replacement in that plot; a seed id does not exist for founders.
 */
const announced = new WeakSet<Planting>();

/**
 * Announce the one thing that happens without the player doing anything.
 *
 * Shares `isGrown` with `recordGrownPlants()` and nothing else. The notebook files evidence only
 * for plants that have a seed id and parents; the mirror announces ANY plant finishing, founders
 * included. Same predicate, different question — which is why the predicate is imported rather
 * than either of them re-deriving "has it finished".
 */
function announceGrown(): void {
  for (let i = 0; i < garden.plots.length; i++) {
    const p = garden.plots[i]?.occupant;
    if (!p || announced.has(p) || !isGrown(p, now)) continue;
    announced.add(p);
    announce(grownLine(i, p, now));
    syncA11y();
  }
}
```

Call `announceGrown()` from the frame loop, immediately after the existing
`recordGrownPlants()` call.

Add the imports:

```ts
import { grownLine } from "../src/game/describe";
import { TRAY_CAP } from "../src/game/garden";
```

- [ ] **Step 3: Announce the discard**

`addSeed` slices the tray to `TRAY_CAP` and drops the **oldest** seed with no signal
(`src/game/garden.ts:150`). Add to `afterVerb()`, which every verb already routes through:

```ts
function afterVerb(): void {
  // A full tray does not refuse — it DISCARDS, silently, dropping the oldest seed. That is
  // worth saying out loud: a player who has just bred something and been handed nothing has no
  // way to tell that from the verb having failed.
  if (garden.tray.length === TRAY_CAP) {
    announce("the tray is full — the oldest seed was lost");
  }
  syncA11y();
  scheduleSave();
}
```

- [ ] **Step 4: Run the driver**

```bash
npx tsc --noEmit
node tools/drive-keyboard.mjs
```

Expected: every line `PASS`.

- [ ] **Step 5: Commit**

```bash
git add garden/garden.ts tools/drive-keyboard.mjs
git commit -m "feat: announce what happens on its own — a plant finishing, a seed lost"
```

---

### Task 6: Input-aware teaching, and ship it

**Files:**

- Modify: `garden/garden.ts` — `hint()` and the `LESSONS` table at 1487
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json` — the `drive` script

**Interfaces:**

- Consumes: everything above. Produces nothing new.

- [ ] **Step 1: Make the hint text follow the input the player is actually using**

The HUD already teaches each verb until the player has performed it (`learn(verb)`, persisted).
It teaches drags. Add a modality flag beside the other state:

```ts
/**
 * Which input the player last used.
 *
 * The teaching hints name a gesture, and naming the wrong one is worse than naming none: a
 * keyboard player told to "drop it on another plant's flower" has been given an instruction they
 * cannot follow, by a game that appears not to know how it is being played.
 */
let usingKeys = false;
```

Set `usingKeys = true` at the top of the `keydown` handler from Task 4, and `usingKeys = false`
in the existing `pointerdown` listener. Then in `hint()`:

```ts
function hint(): string {
  if (usingKeys) {
    if (held?.kind === "seed")
      return "Enter on a plot to sow it · Escape to put it back";
    if (held?.kind === "plot")
      return "Enter on another plant to cross · Enter again here to self it";
    return (
      teachingHint() ?? "Tab to move · Enter to pick up · C clone · R read"
    );
  }
  // ... existing pointer text unchanged
}
```

- [ ] **Step 2: Add the driver to the `drive` script**

In `package.json`, add `node tools/drive-keyboard.mjs && ` to the `drive` script, immediately
after `drive-drawer.mjs`. **Do not edit `.github/workflows/drivers.yml`** — the glob added in
PR #3 already picks up `tools/drive-*.mjs`, and this is the first time that pays off.

- [ ] **Step 3: Run everything**

```bash
export PATH="$HOME/miniconda3/envs/heirloom/bin:$PATH"
npm test
npx tsc --noEmit
npm run build
npm run preview &
sleep 3
GARDEN_URL=http://localhost:4173/heirloom/garden/ npm run drive
```

Expected: units pass, typecheck clean, build succeeds, all drivers `PASS` against the real
production bundle. This is what CI does, and running it locally first is the difference between
finding a base-path problem here and finding it in a deploy.

- [ ] **Step 4: Update the docs**

In `README.md`, under Tests, add the driver to the list:

```markdown
- `tools/drive-keyboard.mjs` — plays the garden with no pointer: tabs to a plot, crosses two
  plants with Enter, and asserts an ungrown plant is never named
```

and add a short section after "Starting over":

```markdown
## Without a pointer

Tab moves between the nine plots and the seed tray. Enter picks up a plant or a seed and Enter
again drops it — onto another plant to cross them, onto the same plant to self it, onto a plot to
sow a seed, onto another seed to splice them. `C` clones, `R` reads the field notebook, Escape
cancels.

The canvas is hidden from screen readers and a parallel list of buttons carries the garden
instead. Those labels obey the same rule the rest of the game does: a plant is not named until it
has finished growing, and a seed is never named. Growing the plant is the reveal, and an
accessible label is the easiest place to give that away by accident.
```

In `CHANGELOG.md`, add a new section at the top, under the heading:

```markdown
## Keyboard and screen-reader access — 2026-08-02

- The garden is playable with no pointer. Tab moves, Enter picks up and drops, `C` clones, `R`
  reads the field notebook, Escape cancels.
- The canvas is hidden from assistive technology and a parallel list of buttons carries the bed
  and the tray. Labels obey non-disclosure: a plant is not named until it has finished growing,
  and a seed is never named.
- A plant finishing is announced, and so is the tray discarding its oldest seed — which it has
  always done silently.
- The five verbs were extracted out of the pointer handler so both input paths call one
  implementation rather than two that drift.
```

- [ ] **Step 5: Commit and open a draft PR**

```bash
git add garden/garden.ts package.json README.md CHANGELOG.md
git commit -m "feat: teach keys to players using keys, and document the keyboard path"
git push -u origin feat/keyboard-access
gh pr create --draft --base m1-growth-spike --title "feat: keyboard and screen-reader access"
```

---

## Self-review

**Spec coverage.** Full parity → Tasks 3-5. Milestones-only announcements → Task 5, with
continuous progress explicitly absent. Hidden instructions → Task 3 Step 1. Hidden semantic
mirror → Task 3. Keys table → Task 4. Verb extraction → Task 1. Non-disclosure → Task 2, with
controls at both the unit layer (Task 2 Step 5) and the browser layer (Task 3 Step 6). Tray
labels position-only → Task 2. `WeakSet` on `Planting` → Task 5 Step 2. Input-aware hints →
Task 6. Tray overflow → Task 5 Step 3. Edges: focus survival → Task 3's reuse-the-button sync;
Escape closing the card → Task 4; a held item that stops existing → Task 4's `if (!from)` and
`if (seed)` guards.

**Not covered, deliberately:** arrow keys, roving tabindex, continuous growth narration, a
visible help panel, and the drawer's live-region vocabulary — all listed as out of scope in the
spec.

**Types.** `Target` is defined in Task 3 and used in Task 4. `plotLabel`/`seedLabel`/`grownLine`
are defined in Task 2 and used in Tasks 3 and 5. `doCross`/`doSelf`/`doClone`/`doSplice`/
`doPlant` are defined in Task 1 and used in Task 4. `syncA11y` and `afterVerb` are introduced in
Tasks 3 and 4 and extended in Task 5. `announced` is a `WeakSet<Planting>`, requiring the
`Planting` type import in `garden/garden.ts`.
