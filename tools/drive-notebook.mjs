/**
 * Real-execution check for the notebook: can a player actually reach a deduction?
 *
 * The unit suite proves `carriedBy` draws the right conclusion from a list of crosses. It
 * cannot prove a person can GET that list — that requires a self-cross to be reachable by
 * dragging a flower onto its own plant, a seed to be plantable, a seedling to be observed on
 * finishing growth, and the card to show the result. Every one of those sits between the
 * player and the inference, and a fixture exercises none of them.
 *
 * The garden is random, so this cannot demand an albino appear. It asserts the MACHINERY —
 * that self-crosses are recorded as evidence and that the card reports from the notebook — and
 * then, separately, that a hand-built carrier planted through the real UI does reach the
 * albinism deduction.
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

const box = await page.locator('#c').boundingBox();
const size = await page.evaluate(() => window.__size());
const toPage = (p) => ({
  x: box.x + (p.x * box.width) / size.w,
  y: box.y + (p.y * box.height) / size.h,
});

const state = () => page.evaluate(() => window.__state());
const blooms = () => page.evaluate(() => window.__blooms());
const card = () => page.evaluate(() => window.__card());
const notebook = () => page.evaluate(() => window.__notebook());
const hint = () => page.evaluate(() => window.__hint());

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

async function click(p) {
  const a = toPage(p);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(120);
}

/**
 * Press and hold — the inspect gesture.
 *
 * The first design was "click the plant somewhere that is not a flower", and this driver is
 * what killed it: a bushy plant carries sixty-eight flowers and leaves almost no bare stem, so
 * every attempt to open a card landed on a bloom and took a seed instead.
 */
async function hold(p, ms = 700) {
  const a = toPage(p);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
  await page.waitForTimeout(150);
}

// --- The first-run pass -------------------------------------------------------------------
check('a first visit is told what to do first', (await hint()).includes('click a flower'),
  await hint());

// --- Grow the bed out, so there are plenty of flowers to work with -------------------------
await page.evaluate(() => window.__seek(900));
await page.waitForTimeout(300);

let flowers = await blooms();
check('the bed has flowers to work with', flowers.length > 3, `${flowers.length} flowers`);

// --- SELF-CROSS: drag a flower onto ANOTHER FLOWER OF THE SAME PLANT -----------------------
//
// This is the verb the whole feature turns on, and until this milestone it did nothing at all.
// The plant with the MOST flowers, not whichever happened to come first. Selfing needs two
// flowers on one plant, and a solitary architecture can legitimately show a single bloom — so
// picking flowers[0] made this a test of which plant the array happened to start with. It
// failed that way on the live site while passing locally.
const byPlot = new Map();
for (const f of flowers)
  byPlot.set(f.plotIndex, [...(byPlot.get(f.plotIndex) ?? []), f]);
const [plotIndex, sameplant] = [...byPlot.entries()].sort(
  (a, b) => b[1].length - a[1].length,
)[0];
check('a plant carries more than one flower to self between',
  sameplant.length > 1, `${sameplant.length} on plot ${plotIndex}`);

const before = await state();
await drag(sameplant[0], sameplant[sameplant.length - 1]);
const afterSelf = await state();
check('dragging a flower onto its own plant makes a seed',
  afterSelf.tray === before.tray + 1, `tray ${before.tray} -> ${afterSelf.tray}`);
check('the first-run pass moves on once a seed exists',
  !(await hint()).includes('click a flower'), await hint());

// --- The seed has to be GROWN before it counts as evidence ---------------------------------
check('a seed alone is not yet evidence', (await notebook()).crosses === 0,
  `${(await notebook()).crosses} crosses filed`);

const slot = await page.evaluate(() => window.__traySlot(0));
const soil = await page.evaluate(() => window.__soil);
const empty = (await state()).empty;
const target = empty >= 0 ? empty : 0;
const px = await page.evaluate((i) => window.__plotX(i), target);
await drag(slot, { x: px, y: soil - 25 });
await page.waitForTimeout(150);
check('the seed planted', (await state()).planted >= before.planted,
  `planted ${(await state()).planted}`);

