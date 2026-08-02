/**
 * Real-execution check for keyboard and screen-reader access.
 *
 * The unit suite proves `plotLabel` refuses to name an ungrown plant. It cannot prove a player
 * can REACH a plot without a pointer: that needs the mirror to exist, to be in the accessibility
 * tree, to carry accessible names, and to be reachable by Tab in an order matching the bed.
 * Every one of those sits between the player and the garden, and a fixture exercises none.
 */
import { chromium } from 'playwright';

const URL = process.env.GARDEN_URL ?? 'http://localhost:5173/garden/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 1220, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.removeItem('heirloom.learned.v1');
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ready === true, { timeout: 15000 });

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const state = () => page.evaluate(() => window.__state());
const names = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('#mirror button')].map((b) => b.textContent.trim()),
  );

// ── CONTROLS FIRST ───────────────────────────────────────────────────────────────────────────
// The canvas must be OUT of the accessibility tree before any "the mirror is reachable" claim is
// trusted; an exposed canvas would make the tree look populated whether the mirror works or not.
check(
  'CONTROL: the canvas is hidden from assistive technology',
  (await page.getAttribute('#c', 'aria-hidden')) === 'true',
);

const labels = await names();
const plotButtons = labels.filter((l) => l.startsWith('plot ')).length;
check('one button per plot', plotButtons === 9, `saw ${plotButtons}`);

// The next check is only meaningful if the garden actually has plants in it. A bed of nine empty
// plots would pass a "nothing was named" assertion while proving nothing at all.
const codes = await page.evaluate(() => window.__codes().plots);
check(
  'CONTROL: the garden has plants, so the leak check is not vacuous',
  codes.filter(Boolean).length > 0,
  `${codes.filter(Boolean).length} occupied`,
);

// NON-DISCLOSURE — the single most important assertion in this file. Wind the clock back so
// every plant is a seedling, then require every occupied plot to read exactly "growing".
await page.evaluate(() => window.__seek(0));
await page.waitForTimeout(80);
const seedlingLabels = await names();
let leaked = '';
for (let i = 0; i < codes.length; i++) {
  if (!codes[i]) continue;
  const label = seedlingLabels[i] ?? '';
  if (!/^plot \d+, growing$/.test(label)) leaked = `plot ${i + 1}: "${label}"`;
}
check('an ungrown plant is labelled only "growing"', leaked === '', leaked);

// Tab order reaches every plot.
//
// Keyed on the button's INDEX, not on its label. Labels change as plants finish growing, so a
// set of label strings counts STATES rather than plots — it sailed past nine on the first run
// while proving nothing about whether plot 7 was ever reached.
await page.evaluate(() => document.body.focus());
const reached = new Set();
for (let i = 0; i < 40; i++) {
  await page.keyboard.press('Tab');
  const t = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || !el.closest('#mirror') || el.dataset.kind !== 'plot') return null;
    return el.dataset.index;
  });
  if (t !== null) reached.add(t);
}
check(
  'Tab reaches all nine plots',
  reached.size === 9,
  `reached ${[...reached].sort((a, b) => a - b).join(',')}`,
);

check('no page errors', errors.length === 0, errors.join(' · '));
await browser.close();
console.log(failures ? `${failures} FAILED` : 'all keyboard checks passed');
process.exit(failures ? 1 : 0);
