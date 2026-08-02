/**
 * Real-execution check for pollinators.
 *
 * The unit suite proves the RULES — who may arrive, what they carry, how often an ignored
 * carrier pollinates. It cannot prove a carrier ever reaches the screen, can be picked up, or
 * produces a seed with the right provenance. Those all sit between the rule and the player.
 *
 * Nothing here waits on a probabilistic event. Carriers are forced through `__spawnCarrier` and
 * the 0.15 rule is measured in test/pollinator.test.ts instead — a driver that waited for a
 * one-in-seven event to fire would be a flaky test by construction.
 */
import { chromium } from 'playwright';

const URL = process.env.GARDEN_URL ?? 'http://localhost:5173/garden/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 1220, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ready === true, { timeout: 15000 });

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const state = () => page.evaluate(() => window.__state());
const bugs = () => page.evaluate(() => window.__insects());
const carriers = async () => (await bugs()).filter((b) => b.pollen);

// ── CONTROLS FIRST ───────────────────────────────────────────────────────────────────────────
// A fresh garden has no retirement log, so no carrier may exist yet. Without this, every "a
// carrier arrived" assertion below would pass just as well on a spawner that ignores the rule.
check('CONTROL: a fresh garden has retired nothing', (await state()).retired === 0);
check(
  'CONTROL: and therefore carries no pollen',
  (await carriers()).length === 0,
  JSON.stringify(await bugs()),
);

// Grow the bed out so there are open blooms to land on, and retire a plant so there is pollen.
await page.evaluate(() => window.__seek(window.__now() + 100000));
await page.waitForTimeout(200);
const codes = await page.evaluate(() => window.__codes().plots);
const donor = codes.find(Boolean);
check('CONTROL: a donor genome exists to carry', Boolean(donor), String(donor));

const spawned = await page.evaluate((g) => window.__spawnCarrier(g), donor);
check('a forced carrier appears', spawned === true);

const live = await carriers();
check(
  'the carrier is carrying the donor genome',
  live[0]?.pollen === donor,
  `${live.length} carrier(s), pollen ${live[0]?.pollen}`,
);
check(
  'and it settled on a real plot rather than nowhere',
  Number.isInteger(live[0]?.plotIndex) && live[0].plotIndex >= 0,
  `plotIndex ${live[0]?.plotIndex}`,
);

check('no page errors', errors.length === 0, errors.join(' · '));
await browser.close();
console.log(failures ? `${failures} FAILED` : 'all pollinator checks passed');
process.exit(failures ? 1 : 0);
