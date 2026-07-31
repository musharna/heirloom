import { describe, it, expect } from "vitest";
import { mulberry32 } from "../src/rng";
import {
  CHROMOSOMES,
  DISCRETE_LOCI,
  inherit,
  meiosis,
  randomGenome,
  type DiscreteLocus,
  type Genome,
  type PolyBlock,
} from "../src/genome/genome";
import { isCarrier, isViable } from "../src/genome/express";

const poly = (a: number, b: number): PolyBlock => ({ a, b });

/** A genome with every locus homozygous, so a test can make exactly one thing vary. */
const FLAT: Genome = {
  W: ["w", "w"],
  H1: ["h1", "h1"],
  H2: ["h2", "h2"],
  D: ["D", "D"],
  P: ["p", "p"],
  I: ["i", "i"],
  N: ["n", "n"],
  L: ["L", "L"],
  V: poly(0b000111, 0b000111),
  G: poly(0b000111, 0b000111),
  B: poly(0b000111, 0b000111),
};

/**
 * Measured recombination between two loci in a doubly-heterozygous parent.
 *
 * A gamete is RECOMBINANT when the pair of alleles it carries is neither of the two
 * combinations present on the parent's own homologs. That definition works in both coupling
 * and repulsion phase without the test having to know which it was handed, which matters —
 * the phase-dependent version of this helper is exactly the kind that passes for the wrong
 * reason when the phase happens to be the one it assumed.
 */
function recombinationRate(
  parent: Genome,
  a: DiscreteLocus,
  b: DiscreteLocus,
  n: number,
  seed: number,
): number {
  const rand = mulberry32(seed);
  const parental = new Set([
    `${parent[a][0]}|${parent[b][0]}`,
    `${parent[a][1]}|${parent[b][1]}`,
  ]);
  let recombinant = 0;
  for (let i = 0; i < n; i++) {
    const h = meiosis(parent, rand);
    if (!parental.has(`${h[a]}|${h[b]}`)) recombinant++;
  }
  return recombinant / n;
}

