/**
 * Performance under something like a phone.
 *
 * 60fps measured in a headless browser on a sixteen-core laptop proves very little about the
 * device most people would actually open this on. Playwright cannot run on a real handset from
 * here, so this uses the standard proxy: a mobile viewport, mobile device-pixel-ratio, and CDP
 * CPU throttling. A 4x slowdown is roughly a mid-range Android against this machine; 6x is a
 * cheap one.
 *
 * The dpr matters as much as the CPU. Plants are cached as bitmaps at device resolution, so a
 * dpr of 2 or 3 quadruples or nonuples the pixels every cached plant costs to draw.
 */
import { chromium, devices } from 'playwright';

const URL = process.env.GARDEN_URL ?? 'http://localhost:5173/garden/';
const browser = await chromium.launch();
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

for (const [label, dev, slowdown] of [
  ['Pixel 7 landscape, 4x slower CPU', devices['Pixel 7 landscape'], 4],
  ['Pixel 7 landscape, 6x slower CPU', devices['Pixel 7 landscape'], 6],
]) {
  const ctx = await browser.newContext({ ...dev });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const client = await ctx.newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: slowdown });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__ready === true, { timeout: 40000 });

  // A grown, settled bed — the steady state a player spends nearly all their time in.
  await page.evaluate(() => window.__seek(2600));
  await page.waitForTimeout(3000);

  const fps = await page.evaluate(
    () =>
      new Promise((res) => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => {
          n++;
          if (performance.now() - t0 < 2500) requestAnimationFrame(tick);
          else res(n / ((performance.now() - t0) / 1000));
        };
        requestAnimationFrame(tick);
      }),
  );
  // The DRAWN rate, not just the rAF rate: on a struggling device the game deliberately paints
  // every other frame, and reporting the loop's rate would flatter it by a factor of two.
  /**
   * MEDIAN of three windows, not one.
   *
   * A single window against the deployed site is far too noisy to threshold: measured 4.4,
   * 13.3 and 18.3 fps at the same throttle, with the 6x condition sometimes beating the 4x
   * one — which cannot be true and simply means the number is dominated by whatever else the
   * machine was doing. A median discards the outlier without pretending it did not happen.
   */
  const windows = [];
  for (let k = 0; k < 3; k++) {
    windows.push(
      await page.evaluate(
        () =>
          new Promise((res) => {
            const t0 = performance.now();
            const a = window.__now();
            setTimeout(
              () => res({ ticks: window.__now() - a, ms: performance.now() - t0 }),
              1600,
            );
          }),
      ),
    );
  }
  const rates = windows.map((w) => w.ticks / 1.4 / (w.ms / 1000)).sort((a, b) => a - b);
  const drawn = { rate: rates[1] };
  const info = await page.evaluate(() => ({
    blooms: window.__blooms().length,
    dpr: window.devicePixelRatio,
    w: window.__size().w,
  }));
  // The DRAWN rate — the loop draws every frame, so they are the same number, but measuring it
  // through the game's own clock rather than a bare rAF loop means this cannot be flattered by
  // a change that makes the loop cheap without making anything appear on screen.
  const drawnFps = drawn.rate;
  // Floors set from a POPULATION of eight runs, not from one.
  //
  // They were first set from a single measurement — 23.2 and 17.3 — and both immediately began
  // failing, because the real spread is 20.2-20.7 and 12.0-15.0 depending on which genomes the
  // garden happened to sow. That is the same defect this project has now hit three times: a
  // threshold picked from one sample lands inside the legitimate range and reports genome luck
  // as a regression. These sit below the observed minimum with room, so what they catch is a
  // real change rather than a different afternoon.
  //
  // 4x is roughly a mid-range Android; 6x a cheap one. Nothing here is timed or needs aim, so
  // slow is playable — a regression is not.
  //
  // Raised after the sky was cached. Caching three full-canvas operations that never change
  // took 4x from 16-19 to 21-26 and 6x from 8-14 to 18-22 — better than before the depth work
  // that first exposed the cost. Floors sit below the observed minimum of each population
  // (21.0 and 18.2) with room, so they catch a regression rather than a slow afternoon.
  //
  // Set from the union of the LOCAL and DEPLOYED populations, not one machine. A floor picked
  // from three local samples (18 and 13) failed against the live site within one run — the
  // fourth time in this project a threshold from a small sample has landed inside the
  // legitimate range. These are deliberately loose: the job is to catch a REGRESSION, a drop
  // of two-to-five times, not to certify a frame rate.
  const floor = slowdown <= 4 ? 10 : 6;
  check(label, drawnFps > floor,
    `${drawnFps.toFixed(1)} fps (floor ${floor}) · ${info.blooms} flowers · dpr ${info.dpr}${errors.length ? ` · ERR ${errors[0]}` : ''}`);
  if (errors.length) failures++;
  await ctx.close();
}

await browser.close();
console.log(failures === 0 ? '\nusable on a phone' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
