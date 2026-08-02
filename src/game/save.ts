import { parseGenome, serialize } from "../genome/serialize";
import type { Genome } from "../genome/genome";
import {
  ORIGINS,
  TRAY_CAP,
  createGarden,
  grow,
  type Garden,
  type Origin,
  type Seed,
} from "./garden";
import {
  CROSS_CAP,
  emptyNotebook,
  type Cross,
  type Notebook,
} from "./notebook";

export const SAVE_VERSION = 2;
export const SAVE_KEY = "heirloom.garden.v1";

/**
 * Cap on the replay list — which is to say, how far back the drawer can reach.
 *
 * Raised from 60 when the drawer made this list player-facing. It was sized for its ORIGINAL
 * consumer: §7 regenerates the background from it rather than storing an image, and every
 * entry composited costs a full `growPlant` on load, so 60 was where restore stayed under a
 * frame or two.
 *
 * That cost has not gone away, and this constant no longer governs it — see
 * `BACKGROUND_REPLAY`. The two are deliberately separate because the drawer and the background
 * want opposite things from the same list: the drawer wants depth, the background wants to be
 * cheap and has nothing to gain past the point where a layer washes out under 5% contrast.
 *
 * What this cap now costs is parsing and storing genome STRINGS: 200 x 14 chars is under 3KB,
 * irrelevant beside the plants themselves.
 */
export const REPLAY_CAP = 200;

/**
 * How many retired plants are composited into the background on load.
 *
 * Held at the old REPLAY_CAP so load time is exactly what it was. Beyond this depth a layer has
 * washed out to under 5% contrast (see `effectiveDepth`) and would be invisible anyway, so
 * paying `growPlant` for it buys nothing.
 */
export const BACKGROUND_REPLAY = 60;

/** One retired plant: its genome, and where it stood. */
export type ReplayEntry = { g: string; x: number };

/**
 * A plant or seed as stored: its genome, plus where it came from.
 *
 * Provenance has to survive a reload or the notebook loses its evidence at the first refresh —
 * and the notebook is worth nothing if it only remembers the current session.
 */
export type StoredPlant = {
  g: string;
  /** Seed id, so one observation cannot be counted twice across reloads. */
  id?: number;
  /** Serialized parents. Absent for a founder. */
  p?: [string, string];
  /** How the seed was made: clone, self, cross. Absent for a founder. */
  o?: Origin;
};

export type SaveV2 = {
  v: number;
  /** Genome and provenance per plot, or null for a bare plot. Length fixes the plot count. */
  plots: (StoredPlant | null)[];
  /** Growth age of each plot's occupant at save time, so a plant resumes mid-growth. */
  ages: number[];
  tray: StoredPlant[];
  replay: ReplayEntry[];
  /** Observed crosses — the notebook's entire contents. */
  notebook: Cross[];
  /**
   * The seed counter.
   *
   * Persisted because the notebook keys observations on seed id, and the previous build
   * restarted the counter from the tray length on every load. Two sessions would then both
   * mint a seed 3, and the second one's outcome would be silently discarded as a duplicate of
   * the first. A latent bug before the notebook existed; a data-losing one afterwards.
   */
  nextSeedId: number;
};

/**
 * `replay` is passed in rather than derived from `g.retired`, and that is load-bearing.
 *
 * `fromSave` returns the replay list SEPARATELY from the garden — restored plants go straight
 * into the background buffer, so `garden.retired` comes back empty. Deriving the save's replay
 * from `garden.retired` would therefore write an empty list on the first save after a reload
 * and silently delete the player's entire history, one session at a time. The caller owns the
 * running history; this function only serializes it.
 *
 * The notebook is passed in for the same reason and would fail the same way.
 */
