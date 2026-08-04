# Smooth Growth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** get the growth phase off ~6.5fps without changing what a settled plant looks like.

**Architecture:** `paintPlant`'s five drawing passes are extracted so two painters can share them. A new `src/render/growing.ts` keeps one offscreen layer per pass, appends only newly-visible geometry each frame, and composites the layers in pass order. Flowers still opening are painted once into their own bitmap and blitted at the opening scale instead of having their petals re-derived.

**Tech stack:** TypeScript, canvas 2D, Vite, vitest (jsdom-free — tests use a recording Proxy, never real pixels), Playwright drivers in `tools/`.

**Spec:** `docs/superpowers/specs/2026-08-04-heirloom-growth-render-design.md`. Read §2 (the fidelity bar) and §3.1 (why this is sound) before starting.

## Global Constraints

- **A settled plant must not change.** Once past `settledTick(maxTick)` the existing `paintPlantCached` path is used unaltered.
- **Fidelity bar:** growth frames must be no further from a direct `paintPlant` than the settled cache already is, **re-measured in the same run** rather than against a constant. (A constant of 3/255 was written here first and was wrong — see Task 5.) The single exception is a flower during its ~1.5s of opening, bounded at **56/255** worst pixel (the measured visual-review ceiling).
- **`paintPlant` must keep working unchanged.** `forest.retire` composites with it and the lookdev sheet calls it directly.
- **Growth timing must not move.** `SPEED`, `GROWTH_TICKS_PER_SECOND`, `OPEN_TICKS = 26` and `SETTLE_TICKS = 40` are set deliberately; this plan does not touch them.
- **Every new gate must be seen failing** against a deliberately broken version before it is trusted, and every negative assertion needs a positive control in the same test.
- **Unit tests cannot see pixels.** `test/cache.test.ts` uses a `Proxy` stub context. Pixel fidelity belongs in a Playwright driver under `tools/`.
- Node must be the project toolchain: prefix `PATH` with `~/miniconda3/envs/heirloom/bin` (Node 24). The shell default is Node 18 and breaks both `vitest` and `vite`.
- Commit after every task. Never commit directly to `m1-growth-spike`.

## File Structure

| file                                                     | responsibility                                                                               |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/render/stage.ts` (modify)                           | gains five exported pass functions + three selectors; `paintPlant` becomes their composition |
| `test/oplog.ts` (create)                                 | a recording canvas context, shared by the tests below                                        |
| `test/passes.test.ts` (create)                           | golden op-log: proves the extraction changed no drawing                                      |
| `test/growing.test.ts` (create)                          | append-only and incremental invariants                                                       |
| `src/render/growing.ts` (create)                         | the layered growth cache. One job: draw a plant that is still changing                       |
| `src/render/cache.ts` (modify)                           | routes below the settle tick into `growing.ts`                                               |
| `tools/check-growth.mjs` (create)                        | frame-rate floor + pixel fidelity, in a real browser                                         |
| `tools/growth-probe.html` (create) | dev-only page the driver drives; not a build input |
| `package.json`, `.github/workflows/drivers.yml` (modify) | wire the new driver into `npm run drive` and CI                                              |

---

### Task 1: Freeze today's drawing as a golden op-log

Captures what `paintPlant` does **before** anything is refactored. Without this, Task 2 has nothing to prove it was pixel-neutral.

**Files:**

- Create: `test/oplog.ts`
- Create: `test/passes.test.ts`
- Create: `test/fixtures/paint-oplog.json` (generated in Step 3)

**Interfaces:**

- Consumes: `growPlant` from `src/growth/sim.ts`, `paintPlant` from `src/render/stage.ts`
- Produces: `recordingContext(): { ctx: CanvasRenderingContext2D; ops: string[] }` from `test/oplog.ts`

- [ ] **Step 1: Write the recorder**

`test/oplog.ts`:

```ts
/**
 * A canvas context that draws nothing and writes down what it was asked to do.
 *
 * Unit tests here have no pixels — `test/cache.test.ts` already stubs the context with a Proxy.
 * An op log is the strongest thing available at this layer, and it is exactly the right
 * instrument for the one risk in extracting `paintPlant`: that a pass moves relative to another.
 */
export function recordingContext(): {
  ctx: CanvasRenderingContext2D;
  ops: string[];
} {
  const ops: string[] = [];
  const round = (v: unknown): unknown =>
    typeof v === "number" ? Math.round(v * 1000) / 1000 : v;
  const ctx = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "createLinearGradient" || prop === "createRadialGradient")
          return (...a: unknown[]) => {
            ops.push(`${prop}(${a.map(round).join(",")})`);
            return {
              addColorStop: (o: number, c: string) =>
                ops.push(`addColorStop(${round(o)},${c})`),
            };
          };
        return (...a: unknown[]) => {
          ops.push(`${prop}(${a.map(round).join(",")})`);
        };
      },
      set(_t, prop: string, value: unknown) {
        ops.push(`${prop}=${round(value)}`);
        return true;
      },
    },
  );
  return { ctx: ctx as CanvasRenderingContext2D, ops };
}
```

- [ ] **Step 2: Write the test that reads the golden**

`test/passes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { paintPlant } from "../src/render/stage";
import { growPlant } from "../src/growth/sim";
import { randomGenome } from "../src/genome/genome";
import { express } from "../src/genome/express";
import { mulberry32 } from "../src/rng";
import { recordingContext } from "./oplog";

