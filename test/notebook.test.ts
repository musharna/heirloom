import { describe, it, expect } from "vitest";
import { mulberry32 } from "../src/rng";
import { serialize } from "../src/genome/serialize";
import { inherit, type Genome, type PolyBlock } from "../src/genome/genome";
import { isViable } from "../src/genome/express";
import {
  CROSS_CAP,
  carriedBy,
  describeCarried,
  describeTraits,
  emptyNotebook,
  offspringCount,
  recordCross,
  shortLabel,
  type Notebook,
} from "../src/game/notebook";

const poly = (a: number, b: number): PolyBlock => ({ a, b });

/** Homozygous everywhere, so a test can make exactly one locus interesting. */
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

const code = (g: Genome) => serialize(g);

let nextSeed = 1;
function observe(
  nb: Notebook,
  parents: [Genome, Genome],
  child: Genome,
): Notebook {
  return recordCross(nb, {
    seedId: nextSeed++,
    child: code(child),
    parents: [code(parents[0]), code(parents[1])],
  });
}

describe("the notebook refuses to read a genotype it has not earned", () => {
  it("says nothing about a carrier with no observed offspring", () => {
    // THE test for this module. A carrier is defined by being indistinguishable, and the
    // genome is right there in the argument — returning what it plainly says would be the
    // obvious implementation and would delete the most interesting locus in the game.
    const carrier: Genome = { ...FLAT, L: ["L", "l"] };
    expect(carriedBy(emptyNotebook(), code(carrier))).toEqual([]);
  });

  it("says nothing about a carrier whose offspring were all unremarkable", () => {
    // Stronger: evidence EXISTS, and it happens not to be informative. An implementation that
    // peeked at the genome whenever it had any crosses on file would pass the test above.
    const carrier: Genome = { ...FLAT, L: ["L", "l"] };
    const clear: Genome = { ...FLAT, L: ["L", "L"] };
    let nb = emptyNotebook();
    for (let i = 0; i < 6; i++) nb = observe(nb, [carrier, clear], clear);
    expect(carriedBy(nb, code(carrier))).toEqual([]);
  });

  it("says nothing about a plant that is not a parent in any cross", () => {
    const carrier: Genome = { ...FLAT, L: ["L", "l"] };
    const stranger: Genome = { ...FLAT, W: ["W", "w"] };
    const clear: Genome = { ...FLAT, L: ["L", "L"] };
    const albino: Genome = { ...FLAT, L: ["l", "l"] };
    const nb = observe(emptyNotebook(), [carrier, carrier], albino);
    expect(carriedBy(nb, code(stranger))).toEqual([]);
    expect(carriedBy(nb, code(clear))).toEqual([]);
  });
});

describe("an albino seedling convicts both its parents", () => {
  const carrier: Genome = { ...FLAT, L: ["L", "l"] };
  const albino: Genome = { ...FLAT, L: ["l", "l"] };

  it("deduces albinism in a parent that shows none", () => {
    // The payoff of the whole locus: `Ll` looks exactly like `LL` until it throws this.
    const nb = observe(emptyNotebook(), [carrier, carrier], albino);
    const carried = carriedBy(nb, code(carrier));
    expect(carried).toHaveLength(1);
    expect(carried[0]!.locus).toBe("L");
    expect(describeCarried(carried[0]!)).toMatch(/carries albinism/);
  });

  it("convicts BOTH parents from one seedling", () => {
    // An albino has two `l` alleles and got one from each side. It is evidence about the pair,
    // not about whichever parent the player suspected.
    const other: Genome = { ...FLAT, L: ["l", "L"], W: ["w", "w"] };
    const nb = observe(emptyNotebook(), [carrier, other], albino);
    expect(carriedBy(nb, code(carrier))[0]?.locus).toBe("L");
    expect(carriedBy(nb, code(other))[0]?.locus).toBe("L");
  });

  it("counts the evidence rather than just asserting the conclusion", () => {
    let nb = emptyNotebook();
    for (let i = 0; i < 3; i++) nb = observe(nb, [carrier, carrier], albino);
    expect(carriedBy(nb, code(carrier))[0]!.evidence).toBe(3);
    expect(describeCarried(carriedBy(nb, code(carrier))[0]!)).toMatch(
      /3 seedlings/,
    );
  });

  it("END TO END: a real self-cross of a real carrier produces the evidence", () => {
    // The rules above are exercised against hand-built genomes, which cannot catch a mismatch
    // between what `inherit` actually produces and what the deduction assumes. This runs the
    // real cross, keeps whatever comes out, and asserts the notebook reaches the conclusion a
    // player would.
    const rand = mulberry32(31337);
    let nb = emptyNotebook();
    let albinos = 0;
    for (let i = 0; i < 40; i++) {
      const child = inherit(carrier, carrier, rand);
      nb = observe(nb, [carrier, carrier], child);
      if (!isViable(child)) albinos++;
    }
    expect(albinos).toBeGreaterThan(4); // ~10 expected at 1 in 4
    const carried = carriedBy(nb, code(carrier));
    expect(carried.map((c) => c.locus)).toContain("L");
    expect(carried.find((c) => c.locus === "L")!.evidence).toBe(albinos);
  });
});

