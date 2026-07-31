import { describe, it, expect } from "vitest";
import {
  bedDepth,
  paintOrder,
  plotDepth,
  toCanvasSpace,
  toPlotSpace,
} from "../src/render/bed";
import { placeRetired } from "../src/render/forest";
import { genomeSeed } from "../src/genome/serialize";
import { randomGenome } from "../src/genome/genome";
import { mulberry32 } from "../src/rng";

const BASE = { x: 500, y: 390 };

describe("the bed has depth, and it is shallower than the forest's", () => {
  it("keeps every live plant clearly in front of every background layer", () => {
    // The hierarchy the whole background mechanic rests on. If the furthest live plant reached
    // the nearest forest layer, the two would read as one continuous field and "the bed" would
    // stop being a distinguishable thing.
    const rand = mulberry32(5);
    let nearestForest = 0;
    for (let i = 0; i < 300; i++) {
      const p = placeRetired(genomeSeed(randomGenome(rand)), i, 1180);
      nearestForest = Math.max(nearestForest, p.alpha);
    }
    let furthestBed = 1;
    for (let i = 0; i < 12; i++)
      furthestBed = Math.min(furthestBed, bedDepth(i).alpha);
    expect(furthestBed).toBeGreaterThan(nearestForest + 0.25);
  });

  it("stays subtle — a bed, not a corridor", () => {
    for (let i = 0; i < 20; i++) {
      const d = bedDepth(i);
      expect(d.scale).toBeGreaterThan(0.8);
      expect(d.scale).toBeLessThanOrEqual(1);
      expect(d.alpha).toBeGreaterThan(0.8);
      expect(d.alpha).toBeLessThanOrEqual(1);
      expect(Math.abs(d.dy)).toBeLessThan(20);
    }
  });

  it("agrees with itself: further back is smaller, higher and dimmer together", () => {
    // Depth cues must not contradict. A plant drawn smaller but brighter reads as a rendering
    // fault rather than as distance — the same rule the forest placement follows.
    const all = Array.from({ length: 12 }, (_, i) => bedDepth(i));
    const sorted = [...all].sort((a, b) => a.depth - b.depth);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.scale).toBeLessThanOrEqual(sorted[i - 1]!.scale);
      expect(sorted[i]!.alpha).toBeLessThanOrEqual(sorted[i - 1]!.alpha);
      expect(sorted[i]!.dy).toBeLessThanOrEqual(sorted[i - 1]!.dy);
    }
  });
});

describe("depth is spread, not ramped", () => {
  it("never runs steadily left to right", () => {
    // A bed that recedes monotonically across the frame reads as a perspective grid rather than
    // as plants at different distances. This asserts the sequence changes direction.
    const d = Array.from({ length: 6 }, (_, i) => plotDepth(i));
    let ups = 0;
    let downs = 0;
    for (let i = 1; i < d.length; i++) d[i]! > d[i - 1]! ? ups++ : downs++;
    expect(ups).toBeGreaterThan(0);
    expect(downs).toBeGreaterThan(0);
  });

  it("keeps neighbouring plots at visibly different depths", () => {
    // Two adjacent plants at the same distance is the flat bed this exists to fix, locally.
    for (let i = 1; i < 8; i++)
      expect(Math.abs(plotDepth(i) - plotDepth(i - 1))).toBeGreaterThan(0.15);
  });

  it("uses the whole range rather than clustering", () => {
    const d = Array.from({ length: 6 }, (_, i) => plotDepth(i));
    expect(Math.min(...d)).toBeLessThan(0.25);
    expect(Math.max(...d)).toBeGreaterThan(0.75);
  });

  it("gives a plot the same depth every time", () => {
    // A plot that changed distance between sessions would make the garden restless in a way
    // nobody could name.
    for (let i = 0; i < 10; i++) expect(plotDepth(i)).toBe(plotDepth(i));
  });
});

describe("paint order resolves overlap", () => {
  it("paints the furthest plot first", () => {
    const order = paintOrder(6);
    expect(order).toHaveLength(6);
    expect(new Set(order).size).toBe(6);
    for (let i = 1; i < order.length; i++)
      expect(plotDepth(order[i]!)).toBeLessThanOrEqual(
        plotDepth(order[i - 1]!),
      );
  });

  it("CONTROL: array order is NOT already depth order", () => {
    // Otherwise sorting is a no-op and two overlapping plants still interleave by plot index,
    // which is the defect this exists to fix.
    expect(paintOrder(6)).not.toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe("hit-testing agrees with what was drawn", () => {
  it("round-trips a point through the depth transform", () => {
    // At the far end depth is a 14% shrink and a 13px lift — far more than a flower's click
    // slack. Without the inverse, clicking a flower where it APPEARS would miss it.
    for (const plot of [0, 1, 2, 3, 4, 5]) {
      const d = bedDepth(plot);
      for (const p of [
        { x: 500, y: 390 },
        { x: 620, y: 180 },
        { x: 380, y: 250 },
      ]) {
        const back = toPlotSpace(toCanvasSpace(p, BASE, d), BASE, d);
        expect(back.x).toBeCloseTo(p.x, 9);
        expect(back.y).toBeCloseTo(p.y, 9);
      }
    }
  });

  it("leaves the plant's own base exactly where it is", () => {
    // The base is the anchor. A plant that scaled about the canvas origin would slide out of
    // its plot — the same failure the sway's base compensation exists to prevent.
    for (const plot of [0, 3, 5]) {
      const at = toCanvasSpace(BASE, BASE, bedDepth(plot));
      expect(at.x).toBeCloseTo(BASE.x, 9);
      // ...except for the vertical lift, which is the whole point of dy.
      expect(at.y).toBeCloseTo(BASE.y + bedDepth(plot).dy, 9);
    }
  });

  it("CONTROL: the transform is not the identity", () => {
    // Every round-trip above passes trivially if depth does nothing.
    const far = [0, 1, 2, 3, 4, 5]
      .map(bedDepth)
      .reduce((a, b) => (b.depth > a.depth ? b : a));
    const moved = toCanvasSpace({ x: 620, y: 180 }, BASE, far);
    expect(Math.hypot(moved.x - 620, moved.y - 180)).toBeGreaterThan(15);
  });
});
