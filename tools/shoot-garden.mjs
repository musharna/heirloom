import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const URL = process.env.GARDEN_URL ?? 'http://localhost:5173/garden/';
mkdirSync('shots', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 1200, height: 470 } });
page.on('pageerror', (e) => { console.error('[pageerror]', e.message); process.exitCode = 1; });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__gardenReady === true, { timeout: 15000 });

// Seek to specific growth stages instead of racing the animation clock.
for (const [label, tick] of [['mid', 55], ['grown', 400]]) {
  await page.evaluate((t) => window.__gardenSeek(t), tick);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `shots/garden-${label}.png` });
  console.log(`wrote shots/garden-${label}.png`);
}
await browser.close();
