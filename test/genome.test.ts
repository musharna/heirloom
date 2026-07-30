import { describe, it, expect } from "vitest";
import { mulberry32 } from "../src/rng";
import {
  DISCRETE_LOCI,
  POLY_BLOCKS,
  dosage,
  genomesEqual,
  inherit,
  mutate,
  randomGenome,
  type Genome,
  type PolyBlock,
} from "../src/genome/genome";
import { MAX_DOSAGE } from "../src/genome/loci";

const poly = (a: number, b: number): PolyBlock => ({ a, b });

/** Homozygous recessive everywhere, all polygenic loci `−`. Tests vary one thing off this. */
const BASE: Genome = {
  W: ["w", "w"],
  H1: ["h1", "h1"],
  H2: ["h2", "h2"],
  D: ["D", "D"],
  P: ["p", "p"],
  V: poly(0, 0),
  G: poly(0, 0),
  B: poly(0, 0),
};

type InheritFn = (a: Genome, b: Genome, rand: () => number) => Genome;

/**
 * The segregation assertion, parameterized over an inheritance implementation so the same
 * assertion can be pointed at a deliberately broken one.
 *
 * Dd × Dd must give a quarter `dd`. 2000 crosses on a fixed seed: the binomial standard
 * error at p=0.25 is ~0.0097, so the ±0.04 window is ~4 SE — wide enough never to flake,
 * tight enough that the broken implementations below (which land at 0.0 and 0.5) fail it.
 */
function assertMonohybridRatio(fn: InheritFn): void {
  const rand = mulberry32(424242);
  const het: Genome = { ...BASE, D: ["D", "d"] };
  let dd = 0;
  const N = 2000;
  for (let i = 0; i < N; i++) {
    const child = fn(het, het, rand);
    if (child.D[0] === "d" && child.D[1] === "d") dd++;
  }
  expect(dd / N).toBeGreaterThan(0.21);
  expect(dd / N).toBeLessThan(0.29);
}

/** Broken: the child is a clone of parent A. Never produces a homozygote from a het cross. */
const cloneParentA: InheritFn = (a) => structuredClone(a);

/** Broken: takes allele 0 from A and allele 1 from B, with no random draw. */
const noSegregation: InheritFn = (a, b) => ({
  ...structuredClone(a),
  D: [a.D[0], b.D[1]],
});

describe("inherit — Mendelian segregation", () => {
  it("gives Dd × Dd a quarter dd", () => {
    assertMonohybridRatio(inherit);
  });

  // MANDATORY CONTROL (design §9). A test never seen failing is not evidence, and this one
  // is statistical, so "it passed" is especially weak on its own. These two pin that the
  // assertion actually discriminates: it must REJECT an inheritance that clones one parent,
  // and REJECT one that assigns alleles positionally instead of drawing them.
  //
  // They match the failure MESSAGE rather than using `.toThrow()`. A bare `.toThrow()` is
  // satisfied by any exception — a TypeError from a mis-shaped fixture would pass it while
  // proving nothing about whether the ratio assertion can tell good inheritance from bad.
  // Both broken implementations must fail specifically by producing ZERO homozygotes.
  const failureOf = (fn: InheritFn): string => {
    try {
      assertMonohybridRatio(fn);
      return "no failure — the assertion did not discriminate";
    } catch (e) {
      return (e as Error).message;
    }
  };

  it("CONTROL: the same assertion rejects an inherit that clones parent A", () => {
    expect(failureOf(cloneParentA)).toMatch(
      /expected 0 to be greater than 0\.21/,
    );
  });

  it("CONTROL: the same assertion rejects an inherit that does not segregate", () => {
    expect(failureOf(noSegregation)).toMatch(
      /expected 0 to be greater than 0\.21/,
    );
  });

  it("breeds true from homozygous parents", () => {
    const rand = mulberry32(9);
    const dd: Genome = { ...BASE, D: ["d", "d"] };
    for (let i = 0; i < 50; i++)
      expect(inherit(dd, dd, rand).D).toEqual(["d", "d"]);
  });

  it("assorts loci independently", () => {
    // dd frequency must not depend on what happened at P. If the two loci were linked (or
    // shared a draw), conditioning on P would shift it.
    const rand = mulberry32(77);
    const het: Genome = { ...BASE, D: ["D", "d"], P: ["P^f", "p"] };
    let frilled = 0;
    let ddGivenFrilled = 0;
    let dd = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const c = inherit(het, het, rand);
      const isDd = c.D[0] === "d" && c.D[1] === "d";
      const isFrilled = c.P.includes("P^f");
      if (isDd) dd++;
      if (isFrilled) {
        frilled++;
        if (isDd) ddGivenFrilled++;
      }
    }
    expect(Math.abs(ddGivenFrilled / frilled - dd / N)).toBeLessThan(0.04);
  });
});

