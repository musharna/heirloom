/**
 * WHEN IS A PLANT FINISHED — and what a shared garden therefore has to carry.
 *
 * The share code used to cap a plant's age at `maxTick`, on a premise written into the code,
 * the design doc and the plan: "past maxTick nothing about the plant changes". It is false, and
 * the first test below says so directly — a shoot's terminal flower is created on the tick that
 * shoot stops growing (`src/growth/sim.ts:418` and `:426`), so the last shoot standing puts a
 * flower at `maxTick` itself, and a flower needs OPEN_TICKS more before it is open. A garden
 * shared in full flower therefore arrived with its terminal flowers 32% open, permanently,
 * because a visitor's clock never advances past the age it was sent.
 *
 * GROWN from real genomes rather than hand-built Plants. A fixture assembled here would have
 * whatever bloom ticks this file chose to give it, so it could not falsify a claim about what
 * the growth model actually produces — which is the entire claim under test.
 *
 * A SPREAD of genomes, not one. `maxTick` is `40 + 60 * vigour` and tip survival varies with
 * architecture, so a single genome could be one that happens to terminate every tip early —
 * true of that plant, and evidence about nothing.
 */
import { describe, expect, it } from "vitest";
import { grow } from "../src/game/garden";
import { randomGenome, type Genome } from "../src/genome/genome";
import { OPEN_TICKS } from "../src/render/stage";
import { SETTLE_TICKS, settledTick, sharedAge } from "../src/scene";
import {
  FROZEN_CLOCK,
  MAX_AGE,
  packPostcard,
  readPostcard,
} from "../src/game/postcard";
import { mulberry32 } from "../src/rng";

const N = 12;
const rand = mulberry32(20260802);
const GENOMES: Genome[] = Array.from({ length: N }, () => randomGenome(rand));
const PLANTS = GENOMES.map((g) => grow(g, 300, 390));

describe("the premise the share code was written on", () => {
  it("is FALSE: a grown plant has flowers created AT maxTick, still closed", () => {
    // CONTROL: these are plants, not empty husks. An albino grows no blooms at all, and a
    // sample of nothing but albinos would make the claim below look false for the wrong reason.
    const withFlowers = PLANTS.filter((p) => p.plant.blooms.length > 0);
    expect(withFlowers.length).toBeGreaterThan(N / 2);

    const terminal = withFlowers.filter((p) =>
      p.plant.blooms.some((b) => b.tick >= p.maxTick),
    );
    // Not a rounding error: this is the ordinary case for a plant that finishes in flower.
    expect(terminal.length / withFlowers.length).toBeGreaterThan(0.5);
  });

  it("so the settle point has to clear a whole flower opening", () => {
    expect(SETTLE_TICKS).toBeGreaterThan(OPEN_TICKS);
    expect(settledTick(100)).toBe(100 + SETTLE_TICKS);
  });
});

describe("the age a shared garden carries", () => {
  it("is at least the settle point for a fully-grown plant", () => {
    for (const p of PLANTS)
      // A garden left open for a very long time — the case the cap exists for.
      expect(sharedAge(500_000, p.maxTick)).toBeGreaterThanOrEqual(
        p.maxTick + SETTLE_TICKS,
      );
  });

  it("still caps, so an overnight garden sends the same picture as a fresh one", () => {
    expect(sharedAge(500_000, 90)).toBe(sharedAge(1_000_000, 90));
    expect(sharedAge(10, 90)).toBe(10); // and a young plant is sent young
  });

  it("survives the codec: what is packed is what comes back", () => {
    const p = PLANTS[0]!;
    const age = sharedAge(500_000, p.maxTick);
    const r = readPostcard(
      packPostcard({
        W: 1180,
        H: 470,
        plotCount: 2,
        plots: [{ genome: p.genome, age }, null],
        forest: [],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.postcard.plots[0]?.age).toBe(age);
    expect(r.postcard.plots[0]?.age).toBeGreaterThanOrEqual(
      settledTick(p.maxTick),
    );
  });
});

/**
 * The relation that keeps a visit's `plantedAt` positive.
 *
 * Pinned because this change MOVED the largest age a postcard can carry, and the next change to
 * either number should trip over this rather than over a garden whose plants are older than the
 * world they stand in. Both ceilings asserted: the format's (a forged code claiming the full
 * u16) and the game's (a settled plant).
 */
describe("a visit's frozen clock", () => {
  it("is above every age the codec can carry", () => {
    expect(FROZEN_CLOCK).toBeGreaterThan(MAX_AGE);
  });

  it("and far above any age the game itself produces", () => {
    const worst = Math.max(...PLANTS.map((p) => settledTick(p.maxTick)));
    expect(worst).toBeGreaterThan(0); // CONTROL: the sample grew something
    expect(worst).toBeLessThan(MAX_AGE);
    expect(worst).toBeLessThan(FROZEN_CLOCK);
  });
});
