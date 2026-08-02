import { describe, it, expect } from "vitest";
import { mulberry32 } from "../src/rng";
import { REPLAY_CAP, SAVE_VERSION, fromSave, toSave } from "../src/game/save";
import {
  ORIGINS,
  TRAY_CAP,
  addSeed,
  createGarden,
  grow,
  plantSeed,
  sowFounders,
  type Garden,
} from "../src/game/garden";
import { genomesEqual, randomGenome } from "../src/genome/genome";
import { serialize } from "../src/genome/serialize";
import type { Notebook } from "../src/game/notebook";

const XS = [100, 300, 500, 700, 900];
const SOIL = 400;

function populated(seed = 5): Garden {
  const rand = mulberry32(seed);
  let g = sowFounders(createGarden(XS), 3, SOIL, rand);
  for (let i = 0; i < 3; i++) g = addSeed(g, randomGenome(rand));
  // Retire one, so the replay list is non-empty.
  g = plantSeed(g, g.tray[0]!.id, 0, SOIL, 40);
  return g;
}

/** The running history the caller owns — see the note on `toSave`. */
const replayOf = (g: Garden) =>
  g.retired.map((p) => ({ g: serialize(p.genome), x: 250 }));

describe("save round-trip", () => {
  it("restores plots, tray and replay", () => {
    const g = populated();
    const r = fromSave(toSave(g, 200, replayOf(g)), XS, SOIL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    for (const [i, plot] of g.plots.entries()) {
      const back = r.garden.plots[i]!;
      if (!plot.occupant) {
        expect(back.occupant).toBeNull();
      } else {
        expect(genomesEqual(back.occupant!.genome, plot.occupant.genome)).toBe(
          true,
        );
      }
    }
    expect(r.garden.tray).toHaveLength(g.tray.length);
    expect(r.replay).toHaveLength(g.retired.length);
    expect(genomesEqual(r.replay[0]!.genome, g.retired[0]!.genome)).toBe(true);
  });

  it("regrows plants from genomes rather than storing geometry", () => {
    // This is what lets a save survive a change to the growth engine or the renderer. The
    // alternative pins every old plant to the code that drew it.
    const g = populated();
    const save = toSave(g, 200, replayOf(g));
    expect(JSON.stringify(save)).not.toMatch(/segments|x0|petals/);

    const r = fromSave(save, XS, SOIL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const live = g.plots.find((p) => p.occupant)!;
    const back = r.garden.plots.find((p) => p.occupant)!;
    expect(back.occupant!.plant.segments.length).toBe(
      live.occupant!.plant.segments.length,
    );
  });

  it("resumes a half-grown plant where it left off", () => {
    let g = addSeed(createGarden(XS), randomGenome(mulberry32(7)));
    g = plantSeed(g, g.tray[0]!.id, 1, SOIL, 100);
    // Saved at tick 130, so the plant is 30 ticks old.
    const r = fromSave(toSave(g, 130, []), XS, SOIL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The restored clock restarts at 0, so a 30-tick-old plant sits at plantedAt -30.
    expect(r.garden.plots[1]!.occupant!.plantedAt).toBe(-30);
  });

  it("caps the replay list at REPLAY_CAP, keeping the most recent", () => {
    const rand = mulberry32(9);
    let g = createGarden(XS);
    const retired = [];
    for (let i = 0; i < REPLAY_CAP + 15; i++) {
      const genome = randomGenome(rand);
      retired.push({ ...grow(genome, 100, SOIL), plantedAt: 0 });
    }
    g = { ...g, retired };
    const save = toSave(
      g,
      0,
      retired.map((p) => ({ g: serialize(p.genome), x: 100 })),
    );
    expect(save.replay).toHaveLength(REPLAY_CAP);
    // The most recent survives; the oldest is dropped.
    expect(save.replay.at(-1)!.g).toBe(serialize(retired.at(-1)!.genome));
    expect(save.replay[0]!.g).toBe(serialize(retired[15]!.genome));
  });

  it("caps a restored tray at TRAY_CAP", () => {
    const rand = mulberry32(11);
    const save = {
      v: SAVE_VERSION,
      plots: XS.map(() => null),
      ages: XS.map(() => 0),
      tray: Array.from({ length: TRAY_CAP + 6 }, () =>
        serialize(randomGenome(rand)),
      ),
      replay: [],
    };
    const r = fromSave(save, XS, SOIL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.garden.tray).toHaveLength(TRAY_CAP);
    expect(new Set(r.garden.tray.map((s) => s.id)).size).toBe(TRAY_CAP);
  });
});

describe("fromSave — names every failure, never silently resets", () => {
  const good = () => toSave(populated(), 200, replayOf(populated()));

  it("rejects a non-object", () => {
    for (const bad of [null, undefined, 42, "x", []]) {
      const r = fromSave(bad, XS, SOIL);
      expect(r.ok).toBe(false);
    }
  });

  it("names a version mismatch", () => {
    const r = fromSave({ ...good(), v: 99 }, XS, SOIL);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/version 99/);
  });

  it("names a plot-count mismatch instead of silently truncating", () => {
    // Silently dropping plots would quietly delete the player's plants.
    const r = fromSave(good(), [1, 2, 3], SOIL);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/plots/);
  });

  it("names WHICH plot holds a corrupt genome", () => {
    const save = good();
    save.plots = save.plots.map((p, i) =>
      i === 0 && p ? { g: "!!!!!!!!!!!" } : p,
    );
    const firstOccupied = save.plots.findIndex((p) => p !== null);
    const r = fromSave(save, XS, SOIL);
    if (firstOccupied === 0) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/plot 0/);
    }
  });

  it("names a corrupt tray entry", () => {
    const save = good();
    save.tray = [...save.tray, { g: "AAAAAAAAAAA" }]; // base64url, wrong checksum
    const r = fromSave(save, XS, SOIL);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/tray slot/);
  });

  it("names a malformed replay entry", () => {
    const save = good();
    save.replay = [{ x: 1 } as never];
    const r = fromSave(save, XS, SOIL);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/replay entry 0/);
  });

  it("POSITIVE CONTROL: an untouched save still loads", () => {
    // Every rejection test above would pass on a loader that refused everything.
    expect(fromSave(good(), XS, SOIL).ok).toBe(true);
  });
});