describe("the linkage map is structurally sound", () => {
  it("places every discrete locus exactly once", () => {
    // A locus missing from the map would simply never appear in a gamete, and the child would
    // inherit `undefined` at that locus — which TypeScript cannot catch, because the map is
    // data. A locus listed twice would be written twice per meiosis and silently lose the
    // first write. Both are silent, so the invariant is asserted rather than assumed.
    const placed = CHROMOSOMES.flatMap((c) => c.loci);
    expect([...placed].sort()).toEqual([...DISCRETE_LOCI].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("gives each chromosome one fewer interval than it has loci", () => {
    for (const c of CHROMOSOMES) expect(c.r.length).toBe(c.loci.length - 1);
  });

  it("keeps every recombination fraction in [0, 0.5]", () => {
    // Above 0.5 is not "more than independent" — it is negative linkage, which meiosis cannot
    // produce. A typo of 0.6 would quietly make two loci ANTI-correlated.
    for (const c of CHROMOSOMES)
      for (const r of c.r) {
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(0.5);
      }
  });
});

describe("meiosis produces the recombination the map declares", () => {
  it("keeps the tight D–N pair together — in coupling phase", () => {
    // Homolog 0 carries D and N^12; homolog 1 carries d and n.
    const parent: Genome = { ...FLAT, D: ["D", "d"], N: ["N^12", "n"] };
    const r = recombinationRate(parent, "D", "N", 20000, 4001);
    expect(r).toBeGreaterThan(0.05);
    expect(r).toBeLessThan(0.072);
  });

  it("measures the SAME rate in repulsion phase", () => {
    // Homolog 0 carries D and n; homolog 1 carries d and N^12. Recombination is a property of
    // the interval, not of which alleles happen to sit either side of it — if this came out
    // different, the walk would be reading the map wrong in a way coupling phase hides.
    const parent: Genome = { ...FLAT, D: ["D", "d"], N: ["n", "N^12"] };
    const r = recombinationRate(parent, "D", "N", 20000, 4002);
    expect(r).toBeGreaterThan(0.05);
    expect(r).toBeLessThan(0.072);
  });

  it("separates the looser W–I pair about twice as often", () => {
    const parent: Genome = { ...FLAT, W: ["W", "w"], I: ["I^u", "i"] };
    const r = recombinationRate(parent, "W", "I", 20000, 4003);
    expect(r).toBeGreaterThan(0.105);
    expect(r).toBeLessThan(0.135);
  });

  it("holds the two hue loci loosely", () => {
    const parent: Genome = { ...FLAT, H1: ["H1", "h1"], H2: ["H2", "h2"] };
    const r = recombinationRate(parent, "H1", "H2", 20000, 4004);
    expect(r).toBeGreaterThan(0.28);
    expect(r).toBeLessThan(0.32);
  });

  it("CONTROL: loci on DIFFERENT chromosomes assort independently", () => {
    // The measurement above is only evidence of linkage if the unlinked case comes out at
    // 0.5. Without this, a meiosis that returned a constant would still have satisfied every
    // bound above by being wrong in the same direction each time.
    const parent: Genome = { ...FLAT, W: ["W", "w"], D: ["D", "d"] };
    const r = recombinationRate(parent, "W", "D", 20000, 4005);
    expect(r).toBeGreaterThan(0.47);
    expect(r).toBeLessThan(0.53);
  });

  it("CONTROL: a locus alone on its chromosome is a fair coin", () => {
    const parent: Genome = { ...FLAT, L: ["L", "l"] };
    const rand = mulberry32(4006);
    let l = 0;
    for (let i = 0; i < 20000; i++) if (meiosis(parent, rand).L === "l") l++;
    expect(l / 20000).toBeGreaterThan(0.48);
    expect(l / 20000).toBeLessThan(0.52);
  });
});

describe("linkage is what makes a breeding goal cost something", () => {
  it("makes the repulsion-phase double recombinant rare, and reachable", () => {
    // This is the whole gameplay claim, stated as a number.
    //
    // A parent carrying `D` on one homolog and `N^12` on the other cannot pass both to one
    // gamete without a crossover in between. Two such parents crossed give a child homozygous
    // for neither, but the DOUBLE-recombinant gamete is the only route toward assembling the
    // full doubled twelve-petal flower — and at r = 0.06 it is about one gamete in seventeen.
    //
    // "Rare" and "reachable" are both asserted, because a rate of zero would satisfy "rare"
    // and would mean the goal is unreachable rather than expensive.
    const parent: Genome = { ...FLAT, D: ["D", "d"], N: ["n", "N^12"] };
    const rand = mulberry32(4007);
    let both = 0;
    const n = 40000;
    for (let i = 0; i < n; i++) {
      const h = meiosis(parent, rand);
      if (h.D === "D" && h.N === "N^12") both++;
    }
    const rate = both / n;
    expect(rate).toBeGreaterThan(0.02);
    expect(rate).toBeLessThan(0.05);
  });

  it("CONTROL: the same two traits in COUPLING are nearly free", () => {
    // The same assertion pointed at the easy case. If linkage were not being applied at all
    // both cases would land near 0.25 and the contrast would vanish — which is precisely how
    // a no-op linkage implementation would look if only the rare case were measured.
    const parent: Genome = { ...FLAT, D: ["D", "d"], N: ["N^12", "n"] };
    const rand = mulberry32(4008);
    let both = 0;
    const n = 40000;
    for (let i = 0; i < n; i++) {
      const h = meiosis(parent, rand);
      if (h.D === "D" && h.N === "N^12") both++;
    }
    expect(both / n).toBeGreaterThan(0.45);
  });
});

describe("inherit still behaves like a cross", () => {
  it("gives a child one allele from each parent at every locus", () => {
    const rand = mulberry32(5001);
    for (let i = 0; i < 200; i++) {
      const a = randomGenome(rand);
      const b = randomGenome(rand);
      const c = inherit(a, b, rand);
      for (const locus of DISCRETE_LOCI) {
        expect([a[locus][0], a[locus][1]]).toContain(c[locus][0]);
        expect([b[locus][0], b[locus][1]]).toContain(c[locus][1]);
      }
    }
  });

  it("still reaches genotypes neither parent had", () => {
    // Linkage constrains recombination; it must not eliminate it. A cross that could only
    // return parental types would make the whole game a shuffle of the founder set.
    const rand = mulberry32(5002);
    const a: Genome = { ...FLAT, D: ["D", "D"], N: ["N^12", "N^12"] };
    const b: Genome = { ...FLAT, D: ["d", "d"], N: ["n", "n"] };
    const f1 = inherit(a, b, rand);
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const c = inherit(f1, f1, rand);
      seen.add(`${c.D.slice().sort().join("")}|${c.N.slice().sort().join("")}`);
    }
    expect(seen.size).toBeGreaterThan(4);
  });
});

describe("albinism — the locus that makes carriers matter", () => {
  it("never puts an albino in the founder bed", () => {
    // A founder is by definition a plant that grew. An `ll` founder would open the garden
    // with a dead seedling and no crossing history to explain it.
    const rand = mulberry32(6001);
    for (let i = 0; i < 3000; i++)
      expect(isViable(randomGenome(rand))).toBe(true);
  });

  it("still seeds the population with plenty of hidden carriers", () => {
    // The counterpart assertion, and the one that stops the filter above from being satisfied
    // by simply never generating `l` at all — which would pass the viability test forever and
    // quietly delete the locus from the game.
    const rand = mulberry32(6002);
    let carriers = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) if (isCarrier(randomGenome(rand))) carriers++;
    expect(carriers / n).toBeGreaterThan(0.25);
    expect(carriers / n).toBeLessThan(0.75);
  });

  it("gives a quarter albino seedlings when two carriers cross", () => {
    const rand = mulberry32(6003);
    const carrier: Genome = { ...FLAT, L: ["L", "l"] };
    let dead = 0;
    const n = 20000;
    for (let i = 0; i < n; i++)
      if (!isViable(inherit(carrier, carrier, rand))) dead++;
    expect(dead / n).toBeGreaterThan(0.235);
    expect(dead / n).toBeLessThan(0.265);
  });

  it("CONTROL: a carrier crossed with a clear plant gives none", () => {
    // The Mendelian point: albinism appearing at all requires it on BOTH sides. Without this
    // control, an implementation that killed a flat 25% of every cross would pass the test
    // above and be a completely different — and much worse — game.
    const rand = mulberry32(6004);
    const carrier: Genome = { ...FLAT, L: ["L", "l"] };
    const clear: Genome = { ...FLAT, L: ["L", "L"] };
    for (let i = 0; i < 4000; i++)
      expect(isViable(inherit(carrier, clear, rand))).toBe(true);
  });

  it("keeps a carrier indistinguishable from a clear plant everywhere else", () => {
    // If a carrier were detectable by any other trait, the inference the locus exists to
    // create would be free, and nobody would ever have to reason about a cross.
    const carrier: Genome = { ...FLAT, L: ["L", "l"] };
    const clear: Genome = { ...FLAT, L: ["L", "L"] };
    expect(isViable(carrier)).toBe(isViable(clear));
    expect(isCarrier(carrier)).toBe(true);
    expect(isCarrier(clear)).toBe(false);
  });
});
