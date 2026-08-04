import { describe, it, expect } from "vitest";
import { bloomsFor } from "../src/render/stage";
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
