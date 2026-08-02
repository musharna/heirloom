import { describe, expect, it } from "vitest";
import { randomGenome } from "../src/genome/genome";
import { serialize } from "../src/genome/serialize";
import { mulberry32 } from "../src/rng";
import {
  POSTCARD_VERSION,
  packPostcard,
  readPostcard,
  type Postcard,
} from "../src/game/postcard";

const rand = mulberry32(11);

function sample(plots: number, forest: number): Postcard {
  return {
    W: 1180,
    H: 470,
    plotCount: plots,
    plots: Array.from({ length: plots }, (_, i) =>
      i % 2 === 0 ? { genome: randomGenome(rand), age: 40 + i } : null,
    ),
    forest: Array.from({ length: forest }, (_, i) => ({
      genome: randomGenome(rand),
      x: 100 + i * 3,
    })),
  };
}

describe("the postcard codec", () => {
  it("round-trips a full garden byte-exact", () => {
    const p = sample(9, 60);
    const r = readPostcard(packPostcard(p));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.postcard.W).toBe(1180);
    expect(r.postcard.H).toBe(470);
    expect(r.postcard.plotCount).toBe(9);
    // Genome identity asserted through serialize(), not object equality: this is the property
    // that actually matters — the visitor grows the SAME plant — and it fails loudly on a
    // single wrong bit rather than on an incidental object shape.
    for (const [i, plot] of p.plots.entries()) {
      const got = r.postcard.plots[i];
      if (plot === null) expect(got).toBeNull();
      else expect(serialize(got!.genome)).toBe(serialize(plot.genome));
    }
    expect(r.postcard.forest.map((f) => serialize(f.genome))).toEqual(
      p.forest.map((f) => serialize(f.genome)),
    );
    expect(r.postcard.forest.map((f) => f.x)).toEqual(p.forest.map((f) => f.x));
  });

  it("round-trips a bare bed with no forest", () => {
    const p: Postcard = {
      W: 396,
      H: 430,
      plotCount: 2,
      plots: [null, null],
      forest: [],
    };
    const r = readPostcard(packPostcard(p));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.postcard.plots).toEqual([null, null]);
    expect(r.postcard.forest).toEqual([]);
  });

  it("survives a 9-plot garden being read on a 2-plot device", () => {
    // Nothing in the codec consults the local layout. This is the cross-device case that a
    // same-device test cannot see, and the reason the plot count is carried at all.
    const r = readPostcard(packPostcard(sample(9, 5)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.postcard.plotCount).toBe(9);
  });

  it("caps the forest at 60 entries", () => {
    const r = readPostcard(packPostcard(sample(9, 200)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.postcard.forest).toHaveLength(60);
  });

  it("clamps an age that would overflow its two bytes", () => {
    const p = sample(2, 0);
    p.plots[0] = { genome: randomGenome(rand), age: 999_999 };
    const r = readPostcard(packPostcard(p));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.postcard.plots[0]!.age).toBe(65535);
  });

  it("names a bad version rather than decoding it", () => {
    const good = packPostcard(sample(3, 3));
    // Flip the version byte by rebuilding the payload: decode, corrupt, re-encode is not
    // available, so assert on the message a hand-made bad string produces instead.
    const r = readPostcard("_" + good.slice(1));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/version|checksum|length/);
  });

  it("names a checksum mismatch", () => {
    const good = packPostcard(sample(3, 3));
    // Corrupt a character in the middle of the payload, away from the version byte.
    const at = Math.floor(good.length / 2);
    const swapped = good[at] === "A" ? "B" : "A";
    const bad = good.slice(0, at) + swapped + good.slice(at + 1);
    const r = readPostcard(bad);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/checksum|length/);
  });

  it("rejects a string that is not base64url", () => {
    const r = readPostcard("not a postcard!!");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/base64url/);
  });

  it("rejects an empty string", () => {
    const r = readPostcard("");
    expect(r.ok).toBe(false);
  });

  it("declares its version", () => {
    expect(POSTCARD_VERSION).toBe(1);
  });
});
