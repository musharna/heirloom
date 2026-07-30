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

  it("wires blooms to the real layout, not an empty stub", () => {
    // sim.ts briefly carried a stub layoutBloom that returned petals: []. Every other
    // assertion in this file passes against that stub, so this is the one that would
    // catch a forgotten stub replacement.
    const p = growPlant(BASE, 7, at());
    expect(p.blooms[0]!.petals.length).toBeGreaterThan(0);
    for (const b of p.blooms) expect(b.petals.length).toBeGreaterThan(0);
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

  it("makes even a max-droop plant RISE from its base before it arches over", () => {
    // The defect: full gravitropism from tick 0 turned the shoot down at its own base, so
    // the plant grew downward out of mid-air and its thickest end ended up at the top of
    // the frame. A weeping plant must still ascend first.
    const origin = at();
    const weeping = growPlant(
      { ...BASE, droop: 1, phototropism: 0.15, branchiness: 0 },
      11,
      origin,
    );
    const highest = Math.min(...weeping.segments.map((s) => s.y1));
    // "Higher on screen than where it started", by a clear margin, not a rounding error.
    expect(highest).toBeLessThan(origin.y - 20);
  });

  it("stops a shoot at ground level instead of growing underground", () => {
    // A max-droop shoot used to curve past horizontal and hang far below its own base,
    // which framed as a plant dangling off the bottom of its plot.
    const origin = { x: 0, y: 0 };
    const weeping = growPlant(
      { ...BASE, droop: 1, phototropism: 0.1 },
      11,
      origin,
    );
    const deepest = Math.max(
      ...weeping.segments.map((s) => Math.max(s.y0, s.y1)),
    );
    // One step's overshoot past ground is fine; a long underground descent is not.
    expect(deepest).toBeLessThan(origin.y + 12);
  });

  it("separates a mid-branchiness plant from a max-branchiness one on the SAME seed", () => {
    // Branch probability used to span only 0.044..0.08 per tick, so with one shared RNG
    // stream a "bushy" phenotype produced a plant identical to its baseline.
    const mid = growPlant({ ...BASE, branchiness: 0.55 }, 20260729, at());
    const max = growPlant({ ...BASE, branchiness: 1.0 }, 20260729, at());
    const chains = (p: typeof mid) =>
      new Set(p.segments.map((s) => s.chain)).size;
    expect(chains(max)).toBeGreaterThan(chains(mid));
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
