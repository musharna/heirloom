import { hashString } from "../rng";
import {
  D_ALLELES,
  H1_ALLELES,
  H2_ALLELES,
  POLY_LOCI,
  P_ALLELES,
  W_ALLELES,
} from "./loci";
import type { Genome, PolyBlock } from "./genome";

/** Bumped whenever the bit layout changes. An old link then fails loudly instead of decoding to nonsense. */
export const GENOME_VERSION = 1;

const PAYLOAD_BYTES = 6; // 48 bits: see writeGenome
const TOTAL_BYTES = 1 + PAYLOAD_BYTES + 1; // version + payload + checksum
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

class BitWriter {
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

class BitReader {
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

function bytesToBase64Url(bytes: Uint8Array): string {
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
function base64UrlToBytes(s: string): Uint8Array | null {
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

function checksum(bytes: Uint8Array, upto: number): number {
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
 * Genome → short base64url string.
 *
 * 48 payload bits: W/H1/H2/D take one bit per allele, P takes two (four-allele series), and
 * each polygenic block takes 12. With a version byte and a checksum byte that is 8 bytes,
 * or 11 characters — short enough for a URL fragment.
 */
export function serialize(g: Genome): string {
  const w = new BitWriter(PAYLOAD_BYTES);
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

  const out = new Uint8Array(TOTAL_BYTES);
  out[0] = GENOME_VERSION;
  out.set(w.bytes, 1);
  out[TOTAL_BYTES - 1] = checksum(out, TOTAL_BYTES - 1);
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
  if (bytes.length !== TOTAL_BYTES)
    return {
      ok: false,
      error: `wrong length: expected ${TOTAL_BYTES} bytes, got ${bytes.length}`,
    };
  if (bytes[0] !== GENOME_VERSION)
    return {
      ok: false,
      error: `unsupported genome version ${bytes[0]} (this build reads version ${GENOME_VERSION})`,
    };
  if (bytes[TOTAL_BYTES - 1] !== checksum(bytes, TOTAL_BYTES - 1))
    return { ok: false, error: "checksum mismatch — the genome is corrupted" };

  const r = new BitReader(bytes.subarray(1, 1 + PAYLOAD_BYTES));
  const genome: Genome = {
    W: [W_ALLELES[r.read(1)]!, W_ALLELES[r.read(1)]!],
    H1: [H1_ALLELES[r.read(1)]!, H1_ALLELES[r.read(1)]!],
    H2: [H2_ALLELES[r.read(1)]!, H2_ALLELES[r.read(1)]!],
    D: [D_ALLELES[r.read(1)]!, D_ALLELES[r.read(1)]!],
    P: [P_ALLELES[r.read(2)]!, P_ALLELES[r.read(2)]!],
    V: readPoly(r),
    G: readPoly(r),
    B: readPoly(r),
  };
  return { ok: true, genome };
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
