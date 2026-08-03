# Garden Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `#garden=` link that opens a read-only **visit** — someone else's bed and the forest behind it, frozen at the moment they shared it.

**Architecture:** A fourth Vite entry, `visit/`, that imports the renderer and a new decoder but never imports the four verbs or the save writer. Read-only is a property of the module graph, not a flag that six call sites have to remember. The draw half of `garden/garden.ts`'s `frame()` is extracted to `src/scene.ts` so both entries paint identically.

**Tech Stack:** TypeScript, Vite (multi-entry), vitest, Playwright drivers, canvas 2D. No new dependencies.

## Global Constraints

- **Node 24.** The ambient `node` is v18 and breaks the build. Use `~/miniconda3/envs/heirloom/bin/node` (and the matching `npx`) for every `npm`/`node` command in this plan.
- **Fail loud.** Every failure is named and surfaced (§10). Never substitute a default for bad input.
- **Non-disclosure (§4).** Traits are never shown before bloom. Anything that labels a plant gates on `isGrown(planting, now)`.
- **One definition per rule.** This repo has been bitten five times by two hand-maintained lists with nothing comparing them. Do not create a second copy of the genome bit layout, the driver list, or the origin set.
- **`npm run build` runs `tsc --noEmit && vite build`.** Both must pass before any commit.
- Prettier runs on write; do not fight its formatting.

---

### Task 1: Derive the driver list instead of enumerating it

CI already globs `tools/drive-*.mjs` (`.github/workflows/drivers.yml:74-82`), and its comment records why: an enumerated list "was written before `drive-drawer.mjs` existed and nothing noticed: the drawer shipped to the live site with its driver ungated." That fix landed on CI's half only. `package.json`'s `drive` script still names all seven drivers, so the two lists are a divergence waiting to happen — and this plan adds an eighth driver, which is exactly the trigger.

Fix the mechanism before adding to it.

**Files:**

- Create: `tools/run-drivers.mjs`
- Modify: `package.json:16` (the `drive` script)

**Interfaces:**

- Consumes: nothing.
- Produces: `npm run drive` discovers `tools/drive-*.mjs` from the filesystem. Later tasks add a driver by creating a file, with no list to update.

- [ ] **Step 1: Write the runner**

Create `tools/run-drivers.mjs`. **The name is load-bearing and is not `drive-all.mjs`** — see
the correction at the end of this plan: a runner named `drive-*.mjs` matches the very glob CI
uses to find drivers, so CI would have run the runner _and_ each driver it spawns, doubling the
whole suite silently. Naming it outside the prefix makes the collision impossible rather than
something to remember to guard, and it removes the need for the runner to filter itself out of
its own listing.

```js
/**
 * Run every behavioural driver, discovered from the filesystem.
 *
 * ENUMERATED lists of drivers have already failed once in this project: CI's list was written
 * before drive-drawer.mjs existed and the drawer shipped with its driver ungated
 * (.github/workflows/drivers.yml:74-82). CI was fixed with a glob; this script was not, so the
 * two lists sat side by side with nothing comparing them. Deriving both from the same source —
 * the directory — is what makes them unable to disagree.
 *
 * This file is deliberately named OUTSIDE the `drive-*` prefix: CI's glob and the filter below
 * both match `tools/drive-*.mjs`. If this runner matched its own pattern, CI would execute it
 * AND every driver it spawns individually — double-running the whole suite, silently, because
 * both passes succeed.
 *
 * The `check-*` tools are deliberately NOT run here: they are judged one at a time and some are
 * performance measurements that are meaningless on a shared runner.
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const drivers = readdirSync(here)
  .filter((f) => f.startsWith("drive-") && f.endsWith(".mjs"))
  .sort();

// A glob that matches nothing is an empty gate reporting success. Same floor CI uses.
if (drivers.length < 7) {
  console.error(
    `only ${drivers.length} drivers found in ${here} — expected at least 7`,
  );
  process.exit(1);
}

console.log(`running ${drivers.length} drivers: ${drivers.join(" ")}`);
for (const d of drivers) {
  const r = spawnSync(process.execPath, [join(here, d)], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`FAILED: ${d}`);
    process.exit(r.status ?? 1);
  }
}
console.log("all drivers passed");
```

- [ ] **Step 2: Verify it fails when the floor is not met**

Temporarily change the floor to `< 99` and run it:

```bash
~/miniconda3/envs/heirloom/bin/node tools/run-drivers.mjs
```

Expected: exits non-zero with `only 7 drivers found`. Then change the floor back to `< 7`. This is the only assertion in the file, and a floor nobody has watched fail is not a floor.

- [ ] **Step 3: Point the npm script at it**

In `package.json`, replace the `drive` script value with:

```json
"drive": "node tools/run-drivers.mjs && node tools/check-motion.mjs && node tools/check-viewports.mjs && node tools/check-phone.mjs"
```

- [ ] **Step 4: Run the full driver suite against a production bundle**

```bash
~/miniconda3/envs/heirloom/bin/npm run build
~/miniconda3/envs/heirloom/bin/npm run preview &
sleep 3
GARDEN_URL=http://localhost:4173/heirloom/garden/ ~/miniconda3/envs/heirloom/bin/npm run drive
```

Expected: `running 7 drivers: drive-drawer.mjs drive-forest.mjs …` then `all drivers passed`.
Kill preview with `pkill -f "vite.*4173"` — **not** `pkill -f "vite preview"`, which matches the invoking shell's own argv and kills itself (exit 144).

- [ ] **Step 5: Commit**

```bash
git add tools/run-drivers.mjs package.json
git commit -m "build: derive the driver list rather than maintaining a second copy"
```

---

### Task 2: Share the genome bit layout out of `serialize.ts`

`postcard.ts` needs to pack ~69 genomes into one payload, which means packing a genome **without** its own version and checksum bytes — those are 20% overhead at this scale. The bit-level helpers it needs (`BitWriter`, `BitReader`, `checksum`, the base64url pair) are all module-private in `src/genome/serialize.ts`.

**Writing a second copy of the genome bit layout inside `postcard.ts` would be the divergence bug for the sixth time in this repo, and the worst instance yet** — the two copies would silently decode each other's genomes into _different valid flowers_, with the checksum passing. Export one definition and have both callers use it.

**Files:**

- Modify: `src/genome/serialize.ts`
- Test: `test/serialize.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces, all exported from `src/genome/serialize.ts`:
  - `class BitWriter { constructor(n: number); readonly bytes: Uint8Array; write(value: number, width: number): void }`
  - `class BitReader { constructor(bytes: Uint8Array); read(width: number): number }`
  - `function writeGenomeBits(w: BitWriter, g: Genome): void`
  - `function readGenomeBits(r: BitReader): Genome`
  - `function checksumOf(bytes: Uint8Array, upto: number): number`
  - `function bytesToBase64Url(bytes: Uint8Array): string`
  - `function base64UrlToBytes(s: string): Uint8Array | null`
  - `const PAYLOAD_BYTES = 8` (already a module constant; export it)

- [ ] **Step 1: Write the failing test**

Add to `test/serialize.test.ts`:

```ts
import {
  BitReader,
  BitWriter,
  PAYLOAD_BYTES,
  readGenomeBits,
  serialize,
  writeGenomeBits,
} from "../src/genome/serialize";
import { randomGenome } from "../src/genome/genome";
import { mulberry32 } from "../src/rng";

