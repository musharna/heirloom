/**
 * Real-execution check for the four verbs.
 *
 * The unit suite proves cloneOf/crossOf/plantSeed/spliceSeeds work on fixtures. It cannot
 * prove a pointer at a screen coordinate REACHES them: canvas CSS scaling, pointer capture,
 * the click-vs-drag threshold and the tray hit layout all sit in between, and a fixture
 * exercises none of them. This drives real pointer events at real flowers and asserts the
 * state moved.
 *
 * Every check carries its own failure message, and the script exits non-zero on the first
 * one — a driver that silently did nothing would otherwise look identical to a pass.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const URL = process.env.GARDEN_URL ?? 'http://localhost:5173/garden/';
mkdirSync('shots', { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 1220, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ready === true, { timeout: 15000 });

const box = await page.locator('#c').boundingBox();
const size = await page.evaluate(() => window.__size());
// Canvas space -> page space. The canvas is CSS-scaled to fit the viewport, so these differ.
const toPage = (p) => ({
  x: box.x + (p.x * box.width) / size.w,
  y: box.y + (p.y * box.height) / size.h,
});

const state = () => page.evaluate(() => window.__state());
const blooms = () => page.evaluate(() => window.__blooms());

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function drag(from, to, steps = 12) {
  const a = toPage(from);
  const b = toPage(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

async function click(at) {
  const p = toPage(at);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(120);
}

// Grow the founders to full so there are flowers to click.
await page.evaluate(() => window.__seek(600));
await page.waitForTimeout(300);

const flowers = await blooms();
check('founders bloomed', flowers.length > 0, `${flowers.length} flowers on screen`);
if (!flowers.length) {
  await browser.close();
  process.exit(1);
}

// --- CLONE: a click on a flower ------------------------------------------------------
let before = await state();
await click(flowers[0]);
let after = await state();
check('click a flower yields a seed', after.tray === before.tray + 1,
  `tray ${before.tray} -> ${after.tray}`);

// NEGATIVE CONTROL: a click on bare sky must NOT yield a seed. Without this, a handler that
// produced a seed on every click would pass the check above.
before = await state();
await click({ x: 40, y: 40 });
after = await state();
check('CONTROL: clicking empty sky yields nothing', after.tray === before.tray,
  `tray ${before.tray} -> ${after.tray}`);

// --- CROSS: drag one flower onto a flower of a DIFFERENT plant ------------------------
const a = flowers[0];
const b = flowers.find((f) => f.plotIndex !== a.plotIndex);
check('two distinct plants are in bloom', Boolean(b));
if (b) {
  before = await state();
  await drag(a, b);
  after = await state();
  check('dragging flower onto flower yields a seed', after.tray === before.tray + 1,
    `tray ${before.tray} -> ${after.tray}`);

  // NEGATIVE CONTROL: a zero-distance drag on one flower is a CLICK, so it clones — one seed,
  // not two, and not a self-cross.
  //
  // It has to be a genuinely quick press. This used to be `drag(a, a, 2)`, whose down-to-up
  // interval measured 554ms — past the press-and-hold threshold — so it had quietly become a
  // test of the inspect gesture that happened to still pass whenever the flower fell outside
  // the plant's hit box. Two behaviours, decided by flower position, and neither one asserted.
  before = await state();
  {
    const at = toPage(a);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(150);
  }
  after = await state();
  check('CONTROL: flower dragged onto itself is one clone, not a cross',
    after.tray === before.tray + 1, `tray ${before.tray} -> ${after.tray}`);

  // ...and the counterpart rule: holding the SAME flower reads the plant instead of cloning
  // it. One press, two gestures, separated only by duration — so both have to be pinned or a
  // change to the threshold silently eats one of them.
  before = await state();
  {
    const at = toPage(a);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await page.waitForTimeout(150);
  }
  after = await state();
  const heldCard = await page.evaluate(() => window.__card());
  check('holding a flower reads the plant instead of taking a seed',
    heldCard !== null && after.tray === before.tray,
    `card ${heldCard === null ? 'closed' : 'open'}, tray ${before.tray} -> ${after.tray}`);
  await page.keyboard.press('Escape');
}

// --- SPLICE: drag one tray seed onto another -----------------------------------------
before = await state();
if (before.tray >= 2) {
  const s0 = await page.evaluate(() => window.__traySlot(0));
  const s1 = await page.evaluate(() => window.__traySlot(1));
  await drag(s0, s1);
  after = await state();
  check('seed dragged onto seed splices, keeping both parents',
    after.tray === before.tray + 1, `tray ${before.tray} -> ${after.tray}`);
} else {
  check('enough seeds to splice', false, `only ${before.tray}`);
}

// --- PLANT: drag a seed into an empty plot --------------------------------------------
before = await state();
check('an empty plot exists to plant into', before.empty >= 0, `index ${before.empty}`);
if (before.empty >= 0) {
  const slot = await page.evaluate(() => window.__traySlot(0));
  const plotX = await page.evaluate((i) => window.__plotX(i), before.empty);
  const soil = await page.evaluate(() => window.__soil);
  await drag(slot, { x: plotX, y: soil - 10 });
  after = await state();
  check('seed dropped on a plot plants it',
    after.planted === before.planted + 1 && after.tray === before.tray - 1,
    `planted ${before.planted} -> ${after.planted}, tray ${before.tray} -> ${after.tray}`);
}

// --- REPLACE: planting over an occupant retires it -------------------------------------
before = await state();
if (before.tray >= 1) {
  const slot = await page.evaluate(() => window.__traySlot(0));
  const plotX = await page.evaluate(() => window.__plotX(0));
  const soil = await page.evaluate(() => window.__soil);
  await drag(slot, { x: plotX, y: soil - 10 });
  after = await state();
  check('planting over an occupied plot retires the occupant',
    after.retired === before.retired + 1, `retired ${before.retired} -> ${after.retired}`);
}

// Leave a picture of the result.
await page.evaluate(() => window.__seek(1200));
await page.waitForTimeout(400);
await page.mouse.move(box.x + 5, box.y + 5);
await page.screenshot({ path: 'shots/verbs.png' });
console.log('wrote shots/verbs.png');

check('no page errors', errors.length === 0, errors.join('; '));

await browser.close();
console.log(failures === 0 ? '\nall verb checks passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
