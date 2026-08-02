import { hashString } from "../rng";
import {
  D_ALLELES,
  H1_ALLELES,
  H2_ALLELES,
  I_ALLELES,
  L_ALLELES,
  N_ALLELES,
  POLY_LOCI,
  P_ALLELES,
  W_ALLELES,
} from "./loci";
import type { Genome, PolyBlock } from "./genome";

/** Bumped whenever the bit layout changes. An old link then fails loudly instead of decoding to nonsense. */
export const GENOME_VERSION = 2;

export const PAYLOAD_BYTES = 8; // 58 used of 64: see serialize
const TOTAL_BYTES = 1 + PAYLOAD_BYTES + 1; // version + payload + checksum

/** The v1 layout, kept only so old links and saves still open. See `readV1`. */
const V1_PAYLOAD_BYTES = 6;
const V1_TOTAL_BYTES = 1 + V1_PAYLOAD_BYTES + 1;
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export class BitWriter {
  readonly bytes: Uint8Array;
  private at = 0;
  constructor(n: number) {
    this.bytes = new Uint8Array(n);
  }
  /** LSB-first within each byte. */
  write(value: number, width: number): void {
    for (let i = 0; i < width; i++) {
      if ((value >> i) & 1) this.bytes[this.at >> 3]! |= 1 << (this.at & 7);
      this.at++;
    }
  }
}

export class BitReader {
  private at = 0;
  constructor(private readonly bytes: Uint8Array) {}
  read(width: number): number {
    let out = 0;
    for (let i = 0; i < width; i++) {
      out |= ((this.bytes[this.at >> 3]! >> (this.at & 7)) & 1) << i;
      this.at++;
    }
    return out;
  }
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2]!;
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    if (b === undefined) break;
    out += B64[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    if (c === undefined) break;
    out += B64[c & 63]!;
  }
  return out;
}

/** Returns null on any character outside the base64url alphabet. */
export function base64UrlToBytes(s: string): Uint8Array | null {
  const n = Math.floor((s.length * 6) / 8);
  const bytes = new Uint8Array(n);
  let acc = 0;
  let bits = 0;
  let at = 0;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (at < n) bytes[at++] = (acc >> bits) & 0xff;
    }
  }
  return bytes;
}

export function checksumOf(bytes: Uint8Array, upto: number): number {
  let s = "";
  for (let i = 0; i < upto; i++) s += String.fromCharCode(bytes[i]!);
  return hashString(s) & 0xff;
}

function writePoly(w: BitWriter, block: PolyBlock): void {
  const mask = (1 << POLY_LOCI) - 1;
  w.write(block.a & mask, POLY_LOCI);
  w.write(block.b & mask, POLY_LOCI);
}

function readPoly(r: BitReader): PolyBlock {
  return { a: r.read(POLY_LOCI), b: r.read(POLY_LOCI) };
}

/**
 * The genome bit layout — the ONE definition.
 *
 * `serialize` wraps this in a version byte and a checksum; the postcard codec packs many of
 * these behind a single version and checksum of its own. Two copies of this function would
 * decode each other's genomes into different, perfectly valid, checksum-passing flowers.
 *
 * 58 payload bits: W/H1/H2/D/L take one bit per allele copy, P/I/N take two each (four-allele
 * series), and each polygenic block takes 12. I/N/L are appended AFTER the v1 fields, in the
 * same order as DISCRETE_LOCI — keeping the old fields at their old bit offsets is what lets
 * `parseGenome`'s v1 tail fallback be the same reader with a shorter tail.
 */
export function writeGenomeBits(w: BitWriter, g: Genome): void {
  w.write(W_ALLELES.indexOf(g.W[0]), 1);
  w.write(W_ALLELES.indexOf(g.W[1]), 1);
  w.write(H1_ALLELES.indexOf(g.H1[0]), 1);
  w.write(H1_ALLELES.indexOf(g.H1[1]), 1);
  w.write(H2_ALLELES.indexOf(g.H2[0]), 1);
  w.write(H2_ALLELES.indexOf(g.H2[1]), 1);
  w.write(D_ALLELES.indexOf(g.D[0]), 1);
  w.write(D_ALLELES.indexOf(g.D[1]), 1);
  w.write(P_ALLELES.indexOf(g.P[0]), 2);
  w.write(P_ALLELES.indexOf(g.P[1]), 2);
  writePoly(w, g.V);
  writePoly(w, g.G);
  writePoly(w, g.B);
  w.write(I_ALLELES.indexOf(g.I[0]), 2);
  w.write(I_ALLELES.indexOf(g.I[1]), 2);
  w.write(N_ALLELES.indexOf(g.N[0]), 2);
  w.write(N_ALLELES.indexOf(g.N[1]), 2);
  w.write(L_ALLELES.indexOf(g.L[0]), 1);
  w.write(L_ALLELES.indexOf(g.L[1]), 1);
}

/** The v2 reader. `parseGenome` still handles the v1 tail itself, which this does not know about. */
export function readGenomeBits(r: BitReader): Genome {
  const W = [W_ALLELES[r.read(1)]!, W_ALLELES[r.read(1)]!];
  const H1 = [H1_ALLELES[r.read(1)]!, H1_ALLELES[r.read(1)]!];
  const H2 = [H2_ALLELES[r.read(1)]!, H2_ALLELES[r.read(1)]!];
  const D = [D_ALLELES[r.read(1)]!, D_ALLELES[r.read(1)]!];
  const P = [P_ALLELES[r.read(2)]!, P_ALLELES[r.read(2)]!];
  const V = readPoly(r);
  const G = readPoly(r);
  const B = readPoly(r);
  const I = [I_ALLELES[r.read(2)]!, I_ALLELES[r.read(2)]!];
  const N = [N_ALLELES[r.read(2)]!, N_ALLELES[r.read(2)]!];
  const L = [L_ALLELES[r.read(1)]!, L_ALLELES[r.read(1)]!];
  return { W, H1, H2, D, P, V, G, B, I, N, L } as Genome;
}

