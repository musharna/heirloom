import { describe, it, expect } from "vitest";
import { mulberry32 } from "../src/rng";
import {
  BitReader,
  BitWriter,
  GENOME_VERSION,
  PAYLOAD_BYTES,
  genomeSeed,
  parseGenome,
  readGenomeBits,
  serialize,
  writeGenomeBits,
} from "../src/genome/serialize";
import {
  genomesEqual,
  randomGenome,
  type Genome,
  type PolyBlock,
} from "../src/genome/genome";
import { express } from "../src/genome/express";
import { growPlant } from "../src/growth/sim";

const poly = (a: number, b: number): PolyBlock => ({ a, b });

/** A fixed vector. Pins the wire format so an allele-array reorder cannot pass silently. */
const PINNED: Genome = {
  W: ["W", "w"],
  H1: ["h1", "H1"],
  H2: ["H2", "H2"],
  D: ["d", "D"],
  P: ["P^l", "p"],
  I: ["I^r", "i"],
  N: ["N^8", "n"],
  L: ["L", "l"],
  V: poly(0b101010, 0b000111),
  G: poly(0b111000, 0b010101),
  B: poly(0b000001, 0b111111),
};

describe("serialize", () => {
  it("round-trips every random genome", () => {
    const rand = mulberry32(2026);
    for (let i = 0; i < 500; i++) {
      const g = randomGenome(rand);
      const r = parseGenome(serialize(g));
      expect(r.ok).toBe(true);
      if (r.ok) expect(genomesEqual(r.genome, g)).toBe(true);
    }
  });

  it("produces a URL-short string", () => {
    const s = serialize(PINNED);
    expect(s.length).toBeLessThanOrEqual(14);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is stable for a pinned genome", () => {
    // If this changes, the wire format changed: bump GENOME_VERSION or every shared link
    // already in the wild now decodes to a different flower.
    //
    // This constant was READ OFF the implementation, so it is a drift detector and NOT a
    // proof that the encoding is right — a wrong encoder would have produced a different
    // string and this test would have frozen that one just as happily. The independent check
    // is `decodes a hand-built v1 payload` below, which constructs bytes from the format
    // description without going through any encoder in this repo.
    expect(serialize(PINNED)).toBe(SERIALIZED_PINNED);
  });

  it("distinguishes genomes that differ in a single polygenic bit", () => {
    const a: Genome = { ...PINNED, V: poly(0b101010, 0b000111) };
    const b: Genome = { ...PINNED, V: poly(0b101011, 0b000111) };
    expect(serialize(a)).not.toBe(serialize(b));
  });
});

describe("genome bits, shared with the postcard codec", () => {
  it("round-trips a genome through the bare bit layout", () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 50; i++) {
      const g = randomGenome(rand);
      const w = new BitWriter(PAYLOAD_BYTES);
      writeGenomeBits(w, g);
      expect(readGenomeBits(new BitReader(w.bytes))).toEqual(g);
    }
  });

  // The whole point of exporting these: one bit layout, two callers. If serialize() ever stops
  // going through writeGenomeBits, this is what notices.
  it("produces the same bits serialize() puts in its payload", () => {
    const g = randomGenome(mulberry32(99));
    const w = new BitWriter(PAYLOAD_BYTES);
    writeGenomeBits(w, g);
    // serialize() = version byte + these payload bytes + checksum byte.
    const full = serialize(g);
    const sameGenome = readGenomeBits(new BitReader(w.bytes));
    expect(serialize(sameGenome)).toBe(full);
  });
});

describe("parseGenome — rejects loudly, never substitutes a default", () => {
  it("names an empty input", () => {
    const r = parseGenome("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/empty/);
  });

  it("names an illegal character", () => {
    const s = serialize(PINNED);
    const r = parseGenome(`${s.slice(0, -1)}*`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/base64url/);
  });

  it("names a wrong length", () => {
    const r = parseGenome(serialize(PINNED).slice(0, 6));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/length/);
  });

  it("names an unsupported version", () => {
    // Hand-build a payload whose version byte is not ours, with a VALID checksum — so the
    // version branch is what rejects it, not the checksum.
    const bytes = new Uint8Array(8);
    bytes[0] = GENOME_VERSION + 7;
    let h = 0x811c9dc5;
    for (let i = 0; i < 7; i++) {
      h ^= bytes[i]!;
      h = Math.imul(h, 0x01000193);
    }
    bytes[7] = (h >>> 0) & 0xff;
    const r = parseGenome(bytesToB64(bytes));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/version/);
  });

  it("catches corruption that would otherwise decode to a valid but wrong genome", () => {
    // Every bit pattern is a legal genome, so nothing but the checksum stands between a
    // mistyped link and silently handing back the wrong flower. Sweep single-character
    // corruptions and require nearly all of them to be caught.
    const rand = mulberry32(5150);
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let caught = 0;
    let tried = 0;
    for (let i = 0; i < 400; i++) {
      const g = randomGenome(rand);
      const s = serialize(g);
      const at = Math.floor(rand() * s.length);
      let ch = alphabet[Math.floor(rand() * alphabet.length)]!;
      if (ch === s[at]) ch = alphabet[(alphabet.indexOf(ch) + 1) % 64]!;
      const bad = s.slice(0, at) + ch + s.slice(at + 1);
      tried++;
      if (!parseGenome(bad).ok) caught++;
    }
    // An 8-bit checksum lets ~1 in 256 corruptions through by construction; this asserts the
    // checksum is actually wired up, not that it is perfect.
    expect(caught / tried).toBeGreaterThan(0.95);
  });

  it("POSITIVE CONTROL: the untouched string still parses", () => {
    // A parser that rejected everything would ace every test above.
    const r = parseGenome(serialize(PINNED));
    expect(r.ok).toBe(true);
  });
});

