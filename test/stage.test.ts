import { describe, it, expect } from "vitest";
import {
  visibleSegments,
  PALETTE,
  plantBounds,
  fitPlant,
} from "../src/render/stage";
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

describe("silhouette rim colours", () => {
  // Three consecutive critic rounds failed the art direction on "no visible linework".
  // The contours were rendering the whole time; they were DARK on a near-black ground and
  // therefore invisible. This pins the corrected rule: a rim that separates a silhouette
  // from the ground must be LIGHTER than the ground.
  const lum = (css: string): number => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css);
    if (m) return (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3;
    const hex = css.replace("#", "");
    return (
      [0, 2, 4]
        .map((i) => parseInt(hex.slice(i, i + 2), 16))
        .reduce((a, b) => a + b) / 3
    );
  };

  it("keeps every silhouette rim lighter than the ground", () => {
    const ground = lum(PALETTE.ground);
    for (const rim of [PALETTE.stemRim, PALETTE.leafRim, PALETTE.petalRim]) {
      expect(lum(rim)).toBeGreaterThan(ground + 60);
    }
  });

  it("still allows a DARK line for petal-on-petal divisions", () => {
    // Those sit on a lit petal, not on the ground, so dark is correct there.
    expect(lum(PALETTE.petalDivide)).toBeLessThan(lum(PALETTE.ground) + 60);
  });
});

describe("plantBounds", () => {
  it("includes each bloom's full radius, not just its centre", () => {
    const plant = growPlant(P, 4, { x: 0, y: 0 });
    const b = plantBounds(plant);
    const bloom = plant.blooms[0]!;
    expect(b.minX).toBeLessThanOrEqual(bloom.center.x - bloom.radius);
    expect(b.maxY).toBeGreaterThanOrEqual(bloom.center.y - bloom.radius);
  });
});

describe("fitPlant", () => {
  it("shrinks an oversized plant so its whole extent lands inside the viewport", () => {
    // The defect this guards: a vigorous plant grew past the canvas and took its bloom
    // off-screen, leaving a bare stem with no flower.
    const big = growPlant({ ...P, vigour: 1 }, 3, { x: 0, y: 0 });
    const W = 300;
    const H = 340;
    const pad = 14;
    const f = fitPlant(big, W, H, pad);
    const b = plantBounds(big);
    for (const [x, y] of [
      [b.minX, b.minY],
      [b.maxX, b.maxY],
    ] as const) {
      const sx = x * f.scale + f.dx;
      const sy = y * f.scale + f.dy;
      expect(sx).toBeGreaterThanOrEqual(pad - 1e-6);
      expect(sx).toBeLessThanOrEqual(W - pad + 1e-6);
      expect(sy).toBeGreaterThanOrEqual(-1e-6);
      expect(sy).toBeLessThanOrEqual(H - pad + 1e-6);
    }
  });

  it("never magnifies, so a compact plant stays smaller than a vigorous one", () => {
    const small = growPlant({ ...P, vigour: 0.15, branchiness: 0 }, 3, {
      x: 0,
      y: 0,
    });
    expect(fitPlant(small, 3000, 3000).scale).toBe(1);
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