describe("genome bits, shared with the postcard codec", () => {
  it("round-trips a genome through the bare bit layout", () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 50; i++) {
      const g = randomGenome(rand);
      const w = new BitWriter(PAYLOAD_BYTES);
      writeGenomeBits(w, g);
      expect(readGenomeBits(new BitReader(w.bytes))).toEqual(g);
    }
  });

  // The whole point of exporting these: one bit layout, two callers. If serialize() ever stops
  // going through writeGenomeBits, this is what notices.
  it("produces the same bits serialize() puts in its payload", () => {
    const g = randomGenome(mulberry32(99));
    const w = new BitWriter(PAYLOAD_BYTES);
    writeGenomeBits(w, g);
    // serialize() = version byte + these payload bytes + checksum byte.
    const full = serialize(g);
    const sameGenome = readGenomeBits(new BitReader(w.bytes));
    expect(serialize(sameGenome)).toBe(full);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
~/miniconda3/envs/heirloom/bin/npx vitest run test/serialize.test.ts
```

Expected: FAIL — `BitWriter` / `writeGenomeBits` are not exported.

- [ ] **Step 3: Export and refactor**

In `src/genome/serialize.ts`:

1. Change `class BitWriter` → `export class BitWriter`, `class BitReader` → `export class BitReader`, `function bytesToBase64Url` → `export function bytesToBase64Url`, `function base64UrlToBytes` → `export function base64UrlToBytes`, `const PAYLOAD_BYTES` → `export const PAYLOAD_BYTES`.
2. Rename `checksum` to `checksumOf` and export it; update its two call sites in `serialize` and `parseGenome`.
3. Extract the writer body. Move lines currently inside `serialize` (the `w.write(...)` sequence and the three `writePoly` calls, `garden`-independent) into:

```ts
/**
 * The genome bit layout — the ONE definition.
 *
 * `serialize` wraps this in a version byte and a checksum; the postcard codec packs many of
 * these behind a single version and checksum of its own. Two copies of this function would
 * decode each other's genomes into different, perfectly valid, checksum-passing flowers.
 */
export function writeGenomeBits(w: BitWriter, g: Genome): void {
  w.write(W_ALLELES.indexOf(g.W[0]), 1);
  w.write(W_ALLELES.indexOf(g.W[1]), 1);
  w.write(H1_ALLELES.indexOf(g.H1[0]), 1);
  w.write(H1_ALLELES.indexOf(g.H1[1]), 1);
  w.write(H2_ALLELES.indexOf(g.H2[0]), 1);
  w.write(H2_ALLELES.indexOf(g.H2[1]), 1);
  w.write(D_ALLELES.indexOf(g.D[0]), 1);
  w.write(D_ALLELES.indexOf(g.D[1]), 1);
  w.write(P_ALLELES.indexOf(g.P[0]), 2);
  w.write(P_ALLELES.indexOf(g.P[1]), 2);
  writePoly(w, g.V);
  writePoly(w, g.G);
  writePoly(w, g.B);
  w.write(I_ALLELES.indexOf(g.I[0]), 2);
  w.write(I_ALLELES.indexOf(g.I[1]), 2);
  w.write(N_ALLELES.indexOf(g.N[0]), 2);
  w.write(N_ALLELES.indexOf(g.N[1]), 2);
  w.write(L_ALLELES.indexOf(g.L[0]), 1);
  w.write(L_ALLELES.indexOf(g.L[1]), 1);
}

/** The v2 reader. `parseGenome` still handles the v1 tail itself, which this does not know about. */
export function readGenomeBits(r: BitReader): Genome {
  const W = [W_ALLELES[r.read(1)]!, W_ALLELES[r.read(1)]!];
  const H1 = [H1_ALLELES[r.read(1)]!, H1_ALLELES[r.read(1)]!];
  const H2 = [H2_ALLELES[r.read(1)]!, H2_ALLELES[r.read(1)]!];
  const D = [D_ALLELES[r.read(1)]!, D_ALLELES[r.read(1)]!];
  const P = [P_ALLELES[r.read(2)]!, P_ALLELES[r.read(2)]!];
  const V = readPoly(r);
  const G = readPoly(r);
  const B = readPoly(r);
  const I = [I_ALLELES[r.read(2)]!, I_ALLELES[r.read(2)]!];
  const N = [N_ALLELES[r.read(2)]!, N_ALLELES[r.read(2)]!];
  const L = [L_ALLELES[r.read(1)]!, L_ALLELES[r.read(1)]!];
  return { W, H1, H2, D, P, V, G, B, I, N, L } as Genome;
}
```

4. `serialize` now reads:

```ts
export function serialize(g: Genome): string {
  const w = new BitWriter(PAYLOAD_BYTES);
  writeGenomeBits(w, g);
  const out = new Uint8Array(TOTAL_BYTES);
  out[0] = GENOME_VERSION;
  out.set(w.bytes, 1);
  out[TOTAL_BYTES - 1] = checksumOf(out, TOTAL_BYTES - 1);
  return bytesToBase64Url(out);
}
```

5. Leave `parseGenome` structurally alone. It must keep its own reader because of the v1 tail fallback (`serialize.ts:206-213`), which `readGenomeBits` deliberately does not model. Add a comment saying so.

- [ ] **Step 4: Run the whole unit suite**

```bash
~/miniconda3/envs/heirloom/bin/npx vitest run
```

Expected: all pass, including the pre-existing `serialize.test.ts` cases. This is a pure refactor — any change in `serialize()`'s output is a bug.

- [ ] **Step 5: Commit**

```bash
git add src/genome/serialize.ts test/serialize.test.ts
git commit -m "refactor(genome): one definition of the bit layout, shared with the postcard codec"
```

---

### Task 3: The postcard codec

**Files:**

- Create: `src/game/postcard.ts`
- Test: `test/postcard.test.ts`

**Interfaces:**

- Consumes: `BitWriter`, `BitReader`, `writeGenomeBits`, `readGenomeBits`, `checksumOf`, `bytesToBase64Url`, `base64UrlToBytes`, `PAYLOAD_BYTES` from Task 2. `MAX_PLOTS` **and `BACKGROUND_REPLAY`** from `src/game/layout.ts`. `BACKGROUND_REPLAY` has to move there first — see the correction at the end of this plan: importing it from `src/game/save.ts` would put the save writer on the visit's import graph, one hop through `postcard.ts`, and make the Architecture section's central claim false in exchange for one integer.
- Produces:
  - `const POSTCARD_VERSION = 1`
  - `type PostcardPlot = { genome: Genome; age: number }`
  - `type Postcard = { W: number; H: number; plotCount: number; plots: (PostcardPlot | null)[]; forest: { genome: Genome; x: number }[] }`
  - `function packPostcard(p: Postcard): string`
  - `type PostcardResult = { ok: true; postcard: Postcard } | { ok: false; error: string }`
  - `function readPostcard(s: string): PostcardResult`

**Byte layout** (little-endian for the 16-bit fields):

| Offset | Field                                 | Bytes                 |
| ------ | ------------------------------------- | --------------------- |
| 0      | version                               | 1                     |
| 1-2    | world W                               | 2                     |
| 3-4    | world H                               | 2                     |
| 5      | plot count (2-9)                      | 1                     |
| 6      | occupied count k (0-9)                | 1                     |
| 7…     | k x (1 plot index + 8 genome + 2 age) | ≤ 99                  |
| …      | forest count m (0-60)                 | 1                     |
| …      | m x (8 genome + 2 x)                  | ≤ 600                 |
| last   | checksum                              | 1                     |
|        | **max total, base64url encoded**      | **708 -> ~944 chars** |

Occupied plots carry an explicit index rather than writing a placeholder genome for empty ones. A "zero genome" would not work as a sentinel: every allele index 0 is a **legal** genome, so an empty plot would decode as a real white flower.

- [ ] **Step 1: Write the failing tests**

Create `test/postcard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { randomGenome } from "../src/genome/genome";
import { serialize } from "../src/genome/serialize";
import { mulberry32 } from "../src/rng";
import {
  POSTCARD_VERSION,
  packPostcard,
  readPostcard,
  type Postcard,
} from "../src/game/postcard";

const rand = mulberry32(11);

function sample(plots: number, forest: number): Postcard {
  return {
    W: 1180,
    H: 470,
    plotCount: plots,
    plots: Array.from({ length: plots }, (_, i) =>
      i % 2 === 0 ? { genome: randomGenome(rand), age: 40 + i } : null,
    ),
    forest: Array.from({ length: forest }, (_, i) => ({
      genome: randomGenome(rand),
      x: 100 + i * 3,
    })),
  };
}

describe("the postcard codec", () => {
  it("round-trips a full garden byte-exact", () => {
    const p = sample(9, 60);
    const r = readPostcard(packPostcard(p));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.postcard.W).toBe(1180);
    expect(r.postcard.H).toBe(470);
    expect(r.postcard.plotCount).toBe(9);
    // Genome identity asserted through serialize(), not object equality: this is the property
    // that actually matters — the visitor grows the SAME plant — and it fails loudly on a
    // single wrong bit rather than on an incidental object shape.
    for (const [i, plot] of p.plots.entries()) {
      const got = r.postcard.plots[i];
      if (plot === null) expect(got).toBeNull();
      else expect(serialize(got!.genome)).toBe(serialize(plot.genome));
    }
    expect(r.postcard.forest.map((f) => serialize(f.genome))).toEqual(
      p.forest.map((f) => serialize(f.genome)),
    );
    expect(r.postcard.forest.map((f) => f.x)).toEqual(p.forest.map((f) => f.x));
  });

  it("round-trips a bare bed with no forest", () => {
    const p: Postcard = {
      W: 396,
      H: 430,
      plotCount: 2,
      plots: [null, null],
      forest: [],
    };
    const r = readPostcard(packPostcard(p));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.postcard.plots).toEqual([null, null]);
    expect(r.postcard.forest).toEqual([]);
  });

  it("survives a 9-plot garden being read on a 2-plot device", () => {
    // Nothing in the codec consults the local layout. This is the cross-device case that a
    // same-device test cannot see, and the reason the plot count is carried at all.
    const r = readPostcard(packPostcard(sample(9, 5)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.postcard.plotCount).toBe(9);
  });

  it("caps the forest at 60 entries", () => {
    const r = readPostcard(packPostcard(sample(9, 200)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.postcard.forest).toHaveLength(60);
  });

  it("clamps an age that would overflow its two bytes", () => {
    const p = sample(2, 0);
    p.plots[0] = { genome: randomGenome(rand), age: 999_999 };
    const r = readPostcard(packPostcard(p));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.postcard.plots[0]!.age).toBe(65535);
  });

  it("names a bad version rather than decoding it", () => {
    const good = packPostcard(sample(3, 3));
    // Flip the version byte by rebuilding the payload: decode, corrupt, re-encode is not
    // available, so assert on the message a hand-made bad string produces instead.
    const r = readPostcard("_" + good.slice(1));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/version|checksum|length/);
  });

  it("names a checksum mismatch", () => {
    const good = packPostcard(sample(3, 3));
    // Corrupt a character in the middle of the payload, away from the version byte.
    const at = Math.floor(good.length / 2);
    const swapped = good[at] === "A" ? "B" : "A";
    const bad = good.slice(0, at) + swapped + good.slice(at + 1);
    const r = readPostcard(bad);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/checksum|length/);
  });

  it("rejects a string that is not base64url", () => {
    const r = readPostcard("not a postcard!!");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/base64url/);
  });

  it("rejects an empty string", () => {
    const r = readPostcard("");
    expect(r.ok).toBe(false);
  });

  it("declares its version", () => {
    expect(POSTCARD_VERSION).toBe(1);
  });
});
```

- [ ] **Step 2: Run and watch every case fail**

```bash
~/miniconda3/envs/heirloom/bin/npx vitest run test/postcard.test.ts
```

Expected: FAIL — cannot resolve `../src/game/postcard`.

- [ ] **Step 3: Write the codec**

Create `src/game/postcard.ts`:

```ts
import type { Genome } from "../genome/genome";
import {
  BitReader,
  BitWriter,
  PAYLOAD_BYTES,
  base64UrlToBytes,
  bytesToBase64Url,
  checksumOf,
  readGenomeBits,
  writeGenomeBits,
} from "../genome/serialize";
// BACKGROUND_REPLAY comes from ./layout, NOT ./save. layout.ts is pure and canvas-free; save.ts
// is the writer this whole feature exists to stay off. `visit -> postcard -> save` is exactly
// the edge the architecture forbids, and an integer is not worth it.
import { BACKGROUND_REPLAY, MAX_PLOTS } from "./layout";

