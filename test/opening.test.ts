import { describe, it, expect } from "vitest";
import { paintPlant } from "../src/render/stage";
import { growPlant } from "../src/growth/sim";
import type { Phenotype, Plant } from "../src/types";

const P: Phenotype = {
  vigour: 0.6,
  droop: 0.15,
  phototropism: 0.6,
  stiffness: 0.4,
  branchiness: 0.2,
  baseWidth: 8,
  taper: 0.98,
  branchAngle: 0.5,
  branchWidthRatio: 0.7,
  doubled: false,
  petalShape: "round",
  petalCount: 5,
  inflorescence: "solitary",
  hueClass: 1,
  white: false,
  bloomRadius: 16,
  leafScale: 16,
  viable: true,
};

/**
 * A canvas that records instead of drawing.
 *
 * `paintPlant` had no unit test at all — everything about it was checked either by a pure
 * helper it calls or by a screenshot. A recording context is enough to assert the arithmetic
 * it does on the way to the canvas, which is where the opening rule lives.
 */
function recorder(): {
  ctx: CanvasRenderingContext2D;
  scales: [number, number][];
} {
  const scales: [number, number][] = [];
  const gradient = { addColorStop: () => undefined };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_t, prop) {
      if (prop === "scale")
        return (x: number, y: number) => {
          scales.push([x, y]);
        };
      if (prop === "createLinearGradient" || prop === "createRadialGradient")
        return () => gradient;
      if (prop === "canvas") return { width: 1200, height: 500 };
      // Any other property may be read as a value (fillStyle) or called as a method. A
      // function satisfies both: reading it is harmless, calling it is a no-op.
      return () => undefined;
    },
    set: () => true,
  };
  return {
    ctx: new Proxy({}, handler) as unknown as CanvasRenderingContext2D,
    scales,
  };
}

/** The x-scales applied around blooms — the opening factor, before foreshortening. */
function bloomScales(plant: Plant, untilTick: number): number[] {
  const { ctx, scales } = recorder();
  paintPlant(ctx, plant, untilTick);
  // Bloom transforms are the only place paintPlant scales BOTH axes together; the stem
  // shading uses outlines rather than transforms.
  return scales.map(([x]) => x);
}

const PLANT = growPlant(P, 2026, { x: 300, y: 390 });
const firstBloom = Math.min(...PLANT.blooms.map((b) => b.tick));

describe("flowers open rather than switching on", () => {
  it("draws a just-arrived flower small", () => {
    // Blooms used to appear at full size the instant their tick passed, which read as a plant
    // acquiring decorations rather than coming into flower.
    const s = bloomScales(PLANT, firstBloom);
    expect(s.length).toBeGreaterThan(0);
    expect(Math.min(...s)).toBeLessThan(0.5);
  });

  it("has it fully open a little later", () => {
    const s = bloomScales(PLANT, firstBloom + 40);
    expect(s.length).toBeGreaterThan(0);
    expect(Math.max(...s)).toBeCloseTo(1, 6);
  });

  it("opens monotonically", () => {
    // A flower that grew and shrank again would read as a glitch rather than as opening.
    let last = -1;
    for (const age of [0, 5, 10, 18, 26, 60]) {
      const s = bloomScales(PLANT, firstBloom + age);
      const biggest = Math.max(...s);
      expect(biggest).toBeGreaterThanOrEqual(last - 1e-9);
      last = biggest;
    }
  });

  it("CRITICAL: the background composite never freezes a half-open flower", () => {
    // The accumulation buffer paints with the default `untilTick` of Infinity, and whatever it
    // draws is permanent — a flower caught mid-open there would stay mid-open for the rest of
    // the game. This is the one case where getting the arithmetic wrong is unrecoverable.
    const s = bloomScales(PLANT, Infinity);
    expect(s.length).toBeGreaterThan(0);
    for (const x of s) expect(x).toBeCloseTo(1, 6);
  });

  it("CONTROL: the recorder is actually capturing the bloom transforms", () => {
    // Every assertion above is satisfied by an empty list of scales. This pins that the stub
    // sees the calls at all, and that a plant with flowers produces more of them than one
    // whose flowers have not appeared yet.
    expect(bloomScales(PLANT, -1)).toHaveLength(0);
    expect(bloomScales(PLANT, Infinity).length).toBeGreaterThanOrEqual(
      PLANT.blooms.length,
    );
  });
});
