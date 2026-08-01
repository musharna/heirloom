import { express } from "../genome/express";
import { inherit, mutate, randomGenome, type Genome } from "../genome/genome";
import { genomeSeed, serialize } from "../genome/serialize";
import { growPlant } from "../growth/sim";
import type { Plant } from "../types";

/**
 * How a seed came to exist.
 *
 * Carried separately from the parents because a CLONE and a SELF-CROSS both record the same
 * plant twice, and they are not the same event at all: a clone is genetically its parent and
 * can never reveal what that parent is hiding, while a self-cross is the one move that
 * reliably does. A card that could not tell them apart would leave the player unable to learn
 * the single most useful thing about the four verbs.
 *
 * `archive` is a plant restored from the drawer. Distinct from `clone` because cloning
 * MUTATES — a cloned entry would hand back a different flower than the one the player picked
 * out of the drawer, which is the one thing a drawer must not do. Distinct from `founder`
 * because that asserts a plant with no history, and this one has plenty; it simply is not a
 * NEW observation, so it carries no parents and never reaches the notebook.
 */
export type Origin = "founder" | "clone" | "self" | "cross" | "archive";

/**
 * A seed. Carries a genome and its PROVENANCE — never its traits.
 *
 * §4: traits are not disclosed before bloom, and that still holds. Parentage is not a trait:
 * it is what the player just did, and they already watched themselves do it. Recording it here
 * is what lets the notebook say "this came from a white × coral cross" once the plant is up,
 * and what lets a seedling's outcome count as evidence about its parents.
 *
 * The tray still shows none of it. A seed that advertised its parents would let the player
 * infer the child before planting it, which is the same disclosure §4 forbids by a longer
 * route.
 */
export type Seed = {
  id: number;
  genome: Genome;
  /** Serialized parents. Absent for a founder, which has none. */
  parents?: [string, string];
  origin?: Origin;
};

/** Where a seed came from, threaded from the verb that made it to the card that shows it. */
export type Provenance = { parents: [string, string]; origin: Origin };

export type Planting = {
  genome: Genome;
  plant: Plant;
  /** Garden clock reading when this was planted; growth stage is `now - plantedAt`. */
  plantedAt: number;
  /** Last tick at which anything about this plant changes. */
  maxTick: number;
  /** The seed this grew from, so one observation cannot be counted twice. */
  seedId?: number;
  /** Serialized parents, carried over from the seed. */
  parents?: [string, string];
  origin?: Origin;
};

export type Plot = { x: number; occupant: Planting | null };

export type Garden = {
  plots: Plot[];
  tray: Seed[];
  /**
   * Plantings displaced from a plot and NOT YET composited into the background.
   *
   * The whole planting, not just the genome: the background composites PIXELS, and a genome
   * would have to be re-expressed and re-grown to produce any. Keeping the grown plant makes
   * retirement a move rather than a rebuild.
   *
   * A QUEUE, drained every frame — not a history. It used to be the latter, and that made it
   * an unbounded array of the heaviest objects in the game: a retired plant holds its stems,
   * its several hundred flowers and every petal of each, and since the render cache is keyed on
   * the plant object, holding the plant also pinned an offscreen canvas of it. A few hundred
   * replacements — a long afternoon — would have been hundreds of megabytes that nothing could
   * ever read again. The history that IS still needed is the replay list, which holds genome
   * strings and is capped.
   */
  retired: Planting[];
  /** How many plants have EVER been displaced. The queue above is emptied; this is not. */
  retiredTotal: number;
  nextSeedId: number;
};

/**
 * Tray capacity. At the cap the OLDEST seed is evicted rather than the new one refused.
 *
 * Refusing would be the obvious alternative and it is wrong for this game: §11 fixes the
 * tone as pressure-free, and a full tray that rejects a cross turns a click into a failure
 * state. Evicting silently keeps every verb always available.
 *
 * Twelve rather than eight because the RATIO is what matters. 8 seeds against 6 plots and 12
 * against 9 are both 1.3 seeds per plot — but with nine plots the tray also drains faster, so
 * the same ratio buys more slack in practice. Raised after a play-through reported crosses
 * piling up faster than they could be planted.
 */
export const TRAY_CAP = 12;

export function createGarden(plotXs: number[]): Garden {
  return {
    plots: plotXs.map((x) => ({ x, occupant: null })),
    tray: [],
    retired: [],
    retiredTotal: 0,
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

/**
 * Put a seed in the tray.
 *
 * `from.parents` is OPTIONAL rather than required, so an `archive` restore can declare where it
 * came from without claiming a cross that never happened. One code path rather than a separate
 * `addArchiveSeed`, which would duplicate the eviction rule above and let the two drift.
 */
export function addSeed(
  g: Garden,
  genome: Genome,
  from?: { parents?: [string, string]; origin: Origin },
): Garden {
  const seed: Seed = {
    id: g.nextSeedId,
    genome,
    // Keys OMITTED when absent, not set to undefined: `parents: undefined` is a key that
    // survives an object spread and reads as "this was considered and is empty" rather than
    // "this never applied".
    ...(from?.parents ? { parents: from.parents } : {}),
    ...(from ? { origin: from.origin } : {}),
  };
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

  const planting: Planting = {
    ...grow(seed.genome, plot.x, soilY),
    plantedAt: now,
    seedId: seed.id,
    ...(seed.parents ? { parents: seed.parents } : {}),
    ...(seed.origin ? { origin: seed.origin } : {}),
  };
  const plots = g.plots.map((p, i) =>
    i === plotIndex ? { ...p, occupant: planting } : p,
  );
  return {
    ...g,
    plots,
    tray: g.tray.filter((s) => s.id !== seedId),
    retired: plot.occupant ? [...g.retired, plot.occupant] : g.retired,
    retiredTotal: g.retiredTotal + (plot.occupant ? 1 : 0),
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
  return addSeed(g, crossOf(a.genome, b.genome, rand), {
    parents: [serialize(a.genome), serialize(b.genome)],
    origin: "cross",
  });
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
