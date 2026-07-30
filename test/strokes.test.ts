import { describe, it, expect } from "vitest";
import { groupChains, smoothChain, buildOutline } from "../src/render/strokes";
import type { StrokeSegment } from "../src/types";

const seg = (i: number, chain = 0, w = 4): StrokeSegment => ({
  x0: i * 10,
  y0: 0,
  x1: (i + 1) * 10,
  y1: 0,
  w0: w,
  w1: w,
  depth: 0,
  tick: i,
  chain,
});

describe("groupChains", () => {
  it("splits a flat segment list by chain id, preserving order", () => {
    const groups = groupChains([seg(0, 0), seg(0, 1), seg(1, 0), seg(1, 1)]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.map((s) => s.chain)).toEqual([0, 0]);
    expect(groups[0]!.map((s) => s.tick)).toEqual([0, 1]);
  });

  it("returns an empty array for no input", () => {
    expect(groupChains([])).toEqual([]);
  });
});

describe("buildOutline", () => {
  it("returns 2*(N+1) points for N segments", () => {
    expect(buildOutline([seg(0), seg(1), seg(2)])).toHaveLength(8);
  });

  it("offsets a horizontal stroke by half-width on each side", () => {
    // A single horizontal segment of width 4 spans y = -2 .. +2.
    const pts = buildOutline([seg(0)]);
    const ys = pts.map((p) => p.y).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(-2);
    expect(ys[ys.length - 1]!).toBeCloseTo(2);
  });

  it("is a closed loop: the two sides run in opposite order", () => {
    const pts = buildOutline([seg(0), seg(1)]);
    // first point starts the left side, last point starts the right side
    expect(pts[0]!.x).toBeCloseTo(pts[pts.length - 1]!.x);
    expect(pts[0]!.y).not.toBeCloseTo(pts[pts.length - 1]!.y);
  });

  it("returns nothing for an empty chain", () => {
    expect(buildOutline([])).toEqual([]);
  });

  it("narrows where the segment narrows", () => {
    const tapered: StrokeSegment[] = [{ ...seg(0), w0: 8, w1: 2 }];
    const pts = buildOutline(tapered);
    const spanAt = (x: number) => {
      const at = pts.filter((p) => Math.abs(p.x - x) < 1e-6);
      return Math.abs(at[0]!.y - at[1]!.y);
    };
    expect(spanAt(0)).toBeCloseTo(8);
    expect(spanAt(10)).toBeCloseTo(2);
  });
});

describe("smoothChain", () => {
  it("densifies the chain by roughly the subdivision factor", () => {
    const out = smoothChain([seg(0), seg(1), seg(2), seg(3)], 3);
    expect(out.length).toBeGreaterThan(8);
  });

  it("preserves the endpoints", () => {
    const chain = [seg(0), seg(1), seg(2)];
    const out = smoothChain(chain, 3);
    expect(out[0]!.x0).toBeCloseTo(chain[0]!.x0);
    expect(out[out.length - 1]!.x1).toBeCloseTo(chain[chain.length - 1]!.x1);
  });

  it("passes short chains straight through", () => {
    expect(smoothChain([seg(0)], 3)).toHaveLength(1);
    expect(smoothChain([], 3)).toEqual([]);
  });
});