/**
 * A whole garden, packed for a URL fragment.
 *
 * Its own version, NOT `GENOME_VERSION`. The two change for different reasons: adding a locus
 * changes the genome layout, adding a field changes this one, and a shared version byte would
 * make each invalidate the other's links for no reason.
 */
export const POSTCARD_VERSION = 1;

/** Ages are two bytes. Past `maxTick` a plant is finished, so the ceiling costs nothing. */
const MAX_AGE = 0xffff;

export type PostcardPlot = { genome: Genome; age: number };

export type Postcard = {
  /** The SENDER's world. A visit renders this, scaled to fit, rather than reflowing. */
  W: number;
  H: number;
  /** How many plots the sender's bed had — 2 to 9, per MIN_PLOTS/MAX_PLOTS. */
  plotCount: number;
  /** Length always equals plotCount. Empty plots are null. */
  plots: (PostcardPlot | null)[];
  forest: { genome: Genome; x: number }[];
};

const u16 = (bytes: number[], v: number): void => {
  const n = Math.max(0, Math.min(MAX_AGE, Math.round(v)));
  bytes.push(n & 0xff, (n >> 8) & 0xff);
};

function genomeBytes(g: Genome): Uint8Array {
  const w = new BitWriter(PAYLOAD_BYTES);
  writeGenomeBits(w, g);
  return w.bytes;
}

export function packPostcard(p: Postcard): string {
  const body: number[] = [];
  u16(body, p.W);
  u16(body, p.H);

  const plotCount = Math.max(0, Math.min(MAX_PLOTS, p.plotCount));
  body.push(plotCount);

  const occupied = p.plots
    .slice(0, plotCount)
    .map((plot, i) => ({ plot, i }))
    .filter((e): e is { plot: PostcardPlot; i: number } => e.plot !== null);
  body.push(occupied.length);
  for (const { plot, i } of occupied) {
    body.push(i);
    body.push(...genomeBytes(plot.genome));
    u16(body, plot.age);
  }

  // Capped at the depth the background actually composites. Deeper layers render under 5%
  // contrast (see BACKGROUND_REPLAY), so carrying them would triple the link to send nothing.
  const forest = p.forest.slice(0, BACKGROUND_REPLAY);
  body.push(forest.length);
  for (const f of forest) {
    body.push(...genomeBytes(f.genome));
    u16(body, f.x);
  }

  const out = new Uint8Array(2 + body.length);
  out[0] = POSTCARD_VERSION;
  out.set(body, 1);
  out[out.length - 1] = checksumOf(out, out.length - 1);
  return bytesToBase64Url(out);
}

export type PostcardResult =
  | { ok: true; postcard: Postcard }
  | { ok: false; error: string };

