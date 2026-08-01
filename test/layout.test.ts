import { describe, it, expect } from "vitest";
import {
  MAX_H,
  MAX_PLOTS,
  MAX_W,
  MIN_H,
  MIN_PLOTS,
  MIN_PLOT_WIDTH,
  MIN_W,
  SOIL_BAND,
  computeLayout,
  layoutChanged,
} from "../src/game/layout";

/** Real device viewports, not round numbers. */
const VIEWPORTS: [string, number, number][] = [
  ["phone portrait", 412, 839],
  ["phone landscape", 863, 360],
  ["iPhone 15", 393, 659],
  ["small tablet", 768, 1024],
  ["laptop", 1440, 900],
  ["wide desktop", 2560, 1440],
  ["absurdly narrow", 240, 500],
  ["absurdly short", 1400, 240],
];

describe("computeLayout", () => {
  it("never returns a world outside its own bounds, on any viewport", () => {
    for (const [name, w, h] of VIEWPORTS) {
      const l = computeLayout(w, h);
      expect(l.W, name).toBeGreaterThanOrEqual(MIN_W);
      expect(l.W, name).toBeLessThanOrEqual(MAX_W);
      expect(l.H, name).toBeGreaterThanOrEqual(MIN_H);
      expect(l.H, name).toBeLessThanOrEqual(MAX_H);
      expect(l.plotXs.length, name).toBeGreaterThanOrEqual(MIN_PLOTS);
      expect(l.plotXs.length, name).toBeLessThanOrEqual(MAX_PLOTS);
    }
  });

  it("keeps every plot inside the world, with room for a canopy", () => {
    // A plot at x=0 would grow a plant half off the frame — the defect that pushed the
    // garden's inset from 90 to 135 when founders started spanning the full droop range.
    for (const [name, w, h] of VIEWPORTS) {
      const l = computeLayout(w, h);
      for (const x of l.plotXs) {
        expect(x, name).toBeGreaterThan(20);
        expect(x, name).toBeLessThan(l.W - 20);
      }
    }
  });

  it("leaves the soil band room for the tray", () => {
    for (const [name, w, h] of VIEWPORTS) {
      const l = computeLayout(w, h);
      expect(l.H - l.soil, name).toBe(SOIL_BAND);
      expect(l.soil, name).toBeGreaterThan(300); // headroom for a plant
    }
  });

  it("gives a wider viewport at least as many plots as a narrower one", () => {
    // Monotonicity. Without it, resizing a window could drop plots and then add them back,
    // and every plot lost retires a plant.
    let prev = 0;
    for (let w = 320; w <= 2000; w += 20) {
      const n = computeLayout(w, 900).plotXs.length;
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });

  it("never packs plots closer than a plant is wide", () => {
    // The whole point of deriving plot count from width rather than fixing it at six.
    for (const [name, w, h] of VIEWPORTS) {
      const l = computeLayout(w, h);
      if (l.plotXs.length < 2) continue;
      const gap = l.plotXs[1]! - l.plotXs[0]!;
      // MIN_PLOTS is a floor that can override spacing on a very narrow screen, so only
      // assert the spacing rule where the count was actually driven by width.
      if (l.plotXs.length > MIN_PLOTS)
        expect(gap, name).toBeGreaterThanOrEqual(MIN_PLOT_WIDTH * 0.9);
    }
  });

  it("spreads plots across the world instead of crowding them into the middle", () => {
    // A mutation pinning the inset back to a fixed 135 SURVIVED every other test in this
    // file: on a 396-wide world that leaves 126px of usable bed with 135px of dead space
    // either side. "Inside the world" is not the same property as "using the world", and
    // only the first was being asserted.
    for (const [name, w, h] of VIEWPORTS) {
      const l = computeLayout(w, h);
      const span = l.plotXs.at(-1)! - l.plotXs[0]!;
      expect(span / l.W, name).toBeGreaterThan(0.5);
    }
  });

  it("spaces plots evenly", () => {
    const l = computeLayout(1440, 900);
    const gaps = l.plotXs.slice(1).map((x, i) => x - l.plotXs[i]!);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0]!, 6);
  });

  it("gives a desktop world nine plots", () => {
    // Six was reported as too few to hold a breeding project AND its seedlings: two parents
    // held back leaves only four working slots, against a tight-linkage target that needs
    // roughly seventeen gametes.
    expect(computeLayout(1440, 900).plotXs.length).toBe(9);
  });

  it("reproduces the hand-tuned desktop world", () => {
    // The 1180x470-ish world was arrived at by looking at renders, not by arithmetic, and a
    // generalisation that quietly changed it would be a regression. The world and the 135px
    // inset are still those hand-tuned values.
    //
    // The plot COUNT is not, deliberately: six was raised to nine when a play-through found
    // the bed too small to hold a breeding project and its seedlings at once. That is a
    // decision, not a silent drift, which is why the number here moved with it.
    const l = computeLayout(1440, 900);
    expect(l.W).toBe(MAX_W);
    expect(l.plotXs).toHaveLength(9);
    expect(l.plotXs[0]).toBeCloseTo(135, 5);
  });

  it("gives a phone a usable garden rather than a strip", () => {
    // The defect: a fixed 1180-wide world scaled down to 396x158 on a phone.
    const l = computeLayout(412, 839);
    expect(l.W).toBeLessThan(500); // the world itself is narrow, not shrunk
    expect(l.H / l.W).toBeGreaterThan(0.9); // and not a letterbox strip
    // Three, up from two, for the same reason the desktop went six to nine.
    expect(l.plotXs.length).toBe(3);
  });

  it("is deterministic", () => {
    expect(computeLayout(800, 600)).toEqual(computeLayout(800, 600));
  });

  it("survives degenerate viewports without producing NaN", () => {
    for (const [w, h] of [
      [0, 0],
      [1, 1],
      [-50, -50],
      [100000, 100000],
    ]) {
      const l = computeLayout(w!, h!);
      expect(Number.isFinite(l.W) && Number.isFinite(l.H)).toBe(true);
      expect(l.plotXs.every(Number.isFinite)).toBe(true);
      expect(l.plotXs.length).toBeGreaterThanOrEqual(MIN_PLOTS);
    }
  });
});

describe("layoutChanged", () => {
  it("is false for the same viewport", () => {
    expect(
      layoutChanged(computeLayout(1440, 900), computeLayout(1440, 900)),
    ).toBe(false);
  });

  it("is false across viewport changes that land on the same world", () => {
    // Both clamp to the same 1180-wide world, so no re-grow should happen — re-growing
    // costs a full growPlant per occupant and rebuilds the whole background buffer.
    expect(
      layoutChanged(computeLayout(1440, 900), computeLayout(1600, 900)),
    ).toBe(false);
  });

  it("is true when the world actually changes", () => {
    expect(
      layoutChanged(computeLayout(412, 839), computeLayout(1440, 900)),
    ).toBe(true);
  });
});
