import { express } from "../genome/express";
import { inherit, mutate, randomGenome, type Genome } from "../genome/genome";
import { genomeSeed } from "../genome/serialize";
import { growPlant } from "../growth/sim";
import type { Plant } from "../types";

/**
 * A seed. Carries a genome and nothing else — deliberately.
 *
 * §4: traits are not disclosed before bloom. A seed that advertised what it would become
 * would remove the only pacing mechanism the game has, so there is no place to put that
 * information even if a later view wanted it.
 */
export type Seed = { id: number; genome: Genome };

export type Planting = {
  genome: Genome;
  plant: Plant;
  /** Garden clock reading when this was planted; growth stage is `now - plantedAt`. */
  plantedAt: number;
  /** Last tick at which anything about this plant changes. */
  maxTick: number;
};

export type Plot = { x: number; occupant: Planting | null };

export type Garden = {
  plots: Plot[];
  tray: Seed[];
  /** Genomes displaced from a plot. Milestone 4 composites these into the background. */
  retired: Genome[];
  nextSeedId: number;
};

/**
 * Tray capacity. At the cap the OLDEST seed is evicted rather than the new one refused.
 *
 * Refusing would be the obvious alternative and it is wrong for this game: §11 fixes the
 * tone as pressure-free, and a full tray that rejects a cross turns a click into a failure
 * state. Evicting silently keeps every verb always available.
 */
export const TRAY_CAP = 8;

export function createGarden(plotXs: number[]): Garden {
  return {
    plots: plotXs.map((x) => ({ x, occupant: null })),
    tray: [],
    retired: [],
    nextSeedId: 1,
  };
}

/** Grow the canonical plant for a genome at a plot. Seeded by the genome alone (§6). */
export function grow(genome: Genome, x: number, soilY: number): Planting {
  const plant = growPlant(express(genome), genomeSeed(genome), {
    x,
    y: soilY,
  });
  const maxTick = Math.max(
    0,
    ...plant.segments.map((s) => s.tick),
    ...plant.blooms.map((b) => b.tick),
    ...plant.leaves.map((l) => l.tick),
  );
  return { genome, plant, plantedAt: 0, maxTick };
}

export function addSeed(g: Garden, genome: Genome): Garden {
  const seed: Seed = { id: g.nextSeedId, genome };
  const tray = [...g.tray, seed];
  return {
    ...g,
    tray: tray.length > TRAY_CAP ? tray.slice(tray.length - TRAY_CAP) : tray,
    nextSeedId: g.nextSeedId + 1,
  };
}

export function findSeed(g: Garden, id: number): Seed | undefined {
  return g.tray.find((s) => s.id === id);
}

/**
 * CLONE — the click verb. A seed of this genome, with mutation applied.
 *
 * Mutation on a clone is not a flaw in the copy; it is the only reason cloning is
 * interesting. A perfect copy would make the verb a no-op.
 */
export function cloneOf(genome: Genome, rand: () => number): Genome {
  return mutate(genome, rand);
}

/** CROSS / SPLICE — one gamete from each parent, then mutation. */
export function crossOf(a: Genome, b: Genome, rand: () => number): Genome {
  return mutate(inherit(a, b, rand), rand);
}

/**
 * PLANT — a seed becomes a growing plant in a plot.
 *
 * Dropping onto an OCCUPIED plot retires the occupant rather than refusing. That is what
 * makes the garden a working surface instead of filling up permanently after six plants,
 * and §11 rules out the alternative pressure valve (plants dying on a timer). The displaced
 * genome goes to `retired`, which is exactly the input Milestone 4's background needs.
 */
export function plantSeed(
  g: Garden,
  seedId: number,
  plotIndex: number,
  soilY: number,
  now: number,
): Garden {
  const seed = findSeed(g, seedId);
  const plot = g.plots[plotIndex];
  if (!seed || !plot) return g;

  const planting = { ...grow(seed.genome, plot.x, soilY), plantedAt: now };
  const plots = g.plots.map((p, i) =>
    i === plotIndex ? { ...p, occupant: planting } : p,
  );
  return {
    ...g,
    plots,
    tray: g.tray.filter((s) => s.id !== seedId),
    retired: plot.occupant ? [...g.retired, plot.occupant.genome] : g.retired,
  };
}

/** SPLICE — cross two seeds without planting either. Both parents survive. */
export function spliceSeeds(
  g: Garden,
  aId: number,
  bId: number,
  rand: () => number,
): Garden {
  const a = findSeed(g, aId);
  const b = findSeed(g, bId);
  if (!a || !b || aId === bId) return g;
  return addSeed(g, crossOf(a.genome, b.genome, rand));
}

/** Has this planting finished growing? */
export function isGrown(p: Planting, now: number): boolean {
  return now - p.plantedAt >= p.maxTick;
}

/** Seed a starting garden: a few founders, the rest bare. */
export function sowFounders(
  g: Garden,
  count: number,
  soilY: number,
  rand: () => number,
): Garden {
  let out = g;
  // Fisher-Yates, not `sort(() => rand() - 0.5)`. That idiom is biased AND relies on an
  // inconsistent comparator, so the result depends on the engine's sort implementation —
  // which would quietly break the determinism the rest of this file is built on.
  const order = g.plots.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  for (const i of order.slice(0, count)) {
    const plot = out.plots[i]!;
    const planting = grow(randomGenome(rand), plot.x, soilY);
    // Stagger, so founders are at different growth stages rather than in lockstep.
    planting.plantedAt = -Math.floor(rand() * 40);
    out = {
      ...out,
      plots: out.plots.map((p, j) =>
        j === i ? { ...p, occupant: planting } : p,
      ),
    };
  }
  return out;
}
