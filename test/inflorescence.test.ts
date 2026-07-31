import { describe, it, expect } from "vitest";
import { growPlant } from "../src/growth/sim";
import { layoutBloom } from "../src/growth/bloom";
import type {
  Inflorescence,
  Phenotype,
  Plant,
  StrokeSegment,
} from "../src/types";

const BASE: Phenotype = {
  vigour: 0.75,
  droop: 0.2,
  phototropism: 0.7,
  stiffness: 0.5,
  branchiness: 0.35,
  baseWidth: 9,
  taper: 0.978,
  branchAngle: 0.5,
  branchWidthRatio: 0.7,
  doubled: false,
  petalShape: "round",
  petalCount: 5,
  inflorescence: "solitary",
  hueClass: 2,
  white: false,
  bloomRadius: 16,
  viable: true,
};

const ORIGIN = { x: 200, y: 380 };
const grow = (p: Partial<Phenotype>, seed = 99): Plant =>
  growPlant({ ...BASE, ...p }, seed, ORIGIN);

/** Mean over several seeds — one seed's plant is one draw, and shapes vary a lot. */
function meanOver(
  p: Partial<Phenotype>,
  f: (plant: Plant) => number,
  seeds = 12,
): number {
  let total = 0;
  for (let s = 0; s < seeds; s++) total += f(grow(p, 1000 + s * 37));
  return total / seeds;
}

const segLength = (s: StrokeSegment): number =>
  Math.hypot(s.x1 - s.x0, s.y1 - s.y0);

/**
 * Pedicels are the single-segment chains — a flower stalk is emitted as its own chain with
 * exactly one segment, where a shoot accumulates many. Measuring them directly is the only
 * way to test the difference between a raceme and a spike, which is ENTIRELY stalk length.
 */
