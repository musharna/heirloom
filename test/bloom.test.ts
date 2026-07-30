import { describe, it, expect } from "vitest";
import { layoutBloom } from "../src/growth/bloom";
import { mulberry32 } from "../src/rng";
import type { Phenotype } from "../src/types";

const SINGLE: Phenotype = {
  vigour: 0.5,
  droop: 0,
  phototropism: 0.5,
  stiffness: 0.3,
  branchiness: 0,
  baseWidth: 6,
  taper: 0.985,
  branchAngle: 0.5,
  branchWidthRatio: 0.62,
  doubled: false,
  petalShape: "round",
  hueClass: 2,
  white: false,
  bloomRadius: 14,
};
const DOUBLE: Phenotype = { ...SINGLE, doubled: true };
const c = { x: 0, y: 0 };

describe("layoutBloom", () => {
  it("gives a single 5 petals in 1 whorl, with stamens", () => {
    const b = layoutBloom(SINGLE, c, 0, mulberry32(1));
    expect(b.petals).toHaveLength(5);
    expect(b.stamens).toBe(true);
  });

  it("gives a double many more petals and no stamens (ABC C-function)", () => {
    const b = layoutBloom(DOUBLE, c, 0, mulberry32(1));
    expect(b.petals.length).toBeGreaterThan(20);
    expect(b.stamens).toBe(false);
  });

  it("spaces petals evenly WITHIN a whorl", () => {
    // Golden-angle spacing inside a small whorl leaves uneven gaps and the bloom renders
    // as a pointed star. Even spacing is the corrected model; this test pins it.
    const b = layoutBloom(SINGLE, c, 0, mulberry32(1));
    const spacing = (Math.PI * 2) / 5;
    for (let i = 1; i < b.petals.length; i++) {
      expect(b.petals[i]!.angle - b.petals[i - 1]!.angle).toBeCloseTo(
        spacing,
        5,
      );
    }
  });

  it("offsets successive whorls by the golden angle so they interleave", () => {
    const b = layoutBloom(DOUBLE, c, 0, mulberry32(1));
    const golden = Math.PI * (3 - Math.sqrt(5));
    const perWhorl = b.petals.length / 3;
    const firstOfWhorl = (w: number) => b.petals[w * perWhorl]!.angle;
    expect(firstOfWhorl(1) - firstOfWhorl(0)).toBeCloseTo(golden, 5);
    expect(firstOfWhorl(2) - firstOfWhorl(1)).toBeCloseTo(golden, 5);
  });

  it("makes petals broad enough to touch their neighbours", () => {
    // Narrow petals leave visible gaps and read as star points rather than a flower.
    const b = layoutBloom(SINGLE, c, 0, mulberry32(1));
    const p = b.petals[0]!;
    // Chord subtended by the petal must reach the neighbour's spacing at mid-length.
    const spacing = (Math.PI * 2) / 5;
    const neighbourGap = 2 * (p.length / 2) * Math.sin(spacing / 2);
    expect(p.width).toBeGreaterThanOrEqual(neighbourGap * 0.9);
  });

  it("makes inner whorls smaller and darker", () => {
    const b = layoutBloom(DOUBLE, c, 0, mulberry32(1));
    const outer = b.petals[0]!;
    const inner = b.petals[b.petals.length - 1]!;
    expect(inner.width).toBeLessThan(outer.width);
    expect(inner.colorDepth).toBeGreaterThan(outer.colorDepth);
  });

  it("keeps colorDepth finite for a single whorl", () => {
    // Guards a division-by-zero when whorls === 1.
    for (const p of layoutBloom(SINGLE, c, 0, mulberry32(1)).petals) {
      expect(Number.isFinite(p.colorDepth)).toBe(true);
    }
  });

  it("is deterministic for a given rand stream", () => {
    const a = layoutBloom(DOUBLE, c, 0, mulberry32(9));
    const b = layoutBloom(DOUBLE, c, 0, mulberry32(9));
    expect(a).toEqual(b);
  });

  it("carries the pigment-block flag through untouched", () => {
    const b = layoutBloom({ ...SINGLE, white: true }, c, 0, mulberry32(1));
    expect(b.white).toBe(true);
  });
});
