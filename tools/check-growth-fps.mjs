/**
 * Does the bed actually run at a usable frame rate WHILE a plant is growing?
 *
 * This is the number the whole growth-render exercise exists for. Everything else measured on
 * this branch — op logs, fill counts, pixel diffs — is a proxy for it. Measured before the work:
 * a 6.5–7.9fps worst free-running bucket, and about 5.0 seconds below 30fps after every planting.
 *
 * SEPARATE FROM `check-growth.mjs`, structurally and not stylistically. That file drives
 * `tools/growth-probe.html`, a dev-server page: `vite.config.ts` builds exactly four inputs and
 * the probe is not one of them, so it does not exist in a production bundle. This file drives
 * the REAL garden out of the real build. One driver cannot do both.
 *
 * LOCAL-ONLY, like `tools/check-phone.mjs` and for the reason its comment gives: a frame-rate
 * floor measured on one machine does not port to a shared two-core runner, and this project has
 * already had thresholds from one machine's sample land inside another's legitimate range. What
 * `check-growth.mjs` asserts IS portable — it re-measures its own reference every run — so that
 * one goes to CI and this one does not.
 *
 * ## Why this measures FREE-RUNNING growth and not a pinned tick
 *
 * The plan said to pin the clock at the worst tick, so the check would not depend on how fast
 * the machine grows a plant. Two things are wrong with that, and both were found by doing it:
 *
 * 1. **Pinning measures a state the game cannot enter.** Holding the clock at tick 70 holds
 *    ~265 flowers permanently mid-opening, so every one of them is re-blitted on every frame
 *    forever. A real flower opens for `OPEN_TICKS` — about 1.5 seconds — and is then baked into
 *    a layer and never drawn on its own again. Pinned, this bed reports 12.3fps; free-running,
 *    the same bed over the same growth reports a median of 59.9 with 0.7s below 30.
 * 2. **The reason for pinning no longer holds.** The clock became time-based on 2026-08-04
 *    (`ticksElapsed`), so a planting takes the same wall-clock duration on any machine. "Seconds
 *    below 30fps" is therefore a fair number to set against the pre-branch measurement, which is
 *    exactly how the problem was originally stated.
 *
 * The pinned figure is still reported below, as a note. It bounds the real worst case and is
 * worth watching — but it is not the gate, because passing or failing it says nothing about
 * what a player sees.
 */
import { chromium } from "playwright";

/**
 * SEEDED, and the numbers below are meaningless without it.
 *
 * The garden draws its genomes from `Date.now()`, so an unseeded run measures a different bed
 * every time: 100 flowers on screen at growth tick 70 in one run here, 350 in the next, which
 * moved "seconds below 30fps" from 0.00 to 1.00 with no code change. Every threshold in this
 * file would have been a coin flip. This project has been caught by that seed twice before.
 */
const SEED = 20260804;
const URL =
  (process.env.GARDEN_URL ?? "http://localhost:5173/garden/") + `?seed=${SEED}`;

/** The tick the profile showed as worst: peak flower count, nearly all still opening. */
const WORST_TICK = 70;
/** Long enough to cover a whole planting — growth plus every flower opening — and then some. */
const GROWTH_WINDOW_MS = 9000;

/**
 * The floor `check-motion.mjs` already asserts for the settled bed. Growth is held to the same
 * bar deliberately: the complaint this work answers is that the bed stops feeling alive while a
 * plant grows, and a lower floor for growth would be grading it on a curve.
 */
const FPS_FLOOR = 30;
/**
 * How long a planting may spend below that floor.
 *
 * The pre-branch measurement was ~5.0 seconds per planting, which is the complaint in one
 * number. 1.5s bounds the improvement holding; it was not tuned to pass — the measured value
 * is 0.7s.
 */
const MAX_SECONDS_BELOW = 1.5;
/**
 * Ceiling on what the growth renderer may hold, across the whole bed.
 *
 * Five layers sized to the full plant, times up to six plants, plus a bitmap per opening
 * flower. The design flagged this as a risk to measure rather than assume (spec §6). Measured
 * at 4.79MB; 192MB is here to catch a leak — a release that stops firing, or layers rebuilt
 * without the old ones being dropped — not to tune anything.
 */
const BYTES_CEILING = 192 * 1024 * 1024;

const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 1220, height: 640 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__ready === true, { timeout: 15000 });

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// A fresh garden already comes planted. Assert that rather than planting, so a change to the
// starting bed shows up as a failure here instead of as a silently empty measurement.
const occupied = await page.evaluate(() => window.__state().occupied.length);
check(
  "CONTROL: there are plants in the bed to measure",
  occupied >= 3,
  `${occupied} plots occupied`,
);

