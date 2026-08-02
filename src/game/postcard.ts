import type { Genome } from "../genome/genome";
import {
  BitReader,
  BitWriter,
  PAYLOAD_BYTES,
  base64UrlToBytes,
  bytesToBase64Url,
  checksumOf,
  readGenomeBits,
  writeGenomeBits,
} from "../genome/serialize";
import { BACKGROUND_REPLAY, MAX_PLOTS } from "./layout";

/**
 * A whole garden, packed for a URL fragment.
 *
 * Its own version, NOT `GENOME_VERSION`. The two change for different reasons: adding a locus
 * changes the genome layout, adding a field changes this one, and a shared version byte would
 * make each invalidate the other's links for no reason.
 */
export const POSTCARD_VERSION = 1;

/** Ages are two bytes. Past `maxTick` a plant is finished, so the ceiling costs nothing. */
const MAX_AGE = 0xffff;

export type PostcardPlot = { genome: Genome; age: number };

export type Postcard = {
  /** The SENDER's world. A visit renders this, scaled to fit, rather than reflowing. */
  W: number;
  H: number;
  /** How many plots the sender's bed had — 2 to 9, per MIN_PLOTS/MAX_PLOTS. */
  plotCount: number;
  /** Length always equals plotCount. Empty plots are null. */
  plots: (PostcardPlot | null)[];
  forest: { genome: Genome; x: number }[];
};

const u16 = (bytes: number[], v: number): void => {
  const n = Math.max(0, Math.min(MAX_AGE, Math.round(v)));
  bytes.push(n & 0xff, (n >> 8) & 0xff);
};

function genomeBytes(g: Genome): Uint8Array {
  const w = new BitWriter(PAYLOAD_BYTES);
  writeGenomeBits(w, g);
  return w.bytes;
}

export function packPostcard(p: Postcard): string {
  const body: number[] = [];
  u16(body, p.W);
  u16(body, p.H);

  const plotCount = Math.max(0, Math.min(MAX_PLOTS, p.plotCount));
  body.push(plotCount);

  const occupied = p.plots
    .slice(0, plotCount)
    .map((plot, i) => ({ plot, i }))
    .filter((e): e is { plot: PostcardPlot; i: number } => e.plot !== null);
  body.push(occupied.length);
  for (const { plot, i } of occupied) {
    body.push(i);
    body.push(...genomeBytes(plot.genome));
    u16(body, plot.age);
  }

  // Capped at the depth the background actually composites. Deeper layers render under 5%
  // contrast (see BACKGROUND_REPLAY), so carrying them would triple the link to send nothing.
  const forest = p.forest.slice(0, BACKGROUND_REPLAY);
  body.push(forest.length);
  for (const f of forest) {
    body.push(...genomeBytes(f.genome));
    u16(body, f.x);
  }

  const out = new Uint8Array(2 + body.length);
  out[0] = POSTCARD_VERSION;
  out.set(body, 1);
  out[out.length - 1] = checksumOf(out, out.length - 1);
  return bytesToBase64Url(out);
}

export type PostcardResult =
  | { ok: true; postcard: Postcard }
  | { ok: false; error: string };

export function readPostcard(s: string): PostcardResult {
  if (typeof s !== "string" || s.length === 0)
    return { ok: false, error: "empty garden code" };

  const bytes = base64UrlToBytes(s);
  if (!bytes)
    return {
      ok: false,
      error: "not base64url — illegal character in garden code",
    };
  // Shortest legal postcard: version + W + H + plotCount + 0 occupied + 0 forest + checksum.
  if (bytes.length < 8)
    return {
      ok: false,
      error: `garden code is too short: ${bytes.length} bytes`,
    };

  const version = bytes[0]!;
  if (version !== POSTCARD_VERSION)
    return {
      ok: false,
      error: `unsupported garden version ${version} (this build reads version ${POSTCARD_VERSION})`,
    };
  if (bytes[bytes.length - 1] !== checksumOf(bytes, bytes.length - 1))
    return {
      ok: false,
      error: "checksum mismatch — the garden code is corrupted",
    };

  let at = 1;
  const need = (n: number, what: string): string | null =>
    at + n > bytes.length - 1 ? `garden code ends mid-${what}` : null;
  const read16 = (): number => {
    const v = bytes[at]! | (bytes[at + 1]! << 8);
    at += 2;
    return v;
  };
  const readGenome = (): Genome => {
    const g = readGenomeBits(
      new BitReader(bytes.subarray(at, at + PAYLOAD_BYTES)),
    );
    at += PAYLOAD_BYTES;
    return g;
  };

  let bad = need(5, "header");
  if (bad) return { ok: false, error: bad };
  const W = read16();
  const H = read16();
  const plotCount = bytes[at++]!;
  if (plotCount > MAX_PLOTS)
    return {
      ok: false,
      error: `garden claims ${plotCount} plots (the most is ${MAX_PLOTS})`,
    };

  bad = need(1, "bed");
  if (bad) return { ok: false, error: bad };
  const occupied = bytes[at++]!;
  const plots: (PostcardPlot | null)[] = Array.from(
    { length: plotCount },
    () => null,
  );
  for (let n = 0; n < occupied; n++) {
    bad = need(1 + PAYLOAD_BYTES + 2, "bed");
    if (bad) return { ok: false, error: bad };
    const index = bytes[at++]!;
    const genome = readGenome();
    const age = read16();
    if (index < plotCount) plots[index] = { genome, age };
  }

  bad = need(1, "forest");
  if (bad) return { ok: false, error: bad };
  const count = bytes[at++]!;
  const forest: { genome: Genome; x: number }[] = [];
  for (let n = 0; n < count; n++) {
    bad = need(PAYLOAD_BYTES + 2, "forest");
    if (bad) return { ok: false, error: bad };
    const genome = readGenome();
    forest.push({ genome, x: read16() });
  }

  return { ok: true, postcard: { W, H, plotCount, plots, forest } };
}
