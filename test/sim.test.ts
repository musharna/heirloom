import { describe, it, expect } from "vitest";
import { growPlant } from "../src/growth/sim";
import type { Phenotype } from "../src/types";

const BASE: Phenotype = {
  vigour: 0.5,
  droop: 0.0,
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
const at = (): { x: number; y: number } => ({ x: 0, y: 0 });

describe("growPlant", () => {
  it("is deterministic: same phenotype and seed give an identical segment list", () => {
    const a = growPlant(BASE, 42, at());
    const b = growPlant(BASE, 42, at());
    expect(a.segments).toEqual(b.segments);
    expect(a.blooms).toEqual(b.blooms);
  });

  it("varies with the seed", () => {
    const a = growPlant(BASE, 1, at());
    const b = growPlant(BASE, 2, at());
    expect(a.segments).not.toEqual(b.segments);
  });

  it("terminates and produces at least one bloom", () => {
    const p = growPlant(BASE, 7, at());
    expect(p.segments.length).toBeGreaterThan(10);
    expect(p.blooms.length).toBeGreaterThanOrEqual(1);
  });

  it("tapers monotonically along a chain", () => {
    const p = growPlant({ ...BASE, branchiness: 0 }, 3, at());
    const chain = p.segments.filter((s) => s.chain === 0);
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i]!.w0).toBeLessThanOrEqual(chain[i - 1]!.w0);
    }
  });

  it("grows upward when droop is zero and downward-biased when droop is high", () => {
    // Screen coords: smaller y is higher on screen.
    const upright = growPlant({ ...BASE, droop: 0, branchiness: 0 }, 11, at());
    const weeping = growPlant({ ...BASE, droop: 1, branchiness: 0 }, 11, at());
    const highest = (segs: typeof upright.segments) =>
      Math.min(...segs.map((s) => s.y1));
    expect(highest(upright.segments)).toBeLessThan(highest(weeping.segments));
  });

  it("makes more chains when branchier", () => {
    const sparse = growPlant({ ...BASE, branchiness: 0 }, 5, at());
    const bushy = growPlant({ ...BASE, branchiness: 1 }, 5, at());
    const chains = (segs: typeof sparse.segments) =>
      new Set(segs.map((s) => s.chain)).size;
    expect(chains(sparse.segments)).toBe(1);
    expect(chains(bushy.segments)).toBeGreaterThan(1);
  });

  it("stays bounded even at maximum branchiness", () => {
    const p = growPlant({ ...BASE, branchiness: 1, vigour: 1 }, 8, at());
    // MAX_TIPS bounds *concurrent* tips, not the total spawned across the run — dead tips
    // free slots — so assert the run cannot explode rather than counting chain ids.
    expect(p.segments.length).toBeLessThan(40_000);
    expect(p.blooms.length).toBeLessThan(2_000);
  });

  it("emits ticks in non-decreasing order", () => {
    const p = growPlant(BASE, 21, at());
    for (let i = 1; i < p.segments.length; i++) {
      expect(p.segments[i]!.tick).toBeGreaterThanOrEqual(
        p.segments[i - 1]!.tick,
      );
    }
  });
});
