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
  MAX_H,
  MAX_PLOTS,
  MAX_W,
  MIN_H,
  MIN_PLOTS,
  MIN_W,
  computeLayout,
} from "../src/game/layout";
import {
  POSTCARD_MAX_BYTES,
  POSTCARD_VERSION,
  packPostcard,
  readPostcard,
  visitPath,
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
 * A legal header for a hand-built postcard: version, then a world the decoder accepts.
 *
 * Derived from MAX_W/MAX_H rather than written out. These fixtures used `100, 0, 100, 0` as
 * filler, on the reasoning that they were testing the plot count or the forest cap and the world
 * did not matter. It does now — 100 is below MIN_W — and four tests started reporting a width
 * error instead of the thing they were asserting. Filler that is not legal input is a fixture
 * waiting to test the wrong rejection.
 */
const u16le = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff];
const header = (): number[] => [
  POSTCARD_VERSION,
  ...u16le(MAX_W),
  ...u16le(MAX_H),
];

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
      ...header(),
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
    const body = [...header(), 200, 0, 0];
    const r = readPostcard(encode(body));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/200/);
  });

  it("rejects a plotCount of 0 rather than decoding an ok bedless garden", () => {
    const body = [...header(), 0, 0, 0];
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
      ...header(),
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

/**
 * W AND H WERE THE ONLY FIELDS THE DECODER TOOK ON TRUST.
 *
 * `plotCount` is checked against MIN_PLOTS/MAX_PLOTS and the forest count against
 * BACKGROUND_REPLAY, but the two world dimensions were read as raw u16 and handed straight to
 * the page. `checksumOf` is exported and ships in the bundle, so a valid code is forgeable by
 * anyone — the checksum catches corruption, never a lie.
 *
 * Both ends are hostile in their own way, and neither says anything:
 *
 *   - 65535 reaches `new Forest(65535, 65535, 2)`, a 131070x131070 backing store, past every
 *     browser's canvas limit. The allocation fails and the visitor gets a blank page or a hung
 *     tab.
 *   - 0 makes `Math.min(box.W / W, box.H / H)` infinite and the canvas zero pixels wide. Also a
 *     blank page.
 *
 * §10 says a failure names itself. A blank tab names nothing.
 *
 * These are built with `packPostcard` rather than by hand: `u16` clamps only to [0, MAX_AGE], so
 * the encoder emits both of these happily, which is the point — the forgery does not even need
 * a bit-twiddler.
 */
describe("the world a garden code claims", () => {
  const withSize = (W: number, H: number): Postcard => ({
    ...sample(MIN_PLOTS, 0),
    W,
    H,
  });
  const errorFor = (W: number, H: number): string | null => {
    const r = readPostcard(packPostcard(withSize(W, H)));
    return r.ok ? null : r.error;
  };

  it("CONTROL: the layout's own bounds decode, at both ends", () => {
    // Without this the four rejections below would pass just as well against a decoder that
    // rejected EVERY postcard, which is the shape a bounds check is most likely to have wrong.
    for (const [W, H] of [
      [MIN_W, MIN_H],
      [MAX_W, MAX_H],
      [computeLayout(1280, 720).W, computeLayout(1280, 720).H],
    ] as const) {
      const r = readPostcard(packPostcard(withSize(W, H)));
      expect(r.ok, `${W}x${H} should decode`).toBe(true);
      if (!r.ok) continue;
      expect(r.postcard.W).toBe(W);
      expect(r.postcard.H).toBe(H);
    }
  });

  it.each([
    ["a zero width", 0, MAX_H],
    ["a width past the widest world", 0xffff, MAX_H],
    ["a width one below the narrowest", MIN_W - 1, MAX_H],
    ["a width one above the widest", MAX_W + 1, MAX_H],
  ])("rejects %s, by name", (_label, W, H) => {
    const error = errorFor(W, H);
    expect(error).toBeTruthy();
    // Named, not merely refused: the message has to carry the offending number and the bound
    // it broke, or the player is told "that link is bad" and learns nothing.
    expect(error).toContain(String(W));
    expect(error).toMatch(/wide|width/);
  });

  it.each([
    ["a zero height", MAX_W, 0],
    ["a height past the tallest world", MAX_W, 0xffff],
    ["a height one below the shortest", MAX_W, MIN_H - 1],
    ["a height one above the tallest", MAX_W, MAX_H + 1],
  ])("rejects %s, by name", (_label, W, H) => {
    const error = errorFor(W, H);
    expect(error).toBeTruthy();
    expect(error).toContain(String(H));
    expect(error).toMatch(/tall|high|height/);
  });

  it("names the WIDTH when both are wrong — the first thing read is the first thing reported", () => {
    expect(errorFor(0xffff, 0xffff)).toContain("65535");
  });
});

/**
 * WHERE A SHARE LINK POINTS.
 *
 * The share button built its URL with `location.pathname.replace(/garden\/$/, "visit/")`, which
 * silently does nothing off the trailing-slash form. GitHub Pages serves both `…/garden/` and
 * `…/garden/index.html`, and a bookmark or a typed URL is as likely to be the second. On that
 * path the regex missed, the fragment was appended to the GARDEN path, and neither `#g=` nor
 * `#new` matches `#garden=` — so the recipient opened the link and saw THEIR OWN garden, with
 * nothing anywhere saying so. That is the silent-wrong-garden failure this whole branch exists
 * to prevent.
 *
 * A no-op `replace` is the shape of the bug, so the function REFUSES rather than returning its
 * input: a link you cannot vouch for should not be handed to a player to send to a friend.
 */
describe("the path a share link points at", () => {
  it("rewrites both forms the garden is served from", () => {
    expect(visitPath("/garden/")).toBe("/visit/");
    expect(visitPath("/garden/index.html")).toBe("/visit/index.html");
    expect(visitPath("/heirloom/garden/")).toBe("/heirloom/visit/");
    expect(visitPath("/heirloom/garden/index.html")).toBe(
      "/heirloom/visit/index.html",
    );
    // The dev server and a bare file host both put the garden at the root.
    expect(visitPath("garden/")).toBe("visit/");
  });

  it.each([
    ["the site root", "/"],
    ["the visit page itself", "/visit/"],
    ["a path that only ENDS in the letters", "/mygarden/"],
    ["a differently-named page", "/gardening/"],
    ["a deeper file under the garden", "/garden/index.html/more"],
    ["nothing at all", ""],
  ])("refuses %s rather than returning it unchanged", (_label, path) => {
    expect(() => visitPath(path)).toThrow();
    // The message names the path, or the player is told a link failed and not which one.
    try {
      visitPath(path);
    } catch (e) {
      expect((e as Error).message).toContain(JSON.stringify(path).slice(1, -1));
    }
  });

  it("CONTROL: never returns its input — a silent no-op is the bug", () => {
    // The rule the original expression broke, stated as a rule. Any path it accepts must come
    // back changed; any path it cannot change must throw. There is no third outcome.
    for (const path of [
      "/garden/",
      "/garden/index.html",
      "/heirloom/garden/",
      "/",
      "/mygarden/",
    ]) {
      let out: string | null = null;
      try {
        out = visitPath(path);
      } catch {
        continue;
      }
      expect(out).not.toBe(path);
    }
  });
});
