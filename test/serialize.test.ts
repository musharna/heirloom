import { describe, it, expect } from "vitest";
import { mulberry32 } from "../src/rng";
import {
  GENOME_VERSION,
  genomeSeed,
  parseGenome,
  serialize,
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
    expect(s.length).toBeLessThanOrEqual(12);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is stable for a pinned genome", () => {
    // If this changes, the wire format changed: bump GENOME_VERSION or every shared link
    // already in the wild now decodes to a different flower.
    expect(serialize(PINNED)).toBe(SERIALIZED_PINNED);
  });

  it("distinguishes genomes that differ in a single polygenic bit", () => {
    const a: Genome = { ...PINNED, V: poly(0b101010, 0b000111) };
    const b: Genome = { ...PINNED, V: poly(0b101011, 0b000111) };
    expect(serialize(a)).not.toBe(serialize(b));
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

/** Captured from the implementation on 2026-07-30, at GENOME_VERSION 1. */
const SERIALIZED_PINNED = "AUatHngV_K4";

function bytesToB64(bytes: Uint8Array): string {
  const B64 =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
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
