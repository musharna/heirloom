import { describe, it, expect } from "vitest";
import {
  WASH,
  effectiveDepth,
  placeRetired,
  remainingContrast,
} from "../src/render/forest";
import { randomGenome } from "../src/genome/genome";
import { genomeSeed } from "../src/genome/serialize";
import { mulberry32 } from "../src/rng";

describe("remainingContrast — the answer to the grey-soup risk", () => {
  it("leaves a fresh layer untouched", () => {
    expect(remainingContrast(0)).toBe(1);
  });

  it("decays geometrically, so layers approach the ground instead of piling up", () => {
    // §12 names background muddiness as a known risk. Geometric decay is the mitigation, and
    // the property that matters is that each step removes a FRACTION of what is left, never a
    // fixed amount — a linear fade would drive old layers to zero and then keep subtracting,
    // which is how a background turns into a flat grey rectangle.
    for (const n of [1, 5, 20, 60]) {
      const step = remainingContrast(n) - remainingContrast(n + 1);
      const laterStep = remainingContrast(n + 30) - remainingContrast(n + 31);
      expect(step).toBeGreaterThan(0);
      expect(laterStep).toBeLessThan(step);
    }
    expect(remainingContrast(500)).toBeGreaterThan(0);
  });

  it("is monotone", () => {
    for (let n = 0; n < 80; n++)
      expect(remainingContrast(n + 1)).toBeLessThan(remainingContrast(n));
  });

  it("keeps a recent plant clearly visible", () => {
    // If a plant faded to nothing within a handful of retirements the background would never
    // read as accumulation — just as churn.
    expect(remainingContrast(5)).toBeGreaterThan(0.7);
  });

  it("reaches a usable depth — dozens of plants, not three", () => {
    const d = effectiveDepth();
    expect(d).toBeGreaterThan(30);
    expect(d).toBeLessThan(120);
  });

  it("CONTROL: a heavier wash would collapse the depth", () => {
    // Pins that the depth assertion above discriminates. At a 30% wash the forest would be
    // gone in under a dozen plants.
    const heavy = (n: number) => (1 - 0.3) ** n;
    let n = 0;
    while (heavy(n) > 0.05) n++;
    expect(n).toBeLessThan(12);
    expect(WASH).toBeLessThan(0.3);
  });
});

describe("placeRetired", () => {
  const key = () => genomeSeed(randomGenome(mulberry32(1)));

  it("is deterministic — the forest must not rearrange itself on reload", () => {
    // §7 regenerates the background from a replay list rather than storing an image. Random
    // placement would reshuffle the player's whole history every time they opened the page.
    expect(placeRetired(key(), 3)).toEqual(placeRetired(key(), 3));
  });

  it("separates two retirements of the SAME genome", () => {
    // Otherwise a lineage bred true would stack identical silhouettes exactly on top of each
    // other and read as one plant.
    expect(placeRetired(key(), 0)).not.toEqual(placeRetired(key(), 1));
  });

  it("scatters horizontally rather than stacking in plot columns", () => {
    const rand = mulberry32(9);
    const xs = Array.from(
      { length: 200 },
      (_, i) => placeRetired(genomeSeed(randomGenome(rand)), i).dx,
    );
    expect(Math.min(...xs)).toBeLessThan(-100);
    expect(Math.max(...xs)).toBeGreaterThan(100);
  });

  it("makes further-back plants smaller, dimmer, blurrier and higher — all together", () => {
    // Depth cues must agree. A plant drawn small but sharp, or high but bright, reads as a
    // rendering error rather than as distance.
    const rand = mulberry32(11);
    const places = Array.from({ length: 400 }, (_, i) =>
      placeRetired(genomeSeed(randomGenome(rand)), i),
    );
    const sorted = [...places].sort((a, b) => b.scale - a.scale);
    const front = sorted[0]!;
    const back = sorted.at(-1)!;
    expect(back.alpha).toBeLessThan(front.alpha);
    expect(back.blur).toBeGreaterThan(front.blur);
    expect(back.dy).toBeLessThan(front.dy); // smaller y = higher in frame
  });

  it("stays inside sane ranges", () => {
    const rand = mulberry32(13);
    for (let i = 0; i < 500; i++) {
      const p = placeRetired(genomeSeed(randomGenome(rand)), i);
      expect(p.scale).toBeGreaterThan(0.6);
      expect(p.scale).toBeLessThanOrEqual(0.83);
      expect(p.alpha).toBeGreaterThan(0.25);
      expect(p.alpha).toBeLessThanOrEqual(0.51);
      expect(p.blur).toBeGreaterThan(1);
      expect(p.blur).toBeLessThan(3.1);
      expect(Math.abs(p.dx)).toBeLessThan(171);
    }
  });

  it("keeps the background clearly SUBORDINATE to the live bed", () => {
    // The property those numbers serve, stated so a later tweak cannot quietly undo it. The
    // original ranges satisfied every other test in this file while producing a background
    // that competed with the foreground for attention — nothing here was measuring "does it
    // recede", only "does it vary", and variation is not depth.
    const rand = mulberry32(21);
    for (let i = 0; i < 300; i++) {
      const p = placeRetired(genomeSeed(randomGenome(rand)), i);
      expect(p.alpha).toBeLessThan(0.55); // never near a live plant's full opacity
      expect(p.scale).toBeLessThan(0.85); // always visibly smaller
      expect(p.blur).toBeGreaterThan(1); // always softer than a sharp foreground edge
    }
  });
});
