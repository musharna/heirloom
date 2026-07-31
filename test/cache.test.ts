import { describe, it, expect, afterEach } from "vitest";
import {
  cachedCount,
  paintPlantCached,
  setCanvasSource,
} from "../src/render/cache";
import { growPlant } from "../src/growth/sim";
import type { Phenotype, Plant } from "../src/types";

const P: Phenotype = {
  vigour: 0.7,
  droop: 0.2,
  phototropism: 0.6,
  stiffness: 0.4,
  branchiness: 0.3,
  baseWidth: 8,
  taper: 0.98,
  branchAngle: 0.5,
  branchWidthRatio: 0.7,
  doubled: false,
  petalShape: "round",
  petalCount: 5,
  inflorescence: "raceme",
  hueClass: 1,
  white: false,
  bloomRadius: 12,
  leafScale: 16,
  viable: true,
};

/** A canvas that records what was asked of it, and draws nothing. */
function stubCanvas(): HTMLCanvasElement {
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "createLinearGradient" || prop === "createRadialGradient")
          return () => ({ addColorStop: () => undefined });
        return () => undefined;
      },
      set: () => true,
    },
  );
  return {
    width: 0,
    height: 0,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
}

/** A destination context that counts blits and path fills. */
function destination(): {
  ctx: CanvasRenderingContext2D;
  counts: { drawImage: number; fill: number };
} {
  const counts = { drawImage: 0, fill: 0 };
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "drawImage")
          return () => {
            counts.drawImage++;
          };
        if (prop === "fill")
          return () => {
            counts.fill++;
          };
        if (prop === "createLinearGradient" || prop === "createRadialGradient")
          return () => ({ addColorStop: () => undefined });
        return () => undefined;
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, counts };
}

let restore: (() => HTMLCanvasElement) | null = null;
afterEach(() => {
  if (restore) setCanvasSource(restore);
  restore = null;
});

const plantAt = (seed: number): Plant => growPlant(P, seed, { x: 300, y: 390 });
const SETTLED = 500;

describe("a finished plant is drawn once and blitted thereafter", () => {
  it("draws paths while the plant is still changing", () => {
    // Caching a moving target would rebuild the cache every frame, which is strictly worse
    // than not caching at all.
    restore = setCanvasSource(stubCanvas);
    const { ctx, counts } = destination();
    paintPlantCached(ctx, plantAt(1), 40, SETTLED, 1);
    expect(counts.drawImage).toBe(0);
    expect(counts.fill).toBeGreaterThan(10);
  });

  it("blits once it has settled", () => {
    restore = setCanvasSource(stubCanvas);
    const { ctx, counts } = destination();
    paintPlantCached(ctx, plantAt(2), Infinity, SETTLED, 1);
    expect(counts.drawImage).toBe(1);
    expect(counts.fill).toBe(0);
  });

  it("renders the picture ONCE however many frames follow", () => {
    // The whole point. Measured before this existed: 149 blooms redrawn per frame, 67% of the
    // paint budget in petals, and the garden running at 11 frames per second.
    let made = 0;
    restore = setCanvasSource(() => {
      made++;
      return stubCanvas();
    });
    const plant = plantAt(3);
    const { ctx, counts } = destination();
    for (let i = 0; i < 30; i++)
      paintPlantCached(ctx, plant, Infinity, SETTLED, 1);
    expect(made).toBe(1);
    expect(counts.drawImage).toBe(30);
  });

  it("gives every plant its own picture", () => {
    // Keyed on the Plant object. A key of "genome plus position" would have needed explicit
    // invalidation; this way a re-grown plant is simply a different object.
    let made = 0;
    restore = setCanvasSource(() => {
      made++;
      return stubCanvas();
    });
    const { ctx } = destination();
    const a = plantAt(4);
    const b = plantAt(5);
    paintPlantCached(ctx, a, Infinity, SETTLED, 1);
    paintPlantCached(ctx, b, Infinity, SETTLED, 1);
    paintPlantCached(ctx, a, Infinity, SETTLED, 1);
    expect(made).toBe(2);
    expect(cachedCount([a, b])).toBe(2);
  });

  it("re-renders when the device pixel ratio changes", () => {
    // Moving a window between a retina and a non-retina display changes dpr. A cache kept at
    // the old one would show every plant at half resolution, or at twice the memory.
    let made = 0;
    restore = setCanvasSource(() => {
      made++;
      return stubCanvas();
    });
    const { ctx } = destination();
    const plant = plantAt(6);
    paintPlantCached(ctx, plant, Infinity, SETTLED, 1);
    paintPlantCached(ctx, plant, Infinity, SETTLED, 2);
    expect(made).toBe(2);
  });

  it("CONTROL: an un-settled plant is never cached, however often it is drawn", () => {
    // Guards the branch from the other side. If the settle check were inverted or dropped, the
    // tests above would all still pass and every plant would freeze at its first frame.
    let made = 0;
    restore = setCanvasSource(() => {
      made++;
      return stubCanvas();
    });
    const { ctx } = destination();
    const plant = plantAt(7);
    for (let t = 0; t < 20; t++) paintPlantCached(ctx, plant, t, SETTLED, 1);
    expect(made).toBe(0);
    expect(cachedCount([plant])).toBe(0);
  });

  it("falls back to drawing when a canvas cannot be had", () => {
    // Fail loud is right for a save; for a render it is not. A plant that vanishes because an
    // offscreen canvas was refused is a worse outcome than one drawn the slow way.
    restore = setCanvasSource(
      () =>
        ({
          width: 0,
          height: 0,
          getContext: () => null,
        }) as unknown as HTMLCanvasElement,
    );
    const { ctx, counts } = destination();
    paintPlantCached(ctx, plantAt(8), Infinity, SETTLED, 1);
    expect(counts.drawImage).toBe(0);
    expect(counts.fill).toBeGreaterThan(10);
  });
});
