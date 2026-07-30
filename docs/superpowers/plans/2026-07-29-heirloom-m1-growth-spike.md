# Heirloom Milestone 1 — Growth Engine Spike — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the tropism-based growth engine and ink-on-dark renderer far enough to judge whether the art direction actually works, using hard-coded phenotypes and no genetics layer.

**Architecture:** A pure simulation emits geometry; a pure geometry layer turns that into fillable outlines; a thin Canvas2D layer paints them. Nothing in this milestone knows what a gene is — the growth engine consumes a flat `Phenotype` struct that later milestones will produce from a genome. Determinism is enforced by seeding a local PRNG, never `Math.random()`.

**Tech Stack:** TypeScript (strict), Vite, vitest, Canvas2D. Playwright only as a screenshot tool for the critic gate. No runtime dependencies, no UI framework.

## Global Constraints

- Milestone 1 implements **no genome layer**. Phenotypes are hand-authored literals. `genome/`, `phenotype/express.ts`, `game/`, and `ui/` are out of scope here.
- **`Math.random()` is banned in `src/`.** Every stochastic choice draws from a `mulberry32` stream seeded by the caller. Task 2's determinism test is what enforces this.
- The growth RNG is seeded from **the genome alone** (spec §6). In this milestone that means the seed is an explicit `number` parameter — plot index, screen position, and time must never reach it.
- TypeScript `strict: true`. No `any` in committed code.
- Canvas2D only. WebGL is permitted only if this milestone's gate proves Canvas2D insufficient (spec §2).
- Art direction is fixed (spec §2): refined ink line-art on a **dark ground**, tapered strokes, muted-saturated colour, soft bloom.
- Node 20+.
- Curves are **emergent from the growth path** (spec §3). No task fits cubic bezier control points to anything.
- Two deviations from spec §3 are deliberate. (a) §3 assigns stroke drawing to `render/strokes.ts` but never says where *petal* drawing lives; this plan adds `render/petals.ts` rather than overloading `strokes.ts`. (b) §3 lists `growth/agent.ts` for the tip, but a tip is a pure type with no behaviour, so `Tip` lives in `src/types.ts` with the other contracts and no `agent.ts` is created.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `package.json`, `tsconfig.json`, `vite.config.ts` | Scaffold: Vite dev server, strict TS, vitest. |
| `src/types.ts` | Shared contracts only: `Vec2`, `PetalShape`, `Phenotype`, `Tip`, `StrokeSegment`, `PetalSpec`, `Bloom`, `Plant`. No logic. |
| `src/rng.ts` | `mulberry32`, `hashString`, `angleDelta`. The only source of randomness. |
| `src/growth/sim.ts` | `growPlant()` — tip stepping, tropisms, taper, branching, termination. Emits `Plant`. |
| `src/growth/bloom.ts` | `layoutBloom()` — whorls, phyllotaxis, petal specs. |
| `src/render/strokes.ts` | Pure geometry: `groupChains()`, `smoothChain()`, `buildOutline()`, plus a thin `fillOutline()`. |
| `src/render/petals.ts` | Pure geometry: `petalPath()`, `petalColor()`, plus a thin `fillPetal()`. |
| `src/render/stage.ts` | Dark ground, vignette, soft bloom; `paintPlant()` composes the above. |
| `lookdev/index.html`, `lookdev/lookdev.ts` | 3x3 grid of hand-authored phenotypes + contact-sheet export. The judging surface. |
| `tools/shoot.mjs` | Playwright screenshot of the lookdev page for the critic gate. |
| `test/*.test.ts` | vitest suites, one per source module. |

Accumulation buffer (`render/accumulate.ts`) is Milestone 4 and intentionally absent.

---

### Task 1: Scaffold, shared types, deterministic RNG

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `.gitignore`
- Create: `src/types.ts`, `src/rng.ts`
- Test: `test/rng.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `mulberry32(seed: number): () => number`, `hashString(s: string): number`, `angleDelta(from: number, to: number): number`. All types in `src/types.ts` listed below, by exact name.

- [ ] **Step 1: Create the scaffold files**

`package.json`:

```json
{
  "name": "heirloom",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "shoot": "node tools/shoot.mjs"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0",
    "playwright": "^1.48.0"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src", "test", "lookdev", "tools"]
}
```

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: { target: 'es2022' },
});
```

`.gitignore`:

```
node_modules/
dist/
shots/
```

- [ ] **Step 2: Write `src/types.ts`**

```ts
export type Vec2 = { x: number; y: number };

export type PetalShape = 'round' | 'pointed' | 'lobed' | 'frilled';

/** Flat parameter struct consumed by the growth engine. Contains no genetic concepts. */
export type Phenotype = {
  // growth behaviour
  vigour: number;           // 0..1 — total ticks and step length
  droop: number;            // 0..1 — gravitropism weight (pull toward down)
  phototropism: number;     // 0..1 — pull toward the light direction (up)
  stiffness: number;        // 0..1 — damps all direction change
  branchiness: number;      // 0..1 — branch probability per tick
  // structure
  baseWidth: number;        // px at the base of the main stem
  taper: number;            // per-tick width multiplier, must be < 1
  branchAngle: number;      // radians
  branchWidthRatio: number; // 0..1 — child width as a fraction of parent
  // bloom
  doubled: boolean;         // dd — stamens converted to petals
  petalShape: PetalShape;
  hueClass: 0 | 1 | 2 | 3 | 4;
  white: boolean;           // pigment block expressed
  bloomRadius: number;      // px
};

export type Tip = {
  id: number;
  pos: Vec2;
  dir: number;        // radians. Screen coords: y grows downward, so "up" is -PI/2.
  width: number;
  age: number;
  depth: number;
  vigourLeft: number;
  alive: boolean;
};

export type StrokeSegment = {
  x0: number; y0: number; x1: number; y1: number;
  w0: number; w1: number;
  depth: number;
  tick: number;   // enables animation: draw only segments with tick <= t
  chain: number;  // the Tip.id that emitted this — segments group into chains by this
};

export type PetalSpec = {
  center: Vec2;
  angle: number;      // radians
  length: number;
  width: number;
  shape: PetalShape;
  colorDepth: number; // 0 = outer/pale, 1 = inner/dark
};

export type Bloom = {
  center: Vec2;
  radius: number;
  petals: PetalSpec[];
  hueClass: number;
  white: boolean;
  stamens: boolean;   // false when doubled
};

export type Plant = {
  segments: StrokeSegment[];
  blooms: Bloom[];
};
```

