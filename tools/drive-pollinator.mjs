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

// Canvas space is NOT page space. The canvas is drawn at `__size()` and laid out at whatever
// CSS size the viewport gives it, so every coordinate from `__blooms()` or `__insects()` has to
// be mapped before a mouse can be aimed at it. Skipping this does not throw — it just clicks
// somewhere else, and a negative control then passes for entirely the wrong reason.
const box = await page.locator('#c').boundingBox();
const size = await page.evaluate(() => window.__size());
const toPage = (p) => ({
  x: box.x + (p.x * box.width) / size.w,
  y: box.y + (p.y * box.height) / size.h,
});

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

// ── CROSSING IT IN ───────────────────────────────────────────────────────────────────────────
const blooms = () => page.evaluate(() => window.__blooms());

// NEGATIVE CONTROL: a carrier dragged onto bare sky must yield nothing.
const trayBefore = (await state()).tray;
let bug = (await carriers())[0];
let grip = toPage(bug);
await page.mouse.move(grip.x, grip.y);
await page.mouse.down();
await page.mouse.move(box.x + 30, box.y + 20, { steps: 8 });
await page.mouse.up();
check(
  'CONTROL: a carrier dropped on sky yields no seed',
  (await state()).tray === trayBefore,
  `tray ${trayBefore} -> ${(await state()).tray}`,
);
// A separate failure from the one above, deliberately. If the hit test picks the flower
// UNDERNEATH the carrier instead of the carrier, the drag becomes a clone and the carrier stays
// — so a missing carrier here points at hit-test ordering, not at the cross.
check('CONTROL: and the carrier survived the failed drag', (await carriers()).length === 1);

// Dragged onto a flower, it crosses.
bug = (await carriers())[0];
const all = await blooms();
const target = toPage(all.find((b) => b.plotIndex !== bug.plotIndex) ?? all[0]);
grip = toPage(bug);
await page.mouse.move(grip.x, grip.y);
await page.mouse.down();
await page.mouse.move(target.x, target.y, { steps: 10 });
await page.mouse.up();
check(
  'dragging a carrier onto a flower makes a seed',
  (await state()).tray === trayBefore + 1,
  `tray ${trayBefore} -> ${(await state()).tray}`,
);
check(
  'and the carrier is gone once its pollen has been taken',
  (await carriers()).length === 0,
);

const origins = await page.evaluate(() => window.__origins());
check('the seed is recorded as a wild cross', origins.includes('wild'), origins.join(','));


// ── KEYBOARD ─────────────────────────────────────────────────────────────────────────────────
// A new interactive entity that lived only on the canvas would silently regress the keyboard and
// screen-reader access. The carrier reaches the mirror or it is not done.
await page.evaluate((g) => window.__spawnCarrier(g), donor);
await page.waitForTimeout(150);
const names = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('#mirror button')].map((b) => b.textContent.trim()),
  );
let labels = await names();
check(
  'the carrier is in the mirror',
  labels.some((n) => n.includes('pollen')),
  labels.filter((n) => n.includes('pollen')).join(' | ') || labels.join(' | '),
);

const kbBefore = (await state()).tray;
const carrierIdx = labels.findIndex((n) => n.includes('pollen'));
const plotIdx = labels.findIndex((n) => /^plot \d+, .*finished$/.test(n));
check('CONTROL: a grown plot exists to cross into', plotIdx >= 0, labels.join(' | '));
await page.evaluate((i) => document.querySelectorAll('#mirror button')[i].focus(), carrierIdx);
await page.keyboard.press('Enter');
await page.evaluate((i) => document.querySelectorAll('#mirror button')[i].focus(), plotIdx);
await page.keyboard.press('Enter');
check(
  'a carrier can be crossed in from the keyboard',
  (await state()).tray === kbBefore + 1,
  `tray ${kbBefore} -> ${(await state()).tray}`,
);
check('and it left the mirror with its pollen', !(await names()).some((n) => n.includes('pollen')));

check('no page errors', errors.length === 0, errors.join(' · '));
await browser.close();
console.log(failures ? `${failures} FAILED` : 'all pollinator checks passed');
process.exit(failures ? 1 : 0);
