/**
 * Does the layered painter draw the same plant as the direct one?
 *
 * `test/passes.test.ts` and `test/growing.test.ts` compare OPERATION LOGS. Those cannot see a
 * compositing difference, a transform that leaked across a layer boundary, or a gradient built
 * in the wrong coordinate space — all of which are exactly what a layered renderer gets wrong.
 * Only real pixels can, so this runs against the dev server where the probe page imports
 * `/src` modules directly.
 *
 * THE BAR IS NOT ZERO, and it is not a constant either — it is re-measured every run from the
 * SHIPPED cache, on the same plants. See the note on MAX_TOLERANCE below for why an absolute
 * number was tried first and was wrong.
 *
 * If a check here starts failing, the render changed. Do not widen the tolerance.
 */
import { chromium } from "playwright";

const URL = process.env.PROBE_URL ?? "http://localhost:5173/tools/growth-probe.html";

/**
 * The bar is RELATIVE, and measured every run.
 *
 * An absolute number was tried and was wrong: 3/255 came from a synthetic probe that composited
 * aligned, same-size canvases, which is not what either painter does. Both blit an
 * integer-sized bitmap to FRACTIONAL world coordinates — `ctx.drawImage(canvas, x, y, w, h)`
 * with x and w fractional — so the whole image is resampled. Measured, the shipped
 * `paintPlantCached` differs from a direct paint by max 104/255 on 3.68% of channels.
 *
 * So the reference is the shipped cache itself, re-measured here on the same plants with the
 * same instrument. That is what the design asked for and it is not circular: the baseline is
 * behaviour that shipped weeks ago, not anything this branch produced.
 */
const MAX_TOLERANCE = 4;
const MEAN_TOLERANCE = 1.05;
/**
 * How much slack a growth frame gets over the settled reference, for the opening relaxation.
 *
 * **RETRACTED as an absolute ceiling, 2026-08-04.** This was 56/255, "the worst pixel measured
 * across three bloom archetypes in the visual review that approved the trade". That review
 * compared flowers magnified 9x with nearest-neighbour sampling over a common backdrop. The
 * code does not do that. It blits an integer-sized bitmap to FRACTIONAL world coordinates, and
 * measured that way a blit at 1:1 — no scaling whatsoever, so no relaxation involved at all —
 * already differs by 137/255.
 *
 * This is the SECOND time a bar on this branch was measured on an operation the code does not
 * perform; the first was the 3/255 settled bar in Task 5, and it has the same shape. The rule
 * both times: measure the bar on the operation the code actually performs.
 *
 * So the isolated check below uses an unscaled blit as its reference and this number is only
 * the whole-frame allowance, where it is generous by construction and not load-bearing.
 */
const OPENING_CEILING = 56;
/**
 * How far a blitted flower's silhouette may sit from a painted one, in pixels.
 *
 * Bilinear resampling spreads an antialiased edge about a pixel outward, so the bitmap's
 * outline lands a pixel wide of the vector one. It does not MOVE it. Anything beyond this is a
 * transform that disagrees with `withBloomTransform`, not sampling.
 */
const BOX_SLACK = 3;
/**
 * How far the summed silhouette of 451 blitted flowers may differ from the painted ones.
 *
 * Resampling widens each edge by well under a pixel, and summed over hundreds of small flowers
 * that lands a few percent high. A wrong transform is PROPORTIONAL — the squash factor here
 * ranges 0.55–1.0, so applying it twice moves this ratio by tens of percent. Summing is what
 * makes the two separable: on a single 6px-tall flower a 45% squash is 3px, which is the same
 * order as edge bleed, and the check would not be able to tell them apart.
 */
const SHAPE_SLACK = 0.08;

/** Settled ticks, where every bloom has finished opening. */
const SETTLED_TICKS = [140, 200, 900];
/** Ticks inside the growth window, where flowers are still animating. */
const GROWING_TICKS = [20, 40, 55, 70, 90];

const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 1000, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: "networkidle" });

// Vite answers an unknown path with index.html rather than a 404, so a wrong port or a stale
// server returns 200 and a page that simply never becomes ready. That happened: port 5173 was
// held by a different project's dev server and this driver spent 30s timing out on a page it
// had no business loading. Name the problem instead.
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

// ---- CONTROLS FIRST ------------------------------------------------------------------------
// Every assertion below is "the difference is small". That is satisfied by a harness that
// cannot see any difference at all, and by two blank canvases.

const ink = await page.evaluate(() => window.__ink(140));
check(
  "CONTROL: the plants actually draw something",
  ink > 20000,
  `${ink} non-background pixels across 4 plants`,
);