- [ ] **Step 3: Write the failing test**

`test/rng.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mulberry32, hashString, angleDelta } from '../src/rng';

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = Array.from({ length: 8 }, mulberry32(1));
    const b = Array.from({ length: 8 }, mulberry32(2));
    expect(a).not.toEqual(b);
  });

  it('stays within [0, 1)', () => {
    const r = mulberry32(999);
    for (let i = 0; i < 500; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('hashString', () => {
  it('is stable and unsigned', () => {
    expect(hashString('WwH1h1')).toBe(hashString('WwH1h1'));
    expect(hashString('a')).not.toBe(hashString('b'));
    expect(hashString('anything')).toBeGreaterThanOrEqual(0);
  });
});

describe('angleDelta', () => {
  it('returns the shortest signed turn', () => {
    expect(angleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(angleDelta(0, -Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
    // the short way from 0.1 rad to -0.1 rad is negative, not almost-2PI
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(-0.2);
    expect(Math.abs(angleDelta(0, 3 * Math.PI))).toBeLessThanOrEqual(Math.PI + 1e-9);
  });
});
```

- [ ] **Step 4: Run the test and confirm it fails for the right reason**

Run: `npm install && npx vitest run test/rng.test.ts`
Expected: FAIL — cannot resolve `../src/rng`. If it fails for any *other* reason, stop and read the error; a test that fails for the wrong reason proves nothing.

- [ ] **Step 5: Write `src/rng.ts`**

```ts
/** Canonical mulberry32. Fast, seedable, good enough for visual variation. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32-bit. Used later to seed growth from a serialized genome. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Shortest signed angular difference from `from` to `to`, in (-PI, PI]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}
```

- [ ] **Step 6: Run the test and confirm it passes**

Run: `npx vitest run test/rng.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json vite.config.ts .gitignore src/types.ts src/rng.ts test/rng.test.ts
git commit -m "feat: scaffold, shared types, seeded RNG"
```

---

### Task 2: Growth simulation

**Files:**
- Create: `src/growth/sim.ts`
- Test: `test/sim.test.ts`

**Interfaces:**
- Consumes: `mulberry32`, `angleDelta` from `src/rng`; every type from `src/types`; `layoutBloom` from `src/growth/bloom` (Task 3 — stub it in Step 3, replace in Task 3 Step 6).
- Produces: `growPlant(pheno: Phenotype, seed: number, origin: Vec2): Plant`.

- [ ] **Step 1: Write the failing test**

`test/sim.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { growPlant } from '../src/growth/sim';
import type { Phenotype } from '../src/types';

const BASE: Phenotype = {
  vigour: 0.5, droop: 0.0, phototropism: 0.5, stiffness: 0.3, branchiness: 0.4,
  baseWidth: 6, taper: 0.985, branchAngle: 0.5, branchWidthRatio: 0.62,
  doubled: false, petalShape: 'round', hueClass: 0, white: false, bloomRadius: 14,
};
const at = (): { x: number; y: number } => ({ x: 0, y: 0 });

describe('growPlant', () => {
  it('is deterministic: same phenotype and seed give an identical segment list', () => {
    const a = growPlant(BASE, 42, at());
    const b = growPlant(BASE, 42, at());
    expect(a.segments).toEqual(b.segments);
    expect(a.blooms).toEqual(b.blooms);
  });

  it('varies with the seed', () => {
    const a = growPlant(BASE, 1, at());
    const b = growPlant(BASE, 2, at());
    expect(a.segments).not.toEqual(b.segments);
  });

  it('terminates and produces at least one bloom', () => {
    const p = growPlant(BASE, 7, at());
    expect(p.segments.length).toBeGreaterThan(10);
    expect(p.blooms.length).toBeGreaterThanOrEqual(1);
  });

  it('tapers monotonically along a chain', () => {
    const p = growPlant({ ...BASE, branchiness: 0 }, 3, at());
    const chain = p.segments.filter((s) => s.chain === 0);
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i]!.w0).toBeLessThanOrEqual(chain[i - 1]!.w0);
    }
  });

  it('grows upward when droop is zero and downward-biased when droop is high', () => {
    // Screen coords: smaller y is higher on screen.
    const upright = growPlant({ ...BASE, droop: 0, branchiness: 0 }, 11, at());
    const weeping = growPlant({ ...BASE, droop: 1, branchiness: 0 }, 11, at());
    const lowest = (segs: typeof upright.segments) => Math.min(...segs.map((s) => s.y1));
    expect(lowest(upright.segments)).toBeLessThan(lowest(weeping.segments));
  });

  it('makes more chains when branchier', () => {
    const sparse = growPlant({ ...BASE, branchiness: 0 }, 5, at());
    const bushy = growPlant({ ...BASE, branchiness: 1 }, 5, at());
    const chains = (segs: typeof sparse.segments) => new Set(segs.map((s) => s.chain)).size;
    expect(chains(sparse)).toBe(1);
    expect(chains(bushy)).toBeGreaterThan(1);
  });

  it('stays bounded even at maximum branchiness', () => {
    const p = growPlant({ ...BASE, branchiness: 1, vigour: 1 }, 8, at());
    // MAX_TIPS bounds *concurrent* tips, not the total spawned across the run — dead tips
    // free slots — so assert the run cannot explode rather than counting chain ids.
    expect(p.segments.length).toBeLessThan(40_000);
    expect(p.blooms.length).toBeLessThan(2_000);
  });

  it('emits ticks in non-decreasing order', () => {
    const p = growPlant(BASE, 21, at());
    for (let i = 1; i < p.segments.length; i++) {
      expect(p.segments[i]!.tick).toBeGreaterThanOrEqual(p.segments[i - 1]!.tick);
    }
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails for the right reason**

Run: `npx vitest run test/sim.test.ts`
Expected: FAIL — cannot resolve `../src/growth/sim`.

- [ ] **Step 3: Write `src/growth/sim.ts`**

Note the temporary `layoutBloom` stub at the top; Task 3 replaces it with a real import.

```ts
import { mulberry32, angleDelta } from '../rng';
import type { Phenotype, Plant, StrokeSegment, Tip, Vec2, Bloom } from '../types';

