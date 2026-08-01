import { describe, it, expect } from "vitest";
import { fitPlant } from "../src/render/thumb";

describe("fitPlant", () => {
  it("fits a tall plant by its limiting dimension", () => {
    // 40 wide by 200 tall into 96x84 with no padding: height limits, 84/200 = 0.42.
    const f = fitPlant({ minX: -20, minY: -200, maxX: 20, maxY: 0 }, 96, 84, 0);
    expect(f.scale).toBeCloseTo(0.42);
  });

  it("fits a wide plant by its limiting dimension", () => {
    // The other way round, or a bug that always picked height would pass the test above.
    const f = fitPlant({ minX: 0, minY: 0, maxX: 200, maxY: 40 }, 96, 84, 0);
    expect(f.scale).toBeCloseTo(0.48);
  });

  it("centres what it fits", () => {
    // A 100x100 box into a 200x100 frame: scale 1, so 50px of slack either side horizontally
    // and none vertically.
    const f = fitPlant({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 200, 100, 0);
    expect(f.scale).toBeCloseTo(1);
    expect(f.dx).toBeCloseTo(50);
    expect(f.dy).toBeCloseTo(0);
  });

  it("offsets by the bounds' origin, not just by the slack", () => {
    // Plants are grown around y=0 at the soil line, so minY is NEGATIVE and a fit that ignored
    // it would push the whole plant off the top of the thumbnail.
    const f = fitPlant(
      { minX: -50, minY: -100, maxX: 50, maxY: 0 },
      100,
      100,
      0,
    );
    expect(f.dx).toBeCloseTo(50);
    expect(f.dy).toBeCloseTo(100);
  });

  it("never returns a zero or negative scale for a degenerate plant", () => {
    // `plantBounds` returns all zeroes for a plant with no geometry, and scaling a canvas
    // transform by 0 is rejected outright by some engines — the same failure `paintPlantCached`
    // already guards with its null-bounds fallback.
    const f = fitPlant({ minX: 0, minY: 0, maxX: 0, maxY: 0 }, 96, 84, 0);
    expect(f.scale).toBeGreaterThan(0);
    expect(Number.isFinite(f.scale)).toBe(true);
  });
});
