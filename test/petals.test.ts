import { describe, it, expect } from "vitest";
import { petalPath, petalColor, petalGlow } from "../src/render/petals";
import type { PetalSpec, PetalShape } from "../src/types";

describe("petalGlow", () => {
  it("tracks the bloom's own hue instead of a fixed colour", () => {
    // A hardcoded glow put a pink halo around the blue and magenta blooms.
    const seen = new Set([0, 1, 2, 3, 4].map((h) => petalGlow(h, false, 0.2)));
    expect(seen.size).toBe(5);
  });

  it("carries the requested alpha, including fully transparent for gradient stops", () => {
    expect(petalGlow(0, false, 0.2)).toContain("/ 0.2");
    expect(petalGlow(0, false, 0)).toContain("/ 0");
    expect(petalGlow(0, true, 0.26)).toContain("/ 0.26");
  });
});

const spec = (shape: PetalShape, angle = 0): PetalSpec => ({
  center: { x: 0, y: 0 },
  angle,
  length: 20,
  width: 10,
  shape,
  colorDepth: 0,
});

const ALL: PetalShape[] = ["round", "pointed", "lobed", "frilled"];

describe("petalPath", () => {
  it("returns a closed outline for every shape", () => {
    for (const s of ALL) {
      const pts = petalPath(spec(s));
      expect(pts.length).toBeGreaterThan(10);
      for (const p of pts) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }
    }
  });

  it("starts at the petal base, i.e. near the centre", () => {
    const pts = petalPath(spec("round"));
    expect(Math.hypot(pts[0]!.x, pts[0]!.y)).toBeLessThan(2);
  });

  it("extends roughly to the specified length", () => {
    const pts = petalPath(spec("round"));
    const far = Math.max(...pts.map((p) => Math.hypot(p.x, p.y)));
    expect(far).toBeGreaterThan(15);
    expect(far).toBeLessThan(26);
  });

  it("rotates with the angle", () => {
    const a = petalPath(spec("round", 0));
    const b = petalPath(spec("round", Math.PI / 2));
    expect(a).not.toEqual(b);
    // Same shape, so the farthest distance is unchanged by rotation.
    const far = (pts: typeof a) =>
      Math.max(...pts.map((p) => Math.hypot(p.x, p.y)));
    expect(far(a)).toBeCloseTo(far(b), 6);
  });

  it("gives a pointed petal a narrower tip than a round one", () => {
    const nearTip = (s: PetalShape) => {
      const pts = petalPath(spec(s));
      const far = Math.max(...pts.map((p) => Math.hypot(p.x, p.y)));
      const band = pts.filter((p) => Math.hypot(p.x, p.y) > far * 0.9);
      return Math.max(...band.map((p) => Math.abs(p.y))) * 2;
    };
    expect(nearTip("pointed")).toBeLessThan(nearTip("round"));
  });

  it("changes petal AREA enough per allele to be visible at render scale", () => {
    // Measured failure this guards: lobed and frilled changed total petal area by 0.5% and
    // 2.3% against baseline, so both were invisible at the size the game renders and only
    // resolved above 5x zoom. A gene the player cannot see is not a gene.
    const area = (s: PetalShape): number => {
      const pts = petalPath(spec(s));
      let a = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]!;
        const q = pts[(i + 1) % pts.length]!;
        a += p.x * q.y - q.x * p.y;
      }
      return Math.abs(a) / 2;
    };
    const base = area("round");
    for (const s of ["pointed", "lobed", "frilled"] as PetalShape[]) {
      const delta = Math.abs(area(s) - base) / base;
      expect(delta).toBeGreaterThan(0.08);
    }
    // And lobed must differ from frilled, or shipping both is pointless.
    expect(Math.abs(area("lobed") - area("frilled")) / base).toBeGreaterThan(
      0.06,
    );
  });

  it("makes the four shape alleles geometrically distinct", () => {
    // The P locus is only meaningful if its alleles actually look different.
    const sigs = ALL.map((s) =>
      petalPath(spec(s))
        .map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`)
        .join(";"),
    );
    expect(new Set(sigs).size).toBe(4);
  });
});

describe("petalColor", () => {
  it("ignores hue entirely when the pigment block is expressed", () => {
    expect(petalColor(0, true, 0)).toBe(petalColor(4, true, 0));
  });

  it("gives visibly different colours for different hue classes", () => {
    const seen = new Set([0, 1, 2, 3, 4].map((h) => petalColor(h, false, 0)));
    expect(seen.size).toBe(5);
  });

  it("LIGHTENS toward the inner whorls, so a doubled centre is never a void", () => {
    // This test previously asserted the opposite. Darkening inward made a doubled bloom's
    // packed centre render darker than the ground it sat on, so it read as a hole punched
    // through the flower. Real doubled flowers catch light in the furl.
    const light = (css: string) => Number(/(\d+(?:\.\d+)?)%\)$/.exec(css)![1]);
    expect(light(petalColor(0, false, 1))).toBeGreaterThan(
      light(petalColor(0, false, 0)),
    );
    expect(light(petalColor(0, true, 1))).toBeGreaterThan(
      light(petalColor(0, true, 0)),
    );
    // And the inner whorl must clear the dark ground by a wide margin.
    expect(light(petalColor(0, false, 1))).toBeGreaterThan(40);
  });

  it("falls back rather than returning undefined for an out-of-range hue class", () => {
    expect(petalColor(99, false, 0)).toMatch(/^hsl\(/);
  });
});