// TEMPORARY — replaced by a real import in Task 3.
function layoutBloom(pheno: Phenotype, center: Vec2, _face: number, _rand: () => number): Bloom {
  return {
    center: { ...center }, radius: pheno.bloomRadius, petals: [],
    hueClass: pheno.hueClass, white: pheno.white, stamens: !pheno.doubled,
  };
}

const MIN_WIDTH = 0.6;
const MAX_TIPS = 400;
const UP = -Math.PI / 2;
const DOWN = Math.PI / 2;

export function growPlant(pheno: Phenotype, seed: number, origin: Vec2): Plant {
  const rand = mulberry32(seed);
  const segments: StrokeSegment[] = [];
  const blooms: Bloom[] = [];

  const maxTicks = Math.round(40 + 60 * pheno.vigour);
  const stepLen = 3 + 5 * pheno.vigour;
  let nextId = 0;

  let tips: Tip[] = [{
    id: nextId++, pos: { ...origin }, dir: UP, width: pheno.baseWidth,
    age: 0, depth: 0, vigourLeft: maxTicks, alive: true,
  }];

  for (let tick = 0; tick < maxTicks; tick++) {
    if (tips.length === 0) break;
    const spawned: Tip[] = [];

    for (const tip of tips) {
      // 1. Tropisms — gravitropism pulls toward DOWN, phototropism toward UP.
      //    They oppose each other, which is what makes droop read as a habit.
      const turn =
        pheno.droop * 0.06 * angleDelta(tip.dir, DOWN) +
        pheno.phototropism * 0.05 * angleDelta(tip.dir, UP) +
        (rand() - 0.5) * 0.25;
      tip.dir += turn * (1 - pheno.stiffness * 0.7);

      // 2. Step
      const len = stepLen * Math.max(0.35, 1 - 0.06 * tip.depth);
      const nx = tip.pos.x + Math.cos(tip.dir) * len;
      const ny = tip.pos.y + Math.sin(tip.dir) * len;

      // 3. Taper
      const w1 = tip.width * pheno.taper;

      segments.push({
        x0: tip.pos.x, y0: tip.pos.y, x1: nx, y1: ny,
        w0: tip.width, w1, depth: tip.depth, tick, chain: tip.id,
      });

      tip.pos = { x: nx, y: ny };
      tip.width = w1;
      tip.age++;
      tip.vigourLeft--;

      // 4. Branch
      if (tips.length + spawned.length < MAX_TIPS && tip.age > 3 && rand() < pheno.branchiness * 0.08) {
        const side = rand() < 0.5 ? 1 : -1;
        spawned.push({
          id: nextId++, pos: { ...tip.pos }, dir: tip.dir + side * pheno.branchAngle,
          width: tip.width * pheno.branchWidthRatio, age: 0, depth: tip.depth + 1,
          vigourLeft: Math.max(1, Math.round(tip.vigourLeft * 0.7)), alive: true,
        });
      }

      // 5. Terminate -> bloom
      if (tip.width < MIN_WIDTH || tip.vigourLeft <= 0) {
        tip.alive = false;
        blooms.push(layoutBloom(pheno, tip.pos, tip.dir, rand));
      }
    }

    tips = tips.filter((t) => t.alive).concat(spawned);
  }

  // Any tip still alive when the clock runs out still blooms.
  for (const tip of tips) blooms.push(layoutBloom(pheno, tip.pos, tip.dir, rand));

  return { segments, blooms };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run test/sim.test.ts`
Expected: PASS, 8 tests. If the droop test fails, check the sign convention — screen y grows downward, so `UP` is negative.

- [ ] **Step 5: Prove the determinism test can actually fail**

A test never seen failing is not evidence (spec §9). Temporarily replace the `rand()` call inside the wander term with `Math.random()`:

```ts
        (Math.random() - 0.5) * 0.25;
```

Run: `npx vitest run test/sim.test.ts`
Expected: FAIL on "is deterministic", specifically because two calls with seed 42 now differ. Confirm that is the reported reason, then revert the line to `(rand() - 0.5) * 0.25` and re-run to green.

- [ ] **Step 6: Commit**

```bash
git add src/growth/sim.ts test/sim.test.ts
git commit -m "feat(growth): tropism-based tip simulation"
```

---

### Task 3: Bloom layout

**Files:**
- Create: `src/growth/bloom.ts`
- Modify: `src/growth/sim.ts` — delete the temporary stub, import the real function
- Test: `test/bloom.test.ts`

**Interfaces:**
- Consumes: `Phenotype`, `Vec2`, `Bloom`, `PetalSpec` from `src/types`.
- Produces: `layoutBloom(pheno: Phenotype, center: Vec2, faceAngle: number, rand: () => number): Bloom`. Signature matches the stub exactly, so Task 2's call site needs no change.

- [ ] **Step 1: Write the failing test**

`test/bloom.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { layoutBloom } from '../src/growth/bloom';
import { mulberry32 } from '../src/rng';
import type { Phenotype } from '../src/types';

const SINGLE: Phenotype = {
  vigour: 0.5, droop: 0, phototropism: 0.5, stiffness: 0.3, branchiness: 0,
  baseWidth: 6, taper: 0.985, branchAngle: 0.5, branchWidthRatio: 0.62,
  doubled: false, petalShape: 'round', hueClass: 2, white: false, bloomRadius: 14,
};
const DOUBLE: Phenotype = { ...SINGLE, doubled: true };
const c = { x: 0, y: 0 };

describe('layoutBloom', () => {
  it('gives a single 5 petals in 1 whorl, with stamens', () => {
    const b = layoutBloom(SINGLE, c, 0, mulberry32(1));
    expect(b.petals).toHaveLength(5);
    expect(b.stamens).toBe(true);
  });

  it('gives a double many more petals and no stamens (ABC C-function)', () => {
    const b = layoutBloom(DOUBLE, c, 0, mulberry32(1));
    expect(b.petals.length).toBeGreaterThan(20);
    expect(b.stamens).toBe(false);
  });

  it('spaces petals by the golden angle', () => {
    const b = layoutBloom(DOUBLE, c, 0, mulberry32(1));
    const golden = Math.PI * (3 - Math.sqrt(5));
    const d = b.petals[1]!.angle - b.petals[0]!.angle;
    expect(d).toBeCloseTo(golden, 5);
  });

  it('makes inner whorls smaller and darker', () => {
    const b = layoutBloom(DOUBLE, c, 0, mulberry32(1));
    const outer = b.petals[0]!;
    const inner = b.petals[b.petals.length - 1]!;
    expect(inner.width).toBeLessThan(outer.width);
    expect(inner.colorDepth).toBeGreaterThan(outer.colorDepth);
  });

  it('keeps colorDepth finite for a single whorl', () => {
    // Guards a division-by-zero when whorls === 1.
    for (const p of layoutBloom(SINGLE, c, 0, mulberry32(1)).petals) {
      expect(Number.isFinite(p.colorDepth)).toBe(true);
    }
  });

  it('is deterministic for a given rand stream', () => {
    const a = layoutBloom(DOUBLE, c, 0, mulberry32(9));
    const b = layoutBloom(DOUBLE, c, 0, mulberry32(9));
    expect(a).toEqual(b);
  });

  it('carries the pigment-block flag through untouched', () => {
    const b = layoutBloom({ ...SINGLE, white: true }, c, 0, mulberry32(1));
    expect(b.white).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails for the right reason**

Run: `npx vitest run test/bloom.test.ts`
Expected: FAIL — cannot resolve `../src/growth/bloom`.

- [ ] **Step 3: Write `src/growth/bloom.ts`**

```ts
import type { Bloom, Phenotype, PetalSpec, Vec2 } from '../types';

const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // ~137.5 degrees

export function layoutBloom(
  pheno: Phenotype,
  center: Vec2,
  faceAngle: number,
  rand: () => number,
): Bloom {
  const whorls = pheno.doubled ? 3 : 1;
  const perWhorl = pheno.doubled ? 9 : 5;
  const petals: PetalSpec[] = [];

  let i = 0;
  for (let w = 0; w < whorls; w++) {
    const whorlScale = 1 - 0.22 * w;
    const colorDepth = whorls === 1 ? 0 : w / (whorls - 1);
    for (let k = 0; k < perWhorl; k++) {
      petals.push({
        center: { ...center },
        angle: faceAngle + i * GOLDEN,
        length: pheno.bloomRadius * whorlScale * (0.9 + 0.2 * rand()),
        width: pheno.bloomRadius * 0.55 * whorlScale,
        shape: pheno.petalShape,
        colorDepth,
      });
      i++;
    }
  }

  return {
    center: { ...center },
    radius: pheno.bloomRadius,
    petals,
    hueClass: pheno.hueClass,
    white: pheno.white,
    stamens: !pheno.doubled,
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run test/bloom.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Replace the stub in `src/growth/sim.ts`**

Delete the whole `// TEMPORARY` function block, and add to the imports at the top:

```ts
import { layoutBloom } from './bloom';
```

Then remove `Bloom` from the `types` import only if it is no longer referenced — it still is (the `blooms` array is typed `Bloom[]`), so leave it.

- [ ] **Step 6: Run the whole suite**

Run: `npx vitest run`
Expected: PASS — all of rng, sim, bloom. The sim suite must still be green; `layoutBloom` now returns real petals but no sim assertion depends on the petal count.

- [ ] **Step 7: Commit**

```bash
git add src/growth/bloom.ts src/growth/sim.ts test/bloom.test.ts
git commit -m "feat(growth): bloom layout with whorls and golden-angle phyllotaxis"
```

---

### Task 4: Stroke geometry

**Files:**
- Create: `src/render/strokes.ts`
- Test: `test/strokes.test.ts`

**Interfaces:**
- Consumes: `StrokeSegment`, `Vec2` from `src/types`.
- Produces: `groupChains(segs: StrokeSegment[]): StrokeSegment[][]`, `smoothChain(chain: StrokeSegment[], subdiv?: number): StrokeSegment[]`, `buildOutline(chain: StrokeSegment[]): Vec2[]`, `fillOutline(ctx: CanvasRenderingContext2D, pts: Vec2[], color: string): void`.

The geometry functions are pure and tested; `fillOutline` is a three-line canvas wrapper with nothing to test.

- [ ] **Step 1: Write the failing test**

`test/strokes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { groupChains, smoothChain, buildOutline } from '../src/render/strokes';
import type { StrokeSegment } from '../src/types';

const seg = (i: number, chain = 0, w = 4): StrokeSegment => ({
  x0: i * 10, y0: 0, x1: (i + 1) * 10, y1: 0,
  w0: w, w1: w, depth: 0, tick: i, chain,
});

describe('groupChains', () => {
  it('splits a flat segment list by chain id, preserving order', () => {
    const groups = groupChains([seg(0, 0), seg(0, 1), seg(1, 0), seg(1, 1)]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.map((s) => s.chain)).toEqual([0, 0]);
    expect(groups[0]!.map((s) => s.tick)).toEqual([0, 1]);
  });

  it('returns an empty array for no input', () => {
    expect(groupChains([])).toEqual([]);
  });
});

describe('buildOutline', () => {
  it('returns 2*(N+1) points for N segments', () => {
    expect(buildOutline([seg(0), seg(1), seg(2)])).toHaveLength(8);
  });

  it('offsets a horizontal stroke by half-width on each side', () => {
    // A single horizontal segment of width 4 spans y = -2 .. +2.
    const pts = buildOutline([seg(0)]);
    const ys = pts.map((p) => p.y).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(-2);
    expect(ys[ys.length - 1]!).toBeCloseTo(2);
  });

  it('is a closed loop: the two sides run in opposite order', () => {
    const pts = buildOutline([seg(0), seg(1)]);
    // first point is the start of the left side, last is the start of the right side
    expect(pts[0]!.x).toBeCloseTo(pts[pts.length - 1]!.x);
    expect(pts[0]!.y).not.toBeCloseTo(pts[pts.length - 1]!.y);
  });

  it('returns nothing for an empty chain', () => {
    expect(buildOutline([])).toEqual([]);
  });

  it('narrows where the segment narrows', () => {
    const tapered: StrokeSegment[] = [{ ...seg(0), w0: 8, w1: 2 }];
    const pts = buildOutline(tapered);
    const spanAt = (x: number) => {
      const at = pts.filter((p) => Math.abs(p.x - x) < 1e-6);
      return Math.abs(at[0]!.y - at[1]!.y);
    };
    expect(spanAt(0)).toBeCloseTo(8);
    expect(spanAt(10)).toBeCloseTo(2);
  });
});

describe('smoothChain', () => {
  it('densifies the chain by roughly the subdivision factor', () => {
    const out = smoothChain([seg(0), seg(1), seg(2), seg(3)], 3);
    expect(out.length).toBeGreaterThan(8);
  });

  it('preserves the endpoints', () => {
    const chain = [seg(0), seg(1), seg(2)];
    const out = smoothChain(chain, 3);
    expect(out[0]!.x0).toBeCloseTo(chain[0]!.x0);
    expect(out[out.length - 1]!.x1).toBeCloseTo(chain[chain.length - 1]!.x1);
  });

  it('passes short chains straight through', () => {
    expect(smoothChain([seg(0)], 3)).toHaveLength(1);
    expect(smoothChain([], 3)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails for the right reason**

Run: `npx vitest run test/strokes.test.ts`
Expected: FAIL — cannot resolve `../src/render/strokes`.

- [ ] **Step 3: Write `src/render/strokes.ts`**

```ts
import type { StrokeSegment, Vec2 } from '../types';

/** Group a flat segment list into per-tip chains, preserving emission order. */
export function groupChains(segs: StrokeSegment[]): StrokeSegment[][] {
  const byChain = new Map<number, StrokeSegment[]>();
  for (const s of segs) {
    const arr = byChain.get(s.chain);
    if (arr) arr.push(s);
    else byChain.set(s.chain, [s]);
  }
  return [...byChain.values()];
}

/**
 * Catmull-Rom densification of a chain's centreline, lerping width along the way.
 * The curve is emergent from the growth path — no control points are authored.
 */
export function smoothChain(chain: StrokeSegment[], subdiv = 3): StrokeSegment[] {
  if (chain.length < 2) return chain.slice();

  // Centreline points: every segment start, then the final end.
  const pts: Vec2[] = chain.map((s) => ({ x: s.x0, y: s.y0 }));
  const lastSeg = chain[chain.length - 1]!;
  pts.push({ x: lastSeg.x1, y: lastSeg.y1 });
  const widths = chain.map((s) => s.w0);
  widths.push(lastSeg.w1);

  const at = (i: number): Vec2 => pts[Math.min(pts.length - 1, Math.max(0, i))]!;
  const wAt = (i: number): number => widths[Math.min(widths.length - 1, Math.max(0, i))]!;

  const dense: { p: Vec2; w: number }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let j = 0; j < subdiv; j++) {
      const t = j / subdiv;
      const t2 = t * t, t3 = t2 * t;
      dense.push({
        p: {
          x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        },
        w: wAt(i) + (wAt(i + 1) - wAt(i)) * t,
      });
    }
  }
  dense.push({ p: at(pts.length - 1), w: wAt(widths.length - 1) });

  const out: StrokeSegment[] = [];
  const proto = chain[0]!;
  for (let i = 0; i < dense.length - 1; i++) {
    const a = dense[i]!, b = dense[i + 1]!;
    out.push({
      x0: a.p.x, y0: a.p.y, x1: b.p.x, y1: b.p.y,
      w0: a.w, w1: b.w,
      depth: proto.depth,
      tick: chain[Math.min(chain.length - 1, Math.floor(i / subdiv))]!.tick,
      chain: proto.chain,
    });
  }
  return out;
}

/** Variable-width outline polygon: left side forward, right side back. */
export function buildOutline(chain: StrokeSegment[]): Vec2[] {
  if (chain.length === 0) return [];
  const left: Vec2[] = [];
  const right: Vec2[] = [];

  const push = (x: number, y: number, dx: number, dy: number, w: number): void => {
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    left.push({ x: x + (nx * w) / 2, y: y + (ny * w) / 2 });
    right.push({ x: x - (nx * w) / 2, y: y - (ny * w) / 2 });
  };

  for (const s of chain) push(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0, s.w0);
  const last = chain[chain.length - 1]!;
  push(last.x1, last.y1, last.x1 - last.x0, last.y1 - last.y0, last.w1);

  return left.concat(right.reverse());
}

/** Thin canvas wrapper. No logic worth testing. */
export function fillOutline(ctx: CanvasRenderingContext2D, pts: Vec2[], color: string): void {
  if (pts.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run test/strokes.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/render/strokes.ts test/strokes.test.ts
git commit -m "feat(render): chain grouping, Catmull-Rom smoothing, variable-width outlines"
```

---

### Task 5: Petal geometry and colour

**Files:**
- Create: `src/render/petals.ts`
- Test: `test/petals.test.ts`

**Interfaces:**
- Consumes: `PetalSpec`, `PetalShape`, `Vec2` from `src/types`.
- Produces: `petalPath(spec: PetalSpec, samples?: number): Vec2[]`, `petalColor(hueClass: number, white: boolean, colorDepth: number): string`, `fillPetal(ctx: CanvasRenderingContext2D, pts: Vec2[], fill: string, stroke: string): void`.

- [ ] **Step 1: Write the failing test**

`test/petals.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { petalPath, petalColor } from '../src/render/petals';
import type { PetalSpec, PetalShape } from '../src/types';

const spec = (shape: PetalShape, angle = 0): PetalSpec => ({
  center: { x: 0, y: 0 }, angle, length: 20, width: 10, shape, colorDepth: 0,
});

describe('petalPath', () => {
  it('returns a closed outline for every shape', () => {
    for (const s of ['round', 'pointed', 'lobed', 'frilled'] as PetalShape[]) {
      const pts = petalPath(spec(s));
      expect(pts.length).toBeGreaterThan(10);
      for (const p of pts) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }
    }
  });

  it('starts at the petal base, i.e. near the centre', () => {
    const pts = petalPath(spec('round'));
    expect(Math.hypot(pts[0]!.x, pts[0]!.y)).toBeLessThan(2);
  });

  it('extends roughly to the specified length', () => {
    const pts = petalPath(spec('round'));
    const far = Math.max(...pts.map((p) => Math.hypot(p.x, p.y)));
    expect(far).toBeGreaterThan(15);
    expect(far).toBeLessThan(26);
  });

  it('rotates with the angle', () => {
    const a = petalPath(spec('round', 0));
    const b = petalPath(spec('round', Math.PI / 2));
    expect(a).not.toEqual(b);
    // Same shape, so the farthest distance is unchanged by rotation.
    const far = (pts: typeof a) => Math.max(...pts.map((p) => Math.hypot(p.x, p.y)));
    expect(far(a)).toBeCloseTo(far(b), 6);
  });

  it('gives a pointed petal a narrower tip than a round one', () => {
    const nearTip = (s: PetalShape) => {
      const pts = petalPath(spec(s));
      const far = Math.max(...pts.map((p) => Math.hypot(p.x, p.y)));
      const band = pts.filter((p) => Math.hypot(p.x, p.y) > far * 0.9);
      return Math.max(...band.map((p) => Math.abs(p.y))) * 2;
    };
    expect(nearTip('pointed')).toBeLessThan(nearTip('round'));
  });
});

describe('petalColor', () => {
  it('ignores hue entirely when the pigment block is expressed', () => {
    expect(petalColor(0, true, 0)).toBe(petalColor(4, true, 0));
  });

  it('gives visibly different colours for different hue classes', () => {
    const seen = new Set([0, 1, 2, 3, 4].map((h) => petalColor(h, false, 0)));
    expect(seen.size).toBe(5);
  });

  it('darkens toward the inner whorls', () => {
    const light = (css: string) => Number(/(\d+(?:\.\d+)?)%\)$/.exec(css)![1]);
    expect(light(petalColor(0, false, 1))).toBeLessThan(light(petalColor(0, false, 0)));
  });

  it('falls back rather than returning undefined for an out-of-range hue class', () => {
    expect(petalColor(99, false, 0)).toMatch(/^hsl\(/);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails for the right reason**

Run: `npx vitest run test/petals.test.ts`
Expected: FAIL — cannot resolve `../src/render/petals`.

- [ ] **Step 3: Write `src/render/petals.ts`**

```ts
import type { PetalShape, PetalSpec, Vec2 } from '../types';

/** Half-width profile along the petal, t in [0,1] from base to tip. */
function halfWidth(shape: PetalShape, t: number): number {
  const base = Math.sin(Math.PI * Math.pow(t, 0.75));
  switch (shape) {
    case 'round':   return base;
    case 'pointed': return base * Math.pow(1 - t, 0.35) * 1.25;
    case 'lobed':   return base * (1 + 0.18 * Math.cos(6 * Math.PI * t));
    case 'frilled': return base * (1 + 0.13 * Math.sin(14 * Math.PI * t));
  }
}

/** Symmetric petal outline, rotated by spec.angle and translated to spec.center. */
export function petalPath(spec: PetalSpec, samples = 24): Vec2[] {
  const cos = Math.cos(spec.angle);
  const sin = Math.sin(spec.angle);
  const place = (along: number, across: number): Vec2 => ({
    x: spec.center.x + along * cos - across * sin,
    y: spec.center.y + along * sin + across * cos,
  });

  const upper: Vec2[] = [];
  const lower: Vec2[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const hw = (halfWidth(spec.shape, t) * spec.width) / 2;
    upper.push(place(t * spec.length, hw));
    lower.push(place(t * spec.length, -hw));
  }
  return upper.concat(lower.reverse());
}

const HUES = [350, 20, 320, 285, 250]; // crimson, coral, magenta, violet, blue

export function petalColor(hueClass: number, white: boolean, colorDepth: number): string {
  if (white) return `hsl(45 16% ${92 - 14 * colorDepth}%)`;
  const h = HUES[hueClass] ?? HUES[0]!;
  return `hsl(${h} ${70 - 10 * colorDepth}% ${62 - 26 * colorDepth}%)`;
}

/** Thin canvas wrapper. No logic worth testing. */
export function fillPetal(ctx: CanvasRenderingContext2D, pts: Vec2[], fill: string, stroke: string): void {
  if (pts.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 0.6;
  ctx.stroke();
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run test/petals.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/render/petals.ts test/petals.test.ts
git commit -m "feat(render): petal outlines per shape allele and hue-class colour"
```

---

### Task 6: Stage and plant painter

**Files:**
- Create: `src/render/stage.ts`
- Test: `test/stage.test.ts`

**Interfaces:**
- Consumes: `groupChains`, `smoothChain`, `buildOutline`, `fillOutline` from `src/render/strokes`; `petalPath`, `petalColor`, `fillPetal` from `src/render/petals`; `Plant` from `src/types`.
- Produces: `PALETTE` (const), `paintStage(ctx, w, h): void`, `paintPlant(ctx, plant: Plant, untilTick?: number): void`, `visibleSegments(plant: Plant, untilTick: number): StrokeSegment[]`.

Canvas drawing is verified by the critic gate in Task 7, not by unit tests. What *is* unit-testable is the animation filter, so that is what Step 1 tests.

- [ ] **Step 1: Write the failing test**

`test/stage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { visibleSegments, PALETTE } from '../src/render/stage';
import { growPlant } from '../src/growth/sim';
import type { Phenotype } from '../src/types';

const P: Phenotype = {
  vigour: 0.5, droop: 0.2, phototropism: 0.5, stiffness: 0.3, branchiness: 0.4,
  baseWidth: 6, taper: 0.985, branchAngle: 0.5, branchWidthRatio: 0.62,
  doubled: false, petalShape: 'round', hueClass: 0, white: false, bloomRadius: 14,
};

describe('visibleSegments', () => {
  it('reveals the plant monotonically as the tick advances', () => {
    const plant = growPlant(P, 4, { x: 0, y: 0 });
    const early = visibleSegments(plant, 5).length;
    const mid = visibleSegments(plant, 20).length;
    const all = visibleSegments(plant, 10_000).length;
    expect(early).toBeLessThan(mid);
    expect(mid).toBeLessThanOrEqual(all);
    expect(all).toBe(plant.segments.length);
  });

  it('shows nothing before growth starts', () => {
    const plant = growPlant(P, 4, { x: 0, y: 0 });
    expect(visibleSegments(plant, -1)).toHaveLength(0);
  });
});

describe('PALETTE', () => {
  it('commits to a dark ground, per the fixed art direction', () => {
    // Parse the "#rrggbb" ground and assert it is genuinely dark.
    const hex = PALETTE.ground.replace('#', '');
    const lum = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).reduce((a, b) => a + b) / 3;
    expect(lum).toBeLessThan(48);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails for the right reason**

Run: `npx vitest run test/stage.test.ts`
Expected: FAIL — cannot resolve `../src/render/stage`.

- [ ] **Step 3: Write `src/render/stage.ts`**

```ts
import type { Plant, StrokeSegment } from '../types';
import { buildOutline, fillOutline, groupChains, smoothChain } from './strokes';
import { fillPetal, petalColor, petalPath } from './petals';

export const PALETTE = {
  ground: '#0d1013',
  vignette: 'rgba(0,0,0,0.55)',
  stem: '#25402f',
  stemHi: '#3c6047',
  stamen: '#e8c35a',
} as const;

/** Segments whose tick has already elapsed. Drives the growth animation. */
export function visibleSegments(plant: Plant, untilTick: number): StrokeSegment[] {
  return plant.segments.filter((s) => s.tick <= untilTick);
}

export function paintStage(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = PALETTE.ground;
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createRadialGradient(w / 2, h * 0.62, Math.min(w, h) * 0.15, w / 2, h * 0.62, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, PALETTE.vignette);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

export function paintPlant(ctx: CanvasRenderingContext2D, plant: Plant, untilTick = Infinity): void {
  // Stems first, deepest chains behind.
  const chains = groupChains(visibleSegments(plant, untilTick));
  chains.sort((a, b) => (b[0]?.depth ?? 0) - (a[0]?.depth ?? 0));
  for (const chain of chains) {
    const outline = buildOutline(smoothChain(chain, 3));
    fillOutline(ctx, outline, chain[0]!.depth === 0 ? PALETTE.stemHi : PALETTE.stem);
  }

  // Blooms on top, with a soft glow — the "bloom" of the art direction.
  ctx.save();
  ctx.shadowBlur = 18;
  for (const b of plant.blooms) {
    ctx.shadowColor = petalColor(b.hueClass, b.white, 0);
    for (const p of b.petals) {
      const fill = petalColor(b.hueClass, b.white, p.colorDepth);
      fillPetal(ctx, petalPath(p), fill, 'rgba(0,0,0,0.35)');
    }
    if (b.stamens) {
      ctx.shadowBlur = 8;
      ctx.shadowColor = PALETTE.stamen;
      ctx.fillStyle = PALETTE.stamen;
      ctx.beginPath();
      ctx.arc(b.center.x, b.center.y, Math.max(1.2, b.radius * 0.13), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 18;
    }
  }
  ctx.restore();
}
```

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run`
Expected: PASS — rng, sim, bloom, strokes, petals, stage.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. Fix any `noUncheckedIndexedAccess` complaints with non-null assertions only where an index is provably in range.

- [ ] **Step 6: Commit**

```bash
git add src/render/stage.ts test/stage.test.ts
git commit -m "feat(render): dark stage, vignette, plant painter with bloom glow"
```

---

### Task 7: Lookdev contact sheet and the independent critic gate

This task is the **Milestone 1 exit gate**. It does not end at "the code runs" — it ends at a fresh critic passing the render.

**Files:**
- Create: `lookdev/index.html`, `lookdev/lookdev.ts`, `tools/shoot.mjs`

**Interfaces:**
- Consumes: `growPlant`, `paintStage`, `paintPlant`, `Phenotype`.
- Produces: a PNG contact sheet at `shots/lookdev.png`.

- [ ] **Step 1: Write `lookdev/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Heirloom lookdev</title>
    <style>
      body { margin: 0; background: #0d1013; color: #8a9a92;
             font: 12px/1.4 ui-monospace, monospace; }
      #grid { display: grid; grid-template-columns: repeat(3, 300px); gap: 4px; padding: 8px; }
      figure { margin: 0; }
      figcaption { padding: 2px 4px; }
      canvas { display: block; }
    </style>
  </head>
  <body>
    <div id="grid"></div>
    <script type="module" src="./lookdev.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `lookdev/lookdev.ts`**

Nine phenotypes chosen to span every axis the engine exposes, so the critic can see whether genetic differences are actually visible.

```ts
import { growPlant } from '../src/growth/sim';
import { paintPlant, paintStage } from '../src/render/stage';
import type { Phenotype } from '../src/types';

const W = 300;
const H = 340;

const BASE: Phenotype = {
  vigour: 0.55, droop: 0.15, phototropism: 0.55, stiffness: 0.35, branchiness: 0.35,
  baseWidth: 6, taper: 0.985, branchAngle: 0.5, branchWidthRatio: 0.62,
  doubled: false, petalShape: 'round', hueClass: 0, white: false, bloomRadius: 14,
};

const CASES: { label: string; pheno: Phenotype }[] = [
  { label: 'baseline single',   pheno: BASE },
  { label: 'compact',           pheno: { ...BASE, vigour: 0.15, branchiness: 0.1 } },
  { label: 'reaching',          pheno: { ...BASE, vigour: 1.0, branchiness: 0.2 } },
  { label: 'weeping',           pheno: { ...BASE, droop: 1.0, phototropism: 0.1, stiffness: 0.15 } },
  { label: 'bushy',             pheno: { ...BASE, branchiness: 1.0, branchAngle: 0.7 } },
  { label: 'doubled magenta',   pheno: { ...BASE, doubled: true, hueClass: 2, bloomRadius: 18 } },
  { label: 'white (W block)',   pheno: { ...BASE, white: true, doubled: true } },
  { label: 'pointed violet',    pheno: { ...BASE, petalShape: 'pointed', hueClass: 3 } },
  { label: 'frilled blue',      pheno: { ...BASE, petalShape: 'frilled', hueClass: 4, doubled: true } },
];

const grid = document.getElementById('grid')!;

CASES.forEach((c, i) => {
  const fig = document.createElement('figure');
  const cap = document.createElement('figcaption');
  cap.textContent = `${i + 1}. ${c.label}`;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  fig.append(canvas, cap);
  grid.append(fig);

  const ctx = canvas.getContext('2d')!;
  paintStage(ctx, W, H);
  const plant = growPlant(c.pheno, 1000 + i, { x: W / 2, y: H - 14 });
  paintPlant(ctx, plant);
});

// Signals to the screenshot tool that every canvas has finished painting.
(window as unknown as { __lookdevReady: boolean }).__lookdevReady = true;
```

- [ ] **Step 3: Write `tools/shoot.mjs`**

```js
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const URL = process.env.LOOKDEV_URL ?? 'http://localhost:5173/lookdev/';

mkdirSync('shots', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 960, height: 1120 } });
page.on('console', (m) => console.log(`[page:${m.type()}]`, m.text()));
page.on('pageerror', (e) => { console.error('[pageerror]', e.message); process.exitCode = 1; });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__lookdevReady === true, { timeout: 15_000 });
await page.screenshot({ path: 'shots/lookdev.png', fullPage: true });
await browser.close();
console.log('wrote shots/lookdev.png');
```

- [ ] **Step 4: Render the contact sheet**

```bash
npx playwright install chromium
npm run dev &          # leave the Vite server running
npm run shoot
```

Expected: `shots/lookdev.png` exists, and the console shows no `[pageerror]`. A page error here means the render silently produced nothing — do not proceed to the critic with a blank sheet.

- [ ] **Step 5: Look at the PNG yourself and list defects before showing anyone**

Open `shots/lookdev.png` and write down what is actually wrong with it. Lead with defects, not with what works. Fix anything unambiguous (blank panels, plants growing off-canvas, blooms detached from stem tips, stems rendering as hard-edged polygons) and re-shoot before Step 6.

- [ ] **Step 6: Dispatch an independent visual critic**

Builder-bias on rendered output is a perception failure that self-review does not correct, so this gate requires a *fresh* agent that did not write the code. Dispatch a general-purpose subagent (opus; this is a judgment task, not a mechanical one) with `shots/lookdev.png` and exactly these pass criteria:

1. Does each panel read as **a plant** — stem, branches, a flower at the tip — rather than as abstract strokes?
2. Do stems read as **smoothly tapering ink strokes**, thicker at the base, with no faceting, no hard polygon edges, and no constant-width look?
3. Do blooms read as **layered petals around a centre**, not as a flat pinwheel, a starburst seen edge-on, or a featureless blob?
4. Does the **dark-ground ink art direction** hold — muted-saturated colour on dark, legible silhouettes, no washed-out or muddy panels?
5. Are the nine panels **visibly distinct from each other** along the axis each label names (compact vs reaching, upright vs weeping, sparse vs bushy, single vs doubled, and each petal shape and hue)?

Require the critic to answer PASS or FAIL **per criterion**, name the specific panel numbers for every FAIL, and lead its report with defects. Have it write the full report to a temp file and return only a one-line summary — a reviewer subagent whose final message ends on a checkmark can get truncated by the stop hook.

- [ ] **Step 7: Iterate until the critic passes, then commit**

If any criterion FAILs, fix the named cause and return to Step 4. Tuning knobs by criterion: (2) `smoothChain` subdivision and `taper`; (3) `perWhorl`, `whorlScale`, and `halfWidth`; (4) `PALETTE` and the lightness ramp in `petalColor`; (5) the multipliers on `droop`, `phototropism`, and `branchiness` in `sim.ts`.

Two rules bound this loop. Judge against a real plant, never on a curve against the previous render. And if three consecutive iterations fail the *same* criterion by the *same* mechanism, stop tuning and escalate to the user — that is the signal that the mechanism class is wrong (for criterion 3 the documented alternative is a non-procedural bloom; for criterion 2 it is a WebGL stroke shader, which spec §2 permits only if this gate proves Canvas2D insufficient).

```bash
git add lookdev tools
git commit -m "feat(lookdev): phenotype contact sheet and critic gate"
```

- [ ] **Step 8: Record the gate outcome**

Append a short section to `docs/superpowers/specs/2026-07-29-heirloom-modern-seed-design.md` under a new heading `## 13. Milestone 1 outcome`: the critic's per-criterion verdict, which knobs moved, how many iterations it took, and any criterion that had to be escalated. Milestones 2–5 get planned only after this section exists and reads PASS.

```bash
git add docs/superpowers/specs/2026-07-29-heirloom-modern-seed-design.md
git commit -m "docs: record Milestone 1 gate outcome"
```

---

## Out of Scope for This Plan

Milestones 2–5 from spec §8 get their own plans, written after the Task 7 gate passes:

- **M2** genome logic — `loci`, `genome`, `inherit`, `mutate`, `express`, `serialize`, including the two mandatory controls from spec §9 (segregation seen failing against a broken `inherit`; epistasis positive control).
- **M3** wiring — genes to growth, garden plots, the four verbs.
- **M4** accumulation — retirement, background compositing, depth-of-field.
- **M5** sharing and persistence — URL round-trip, localStorage.

They are deferred deliberately: the `Phenotype` fields M2 must produce are exactly what Task 7 may change, so planning them now would plan work the gate can invalidate.