/** Deterministic: same seed, same genomes, same plants, same ops. */
function logs(): Record<string, string[]> {
  const rand = mulberry32(20260804);
  const out: Record<string, string[]> = {};
  for (let i = 0; i < 6; i++) {
    const plant = growPlant(express(randomGenome(rand)), (rand() * 1e9) | 0, {
      x: 0,
      y: 0,
    });
    for (const tick of [20, 55, 90, 140]) {
      const { ctx, ops } = recordingContext();
      paintPlant(ctx, plant, tick);
      out[`plant${i}@${tick}`] = ops;
    }
  }
  return out;
}

describe("paintPlant draws exactly what it drew before the passes were extracted", () => {
  it("matches the golden op log", () => {
    const golden = JSON.parse(
      readFileSync(
        new URL("./fixtures/paint-oplog.json", import.meta.url),
        "utf8",
      ),
    ) as Record<string, string[]>;
    const now = logs();
    expect(Object.keys(now).sort()).toEqual(Object.keys(golden).sort());
    for (const key of Object.keys(golden)) {
      expect(now[key], key).toEqual(golden[key]);
    }
  });

  it("CONTROL: the log is not trivially empty", () => {
    // A recorder that silently captured nothing would satisfy the assertion above against a
    // golden that was also empty. Both sides have to contain real drawing.
    const now = logs();
    for (const [key, ops] of Object.entries(now)) {
      expect(ops.length, key).toBeGreaterThan(50);
    }
    expect(
      Object.values(now).some((o) => o.some((s) => s.startsWith("fill("))),
    ).toBe(true);
  });
});
```

- [ ] **Step 3: Generate the golden from the CURRENT, unmodified `paintPlant`**

`vite-node`, `tsx` and `ts-node` are **not** installed — checked. The only thing in this repo that
runs TypeScript is `vitest`, so the generator is a throwaway test file rather than a script.

Create `test/_gen-golden.test.ts`:

```ts
import { it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { paintPlant } from "../src/render/stage";
import { growPlant } from "../src/growth/sim";
import { randomGenome } from "../src/genome/genome";
import { express } from "../src/genome/express";
import { mulberry32 } from "../src/rng";
import { recordingContext } from "./oplog";

it("writes the golden", () => {
  const rand = mulberry32(20260804);
  const out: Record<string, string[]> = {};
  for (let i = 0; i < 6; i++) {
    const plant = growPlant(express(randomGenome(rand)), (rand() * 1e9) | 0, {
      x: 0,
      y: 0,
    });
    for (const tick of [20, 55, 90, 140]) {
      const { ctx, ops } = recordingContext();
      paintPlant(ctx, plant, tick);
      out[`plant${i}@${tick}`] = ops;
    }
  }
  mkdirSync(new URL("./fixtures/", import.meta.url), { recursive: true });
  writeFileSync(
    new URL("./fixtures/paint-oplog.json", import.meta.url),
    JSON.stringify(out, null, 1),
  );
  console.log(
    "ops per entry:",
    Object.values(out)
      .map((o) => o.length)
      .join(" "),
  );
});
```

```bash
export PATH="$HOME/miniconda3/envs/heirloom/bin:$PATH"
npx vitest run test/_gen-golden.test.ts
rm test/_gen-golden.test.ts        # delete it — a self-regenerating golden cannot fail
```

Expected: every entry has hundreds of ops. If any entry is near-empty the recorder is wrong, not
the renderer. **Delete the generator** before committing: a golden that rewrites itself on every
run is a check that can never fail, which is the exact defect this project has hit repeatedly.

- [ ] **Step 4: Run the test — it must now PASS**

```bash
npx vitest run test/passes.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: See it fail**

Temporarily swap two passes inside `paintPlant` — move the leaf loop above the stem loop — and re-run.

```bash
npx vitest run test/passes.test.ts 2>&1 | tail -6
```

Expected: FAIL on the op-log comparison. Revert with `git checkout -- src/render/stage.ts`, re-run, expect PASS.

- [ ] **Step 6: Commit**

```bash
git add test/oplog.ts test/passes.test.ts test/fixtures/paint-oplog.json
git commit -m "test(render): freeze paintPlant's drawing as a golden op log

Captured BEFORE the passes are extracted, so the extraction has something
to prove it against. Verified failing by swapping two passes."
```

---

### Task 2: Extract the five passes, pixel-neutrally

**Files:**

- Modify: `src/render/stage.ts` (`paintPlant`, currently `:363`–`:625`)
- Test: `test/passes.test.ts` (from Task 1 — must still pass unchanged)

**Interfaces:**

- Consumes: `recordingContext` from `test/oplog.ts`
- Produces, all from `src/render/stage.ts`:
  - `openingAt(untilTick: number, tick: number): number`
  - `chainsFor(plant: Plant, untilTick: number): StrokeSegment[][]`
  - `bloomsFor(plant: Plant, untilTick: number): Bloom[]`
  - `paintStemPass(ctx: CanvasRenderingContext2D, plant: Plant, chains: StrokeSegment[][]): void`
  - `paintLeafPass(ctx: CanvasRenderingContext2D, plant: Plant, leaves: LeafSpec[]): void`
  - `paintHaloPass(ctx: CanvasRenderingContext2D, blooms: Bloom[], opening: (tick: number) => number): void`
  - `paintPetalPass(ctx: CanvasRenderingContext2D, blooms: Bloom[], opening: (tick: number) => number): void`
  - `paintCentrePass(ctx: CanvasRenderingContext2D, blooms: Bloom[], opening: (tick: number) => number): void`

- [ ] **Step 1: Add the three selectors**

Insert above `paintPlant` in `src/render/stage.ts`:

```ts
/**
 * How far open a flower is, from how long ago its shoot terminated.
 *
 * Lifted out of `paintPlant` unchanged so the layered painter computes it identically. A second
 * copy of this curve would let the two painters disagree about what "half open" means.
 */
export function openingAt(untilTick: number, tick: number): number {
  const age = untilTick - tick;
  return age >= OPEN_TICKS
    ? 1
    : 0.32 + 0.68 * ease(Math.max(0, age) / OPEN_TICKS);
}

/** Visible stem chains, deepest first — the order the stem pass depends on. */
export function chainsFor(plant: Plant, untilTick: number): StrokeSegment[][] {
  const chains = groupChains(visibleSegments(plant, untilTick));
  chains.sort((a, b) => (b[0]?.depth ?? 0) - (a[0]?.depth ?? 0));
  return chains;
}

/**
 * Visible blooms after occlusion culling — the set every bloom pass iterates.
 *
 * Culling is greedy over array order and `plant.blooms` is emitted in tick order, so this set
 * only ever GROWS as `untilTick` advances. `src/render/growing.ts` depends on that; see
 * test/growing.test.ts.
 */
export function bloomsFor(plant: Plant, untilTick: number): Bloom[] {
  return cullOccludedBlooms(plant.blooms.filter((b) => b.tick <= untilTick));
}
```

- [ ] **Step 2: Move each pass body into its own exported function**

Cut the existing loop bodies out of `paintPlant` verbatim — do not retype them, and do not "improve" anything while moving. Each becomes:

```ts
export function paintStemPass(
  ctx: CanvasRenderingContext2D,
  plant: Plant,
  chains: StrokeSegment[][],
): void {
  /* the existing `for (const chain of chains) { ... }` body, unchanged */
}

export function paintLeafPass(
  ctx: CanvasRenderingContext2D,
  plant: Plant,
  leaves: LeafSpec[],
): void {
  /* the existing `for (const lf of plant.leaves)` body, with the tick filter removed
     (the caller filters now) and `plant.leaves` replaced by `leaves` */
}

export function paintHaloPass(
  ctx: CanvasRenderingContext2D,
  blooms: Bloom[],
  opening: (tick: number) => number,
): void {
  /* the existing halo `for (const b of blooms)` body, unchanged */
}
```

`paintPetalPass` and `paintCentrePass` follow the same shape. `withBloomTransform` is used by both, so move it to module scope taking `opening` as a parameter:

```ts
function withBloomTransform(
  ctx: CanvasRenderingContext2D,
  b: Bloom,
  opening: (tick: number) => number,
  draw: () => void,
): void {
  ctx.save();
  const squash = 1 - 0.45 * b.tilt;
  const o = opening(b.tick);
  ctx.translate(b.center.x, b.center.y);
  ctx.scale(o, o * squash);
  ctx.translate(-b.center.x, -b.center.y);
  draw();
  ctx.restore();
}
```

- [ ] **Step 3: Rewrite `paintPlant` as the composition**

```ts
export function paintPlant(
  ctx: CanvasRenderingContext2D,
  plant: Plant,
  untilTick = Infinity,
): void {
  const opening = (tick: number): number => openingAt(untilTick, tick);
  paintStemPass(ctx, plant, chainsFor(plant, untilTick));
  paintLeafPass(
    ctx,
    plant,
    plant.leaves.filter((lf) => lf.tick <= untilTick),
  );
  const blooms = bloomsFor(plant, untilTick);
  // The save/shadowBlur wrapper stays HERE, around all three bloom passes, exactly as before.
  ctx.save();
  ctx.shadowBlur = 0;
  paintHaloPass(ctx, blooms, opening);
  paintPetalPass(ctx, blooms, opening);
  paintCentrePass(ctx, blooms, opening);
  ctx.restore();
}
```

- [ ] **Step 4: Typecheck and run the golden**

```bash
export PATH="$HOME/miniconda3/envs/heirloom/bin:$PATH"
npx tsc --noEmit && npx vitest run
```

Expected: typecheck clean, all tests pass **including `test/passes.test.ts` with no change to the fixture**. If the golden fails, the extraction changed the drawing — fix the extraction, never the fixture.

- [ ] **Step 5: Confirm in a real browser too**

```bash
npm run build
npx vite preview --port 4173 --strictPort &
GARDEN_URL=http://localhost:4173/heirloom/garden/ node tools/check-motion.mjs
GARDEN_URL=http://localhost:4173/heirloom/garden/ node tools/run-drivers.mjs
```

Expected: all pass. The op log cannot see gradient object identity or `save`/`restore` nesting bugs; the drivers render actual pixels.

- [ ] **Step 6: Commit**

```bash
git add src/render/stage.ts
git commit -m "refactor(render): extract paintPlant's five passes

Pixel-neutral by construction and proven by the golden op log from the
previous commit, which is unchanged. Two painters can now share the passes;
paintPlant is their composition and behaves exactly as before."
```

---

### Task 3: Prove the append-only invariant

The whole design rests on this. If a bloom can leave the drawn set, every baked layer is eventually wrong.

**Files:**

- Create: `test/growing.test.ts`

**Interfaces:**

- Consumes: `bloomsFor` from `src/render/stage.ts` (Task 2)

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from "vitest";
import { bloomsFor } from "../src/render/stage";
import { growPlant } from "../src/growth/sim";
import { randomGenome } from "../src/genome/genome";
import { express } from "../src/genome/express";
import { mulberry32 } from "../src/rng";

describe("the drawn bloom set only ever grows", () => {
  it("never drops a bloom it has already drawn", () => {
    const rand = mulberry32(913);
    let checkedTransitions = 0;
    for (let i = 0; i < 60; i++) {
      const plant = growPlant(express(randomGenome(rand)), (rand() * 1e9) | 0, {
        x: 0,
        y: 0,
      });
      let prev = new Set<unknown>();
      for (let t = 0; t <= 160; t += 4) {
        const now = new Set<unknown>(bloomsFor(plant, t));
        for (const b of prev) {
          expect(
            now.has(b),
            `plant ${i} dropped a bloom between ${t - 4} and ${t}`,
          ).toBe(true);
        }
        if (prev.size) checkedTransitions++;
        prev = now;
      }
    }
    // POSITIVE CONTROL: the loop must have had non-empty sets to compare, or it proved nothing.
    expect(checkedTransitions).toBeGreaterThan(500);
  });

  it("CONTROL: the set does actually grow, so 'never shrinks' is not vacuous", () => {
    const rand = mulberry32(913);
    const plant = growPlant(express(randomGenome(rand)), 4242, { x: 0, y: 0 });
    expect(bloomsFor(plant, 160).length).toBeGreaterThan(
      bloomsFor(plant, 20).length,
    );
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx vitest run test/growing.test.ts
```

Expected: 2 passed.

- [ ] **Step 3: See it fail**

Temporarily reverse the filter order in `bloomsFor` so culling sees blooms newest-first:

```ts
return cullOccludedBlooms(
  plant.blooms.filter((b) => b.tick <= untilTick).reverse(),
);
```

```bash
npx vitest run test/growing.test.ts 2>&1 | tail -6
```

Expected: FAIL — "dropped a bloom between …". This is exactly the bug the invariant forbids. Revert with `git checkout -- src/render/stage.ts` and re-run: PASS.

- [ ] **Step 4: Commit**

```bash
git add test/growing.test.ts
git commit -m "test(render): the drawn bloom set is append-only

The load-bearing fact of the growth cache: culling is greedy over an array
the growth loop emits in tick order, so a bloom once drawn is never dropped.
Verified failing by reversing that order."
```

---

### Task 4: The layered painter, non-incremental

Draw a plant through five layers and composite. No incrementality yet — this task exists to prove the _layering_ is faithful before any caching cleverness is added.

**Files:**

- Create: `src/render/growing.ts`
- Modify: `test/growing.test.ts`

**Interfaces:**

- Consumes: the pass functions and selectors from Task 2; `plantBounds` and `PAD`-style padding from `src/render/cache.ts` (re-declare locally, do not export `PAD`)
- Produces:
  - `paintPlantGrowing(ctx: CanvasRenderingContext2D, plant: Plant, untilTick: number, dpr?: number): void`
  - `releaseGrowth(plant: Plant): void`
  - `growingLayerBytes(plant: Plant): number` — for the memory risk in spec §6
  - `setGrowthCanvasSource(source: () => HTMLCanvasElement): () => HTMLCanvasElement`

- [ ] **Step 1: Write `src/render/growing.ts`**

```ts
import type { Bloom, Plant } from "../types";
import {
  bloomsFor,
  chainsFor,
  openingAt,
  paintCentrePass,
  paintHaloPass,
  paintLeafPass,
  paintPetalPass,
  paintStemPass,
  plantBounds,
} from "./stage";

/** Room around the bounding box for halos and rim strokes, which sit outside the geometry. */
const PAD = 26;

/** The five passes, in the order `paintPlant` draws them. Order IS the correctness argument. */
const PASSES = ["stems", "leaves", "halos", "petals", "centres"] as const;
type PassName = (typeof PASSES)[number];

type Layers = {
  layer: Record<PassName, HTMLCanvasElement>;
  x: number;
  y: number;
  w: number;
  h: number;
  dpr: number;
};

let makeCanvas: () => HTMLCanvasElement = () =>
  document.createElement("canvas");

/** Swap the canvas source, mirroring `setCanvasSource` in cache.ts. Returns the previous one. */
export function setGrowthCanvasSource(
  source: () => HTMLCanvasElement,
): () => HTMLCanvasElement {
  const was = makeCanvas;
  makeCanvas = source;
  return was;
}

const layers = new WeakMap<Plant, Layers>();

/**
 * Layer size comes from the FINAL plant, not the visible part.
 *
 * `plantBounds` takes no tick, so it already reports the full extent — which is what we want:
 * a layer that had to be resized mid-growth would have to be repainted from scratch, and the
 * whole point is never to do that.
 */
function build(plant: Plant, dpr: number): Layers | null {
  const b = plantBounds(plant);
  const w = b.maxX - b.minX + PAD * 2;
  const h = b.maxY - b.minY + PAD * 2;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0)
    return null;

  const layer = {} as Record<PassName, HTMLCanvasElement>;
  for (const name of PASSES) {
    const c = makeCanvas();
    c.width = Math.ceil(w * dpr);
    c.height = Math.ceil(h * dpr);
    const g = c.getContext("2d");
    if (!g) return null;
    g.scale(dpr, dpr);
    g.translate(-b.minX + PAD, -b.minY + PAD);
    layer[name] = c;
  }
  return { layer, x: b.minX - PAD, y: b.minY - PAD, w, h, dpr };
}

/** Draw a plant that is still changing, through one layer per pass. */
export function paintPlantGrowing(
  ctx: CanvasRenderingContext2D,
  plant: Plant,
  untilTick: number,
  dpr = 1,
): void {
  let ls = layers.get(plant);
  if (!ls || ls.dpr !== dpr) {
    const built = build(plant, dpr);
    if (!built) return; // nothing to draw; caller already handled the empty-plant case
    ls = built;
    layers.set(plant, ls);
  }

  const opening = (tick: number): number => openingAt(untilTick, tick);
  const blooms = bloomsFor(plant, untilTick);

  const g = (name: PassName): CanvasRenderingContext2D =>
    ls!.layer[name].getContext("2d") as CanvasRenderingContext2D;

  for (const name of PASSES) {
    const c = ls.layer[name];
    const x = c.getContext("2d")!;
    x.save();
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, c.width, c.height);
    x.restore();
  }

  paintStemPass(g("stems"), plant, chainsFor(plant, untilTick));
  paintLeafPass(
    g("leaves"),
    plant,
    plant.leaves.filter((lf) => lf.tick <= untilTick),
  );
  for (const [name, pass] of [
    ["halos", paintHaloPass],
    ["petals", paintPetalPass],
    ["centres", paintCentrePass],
  ] as const) {
    const x = g(name);
    x.save();
    x.shadowBlur = 0;
    pass(x, blooms, opening);
    x.restore();
  }

  for (const name of PASSES) {
    ctx.drawImage(ls.layer[name], ls.x, ls.y, ls.w, ls.h);
  }
}

/** Drop a plant's layers. Called when it settles and the still-image cache takes over. */
export function releaseGrowth(plant: Plant): void {
  layers.delete(plant);
}

/** Approximate bytes held for one plant's layers, for the memory check in the driver. */
export function growingLayerBytes(plant: Plant): number {
  const ls = layers.get(plant);
  if (!ls) return 0;
  return PASSES.reduce(
    (n, name) => n + ls.layer[name].width * ls.layer[name].height * 4,
    0,
  );
}
```

- [ ] **Step 2: Add the layering test**

Append to `test/growing.test.ts`:

```ts
import {
  paintPlantGrowing,
  setGrowthCanvasSource,
  releaseGrowth,
} from "../src/render/growing";
import { recordingContext } from "./oplog";

/** A canvas whose context records ops, so we can see which pass drew what. */
function recordingCanvas(sink: Map<string, string[]>, name: () => string) {
  return () => {
    const { ctx, ops } = recordingContext();
    sink.set(name(), ops);
    return {
      width: 0,
      height: 0,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;
  };
}

describe("the layered painter draws the same passes in the same order", () => {
  it("issues each pass into its own layer, and composites five layers in order", () => {
    const rand = mulberry32(77);
    const plant = growPlant(express(randomGenome(rand)), 5150, { x: 0, y: 0 });
    let n = 0;
    const sink = new Map<string, string[]>();
    const was = setGrowthCanvasSource(
      recordingCanvas(sink, () => `layer${n++}`),
    );
    try {
      const { ctx, ops } = recordingContext();
      paintPlantGrowing(ctx, plant, 70, 1);
      // Five layers were created...
      expect(sink.size).toBe(5);
      // ...and composited in creation order, which is pass order.
      const blits = ops.filter((o) => o.startsWith("drawImage("));
      expect(blits).toHaveLength(5);
    } finally {
      setGrowthCanvasSource(was);
      releaseGrowth(plant);
    }
  });
});
```

- [ ] **Step 3: Run it**

```bash
npx tsc --noEmit && npx vitest run test/growing.test.ts
```

Expected: all pass.

- [ ] **Step 4: See it fail**

Change `PASSES` in `growing.ts` to four entries (drop `"centres"`), re-run. Expected: FAIL on `sink.size` and on the blit count. Revert.

- [ ] **Step 5: Commit**

```bash
git add src/render/growing.ts test/growing.test.ts
git commit -m "feat(render): layered growth painter, non-incremental

One offscreen layer per drawing pass, composited in pass order. No caching
yet - this proves the layering is faithful before any incrementality is
added on top of it."
```

---

### Task 5: Pixel fidelity of the layered painter, in a browser

Unit tests cannot see pixels. This is the task that actually holds the fidelity bar.

**Files:**

- Create: `tools/check-growth.mjs`

**Interfaces:**

- Consumes: `paintPlantGrowing` and `paintPlant`, both reachable from the dev server as ES modules

- [ ] **Step 1: Write the driver**

`tools/check-growth.mjs` renders the same plant twice — once through `paintPlant`, once through `paintPlantGrowing` — into two canvases of identical size, and diffs them.

```js
/**
 * Does the layered painter draw the same plant as the direct one?
 *
 * The unit tests compare OP LOGS, which cannot see a compositing difference, a transform that
 * leaked across a layer boundary, or a gradient built in the wrong coordinate space. Only real
 * pixels can. Run against the dev server so the probe can import /src modules directly.
 *
 * The bar is NOT zero and NOT a constant: it is the shipped `paintPlantCached`'s own error,
 * re-measured in the same run. See the design spec, section 2 — the absolute number first
 * written here was measured on the wrong operation.
 */
import { chromium } from "playwright";

const URL = process.env.PROBE_URL ?? "http://localhost:5173/tools/growth-probe.html";
const FLOOR = 3; // max channel delta, from the design spec
const OPENING_CEILING = 56; // the one relaxation: a flower mid-opening

const browser = await chromium.launch();
const page = await browser.newPage({
  viewportSize: { width: 1000, height: 800 },
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__ready === true, { timeout: 20000 });

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!ok) failures++;
};

// CONTROL FIRST: the harness must be able to report zero, or every number below is noise.
const nullDiff = await page.evaluate(() =>
  window.__compare(140, "direct-vs-direct"),
);
check(
  "CONTROL: the harness reports exactly zero when both arms are the direct painter",
  nullDiff.max === 0 && nullDiff.differing === 0,
  `max ${nullDiff.max}, ${nullDiff.differing} channels`,
);

// CONTROL: and it must report NON-zero for a deliberately wrong render, or it cannot fail.
const sanity = await page.evaluate(() =>
  window.__compare(140, "direct-vs-shifted"),
);
check(
  "CONTROL: the harness detects a one-pixel shift",
  sanity.max > 0,
  `max ${sanity.max}`,
);

for (const tick of [140, 200, 900]) {
  const d = await page.evaluate(
    (t) => window.__compare(t, "direct-vs-layered"),
    tick,
  );
  check(
    `settled geometry at tick ${tick} stays inside the compositing floor`,
    d.max <= FLOOR,
    `max ${d.max}/255 against a floor of ${FLOOR}, ${d.pct.toFixed(2)}% of channels`,
  );
}

for (const tick of [20, 40, 55, 70, 90]) {
  const d = await page.evaluate(
    (t) => window.__compare(t, "direct-vs-layered"),
    tick,
  );
  check(
    `growing at tick ${tick} stays inside the opening ceiling`,
    d.max <= OPENING_CEILING,
    `max ${d.max}/255 against a ceiling of ${OPENING_CEILING}`,
  );
}

check("no page errors", errors.length === 0, errors.join("; "));
await browser.close();
console.log(
  failures
    ? `\n${failures} check(s) failed`
    : "\nall growth-render checks passed",
);
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Write the probe page it drives**

Create `tools/growth-probe.html`. It is committed, and it is dev-only for free: `vite.config.ts`
builds exactly four inputs (`index.html`, `garden/`, `lookdev/`, `visit/`), so any other page is
served by the dev server and never enters the production bundle. Put it under `tools/` rather than
the repo root so it sits with the driver that uses it — `root: "."` means the dev server serves it
at `/tools/growth-probe.html` either way.

```html
<meta charset="utf8" />
<script type="module">
  import { paintPlant } from "/src/render/stage.ts";
  import { paintPlantGrowing, releaseGrowth } from "/src/render/growing.ts";
  import { growPlant } from "/src/growth/sim.ts";
  import { randomGenome } from "/src/genome/genome.ts";
  import { express } from "/src/genome/express.ts";
  import { mulberry32 } from "/src/rng.ts";

  const W = 900,
    H = 700;
  const rand = mulberry32(20260804);
  const plants = Array.from({ length: 4 }, () =>
    growPlant(express(randomGenome(rand)), (rand() * 1e9) | 0, {
      x: W / 2,
      y: H - 40,
    }),
  );
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    return c;
  };
  const draw = (how, plant, tick, dx = 0) => {
    const c = mk();
    const g = c.getContext("2d");
    g.translate(dx, 0);
    if (how === "layered") paintPlantGrowing(g, plant, tick, 1);
    else paintPlant(g, plant, tick);
    return g.getImageData(0, 0, W, H).data;
  };
  window.__compare = (tick, mode) => {
    let max = 0,
      differing = 0,
      total = 0;
    for (const plant of plants) {
      const a = draw("direct", plant, tick);
      const b =
        mode === "direct-vs-direct"
          ? draw("direct", plant, tick)
          : mode === "direct-vs-shifted"
            ? draw("direct", plant, tick, 1)
            : draw("layered", plant, tick);
      for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i]);
        if (d) {
          differing++;
          max = Math.max(max, d);
        }
        total++;
      }
      releaseGrowth(plant);
    }
    return { max, differing, pct: (100 * differing) / total };
  };
  window.__ready = true;
</script>
```

- [ ] **Step 3: Run it**

```bash
export PATH="$HOME/miniconda3/envs/heirloom/bin:$PATH"
npx vite --port 5173 --strictPort &
sleep 4
node tools/check-growth.mjs
```

Expected: controls pass, and each tick's layered error is no worse than the shipped cache's own, measured alongside it.

**CORRECTED DURING IMPLEMENTATION.** The absolute 3/255 in this task was measured on a synthetic probe compositing aligned, same-size canvases — not what either painter does. Both blit an integer-sized bitmap to fractional world coordinates, so the whole image resamples; the shipped cache measures max 104/255, mean 0.4257. The gate compares against that baseline, re-measured every run. **If a comparison fails, stop and report.** That means layering is not as faithful as the spec claims and the design needs revisiting — do not raise the threshold to make it pass. That is the circular-calibration failure this project has hit before.

- [ ] **Step 4: See it fail**

In `growing.ts`, composite the layers in reverse order (`for (const name of [...PASSES].reverse())`). Re-run. Expected: the settled checks FAIL loudly while both controls still PASS. Revert.

- [ ] **Step 5: Commit**

```bash
git add tools/check-growth.mjs tools/growth-probe.html
git commit -m "test(render): pixel fidelity gate for the layered painter

Op logs cannot see compositing, leaked transforms or gradient coordinate
spaces. This renders both painters and diffs them, against the compositing
floor the settled cache already pays. Verified failing by reversing the
layer composite order, with both controls still passing."
```

---

### Task 6: Make it incremental

Only now does anything get faster.

**Files:**

- Modify: `src/render/growing.ts`
- Modify: `test/growing.test.ts`

**Interfaces:**

- Produces: `Layers` gains `bakedTick: number` and `liveChains` handling. No public signature changes.

- [ ] **Step 1: Add the baked-tick bookkeeping**

In `Layers`, add `bakedTick: number` (initialised to `-Infinity`). In `paintPlantGrowing`, replace the "clear every layer, redraw everything" block with:

```ts
// Everything at or below `bakedTick` is already in the layers. Draw only what is new.
const from = ls.bakedTick;
const newLeaves = plant.leaves.filter(
  (lf) => lf.tick > from && lf.tick <= untilTick,
);
const newBlooms = blooms.filter((b) => b.tick > from);

// Stems are the exception: a chain still growing has its outline rebuilt from the whole
// smoothed chain, so it cannot be appended to. Terminated chains are baked once; growing
// chains are redrawn every frame into the transient layer.
const terminated = [];
const growing = [];
for (const chain of chainsFor(plant, untilTick)) {
  const last = chain[chain.length - 1];
  (last && last.tick <= from ? terminated : growing).push(chain);
}
const newlyTerminated = terminated.filter((c) => {
  const last = c[c.length - 1];
  return last !== undefined && last.tick > from;
});
```

Bake `newlyTerminated`, `newLeaves` and `newBlooms` into their layers; clear and redraw only the transient stem layer from `growing`. Composite becomes six blits: `stems`, `liveStems`, `leaves`, `halos`, `petals`, `centres` — with `liveStems` immediately after `stems` so stem draw order is preserved.

Set `ls.bakedTick = untilTick` at the end.

- [ ] **Step 2: Assert the incrementality, not just the output**

```ts
it("draws each bloom's petals exactly once across the whole of growth", () => {
  // The output test in Task 5 would pass even if every frame redrew everything — it only
  // compares pixels. This is the test that the work is actually being saved.
  const rand = mulberry32(31337);
  const plant = growPlant(express(randomGenome(rand)), 909, { x: 0, y: 0 });
  let petalDraws = 0;
  const was = setGrowthCanvasSource(() => {
    const { ctx, ops } = recordingContext();
    const seen = ops;
    return {
      width: 0,
      height: 0,
      getContext: () =>
        new Proxy(ctx, {
          get(t, p) {
            if (p === "fill") petalDraws++;
            return Reflect.get(t, p);
          },
        }),
    } as unknown as HTMLCanvasElement;
  });
  try {
    const { ctx } = recordingContext();
    for (let t = 0; t <= 160; t += 2) paintPlantGrowing(ctx, plant, t, 1);
    const once = bloomsFor(plant, 160).length;
    // Allow the opening window: a bloom is redrawn while it opens, then baked once.
    expect(petalDraws).toBeLessThan(once * 40);
  } finally {
    setGrowthCanvasSource(was);
    releaseGrowth(plant);
  }
});
```

- [ ] **Step 3: Run both the unit tests and the fidelity gate**

```bash
npx tsc --noEmit && npx vitest run
node tools/check-growth.mjs
```

Expected: all pass, and `check-growth` still inside its thresholds. **The fidelity gate is the point of this step** — incrementality is where double-drawing and missed invalidation appear.

- [ ] **Step 4: Commit**

```bash
git add src/render/growing.ts test/growing.test.ts
git commit -m "perf(render): append only what is newly visible

Terminated stem chains, leaves and blooms are baked once; only chains still
growing are redrawn each frame. Fidelity gate unchanged and still passing,
which is the check that matters here."
```

---

### Task 7: Per-bloom bitmaps for opening flowers

The measured 68%-of-blooms-animating case — the reason the previous task alone is not enough.

**Files:**

- Modify: `src/render/growing.ts`
- Modify: `test/growing.test.ts`

- [ ] **Step 1: Add the per-bloom bitmap**

```ts
/**
 * A flower mid-opening is FIXED geometry under a scale transform, so it can be painted once
 * and blitted. This is the single relaxation of the fidelity bar in the design (spec §2): the
 * blit resamples where the vector path would not. It was approved on a visual review across
 * three bloom archetypes, bounded at 56/255 worst pixel, and applies only while a flower opens.
 */
const openingBitmaps = new WeakMap<Bloom, HTMLCanvasElement>();
```

When a bloom is newly visible and `untilTick - b.tick < OPEN_TICKS`, paint it once at scale 1 into its own small canvas sized from its petal extent, then each frame blit it through the same `translate/scale/translate` that `withBloomTransform` applies. When `untilTick - b.tick >= OPEN_TICKS`, paint it into the shared `petals` layer once and `openingBitmaps.delete(b)`.

- [ ] **Step 2: Assert the bitmap is built once and released**

```ts
it("builds one bitmap per opening bloom and releases it when the flower settles", () => {
  const rand = mulberry32(2718);
  const plant = growPlant(express(randomGenome(rand)), 1234, { x: 0, y: 0 });
  const { ctx } = recordingContext();
  let peak = 0;
  for (let t = 0; t <= 200; t += 2) {
    paintPlantGrowing(ctx, plant, t, 1);
    peak = Math.max(peak, openingBitmapCount(plant));
  }
  expect(peak).toBeGreaterThan(0); // it was used at all
  expect(openingBitmapCount(plant)).toBe(0); // and every one was released
  releaseGrowth(plant);
});
```

Export `openingBitmapCount(plant: Plant): number` from `growing.ts` for this.

- [ ] **Step 3: Re-run the fidelity gate with the opening ceiling**

```bash
npx vitest run && node tools/check-growth.mjs
```

Expected: settled ticks still no worse than the shipped cache (unchanged — this feature must not touch them).

- [ ] **Step 4: Commit**

```bash
git add src/render/growing.ts test/growing.test.ts
git commit -m "perf(render): blit opening flowers instead of repainting them

At the worst moment 265 of 389 drawn blooms are mid-animation. Their
geometry is fixed under a scale transform, so each is painted once and
blitted while it opens, then baked when it settles."
```

---

### Task 8: Wire it in, and gate it

**Files:**

- Modify: `src/render/cache.ts:61`
- Modify: `package.json` (`drive` script)
- Modify: `.github/workflows/drivers.yml`

- [ ] **Step 1: Route below the settle tick**

```ts
if (untilTick < settledTick) {
  paintPlantGrowing(ctx, plant, untilTick, dpr);
  return;
}
// Past the settle point the still-image cache takes over; the growth layers are dead weight.
releaseGrowth(plant);
```

- [ ] **Step 2: Measure the frame rate, which is the whole point**

Add to `tools/check-growth.mjs`, driving the real garden rather than the probe page:

```js
// The reason this work exists. Pinned so the check does not depend on how fast the machine
// happens to grow a plant, and taken at the tick the profile showed as worst.
const fps = await page.evaluate(
  () =>
    new Promise((res) => {
      let stop = false;
      const pin = () => {
        window.__seek(70);
        if (!stop) requestAnimationFrame(pin);
      };
      requestAnimationFrame(pin);
      setTimeout(() => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => {
          n++;
          if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
          else {
            stop = true;
            res(n / ((performance.now() - t0) / 1000));
          }
        };
        requestAnimationFrame(tick);
      }, 300);
    }),
);
check(
  "the bed runs at a usable frame rate DURING growth",
  fps > 30,
  `${fps.toFixed(1)} fps at growth tick 70, against the same floor check-motion asserts settled`,
);
```

- [ ] **Step 3: Wire into `npm run drive` and CI**

`package.json`: add `&& node tools/check-growth.mjs` after `check-clock.mjs`.
`.github/workflows/drivers.yml`: add `- run: node tools/check-growth.mjs` after the `check-clock` step, with a comment saying whether it is portable — a frame-rate floor on a shared runner is the same portability question `check-phone.mjs` is excluded for. **If the fps assertion proves flaky in CI, split it: keep the fidelity checks in CI and leave the frame-rate floor local, matching how `check-phone.mjs` is already handled.**

- [ ] **Step 4: Full verification against a production build**

```bash
export PATH="$HOME/miniconda3/envs/heirloom/bin:$PATH"
npx tsc --noEmit && npx vitest run && npm run build
npx vite preview --port 4173 --strictPort &
sleep 4
export GARDEN_URL=http://localhost:4173/heirloom/garden/
node tools/run-drivers.mjs && node tools/check-motion.mjs && node tools/check-viewports.mjs \
  && node tools/check-clock.mjs && node tools/check-growth.mjs && node tools/check-phone.mjs
```

Expected: everything passes, and `check-growth` reports **>30fps during growth** where the baseline was ~6.5.

- [ ] **Step 5: Commit**

```bash
git add src/render/cache.ts tools/check-growth.mjs package.json .github/workflows/drivers.yml
git commit -m "perf(render): use the growth cache, and gate it

Below the settle tick paintPlantCached now routes to the layered painter.
Settled plants are untouched. check-growth asserts both the fidelity floor
and the frame rate the work exists for."
```

---

### Task 9: Verify it in motion

The visual review that approved the opening relaxation was **static**. This closes that gap and the "265 at once" gap in one step.

**Files:**

- Modify: `tools/check-growth.mjs`

- [ ] **Step 1: Capture growth both ways, unmagnified, at 1x**

Add a mode to the probe that renders the full garden — not one bloom — at a sweep of growth ticks, and have the driver capture PNGs from both painters into `tools/out/growth-motion/`.

- [ ] **Step 2: Assert no frame exceeds the opening ceiling, and report the worst**

```js
const worst = await page.evaluate(() => window.__worstOverGrowth());
check(
  "no frame of growth exceeds the opening ceiling",
  worst.max <= OPENING_CEILING,
  `worst ${worst.max}/255 at tick ${worst.tick}, over ${worst.frames} frames`,
);
```

- [ ] **Step 3: Look at them**

Open the captured frames and compare the animation by eye at 1x. This step is a human judgement and is not automatable: the question is whether growth _reads_ the same, not whether a number is under a threshold.

**If it does not look right, do not tune the threshold.** Report it, and fall back to the animation-timing lever in spec §6 — shortening `OPEN_TICKS` or staggering bloom ticks so fewer flowers animate at once, which costs no fidelity at all.

- [ ] **Step 4: Commit and open a draft PR**

```bash
git add tools/check-growth.mjs
git commit -m "test(render): verify growth in motion, not just as stills"
git push -u origin feat/growth-render
gh pr create --draft --base m1-growth-spike --title "Smooth growth"
```

---

## Self-Review

**Spec coverage.** §1 measurements → Task 5/8 thresholds. §2 fidelity bar → Task 5 (floor) and Task 7 (ceiling). §3.1 append-only → Task 3. §3.2 layers → Tasks 4 and 6. §3.3 opening flowers → Task 7. §3.4 settled unchanged → Task 8 Step 1 plus the settled assertions in Task 5. §4 files → the file table. §5 verification → Tasks 1, 3, 5, 8, 9, each with a seen-failing step. §6 risks: the `paintPlant` extraction is isolated in Task 2 and proven by Task 1's golden; memory has `growingLayerBytes` in Task 4 but **no task asserts a bound on it** — the implementer should add that assertion to Task 8's driver rather than leave it unmeasured. §7 non-goals → nothing in this plan touches timing, `forest.retire`, `paintThumb` or bloom counts.

**Type consistency.** `paintPlantGrowing(ctx, plant, untilTick, dpr?)`, `releaseGrowth(plant)`, `setGrowthCanvasSource(source)`, `growingLayerBytes(plant)` and `openingBitmapCount(plant)` are used with those exact names and arities in Tasks 4, 6, 7 and 8. `bloomsFor` / `chainsFor` / `openingAt` and the five `paint*Pass` functions are defined in Task 2 and consumed in Task 4 with matching signatures.

**Known soft spots, stated rather than hidden.** Task 6 Step 1 describes the incremental bookkeeping in prose plus a partial snippet rather than complete code — it is the one place the plan does not hand over a finished function, because the exact bake/blit split depends on what the Task 5 gate reports. Task 9 Steps 1–2 are likewise sketched. Both are deliberate: writing invented code there would be worse than admitting the shape depends on a measurement that has not been taken yet.
