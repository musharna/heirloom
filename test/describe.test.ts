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
    // them hands a screen-reader player a genome a sighted player cannot see, which deletes the
    // carrier locus for exactly the users this feature exists to serve.
    //
    // Run over many genomes rather than one: `shortLabel` omits the form for a solitary plant
    // and the colour for an albino, so a single fixture can be trait-free by luck and prove
    // nothing about the gate.
    const many = mulberry32(11);
    for (let i = 0; i < 200; i++) {
      const p: Planting = {
        ...grow(randomGenome(many), 100, SOIL),
        plantedAt: 0,
      };
      const label = plotLabel(1, p, 0);
      for (const word of shortLabel(serialize(p.genome)).split(" ")) {
        expect(label).not.toContain(word);
      }
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

  it("says nothing about a plant that has not finished", () => {
    const p = planting();
    expect(grownLine(3, p, 0)).toBe("");
  });
});