export function readPostcard(s: string): PostcardResult {
  if (typeof s !== "string" || s.length === 0)
    return { ok: false, error: "empty garden code" };

  const bytes = base64UrlToBytes(s);
  if (!bytes)
    return {
      ok: false,
      error: "not base64url — illegal character in garden code",
    };
  // Shortest legal postcard: version + W + H + plotCount + 0 occupied + 0 forest + checksum.
  if (bytes.length < 8)
    return {
      ok: false,
      error: `garden code is too short: ${bytes.length} bytes`,
    };

  const version = bytes[0]!;
  if (version !== POSTCARD_VERSION)
    return {
      ok: false,
      error: `unsupported garden version ${version} (this build reads version ${POSTCARD_VERSION})`,
    };
  if (bytes[bytes.length - 1] !== checksumOf(bytes, bytes.length - 1))
    return {
      ok: false,
      error: "checksum mismatch — the garden code is corrupted",
    };

  let at = 1;
  const need = (n: number, what: string): string | null =>
    at + n > bytes.length - 1 ? `garden code ends mid-${what}` : null;
  const read16 = (): number => {
    const v = bytes[at]! | (bytes[at + 1]! << 8);
    at += 2;
    return v;
  };
  const readGenome = (): Genome => {
    const g = readGenomeBits(
      new BitReader(bytes.subarray(at, at + PAYLOAD_BYTES)),
    );
    at += PAYLOAD_BYTES;
    return g;
  };

  let bad = need(5, "header");
  if (bad) return { ok: false, error: bad };
  const W = read16();
  const H = read16();
  const plotCount = bytes[at++]!;
  if (plotCount > MAX_PLOTS)
    return {
      ok: false,
      error: `garden claims ${plotCount} plots (the most is ${MAX_PLOTS})`,
    };

  bad = need(1, "bed");
  if (bad) return { ok: false, error: bad };
  const occupied = bytes[at++]!;
  const plots: (PostcardPlot | null)[] = Array.from(
    { length: plotCount },
    () => null,
  );
  for (let n = 0; n < occupied; n++) {
    bad = need(1 + PAYLOAD_BYTES + 2, "bed");
    if (bad) return { ok: false, error: bad };
    const index = bytes[at++]!;
    const genome = readGenome();
    const age = read16();
    // Both must fail loud: plotCount is carried INSIDE this same postcard, so an index beyond
    // it, or a repeat of one already seen, is internally inconsistent — not version skew that
    // deserves silent tolerance. `if (index < plotCount)` would DROP the first and let the
    // second silently overwrite, in a decoder whose own plan says "never substitute a default
    // for bad input".
    if (index >= plotCount)
      return {
        ok: false,
        error: `plot ${index} is outside a ${plotCount}-plot bed`,
      };
    if (plots[index] !== null)
      return {
        ok: false,
        error: `plot ${index} appears twice in this garden`,
      };
    plots[index] = { genome, age };
  }

  bad = need(1, "forest");
  if (bad) return { ok: false, error: bad };
  const count = bytes[at++]!;
  const forest: { genome: Genome; x: number }[] = [];
  for (let n = 0; n < count; n++) {
    bad = need(PAYLOAD_BYTES + 2, "forest");
    if (bad) return { ok: false, error: bad };
    const genome = readGenome();
    forest.push({ genome, x: read16() });
  }

  return { ok: true, postcard: { W, H, plotCount, plots, forest } };
}
```

- [ ] **Step 4: Run the tests**

```bash
~/miniconda3/envs/heirloom/bin/npx vitest run test/postcard.test.ts
```

Expected: all 10 pass.

- [ ] **Step 5: Watch a control fail (mutation)**

Change `body.push(i)` to `body.push(0)` in `packPostcard` — every occupied plot now claims index 0.
Run the tests again. Expected: the round-trip test FAILS on plot placement, because the genomes land in the wrong plots. Revert the mutation. A control nobody has watched fail is not a control.

- [ ] **Step 6: Commit**

```bash
git add src/game/postcard.ts test/postcard.test.ts
git commit -m "feat(postcard): pack a whole garden into a URL fragment"
```

---

### Task 4: Extract the scene renderer

The draw half of `frame()` (`garden/garden.ts:1662-1720`) paints stage, forest, receding plants, swaying bed, soil and shadows. The visit needs all of it and none of the update half.

**Files:**

- Create: `src/scene.ts`
- Modify: `garden/garden.ts` (replace the draw block with a call)
- Test: none new — this is a pure extraction, and the seven existing drivers are its regression test.

**Interfaces:**

- Consumes: `paintStage`, `paintSoil`, `paintContactShadow` from `src/render/stage.ts`; `paintPlantCached` from `src/render/cache.ts`; `bedDepth`, `paintOrder` from `src/render/bed.ts`; `applySway`, `swayAt`, `applyPlacement`, `lerpPlacement`, `RECEDE_TICKS` from `src/render/motion.ts`; `express` from `src/genome/express.ts`; `genomeSeed` from `src/genome/serialize.ts`; `Forest` from `src/render/accumulate.ts`.
- Produces:

```ts
export type SceneOccupant = {
  genome: Genome;
  plant: Plant;
  plantedAt: number;
  maxTick: number;
};
export type SceneReceding = {
  plant: Plant;
  key: number;
  place: Placement;
  start: number;
};
export type Scene = {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  SOIL: number;
  dpr: number;
  forest: Forest;
  /** One entry per plot, null where bare. Length is the plot count. */
  occupants: (SceneOccupant | null)[];
  receding: SceneReceding[];
  /** Growth clock. Frozen in a visit. */
  now: number;
  /** Motion clock. Always advancing, in both entries. */
  motionNow: number;
  stageCache: HTMLCanvasElement | null;
};
export function drawScene(s: Scene): HTMLCanvasElement | null;
```

`drawScene` returns the stage cache so the caller can hold it across frames — the extraction keeps the cache in the caller rather than making the module stateful.

**Two clocks is the point of this signature.** `now` drives growth (`paintPlantCached` up to `now - plantedAt`), `motionNow` drives sway and gusts. In `garden/garden.ts` they are the same value; in the visit `now` is pinned and `motionNow` runs. A single clock parameter would make "frozen growth, living motion" impossible to express.

- [ ] **Step 1: Capture the baseline**

```bash
~/miniconda3/envs/heirloom/bin/npm run build
~/miniconda3/envs/heirloom/bin/npm run preview &
sleep 3
GARDEN_URL=http://localhost:4173/heirloom/garden/ ~/miniconda3/envs/heirloom/bin/npm run drive 2>&1 | tail -5
git rev-parse HEAD   # the pre-move tree, for the character-identity check in Step 4
```

Record that all drivers pass BEFORE touching anything. An extraction whose baseline was never captured cannot be shown to have preserved behaviour.

**Do not snapshot `measure-depth.mjs` here** — the earlier draft of this plan did, and that
baseline was worthless. See the correction at the end of this plan: the garden seeds its RNG from
the wall clock, so two runs of that tool on an unchanged build disagree by as much as any real
change would.

- [ ] **Step 2: Create `src/scene.ts`**

Move the code from `garden/garden.ts` verbatim — `drawStage`'s body, then the block from `forest.draw(ctx)` through the contact-shadow loop and any bloom-halo pass that follows it — substituting `s.` for the module-level `ctx`/`W`/`H`/`SOIL`/`dpr`/`forest`/`receding`, `s.now` for `now` inside `paintPlantCached` calls, and `s.motionNow` for `now` inside `swayAt`/`gustAt` calls.

Move `paintSwaying` (`garden/garden.ts:1493`) in as a module-private function taking `(s: Scene, occ: SceneOccupant, plotIndex: number)`.

Do not change any drawing logic, ordering, or constant. Paint order is load-bearing: `paintOrder` paints furthest-first so a nearer plant occludes a further one, contact shadows are a separate pass so a nearer plant's shadow does not land on a further plant's stem, and `paintSoil` runs after the plants so a stem's base is buried rather than stopping in mid-air.

- [ ] **Step 3: Call it from `garden/garden.ts`**

Replace the extracted block in `frame()` with:

```ts
stageCache = drawScene({
  ctx,
  W,
  H,
  SOIL,
  dpr,
  forest,
  occupants: garden.plots.map((p) => p.occupant),
  receding,
  now,
  motionNow: now,
  stageCache,
});
```

- [ ] **Step 4: Prove behaviour did not change**

```bash
~/miniconda3/envs/heirloom/bin/npm run build
~/miniconda3/envs/heirloom/bin/npm run preview &
sleep 3
GARDEN_URL=http://localhost:4173/heirloom/garden/ ~/miniconda3/envs/heirloom/bin/npm run drive
```

Expected: all drivers pass and `tsc` is clean.

Then prove the extraction was an extraction, by comparing the **code** rather than a picture of
it. Diff each moved region against its pre-move text and confirm every surviving difference is
the one substitution this task declares — `s.` in front of what used to be a module-level
binding, and `s.now` / `s.motionNow` where the single `now` used to be:

```bash
git show <baseline-sha>:garden/garden.ts > /tmp/garden-before.ts
# for each moved region: extract it from both files and diff, expecting ONLY the s. prefixes
```

A statement about the code is checkable; a statement about a rendered frame is not, because the
frame is not a function of the code alone. **The `measure-depth` diff this plan originally
prescribed here has been struck** — it cannot fail _or_ pass meaningfully. See the correction at
the end of this plan.

- [ ] **Step 5: Commit**

```bash
git add src/scene.ts garden/garden.ts
git commit -m "refactor(scene): one renderer, two clocks, so a visit can freeze growth without freezing motion"
```

---

### Task 5: The visit entry point

**Files:**

- Create: `visit/index.html`, `visit/visit.ts`
- Modify: `vite.config.ts:27-31` (add the entry)
- Test: covered by Task 7's driver.

**Interfaces:**

- Consumes: `readPostcard`, `Postcard` (Task 3); `drawScene`, `Scene` (Task 4); `grow`, `isGrown` from `src/game/garden.ts`; `computeLayout` from `src/game/layout.ts`; `Forest` from `src/render/accumulate.ts`; `genomeSeed` from `src/genome/serialize.ts`; `plotLabel` from `src/game/describe.ts`.
- Produces: a page at `/visit/` reading `#garden=<code>`. Exposes `window.__visitReady`, `window.__visitPlots()` (returns the serialized genome of each plot, `null` where bare) and `window.__visitError()` for the driver.

**This module must not import `src/game/save.ts`, `garden/garden.ts`, `src/game/pollinator.ts`, or `garden/insects.ts`.** That is the whole architecture: read-only is a property of what is on the module graph. Task 7 asserts it.