const zero = await page.evaluate(() => window.__compare(140, "direct-vs-direct"));
check(
  "CONTROL: the harness reports exactly zero when both arms are the direct painter",
  zero.max === 0 && zero.differing === 0,
  `max ${zero.max}, ${zero.differing} channels differing`,
);

const shifted = await page.evaluate(() => window.__compare(140, "direct-vs-shifted"));
check(
  "CONTROL: the harness detects a one-pixel shift",
  shifted.max > 20,
  `max ${shifted.max}/255, ${shifted.pct.toFixed(2)}% of channels`,
);

// ---- THE ACTUAL QUESTION -------------------------------------------------------------------

// The reference, measured once: what the SHIPPED cache costs where it is legitimately used.
const REFERENCE = await page.evaluate(() => window.__compare(900, "direct-vs-cached"));
check(
  "CONTROL: the shipped cache is itself not pixel-perfect, so the bar is a real one",
  REFERENCE.max > 0,
  `today's cache differs from a direct paint by max ${REFERENCE.max}/255, mean ${REFERENCE.mean.toFixed(4)}`,
);

// SETTLED — a like-for-like comparison. Both painters are doing the job they exist for.
//
// BOTH arms of the layered painter are measured, because they answer different questions and
// only one of them existed before the painter became incremental:
//
//   "layered" builds every layer inside ONE call. It measures COMPOSITING.
//   "swept"   paints frame after frame, the way the game does. It measures the INCREMENTAL
//             BAKE — whether growth accumulated over a hundred frames lands in the same place,
//             and in the same ORDER, as growth painted in a single go.
//
// A one-shot comparison cannot fail on a bad bake, because a bad bake takes two frames to
// happen. Without the swept arm this file would pass a painter that mis-ordered every stem it
// ever baked, and the ordering is the thing the pass structure exists to protect.
for (const tick of SETTLED_TICKS) {
  const cached = await page.evaluate((t) => window.__compare(t, "direct-vs-cached"), tick);
  const layered = await page.evaluate((t) => window.__compare(t, "direct-vs-layered"), tick);
  const swept = await page.evaluate((t) => window.__compare(t, "direct-vs-swept"), tick);
  check(
    `tick ${tick} settled: layered is no worse than the shipped cache`,
    layered.max <= cached.max + MAX_TOLERANCE &&
      layered.mean <= cached.mean * MEAN_TOLERANCE,
    `layered max ${layered.max}/255 mean ${layered.mean.toFixed(4)} vs cached max ${cached.max}/255 mean ${cached.mean.toFixed(4)}`,
  );
  check(
    `tick ${tick} settled: grown frame-by-frame, it lands in the same place`,
    swept.max <= cached.max + MAX_TOLERANCE &&
      swept.mean <= cached.mean * MEAN_TOLERANCE,
    `swept max ${swept.max}/255 mean ${swept.mean.toFixed(4)} vs cached max ${cached.max}/255 mean ${cached.mean.toFixed(4)}`,
  );
}

// GROWING — the cache is NOT a baseline here. Forced on mid-growth it freezes the plant at
// whatever it cached first, which is a broken render, not a standard to be measured against.
// The bar is the reference above: the layered painter, while the plant is still changing, must
// be no further from a direct paint than the cache is when it is working correctly.
//
// A growth frame carries exactly two sources of error, and the ceiling is their sum rather than
// a round number that happened to fit:
//
//   REFERENCE.max     the resampling every baked layer pays, measured this run off the SHIPPED
//                     cache — the same cost the game has been paying for settled plants.
//   OPENING_CEILING   the opening-bitmap relaxation, bounded by the visual review that approved
//                     it (spec §2). It applies to a flower only while it opens.
//
// This replaces a `* 1.25` that had no derivation. The mean is the stable statistic and is held
// to the reference FLAT, with no allowance at all.
const CEILING = REFERENCE.max + OPENING_CEILING;
for (const tick of GROWING_TICKS) {
  const layered = await page.evaluate((t) => window.__compare(t, "direct-vs-layered"), tick);
  const swept = await page.evaluate((t) => window.__compare(t, "direct-vs-swept"), tick);
  check(
    `tick ${tick} growing: layered is within the cache's own error budget`,
    layered.max <= CEILING && layered.mean <= REFERENCE.mean,
    `layered max ${layered.max}/255 mean ${layered.mean.toFixed(4)} vs ceiling ${CEILING}/255 mean ${REFERENCE.mean.toFixed(4)}`,
  );
  check(
    `tick ${tick} growing: and so is the frame-by-frame bake`,
    swept.max <= CEILING && swept.mean <= REFERENCE.mean,
    `swept max ${swept.max}/255 mean ${swept.mean.toFixed(4)} vs ceiling ${CEILING}/255 mean ${REFERENCE.mean.toFixed(4)}`,
  );
}

