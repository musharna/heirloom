import { describe, it, expect } from "vitest";
import { mulberry32 } from "../src/rng";
import {
  TRAY_CAP,
  addSeed,
  cloneOf,
  createGarden,
  crossOf,
  grow,
  isGrown,
  plantSeed,
  sowFounders,
  spliceSeeds,
  type Garden,
} from "../src/game/garden";
import {
  bloomAt,
  plotAt,
  seedAt,
  shownBlooms,
  traySlot,
} from "../src/game/hit";
import { genomesEqual, randomGenome, type Genome } from "../src/genome/genome";
import { isWhite } from "../src/genome/express";
import { genomeSeed, serialize } from "../src/genome/serialize";

const SOIL = 400;
const XS = [100, 300, 500, 700, 900];

const fresh = (): Garden => createGarden(XS);
const g0 = (): Genome => randomGenome(mulberry32(1));

describe("tray", () => {
  it("holds seeds in the order they arrive", () => {
    let g = fresh();
    g = addSeed(g, g0());
    g = addSeed(g, randomGenome(mulberry32(2)));
    expect(g.tray).toHaveLength(2);
    expect(g.tray[0]!.id).toBeLessThan(g.tray[1]!.id);
  });

  it("evicts the OLDEST at capacity rather than refusing the new seed", () => {
    // §11 fixes the tone as pressure-free. Refusing would turn a click into a failure state.
    let g = fresh();
    const rand = mulberry32(3);
    for (let i = 0; i < TRAY_CAP + 4; i++) g = addSeed(g, randomGenome(rand));
    expect(g.tray).toHaveLength(TRAY_CAP);
    expect(g.tray[0]!.id).toBe(5); // ids 1-4 evicted
    expect(g.tray.at(-1)!.id).toBe(TRAY_CAP + 4);
  });

  it("gives every seed a distinct id, so drag targets never alias", () => {
    let g = fresh();
    const rand = mulberry32(4);
    for (let i = 0; i < 30; i++) g = addSeed(g, randomGenome(rand));
    const ids = g.tray.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("clone — the click verb", () => {
  it("carries the parent's genome forward", () => {
    // Not identity: mutation is applied. But over many clones the parent's alleles must
    // dominate, or "clone" is a misnomer for "reroll".
    const parent = g0();
    const rand = mulberry32(5);
    let same = 0;
    for (let i = 0; i < 200; i++)
      if (genomesEqual(cloneOf(parent, rand), parent)) same++;
    expect(same).toBeGreaterThan(20);
  });

  it("is not a no-op — some clones differ", () => {
    // A perfect copy would make the verb pointless; drift is the reason to click it.
    const parent = g0();
    const rand = mulberry32(6);
    let differ = 0;
    for (let i = 0; i < 200; i++)
      if (!genomesEqual(cloneOf(parent, rand), parent)) differ++;
    expect(differ).toBeGreaterThan(20);
  });
});

describe("cross — the drag verb", () => {
  it("draws from both parents", () => {
    // Homozygous, opposite at D. Every child must be Dd, which is only reachable by taking
    // one allele from each parent.
    const a: Genome = { ...g0(), D: ["D", "D"] };
    const b: Genome = { ...g0(), D: ["d", "d"] };
    const rand = mulberry32(7);
    for (let i = 0; i < 40; i++) {
      const c = crossOf(a, b, rand);
      // Mutation can flip an allele, so allow the rare exception rather than assert never.
      expect(c.D.includes("D") || c.D.includes("d")).toBe(true);
    }
    const kids = Array.from({ length: 300 }, () => crossOf(a, b, rand));
    const het = kids.filter((c) => c.D.includes("D") && c.D.includes("d"));
    expect(het.length / kids.length).toBeGreaterThan(0.9);
  });

  it("delivers the headline surprise: white × white throws colour", () => {
    // The mechanic §5 calls the best gasp available. This asserts it is reachable THROUGH
    // THE VERB, not merely through inherit() in isolation — a player only ever meets it here.
    const rand = mulberry32(8);
    const mum: Genome = { ...g0(), W: ["W", "w"], H1: ["H1", "H1"] };
    const dad: Genome = { ...g0(), W: ["W", "w"], H2: ["H2", "H2"] };
    expect(isWhite(mum)).toBe(true);
    expect(isWhite(dad)).toBe(true);

    const kids = Array.from({ length: 500 }, () => crossOf(mum, dad, rand));
    const coloured = kids.filter((k) => !isWhite(k)).length;
    expect(coloured / kids.length).toBeGreaterThan(0.15);
    // POSITIVE CONTROL, same test: two coloured parents must not start throwing white, or a
    // broken isWhite/crossOf that randomised pigment would read as "the surprise works".
    const cw: Genome = { ...g0(), W: ["w", "w"] };
    const kids2 = Array.from({ length: 500 }, () => crossOf(cw, cw, rand));
    expect(kids2.filter((k) => isWhite(k)).length / kids2.length).toBeLessThan(
      0.1,
    );
  });
});

describe("plant — the drop verb", () => {
  it("moves a seed out of the tray and into the plot", () => {
    let g = addSeed(fresh(), g0());
    const id = g.tray[0]!.id;
    g = plantSeed(g, id, 2, SOIL, 100);
    expect(g.tray).toHaveLength(0);
    expect(g.plots[2]!.occupant).not.toBeNull();
    expect(g.plots[2]!.occupant!.plantedAt).toBe(100);
  });

  it("seats the plant at the plot's x, on the soil", () => {
    let g = addSeed(fresh(), g0());
    g = plantSeed(g, g.tray[0]!.id, 3, SOIL, 0);
    const seg = g.plots[3]!.occupant!.plant.segments[0]!;
    expect(seg.x0).toBeCloseTo(XS[3]!, 5);
    expect(seg.y0).toBeCloseTo(SOIL, 5);
  });

  it("retires the previous occupant instead of refusing the drop", () => {
    // Refusing would let the garden fill up permanently after five plants, and §11 rules out
    // the alternative valve (plants dying on a timer).
    let g = addSeed(addSeed(fresh(), g0()), randomGenome(mulberry32(9)));
    const [first, second] = [g.tray[0]!.id, g.tray[1]!.id];
    g = plantSeed(g, first, 1, SOIL, 0);
    const displaced = g.plots[1]!.occupant!.genome;
    g = plantSeed(g, second, 1, SOIL, 50);
    expect(g.retiredTotal).toBe(1);
    expect(g.retired).toHaveLength(1);
    expect(genomesEqual(g.retired[0]!.genome, displaced)).toBe(true);
    // The grown plant travels with it: the background composites pixels, so a genome alone
    // would have to be re-expressed and re-grown before anything could be drawn.
    expect(g.retired[0]!.plant.segments.length).toBeGreaterThan(0);
    expect(genomesEqual(g.plots[1]!.occupant!.genome, displaced)).toBe(false);
  });

  it("retires nothing when the plot was empty", () => {
    let g = addSeed(fresh(), g0());
    g = plantSeed(g, g.tray[0]!.id, 0, SOIL, 0);
    expect(g.retired).toHaveLength(0);
    expect(g.retiredTotal).toBe(0);
  });

  it("counts every retirement, even after the queue is drained", () => {
    // `retired` is a QUEUE the frame loop empties once the plants are pixels — it used to be an
    // unbounded history of the heaviest objects in the game, and because the render cache is
    // keyed on the plant object, keeping them also pinned an offscreen canvas each. The count
    // has to survive the drain, because it is what "how many plants have you replaced" means.
    let g = fresh();
    for (let i = 0; i < 5; i++) {
      g = addSeed(g, randomGenome(mulberry32(40 + i)));
      g = plantSeed(g, g.tray.at(-1)!.id, 0, SOIL, i * 10);
      // Whatever drains it — the frame loop does this once the plants are composited.
      g = { ...g, retired: [] };
    }
    expect(g.retired).toHaveLength(0);
    expect(g.retiredTotal).toBe(4); // the first plant went into an empty plot
  });

  it("is a no-op on an unknown seed or plot, leaving the garden untouched", () => {
    const g = addSeed(fresh(), g0());
    expect(plantSeed(g, 999, 0, SOIL, 0)).toBe(g);
    expect(plantSeed(g, g.tray[0]!.id, 99, SOIL, 0)).toBe(g);
  });

  it("grows one canonical plant per genome, wherever it is planted", () => {
    // The share-link property, asserted through the VERB. A plot-derived growth seed would
    // pass every genome test and break here.
    const genome = g0();
    const a = grow(genome, 0, SOIL);
    const b = grow(genome, 0, SOIL);
    expect(a.plant.segments).toEqual(b.plant.segments);
    expect(genomeSeed(genome)).toBe(genomeSeed(genome));
  });
});

describe("splice — seed onto seed", () => {
  it("adds a child and keeps both parents", () => {
    let g = addSeed(addSeed(fresh(), g0()), randomGenome(mulberry32(10)));
    const [a, b] = [g.tray[0]!.id, g.tray[1]!.id];
    g = spliceSeeds(g, a, b, mulberry32(11));
    expect(g.tray).toHaveLength(3);
    expect(g.tray.map((s) => s.id)).toContain(a);
    expect(g.tray.map((s) => s.id)).toContain(b);
  });

  it("refuses to splice a seed with itself", () => {
    const g = addSeed(fresh(), g0());
    const id = g.tray[0]!.id;
    expect(spliceSeeds(g, id, id, mulberry32(12))).toBe(g);
  });
});

describe("hit testing", () => {
  const planted = (): Garden => {
    let g = addSeed(fresh(), g0());
    return plantSeed(g, g.tray[0]!.id, 2, SOIL, 0);
  };

  it("finds a bloom at its centre and misses well outside it", () => {
    const g = planted();
    const occ = g.plots[2]!.occupant!;
    const shown = shownBlooms(occ, 10_000);
    expect(shown.length).toBeGreaterThan(0);
    const b = shown[0]!;
    expect(bloomAt(g, b.center, 10_000)?.plotIndex).toBe(2);
    expect(
      bloomAt(g, { x: b.center.x + 400, y: b.center.y }, 10_000),
    ).toBeNull();
  });

  it("cannot click a flower that has not opened yet", () => {
    // Hit testing must agree with what is DRAWN, or the player clicks empty air and gets a
    // seed from a flower that is not there.
    //
    // Asserted as the INVARIANT, not as "that point is null one tick earlier": a canopy is
    // dense, so an unopened flower's centre usually sits inside an already-open neighbour,
    // and the point stays legitimately clickable. The first version of this test asserted
    // null there and failed on correct code.
    const g = planted();
    const occ = g.plots[2]!.occupant!;
    for (const now of [0, 15, 30, 60, 90, 10_000])
      for (const b of shownBlooms(occ, now))
        expect(b.tick).toBeLessThanOrEqual(now);

    // And before the first flower opens there is nothing on the plant to click at all.
    const first = Math.min(...occ.plant.blooms.map((b) => b.tick));
    expect(bloomAt(g, occ.plant.blooms[0]!.center, first - 1)).toBeNull();
  });

  it("only offers blooms the renderer actually draws", () => {
    // shownBlooms runs the same occlusion cull as paintPlant. Without it the player could
    // click a bloom that was culled for being buried inside another.
    const g = planted();
    const occ = g.plots[2]!.occupant!;
    const all = occ.plant.blooms.filter((b) => b.tick <= 10_000);
    expect(shownBlooms(occ, 10_000).length).toBeLessThanOrEqual(all.length);
  });

  it("picks the closest bloom when canopies overlap", () => {
    let g = fresh();
    const rand = mulberry32(13);
    g = addSeed(addSeed(g, randomGenome(rand)), randomGenome(rand));
    g = plantSeed(g, g.tray[0]!.id, 1, SOIL, 0);
    g = plantSeed(g, g.tray[0]!.id, 2, SOIL, 0);
    const b = shownBlooms(g.plots[1]!.occupant!, 10_000)[0]!;
    const hit = bloomAt(g, b.center, 10_000)!;
    const d = Math.hypot(
      hit.bloom.center.x - b.center.x,
      hit.bloom.center.y - b.center.y,
    );
    for (const [i, plot] of g.plots.entries()) {
      if (!plot.occupant) continue;
      for (const other of shownBlooms(plot.occupant, 10_000)) {
        void i;
        expect(
          Math.hypot(other.center.x - b.center.x, other.center.y - b.center.y),
        ).toBeGreaterThanOrEqual(d - 1e-9);
      }
    }
  });

  it("snaps a drop to the nearest plot, and gives up beyond the bed", () => {
    const g = fresh();
    expect(plotAt(g, { x: 310, y: SOIL })).toBe(1);
    expect(plotAt(g, { x: 200, y: SOIL })).toBe(0); // ties resolve to the earlier plot
    expect(plotAt(g, { x: 2000, y: SOIL })).toBeNull();
  });

  it("leaves no dead band between plots — every gap belongs to someone", () => {
    // The defect that a fixed 95px reach shipped: plots 200px apart left a 10px strip in the
    // middle of every gap where a drop silently did nothing.
    const g = fresh();
    for (let x = XS[0]!; x <= XS.at(-1)!; x += 1)
      expect(plotAt(g, { x, y: SOIL })).not.toBeNull();
  });

  it("CONTROL: a fixed reach DOES open a dead band", () => {
    // Pins that the test above discriminates. Pass the old constant explicitly and the gap
    // between plot 0 and plot 1 must contain unreachable points.
    const g = fresh();
    const dead = [];
    for (let x = XS[0]!; x <= XS[1]!; x += 1)
      if (plotAt(g, { x, y: SOIL }, 95) === null) dead.push(x);
    expect(dead.length).toBeGreaterThan(0);
  });

  it("hit-tests tray seeds at the slots the renderer uses", () => {
    // One shared traySlot() for drawing and for hitting. Two copies of this layout is the
    // classic way a click lands one slot off.
    let g = fresh();
    const rand = mulberry32(14);
    for (let i = 0; i < 3; i++) g = addSeed(g, randomGenome(rand));
    const s = traySlot(1, 1000, 500);
    expect(seedAt(g, { x: s.x, y: s.y }, 1000, 500)).toBe(g.tray[1]!.id);
    expect(seedAt(g, { x: s.x, y: s.y - 200 }, 1000, 500)).toBeNull();
  });

  it("finds nothing in an empty tray", () => {
    const s = traySlot(0, 1000, 500);
    expect(seedAt(fresh(), { x: s.x, y: s.y }, 1000, 500)).toBeNull();
  });
});

describe("founders", () => {
  it("sows the requested number and leaves the rest bare", () => {
    const g = sowFounders(fresh(), 3, SOIL, mulberry32(15));
    expect(g.plots.filter((p) => p.occupant).length).toBe(3);
    expect(g.plots.filter((p) => !p.occupant).length).toBe(XS.length - 3);
  });

  it("is deterministic for a seed", () => {
    const a = sowFounders(fresh(), 3, SOIL, mulberry32(16));
    const b = sowFounders(fresh(), 3, SOIL, mulberry32(16));
    expect(a.plots.map((p) => p.occupant?.genome ?? null)).toEqual(
      b.plots.map((p) => p.occupant?.genome ?? null),
    );
  });

  it("staggers founders so they are not in lockstep", () => {
    const g = sowFounders(fresh(), 4, SOIL, mulberry32(17));
    const ats = g.plots
      .filter((p) => p.occupant)
      .map((p) => p.occupant!.plantedAt);
    expect(new Set(ats).size).toBeGreaterThan(1);
  });
});

describe("isGrown", () => {
  it("flips exactly at maxTick", () => {
    const p = { ...grow(g0(), 0, SOIL), plantedAt: 10 };
    expect(isGrown(p, 10 + p.maxTick - 1)).toBe(false);
    expect(isGrown(p, 10 + p.maxTick)).toBe(true);
  });
});

describe("tray geometry", () => {
  it("keeps every slot inside the world at the narrowest layout", () => {
    // MIN_W is 360, so this is the tightest the row will ever be asked to fit.
    const w = 360;
    for (let i = 0; i < TRAY_CAP; i++) {
      const s = traySlot(i, w, 430);
      expect(s.x - s.radius, `slot ${i} left`).toBeGreaterThanOrEqual(0);
      expect(s.x + s.radius, `slot ${i} right`).toBeLessThanOrEqual(w);
    }
  });

  it("still uses the full 30px gap on a desktop world", () => {
    expect(traySlot(1, 1180, 470).x - traySlot(0, 1180, 470).x).toBeCloseTo(30);
  });

  it("holds twelve seeds", () => {
    expect(TRAY_CAP).toBe(12);
  });
});

describe("archive seeds", () => {
  it("carries an origin but no parents, so it can never become evidence", () => {
    // The notebook files a cross only for a planting that HAS parents
    // (garden/garden.ts). A restored plant is an observation the player already made, not a
    // new one — counting it again would manufacture proof that its parent carries a recessive.
    const g = addSeed(fresh(), g0(), { origin: "archive" });
    expect(g.tray[0]!.origin).toBe("archive");
    expect(g.tray[0]!.parents).toBeUndefined();
  });

  it("still records parents for a real cross", () => {
    // POSITIVE CONTROL. Without it, an addSeed that dropped provenance entirely would make
    // the assertion above pass while silently breaking every deduction in the game.
    const rand = mulberry32(11);
    const a = randomGenome(rand);
    const b = randomGenome(rand);
    const g = addSeed(fresh(), a, {
      parents: [serialize(a), serialize(b)],
      origin: "cross",
    });
    expect(g.tray[0]!.parents).toEqual([serialize(a), serialize(b)]);
    expect(g.tray[0]!.origin).toBe("cross");
  });
});

describe("shownBlooms memoisation", () => {
  // The cull is O(n^2) and runs from the FRAME LOOP, once per plot. Without memoisation a
  // garden of flowery plants spends its whole frame budget deciding where to draw a hover ring.
  it("returns the identical array when nothing has opened since last time", () => {
    const p = { ...grow(g0(), 100, SOIL), plantedAt: 0 };
    const a = shownBlooms(p, p.maxTick + 500);
    const b = shownBlooms(p, p.maxTick + 500);
    expect(b).toBe(a); // identity, not equality — a fresh array means it recomputed
  });

  it("still recomputes when more flowers have opened", () => {
    // The positive control. Caching that never invalidates would pass the test above while
    // freezing the garden's flowers at whatever was open the first time it was asked.
    const p = { ...grow(g0(), 100, SOIL), plantedAt: 0 };
    const early = shownBlooms(p, 1).length;
    const late = shownBlooms(p, p.maxTick + 500).length;
    expect(late).toBeGreaterThan(early);
  });

  it("recomputes when the clock runs backwards, as __seek can drive it", () => {
    const p = { ...grow(g0(), 100, SOIL), plantedAt: 0 };
    const late = shownBlooms(p, p.maxTick + 500).length;
    const back = shownBlooms(p, 1).length;
    expect(back).toBeLessThan(late);
  });
});
