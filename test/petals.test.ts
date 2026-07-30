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

  it("makes every allele differ from round in proportion OR margin texture", () => {
    // Guards the measured failure that lobed and frilled were invisible at render scale.
    //
    // AREA ALONE IS THE WRONG METRIC, and this test used to use it. Profiles are normalised
    // by their own peak, so adding margin waviness raises the peak and shrinks mean width,
    // cancelling the change: lobed measured 134.5 against round's 135.0 — a 0.4% area delta
    // — while its perimeter was 6.5% longer. Margin texture lives in PERIMETER. The shape
    // factor (perimeter / sqrt(area)) is dimensionless and captures both.
    const metrics = (s: PetalShape): { area: number; shapeFactor: number } => {
      const pts = petalPath(spec(s));
      let a = 0;
      let per = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]!;
        const q = pts[(i + 1) % pts.length]!;
        a += p.x * q.y - q.x * p.y;
        per += Math.hypot(q.x - p.x, q.y - p.y);
      }
      a = Math.abs(a) / 2;
      return { area: a, shapeFactor: per / Math.sqrt(a) };
    };

    const base = metrics("round");
    for (const s of ["pointed", "lobed", "frilled"] as PetalShape[]) {
      const m = metrics(s);
      const dArea = Math.abs(m.area - base.area) / base.area;
      const dShape =
        Math.abs(m.shapeFactor - base.shapeFactor) / base.shapeFactor;
      // Either proportion or margin texture must move materially.
      expect(Math.max(dArea, dShape)).toBeGreaterThan(0.06);
    }

    // And lobed must differ from frilled, or shipping both alleles is pointless.
    const l = metrics("lobed");
    const f = metrics("frilled");
    const between = Math.max(
      Math.abs(l.area - f.area) / base.area,
      Math.abs(l.shapeFactor - f.shapeFactor) / base.shapeFactor,
    );
    expect(between).toBeGreaterThan(0.06);
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
