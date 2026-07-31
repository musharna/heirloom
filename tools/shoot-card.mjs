/**
 * Capture the plant card.
 *
 * Its own tool because the card is the one part of this game that is TEXT, and the existing
 * shots deliberately show the garden with no UI over it. A screenshot is also the only way to
 * find out whether a panel reads well at the size it actually appears — the driver can assert
 * the words are present and tells you nothing about whether anyone would want to read them.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const URL = process.env.GARDEN_URL ?? 'http://localhost:5173/garden/';
mkdirSync('shots', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({
  viewportSize: { width: 1220, height: 620 },
  deviceScaleFactor: 2,
});
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ready === true, { timeout: 15000 });

const box = await page.locator('#c').boundingBox();
const size = await page.evaluate(() => window.__size());
const toPage = (p) => ({ x: box.x + (p.x * box.width) / size.w, y: box.y + (p.y * box.height) / size.h });

await page.evaluate(() => window.__seek(900));
await page.waitForTimeout(300);

// Self-cross a plant, plant the seed, grow it out — so the card has real provenance to show
// rather than the empty state every founder would give.
const blooms = await page.evaluate(() => window.__blooms());
const plot = blooms[0].plotIndex;
const mine = blooms.filter((b) => b.plotIndex === plot);
const a = toPage(mine[0]);
const b = toPage(mine[mine.length - 1]);
await page.mouse.move(a.x, a.y);
await page.mouse.down();
await page.mouse.move(b.x, b.y, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(150);

const st = await page.evaluate(() => window.__state());
const target = st.empty >= 0 ? st.empty : 0;
const slot = toPage(await page.evaluate(() => window.__traySlot(0)));
const soil = await page.evaluate(() => window.__soil);
const px = await page.evaluate((i) => window.__plotX(i), target);
const drop = toPage({ x: px, y: soil - 25 });
await page.mouse.move(slot.x, slot.y);
await page.mouse.down();
await page.mouse.move(drop.x, drop.y, { steps: 10 });
await page.mouse.up();
await page.evaluate(() => window.__seek(2600));
await page.waitForTimeout(500);

const stem = await page.evaluate((i) => window.__stemAt(i), target);
const at = toPage(stem);
await page.mouse.move(at.x, at.y);
await page.mouse.down();
await page.waitForTimeout(700);
await page.mouse.up();
await page.waitForTimeout(300);

await page.screenshot({ path: 'shots/card.png' });
console.log(await page.evaluate(() => window.__card()));
await browser.close();
console.log('wrote shots/card.png');