export function toSave(
  g: Garden,
  now: number,
  replay: ReplayEntry[],
  notebook: Notebook = emptyNotebook(),
): SaveV2 {
  const store = (
    genome: Genome,
    id?: number,
    p?: [string, string],
    o?: Origin,
  ): StoredPlant => ({
    g: serialize(genome),
    ...(id === undefined ? {} : { id }),
    ...(p ? { p } : {}),
    ...(o ? { o } : {}),
  });
  return {
    v: SAVE_VERSION,
    plots: g.plots.map((p) =>
      p.occupant
        ? store(
            p.occupant.genome,
            p.occupant.seedId,
            p.occupant.parents,
            p.occupant.origin,
          )
        : null,
    ),
    ages: g.plots.map((p) => (p.occupant ? now - p.occupant.plantedAt : 0)),
    tray: g.tray.map((s) => store(s.genome, s.id, s.parents, s.origin)),
    replay: replay.slice(-REPLAY_CAP),
    notebook: notebook.crosses.slice(-CROSS_CAP),
    nextSeedId: g.nextSeedId,
  };
}

export type LoadResult =
  | {
      ok: true;
      garden: Garden;
      replay: { genome: Genome; x: number }[];
      notebook: Notebook;
    }
  | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Read one stored plant from either format.
 *
 * A version-1 save wrote bare genome strings. Those are still valid — they simply carry no
 * provenance, which is exactly right: a v1 save predates the notebook, so there is nothing it
 * could have known. Rejecting them instead would throw away every existing player's garden to
 * gain a field that would have been empty anyway.
 */
function readStored(
  v: unknown,
  where: string,
): { ok: true; value: StoredPlant } | { ok: false; error: string } {
  if (typeof v === "string") return { ok: true, value: { g: v } };
  if (!isRecord(v) || typeof v["g"] !== "string")
    return { ok: false, error: `${where} is not a genome` };
  const p = v["p"];
  const parents =
    Array.isArray(p) &&
    p.length === 2 &&
    typeof p[0] === "string" &&
    typeof p[1] === "string"
      ? ([p[0], p[1]] as [string, string])
      : undefined;
  const id = typeof v["id"] === "number" ? v["id"] : undefined;
  const o = v["o"];
  // Membership against the one definition, not a restatement of it. This used to be a hand
  // written disjunction of four strings, and it silently dropped `archive` for as long as the
  // drawer has existed — the writer above serialises every origin, so the value was written to
  // disk and then refused on the way back in.
  const origin = ORIGINS.includes(o as Origin) ? (o as Origin) : undefined;
  return {
    ok: true,
    value: {
      g: v["g"],
      ...(id === undefined ? {} : { id }),
      ...(parents ? { p: parents } : {}),
      ...(origin ? { o: origin } : {}),
    },
  };
}

/**
 * Crosses from a save, skipping any entry that is malformed.
 *
 * The one place in this file that does NOT reject the whole save on bad input, and the
 * asymmetry is deliberate. A broken plot means the garden cannot be rebuilt and the player
 * must be told. A broken notebook entry means one piece of evidence is unreadable — dropping
 * the player's entire garden over it would be a wildly disproportionate response to a lost
 * inference.
 */
function readNotebook(raw: unknown): Notebook {
  if (!Array.isArray(raw)) return emptyNotebook();
  const crosses: Cross[] = [];
  for (const c of raw) {
    if (!isRecord(c)) continue;
    const p = c["parents"];
    if (
      typeof c["seedId"] !== "number" ||
      typeof c["child"] !== "string" ||
      !Array.isArray(p) ||
      p.length !== 2 ||
      typeof p[0] !== "string" ||
      typeof p[1] !== "string"
    )
      continue;
    crosses.push({
      seedId: c["seedId"],
      child: c["child"],
      parents: [p[0], p[1]],
    });
  }
  return { crosses: crosses.slice(-CROSS_CAP) };
}

/**
 * Rebuild a garden from a save.
 *
 * Every failure is NAMED and returned rather than swallowed into a default (§10, and the
 * project's fail-loud rule). A save that silently resets to a fresh garden is the worst
 * possible behaviour here: the player loses a breeding history and is told nothing, and the
 * bug that ate it leaves no trace.
 *
 * Genomes are re-expressed and re-grown rather than stored as geometry. That is what makes a
 * save survive a change to the growth engine or the renderer — the alternative would pin
 * every old plant to the code that drew it.
 */