describe("the notebook survives a reload", () => {
  const nb = (): Notebook => ({
    crosses: [
      { seedId: 11, child: "child-code", parents: ["mum-code", "dad-code"] },
      { seedId: 12, child: "other", parents: ["mum-code", "mum-code"] },
    ],
  });

  it("comes back exactly as it went in", () => {
    // Evidence is cumulative and irreplaceable: a notebook that only remembered the current
    // session would make the whole feature worthless, because the interesting deductions are
    // the ones that take several sittings to earn.
    const g = populated();
    const r = fromSave(toSave(g, 200, replayOf(g), nb()), XS, SOIL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notebook.crosses).toEqual(nb().crosses);
  });

  it("carries each seed's provenance through the round trip", () => {
    // Without this the notebook stops being able to file anything after a reload: a restored
    // seed with no parents produces a seedling that is evidence about nobody.
    let g = populated();
    g = addSeed(g, randomGenome(mulberry32(3)), {
      parents: ["mum-code", "dad-code"],
      origin: "self",
    });
    const r = fromSave(toSave(g, 200, replayOf(g)), XS, SOIL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const back = r.garden.tray.at(-1)!;
    expect(back.parents).toEqual(["mum-code", "dad-code"]);
    expect(back.origin).toBe("self");
  });

  it("never lets the seed counter fall back onto an id already used", () => {
    // The bug this exists for: the loader used to restart the counter at `tray.length + 1`, so
    // a second session would mint a seed 3 that the notebook had already filed an observation
    // under — and the new seedling's outcome would be silently dropped as a duplicate.
    let g = populated();
    for (let i = 0; i < 4; i++) g = addSeed(g, randomGenome(mulberry32(9 + i)));
    const highest = Math.max(...g.tray.map((s) => s.id));
    const r = fromSave(toSave(g, 200, replayOf(g)), XS, SOIL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.garden.nextSeedId).toBeGreaterThan(highest);
  });

  it("CONTROL: the old id scheme WOULD have collided", () => {
    // Pins that the assertion above discriminates, against the arithmetic that shipped.
    let g = populated();
    for (let i = 0; i < 4; i++)
      g = addSeed(g, randomGenome(mulberry32(20 + i)));
    const highest = Math.max(...g.tray.map((s) => s.id));
    const oldScheme = Math.min(g.tray.length, TRAY_CAP) + 1;
    expect(oldScheme).toBeLessThanOrEqual(highest);
  });

  it("reads a version-1 save, which had neither notebook nor provenance", () => {
    // A v1 save predates all of this. Refusing it would delete an existing player's whole
    // garden to gain fields that would have been empty anyway.
    const g = populated();
    const v2 = toSave(g, 200, replayOf(g), nb());
    const v1 = {
      v: 1,
      plots: v2.plots.map((p) => (p ? p.g : null)),
      ages: v2.ages,
      tray: v2.tray.map((t) => t.g),
      replay: v2.replay,
    };
    const r = fromSave(v1, XS, SOIL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notebook.crosses).toEqual([]);
    expect(r.garden.tray.every((s) => s.parents === undefined)).toBe(true);
    // ...and the plants themselves came back, which is the point of accepting it at all.
    expect(r.garden.plots.filter((p) => p.occupant).length).toBe(
      g.plots.filter((p) => p.occupant).length,
    );
  });

  it("drops ONE unreadable notebook entry rather than the whole garden", () => {
    // Deliberately asymmetric with the rest of this file. A broken plot means the garden
    // cannot be rebuilt and the player must be told; a broken piece of evidence means one
    // lost inference, and refusing to open the game over it would be wildly out of
    // proportion.
    const g = populated();
    const save = toSave(g, 200, replayOf(g), nb()) as Record<string, unknown>;
    save["notebook"] = [
      { seedId: 1, child: "ok", parents: ["a", "b"] },
      { seedId: "not a number", child: "bad", parents: ["a", "b"] },
      { nonsense: true },
    ];
    const r = fromSave(save, XS, SOIL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notebook.crosses).toHaveLength(1);
  });
});

describe("origin round-trip", () => {
  // Table-driven over ORIGINS ITSELF, not over a hand-written list. The whole defect here is
  // that the legal origins were written down twice and drifted; a test that restated them would
  // be a third copy, and would pass while the loader silently dropped a value.
  it.each(ORIGINS)("survives a save and load: %s", (origin) => {
    const rand = mulberry32(3);
    let g = createGarden(XS);
    g = addSeed(g, randomGenome(rand), {
      parents: ["mum-code", "dad-code"],
      origin,
    });
    const r = fromSave(toSave(g, 200, []), XS, SOIL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.garden.tray.at(-1)!.origin).toBe(origin);
  });
});
