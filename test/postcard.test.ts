import { describe, expect, it } from "vitest";
import { randomGenome } from "../src/genome/genome";
import {
  BitWriter,
  PAYLOAD_BYTES,
  base64UrlToBytes,
  bytesToBase64Url,
  checksumOf,
  serialize,
  writeGenomeBits,
} from "../src/genome/serialize";
import { mulberry32 } from "../src/rng";
import {
  BACKGROUND_REPLAY,
  MAX_PLOTS,
  MIN_PLOTS,
  computeLayout,
} from "../src/game/layout";
import {
  POSTCARD_MAX_BYTES,
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

/** The raw payload bytes for one genome, via the shared writer — not a second bit-packer. */
function genomeBytes(): number[] {
  const w = new BitWriter(PAYLOAD_BYTES);
  writeGenomeBits(w, randomGenome(rand));
  return Array.from(w.bytes);
}

/**
 * Hand-build a postcard from raw body bytes (everything except the checksum) and append a
 * correct checksum, the same way `packPostcard` does. Used to construct malformed/boundary
 * inputs `packPostcard` itself would never produce — hostile or truncated buffers — since the
 * decoder has to defend against those independent of what the encoder emits.
 */
function encode(body: number[]): string {
  const out = new Uint8Array(body.length + 1);
  out.set(body, 0);
  out[out.length - 1] = checksumOf(out, out.length - 1);
  return bytesToBase64Url(out);
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

  it("decodes a 9-plot garden's plot genomes unaffected by a 2-plot local layout", () => {
    // Fix round 1: the original version of this test only asserted plotCount === 9, which
    // "round-trips a full garden byte-exact" above already covers, and it would have passed
    // against a decoder that silently clamped to a local device's own plot count. Grounded for
    // real here: first confirm a narrow viewport's OWN layout really would produce fewer plots
    // than the sender's garden, then show that fact never reaches readPostcard at all — it
    // takes only the encoded string, decodes every one of the sender's 9 plots, and the decoded
    // genomes are byte-identical to what was packed regardless of what geometry decoded it.
    const narrowDevice = computeLayout(360, 430);
    expect(narrowDevice.plotXs.length).toBeLessThan(9);

    const p = sample(9, 5);
    const r = readPostcard(packPostcard(p));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.postcard.plotCount).toBe(9);
    expect(r.postcard.plots).toHaveLength(9);
    for (const [i, plot] of p.plots.entries()) {
      const got = r.postcard.plots[i];
      if (plot === null) expect(got).toBeNull();
      else expect(serialize(got!.genome)).toBe(serialize(plot.genome));
    }
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

  // --- Fix round 1: truncation guards previously had zero test coverage. ---

  it("names truncation when the bed data runs out mid-record", () => {
    // A valid header claiming ONE occupied plot, then only 3 of that plot's 11 record bytes
    // (1 index + 8 genome + 2 age) before the buffer ends. Long enough to clear the "too
    // short" floor (9 bytes) but far short of the full record, so this exercises need()'s
    // bed-loop call specifically, not the length floor.
    const body = [
      POSTCARD_VERSION,
      100,
      0, // W = 100
      100,
      0, // H = 100
      3, // plotCount
      1, // occupied count
      0, // plot index
      0,
      0,
      0, // 3 of 8 genome bytes, then nothing
    ];
    const r = readPostcard(encode(body));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/ends mid-bed/);
  });

  it("names the bed size when plotCount exceeds the maximum", () => {
    const body = [POSTCARD_VERSION, 100, 0, 100, 0, 200, 0, 0];
    const r = readPostcard(encode(body));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/200/);
  });

  it("rejects a plotCount of 0 rather than decoding an ok bedless garden", () => {
    const body = [POSTCARD_VERSION, 100, 0, 100, 0, 0, 0, 0];
    const r = readPostcard(encode(body));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(new RegExp(`fewest|${MIN_PLOTS}`));
  });

  it("rejects a forest count over BACKGROUND_REPLAY even with full data present", () => {
    // Not a truncated buffer: every one of the 61 claimed forest entries has real, complete
    // (genome + x) data behind it, so the existing need() length guard is satisfied and would
    // let this through. Only the explicit BACKGROUND_REPLAY cap can reject it — proving the
    // encoder's cap (BACKGROUND_REPLAY) and the decoder's cap are the same one definition, not
    // a hand-built link's word against a hash that isn't a MAC.
    const forestCount = BACKGROUND_REPLAY + 1;
    const g = genomeBytes();
    const entries: number[] = [];
    for (let i = 0; i < forestCount; i++) entries.push(...g, 0, 0);
    const body = [
      POSTCARD_VERSION,
      100,
      0, // W
      100,
      0, // H
      2, // plotCount
      0, // occupied count
      forestCount,
      ...entries,
    ];
    const r = readPostcard(encode(body));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/forest/);
  });

  // --- Fix round 2: the legitimate maximum must still decode. ---

  it("decodes a legitimate maximum-size postcard — every plot occupied, forest at its cap", () => {
    // This is the input POSTCARD_MAX_BYTES is closest to rejecting: a fully-planted garden
    // with a long history, which is to say the flagship postcard anyone would actually want to
    // share. `sample()` alternates occupied/null plots and never reaches this size on its own,
    // so it cannot stand in here. Counts are derived from MAX_PLOTS/BACKGROUND_REPLAY, not
    // hardcoded, so this keeps testing the real ceiling if either constant moves.
    const p: Postcard = {
      W: 1180,
      H: 470,
      plotCount: MAX_PLOTS,
      plots: Array.from({ length: MAX_PLOTS }, () => ({
        genome: randomGenome(rand),
        age: 100,
      })),
      forest: Array.from({ length: BACKGROUND_REPLAY }, () => ({
        genome: randomGenome(rand),
        x: 200,
      })),
    };

    const packed = packPostcard(p);
    const bytes = base64UrlToBytes(packed);
    expect(bytes).not.toBeNull();
    // Pins the constant to the real encoder output: if either drifts out of sync, this fails.
    expect(bytes!.length).toBe(POSTCARD_MAX_BYTES);

    const r = readPostcard(packed);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.postcard.plotCount).toBe(MAX_PLOTS);
    for (const [i, plot] of p.plots.entries()) {
      const got = r.postcard.plots[i];
      expect(got).not.toBeNull();
      expect(serialize(got!.genome)).toBe(serialize(plot!.genome));
    }
    expect(r.postcard.forest).toHaveLength(BACKGROUND_REPLAY);
    expect(r.postcard.forest.map((f) => serialize(f.genome))).toEqual(
      p.forest.map((f) => serialize(f.genome)),
    );
  });
});
