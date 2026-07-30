import { describe, it, expect } from "vitest";
import { mulberry32 } from "../src/rng";
import { express, hueDosage, isDoubled, isWhite } from "../src/genome/express";
import {
  inherit,
  randomGenome,
  type Genome,
  type PolyBlock,
} from "../src/genome/genome";
import { P_ALLELES } from "../src/genome/loci";

const poly = (a: number, b: number): PolyBlock => ({ a, b });

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

describe("epistasis — the pigment block", () => {
  it("masks every hue combination, and coloured × coloured still throws colour", () => {
    // The headline mechanic of §5, with the POSITIVE CONTROL the spec makes mandatory in the
    // same test. Without it, an express() that returned white unconditionally would satisfy
    // every masking assertion below and read as "masking works".
    const hues: Array<[Genome["H1"], Genome["H2"]]> = [
      [
        ["h1", "h1"],
        ["h2", "h2"],
      ],
      [
        ["H1", "h1"],
        ["h2", "h2"],
      ],
      [
        ["H1", "H1"],
        ["h2", "h2"],
      ],
      [
        ["H1", "H1"],
        ["H2", "h2"],
      ],
      [
        ["H1", "H1"],
        ["H2", "H2"],
      ],
    ];

    for (const [H1, H2] of hues) {
      // Masked: any W_ genotype reads white whatever the hue loci carry...
      for (const W of [
        ["W", "W"],
        ["W", "w"],
        ["w", "W"],
      ] as Genome["W"][]) {
        expect(isWhite({ ...BASE, W, H1, H2 })).toBe(true);
      }
      // ...and the hue is still THERE, unexpressed. This is what makes the reveal possible.
      const carrier: Genome = { ...BASE, W: ["W", "w"], H1, H2 };
      expect(hueDosage(carrier)).toBe(hueDosage({ ...carrier, W: ["w", "w"] }));

      // POSITIVE CONTROL: permit/permit is coloured at every one of those hue genotypes.
      expect(isWhite({ ...BASE, W: ["w", "w"], H1, H2 })).toBe(false);
    }
  });

  it("throws colour from white × white when both parents carry the permit allele", () => {
    // Ww × Ww: a quarter of children are ww and show a hue neither parent displayed.
    const rand = mulberry32(2026);
    const motherWhite: Genome = { ...BASE, W: ["W", "w"], H1: ["H1", "H1"] };
    const fatherWhite: Genome = { ...BASE, W: ["W", "w"], H2: ["H2", "H2"] };
    expect(isWhite(motherWhite)).toBe(true);
    expect(isWhite(fatherWhite)).toBe(true);

    let coloured = 0;
    const hueClasses = new Set<number>();
    const N = 1000;
    for (let i = 0; i < N; i++) {
      const child = inherit(motherWhite, fatherWhite, rand);
      if (!isWhite(child)) {
        coloured++;
        hueClasses.add(hueDosage(child));
      }
    }
    expect(coloured / N).toBeGreaterThan(0.2);
    expect(coloured / N).toBeLessThan(0.3);
    // And the colour that appears is a BLEND of the two hidden hues — the surprise is not
    // just "a colour", it is a colour neither parent could have shown.
    expect(hueClasses.has(2)).toBe(true);
  });
});

describe("dominance", () => {
  it("makes doubling recessive: only dd doubles", () => {
    expect(isDoubled({ ...BASE, D: ["D", "D"] })).toBe(false);
    expect(isDoubled({ ...BASE, D: ["D", "d"] })).toBe(false);
    expect(isDoubled({ ...BASE, D: ["d", "D"] })).toBe(false);
    expect(isDoubled({ ...BASE, D: ["d", "d"] })).toBe(true);
  });

  it("resolves the P series by rank, in both allele orders", () => {
    const shape = (p: Genome["P"]) => express({ ...BASE, P: p }).petalShape;
    expect(shape(["P^f", "p"])).toBe("frilled");
    expect(shape(["p", "P^f"])).toBe("frilled");
    expect(shape(["P^l", "P^p"])).toBe("lobed");
    expect(shape(["P^p", "P^l"])).toBe("lobed");
    expect(shape(["P^p", "p"])).toBe("pointed");
    expect(shape(["p", "p"])).toBe("round");
  });

  it("gives every P allele a reachable homozygous shape", () => {
    const shapes = new Set(P_ALLELES.map((a) => shapeOf(a)));
    expect(shapes.size).toBe(4);
    function shapeOf(a: Genome["P"][0]) {
      return express({ ...BASE, P: [a, a] }).petalShape;
    }
  });
});