/**
 * Genome → short base64url string.
 *
 * Rounded up to 8 payload bytes, plus a version byte and a checksum byte, that is 10 bytes —
 * 14 characters, still short enough for a URL fragment.
 *
 * The six spare bits are left as zero rather than being packed tighter. A tighter packing
 * would save one character and cost the next locus a version bump.
 */
export function serialize(g: Genome): string {
  const w = new BitWriter(PAYLOAD_BYTES);
  writeGenomeBits(w, g);
  const out = new Uint8Array(TOTAL_BYTES);
  out[0] = GENOME_VERSION;
  out.set(w.bytes, 1);
  out[TOTAL_BYTES - 1] = checksumOf(out, TOTAL_BYTES - 1);
  return bytesToBase64Url(out);
}

export type ParseResult =
  | { ok: true; genome: Genome }
  | { ok: false; error: string };

/**
 * Parse a shared genome string, naming what failed (§10: reject visibly, never substitute a
 * default).
 *
 * The bit packing is DENSE — every locus uses its full code space, so there is no such thing
 * as an illegal allele code and no allele-legality check to make. That is exactly why the
 * checksum is not decoration: without it a single flipped character decodes to a perfectly
 * valid but different genome, and a mistyped link would silently hand back the wrong flower.
 */
export function parseGenome(s: string): ParseResult {
  if (typeof s !== "string" || s.length === 0)
    return { ok: false, error: "empty genome string" };

  const bytes = base64UrlToBytes(s);
  if (!bytes)
    return { ok: false, error: "not base64url — illegal character in genome" };
  if (bytes.length === 0) return { ok: false, error: "empty genome string" };

  const version = bytes[0]!;
  if (version !== 1 && version !== GENOME_VERSION)
    return {
      ok: false,
      error: `unsupported genome version ${version} (this build reads version ${GENOME_VERSION})`,
    };

  // Version is read FIRST, then the length expected for that version. Checking a single
  // length up front would have reported every v1 link as "wrong length" — technically true
  // and useless, because the actual situation is a link from an older build, which is a thing
  // this parser can handle.
  const total = version === 1 ? V1_TOTAL_BYTES : TOTAL_BYTES;
  if (bytes.length !== total)
    return {
      ok: false,
      error: `wrong length: expected ${total} bytes for version ${version}, got ${bytes.length}`,
    };
  if (bytes[total - 1] !== checksumOf(bytes, total - 1))
    return { ok: false, error: "checksum mismatch — the genome is corrupted" };

  // Inlined rather than calling readGenomeBits: a v1 link has a shorter tail (see below), which
  // readGenomeBits deliberately does not model. Do not "simplify" this to call readGenomeBits —
  // that would drop the v1 fallback and break every v1 link still in the wild.
  const r = new BitReader(bytes.subarray(1, total - 1));
  const common = {
    W: [W_ALLELES[r.read(1)]!, W_ALLELES[r.read(1)]!],
    H1: [H1_ALLELES[r.read(1)]!, H1_ALLELES[r.read(1)]!],
    H2: [H2_ALLELES[r.read(1)]!, H2_ALLELES[r.read(1)]!],
    D: [D_ALLELES[r.read(1)]!, D_ALLELES[r.read(1)]!],
    P: [P_ALLELES[r.read(2)]!, P_ALLELES[r.read(2)]!],
    V: readPoly(r),
    G: readPoly(r),
    B: readPoly(r),
  } as const;

  // A v1 genome predates the inflorescence, merosity and chlorophyll loci. It is filled in
  // with the alleles that REPRODUCE the plant that link used to show — solitary, five-petalled
  // and viable, which is what every v1 plant was — rather than with a neutral default. An
  // upgrade that changed the flower would be worse than rejecting the link, because the player
  // would have no way to tell it had happened.
  const tail =
    version === 1
      ? ({ I: ["i", "i"], N: ["n", "n"], L: ["L", "L"] } as const)
      : ({
          I: [I_ALLELES[r.read(2)]!, I_ALLELES[r.read(2)]!],
          N: [N_ALLELES[r.read(2)]!, N_ALLELES[r.read(2)]!],
          L: [L_ALLELES[r.read(1)]!, L_ALLELES[r.read(1)]!],
        } as const);

  return {
    ok: true,
    genome: {
      ...common,
      W: [...common.W],
      H1: [...common.H1],
      H2: [...common.H2],
      D: [...common.D],
      P: [...common.P],
      I: [...tail.I],
      N: [...tail.N],
      L: [...tail.L],
    } as Genome,
  };
}

/**
 * The growth seed for a genome — a hash of the genome ALONE.
 *
 * §6 makes this a hard requirement: no plot index, no clock. One genome must mean one
 * canonical plant, or a shared link shows the recipient a different flower and a lineage
 * stops being recognizable across generations.
 */
export function genomeSeed(g: Genome): number {
  return hashString(serialize(g));
}
