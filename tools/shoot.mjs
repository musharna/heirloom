import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const URL = process.env.LOOKDEV_URL ?? 'http://localhost:5173/lookdev/';

mkdirSync('shots', { recursive: true });
const browser = await chromium.launch();
// Wide enough for a 4-column grid of 300px panels, so the grid cannot reflow.
const page = await browser.newPage({ viewportSize: { width: 1260, height: 1180 } });
page.on('console', (m) => console.log(`[page:${m.type()}]`, m.text()));
page.on('pageerror', (e) => {
  console.error('[pageerror]', e.message);
  process.exitCode = 1;
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__lookdevReady === true, { timeout: 15_000 });
await page.screenshot({ path: 'shots/lookdev.png', fullPage: true });
await browser.close();
console.log('wrote shots/lookdev.png');
