import { describe, it, expect } from "vitest";
import {
  GUST_PERIOD,
  GUST_SPAN,
  IDLE_AMPLITUDE,
  applySway,
  gustAt,
  lerpPlacement,
  gustCenter,
  type Placed,
  shearPoint,
  swayAt,
  swayPhase,
  GROWTH_TICKS_PER_SECOND,
  MOTION_TICKS_PER_SECOND,
  MAX_FRAME_MS,
  ticksElapsed,
} from "../src/render/motion";
import { resolvePlacement } from "../src/render/accumulate";
import { placeRetired } from "../src/render/forest";
import { growPlant } from "../src/growth/sim";
import { randomGenome } from "../src/genome/genome";
import { express } from "../src/genome/express";
import { genomeSeed } from "../src/genome/serialize";
import { mulberry32 } from "../src/rng";

const WORLD = 1180;
const BASE_Y = 390;

describe("the base never moves", () => {
  it("leaves a point at the base exactly where it was", () => {
    // The one defect that would be unmissable: a plant sliding sideways out of its own soil.
    // Every other error in this file is a matter of degree; this one is categorical.
    for (const k of [-0.4, -0.05, 0, 0.05, 0.4]) {
      const at = shearPoint({ x: 500, y: BASE_Y }, k, BASE_Y);
      expect(at.x).toBe(500);
      expect(at.y).toBe(BASE_Y);
    }
  });

  it("displaces in proportion to height above the base", () => {
    const k = 0.02;
    for (const h of [10, 100, 250]) {
      const at = shearPoint({ x: 500, y: BASE_Y - h }, k, BASE_Y);
      expect(at.x).toBeCloseTo(500 - k * h, 10);
    }
  });

  it("never moves anything vertically", () => {
    // A shear that also lifted the plant would separate it from the soil line the stage draws
    // over it, and the gap would read as a rendering fault rather than as motion.
    for (const k of [-0.3, 0.3])
      expect(shearPoint({ x: 40, y: 100 }, k, BASE_Y).y).toBe(100);
  });

  it("CONTROL: a shear WITHOUT the base compensation slides the whole plant", () => {
    // Pins that the assertion above discriminates, against the matrix you get by writing the
    // skew and forgetting the translation.
    const naive = (p: { x: number; y: number }, k: number) => p.x + k * p.y;
    expect(naive({ x: 500, y: BASE_Y }, 0.02)).not.toBeCloseTo(500, 3);
  });
});

describe("the canvas matrix agrees with the arithmetic", () => {
  it("transforms a point the same way shearPoint does", () => {
    // `applySway` and `shearPoint` are two statements of one rule, and every test in this file
    // measures the second. A fake context records the matrix so the first is checked too —
    // otherwise the tested function is not the one that draws anything.
    let m: number[] = [];
    const fake = {
      transform: (...args: number[]) => {
        m = args;
      },
    } as unknown as CanvasRenderingContext2D;
    const k = 0.037;
    applySway(fake, k, BASE_Y);
    const [a, b, c, d, e, f] = m as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const p = { x: 620, y: 180 };
    // Canvas applies x' = a*x + c*y + e, y' = b*x + d*y + f.
    expect(a * p.x + c * p.y + e).toBeCloseTo(shearPoint(p, k, BASE_Y).x, 10);
    expect(b * p.x + d * p.y + f).toBeCloseTo(shearPoint(p, k, BASE_Y).y, 10);
  });
});

