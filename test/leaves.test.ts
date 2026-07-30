import { describe, it, expect } from "vitest";
import { leafPath, leafMidrib } from "../src/render/leaves";
import { growPlant } from "../src/growth/sim";
import type { LeafSpec, Phenotype } from "../src/types";

const spec: LeafSpec = {
  attach: { x: 0, y: 0 },
  angle: 0,
  length: 20,
  width: 10,
};

const P: Phenotype = {
  vigour: 0.55,
  droop: 0.15,
  phototropism: 0.55,
  stiffness: 0.35,
  branchiness: 0.55,
  baseWidth: 10,
  taper: 0.978,
  branchAngle: 0.5,
  branchWidthRatio: 0.72,
  doubled: false,
  petalShape: "round",
  hueClass: 0,
  white: false,
  bloomRadius: 22,
};

describe("leafPath", () => {
  it("is a closed blade anchored at the attachment point", () => {
    const pts = leafPath(spec);
    expect(pts.length).toBeGreaterThan(60);
    expect(Math.hypot(pts[0]!.x, pts[0]!.y)).toBeLessThan(1);
    for (const p of pts)
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });

  it("is widest partway along, not at its base or its tip", () => {
    const pts = leafPath(spec);
    const halfAt = (frac: number) => {
      const target = frac * spec.length;
      const near = pts.filter((p) => Math.abs(p.x - target) < 0.6);
      return near.length ? Math.max(...near.map((p) => Math.abs(p.y))) : 0;
    };
    const mid = halfAt(0.45);
    expect(mid).toBeGreaterThan(halfAt(0.05));
    expect(mid).toBeGreaterThan(halfAt(0.97));
  });

  it("samples densely enough that the serrate margin is not stair-stepped", () => {
    // Undersampling a periodic margin is what made the lobed petal read as a jigsaw
    // piece, so the blade outline needs many more samples than serration periods.
    const pts = leafPath(spec);
    expect(pts.length / 9).toBeGreaterThan(8);
  });

  it("rotates with the angle", () => {
    const a = leafPath(spec);
    const b = leafPath({ ...spec, angle: Math.PI / 2 });
    expect(a).not.toEqual(b);
  });
});

describe("leafMidrib", () => {
  it("runs from the attachment toward the tip", () => {
    const [a, b] = leafMidrib(spec);
    expect(a).toEqual(spec.attach);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(spec.length * 0.88, 4);
  });
});

describe("growPlant leaves", () => {
  it("produces foliage — the axis that branching expresses itself through", () => {
    const p = growPlant(P, 20260729, { x: 0, y: 0 });
    expect(p.leaves.length).toBeGreaterThan(2);
  });

  it("alternates leaves to both sides of the shoot", () => {
    const p = growPlant(P, 20260729, { x: 0, y: 0 });
    // With strict alternation, consecutive leaves on one shoot must not all lie on the
    // same side; compare each leaf's angle against the others.
    const angles = p.leaves.map((l) => l.angle);
    expect(
      new Set(angles.map((a) => Math.sign(Math.cos(a)))).size,
    ).toBeGreaterThan(1);
  });

  it("is deterministic", () => {
    const a = growPlant(P, 7, { x: 0, y: 0 });
    const b = growPlant(P, 7, { x: 0, y: 0 });
    expect(a.leaves).toEqual(b.leaves);
  });

  it("gives a bushier plant more foliage than a sparse one", () => {
    const sparse = growPlant({ ...P, branchiness: 0 }, 20260729, {
      x: 0,
      y: 0,
    });
    const bushy = growPlant({ ...P, branchiness: 1 }, 20260729, { x: 0, y: 0 });
    expect(bushy.leaves.length).toBeGreaterThan(sparse.leaves.length);
  });
});