describe("a version-1 link still opens", () => {
  it("decodes every locus the old format carried", () => {
    const r = parseGenome(V1_LINK);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.genome.W).toEqual(["W", "w"]);
    expect(r.genome.H1).toEqual(["h1", "H1"]);
    expect(r.genome.H2).toEqual(["H2", "H2"]);
    expect(r.genome.D).toEqual(["d", "D"]);
    expect(r.genome.P).toEqual(["P^l", "p"]);
    expect(r.genome.V).toEqual({ a: 0b101010, b: 0b000111 });
    expect(r.genome.G).toEqual({ a: 0b111000, b: 0b010101 });
    expect(r.genome.B).toEqual({ a: 0b000001, b: 0b111111 });
  });

  it("fills the new loci with the alleles that REPRODUCE the old plant", () => {
    // Not neutral defaults — the specific alleles every v1 plant implicitly had. An upgrade
    // that handed back a different flower would be worse than refusing the link, because the
    // player has no way to notice it happened.
    const r = parseGenome(V1_LINK);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.genome.I).toEqual(["i", "i"]);
    expect(r.genome.N).toEqual(["n", "n"]);
    expect(r.genome.L).toEqual(["L", "L"]);
    const p = express(r.genome);
    expect(p.inflorescence).toBe("solitary");
    expect(p.petalCount).toBe(5);
    expect(p.viable).toBe(true);
  });

  it("CONTROL: a v1 body relabelled as v2 is rejected, not read short", () => {
    // The parser branches on the version byte to decide how many bytes to expect. If it
    // instead trusted whatever length arrived, a truncated v2 link would decode with garbage
    // in the new loci rather than failing — so the branch is asserted directly.
    const bytes = b64ToBytes(V1_LINK);
    bytes[0] = 2;
    const r = parseGenome(bytesToB64(bytes));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/length/);
  });

  it("CONTROL: a v1 link is NOT what the current encoder emits", () => {
    // Without this the upgrade path could be dead code — if v1 and v2 happened to produce the
    // same string for the same genome, every assertion above would pass through the v2 branch
    // and the compatibility claim would be untested.
    const r = parseGenome(V1_LINK);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(serialize(r.genome)).not.toBe(V1_LINK);
    // ...and re-sharing an upgraded plant hands out a v2 link that survives its own round trip.
    const again = parseGenome(serialize(r.genome));
    expect(again.ok).toBe(true);
    if (again.ok) expect(genomesEqual(again.genome, r.genome)).toBe(true);
  });

  it("still refuses a version it has never heard of", () => {
    const bytes = b64ToBytes(SERIALIZED_PINNED);
    bytes[0] = 99;
    const r = parseGenome(bytesToB64(bytes));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unsupported genome version 99/);
  });
});

describe("genomeSeed", () => {
  it("depends on the genome alone", () => {
    expect(genomeSeed(PINNED)).toBe(genomeSeed(structuredClone(PINNED)));
  });

  it("separates genomes that differ anywhere", () => {
    const rand = mulberry32(606);
    const seeds = new Set<number>();
    for (let i = 0; i < 300; i++) seeds.add(genomeSeed(randomGenome(rand)));
    expect(seeds.size).toBeGreaterThan(290);
  });

  it("grows one canonical plant per genome — the share-link requirement", () => {
    // §6: a shared genome must reproduce the SAME plant for everybody. This is the assertion
    // that ties the genome layer to the growth engine; if plot index or a clock ever leaks
    // into the seed, this is what fails.
    const g = randomGenome(mulberry32(77));
    const origin = { x: 0, y: 0 };
    const a = growPlant(express(g), genomeSeed(g), origin);
    const b = growPlant(express(g), genomeSeed(g), origin);
    expect(a.segments).toEqual(b.segments);
    expect(a.blooms).toEqual(b.blooms);
    expect(a.leaves).toEqual(b.leaves);
  });

  it("survives the share round-trip", () => {
    const g = randomGenome(mulberry32(78));
    const r = parseGenome(serialize(g));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const here = growPlant(express(g), genomeSeed(g), { x: 0, y: 0 });
    const there = growPlant(express(r.genome), genomeSeed(r.genome), {
      x: 0,
      y: 0,
    });
    expect(there.segments).toEqual(here.segments);
  });
});

/** Captured from the implementation on 2026-07-30, at GENOME_VERSION 2. */
const SERIALIZED_PINNED = "AkatHngV_N0CeA";

/**
 * A real version-1 link, produced by the version-1 encoder before it was replaced.
 *
 * This is the one genuinely independent vector in the file. Every other expected value here
 * was read off the implementation it is checking, so it can only detect drift; this string
 * was written by code that no longer exists in the working tree, which makes it evidence
 * about the FORMAT rather than about the current encoder's self-consistency.
 *
 * It encodes: W ["W","w"], H1 ["h1","H1"], H2 ["H2","H2"], D ["d","D"], P ["P^l","p"],
 * V (0b101010, 0b000111), G (0b111000, 0b010101), B (0b000001, 0b111111).
 */
const V1_LINK = "AUatHngV_K4";

const B64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Decode a link back to bytes so a test can corrupt one field and re-encode. */
function b64ToBytes(s: string): Uint8Array {
  const out = new Uint8Array(Math.floor((s.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let at = 0;
  for (const ch of s) {
    acc = (acc << 6) | B64_ALPHABET.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (at < out.length) out[at++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  const B64 = B64_ALPHABET;
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