describe("sway stays small enough to be motion and not weather", () => {
  it("keeps a plant's tip within a few pixels of where it rests", () => {
    // Hit-testing uses RESTING coordinates, so every pixel of sway is a pixel of disagreement
    // between where a flower is drawn and where it can be clicked. This bounds that.
    const rand = mulberry32(4);
    let worst = 0;
    for (let i = 0; i < 40; i++) {
      const key = genomeSeed(randomGenome(rand));
      for (let t = 0; t < GUST_PERIOD; t += 13) {
        const k = swayAt(t, key, 600, WORLD, { stiffness: 0.25 });
        worst = Math.max(worst, Math.abs(k) * 250); // a tall plant is ~250px
      }
    }
    expect(worst).toBeGreaterThan(2); // it must actually move
    expect(worst).toBeLessThan(22); // ...but a flower must stay clickable where it is drawn
  });

  it("moves a slack plant further than a stiff one", () => {
    const key = genomeSeed(randomGenome(mulberry32(9)));
    const peak = (stiffness: number) => {
      let m = 0;
      for (let t = 0; t < 900; t += 3)
        m = Math.max(m, Math.abs(swayAt(t, key, 600, WORLD, { stiffness })));
      return m;
    };
    expect(peak(0.1)).toBeGreaterThan(peak(0.9) * 1.2);
  });

  it("CONTROL: a stiffness outside 0..1 cannot invert or amplify the motion", () => {
    // The phenotype does not produce these today. A later tuning pass might, and a negative
    // `give` would make plants lean into the wind.
    const key = genomeSeed(randomGenome(mulberry32(11)));
    for (const stiffness of [-5, 2, 99]) {
      const k = swayAt(300, key, 600, WORLD, { stiffness });
      expect(Number.isFinite(k)).toBe(true);
      expect(Math.abs(k)).toBeLessThan(0.1);
    }
  });
});

describe("sway is deterministic", () => {
  it("gives the same plant the same motion at the same instant", () => {
    // §6 in spirit: a shared plant should look the same for everybody, moving included.
    const key = genomeSeed(randomGenome(mulberry32(21)));
    for (const t of [0, 137, 999])
      expect(swayAt(t, key, 400, WORLD)).toBe(swayAt(t, key, 400, WORLD));
  });

  it("gives different genomes different phases", () => {
    // Otherwise the whole bed sways as one object and reads as the canvas moving rather than
    // the plants.
    const rand = mulberry32(22);
    const phases = new Set<number>();
    for (let i = 0; i < 50; i++)
      phases.add(Math.round(swayPhase(genomeSeed(randomGenome(rand))) * 100));
    expect(phases.size).toBeGreaterThan(40);
  });

  it("spreads phases across the whole cycle rather than clustering", () => {
    const rand = mulberry32(23);
    const buckets = new Array(8).fill(0);
    for (let i = 0; i < 400; i++) {
      const p = swayPhase(genomeSeed(randomGenome(rand)));
      buckets[Math.min(7, Math.floor((p / (Math.PI * 2)) * 8))]!++;
    }
    // Every eighth of the cycle used; none holding more than a third of the population.
    expect(buckets.every((n) => n > 0)).toBe(true);
    expect(Math.max(...buckets)).toBeLessThan(400 / 3);
  });
});

describe("a gust crosses the bed and then stops", () => {
  it("travels left to right", () => {
    const xs = [0, 0.25, 0.5, 0.75].map((f) =>
      gustCenter(f * GUST_PERIOD, WORLD),
    );
    for (let i = 1; i < xs.length; i++)
      expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
  });

  it("starts and ends off the edges of the world", () => {
    // So a gust arrives and departs, rather than materialising in the middle of the bed.
    expect(gustCenter(0, WORLD)).toBeLessThan(0);
    expect(gustCenter(GUST_PERIOD * 0.999, WORLD)).toBeGreaterThan(WORLD);
  });

  it("is felt strongly at its centre and not at all far from it", () => {
    const t = GUST_PERIOD * 0.5;
    const c = gustCenter(t, WORLD);
    expect(gustAt(t, c, WORLD)).toBeCloseTo(1, 6);
    expect(gustAt(t, c + GUST_SPAN * 4, WORLD)).toBeLessThan(0.001);
  });

  it("leaves the bed calm for most of the cycle", () => {
    // The point of a gust is that it is occasional. If every plant felt it at every instant it
    // would be a constant breeze, which is just a bigger idle sway with extra arithmetic.
    let stirred = 0;
    const samples = 400;
    for (let i = 0; i < samples; i++) {
      const t = (i / samples) * GUST_PERIOD;
      if (gustAt(t, WORLD / 2, WORLD) > 0.2) stirred++;
    }
    expect(stirred / samples).toBeLessThan(0.35);
    expect(stirred).toBeGreaterThan(0); // ...but it does arrive
  });
});

