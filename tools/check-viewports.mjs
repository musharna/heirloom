/**
 * Aspect-ratio regression guard across real device viewports.
 *
 * The defect this exists for: the canvas CSS was `max-width: 100vw` against a fixed inline
 * height, so on a phone 1180x470 of content (aspect 2.51) was painted into a 412x470 box
 * (aspect 0.88) — a 185% distortion. It looked correct on every desktop viewport, which is
 * why it survived until the site was reachable from a phone.
 *
 * SEEN FAILING: measured at 185% distortion against the pre-fix code, and at 0.0-0.2% after.
 * The 2% threshold sits far below the defect and far above rounding.
 *
 *   GARDEN_URL=... node tools/check-viewports.mjs
 */
import { chromium, devices } from 'playwright';
import { gestures } from './gestures.mjs';
const b = await chromium.launch();
let fails = 0;
for (const [name, dev] of [['Pixel 7 portrait', devices['Pixel 7']],
                           ['Pixel 7 landscape', devices['Pixel 7 landscape']],
                           ['iPhone 15', devices['iPhone 15']],
                           ['desktop', { viewport: { width: 1440, height: 900 } }]]) {
  const ctx = await b.newContext({ ...dev });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(process.env.GARDEN_URL ?? 'http://localhost:5173/garden/', { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.__ready === true, { timeout: 15000 });
  const m = await p.evaluate(() => {
    const c = document.getElementById('c'); const r = c.getBoundingClientRect();
    return { boxA: r.width / r.height, bufA: c.width / c.height, w: Math.round(r.width), h: Math.round(r.height),
             vw: innerWidth, vh: innerHeight, hintLines: document.getElementById('hint').getClientRects().length };
  });
  const distortion = Math.abs(m.boxA - m.bufA) / m.bufA;
  const ok = distortion < 0.02 && m.w <= m.vw && errs.length === 0;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(18)} box ${m.w}x${m.h} in ${m.vw}x${m.vh} | aspect ${m.boxA.toFixed(2)} vs ${m.bufA.toFixed(2)} | distortion ${(distortion*100).toFixed(1)}%${errs.length?' | ERR '+errs[0]:''}`);
  await ctx.close();
}
// --- Rotation: the world RESHAPES, and nothing is silently lost --------------------------
//
// A phone rotated to landscape is a different garden, not the same garden scaled — it has room
// for more plots. Nothing else in the suite covers relayout, and its failure modes are quiet
// ones: plants vanishing instead of retiring, a stale background buffer at the wrong size, a
// canvas whose transform was reset without the dpr scale being re-applied.
{
  const ctx = await b.newContext({ ...devices['Pixel 7'] });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(process.env.GARDEN_URL ?? 'http://localhost:5173/garden/', { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.__ready === true, { timeout: 15000 });

  const state = () => p.evaluate(() => {
    const c = document.getElementById('c');
    const s = window.__state();
    return { ...s, plots: s.occupied.length + (s.empty >= 0 ? 1 : 0), bufW: c.width, bufH: c.height,
             plotCount: window.__plotCount(), world: window.__size() };
  });

  const portrait = await state();
  await p.setViewportSize({ width: 863, height: 360 });
  await p.waitForTimeout(500);

  // FILL the landscape bed before rotating back. Without this the surplus-retires check is
  // vacuous: with one plant and 4->2 plots the assertion reads `0 >= -1` and passes on any
  // implementation, including one that deletes plants outright.
  await p.evaluate(() => window.__seek(900));
  await p.waitForTimeout(300);
  for (let round = 0; round < 6; round++) {
    const s = await p.evaluate(() => window.__state());
    if (s.empty < 0) break;
    const flowers = await p.evaluate(() => window.__blooms());
    if (!flowers.length) break;
    const box2 = await p.locator('#c').boundingBox();
    const world = await p.evaluate(() => window.__size());
    const toPg = (q) => ({ x: box2.x + (q.x * box2.width) / world.w, y: box2.y + (q.y * box2.height) / world.h });
    // Try a few flowers rather than one. A single click that lands in a gap between petals
    // yields no seed, the round does nothing, and the whole check then fails on "bed did not
    // fill" — a flaky harness reporting a defect that is not there. Seen once in five runs.
    let got = s.tray;
    const g = gestures(p, box2, world);
    for (const cand of [flowers[Math.floor(flowers.length / 2)], flowers[0], flowers.at(-1)]) {
      // `tap`, not a raw down/up: a press slower than 450ms is a HOLD, which reads the plant
      // instead of taking a seed. That failure looked like "the bed would not fill".
      await g.tap(cand);
      got = (await p.evaluate(() => window.__state())).tray;
      if (got > s.tray) break;
    }
    if (got === s.tray) break; // no seed obtainable; leave the loop rather than spin
    const slot = await p.evaluate(() => window.__traySlot(0));
    const soil = await p.evaluate(() => window.__soil);
    const px = await p.evaluate((i) => window.__plotX(i), s.empty);
    const a2 = toPg(slot), z2 = toPg({ x: px, y: soil - 25 });
    await p.mouse.move(a2.x, a2.y); await p.mouse.down();
    await p.mouse.move(z2.x, z2.y, { steps: 8 }); await p.mouse.up();
    await p.waitForTimeout(150);
  }

  const landscape = await state();
  await p.setViewportSize({ width: 412, height: 839 });

  // Wait on the COMPOSITED buffer, not on `retired`.
  //
  // relayout() moves the surplus into garden.retired SYNCHRONOUSLY, so `retired >= n` is
  // already true before the frame loop has drawn anything — waiting on it returned instantly
  // and read a legitimately-empty buffer as a failure. The signal that actually means "the
  // rebuild finished" is the buffer having pixels in it.
  await p
    .waitForFunction(() => window.__state().forestCoverage > 0, undefined, {
      timeout: 8000,
    })
    .catch(() => {});
  const back = await state();

  const expectedRetired = Math.max(0, landscape.planted - back.plotCount);
  const grew = landscape.plotCount > portrait.plotCount;
  const shrank = back.plotCount < landscape.plotCount;
  // A real number now, not a tautology: the bed was filled above, so surplus > 0.
  const retiredNotLost =
    expectedRetired > 0 && back.retired - landscape.retired === expectedRetired;
  const bufferResized = landscape.bufW !== portrait.bufW;

  for (const [label, ok, detail] of [
    ['rotating to landscape widens the bed', grew, `${portrait.plotCount} -> ${landscape.plotCount} plots`],
    ['the landscape bed actually filled', landscape.planted >= 3, `planted ${landscape.planted}`],
    ['rotating back narrows the bed', shrank, `${landscape.plotCount} -> ${back.plotCount} plots`],
    ['surplus plants RETIRE, they do not vanish', retiredNotLost,
      `planted ${landscape.planted} into ${back.plotCount} plots -> retired +${back.retired - landscape.retired}, expected +${expectedRetired}`],
    ['the narrowed bed is full, not empty', back.planted === back.plotCount, `planted ${back.planted} of ${back.plotCount}`],
    ['the drawing buffer follows the world', bufferResized, `${portrait.bufW} -> ${landscape.bufW}`],
    // Scale-free: a fraction of the buffer's own pixel area, not an absolute count. Coverage
    // depends on WHICH genomes retired — a compact droopy plant at depth 1 (scale 0.64,
    // alpha 0.28, blur 3) covers two orders of magnitude fewer pixels than a large bush.
    // Measured across runs: 826 and 23,816 and 34,849 when correct, 157 when the plants were
    // composited off-canvas. 0.05% of the buffer separates those populations with margin; a
    // fixed 1000 was inside the legitimate range and failed on genome luck alone.
    ['the rebuilt background has the retired plants in it',
      back.forestCoverage > back.bufW * back.bufH * 0.0005,
      `coverage ${back.forestCoverage}, floor ${Math.round(back.bufW * back.bufH * 0.0005)}`],
    ['no page errors across rotation', errs.length === 0, errs.join('; ')],
  ]) {
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  }
  await ctx.close();
}

await b.close();
console.log(fails === 0 ? '\nno distortion, and rotation reshapes cleanly' : `\n${fails} FAILED`);
process.exit(fails ? 1 : 0);