// ---- THE MEASUREMENT -------------------------------------------------------------------------
// Rewind to tick 0 and watch a whole planting go by, recording every frame interval.
const growth = await page.evaluate(
  (windowMs) =>
    new Promise((res) => {
      window.__seek(0);
      const gaps = [];
      let last = performance.now();
      const t0 = last;
      const tick = () => {
        const now = performance.now();
        gaps.push(now - last);
        last = now;
        if (now - t0 < windowMs) requestAnimationFrame(tick);
        else {
          // The first few frames include the seek itself and the layer allocation, which is
          // setup rather than steady-state growth.
          const kept = gaps.slice(3);
          const d = [...kept].sort((a, b) => a - b);
          const at = (q) => d[Math.min(d.length - 1, Math.floor(d.length * q))];
          const slow = kept.filter((g) => g > 1000 / 30);
          res({
            frames: d.length,
            medianFps: 1000 / at(0.5),
            p90Fps: 1000 / at(0.9),
            worstFps: 1000 / d[d.length - 1],
            secondsBelow: slow.reduce((s, g) => s + g, 0) / 1000,
            framesBelow: slow.length,
          });
        }
      };
      requestAnimationFrame(tick);
    }),
  GROWTH_WINDOW_MS,
);

check(
  "CONTROL: enough frames were sampled to say anything",
  growth.frames > 200,
  `${growth.frames} frames over ${GROWTH_WINDOW_MS / 1000}s`,
);
// p90, NOT the median. The window covers a whole planting, and growth is over well before the
// window is, so most frames in it are settled frames — the median is ~60fps whatever the growth
// renderer does. Verified: with this branch's routing removed, so that growth ran the way it did
// before any of this work, the median still read 59.5fps and this check PASSED. It was a check
// that could not fail. The p90 over the same run was 10.4fps against 36.2 with the layered
// painter, which is the difference the window actually contains.
check(
  "growth runs at the frame rate the settled bed does",
  growth.p90Fps > FPS_FLOOR,
  `p90 ${growth.p90Fps.toFixed(1)} fps, median ${growth.medianFps.toFixed(1)}, worst frame ${growth.worstFps.toFixed(1)}`,
);
check(
  "a planting no longer spends seconds below the floor",
  growth.secondsBelow < MAX_SECONDS_BELOW,
  `${growth.secondsBelow.toFixed(2)}s below ${FPS_FLOOR}fps across ${growth.framesBelow} frames, against ~5.0s before this work`,
);

// ---- THE PINNED WORST CASE, AS A NOTE ---------------------------------------------------------
const pinned = await page.evaluate(
  (t) =>
    new Promise((res) => {
      let stop = false;
      const pin = () => {
        window.__seek(t);
        if (!stop) requestAnimationFrame(pin);
      };
      requestAnimationFrame(pin);
      setTimeout(() => {
        let n = 0;
        const t0 = performance.now();
        const sample = () => {
          n++;
          if (performance.now() - t0 < 2500) requestAnimationFrame(sample);
          else {
            stop = true;
            res(n / ((performance.now() - t0) / 1000));
          }
        };
        requestAnimationFrame(sample);
      }, 400);
    }),
  WORST_TICK,
);
const onScreen = await page.evaluate(() => window.__blooms().length);
console.log(
  `      note: with the clock PINNED at tick ${WORST_TICK} — all ${onScreen} flowers held ` +
    `mid-opening forever, which growth never does — the bed runs at ${pinned.toFixed(1)} fps. ` +
    `That bounds the real worst case; it is not it.`,
);

// ---- MEMORY -----------------------------------------------------------------------------------
// The design named this a risk to MEASURE rather than assume, and nothing else in the suite
// would notice a release that quietly stopped firing.
const held = await page.evaluate(async (t) => {
  window.__seek(t);
  for (let i = 0; i < 8; i++)
    await new Promise((r) => requestAnimationFrame(r));
  return window.__growthBytes();
}, WORST_TICK);
check(
  "the growth layers stay inside their memory bound",
  held > 0 && held < BYTES_CEILING,
  held > 0
    ? `${(held / 1048576).toFixed(2)}MB held across the bed, ceiling ${BYTES_CEILING / 1048576}MB`
    : "zero bytes held mid-growth — nothing was measured, which is not the same as nothing being held",
);

// ...and that it is GIVEN BACK. A bound checked only mid-growth would pass a renderer that never
// released a single layer, because it would never be asked afterwards.
const afterSettle = await page.evaluate(async () => {
  window.__seek(4000);
  for (let i = 0; i < 8; i++)
    await new Promise((r) => requestAnimationFrame(r));
  return window.__growthBytes();
});
check(
  "and are handed back once the plants settle",
  afterSettle === 0,
  `${(afterSettle / 1048576).toFixed(2)}MB still held after settling`,
);

check("no page errors", errors.length === 0, errors.join("; "));

await browser.close();
console.log(
  failures ? `\n${failures} check(s) failed` : "\ngrowth runs at speed",
);
process.exit(failures ? 1 : 0);
