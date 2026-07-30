/**
 * Captures the garden in states worth LOOKING at, which is not the same as the states the
 * verb driver leaves behind: that one ends with a spent tray, so the affordances it exercised
 * are all invisible by the time it takes its picture.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const URL = process.env.GARDEN_URL ?? 'http://localhost:5173/garden/';
mkdirSync('shots', { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 1220, height: 600 } });
page.on('pageerror', (e) => { console.error('[pageerror]', e.message); process.exitCode = 1; });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ready === true, { timeout: 15000 });

const box = await page.locator('#c').boundingBox();
const size = await page.evaluate(() => window.__size);
const toPage = (p) => ({
  x: box.x + (p.x * box.width) / size.w,
  y: box.y + (p.y * box.height) / size.h,
});

async function shoot(name) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `shots/${name}.png` });
  console.log(`wrote shots/${name}.png`);
}

// Mid-growth: founders still rising, empty plots visible.
await page.evaluate(() => window.__seek(60));
await page.mouse.move(box.x + 4, box.y + 4);
await shoot('garden-mid');

// Grown, with a tray full of seeds and the pointer resting on a flower so the hover
// affordance is in frame.
await page.evaluate(() => window.__seek(600));
await page.waitForTimeout(300);
const flowers = await page.evaluate(() => window.__blooms());
for (const f of [flowers[0], flowers.at(-1), flowers[Math.floor(flowers.length / 2)]]) {
  const p = toPage(f);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(90);
}
const hover = toPage(flowers[0]);
await page.mouse.move(hover.x, hover.y);
await shoot('garden-grown');

// Mid-drag: a seed in hand, over a plot, with the tether and the target ring showing.
const slot = await page.evaluate(() => window.__traySlot(0));
const plotX = await page.evaluate(() => window.__plotX(3));
const soil = await page.evaluate(() => window.__soil);
const from = toPage(slot);
const to = toPage({ x: plotX, y: soil - 40 });
await page.mouse.move(from.x, from.y);
await page.mouse.down();
await page.mouse.move(to.x, to.y, { steps: 10 });
await shoot('garden-dragging');
await page.mouse.up();

await browser.close();
