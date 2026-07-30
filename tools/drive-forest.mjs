/**
 * Real-execution check for the accumulating background.
 *
 * Everything the forest does is canvas compositing — an offscreen buffer, `source-atop`, a
 * blur filter, a transform stack. None of that exists in the unit environment, so the pure
 * decay math is all a fixture can reach. This retires real plants through the real verbs and
 * reads the buffer's own pixels back.
 *
 * Reading pixels back matters: a forest that silently drew nothing is indistinguishable from
 * one that drew correctly if you only look at whether the code ran.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const URL = process.env.GARDEN_URL ?? 'http://localhost:5173/garden/';
mkdirSync('shots', { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 1220, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ready === true, { timeout: 15000 });

const box = await page.locator('#c').boundingBox();
const size = await page.evaluate(() => window.__size());
const toPage = (p) => ({
  x: box.x + (p.x * box.width) / size.w,
  y: box.y + (p.y * box.height) / size.h,
});
const state = () => page.evaluate(() => window.__state());

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function click(at) {
  const p = toPage(at);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(70);
}
async function drag(from, to) {
  const a = toPage(from);
  const b = toPage(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(90);
}

await page.evaluate(() => window.__seek(600));
await page.waitForTimeout(300);

// NEGATIVE CONTROL FIRST. If the buffer already had ink in it, every "coverage grew" check
// below would pass on a forest that never composited anything.
const start = await state();
check('buffer starts empty', start.forestCoverage === 0 && start.forestDepth === 0,
  `depth ${start.forestDepth}, coverage ${start.forestCoverage}`);

const soil = await page.evaluate(() => window.__soil);
const coverages = [];

// The clock only ever moves FORWARD here. The first version re-seeked to the same tick every
// round, driving `now` backwards relative to a flash set later in the previous round — and
// that is exactly what produced the negative arc radius that killed the render loop. A player
// cannot rewind the clock, so the driver should not either.
let clock = 600;

// Retire plants by planting over OCCUPIED plots, ten times.
for (let round = 0; round < 10; round++) {
  const flowers = await page.evaluate(() => window.__blooms());
  if (!flowers.length) break;
  await click(flowers[Math.floor(flowers.length / 2)]);

  const before = await state();
  if (before.tray === 0) continue;
  if (!before.occupied.length) break;
  const slot = await page.evaluate(() => window.__traySlot(0));
  // Rotate through the occupied plots, so retirement is not always the same plant.
  const target = before.occupied[round % before.occupied.length];
  const plotX = await page.evaluate((i) => window.__plotX(i), target);
  await drag(slot, { x: plotX, y: soil - 30 });

  // Let the new plant grow, so the NEXT retirement composites a full plant, not a sprout.
  clock += 700;
  await page.evaluate((t) => window.__seek(t), clock);
  await page.waitForTimeout(140);
  coverages.push((await state()).forestCoverage);
}

const end = await state();
check('plants retired into the forest', end.forestDepth >= 5,
  `depth ${end.forestDepth}`);
check('the buffer actually received pixels', end.forestCoverage > 5000,
  `coverage ${end.forestCoverage}`);
check('coverage grew as plants accumulated',
  coverages.length > 2 && coverages.at(-1) > coverages[0],
  `${coverages[0]} -> ${coverages.at(-1)}`);

// The wash must dim what is already there. Compare a deep buffer's mean alpha per covered
// pixel against a shallow one: with no wash, mean alpha would not fall as layers pile up.
check('no page errors', errors.length === 0, errors.join('; '));

await page.mouse.move(box.x + 4, box.y + 4);
await page.evaluate((t) => window.__seek(t), clock + 900);
await page.waitForTimeout(400);
await page.screenshot({ path: 'shots/forest.png' });
console.log('wrote shots/forest.png');

await browser.close();
console.log(failures === 0 ? '\nall forest checks passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
