import { describe, it, expect } from "vitest";
import {
  visibleSegments,
  PALETTE,
  plantBounds,
  fitPlant,
  cullOccludedBlooms,
} from "../src/render/stage";
import {
  petalLightness,
  petalRim,
  petalRimWidth,
} from "../src/render/petals";
import { growPlant } from "../src/growth/sim";
import type { Bloom, Phenotype } from "../src/types";

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
  leafScale: 14,
  petalCount: 5,
  inflorescence: "solitary",
  viable: true,
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

  it("keeps stem and leaf rims lighter than the ground they sit on", () => {
    // Those two always have the dark ground behind them, so light is always right.
    const ground = lum(PALETTE.ground);
    for (const rim of [PALETTE.stemRim, PALETTE.leafRim]) {
      expect(lum(rim)).toBeGreaterThan(ground + 60);
    }
  });

  it("picks the petal rim by CONTRAST with its fill, not by a fixed lightness", () => {
    // The rule that replaced "always light". A fixed pale rim could not draw a pale
    // flower: on the white morph the fill is ~(229,227,220), so a light rim had no
    // contrast to give and the petals fused into a smear. Every fill must get a rim that
    // differs from it substantially, whichever direction that requires.
    //
    // Swept over ALL FIVE hue classes, not just the default. Lightness now varies per hue
    // (violet and blue sit lighter, because equal HSL saturation does not give equal
    // perceived intensity), so a single-hue sweep would leave four fills unchecked and any
    // future tone tweak could silently push one across the rim threshold.
    for (const white of [false, true]) {
      for (const hue of [0, 1, 2, 3, 4]) {
        for (const depth of [0, 0.5, 1]) {
          const fillL = (petalLightness(white, depth, hue) / 100) * 255;
          expect(
            Math.abs(lum(petalRim(white, depth, hue)) - fillL),
          ).toBeGreaterThan(55);
        }
      }
    }
  });

  it("scales the petal rim with the petal, and clamps at both ends", () => {
    // A fixed 1px rim is correct at exactly one petal size. On a doubled bloom's inner whorl
    // a petal is ~3px wide, and an outline down both margins claimed most of its area — those
    // flowers rendered as white filigree with a trace of colour.
    expect(petalRimWidth(30)).toBeGreaterThan(petalRimWidth(4));
    expect(petalRimWidth(3)).toBeGreaterThan(0); // never vanishes
    expect(petalRimWidth(3)).toBeLessThan(0.55); // never dominates a small petal
    expect(petalRimWidth(400)).toBeLessThanOrEqual(1.1); // never becomes a border
  });

  it("gives a pale fill a DARK rim and a mid fill a LIGHT one", () => {
    const paleRim = lum(petalRim(true, 1)); // white morph, inner whorl
    const midRim = lum(petalRim(false, 0)); // coloured morph, outer whorl
    expect(paleRim).toBeLessThan(midRim);
  });

  it("still allows a DARK line for petal-on-petal divisions", () => {
    // Those sit on a lit petal, not on the ground, so dark is correct there.
    expect(lum(PALETTE.petalDivide)).toBeLessThan(lum(PALETTE.ground) + 60);
  });
});

describe("cullOccludedBlooms", () => {
  const bloom = (x: number, y: number, radius = 20): Bloom => ({
    center: { x, y },
    radius,
    petals: [],
    sepals: [],
    hueClass: 0,
    white: false,
    stamens: true,
    tilt: 0,
    tick: 0,
  });

  it("drops a bloom buried inside another and keeps the first", () => {
    const kept = cullOccludedBlooms([bloom(0, 0), bloom(4, 0)]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.center.x).toBe(0);
  });

  it("keeps blooms that are merely adjacent", () => {
    expect(cullOccludedBlooms([bloom(0, 0), bloom(40, 0)])).toHaveLength(2);
  });

  it("collapses a dense chain to a few readable flowers", () => {
    // The bead-necklace defect: ~85 centres fused into 29 blobs across one canopy.
    const chain = Array.from({ length: 20 }, (_, i) => bloom(i * 3, 0));
    const kept = cullOccludedBlooms(chain);
    expect(kept.length).toBeLessThan(8);
    expect(kept.length).toBeGreaterThan(0);
  });

  it("is a no-op on an empty list", () => {
    expect(cullOccludedBlooms([])).toEqual([]);
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
