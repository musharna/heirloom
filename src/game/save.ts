import { parseGenome, serialize } from "../genome/serialize";
import type { Genome } from "../genome/genome";
import { TRAY_CAP, createGarden, grow, type Garden } from "./garden";

export const SAVE_VERSION = 1;
export const SAVE_KEY = "heirloom.garden.v1";

/**
 * Cap on the replay list.
 *
 * §7 regenerates the background from this list rather than storing it as an image, so every
 * entry costs a full `growPlant` on load. 60 is where restore stays under a frame or two while
 * still being deeper than the point at which a layer has washed out to under 5% contrast
 * (see `effectiveDepth`) — beyond that the entries would be invisible anyway.
 */
export const REPLAY_CAP = 60;

/** One retired plant: its genome, and where it stood. */
export type ReplayEntry = { g: string; x: number };

export type SaveV1 = {
  v: number;
  /** Serialized genome per plot, or null for a bare plot. Length fixes the plot count. */
  plots: (string | null)[];
  /** Growth age of each plot's occupant at save time, so a plant resumes mid-growth. */
  ages: number[];
  tray: string[];
  replay: ReplayEntry[];
};

/**
 * `replay` is passed in rather than derived from `g.retired`, and that is load-bearing.
 *
 * `fromSave` returns the replay list SEPARATELY from the garden — restored plants go straight
 * into the background buffer, so `garden.retired` comes back empty. Deriving the save's replay
 * from `garden.retired` would therefore write an empty list on the first save after a reload
 * and silently delete the player's entire history, one session at a time. The caller owns the
 * running history; this function only serializes it.
 */
export function toSave(g: Garden, now: number, replay: ReplayEntry[]): SaveV1 {
  return {
    v: SAVE_VERSION,
    plots: g.plots.map((p) =>
      p.occupant ? serialize(p.occupant.genome) : null,
    ),
    ages: g.plots.map((p) => (p.occupant ? now - p.occupant.plantedAt : 0)),
    tray: g.tray.map((s) => serialize(s.genome)),
    replay: replay.slice(-REPLAY_CAP),
  };
}

export type LoadResult =
  | { ok: true; garden: Garden; replay: { genome: Genome; x: number }[] }
  | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
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
  if (raw["v"] !== SAVE_VERSION)
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
    const code = plots[i];
    if (code === null || code === undefined) continue;
    if (typeof code !== "string")
      return { ok: false, error: `plot ${i} is not a genome string` };
    const parsed = parseGenome(code);
    if (!parsed.ok) return { ok: false, error: `plot ${i}: ${parsed.error}` };
    const age = Number(ages[i]) || 0;
    restoredPlots[i]!.occupant = {
      ...grow(parsed.genome, plotXs[i]!, soilY),
      // Negative plantedAt against a clock restarting at 0 resumes growth where it left off.
      plantedAt: -age,
    };
  }

  const seeds: Genome[] = [];
  for (const [i, code] of tray.entries()) {
    if (typeof code !== "string")
      return { ok: false, error: `tray slot ${i} is not a genome string` };
    const parsed = parseGenome(code);
    if (!parsed.ok)
      return { ok: false, error: `tray slot ${i}: ${parsed.error}` };
    seeds.push(parsed.genome);
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

  garden = {
    ...garden,
    plots: restoredPlots,
    tray: seeds.slice(-TRAY_CAP).map((genome, i) => ({ id: i + 1, genome })),
    nextSeedId: Math.min(seeds.length, TRAY_CAP) + 1,
  };
  return { ok: true, garden, replay: restored.slice(-REPLAY_CAP) };
}