describe("hue dosage", () => {
  it("counts the two loci additively into five classes", () => {
    const cases: Array<[Genome["H1"], Genome["H2"], number]> = [
      [["h1", "h1"], ["h2", "h2"], 0],
      [["H1", "h1"], ["h2", "h2"], 1],
      [["h1", "h1"], ["H2", "h2"], 1],
      [["H1", "h1"], ["H2", "h2"], 2],
      [["H1", "H1"], ["h2", "h2"], 2],
      [["H1", "H1"], ["H2", "h2"], 3],
      [["H1", "H1"], ["H2", "H2"], 4],
    ];
    for (const [H1, H2, want] of cases)
      expect(hueDosage({ ...BASE, H1, H2 })).toBe(want);
  });

  it("reaches all five classes from random genomes", () => {
    const rand = mulberry32(44);
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) seen.add(hueDosage(randomGenome(rand)));
    expect(seen.size).toBe(5);
  });
});

describe("express", () => {
  it("is pure — the same genome gives the same phenotype", () => {
    const g = randomGenome(mulberry32(101));
    expect(express(g)).toEqual(express(g));
  });

  it("moves habit monotonically with polygenic dosage", () => {
    const full = (block: keyof Genome) =>
      ({ ...BASE, [block]: poly(0x3f, 0x3f) }) as Genome;
    expect(express(full("V")).vigour).toBeGreaterThan(express(BASE).vigour);
    expect(express(full("G")).droop).toBeGreaterThan(express(BASE).droop);
    expect(express(full("B")).branchiness).toBeGreaterThan(
      express(BASE).branchiness,
    );
  });

  it("couples a weeping habit to a slack stem and a weaker light-seek", () => {
    // The derivations are botanical couplings, not filler. If they ever drift into
    // independent constants this test is the thing that notices.
    const upright = express(BASE);
    const weeping = express({ ...BASE, G: poly(0x3f, 0x3f) });
    expect(weeping.stiffness).toBeLessThan(upright.stiffness);
    expect(weeping.phototropism).toBeLessThan(upright.phototropism);
  });

  it("gives a bushy plant more, smaller flowers on narrower side shoots", () => {
    const sparse = express(BASE);
    const bushy = express({ ...BASE, B: poly(0x3f, 0x3f) });
    expect(bushy.bloomRadius).toBeLessThan(sparse.bloomRadius);
    expect(bushy.branchWidthRatio).toBeLessThan(sparse.branchWidthRatio);
    expect(bushy.branchAngle).toBeGreaterThan(sparse.branchAngle);
  });

  it("keeps every field inside the range the growth engine was tuned against", () => {
    // Milestone 1 tuned the tropisms against hand-written phenotypes. An expressed genome
    // that lands outside those ranges is untested territory, so pin the envelope.
    const rand = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const p = express(randomGenome(rand));
      for (const k of [
        "vigour",
        "droop",
        "phototropism",
        "stiffness",
        "branchiness",
      ] as const) {
        expect(p[k]).toBeGreaterThanOrEqual(0);
        expect(p[k]).toBeLessThanOrEqual(1);
      }
      expect(p.taper).toBeGreaterThan(0.96);
      expect(p.taper).toBeLessThan(1); // >= 1 would never terminate a shoot
      expect(p.baseWidth).toBeGreaterThan(5);
      expect(p.baseWidth).toBeLessThan(14);
      expect(p.bloomRadius).toBeGreaterThan(12);
      expect(p.bloomRadius).toBeLessThan(30);
      expect(p.branchWidthRatio).toBeGreaterThan(0.5);
      expect(p.branchWidthRatio).toBeLessThan(1);
    }
  });
});
