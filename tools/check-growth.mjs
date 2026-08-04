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
 * Max channel delta while flowers are opening.
 *
 * The one relaxation in the design: an opening flower will eventually be blitted from its own
 * bitmap rather than re-derived (Task 7), which resamples where the vector path would not. The
 * number is the worst pixel measured across three bloom archetypes in the visual review that
 * approved the trade — it is a ceiling carried over from that measurement, not a knob.
 */
const OPENING_CEILING = 56;

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
for (const tick of SETTLED_TICKS) {
  const cached = await page.evaluate((t) => window.__compare(t, "direct-vs-cached"), tick);
  const layered = await page.evaluate((t) => window.__compare(t, "direct-vs-layered"), tick);
  check(
    `tick ${tick} settled: layered is no worse than the shipped cache`,
    layered.max <= cached.max + MAX_TOLERANCE &&
      layered.mean <= cached.mean * MEAN_TOLERANCE,
    `layered max ${layered.max}/255 mean ${layered.mean.toFixed(4)} vs cached max ${cached.max}/255 mean ${cached.mean.toFixed(4)}`,
  );
}

// GROWING — the cache is NOT a baseline here. Forced on mid-growth it freezes the plant at
// whatever it cached first, which is a broken render, not a standard to be measured against.
// The bar is the reference above: the layered painter, while the plant is still changing, must
// be no further from a direct paint than the cache is when it is working correctly.
//
// The 1.25 on max is because a different amount of geometry is on screen at each tick, not to
// make anything pass; the mean, which is the stable statistic, is held to the reference flat.
for (const tick of GROWING_TICKS) {
  const layered = await page.evaluate((t) => window.__compare(t, "direct-vs-layered"), tick);
  check(
    `tick ${tick} growing: layered is within the cache's own error budget`,
    layered.max <= REFERENCE.max * 1.25 && layered.mean <= REFERENCE.mean,
    `layered max ${layered.max}/255 mean ${layered.mean.toFixed(4)} vs reference max ${REFERENCE.max}/255 mean ${REFERENCE.mean.toFixed(4)}`,
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