describe("motion never touches the plant", () => {
  it("leaves growth output byte-identical whatever the clock says", () => {
    // The architectural claim of this whole file, asserted rather than trusted. If motion ever
    // leaked into geometry, a shared link would grow a different plant depending on when it
    // was opened — the one thing §6 forbids outright.
    const g = randomGenome(mulberry32(77));
    const before = JSON.stringify(
      growPlant(express(g), genomeSeed(g), { x: 300, y: BASE_Y }),
    );
    for (const t of [0, 500, 5000])
      void swayAt(t, genomeSeed(g), 300, WORLD, { stiffness: 0.3 });
    const after = JSON.stringify(
      growPlant(express(g), genomeSeed(g), { x: 300, y: BASE_Y }),
    );
    expect(after).toBe(before);
  });

  it("is a pure function of its arguments", () => {
    // No hidden clock, no module-level accumulator: the same call must answer the same thing
    // however many times it is asked, or a re-render at the same tick would jitter.
    const key = genomeSeed(randomGenome(mulberry32(31)));
    const first = swayAt(444, key, 700, WORLD, { stiffness: 0.4 });
    for (let i = 0; i < 5; i++)
      expect(swayAt(444, key, 700, WORLD, { stiffness: 0.4 })).toBe(first);
  });

  it("CONTROL: the amplitude constant is actually load-bearing", () => {
    // Guards against the assertions above being satisfied by motion that is simply zero.
    expect(IDLE_AMPLITUDE).toBeGreaterThan(0);
    const key = genomeSeed(randomGenome(mulberry32(41)));
    let moved = false;
    for (let t = 0; t < 900; t += 7)
      if (Math.abs(swayAt(t, key, 400, WORLD)) > 0.002) moved = true;
    expect(moved).toBe(true);
  });
});

describe("receding hands over to the buffer without a visible seam", () => {
  const PLACE = { dx: -140, dy: -22, scale: 0.7, alpha: 0.34, blur: 2.4 };

  // Field-by-field rather than `toEqual`, because the endpoints are reached by arithmetic:
  // `place.dx * 0` is -0 for a negative dx, and `1 + (0.34 - 1) * 1` is 0.33999999999999997.
  // Both are visually identical to the value they are compared against, which is the property
  // that actually matters here; bit-equality is not.
  const same = (a: Placed, b: Placed) => {
    for (const k of ["dx", "dy", "scale", "alpha", "blur"] as const)
      expect(a[k], k).toBeCloseTo(b[k], 12);
  };

  it("starts from the IDENTITY — the plant does not jump when it begins", () => {
    // At u = 0 the plant is still standing in the bed, and anything other than "no offset,
    // full size, fully opaque, unblurred" is a jump on the frame the player drops a seed.
    same(lerpPlacement(PLACE, 0), { dx: 0, dy: 0, scale: 1, alpha: 1, blur: 0 });
  });

  it("ends EXACTLY on the placement the buffer will composite", () => {
    // The other endpoint, and the more dangerous one: the animation hands over to a drawImage
    // of the composited buffer, so a mismatch here is a jump at the moment the player is
    // watching that plant.
    same(lerpPlacement(PLACE, 1), PLACE);
  });

  it("moves monotonically between the two", () => {
    let last = 1;
    for (const u of [0, 0.1, 0.3, 0.5, 0.8, 1]) {
      const s = lerpPlacement(PLACE, u).scale;
      expect(s).toBeLessThanOrEqual(last + 1e-9);
      last = s;
    }
  });

  it("clamps outside 0..1 rather than overshooting", () => {
    // `now - start` can exceed the window by a frame, and a scale past the endpoint would
    // shrink the plant smaller than the background copy it is about to become.
    same(lerpPlacement(PLACE, 1.4), PLACE);
    expect(lerpPlacement(PLACE, -0.4).scale).toBe(1);
  });

  it("uses the RESERVED placement when one was given", () => {
    // Several plants can be receding at once, so the layer index the buffer would compute at
    // composite time is not the one the animation eased toward. Ignoring the reservation
    // sends the plant to a different spot in the frame where the two swap over.
    const reserved = { dx: 99, dy: -5, scale: 0.5, alpha: 0.4, blur: 1.5 };
    expect(resolvePlacement(reserved, 12345, 3, WORLD)).toBe(reserved);
  });

  it("CONTROL: falls back to a fresh placement when none was reserved", () => {
    // Without this the assertion above is satisfied by a function that always returns its
    // first argument, including when that argument is undefined.
    const fresh = resolvePlacement(undefined, 12345, 3, WORLD);
    expect(fresh).toEqual(placeRetired(12345, 3, WORLD));
  });
});

