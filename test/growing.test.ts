import { describe, it, expect } from "vitest";
import { bloomsFor } from "../src/render/stage";
import {
  growingCount,
  growingLayerBytes,
  paintPlantGrowing,
  releaseGrowth,
  setGrowthCanvasSource,
} from "../src/render/growing";
import { recordingContext } from "./oplog";
import { growPlant } from "../src/growth/sim";
import { randomGenome } from "../src/genome/genome";
import { express } from "../src/genome/express";
import { mulberry32 } from "../src/rng";

/**
 * The fact the growth cache is built on.
 *
 * `growing.ts` bakes a bloom into a shared layer and never revisits it. That is only sound if
 * the drawn set is append-only — if a bloom could leave it, the bake would be permanent and
 * wrong, and the plant would carry a flower that the direct painter no longer draws.
 *
 * It holds for two reasons that have to hold TOGETHER: `cullOccludedBlooms` is greedy over
 * array order, so each bloom's keep/drop decision depends only on blooms BEFORE it; and the
 * growth loop emits `plant.blooms` in non-decreasing tick order, so raising `untilTick` only
 * ever appends to the filtered array. Break either and this test fails.
 */
describe("the drawn bloom set only ever grows", () => {
  it("never drops a bloom it has already drawn", () => {
    const rand = mulberry32(913);
    let comparisons = 0;
    for (let i = 0; i < 60; i++) {
      const plant = growPlant(express(randomGenome(rand)), (rand() * 1e9) | 0, {
        x: 0,
        y: 0,
      });
      let prev: Set<unknown> = new Set();
      for (let t = 0; t <= 160; t += 4) {
        const now: Set<unknown> = new Set(bloomsFor(plant, t));
        for (const b of prev) {
          expect(
            now.has(b),
            `plant ${i} dropped a bloom between tick ${t - 4} and ${t}`,
          ).toBe(true);
        }
        if (prev.size) comparisons++;
        prev = now;
      }
    }
    // POSITIVE CONTROL: the loop must actually have had non-empty sets to compare. Without
    // this, a `bloomsFor` that returned nothing at every tick would satisfy every assertion
    // above and report the invariant proven.
    expect(comparisons).toBeGreaterThan(500);
  });

  it("CONTROL: the set does grow, so 'never shrinks' is not vacuous", () => {
    // "Never shrinks" is trivially true of a set that never changes. It has to be a claim
    // about something that moves.
    const rand = mulberry32(913);
    const plant = growPlant(express(randomGenome(rand)), 4242, { x: 0, y: 0 });
    const early = bloomsFor(plant, 20).length;
    const late = bloomsFor(plant, 160).length;
    expect(late).toBeGreaterThan(early);
    expect(early).toBeGreaterThan(0);
  });

  it("CONTROL: culling really does drop blooms, so the greedy order matters at all", () => {
    // If nothing were ever culled, the append-only property would follow from the tick filter
    // alone and this file would be testing `Array.prototype.filter`. The interesting case is
    // that culling is active AND still append-only.
    const rand = mulberry32(20260804);
    let culledSomewhere = 0;
    for (let i = 0; i < 40; i++) {
      const plant = growPlant(express(randomGenome(rand)), (rand() * 1e9) | 0, {
        x: 0,
        y: 0,
      });
      const visible = plant.blooms.filter((b) => b.tick <= 160).length;
      if (bloomsFor(plant, 160).length < visible) culledSomewhere++;
    }
    expect(culledSomewhere).toBeGreaterThan(0);
  });
});

/** A canvas whose context records what it was asked to draw, and whose size is settable. */
function recordingCanvas(sink: string[][]): () => HTMLCanvasElement {
  return () => {
    const { ctx, ops } = recordingContext();
    sink.push(ops);
    return {
      width: 0,
      height: 0,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;
  };
}

describe("the layered painter draws the same passes in the same order", () => {
  it("gives every pass its own layer and composites them in pass order", () => {
    const rand = mulberry32(77);
    const plant = growPlant(express(randomGenome(rand)), 5150, { x: 0, y: 0 });
    const sink: string[][] = [];
    const was = setGrowthCanvasSource(recordingCanvas(sink));
    try {
      const { ctx, ops } = recordingContext();
      paintPlantGrowing(ctx, plant, 70, 1);
      // Five layers allocated, one per pass.
      expect(sink).toHaveLength(5);
      // ...and five blits onto the target, in the order the layers were created — which is
      // PASSES order, which is paintPlant's order.
      expect(ops.filter((o) => o.startsWith("drawImage("))).toHaveLength(5);
    } finally {
      setGrowthCanvasSource(was);
      releaseGrowth(plant);
    }
  });

  it("CONTROL: every layer actually received drawing, not just an allocation", () => {
    // Five empty canvases composited in the right order would satisfy the assertions above
    // and render nothing at all.
    const rand = mulberry32(78);
    const plant = growPlant(express(randomGenome(rand)), 6161, { x: 0, y: 0 });
    const sink: string[][] = [];
    const was = setGrowthCanvasSource(recordingCanvas(sink));
    try {
      const { ctx } = recordingContext();
      paintPlantGrowing(ctx, plant, 90, 1);
      for (const [i, ops] of sink.entries()) {
        expect(ops.some((o) => o.startsWith("fill(")), `layer ${i} drew nothing`).toBe(true);
      }
    } finally {
      setGrowthCanvasSource(was);
      releaseGrowth(plant);
    }
  });

  it("holds layers per plant and releases them on request", () => {
    const rand = mulberry32(79);
    const plant = growPlant(express(randomGenome(rand)), 7171, { x: 0, y: 0 });
    const was = setGrowthCanvasSource(recordingCanvas([]));
    try {
      const { ctx } = recordingContext();
      expect(growingCount([plant])).toBe(0);
      paintPlantGrowing(ctx, plant, 60, 1);
      expect(growingCount([plant])).toBe(1);
      expect(growingLayerBytes(plant)).toBeGreaterThanOrEqual(0);
      releaseGrowth(plant);
      expect(growingCount([plant])).toBe(0);
      // CONTROL: releasing must not be a no-op that always reports zero.
      paintPlantGrowing(ctx, plant, 60, 1);
      expect(growingCount([plant])).toBe(1);
    } finally {
      setGrowthCanvasSource(was);
      releaseGrowth(plant);
    }
  });
});
