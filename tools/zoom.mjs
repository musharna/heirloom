/**
 * High-magnification captures for judging render quality.
 *
 * The §13 backlog was written from full-frame screenshots, where a bloom is ~40px across and
 * every petal defect is below the resolution of the judgement. Its first entry (stem outline
 * jitter) turned out to be already fixed — measured at 0.0% width error — and had been carried
 * forward unverified. Look closely before claiming a defect, and before claiming a fix.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const URL = process.env.GARDEN_URL ?? 'http://localhost:5173/garden/';
mkdirSync('shots', { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewportSize: { width: 1220, height: 600 },
  deviceScaleFactor: 4, // the whole point: 4x the pixels of a normal capture
});
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ready === true, { timeout: 15000 });

const box = await page.locator('#c').boundingBox();
const size = await page.evaluate(() => window.__size);
const toPage = (p) => ({
  x: box.x + (p.x * box.width) / size.w,
  y: box.y + (p.y * box.height) / size.h,
});

await page.evaluate(() => window.__seek(900));
await page.waitForTimeout(400);
await page.mouse.move(2, 2); // no hover ring in the shot

const blooms = await page.evaluate(() => window.__blooms());
if (!blooms.length) throw new Error('nothing in bloom');

// A dense canopy: the region with the most bloom centres nearby, since that is where
// back-row petals and flat fills are visible.
let best = blooms[0];
let bestN = 0;
for (const b of blooms) {
  const n = blooms.filter((o) => Math.hypot(o.x - b.x, o.y - b.y) < 60).length;
  if (n > bestN) { bestN = n; best = b; }
}
const c = toPage(best);
const half = 90;
await page.screenshot({
  path: 'shots/zoom-bloom.png',
  clip: { x: c.x - half, y: c.y - half, width: half * 2, height: half * 2 },
});
console.log(`wrote shots/zoom-bloom.png (${bestN} blooms within 60px)`);

// Foliage: down and left of a canopy is usually stem and leaves.
await page.screenshot({
  path: 'shots/zoom-leaves.png',
  clip: { x: Math.max(0, c.x - 60), y: c.y + 40, width: 200, height: 150 },
});
console.log('wrote shots/zoom-leaves.png');

await browser.close();