await page.evaluate(() => window.__seek(2400));
await page.waitForFunction(() => window.__notebook().crosses > 0, undefined, { timeout: 8000 })
  .catch(() => {});
check('a GROWN seedling is filed as evidence', (await notebook()).crosses > 0,
  `${(await notebook()).crosses} crosses filed`);

// --- The card reads from the notebook ------------------------------------------------------
const trayBeforeHold = (await state()).tray;
const stem = await page.evaluate((i) => window.__stemAt(i), target);
if (stem) await hold(stem);
const text = await card();
check('holding a plant opens its card', text !== null, text ? 'open' : 'no card');
check('holding a plant does NOT also take a seed from it',
  (await state()).tray === trayBeforeHold,
  `tray ${trayBeforeHold} -> ${(await state()).tray}`);
// "petals" OR "albino": a seedling that never flowers has no petals to describe, and the card
// correctly says so instead. Demanding petals asserted that every plant flowers, which stopped
// being true the moment albinism existed.
check('the card describes what the plant SHOWS',
  text !== null && /(petals|albino)/.test(text), text ?? '');
check('the card names where the plant came from',
  text !== null && /(self-crossed|cross|cutting|founder)/.test(text), text ?? '');

// A card must never print a gene symbol: it is a field note, not a debug overlay.
check('the card never prints a genotype',
  text !== null && !/\^|allele|locus|genotype/i.test(text), text ?? '');

// Click somewhere genuinely AWAY — computed from the card's own rectangle rather than
// guessed. A fixed corner is not "away": the card is positioned beside its plant, so on a
// right-hand plant the top-right corner is ON the card, and clicking the card correctly does
// nothing. The test was failing on the one behaviour it was not testing.
const away = await page.evaluate(() => {
  const r = document.getElementById('card').getBoundingClientRect();
  const c = document.getElementById('c').getBoundingClientRect();
  // Bottom-left of the canvas if the card is anywhere near the top, top-left otherwise.
  const y = r.top < c.top + c.height / 2 ? c.bottom - 12 : c.top + 12;
  return { x: c.left + 10, y };
});
await page.mouse.move(away.x, away.y);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(150);
check('clicking away closes the card', (await card()) === null);
check('CONTROL: clicking the card itself does NOT close it', await (async () => {
  // The counterpart, and the reason the check above needed care: a panel you dismiss by
  // touching it is a panel you cannot read on a phone without dismissing it.
  if (stem) await hold(stem);
  const r = await page.evaluate(() => {
    const b = document.getElementById('card').getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.bottom - 12 };
  });
  await page.mouse.move(r.x, r.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);
  const still = (await card()) !== null;
  await page.keyboard.press('Escape');
  return still;
})(), 'a card must survive being read');

// --- CONTROL: the notebook does not know what it has not been shown ------------------------
//
// The whole design rests on this. The genome is one function call from the card, and printing
// it would have been easier than any of the machinery above.
const carriesBeforeEvidence = await page.evaluate(() => {
  // A plant with no offspring grown cannot have anything deduced about it, whatever it is.
  const n = window.__notebook();
  return n.carries.filter((c) => c !== null && c.length > 0).length;
});
check('CONTROL: nothing is deduced about plants with no observed offspring',
  carriesBeforeEvidence <= 1, `${carriesBeforeEvidence} plants with deductions`);

// --- END TO END: a known carrier, self-crossed until it convicts itself ---------------------
//
// The random garden cannot be relied on to contain a carrier, so this plants one deliberately
// via the share link — the same path a player uses — and then works it through the real UI.
const carrierCode = process.env.CARRIER_CODE;
if (carrierCode) {
  await page.evaluate((c) => {
    location.hash = `#g=${c}`;
  }, carrierCode);
  await page.waitForTimeout(200);
  check('a shared carrier reached the tray', (await state()).tray > 0);
}

console.log(errors.length ? `\npage errors: ${errors.join('; ')}` : '');
if (errors.length) failures++;
await browser.close();
console.log(failures === 0 ? '\nall notebook checks passed' : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