function pedicelLengths(plant: Plant): number[] {
  const byChain = new Map<number, StrokeSegment[]>();
  for (const s of plant.segments) {
    const list = byChain.get(s.chain);
    if (list) list.push(s);
    else byChain.set(s.chain, [s]);
  }
  return [...byChain.values()]
    .filter((c) => c.length === 1)
    .map((c) => segLength(c[0]!));
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

describe("inflorescence architecture changes the SILHOUETTE", () => {
  it("gives every clustered form more flowers than a solitary one", () => {
    // The reason the trait exists. Hue and petal shape are invisible once a plant is a
    // thumbnail in the background forest; how many flowers it carries and where they sit is
    // not, and it is the first thing a person reads about a plant.
    const solitary = meanOver(
      { inflorescence: "solitary" },
      (p) => p.blooms.length,
    );
    for (const arch of ["raceme", "spike", "umbel"] as const) {
      const n = meanOver({ inflorescence: arch }, (p) => p.blooms.length);
      expect(n, arch).toBeGreaterThan(solitary * 2.5);
    }
  });

  it("CONTROL: solitary is unchanged — one flower per shoot tip", () => {
    // Pins that the comparison above discriminates. If the lateral-flower path had leaked
    // into the solitary case, every ratio above would still have been satisfied while the
    // architectures became indistinguishable from each other.
    const plant = grow({ inflorescence: "solitary" });
    expect(pedicelLengths(plant).length).toBe(0);
    // Every flower sits at the end of a shoot, so no two share a position.
    const spots = new Set(
      plant.blooms.map(
        (b) => `${b.center.x.toFixed(1)},${b.center.y.toFixed(1)}`,
      ),
    );
    expect(spots.size).toBe(plant.blooms.length);
  });

  it("puts an umbel's flowers around ONE point, and a raceme's up the stem", () => {
    // The measurement that separates the two many-flowered forms. An umbel is a plate: its
    // florets share an origin, so they sit at nearly the same height. A raceme is a column:
    // its flowers are distributed along the shoot, so they do not.
    //
    // Vertical spread is normalised against the plant's own height, because a vigorous plant
    // spreads everything further and an un-normalised comparison would be measuring vigour.
    const spread = (plant: Plant): number => {
      const ys = plant.blooms.map((b) => b.center.y);
      const stem = plant.segments.map((s) => s.y0);
      const height = Math.max(...stem) - Math.min(...stem);
      if (ys.length < 2 || height <= 0) return 0;
      const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
      return (
        Math.sqrt(ys.reduce((a, y) => a + (y - mean) ** 2, 0) / ys.length) /
        height
      );
    };
    const umbel = meanOver({ inflorescence: "umbel" }, spread);
    const raceme = meanOver({ inflorescence: "raceme" }, spread);
    expect(raceme).toBeGreaterThan(umbel * 1.4);
  });

  it("separates a raceme from a spike by stalk length alone", () => {
    // Foxglove and plantain have the same arrangement and look nothing alike, and the whole
    // difference is whether the flowers stand off the stem. Normalised by bloom radius,
    // because the two architectures carry different-sized flowers and the raw lengths would
    // partly be measuring that instead.
    const ratio = (arch: Inflorescence, r: number): number =>
      meanOver({ inflorescence: arch }, (p) => median(pedicelLengths(p))) / r;
    const racemeR = ratio("raceme", BASE.bloomRadius);
    const spikeR = ratio("spike", BASE.bloomRadius);
    expect(spikeR).toBeLessThan(0.45);
    expect(racemeR).toBeGreaterThan(0.8);
  });

  it("ripens a raceme from the bottom up", () => {
    // A raceme's signature is open flowers below and buds at the tip, because the bottom
    // flower is the oldest. Bloom radius scales with how far a flower has opened, so a
    // correctly-ripening raceme has larger flowers lower down.
    //
    // Screen coordinates: y grows DOWNWARD, so "lower on the plant" is larger y.
    const lowerAreBigger = (plant: Plant): number => {
      const bs = plant.blooms;
      if (bs.length < 6) return 0;
      const sorted = [...bs].sort((a, b) => a.center.y - b.center.y);
      const top = sorted.slice(0, Math.floor(sorted.length / 3));
      const bottom = sorted.slice(-Math.floor(sorted.length / 3));
      const avg = (xs: typeof bs) =>
        xs.reduce((a, b) => a + b.radius, 0) / xs.length;
      return avg(bottom) - avg(top);
    };
    expect(
      meanOver({ inflorescence: "raceme" }, lowerAreBigger),
    ).toBeGreaterThan(0.6);
  });

  it("CONTROL: an umbel opens all at once, so it has no such gradient", () => {
    // Without this, an implementation that made every architecture ripen bottom-up would pass
    // the raceme test and lose the one thing that makes an umbel read as an umbel.
    const gradient = (plant: Plant): number => {
      const bs = plant.blooms;
      if (bs.length < 6) return 0;
      const sorted = [...bs].sort((a, b) => a.center.y - b.center.y);
      const third = Math.floor(sorted.length / 3);
      const avg = (xs: typeof bs) =>
        xs.reduce((a, b) => a + b.radius, 0) / xs.length;
      return Math.abs(avg(sorted.slice(-third)) - avg(sorted.slice(0, third)));
    };
    const umbel = meanOver({ inflorescence: "umbel" }, gradient);
    const raceme = meanOver({ inflorescence: "raceme" }, gradient);
    expect(umbel).toBeLessThan(raceme * 0.6);
  });

  it("caps flower count on the extreme genotype the player is breeding toward", () => {
    // Maximum branchiness carrying a raceme on every shoot multiplies two genes together.
    // Each bloom is up to 48 petal paths redrawn every frame while the plant animates in, so
    // an uncapped extreme does not look impressive — it drops the frame rate.
    const plant = grow(
      {
        inflorescence: "raceme",
        branchiness: 1,
        vigour: 1,
        doubled: true,
        petalCount: 12,
      },
      7,
    );
    expect(plant.blooms.length).toBeLessThanOrEqual(200);
  });
});

describe("petal count is a real allele series, not a dial", () => {
  const bloomOf = (p: Partial<Phenotype>) =>
    layoutBloom(
      { ...BASE, ...p },
      { x: 0, y: 0 },
      -Math.PI / 2,
      () => 0.5,
      1,
      0,
    );

  it("puts exactly as many petals in a single flower as the genotype says", () => {
    for (const petalCount of [5, 6, 8, 12])
      expect(bloomOf({ petalCount }).petals.length).toBe(petalCount);
  });

  it("adds four per whorl across three whorls when doubled", () => {
    for (const petalCount of [5, 6, 8, 12])
      expect(bloomOf({ petalCount, doubled: true }).petals.length).toBe(
        (petalCount + 4) * 3,
      );
  });

  it("REGRESSION: the tuned five-petal double is still exactly 27 petals", () => {
    // The generalisation had to reproduce the number it was generalising from. A refactor that
    // moved this is a regression whatever else it improved (§20).
    expect(bloomOf({ petalCount: 5, doubled: true }).petals.length).toBe(27);
  });

  it("keeps petals from fusing into a disc as the count rises", () => {
    // A constant width factor is the obvious implementation and it breaks at high merosity:
    // the petals grow wider than their own angular slot and the flower becomes a plain
    // circle. What has to stay constant is the FRACTION of its slot a petal fills.
    for (const petalCount of [5, 6, 8, 12]) {
      const b = bloomOf({ petalCount });
      const slot = Math.PI / petalCount; // half-angle available to one petal
      for (const p of b.petals) {
        const fill = Math.atan(p.width / 2 / p.length) / slot;
        expect(fill, `${petalCount} petals`).toBeGreaterThan(0.35);
        expect(fill, `${petalCount} petals`).toBeLessThan(0.8);
      }
    }
  });

  it("CONTROL: the old constant width factor WOULD have fused a twelve-petal flower", () => {
    // Pins that the assertion above discriminates, using the value that actually shipped.
    const radius = 16;
    const fill = Math.atan((0.66 * radius) / 2 / radius) / (Math.PI / 12);
    expect(fill).toBeGreaterThan(1);
  });
});

describe("an albino seedling", () => {
  const albino = grow({ viable: false });

  it("germinates and dies — no flowers, no leaves", () => {
    expect(albino.albino).toBe(true);
    expect(albino.blooms).toHaveLength(0);
    expect(albino.leaves).toHaveLength(0);
  });

  it("still exists as a plant in the bed", () => {
    // The design point: the failure is visible and occupies its plot. A seed that silently did
    // nothing would cost the player a turn with no explanation and nothing to reason from.
    expect(albino.segments.length).toBeGreaterThan(4);
  });

  it("never reaches the height of a living plant", () => {
    const top = (p: Plant) => Math.min(...p.segments.map((s) => s.y1));
    expect(ORIGIN.y - top(albino)).toBeLessThan(30);
    expect(ORIGIN.y - top(grow({ viable: true }))).toBeGreaterThan(80);
  });

  it("CONTROL: the identical genotype made viable grows a normal plant", () => {
    // The albino path keys on ONE field. Without this control, a growPlant that returned an
    // empty stub for every plant would satisfy all three assertions above.
    const living = grow({ viable: true });
    expect(living.albino).toBe(false);
    expect(living.blooms.length).toBeGreaterThan(0);
    expect(living.leaves.length).toBeGreaterThan(0);
  });
});
