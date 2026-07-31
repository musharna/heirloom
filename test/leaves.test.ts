import { describe, it, expect } from "vitest";
import { leafPath, leafMidrib, leafVeins } from "../src/render/leaves";
import { growPlant } from "../src/growth/sim";
import type { LeafSpec, Phenotype } from "../src/types";

const spec: LeafSpec = {
  attach: { x: 0, y: 0 },
  angle: 0,
  length: 20,
  width: 10,
  tick: 0,
  seed: 0.5,
  side: 1,
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
  petalCount: 5,
  inflorescence: "solitary",
  viable: true,
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
    const rib = leafMidrib(spec);
    expect(rib[0]).toEqual(spec.attach);
    const tip = rib.at(-1)!;
    expect(Math.hypot(tip.x - rib[0]!.x, tip.y - rib[0]!.y)).toBeGreaterThan(
      spec.length * 0.8,
    );
  });

  it("follows the blade's curve rather than cutting a straight chord", () => {
    // A straight two-point rib visibly leaves a curved blade near the tip, which reads as a
    // crack across the surface rather than as a vein.
    const rib = leafMidrib({ ...spec, seed: 1 });
    const a = rib[0]!;
    const b = rib.at(-1)!;
    const mid = rib[Math.floor(rib.length / 2)]!;
    // Distance of the midpoint from the straight chord a->b.
    const off =
      Math.abs(
        (b.y - a.y) * mid.x - (b.x - a.x) * mid.y + b.x * a.y - b.y * a.x,
      ) / Math.hypot(b.x - a.x, b.y - a.y);
    expect(off).toBeGreaterThan(0.5);
  });

  it("stays INSIDE the blade it belongs to", () => {
    // The property the curve is serving. A rib that wanders outside the outline is worse
    // than no rib at all, and a straight one on a strongly curled leaf does exactly that.
    for (const seed of [0, 0.35, 0.7, 1]) {
      const s = { ...spec, seed };
      const outline = leafPath(s, 128);
      for (const p of leafMidrib(s).slice(1)) {
        expect(pointInPolygon(p, outline)).toBe(true);
      }
    }
  });
});

function pointInPolygon(
  p: { x: number; y: number },
  poly: { x: number; y: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

describe("leaf variation", () => {
  it("gives two leaves with different seeds different outlines", () => {
    // Length and angle alone left every blade the same shape at a different size, which at
    // magnification reads as one stamp repeated rather than as foliage.
    const a = leafPath({ ...spec, seed: 0.1 });
    const b = leafPath({ ...spec, seed: 0.9 });
    let differing = 0;
    for (let i = 0; i < a.length; i++)
      if (Math.hypot(a[i]!.x - b[i]!.x, a[i]!.y - b[i]!.y) > 0.4) differing++;
    expect(differing / a.length).toBeGreaterThan(0.5);
  });

  it("curls away from the shoot it grew on", () => {
    const left = leafMidrib({ ...spec, side: 1, seed: 1 });
    const right = leafMidrib({ ...spec, side: -1, seed: 1 });
    const mid = Math.floor(left.length / 2);
    expect(Math.sign(left[mid]!.y)).toBe(-Math.sign(right[mid]!.y));
  });
});

describe("leafVeins", () => {
  it("angles veins FORWARD toward the tip, not perpendicular", () => {
    // Perpendicular veins read as a ladder, which is worse than no veins at all.
    for (const [a, b] of leafVeins(spec)) {
      expect(b.x).toBeGreaterThan(a.x); // spec.angle is 0, so +x is toward the tip
    }
  });

  it("keeps veins inside the blade", () => {
    const outline = leafPath(spec, 128);
    for (const [, b] of leafVeins(spec))
      expect(pointInPolygon(b, outline)).toBe(true);
  });

  it("produces veins in symmetric pairs", () => {
    expect(leafVeins(spec).length % 2).toBe(0);
    expect(leafVeins(spec).length).toBeGreaterThan(4);
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
