import { describe, it, expect } from "vitest";
import { growPlant } from "../src/growth/sim";
import { layoutBloom } from "../src/growth/bloom";
import { cullOccludedBlooms } from "../src/render/stage";
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
  leafScale: 16,
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
function pedicels(plant: Plant): StrokeSegment[] {
  const byChain = new Map<number, StrokeSegment[]>();
  for (const s of plant.segments) {
    const list = byChain.get(s.chain);
    if (list) list.push(s);
    else byChain.set(s.chain, [s]);
  }
  return [...byChain.values()].filter((c) => c.length === 1).map((c) => c[0]!);
}

function pedicelLengths(plant: Plant): number[] {
  return pedicels(plant).map(segLength);
}

/**
 * Flowers borne on the SIDE of a shoot, as opposed to at its tip.
 *
 * A lateral sits at the far end of a pedicel; a raceme's terminal flower sits directly on the
 * growing point with no stalk. Separating them matters more than it looks: a terminal is
 * always a bud and always at the top of the plant, so any statistic taken over all blooms
 * quietly inherits that fact and can report a gradient the laterals do not actually have.
 */
function lateralBlooms(plant: Plant): Plant["blooms"] {
  const ends = pedicels(plant);
  return plant.blooms.filter((b) =>
    ends.some((s) => Math.hypot(s.x1 - b.center.x, s.y1 - b.center.y) < 0.001),
  );
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/**
 * Sizes of each umbel head, found by grouping pedicels that share an origin.
 *
 * Every ray of one head starts at the same terminal point, so the multiset of group sizes IS
 * the list of heads and how many florets each carries.
 */
function headSizes(plant: Plant): number[] {
  const at = new Map<string, number>();
  for (const s of pedicels(plant)) {
    const k = `${s.x0.toFixed(2)},${s.y0.toFixed(2)}`;
    at.set(k, (at.get(k) ?? 0) + 1);
  }
  return [...at.values()];
}

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

  it("ripens a raceme from the bottom up — among the LATERAL flowers", () => {
    // A raceme's signature is open flowers below and tight buds above, because the bottom
    // flower is the oldest. Bloom radius scales with openness, so a correctly-ripening raceme
    // has larger flowers lower down. Screen coordinates: y grows DOWNWARD, so lower = larger y.
    //
    // Restricted to laterals, and that restriction is the whole point. The first version of
    // this test measured every bloom on the plant and PASSED with the ripeness gradient
    // deleted — because a raceme's terminal flower is always a bud and always sits at the top,
    // which produces a top-to-bottom size difference all on its own. It was measuring "the tip
    // is a bud", a property one line away from the one it claimed to check. Found by mutation,
    // not by reading it again.
    const lowerAreBigger = (plant: Plant): number => {
      const bs = lateralBlooms(plant);
      if (bs.length < 6) return 0;
      const sorted = [...bs].sort((a, b) => a.center.y - b.center.y);
      const third = Math.floor(sorted.length / 3);
      const avg = (xs: typeof bs) =>
        xs.reduce((a, b) => a + b.radius, 0) / xs.length;
      return avg(sorted.slice(-third)) - avg(sorted.slice(0, third));
    };
    // Low branchiness: on a heavily branched plant a side shoot's young flowers can hang below
    // the main stem's old ones, which scrambles height as a proxy for age. That is real and
    // correct behaviour, so the test sidesteps the confound rather than the code doing so.
    expect(
      meanOver({ inflorescence: "raceme", branchiness: 0.08 }, lowerAreBigger),
    ).toBeGreaterThan(1.2);
  });

  it("CONTROL: the lateral/terminal split is real, not an empty set", () => {
    // The measurement above returns 0 — and asserts nothing — if `lateralBlooms` comes back
    // near-empty, which is exactly what a broken matcher would do. Both groups have to be
    // non-empty for the restriction to carry any weight.
    const plant = grow({ inflorescence: "raceme", branchiness: 0.08 });
    const lateral = lateralBlooms(plant);
    expect(lateral.length).toBeGreaterThan(5);
    expect(plant.blooms.length).toBeGreaterThan(lateral.length);
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

describe("density — the difference between many flowers and a texture", () => {
  it("puts a full head on a main axis and a REDUCED one on a side twig", () => {
    // With a full plate on all thirty terminals a bushy umbel read as coral, not as thirty
    // flower heads: past a certain density small florets stop being countable and become a
    // texture, and the plant loses the architecture the locus exists to express.
    //
    // Reduced, not absent. Gating the head off gave side twigs a solitary flower each, which
    // scattered the plant's flowers back across its whole height and measurably undid the
    // "all at one point" signature — the spread test above caught that attempt.
    const bushy = grow({ inflorescence: "umbel", branchiness: 1 }, 4242);
    const sizes = headSizes(bushy);
    expect(sizes.length).toBeGreaterThan(4);
    expect(sizes.some((n) => n === 3)).toBe(true); // reduced, on side axes
    expect(sizes.some((n) => n >= 5)).toBe(true); // full, on the main axis
  });

  it("CONTROL: an unbranched plant carries only FULL heads", () => {
    // Pins that the rule keys on axis order rather than shrinking every head. Without it, an
    // implementation that reduced all heads to three rays would satisfy the test above and
    // quietly delete the full umbel from the game.
    const sparse = grow({ inflorescence: "umbel", branchiness: 0 }, 4242);
    expect(headSizes(sparse).every((n) => n >= 5)).toBe(true);
  });
});

describe("foliage belongs to the plant, not to the flower head", () => {
  const leafSize = (p: Partial<Phenotype>): number =>
    meanOver(p, (plant) =>
      plant.leaves.length
        ? plant.leaves.reduce((a, l) => a + l.length, 0) / plant.leaves.length
        : 0,
    );

  it("keeps leaf size independent of how big the FLOWERS are", () => {
    // Leaves were sized off bloomRadius, so the cluster size trade shrank every clustered
    // plant's foliage by up to 40% as a side effect. With five times the flower mass on top,
    // those plants read as a blob on a stick — the defect §19 had already fixed once,
    // reintroduced from a direction nothing was watching.
    const small = leafSize({ bloomRadius: 9 });
    const large = leafSize({ bloomRadius: 24 });
    expect(Math.abs(small - large)).toBeLessThan(0.01);
  });

  it("CONTROL: leaf size DOES follow leafScale", () => {
    // Otherwise the assertion above is satisfied by leaves of a fixed size, which would be a
    // different bug with the same test result.
    expect(leafSize({ leafScale: 24 })).toBeGreaterThan(
      leafSize({ leafScale: 9 }) * 1.5,
    );
  });

  it("gives a clustered plant the same foliage as a solitary one", () => {
    // The property as the player sees it, stated end-to-end rather than through the field
    // that implements it.
    const solitary = leafSize({ inflorescence: "solitary", bloomRadius: 16 });
    const umbel = leafSize({ inflorescence: "umbel", bloomRadius: 16 * 0.58 });
    expect(umbel).toBeGreaterThan(solitary * 0.95);
  });
});

describe("the flowers that are grown are the flowers that get DRAWN", () => {
  // Nothing else in this file could see this. Every test above measures what `growPlant`
  // returns, but the renderer drops any bloom sitting closer to another than 0.62 of a radius
  // — and an umbel's florets are supposed to touch. A third of every umbel was being grown
  // and then silently discarded before it reached the screen: the architecture whose entire
  // identity is clustering was the one the anti-clustering rule ate.
  //
  // The fix was geometric (wider rays), not a weakened cull, because solitary flowers still
  // need the cull. These tests pin the outcome so a later tweak to either side cannot quietly
  // undo it.
  const keptFraction = (p: Partial<Phenotype>, seeds = 20): number => {
    let grown = 0;
    let shown = 0;
    for (let s = 0; s < seeds; s++) {
      const plant = grow(p, 2000 + s * 13);
      grown += plant.blooms.length;
      shown += cullOccludedBlooms(plant.blooms).length;
    }
    return grown === 0 ? 0 : shown / grown;
  };

  it("keeps almost every floret of a single umbel", () => {
    // Branchiness zero isolates ONE flower head, so whatever culling remains is between
    // florets of the same umbel — the defect — rather than between two heads that overlap,
    // which is legitimate occlusion and must keep working.
    const kept = keptFraction({
      inflorescence: "umbel",
      branchiness: 0,
      bloomRadius: BASE.bloomRadius * 0.58,
    });
    expect(kept).toBeGreaterThan(0.85);
  });

  it("CONTROL: two overlapping heads DO still occlude each other", () => {
    // The counterpart. If the cull had simply been switched off, the assertion above would
    // read 100% and this one would too — so the test that matters is that a crowded canopy
    // still loses flowers.
    const crowded = keptFraction({
      inflorescence: "umbel",
      branchiness: 0.8,
      bloomRadius: BASE.bloomRadius * 0.58,
    });
    expect(crowded).toBeLessThan(0.85);
  });

  it("shows a usable number of flowers for every architecture", () => {
    // The property the player actually experiences. Stated separately from the ratios above
    // because a plant could keep 100% of two flowers and satisfy every one of them.
    for (const arch of ["raceme", "spike", "umbel"] as const) {
      const trade = { raceme: 0.72, spike: 0.66, umbel: 0.58 }[arch];
      const plant = grow({
        inflorescence: arch,
        bloomRadius: BASE.bloomRadius * trade,
      });
      const shown = cullOccludedBlooms(plant.blooms).length;
      expect(shown, arch).toBeGreaterThan(
        cullOccludedBlooms(grow({ inflorescence: "solitary" }).blooms).length *
          2,
      );
    }
  });
});

describe("no architecture packs its flowers tighter than the others", () => {
  /** Mean distance from each drawn flower to its nearest neighbour, in flower DIAMETERS. */
  const separation = (p: Partial<Phenotype>, trade: number): number => {
    let total = 0;
    let n = 0;
    for (let s = 0; s < 12; s++) {
      const plant = grow({ ...p, bloomRadius: BASE.bloomRadius * trade }, 500 + s * 17);
      const shown = cullOccludedBlooms(plant.blooms);
      for (const a of shown) {
        let best = Infinity;
        for (const b of shown)
          if (b !== a)
            best = Math.min(
              best,
              Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y),
            );
        if (best < Infinity) {
          total += best / (a.radius * 2);
          n++;
        }
      }
    }
    return n ? total / n : 0;
  };

  it("RETRACTION: the spike is not the dense outlier it was called", () => {
    // Recorded because the claim was made, carried in a backlog, and offered as work twice
    // before anyone measured it. A spike was said to read as "a dense mass rather than
    // countable flowers". Measured, its flowers sit FURTHER apart than an umbel's and the
    // difference from a raceme is small — and an umbel reads perfectly well.
    //
    // What was actually being described is that a spike is a dense column, which is what a
    // spike is: lupin, veronica and plantain all look like this. Preference, not defect.
    //
    // The test remains as a real guard: if any architecture ever DOES pack tighter than the
    // others, that is worth knowing, and this is the number that would say so.
    const sep = {
      raceme: separation({ inflorescence: "raceme" }, 0.72),
      spike: separation({ inflorescence: "spike" }, 0.66),
      umbel: separation({ inflorescence: "umbel" }, 0.58),
    };
    expect(sep.spike).toBeGreaterThan(sep.umbel);
    expect(sep.spike).toBeGreaterThan(sep.raceme * 0.8);
    // ...and none of them overlap so far that flowers stop being distinguishable at all.
    for (const [name, v] of Object.entries(sep))
      expect(v, name).toBeGreaterThan(0.35);
  });

  it("keeps a spike's flowers CLOSER to its stem than a raceme's", () => {
    // The property that actually distinguishes the two, and the one worth defending: a spike's
    // flowers are sessile. If this ever inverted, the two architectures would be the same
    // plant with different flower counts.
    const band = (arch: "raceme" | "spike", trade: number) =>
      meanOver({ inflorescence: arch, bloomRadius: BASE.bloomRadius * trade }, (p) =>
        median(pedicelLengths(p)),
      );
    expect(band("spike", 0.66)).toBeLessThan(band("raceme", 0.72) * 0.5);
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

  it("REGRESSION: a BUD keeps the clasped petal it was tuned with", () => {
    // The angular-packing rule does not apply to buds, and applying it anyway was a real
    // regression that shipped: a bud has three petals whatever the genotype, and three petals
    // sharing a circle solve to a width 1.31x their own length — a petal wider than it is
    // long. On a twelve-petal plant the fat blobs sat beside narrow open stars and the plant
    // read as two species on one stem. A bud's petals are CLASPED, so they are meant to
    // overlap and their width is not set by how many must fit around a circle.
    //
    // Caught by looking at the lookdev sheet. Nothing in this file was measuring buds.
    for (const petalCount of [5, 6, 8, 12]) {
      const bud = layoutBloom(
        { ...BASE, petalCount },
        { x: 0, y: 0 },
        -Math.PI / 2,
        () => 0.5,
        0.4, // below the 0.55 bud threshold
        0,
      );
      expect(bud.petals.length, `${petalCount} petals`).toBe(3);
      for (const p of bud.petals)
        expect(p.width / p.length, `${petalCount} petals`).toBeLessThan(0.8);
    }
  });

  it("CONTROL: an OPEN flower still gets the packing rule", () => {
    // Pins that the exemption above is scoped to buds. Restoring the constant for every
    // flower would satisfy the test above and undo the twelve-petal fix entirely.
    const open = bloomOf({ petalCount: 12 });
    expect(open.petals.length).toBe(12);
    expect(open.petals[0]!.width / open.petals[0]!.length).toBeLessThan(0.4);
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

  it("germinates and dies — it never flowers", () => {
    expect(albino.albino).toBe(true);
    expect(albino.blooms).toHaveLength(0);
  });

  it("carries a single opposed pair of cotyledons and nothing more", () => {
    // The first version had no leaves at all, and in the lookdev sheet it was a cream speck —
    // not obviously a plant, let alone a failed one. Two seed-leaves make it read immediately
    // as something that came up and stopped.
    //
    // Exactly two, not "at least two": a seedling that kept producing leaves as it rose would
    // be a small healthy plant, which is the opposite of the message.
    expect(albino.leaves).toHaveLength(2);
    expect(albino.leaves[0]!.side).toBe(-albino.leaves[1]!.side);
  });

  it("still exists as a plant in the bed", () => {
    // The design point: the failure is visible and occupies its plot. A seed that silently did
    // nothing would cost the player a turn with no explanation and nothing to reason from.
    expect(albino.segments.length).toBeGreaterThan(4);
  });

  it("is unmistakably shorter than a living plant", () => {
    // Both bounds matter. Too short and it is a speck; as tall as a living plant and the
    // player cannot tell a failure from a slow starter.
    const height = (p: Plant) =>
      ORIGIN.y - Math.min(...p.segments.map((s) => s.y1));
    const dead = height(albino);
    const living = height(grow({ viable: true }));
    expect(dead).toBeGreaterThan(35);
    expect(dead).toBeLessThan(living * 0.45);
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