describe("inherit — polygenic blocks", () => {
  /** Both homologs differ, so free recombination has 2^6 haplotypes to build from. */
  const mixed: Genome = { ...BASE, V: poly(0b101010, 0b010101) };

  it("recombines within a block instead of passing it whole", () => {
    const rand = mulberry32(5);
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const c = inherit(mixed, mixed, rand);
      seen.add(`${c.V.a}:${c.V.b}`);
    }
    // Haplotype-locked inheritance could produce at most 2 gametes per parent, so 4 children
    // — this is the assertion that would catch that shortcut.
    expect(seen.size).toBeGreaterThan(50);
  });

  it("CONTROL: that assertion rejects haplotype-locked inheritance", () => {
    const locked: InheritFn = (a, b, rand) => ({
      ...structuredClone(a),
      V: {
        a: rand() < 0.5 ? a.V.a : a.V.b,
        b: rand() < 0.5 ? b.V.a : b.V.b,
      },
    });
    const rand = mulberry32(5);
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const c = locked(mixed, mixed, rand);
      seen.add(`${c.V.a}:${c.V.b}`);
    }
    expect(seen.size).toBeLessThanOrEqual(4);
  });

  it("centres a het × het cross's dosage on the parental dosage", () => {
    const rand = mulberry32(31);
    let total = 0;
    const N = 1500;
    for (let i = 0; i < N; i++) total += dosage(inherit(mixed, mixed, rand).V);
    expect(total / N).toBeGreaterThan(MAX_DOSAGE / 2 - 0.5);
    expect(total / N).toBeLessThan(MAX_DOSAGE / 2 + 0.5);
  });

  it("spreads dosage rather than fixing it — that spread IS the drift", () => {
    const rand = mulberry32(32);
    const seen = new Set<number>();
    for (let i = 0; i < 600; i++)
      seen.add(dosage(inherit(mixed, mixed, rand).V));
    expect(seen.size).toBeGreaterThan(5);
  });
});

describe("mutate", () => {
  it("is the identity at rate 0", () => {
    const rand = mulberry32(1);
    const g = randomGenome(mulberry32(2));
    expect(genomesEqual(mutate(g, rand, { discrete: 0, poly: 0 }), g)).toBe(
      true,
    );
  });

  it("changes every allele at rate 1, never to itself", () => {
    const g: Genome = { ...BASE, P: ["p", "p"] };
    const m = mutate(g, mulberry32(3), { discrete: 1, poly: 1 });
    expect(m.W).toEqual(["W", "W"]);
    expect(m.D).toEqual(["d", "d"]);
    expect(m.P[0]).not.toBe("p");
    expect(m.P[1]).not.toBe("p");
    expect(dosage(m.V)).toBe(MAX_DOSAGE); // every `−` flipped to `+`
  });

  it("keeps a clone's VISIBLE traits at the default rate", () => {
    // The requirement is that a clone still looks like its parent — not that the genome is
    // bit-identical. Those come apart because a genome has 10 discrete allele copies but 36
    // polygenic bits: at any rate high enough to drift habit, near-every clone differs
    // SOMEWHERE, while the flower on screen is unchanged. An earlier version of this test
    // asserted bit-identity and failed at 0.425 — the assertion was measuring the wrong
    // thing, and that miscount is why `mutate` now takes two rates.
    const rand = mulberry32(11);
    const g = randomGenome(mulberry32(12));
    let sameLooking = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
      const m = mutate(g, rand);
      const visiblyEqual = DISCRETE_LOCI.every(
        (l) => m[l][0] === g[l][0] && m[l][1] === g[l][1],
      );
      if (visiblyEqual) sameLooking++;
    }
    expect(sameLooking / N).toBeGreaterThan(0.75);
    expect(sameLooking / N).toBeLessThan(0.99); // and surprises still happen
  });

  it("moves habit on most clones — that is what makes a lineage creep", () => {
    const rand = mulberry32(14);
    const g = randomGenome(mulberry32(15));
    let moved = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
      const m = mutate(g, rand);
      if (POLY_BLOCKS.some((l) => m[l].a !== g[l].a || m[l].b !== g[l].b))
        moved++;
    }
    expect(moved / N).toBeGreaterThan(0.4);
  });

  it("drifts a lineage over generations", () => {
    const rand = mulberry32(13);
    let g: Genome = { ...BASE, V: poly(0, 0) };
    for (let i = 0; i < 300; i++)
      g = mutate(g, rand, { discrete: 0.05, poly: 0.05 });
    expect(dosage(g.V)).toBeGreaterThan(0);
  });
});

describe("randomGenome", () => {
  it("is deterministic for a seed", () => {
    expect(
      genomesEqual(randomGenome(mulberry32(8)), randomGenome(mulberry32(8))),
    ).toBe(true);
  });

  it("reaches every allele of the P series", () => {
    const rand = mulberry32(19);
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const g = randomGenome(rand);
      seen.add(g.P[0]);
      seen.add(g.P[1]);
    }
    expect(seen.size).toBe(4);
  });
});