export function fromSave(
  raw: unknown,
  plotXs: number[],
  soilY: number,
): LoadResult {
  if (!isRecord(raw)) return { ok: false, error: "save is not an object" };
  // Version 1 is still readable: it wrote bare genome strings and had no notebook, both of
  // which this loader handles. Refusing it would delete an existing player's whole garden to
  // gain fields that would have been empty.
  if (raw["v"] !== SAVE_VERSION && raw["v"] !== 1)
    return {
      ok: false,
      error: `save version ${String(raw["v"])} (this build reads version ${SAVE_VERSION})`,
    };
  const plots = raw["plots"];
  const ages = raw["ages"];
  const tray = raw["tray"];
  const replay = raw["replay"];
  if (!Array.isArray(plots) || !Array.isArray(ages))
    return { ok: false, error: "save is missing its plots" };
  if (!Array.isArray(tray) || !Array.isArray(replay))
    return { ok: false, error: "save is missing its tray or replay list" };
  if (plots.length !== plotXs.length)
    return {
      ok: false,
      error: `save has ${plots.length} plots, this garden has ${plotXs.length}`,
    };

  let garden = createGarden(plotXs);
  const restoredPlots = garden.plots.map((p) => ({ ...p }));

  for (let i = 0; i < plots.length; i++) {
    const entry = plots[i];
    if (entry === null || entry === undefined) continue;
    const read = readStored(entry, `plot ${i}`);
    if (!read.ok) return { ok: false, error: read.error };
    const parsed = parseGenome(read.value.g);
    if (!parsed.ok) return { ok: false, error: `plot ${i}: ${parsed.error}` };
    const age = Number(ages[i]) || 0;
    restoredPlots[i]!.occupant = {
      ...grow(parsed.genome, plotXs[i]!, soilY),
      // Negative plantedAt against a clock restarting at 0 resumes growth where it left off.
      plantedAt: -age,
      ...(read.value.id === undefined ? {} : { seedId: read.value.id }),
      ...(read.value.p ? { parents: read.value.p } : {}),
      ...(read.value.o ? { origin: read.value.o } : {}),
    };
  }

  const seeds: Seed[] = [];
  for (const [i, entry] of tray.entries()) {
    const read = readStored(entry, `tray slot ${i}`);
    if (!read.ok) return { ok: false, error: read.error };
    const parsed = parseGenome(read.value.g);
    if (!parsed.ok)
      return { ok: false, error: `tray slot ${i}: ${parsed.error}` };
    seeds.push({
      // Falls back to the index for a v1 save, which had no ids. Those seeds have no
      // provenance either, so nothing in the notebook can key off them.
      id: read.value.id ?? i + 1,
      genome: parsed.genome,
      ...(read.value.p ? { parents: read.value.p } : {}),
      ...(read.value.o ? { origin: read.value.o } : {}),
    });
  }

  const restored: { genome: Genome; x: number }[] = [];
  for (const [i, entry] of replay.entries()) {
    if (!isRecord(entry) || typeof entry["g"] !== "string")
      return { ok: false, error: `replay entry ${i} is malformed` };
    const parsed = parseGenome(entry["g"]);
    if (!parsed.ok)
      return { ok: false, error: `replay entry ${i}: ${parsed.error}` };
    restored.push({ genome: parsed.genome, x: Number(entry["x"]) || 0 });
  }

  const kept = seeds.slice(-TRAY_CAP);
  // The counter must never go BACKWARDS past a seed that already exists, or a later seed
  // would reuse an id the notebook has already filed an observation under and its outcome
  // would be silently discarded as a duplicate.
  const stored = Number(raw["nextSeedId"]);
  const highest = kept.reduce((m, s) => Math.max(m, s.id), 0);
  const nextSeedId = Math.max(
    Number.isFinite(stored) ? stored : 0,
    highest + 1,
    1,
  );

  garden = { ...garden, plots: restoredPlots, tray: kept, nextSeedId };
  return {
    ok: true,
    garden,
    replay: restored.slice(-REPLAY_CAP),
    notebook: readNotebook(raw["notebook"]),
  };
}