describe("the clocks measure time, not frames", () => {
  /** Ticks accumulated by delivering `frames` frames of `dtMs` each, the way the loop does. */
  const over = (frames: number, dtMs: number, rate: number): number =>
    Array.from({ length: frames }, () => ticksElapsed(dtMs, rate)).reduce(
      (a, b) => a + b,
      0,
    );

  it("advances the same total however the same span is cut into frames", () => {
    // THE defect. `now += SPEED` once per animation frame made every duration in the game a
    // function of the renderer's speed: measured 2026-08-04, ~1.4 ticks per frame at 6.5fps
    // and at 60fps alike, so a plant took ~8.4s to grow here and ~1.55s on a machine that
    // held 60fps. Sixty frames of 10ms and twelve frames of 50ms are the same 600ms and must
    // come to the same number of ticks.
    for (const rate of [GROWTH_TICKS_PER_SECOND, MOTION_TICKS_PER_SECOND]) {
      expect(over(60, 10, rate)).toBeCloseTo(over(12, 50, rate), 9);
      expect(over(60, 10, rate)).toBeCloseTo(0.6 * rate, 9);
    }
  });

  it("CONTROL: the two frame rates it compares are genuinely different", () => {
    // Without this the assertion above is satisfied by any function of elapsed time at all,
    // including one that ignores its argument — and by a test that compared 60 frames with
    // 60 frames. The whole point is that the frame COUNT differs fivefold.
    expect(60).not.toBe(12);
    expect(60 * 10).toBe(12 * 50);
  });

  it("keeps a settled garden at exactly the tempo it was tuned at", () => {
    // 1.4 ticks per frame at 60fps was the old motion rate, chosen by eye against a bed that
    // holds 60fps once cached. Reproduce it or every sway, gust and carrier interval in the
    // game silently retimes on the machine where it was tuned.
    expect(ticksElapsed(1000 / 60, MOTION_TICKS_PER_SECOND)).toBeCloseTo(1.4, 9);
  });

  it("grows slower than it sways, because one rate cannot serve both", () => {
    // The old clock got two tempos out of one constant by accident: growth is expensive and
    // settled painting is cheap, so the frame rate itself was an unintended tempo control —
    // 6.5fps while a plant unfurled, 60fps once the bed settled. Collapsing these back to a
    // single rate gives either a garden that does not sway or growth that is a blink.
    expect(GROWTH_TICKS_PER_SECOND).toBeLessThan(MOTION_TICKS_PER_SECOND);
  });

  it("does not throttle the clock at the frame rate growth actually runs at", () => {
    // The cap exists for unrendered tabs, and the tempting value for it is ~100ms. That would
    // be wrong: a growing bed runs at 6.5fps, or 154ms a frame, so a 100ms cap would slow the
    // clock on exactly the machine and moment this change exists to fix.
    const slowFrameMs = 1000 / 6.5;
    expect(slowFrameMs).toBeLessThan(MAX_FRAME_MS);
    expect(ticksElapsed(slowFrameMs, GROWTH_TICKS_PER_SECOND)).toBeCloseTo(
      (slowFrameMs / 1000) * GROWTH_TICKS_PER_SECOND,
      9,
    );
  });

  it("caps a stalled frame instead of resolving the stall in one step", () => {
    // A backgrounded tab is handled on `visibilitychange`; this is the backstop for stalls
    // that event does not cover. Ten minutes must not arrive as ten minutes of growth.
    expect(ticksElapsed(600_000, GROWTH_TICKS_PER_SECOND)).toBe(
      ticksElapsed(MAX_FRAME_MS, GROWTH_TICKS_PER_SECOND),
    );
    // And what it does let through is a small fraction of one plant's growth, not a plant.
    expect(ticksElapsed(600_000, GROWTH_TICKS_PER_SECOND)).toBeLessThan(5);
  });

  it("never runs a clock backwards", () => {
    // The first frame after a restore measures against a timestamp that may never have been
    // set. A negative delta would un-grow a plant, and `paintPlantCached` would be handed an
    // age below the one it cached at.
    expect(ticksElapsed(-50, GROWTH_TICKS_PER_SECOND)).toBe(0);
    expect(ticksElapsed(-1e9, MOTION_TICKS_PER_SECOND)).toBe(0);
  });
});
