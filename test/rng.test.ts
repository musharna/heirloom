import { describe, it, expect } from "vitest";
import { mulberry32, hashString, angleDelta } from "../src/rng";

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = Array.from({ length: 8 }, mulberry32(1));
    const b = Array.from({ length: 8 }, mulberry32(2));
    expect(a).not.toEqual(b);
  });

  it("stays within [0, 1)", () => {
    const r = mulberry32(999);
    for (let i = 0; i < 500; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("hashString", () => {
  it("is stable and unsigned", () => {
    expect(hashString("WwH1h1")).toBe(hashString("WwH1h1"));
    expect(hashString("a")).not.toBe(hashString("b"));
    expect(hashString("anything")).toBeGreaterThanOrEqual(0);
  });
});

describe("angleDelta", () => {
  it("returns the shortest signed turn", () => {
    expect(angleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(angleDelta(0, -Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
    // the short way from 0.1 rad to -0.1 rad is negative, not almost-2PI
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(-0.2);
    expect(Math.abs(angleDelta(0, 3 * Math.PI))).toBeLessThanOrEqual(
      Math.PI + 1e-9,
    );
  });
});
