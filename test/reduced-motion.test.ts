/**
 * `prefers-reduced-motion` stops the sway and nothing else.
 *
 * Three claims, and the third is the one that matters: with the preference on, the shear is
 * the identity; with it off, the same input IS displaced (so the first assertion is not
 * vacuous); and growth — the thing a shared link has to reproduce for everyone — is
 * byte-identical either way. The preference is a fact about the matrix, not about the clock,
 * and this file is what keeps it that way.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  applySway,
  reducedMotion,
  setReducedMotionForTest,
  shearPoint,
  swayAt,
} from "../src/render/motion";
import { growPlant } from "../src/growth/sim";
import { randomGenome } from "../src/genome/genome";
import { express } from "../src/genome/express";
import { genomeSeed } from "../src/genome/serialize";
import { mulberry32 } from "../src/rng";

const WORLD = 1180;
const BASE_Y = 390;
const KEY = genomeSeed(randomGenome(mulberry32(11)));
const TIP = { x: 600, y: BASE_Y - 250 };

/** Where a plant's tip is drawn at tick t, through the same two calls `scene.ts` makes. */
function tipAt(t: number): { x: number; y: number } {
  const k = swayAt(t, KEY, 600, WORLD, { stiffness: 0.25 });
  let m: number[] = [1, 0, 0, 1, 0, 0];
  const fake = {
    transform: (...args: number[]) => {
      m = args;
    },
  } as unknown as CanvasRenderingContext2D;
  applySway(fake, k, BASE_Y);
  const [a, b, c, d, e, f] = m as [number, number, number, number, number, number];
  const viaMatrix = { x: a * TIP.x + c * TIP.y + e, y: b * TIP.x + d * TIP.y + f };
  const viaRule = shearPoint(TIP, k, BASE_Y);
  expect(viaMatrix.x).toBeCloseTo(viaRule.x, 10);
  return viaRule;
}

afterEach(() => setReducedMotionForTest(null));

describe("reduced motion", () => {
  it("defaults to off where there is no matchMedia", () => {
    expect(typeof (globalThis as { matchMedia?: unknown }).matchMedia).toBe("undefined");
    expect(reducedMotion()).toBe(false);
  });

  it("reads matchMedia when it exists, and the seam overrides it", () => {
    const g = globalThis as { matchMedia?: (q: string) => { matches: boolean } };
    const asked: string[] = [];
    g.matchMedia = (q) => {
      asked.push(q);
      return { matches: true };
    };
    try {
      expect(reducedMotion()).toBe(true);
      expect(asked).toEqual(["(prefers-reduced-motion: reduce)"]);
      setReducedMotionForTest(false);
      expect(reducedMotion()).toBe(false);
    } finally {
      delete g.matchMedia;
    }
  });

  it("ON: the tip is drawn exactly where it rests, at every tick", () => {
    setReducedMotionForTest(true);
    for (let t = 0; t < 3000; t += 7) {
      expect(swayAt(t, KEY, 600, WORLD, { stiffness: 0.25 })).toBe(0);
      expect(tipAt(t)).toEqual(TIP);
    }
  });

  it("CONTROL, OFF: the same input is displaced", () => {
    setReducedMotionForTest(false);
    let moved = 0;
    for (let t = 0; t < 3000; t += 7) if (tipAt(t).x !== TIP.x) moved++;
    expect(moved).toBeGreaterThan(300);
  });

  it("does not touch growth: the grown plant is byte-identical either way", () => {
    const grow = () => {
      const rand = mulberry32(5);
      return JSON.stringify(
        [0, 1, 2].map(() => {
          const g = randomGenome(rand);
          return growPlant(express(g), genomeSeed(g), { x: 300, y: BASE_Y });
        }),
      );
    };
    setReducedMotionForTest(false);
    const off = grow();
    setReducedMotionForTest(true);
    const on = grow();
    expect(on).toBe(off);
    expect(on.length).toBeGreaterThan(1000);
  });
});