- [ ] **Step 0: Give plot positions one definition**

The visit lays out the **sender's** plot count in the **sender's** world. `computeLayout` cannot
do it — it derives the count from the local viewport, which is the reflow this design rejects.
The formula it uses (`src/game/layout.ts:76-90`) is the one the visit needs, so export it rather
than copying it.

In `src/game/layout.ts`:

```ts
/**
 * Where N plots sit in a world W wide.
 *
 * Exported because the VISIT needs to place the sender's plots in the sender's world, and
 * `computeLayout` cannot answer that — it decides the count from the local viewport. A second
 * copy of this arithmetic would put a visited garden's plants at subtly different positions
 * than the garden it was made from, which is the one thing a photograph must not do.
 */
export function plotPositions(W: number, plots: number): number[] {
  if (plots <= 0) return [];
  const inset = Math.min(135, W * 0.14);
  const usable = W - inset * 2;
  if (plots === 1) return [W / 2];
  return Array.from(
    { length: plots },
    (_, i) => inset + (i / (plots - 1)) * usable,
  );
}
```

Then rewrite `computeLayout`'s tail to call it, so the arithmetic exists once:

```ts
const plots = clamp(
  Math.floor(usable / MIN_PLOT_WIDTH) + 1,
  MIN_PLOTS,
  MAX_PLOTS,
);
return { W, H, soil: H - SOIL_BAND, plotXs: plotPositions(W, plots) };
```

Add to `test/layout.test.ts`:

```ts
it("computeLayout places its plots where plotPositions says", () => {
  for (const w of [360, 700, 1180]) {
    const l = computeLayout(w + 16, 540);
    expect(l.plotXs).toEqual(plotPositions(l.W, l.plotXs.length));
  }
});
```

Run `~/miniconda3/envs/heirloom/bin/npx vitest run test/layout.test.ts` — expected PASS, and the
existing layout tests must be unchanged, since this is arithmetic moved rather than altered.

- [ ] **Step 1: The page**

Create `visit/index.html`, copying the `<canvas id="c">`, the `#say` live region and the stylesheet block from `garden/index.html`, and adding the strip:

```html
<div id="strip" role="status">
  <span id="strip-text">you're visiting a shared garden</span>
  <a id="strip-back" href="../garden/">return to your own garden</a>
</div>
<div id="wrap"><canvas id="c" aria-hidden="true"></canvas></div>
<ul id="mirror" class="sr-only" aria-label="this garden"></ul>
<p id="say" aria-live="polite" class="sr-only"></p>
```

The canvas is wrapped so a failed visit can hide the whole thing with one `hidden` attribute
without disturbing the inline width/height `fit()` writes onto the canvas.

The mirror is a `<ul>` of `<li>`, **not** buttons — there is nothing to activate in a read-only garden, and a button that does nothing is worse than no button.

- [ ] **Step 2: The module**

Create `visit/visit.ts`:

```ts
/**
 * A VISIT — someone else's garden, read-only.
 *
 * Read-only by CONSTRUCTION. This module does not import the four verbs, the save writer, or
 * the pollinators, so no guard can be forgotten: a function that is not on the module graph
 * cannot be called by accident. The alternative — a `visiting` flag inside garden.ts — needed
 * six guards whose failure mode was silently writing a stranger's garden over the visitor's.
 */
import { grow, isGrown, type Planting } from "../src/game/garden";
import { readPostcard, type Postcard } from "../src/game/postcard";
import { computeLayout, plotPositions, SOIL_BAND } from "../src/game/layout";
import { serialize as serializeGenome } from "../src/genome/serialize";
import { Forest } from "../src/render/accumulate";
import { genomeSeed } from "../src/genome/serialize";
import { drawScene } from "../src/scene";
// SPEED has to MOVE to src/render/motion.ts as part of this task. It currently lives in
// garden/garden.ts, which the visit must never import, and both entries need the same tick rate:
// a hardcoded 1.4 here is the two-copies-of-one-rule bug this plan's Global Constraints forbid.
import { SPEED } from "../src/render/motion";

// The canvas lives inside `#wrap` so `fail()` has something to hide — hiding the canvas itself
// would fight the sizing rules `fit()` writes onto its style attribute.
const wrap = document.getElementById("wrap")!;
const canvas = document.getElementById("c") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const stripText = document.getElementById("strip-text")!;
const mirror = document.getElementById("mirror")!;
const say = document.getElementById("say")!;

let failure: string | null = null;

function fail(message: string): void {
  // §10: name what went wrong. An empty garden rendered silently would read as the sender
  // having nothing to show, which is a lie about someone else's afternoon — so the canvas is
  // REMOVED from the page as well as left unpainted, and the render loop below never starts.
  // A bed of bare plots IS a legitimate garden, so painting one on failure is precisely the
  // confusion this message exists to prevent.
  failure = message;
  stripText.textContent = `that garden link could not be opened — ${message}`;
  document.getElementById("strip-back")!.textContent = "start your own garden";
  wrap.hidden = true;
  say.textContent = stripText.textContent;
}

/**
 * The code is taken up to the next `&` and handed to the codec UNVALIDATED.
 *
 * Deliberately NOT `([A-Za-z0-9_-]+)`: that pattern stops at the first illegal character and
 * passes the TRUNCATED prefix on, so a link with one mistyped byte in the middle is reported as
 * a checksum failure instead of as the illegal character it actually is. What counts as a legal
 * code is `readPostcard`'s to decide, and it already says so precisely.
 */
