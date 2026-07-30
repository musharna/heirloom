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
await b.close();
console.log(fails === 0 ? '\nno distortion on any viewport' : `\n${fails} FAILED`);
process.exit(fails ? 1 : 0);
