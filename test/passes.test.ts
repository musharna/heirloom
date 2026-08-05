import { describe, it, expect } from "vitest";
import { paintPlant } from "../src/render/stage";
import { growPlant } from "../src/growth/sim";
import { randomGenome } from "../src/genome/genome";
import { express } from "../src/genome/express";
import { mulberry32 } from "../src/rng";
import { digestOps, recordingContext } from "./oplog";
import { GOLDEN } from "./fixtures/paint-oplog";

/**
 * What `paintPlant` drew before its five passes were extracted, frozen so the extraction has
 * something to prove itself against.
 *
 * The golden is a DIGEST, not the operations. Storing raw logs produced a 112MB fixture: one
 * petal is a ~194-point path and a grown plant carries hundreds of blooms, so a single entry
 * runs to six figures of operations — 838,202 for the largest plant here. This repository has
 * already had its history rewritten once to shed that kind of weight.
 *
 * When this fails it names the entry and whether the op COUNT moved, not which op. To find
 * that, run both versions locally and diff `recordingContext`'s output directly: the logs are
 * cheap to produce and expensive only to store.
 */
function digests(): Record<string, { count: number; digest: string }> {
  const rand = mulberry32(20260804);
  const out: Record<string, { count: number; digest: string }> = {};
  for (let i = 0; i < 6; i++) {
    const plant = growPlant(express(randomGenome(rand)), (rand() * 1e9) | 0, {
      x: 0,
      y: 0,
    });
    // Two ticks mid-growth, one late, one past the settle point, so the golden covers a
    // partly-grown plant, a nearly-grown one and a finished one.
    for (const tick of [20, 55, 90, 140]) {
      const { ctx, ops } = recordingContext();
      paintPlant(ctx, plant, tick);
      out[`plant${i}@${tick}`] = { count: ops.length, digest: digestOps(ops) };
    }
  }
  return out;
}

describe("paintPlant draws exactly what it drew before the passes were extracted", () => {
  it("matches the golden op log", () => {
    const now = digests();
    expect(Object.keys(now).sort()).toEqual(Object.keys(GOLDEN).sort());
    for (const key of Object.keys(GOLDEN)) {
      // Count first: when it differs, that alone localises the change to "more or less was
      // drawn" rather than "something moved", which is the more useful failure to read.
      expect(now[key]!.count, `${key} op count`).toBe(GOLDEN[key]!.count);
      expect(now[key]!.digest, `${key} op digest`).toBe(GOLDEN[key]!.digest);
    }
  });

  it("CONTROL: the log is not trivially empty, and the digest is sensitive", () => {
    // Without the first half the comparison above would pass on two empty logs and report the
    // renderer unchanged when it had never been observed. Without the second it would pass on
    // a digest that ignored its input.
    const now = digests();
    for (const [key, d] of Object.entries(now)) {
      expect(d.count, key).toBeGreaterThan(50);
    }
    expect(digestOps(["moveTo(1,2)"])).not.toBe(digestOps(["moveTo(1,3)"]));
    // Order-sensitive, which is the entire point: this is what catches a pass moving.
    expect(digestOps(["a", "b"])).not.toBe(digestOps(["b", "a"]));
  });

  it("CONTROL: the recorder captures real drawing, not only property sets", () => {
    // A Proxy whose `get` trap returned undefined would record style assignments alone and
    // still produce a stable, non-empty, perfectly reproducible digest.
    const rand = mulberry32(1);
    const plant = growPlant(express(randomGenome(rand)), 99, { x: 0, y: 0 });
    const { ctx, ops } = recordingContext();
    paintPlant(ctx, plant, 90);
    expect(ops.some((o) => o.startsWith("fill("))).toBe(true);
    expect(ops.some((o) => o.startsWith("lineTo("))).toBe(true);
    expect(ops.some((o) => o.startsWith("fillStyle="))).toBe(true);
  });
});
