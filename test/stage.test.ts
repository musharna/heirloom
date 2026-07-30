import { describe, it, expect } from "vitest";
import { visibleSegments, PALETTE } from "../src/render/stage";
import { growPlant } from "../src/growth/sim";
import type { Phenotype } from "../src/types";

const P: Phenotype = {
  vigour: 0.5,
  droop: 0.2,
  phototropism: 0.5,
  stiffness: 0.3,
  branchiness: 0.4,
  baseWidth: 6,
  taper: 0.985,
  branchAngle: 0.5,
  branchWidthRatio: 0.62,
  doubled: false,
  petalShape: "round",
  hueClass: 0,
  white: false,
  bloomRadius: 14,
};

describe("visibleSegments", () => {
  it("reveals the plant monotonically as the tick advances", () => {
    const plant = growPlant(P, 4, { x: 0, y: 0 });
    const early = visibleSegments(plant, 5).length;
    const mid = visibleSegments(plant, 20).length;
    const all = visibleSegments(plant, 10_000).length;
    expect(early).toBeLessThan(mid);
    expect(mid).toBeLessThanOrEqual(all);
    expect(all).toBe(plant.segments.length);
  });

  it("shows nothing before growth starts", () => {
    const plant = growPlant(P, 4, { x: 0, y: 0 });
    expect(visibleSegments(plant, -1)).toHaveLength(0);
  });
});

describe("PALETTE", () => {
  it("commits to a dark ground, per the fixed art direction", () => {
    const hex = PALETTE.ground.replace("#", "");
    const lum =
      [0, 2, 4]
        .map((i) => parseInt(hex.slice(i, i + 2), 16))
        .reduce((a, b) => a + b) / 3;
    expect(lum).toBeLessThan(48);
  });
});