const code = /[#&]garden=([^&]*)/.exec(location.hash);
const result = code ? readPostcard(code[1]!) : null;
if (!code) fail("there is no garden in this link");
else if (result && !result.ok) fail(result.error);

const postcard: Postcard | null = result?.ok ? result.postcard : null;

/**
 * The SENDER's world, scaled to fit — not reflowed to the visitor's plot count.
 *
 * A visit is a photograph, and a photograph letterboxes. Reflowing would also distort the
 * bed-to-forest scale gap (1.00-0.86 against 0.82) that keeps live plants legible as the
 * subject; `src/game/layout.ts:31` explicitly warns against trading it away.
 */
const W = postcard?.W ?? 1180;
const H = postcard?.H ?? 470;
// SOIL_BAND, not a literal 80: computeLayout derives `soil` as `H - SOIL_BAND`, and a second
// copy of that number would drift the visited soil line away from the sender's.
const SOIL = H - SOIL_BAND;
const dpr = Math.min(2, window.devicePixelRatio || 1);

function fit(): void {
  const box = computeLayout(window.innerWidth, window.innerHeight);
  const scale = Math.min(box.W / W, box.H / H);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = `${Math.round(W * scale)}px`;
  canvas.style.height = `${Math.round(H * scale)}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
const forest = new Forest(W, H, dpr);
for (const entry of postcard?.forest ?? [])
  forest.retire(
    grow(entry.genome, entry.x, SOIL).plant,
    genomeSeed(entry.genome),
  );

// The growth clock is PINNED. Each plant is grown to the age it had when the link was made, by
// planting it that many ticks in the past against a clock that never advances.
const FROZEN = 100_000;
//
// Positions come from plotPositions(W, plotCount) — the SENDER's world and the SENDER's plot
// count. computeLayout() would be wrong here: it derives the count from the visitor's viewport,
// which is exactly the reflow this design rejects.
const xs = plotPositions(W, postcard?.plotCount ?? 0);
const occupants: (Planting | null)[] = (postcard?.plots ?? []).map((p, i) => {
  if (!p) return null;
  return { ...grow(p.genome, xs[i] ?? W / 2, SOIL), plantedAt: FROZEN - p.age };
});

let stageCache: HTMLCanvasElement | null = null;
let motionNow = 0;

function frame(): void {
  // Growth is frozen; MOTION is not. `now` never moves, `motionNow` does — the two-clock
  // signature on `drawScene` exists for exactly this.
  motionNow += SPEED;
  stageCache = drawScene({
    ctx,
    W,
    H,
    SOIL,
    dpr,
    forest,
    occupants,
    receding: [],
    now: FROZEN,
    motionNow,
    stageCache,
  });
  requestAnimationFrame(frame);
}

// The loop only starts if there is a garden to draw. `fail()` sets `failure` and hides the
// canvas; starting the loop anyway would paint a bare bed underneath the error message, which
// is the failure the Failure section of the spec forbids in so many words.
if (!failure) {
  fit();
  window.addEventListener("resize", fit);
  requestAnimationFrame(frame);
}

// A blind visitor hears the bed they are visiting. A list, not buttons: there is nothing to
// activate. Gated on isGrown for the same reason the garden's mirror is — an ungrown plant does
// not disclose its traits, and a visit is not a loophole in §4.
mirror.innerHTML = occupants
  .map((occ, i) => {
    if (!occ) return `<li>plot ${i + 1}, empty</li>`;
    return `<li>plot ${i + 1}, ${isGrown(occ, FROZEN) ? "a grown plant" : "still growing"}</li>`;
  })
  .join("");

declare global {
  interface Window {
    __visitReady?: boolean;
    __visitPlots?: () => (string | null)[];
    __visitError?: () => string | null;
  }
}
window.__visitPlots = () =>
  occupants.map((o) => (o ? serializeGenome(o.genome) : null));
window.__visitError = () => failure;
window.__visitReady = true;
```

This depends on `plotPositions`, which Step 0 below adds.

- [ ] **Step 3: Register the entry**

In `vite.config.ts`, add to `rollupOptions.input`:

```ts
visit: here("./visit/index.html"),
```

- [ ] **Step 4: Verify it builds and renders**

```bash
~/miniconda3/envs/heirloom/bin/npm run build
```

Expected: `tsc` clean, and the build output lists `visit/index.html`. If it does not, the entry is not registered — and the build would still have succeeded, which is the worst way for it to be wrong (`vite.config.ts:24`).

- [ ] **Step 5: Commit**

```bash
git add visit/ vite.config.ts src/game/layout.ts
git commit -m "feat(visit): a read-only garden, frozen at the moment it was shared"
```

---

### Task 6: The drawer's copy-link line

**Files:**

- Modify: `garden/garden.ts` (`renderDrawer`, near line 1325-1346)
- Test: covered by Task 7's driver.

**Interfaces:**

- Consumes: `packPostcard` (Task 3).
- Produces: a `<button id="share-garden">` at the head of `#drawer`, and `window.__gardenCode()` returning the packed string for the driver.

- [ ] **Step 1: Build the postcard from live state**

Add to `garden/garden.ts`:

```ts
/**
 * This garden as a postcard.
 *
 * `retirementLog` rather than `garden.retired`: retired plants are composited into the
 * background on load, so `garden.retired` comes back EMPTY after a reload
 * (`src/game/save.ts:89`). The durable history is the replay list.
 *
 * The forest is sent NEWEST-first-trimmed — `slice(-BACKGROUND_REPLAY)` — because the layers
 * that render are the most recent ones, and order within them is load-bearing: the forest
 * layers by retirement order and `remainingContrast` keys off the count.
 */
function gardenPostcard(): string {
  return packPostcard({
    W,
    H,
    plotCount: garden.plots.length,
    plots: garden.plots.map((p) =>
      p.occupant
        ? {
            genome: p.occupant.genome,
            // Clamped at pack time too, but clamping here keeps the intent local: past maxTick
            // nothing about the plant changes, so a garden left open overnight sends the same
            // picture as one shared the moment it finished.
            age: Math.min(now - p.occupant.plantedAt, p.occupant.maxTick),
          }
        : null,
    ),
    forest: retirementLog.slice(-BACKGROUND_REPLAY).flatMap((e) => {
      const parsed = parseGenome(e.g);
      return parsed.ok ? [{ genome: parsed.genome, x: e.x }] : [];
    }),
  });
}

window.__gardenCode = () => gardenPostcard();
```

Add `__gardenCode?: () => string` to the existing `declare global` block, and import `BACKGROUND_REPLAY` from `../src/game/save` and `packPostcard` from `../src/game/postcard`.

- [ ] **Step 2: Add the line to the drawer**

In `renderDrawer`, prepend to the generated HTML (before the `retirementLog` entries, and in both the empty and non-empty branches so an unplayed garden can still be shared):

```ts
const shareRow = `<button id="share-garden" type="button">copy a link to this garden</button>`;
```

Wire it after `drawerEl.innerHTML` is assigned:

```ts
drawerEl.querySelector("#share-garden")?.addEventListener("click", () => {
  const url = `${location.origin}${location.pathname.replace(/garden\/$/, "visit/")}#garden=${gardenPostcard()}`;
  void navigator.clipboard
    .writeText(url)
    .then(() => {
      notice = "link copied — it opens this garden for anyone who follows it";
      announce(notice);
      setTimeout(() => {
        notice = "";
      }, 3200);
    })
    .catch((e: Error) => {
      // Clipboard access is permission-gated and fails in plenty of contexts. Fold the URL into
      // the NOTICE, and name the reason it failed.
      //
      // NOT `codeEl.textContent = url`, which an earlier draft of this plan prescribed: `codeEl`
      // belongs to the tray's own share writer, which rewrites it whenever the newest seed
      // changes (garden/garden.ts:1755). The garden link would be stomped — exactly when the
      // clipboard was unavailable and this fallback was the only way to get the link at all.
      notice = `could not copy (${e.message}) — ${url}`;
      announce(notice);
    });
});
```

- [ ] **Step 3: Verify by hand**

```bash
~/miniconda3/envs/heirloom/bin/npm run build && ~/miniconda3/envs/heirloom/bin/npm run preview
```

Open `http://localhost:4173/heirloom/garden/`, open the drawer, click the line, paste the URL into a new tab. Expected: the visit page shows the same bed.

- [ ] **Step 4: Commit**

```bash
git add garden/garden.ts
git commit -m "feat(drawer): copy a link to this garden"
```

---

### Task 7: The driver

**Files:**

- Create: `tools/drive-visit.mjs`

**Interfaces:**

- Consumes: `window.__gardenCode()` (Task 6), `window.__visitReady` / `__visitPlots()` / `__visitError()` (Task 5).
- Produces: nothing. Task 1 makes `npm run drive` and CI pick it up with no list to edit.

- [ ] **Step 1: Write the driver**

Create `tools/drive-visit.mjs`:

```js
/**
 * Real-execution check for garden sharing.
 *
 * Two contexts: a SENDER who breeds a garden, and a VISITOR who already has a DIFFERENT garden
 * of their own. The visitor's save being untouched is the assertion this whole architecture
 * exists to earn, and a single-context test cannot make it.
 */
import { chromium } from "playwright";

const BASE = process.env.GARDEN_URL ?? "http://localhost:5173/garden/";
const VISIT = BASE.replace(/garden\/$/, "visit/");
const browser = await chromium.launch();

let failures = 0;
function check(label, ok, detail = "") {
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!ok) failures++;
}

// ── THE SENDER ───────────────────────────────────────────────────────────────────────────────
const sender = await browser.newContext();
const a = await sender.newPage();
const errors = [];
a.on("pageerror", (e) => errors.push(e.message));
await a.goto(BASE, { waitUntil: "networkidle" });
await a.evaluate(() => localStorage.clear());
await a.reload({ waitUntil: "networkidle" });
await a.waitForFunction(() => window.__ready === true, { timeout: 15000 });
await a.evaluate(() => window.__seek(window.__now() + 100000));
await a.waitForTimeout(200);

const senderPlots = await a.evaluate(() => window.__codes().plots);
check(
  "CONTROL: the sender has a bed to share",
  senderPlots.some(Boolean),
  senderPlots.join(","),
);
const code = await a.evaluate(() => window.__gardenCode());
check(
  "the sender can produce a garden code",
  typeof code === "string" && code.length > 40,
  `${code?.length} chars`,
);

// ── THE VISITOR ──────────────────────────────────────────────────────────────────────────────
const visitor = await browser.newContext();
const b = await visitor.newPage();
b.on("pageerror", (e) => errors.push(e.message));
await b.goto(BASE, { waitUntil: "networkidle" });
await b.evaluate(() => localStorage.clear());
await b.reload({ waitUntil: "networkidle" });
await b.waitForFunction(() => window.__ready === true, { timeout: 15000 });
await b.evaluate(() => window.__seek(window.__now() + 40000));
await b.waitForTimeout(200);

const ownBefore = await b.evaluate(() =>
  localStorage.getItem("heirloom.garden.v1"),
);
const ownPlots = await b.evaluate(() => window.__codes().plots);
check("CONTROL: the visitor has a garden of their own", Boolean(ownBefore));
// If the two gardens happened to be identical, "unchanged" would be unfalsifiable.
check(
  "CONTROL: and it is a DIFFERENT garden from the sender's",
  JSON.stringify(ownPlots) !== JSON.stringify(senderPlots),
);

await b.goto(`${VISIT}#garden=${code}`, { waitUntil: "networkidle" });
await b.waitForFunction(() => window.__visitReady === true, { timeout: 15000 });
check(
  "the visit opened without an error",
  (await b.evaluate(() => window.__visitError())) === null,
  String(await b.evaluate(() => window.__visitError())),
);