describe("the same rule covers every discrete locus", () => {
  it("finds colour hidden under white", () => {
    const white: Genome = { ...FLAT, W: ["W", "w"] };
    const coloured: Genome = { ...FLAT, W: ["w", "w"] };
    const nb = observe(emptyNotebook(), [white, coloured], coloured);
    expect(describeCarried(carriedBy(nb, code(white))[0]!)).toMatch(
      /colour beneath the white/,
    );
  });

  it("finds doubling hidden in a single flower", () => {
    const single: Genome = { ...FLAT, D: ["D", "d"] };
    const doubled: Genome = { ...FLAT, D: ["d", "d"] };
    const nb = observe(emptyNotebook(), [single, single], doubled);
    expect(describeCarried(carriedBy(nb, code(single))[0]!)).toMatch(
      /carries doubling/,
    );
  });

  it("claims only what an allele SERIES actually entails", () => {
    // From a frilled parent and a pointed child it follows that the parent carries pointed
    // OR ROUND — not which. Claiming the exact allele would be the tempting simplification
    // and it would be a guess presented as a deduction.
    const frilled: Genome = { ...FLAT, P: ["P^f", "P^p"] };
    const pointed: Genome = { ...FLAT, P: ["P^p", "P^p"] };
    const nb = observe(emptyNotebook(), [frilled, pointed], pointed);
    const carried = carriedBy(nb, code(frilled))[0]!;
    expect(carried.rank).toBe(2); // P^p
    expect(describeCarried(carried)).toMatch(/pointed petals or plainer/);
  });

  it("sharpens the claim when a more recessive child turns up", () => {
    const frilled: Genome = { ...FLAT, P: ["P^f", "p"] };
    const pointed: Genome = { ...FLAT, P: ["P^p", "P^p"] };
    const round: Genome = { ...FLAT, P: ["p", "p"] };
    let nb = observe(emptyNotebook(), [frilled, pointed], pointed);
    expect(carriedBy(nb, code(frilled))[0]!.rank).toBe(2);
    nb = observe(nb, [frilled, round], round);
    // Now known to carry `p` itself, which is strictly more informative.
    expect(carriedBy(nb, code(frilled))[0]!.rank).toBe(3);
    expect(carriedBy(nb, code(frilled))[0]!.evidence).toBe(1);
  });

  it("CONTROL: a child no more recessive than its parent proves nothing", () => {
    // The line that makes the whole thing sound. Without it every cross would "deduce" the
    // parent's own visible allele and the card would fill with noise.
    const frilled: Genome = { ...FLAT, P: ["P^f", "P^f"] };
    let nb = emptyNotebook();
    for (let i = 0; i < 5; i++) nb = observe(nb, [frilled, frilled], frilled);
    expect(carriedBy(nb, code(frilled))).toEqual([]);
  });
});

describe("recording", () => {
  it("counts a repeated cross of the same pair as new evidence", () => {
    const carrier: Genome = { ...FLAT, L: ["L", "l"] };
    const albino: Genome = { ...FLAT, L: ["l", "l"] };
    let nb = emptyNotebook();
    nb = observe(nb, [carrier, carrier], albino);
    nb = observe(nb, [carrier, carrier], albino);
    expect(nb.crosses).toHaveLength(2);
    expect(offspringCount(nb, code(carrier))).toBe(2);
  });

  it("refuses to count ONE seed twice", () => {
    // A reload restores plantings, and a re-layout re-grows them. Neither is a new
    // observation, and without this the evidence count would inflate every time the player
    // rotated their phone.
    const carrier: Genome = { ...FLAT, L: ["L", "l"] };
    const albino: Genome = { ...FLAT, L: ["l", "l"] };
    const one = {
      seedId: 7,
      child: code(albino),
      parents: [code(carrier), code(carrier)] as [string, string],
    };
    const nb = recordCross(recordCross(emptyNotebook(), one), one);
    expect(nb.crosses).toHaveLength(1);
    expect(carriedBy(nb, code(carrier))[0]!.evidence).toBe(1);
  });

  it("stays bounded", () => {
    let nb = emptyNotebook();
    for (let i = 0; i < CROSS_CAP + 50; i++)
      nb = recordCross(nb, {
        seedId: 10_000 + i,
        child: code(FLAT),
        parents: [code(FLAT), code(FLAT)],
      });
    expect(nb.crosses).toHaveLength(CROSS_CAP);
  });

  it("survives a corrupt code without throwing", () => {
    // Codes come out of localStorage, which the player can edit. §10: name the failure, never
    // crash on it — and here the sane behaviour is simply to have learned nothing.
    const nb = recordCross(emptyNotebook(), {
      seedId: 1,
      child: "!!!not a genome!!!",
      parents: ["also not", code(FLAT)],
    });
    expect(() => carriedBy(nb, code(FLAT))).not.toThrow();
    expect(carriedBy(nb, code(FLAT))).toEqual([]);
    expect(carriedBy(nb, "!!!not a genome!!!")).toEqual([]);
  });
});

describe("plain language", () => {
  it("describes what a plant is showing, without naming a gene", () => {
    const g: Genome = {
      ...FLAT,
      H1: ["H1", "H1"],
      H2: ["H2", "H2"],
      I: ["I^u", "I^u"],
      N: ["N^8", "N^8"],
    };
    const lines = describeTraits(code(g)).join(" | ");
    expect(lines).toMatch(/blue/);
    expect(lines).toMatch(/8 petals/);
    expect(lines).toMatch(/umbel/);
    // A gene symbol on the card would turn it into a debug overlay.
    expect(lines).not.toMatch(/[A-Z]\^|\bN\^|\bI\^|allele|locus/);
  });

  it("says an albino will not flower, rather than listing its flowers", () => {
    expect(describeTraits(code({ ...FLAT, L: ["l", "l"] }))[0]).toMatch(
      /albino/,
    );
  });

  it("names a parent in words a player could say out loud", () => {
    expect(
      shortLabel(
        code({
          ...FLAT,
          I: ["I^u", "I^u"],
          H1: ["H1", "H1"],
          H2: ["H2", "H2"],
        }),
      ),
    ).toBe("blue umbel");
    expect(shortLabel(code({ ...FLAT, W: ["W", "W"] }))).toBe("white");
    expect(shortLabel("garbage")).toMatch(/unknown/);
  });
});