// ---- THE ONE RELAXATION, MEASURED ON ITS OWN -----------------------------------------------
// An opening flower is blitted from its own bitmap rather than re-derived, which resamples
// where the vector path would not. The design bounded that at the worst pixel of the visual
// review which approved it. Asserting it against a whole growth frame does not work: the frame
// also carries the baked layers' resampling, which is larger, and a flower-sized error hides
// inside it. Measured — with the squash deliberately applied twice, so that every opening
// flower on screen was the wrong shape, three of the five whole-frame growth checks PASSED.
//
// The reference is a blit at opening 1 — the SAME bitmap, drawn at 1:1, with no scaling at all.
// Whatever that costs is what blitting costs in this renderer, and it is already paid by every
// layer and by the shipped `paintPlantCached`. Anything above it is what the RELAXATION costs,
// which is the only new thing here.
//
// See the note on OPENING_CEILING for why an absolute 56/255 was tried first and was wrong.
const UNSCALED = await page.evaluate(() => window.__openingError(1));
check(
  "CONTROL: even an unscaled blit is not pixel-perfect, so the reference is a real one",
  UNSCALED.max > 0 && UNSCALED.flowers > 100,
  `1:1 blit differs by max ${UNSCALED.max}/255, mean ${UNSCALED.mean.toFixed(5)}, over ${UNSCALED.flowers} flowers`,
);
check(
  "CONTROL: the bitmap is big enough — a blitted flower is not missing ink",
  UNSCALED.inkBitmap >= UNSCALED.inkVector,
  `${UNSCALED.inkBitmap} inked pixels from the bitmap vs ${UNSCALED.inkVector} painted — a bitmap sized too small would lose petal tips and come out BELOW`,
);

// 0.32 is where a flower starts (`openingAt`), so it is the most minified the bitmap ever is,
// and the worst case for this comparison.
for (const o of [0.32, 0.5, 0.8, 1]) {
  const iso = o === 1 ? UNSCALED : await page.evaluate((v) => window.__openingError(v), o);
  check(
    `opening ${o}: scaling the bitmap costs no more than blitting it already does`,
    iso.max <= UNSCALED.max + MAX_TOLERANCE && iso.flowers === UNSCALED.flowers,
    `max ${iso.max}/255 mean ${iso.mean.toFixed(5)} over ${iso.flowers} flowers, vs unscaled ${UNSCALED.max}/255`,
  );
  // The check the budget above CANNOT make. A reference measured through the same blit
  // inherits whatever that blit gets wrong, so an error budget compares a broken arm against
  // a broken baseline and passes. The flower's silhouette does not go through the blit —
  // it is where the flower IS — so a transform that moves or reshapes it shows up here and
  // nowhere else. BOX_SLACK is resampling bleed at the edge, not room for a wrong transform.
  check(
    `opening ${o}: the blitted flower is the same SHAPE, in the same place`,
    Math.abs(iso.wRatio - 1) <= SHAPE_SLACK &&
      Math.abs(iso.hRatio - 1) <= SHAPE_SLACK &&
      iso.boxOff <= BOX_SLACK,
    `silhouette ${iso.wRatio.toFixed(3)}x wide, ${iso.hRatio.toFixed(3)}x tall, worst corner ${iso.boxOff}px`,
  );
}

// Informational, and the motivation for this whole exercise: what simply switching the still
// cache on during growth would have looked like.
const naive = await page.evaluate(() => window.__compare(20, "direct-vs-cached"));
const good = await page.evaluate(() => window.__compare(20, "direct-vs-layered"));
console.log(
  `      note: at tick 20 the still cache forced on is mean ${naive.mean.toFixed(3)} off a direct ` +
    `paint; the layered painter is ${good.mean.toFixed(3)} — ${(naive.mean / good.mean).toFixed(0)}x closer.`,
);

const hidpiCached = await page.evaluate(() => window.__compare(200, "direct-vs-cached", 2));
const hidpiLayered = await page.evaluate(() => window.__compare(200, "direct-vs-layered", 2));
check(
  "holds at dpr 2, not only dpr 1",
  hidpiLayered.max <= hidpiCached.max + MAX_TOLERANCE,
  `layered ${hidpiLayered.max}/255 vs cached ${hidpiCached.max}/255`,
);

check("no page errors", errors.length === 0, errors.join("; "));

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall growth-render checks passed");
process.exit(failures ? 1 : 0);