// PROVENANCE, not arrival. "nine plants appeared" would pass on a bed of random plants.
const shown = await b.evaluate(() => window.__visitPlots());
check(
  "the visited bed is the SENDER's garden, plant for plant",
  JSON.stringify(shown) === JSON.stringify(senderPlots),
  `${JSON.stringify(shown)} vs ${JSON.stringify(senderPlots)}`,
);
check(
  "and it is NOT the visitor's own garden",
  JSON.stringify(shown) !== JSON.stringify(ownPlots),
);

// ── THE CONTROL THAT MATTERS ─────────────────────────────────────────────────────────────────
await b.goto(BASE, { waitUntil: "networkidle" });
await b.waitForFunction(() => window.__ready === true, { timeout: 15000 });
const ownAfter = await b.evaluate(() =>
  localStorage.getItem("heirloom.garden.v1"),
);
check(
  "CONTROL: the visitor's own save is byte-identical after the visit",
  ownAfter === ownBefore,
  ownAfter === ownBefore ? "" : "THE VISIT WROTE TO THE VISITOR'S SAVE",
);

// ── FROZEN GROWTH ────────────────────────────────────────────────────────────────────────────
await b.goto(`${VISIT}#garden=${code}`, { waitUntil: "networkidle" });
await b.waitForFunction(() => window.__visitReady === true, { timeout: 15000 });
// NOT `__visitPlots()` twice: that hook returns GENOMES, which do not change with age, so the
// comparison is true whatever the clock does. See the correction at the end of this plan.
// Growth is visible in PIXELS, so measure foliage area — sway translates and rotates foliage and
// leaves its area alone, while growth adds foliage — against a LIVE page as the control.
const frozenBefore = await canopy(p);
const livingBefore = await canopy(a);
await b.waitForTimeout(3000);
const livingAfter = await canopy(a);
const frozenAfter = await canopy(p);

const living = grewBy(livingBefore, livingAfter);
const frozen = grewBy(frozenBefore, frozenAfter);
check(
  "CONTROL: the frozen visit drew a garden at all — an empty canvas cannot fail this",
  frozenBefore.area > 1000,
  `${frozenBefore.area} foliage pixels`,
);
check("CONTROL: the LIVE garden grew over the same window", living > 0.2);
check(
  "CONTROL: and the frozen visit is still PAINTING — motion is not frozen too",
  (await changedSince(p)) > 0,
);
check(
  "growth does not advance during a visit",
  // Relative to the growth measured in the SAME run, not an absolute threshold: a fixed number
  // would be a machine-specific constant pretending to be a property of the feature.
  Math.abs(frozen) < living / 10,
  `frozen ${(frozen * 100).toFixed(2)}% vs living ${(living * 100).toFixed(1)}%`,
);

// ── FAILURE IS NAMED ─────────────────────────────────────────────────────────────────────────
await b.goto(`${VISIT}#garden=notarealgarden`, { waitUntil: "networkidle" });
await b.waitForFunction(() => window.__visitReady === true, { timeout: 15000 });
const err = await b.evaluate(() => window.__visitError());
check(
  "CONTROL: a garbage link names what was wrong",
  typeof err === "string" && err.length > 0,
  String(err),
);
await b.goto(BASE, { waitUntil: "networkidle" });
await b.waitForFunction(() => window.__ready === true, { timeout: 15000 });
check(
  "CONTROL: and a failed visit wiped nothing",
  (await b.evaluate(() => localStorage.getItem("heirloom.garden.v1"))) ===
    ownBefore,
);

check("no page errors", errors.length === 0, errors.join(" · "));
await browser.close();
console.log(failures ? `${failures} FAILED` : "all visit checks passed");
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run it**

```bash
~/miniconda3/envs/heirloom/bin/npm run build
~/miniconda3/envs/heirloom/bin/npm run preview &
sleep 3
GARDEN_URL=http://localhost:4173/heirloom/garden/ ~/miniconda3/envs/heirloom/bin/node tools/drive-visit.mjs
```

Expected: `all visit checks passed`.

- [ ] **Step 3: Watch the control that matters actually fail**

Add this line to the top of `visit/visit.ts`, which is precisely the failure the architecture claims to prevent:

```ts
localStorage.setItem(
  "heirloom.garden.v1",
  '{"v":2,"plots":[],"ages":[],"tray":[],"replay":[],"notebook":[],"nextSeedId":1}',
);
```

Rebuild and re-run. Expected: **FAIL** on `the visitor's own save is byte-identical after the visit — THE VISIT WROTE TO THE VISITOR'S SAVE`. Remove the line and rebuild.

This is mandatory, not optional. Three controls in this codebase in the last two days passed while testing nothing.

- [ ] **Step 4: Confirm the module graph claim — with a graph walk, not a grep**

The grep this step originally prescribed —
`grep -n "save\|pollinator\|insects" visit/visit.ts` — **is struck.** It could not
discriminate in either direction, and it was demonstrated printing nothing while the graph was
genuinely compromised. See the correction at the end of this plan.

Create `test/visit-isolation.test.ts` instead. It walks the **transitive** relative-import
closure from each entry, using `import.meta.glob(..., { query: "?raw" })` for the sources, and:

- asserts `visit/visit.ts` reaches none of `src/game/save.ts`, `garden/garden.ts`,
  `src/game/pollinator.ts`, `garden/insects.ts`;
- names the **path through the graph** on failure
  (`visit/visit.ts -> src/game/postcard.ts -> src/game/save.ts`), so the output identifies the
  import to delete rather than leaving the reader to find it;
- asserts the inverse mistake too: the pure model `src/game/garden.ts` — a different file from
  the controller `garden/garden.ts` by one path segment — **is** on the visit's graph, since a
  visit has to grow the plants it was sent;
- carries a **positive control**: `garden/garden.ts` genuinely does reach three of the four
  forbidden modules, each across a real edge (path length ≥ 2), so a walker that read nothing
  fails here loudly rather than passing above silently. `garden/garden.ts` itself is excluded
  from that control, because the walker seeds its result with the entry before following any
  edge — "the control reaches its own entry" is true of a walker that reads no files at all;
- has its extractor unit-tested against every import form in the repo, multi-line included. The
  first walker matched whole `import … from "…"` statements on one line, which is not the shape
  of a single import in `garden/garden.ts`, so it reported a perfect clean while reading almost
  nothing.

If `readPostcard` pulls `BACKGROUND_REPLAY` from `save.ts` into the visit bundle, this test names
that exact edge. Moving the constant to `src/game/layout.ts` (Task 3) is the fix — the
architecture's claim is about the graph, and an integer is not worth weakening it for.

- [ ] **Step 5: Full suite**

```bash
~/miniconda3/envs/heirloom/bin/npx vitest run
GARDEN_URL=http://localhost:4173/heirloom/garden/ ~/miniconda3/envs/heirloom/bin/npm run drive
```

Expected: all unit tests pass; `running 8 drivers:` — the new one picked up with no list edited, which is Task 1 paying for itself.

- [ ] **Step 6: Commit**

```bash
git add tools/drive-visit.mjs
git commit -m "test(visit): two contexts, and the visitor's save proven untouched"
```

---

### Task 8: Documentation, and the spec corrections this plan found

**Files:**

- Modify: `README.md`, `CHANGELOG.md`, `docs/superpowers/specs/2026-08-02-heirloom-garden-sharing-design.md`

- [ ] **Step 1: Correct the spec**

Writing the codec found two things the approved spec got wrong. Fix them where they were stated, not only here:

