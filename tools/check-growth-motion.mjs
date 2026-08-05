/**
 * Does growth MOVE the same, or only look the same one frame at a time?
 *
 * `check-growth.mjs` compares the two painters AT a tick — 284 of them, continuously. It still
 * cannot see a TEMPORAL artefact, because every one of its comparisons is a still. A pop when a
 * chain stops being drawn live and starts being blitted from a baked layer, a flower that jumps
 * the last few percent of its opening, a stutter as a layer bakes — each of those is a
 * discontinuity BETWEEN two frames, and a still taken either side of one looks perfect.
 *
 * That gap was real and was known: the visual review which approved the opening relaxation
 * compared three flowers, magnified, STANDING STILL. This is the check that closes it.
 *
 * The measurement: how far the picture moves from each frame to the next, for each painter. If
 * growth reads the same, the two series track. A defect unique to the layered painter is a frame
 * where it moved much MORE than the direct painter did (a pop) or much LESS (something frozen) —
 * a ratio away from 1 at one tick, not a few percent spread across all of them.
 *
 * Local and CI both, like `check-growth.mjs` and for the same reason: it asserts a RATIO between
 * two arms measured in the same run on the same machine, so nothing in it is a frame-rate number
 * that would fail to travel.
 */
import { chromium } from "playwright";

const URL = process.env.PROBE_URL ?? "http://localhost:5173/tools/growth-probe.html";

/**
 * Below this much frame-to-frame movement, the picture has effectively stopped and a RATIO of two
 * near-zero numbers is noise about nothing.
 *
 * Not a convenience, and NOT tuned to pass. This is a ratio, so its noise grows without bound as
 * the denominator approaches zero — and the tail of growth is full of frames that have all but
 * stopped. Measured 2026-08-04: the largest layered/direct ratio in the entire run is 3.28, at
 * tick 116, where the two frames moved 0.0009. Ranked by ratio alone that tick tops the list;
 * ranked by what is actually happening on screen it is nothing at all.
 *
 * The first value here was 0.05, chosen BEFORE that noise had been measured, and it was too low
 * for the statistic to mean anything: the worst frame it admitted was tick 96 at 1.32x on motion
 * of 0.052 — noise — leaving 12% of margin to the bound below and making this check a coin flip.
 * At 0.1 the worst admitted frame is 1.150x (tick 88) against a real pop that scores 1.737x. The
 * excluded tail is always REPORTED below, so the floor can never quietly do the assertion's work.
 */
const MOTION_FLOOR = 0.1;
/**
 * How far the two painters' per-frame motion may diverge, where motion is actually happening.
 *
 * Measured worst across the growth window: **1.150** (tick 88). The gap is the opening-bitmap
 * relaxation — the bitmap is re-minified at a slightly different scale every frame, so its
 * resampling noise changes frame to frame where a vector repaint's does not. That is a few
 * percent, spread over every tick, not concentrated anywhere.
 *
 * A POP is a different shape: one frame, a multiple rather than a percentage. Verified by
 * MUTATION rather than assumed — a defect that shrinks opening flowers over ticks 42–54 scores
 * **1.737x at tick 56**, the frame they snap back. So 1.5 sits between a measured 1.150 and a
 * measured 1.737, with margin on both sides.
 *
 * ⚠️ That margin is the reason `MOTION_FLOOR` is 0.1 and not 0.05. At the lower floor the
 * baseline worst was 1.32 — noise on a nearly-still frame — and this bound would have had 12%
 * of headroom over it, which is not a gate, it is a coin flip.
 */
const RATIO_MAX = 1.5;
const RATIO_MIN = 1 / RATIO_MAX;

const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 1000, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: "networkidle" });

// Vite answers an unknown path with index.html rather than a 404, so a wrong port or a stale
// server returns 200 and a page that simply never becomes ready.
const name = await page.evaluate(() => window.__probeName);
if (name !== "heirloom-growth") {
  console.error(
    `FAIL  ${URL} did not serve the growth probe (got ${name ?? "the SPA fallback"}).\n` +
      "      Set PROBE_URL to this project's dev server — the port may belong to something else.",
  );
  await browser.close();
  process.exit(1);
}
await page.waitForFunction(() => window.__ready === true, { timeout: 20000 });

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const series = await page.evaluate(() => window.__motionSeries());

// ---- CONTROLS ------------------------------------------------------------------------------
// The assertion below is "the two series agree". Two series of zeros agree perfectly, and so do
// two series measured over a window in which nothing ever happened.
const moving = series.filter((r) => r.direct >= MOTION_FLOOR);
check(
  "CONTROL: growth actually moves — there is motion to compare",
  moving.length >= 20,
  `${moving.length} of ${series.length} frames move at least ${MOTION_FLOOR}, peak ${Math.max(...series.map((r) => r.direct)).toFixed(4)}`,
);

/** The verdict, as a function, so the control below can run the REAL one over a fake series. */
const worstRatio = (rows) => {
  let worst = { tick: -1, ratio: 1 };
  for (const r of rows) {
    const ratio = r.layered / r.direct;
    if (Math.abs(Math.log(ratio)) > Math.abs(Math.log(worst.ratio)))
      worst = { ...r, ratio };
  }
  return worst;
};

// A positive control for the VERDICT, not the renderer: plant a pop in a copy of the real series
// and confirm the same function that judges the real one rejects it. Without this, a bug in the
// ratio arithmetic would report "no pop" on every input, forever, and read as success.
const sabotaged = moving.map((r, i) =>
  i === Math.floor(moving.length / 2) ? { ...r, layered: r.layered * 3 } : r,
);
const fake = worstRatio(sabotaged);
check(
  "CONTROL: a planted pop is rejected — the verdict can fail",
  fake.ratio > RATIO_MAX,
  `a 3x jump at tick ${fake.tick} scores ${fake.ratio.toFixed(3)}, past the ${RATIO_MAX} bound`,
);

// ---- THE QUESTION --------------------------------------------------------------------------
const worst = worstRatio(moving);
check(
  "growth moves the same frame to frame, not just at each tick",
  worst.ratio <= RATIO_MAX && worst.ratio >= RATIO_MIN,
  `worst ${worst.ratio.toFixed(3)}x at tick ${worst.tick} (direct ${worst.direct.toFixed(4)}, layered ${worst.layered.toFixed(4)}) over ${moving.length} moving frames, bounds ${RATIO_MIN.toFixed(3)}–${RATIO_MAX}`,
);

// Informational: what the excluded tail looks like, so the floor is never silently doing work.
const still = series.filter((r) => r.direct < MOTION_FLOOR && r.direct > 0);
if (still.length) {
  const t = worstRatio(still);
  console.log(
    `      note: ${still.length} near-still frames excluded by the ${MOTION_FLOOR} floor; ` +
      `their worst ratio is ${t.ratio.toFixed(2)}x at tick ${t.tick}, on motion of ` +
      `${t.direct.toFixed(4)} — a ratio of two numbers that round to nothing.`,
  );
}

check("no page errors", errors.length === 0, errors.join("; "));

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\ngrowth moves the same");
process.exit(failures ? 1 : 0);