1. **The world needs `H` as well as `W`.** `Layout` carries `H` and `soil`, and `H` is clamped to 430-470 (`src/game/layout.ts:51-58`). Carrying only width would let the visitor's height apply to the sender's bed, moving the soil line relative to the plants — a distorted photograph. Update the byte table: world W and H, 4 bytes.
2. **Empty plots cannot be a zero genome.** The spec says a bare plot "writes a zero genome and is skipped on read". Every allele index 0 is a _legal_ genome, so that sentinel decodes to a real white flower. The codec carries an occupied count and an explicit plot index instead. Update the table to the layout in Task 3, total 708 bytes → ~944 characters.

- [ ] **Step 2: README**

Add sharing to the feature list. Do **not** state a test count — the README carried a stale one for three sessions, and resyncing a hand-maintained number just restarts the drift clock.

- [ ] **Step 3: CHANGELOG**

Add an entry under a new version heading describing the visit, the codec, and the driver-list fix.

- [ ] **Step 4: Commit and open a draft PR**

```bash
git add README.md CHANGELOG.md docs/
git commit -m "docs: sharing a whole garden"
git push -u origin garden-sharing
gh pr create --draft --title "feat: sharing a whole garden" --body "..."
```

The PR title must describe what the branch actually contains. `gh pr merge --squash` inherits it, and a title written before the implementation has now shipped the wrong squash commit twice in this project (#7, #11).

---

## Corrected during implementation

Seven defects in this plan were found by building it. They are fixed in the tasks above and
listed here, because a plan that silently rewrites itself into having been right teaches nothing,
and the ones worth remembering are the **checks that could not fail** — four of the seven. Those
are more dangerous than a wrong line of code, because a wrong line fails and a dead check
reports success forever.

1. **The runner was named `tools/drive-all.mjs`, which matches CI's own driver glob.** CI finds
   drivers with `tools/drive-*.mjs`, and Task 1's whole purpose is to stop maintaining a second
   list — so the runner it creates would have been picked up as a driver. CI would have run the
   runner _and_ each of the seven drivers individually: every driver executed twice, silently,
   because both passes succeed and nothing in the log distinguishes them. It ships as
   `tools/run-drivers.mjs`. The self-filter (`f !== "drive-all.mjs"`) the original needed is gone
   with it — a name outside the prefix makes the collision impossible rather than guarded.

2. **Task 3 imported `BACKGROUND_REPLAY` from `./save`.** `postcard.ts` is on the visit's import
   graph, so that single import would have put `src/game/save.ts` — the save writer — one hop
   from `visit/visit.ts`, making the Architecture section's central claim false. Read-only "is a
   property of the module graph" is either true of the whole graph or it is not a property at
   all. `BACKGROUND_REPLAY` moved to `src/game/layout.ts`, which is pure and canvas-free.

3. **The decoder silently dropped bad plot indices.** `if (index < plotCount) plots[index] = …`
   discards an out-of-range index without a word, and lets a repeated index overwrite the plot it
   already filled. Both are internally inconsistent — `plotCount` is carried inside the same
   postcard — and both contradict this plan's own Global Constraints ("never substitute a default
   for bad input") and the project's §10. Two named errors now.

4. **Task 4's verification could not fail — or pass.** It prescribed diffing `measure-depth`
   output before and after the extraction and expecting them identical. But the garden seeds its
   RNG from the wall clock (`garden/garden.ts:143`, `mulberry32(Date.now() & 0x7fffffff)`), so
   every page load grows _different_ founders — which appear in the bed and, once retired, in the
   background that tool samples. Run twice on an **unchanged** build, it disagrees with itself by
   the same magnitude as any real regression would produce. It is not a weak check; it is noise
   with a threshold drawn on it, and it would have been read either as a false alarm or as
   permission. What shipped instead is a statement about the _code_: the moved regions were shown
   character-identical to their pre-move text under only the declared substitution. Worth noting
   in passing — a `__seed(n)` test hook would make visual measurement genuinely possible here.
   None exists yet, and adding one was out of scope for this branch.

5. **Task 5's draft module had four defects.** It hardcoded `H - 80` instead of importing
   `SOIL_BAND`; it hardcoded `1.4` instead of `SPEED`, which had to move to `src/render/motion.ts`
   so both entries could reach one definition (it lived in `garden/garden.ts`, which the visit
   must not import); its `fail()` set an error message but did **not** stop the render loop, so a
   bad link painted an **empty bed** under the error — the exact confusion the spec's Failure
   section forbids, since a bare bed is a legitimate garden; and its URL regex
   `([A-Za-z0-9_-]+)` stops at the first illegal character and hands the **truncated** prefix to
   the codec, so a mistyped link was reported as a checksum failure rather than as the illegal
   character it was. Two of these — the constants — are the same duplicate-definition mechanism
   the Global Constraints name, reintroduced by the plan that names them.

6. **Task 6's clipboard fallback wrote to a node it does not own.** `codeEl` is the tray's share
   writer's element, rewritten whenever the newest seed changes (`garden/garden.ts:1755`), so the
   garden URL would have been stomped — precisely when the clipboard was unavailable and the
   fallback was the only way to get the link. The URL goes into the notice instead, with the
   clipboard's own error message beside it.

7. **Task 7's Step 4 was a dead check, and it was demonstrated dead.** A grep of `visit/visit.ts`
   for `save|pollinator|insects` cannot discriminate in either direction. It **false-positives on
   prose**: the doc comment that explains the read-only rule contains all three words, so the
   grep fired on an untouched file and the "fix" was to reword a comment — the check was
   measuring English. It **false-negatives on the actual risk**, which is not a direct import
   (nobody writes that by accident) but a module reached transitively, one or two hops down,
   where a grep of one file sees nothing. It was observed printing **nothing** while the graph
   was genuinely compromised. Replaced by `test/visit-isolation.test.ts`, which walks the
   transitive graph, names the path on failure, and carries a positive control proving the walker
   can see the forbidden modules when they really are there.

Two further notes, for the record rather than as defects in the prescribed steps:

- **The same dead control appeared twice.** Task 7's driver compared `__visitPlots()` at two
  moments to prove growth was frozen, and the spec's Testing section listed the same comparison in
  prose. That hook returns _genomes_, which do not change with age, so it was true whatever the
  clock did — it would have passed on a visit that grew normally, one that grew backwards, and one
  with no clock at all. Corrected in both places, since a retraction that reaches only one of the
  two sites leaves the wrong version still authoritative somewhere.
- **Task 8's scope was larger than it was written.** It anticipated two spec corrections. Seven
  defects were found, across both documents.

---

## Self-Review

**Spec coverage.** Visit-not-import → Task 5. Read-only by construction → Tasks 5, 7 step 4. Frozen growth/living motion → Task 4's two clocks, Task 5, asserted in Task 7. Forest capped at 60 → Task 3. Tray/notebook/provenance excluded → Task 3's `Postcard` has no field for them. Codec and byte table → Task 3. Age clamping → Task 3. Fragment non-collision → Task 5's regex `[#&]garden=`; the existing `[#&]g=` requires `=` immediately after `g` and cannot match it. Plot count and cross-device → Task 3 tests, Task 5's `plotPositions`. Separate Vite entry → Task 5. `scene.ts` extraction → Task 4. Drawer affordance → Task 6. Strip and a11y list → Task 5. Loud failure → Tasks 3, 5, asserted in Task 7. All five named negative controls → Task 7.

**Not from the spec, added deliberately:** Task 1 (the driver list) and Task 2 (sharing the genome bit layout). Both are prerequisites — Task 7 adds a driver to a list already known to diverge, and Task 3 would otherwise have to copy the genome bit layout. Both are the same mechanism the spec's architecture section is about.

**Type consistency.** `Postcard.plots` is `(PostcardPlot | null)[]` in Tasks 3, 5 and 6. `drawScene` takes `occupants` in Tasks 4 and 5. `readPostcard` returns `PostcardResult` and is destructured as `.ok`/`.postcard`/`.error` in Tasks 3 and 5. `checksumOf` is the renamed export in Tasks 2 and 3.

**One defect found and fixed in review.** The first draft of Task 5 referenced `postcard.plotXs`, a field no task defines, and the self-review initially rationalised it as a deliberate prompt to the implementer. That is a trap, not a plan: the skill's rule is that referencing an undefined member is a plan failure, and an implementer following the code literally would have hit a type error with no path forward. Task 5 now opens with Step 0, which exports `plotPositions(W, plots)` from `src/game/layout.ts` and has `computeLayout` call it, and the visit uses that. The rationalisation is the tell worth remembering — when a review's output is an excuse rather than an edit, the review has failed.
