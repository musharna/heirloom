/**
 * Real-execution check for persistence and sharing.
 *
 * "Does a garden survive a reload" is not a property any fixture can hold: it needs a real
 * localStorage, a real page teardown and a real fresh page reading it back. The unit suite can
 * only prove toSave/fromSave are inverses on an object that never left the process.
 */
import { chromium } from 'playwright';
import { gestures } from './gestures.mjs';

const URL = process.env.GARDEN_URL ?? 'http://localhost:5173/garden/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 1220, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function ready() {
  await page.waitForFunction(() => window.__ready === true, { timeout: 15000 });
  return page.locator('#c').boundingBox();
}
const state = () => page.evaluate(() => window.__state());
/**
 * Wipe storage for the origin WITHOUT the running game getting a chance to write it back.
 *
 * `origin` is captured from the live page rather than parsed here, because this module's own
 * `URL` constant shadows the global `URL` class and `new URL(...)` throws.
 */
let originForClear = '';
const clearStorage = async () => {
  const client = await page.context().newCDPSession(page);
  await client.send('Storage.clearDataForOrigin', {
    origin: originForClear,
    storageTypes: 'local_storage',
  });
};
const codes = () => page.evaluate(() => window.__codes());
const hintText = () => page.locator('#hint').textContent();

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
let box = await ready();
originForClear = await page.evaluate(() => location.origin);

const size = await page.evaluate(() => window.__size());
const toPage = (p) => ({
  x: box.x + (p.x * box.width) / size.w,
  y: box.y + (p.y * box.height) / size.h,
});
// Shared gestures: a press slower than 450ms is a HOLD, not a click, and no driver can
// promise its own press is quick. See tools/gestures.mjs.
const { tap: click, drag } = gestures(page, box, size);

// --- Build a garden worth saving --------------------------------------------------------
await page.evaluate(() => window.__seek(600));
await page.waitForTimeout(250);
const flowers = await page.evaluate(() => window.__blooms());
for (const f of flowers.slice(0, 3)) await click(f);

const soil = await page.evaluate(() => window.__soil);
let before = await state();
// Plant into an empty plot, then over an occupied one so something retires.
if (before.empty >= 0) {
  const slot = await page.evaluate(() => window.__traySlot(0));
  const x = await page.evaluate((i) => window.__plotX(i), before.empty);
  await drag(slot, { x, y: soil - 30 });
}
before = await state();
if (before.tray > 0 && before.occupied.length) {
  const slot = await page.evaluate(() => window.__traySlot(0));
  const x = await page.evaluate((i) => window.__plotX(i), before.occupied[0]);
  await drag(slot, { x, y: soil - 30 });
}

const saved = await state();
const savedCodes = await codes();
check('built a garden with plants, seeds and a retirement',
  saved.planted > 0 && saved.tray > 0 && saved.retired > 0,
  `planted ${saved.planted}, tray ${saved.tray}, retired ${saved.retired}`);

// Wait for the save to actually CONTAIN the retirement, not for a fixed number of
// milliseconds. The retirement reaches the replay list on the next frame and the write is
// debounced behind that, so a fixed sleep is a race — and it lost intermittently once the
// recede animation put another frame between the drop and the record.
await page.waitForFunction(() => {
  const raw = localStorage.getItem('heirloom.garden.v1');
  if (!raw) return false;
  try { return (JSON.parse(raw).replay ?? []).length > 0; } catch { return false; }
}, undefined, { timeout: 8000 }).catch(() => {});
const stored = await page.evaluate(() => localStorage.getItem('heirloom.garden.v1'));
const savedReplay = (() => { try { return JSON.parse(stored).replay.length; } catch { return -1; } })();
check('the retirement reached the saved replay list', savedReplay > 0,
  `${savedReplay} replay entries`);
check('a save was written', Boolean(stored) && stored.length > 40,
  `${stored ? stored.length : 0} bytes`);

// --- RELOAD ------------------------------------------------------------------------------
await page.reload({ waitUntil: 'networkidle' });
box = await ready();
// Wait for the background DRAIN, not for a fixed sleep. `__ready` used to imply the background
// was already composited, because the rebuild ran synchronously before it was ever set. It no
// longer does: the rebuild is spread across frames on a 6ms budget so the garden is interactive
// while past plants fill in, which means `__ready` and "the background is finished" are now two
// different moments. Every assertion below reads background PIXELS, so it has to wait for the
// second one. A fixed 250ms happened to cover a one-plant drain on a fast machine; it is a race
// on a shared runner and at BACKGROUND_REPLAY entries it would lose outright.
await page.waitForFunction(() => window.__restorePending() === 0, undefined, { timeout: 15000 });
await page.waitForTimeout(250);

const after = await state();
const afterCodes = await codes();

check('the same plants came back',
  JSON.stringify(afterCodes.plots) === JSON.stringify(savedCodes.plots),
  `${JSON.stringify(afterCodes.plots)}`);
check('the same seeds came back',
  JSON.stringify(afterCodes.tray) === JSON.stringify(savedCodes.tray));
// NON-ZERO, not a floor. The floor was 1000, then 40, and it failed a third time at coverage
// 14 — which is the tell: the constant keeps being re-derived from a sample of a distribution
// whose legitimate low tail is unbounded. `placeRetired` draws a RANDOM depth, so a small plant
// landing far back arrives at scale 0.64, alpha 0.28 and blur 3, and most of its pixels fall
// under the alpha > 8 cut that `coverage()` itself counts by. Legitimate values measured here
// span 14 to 15,672 — three orders of magnitude, by design, because the depth scatter is a
// feature.
//
// The floor also never bought what the previous version of this comment claimed. It asserted
// that both guarded failure modes "read as ZERO", but check-viewports.mjs measured a genuinely
// off-canvas composite at 157. So 40 did not separate that population either; it only rejected
// small plants, which is precisely the false failure it kept producing.
//
// What actually discriminates is `depth` — `Forest.retire` increments `layers` only AFTER the
// composite completes, so a matching depth proves the plant was drawn, not merely queued — plus
// a buffer that is not empty, with the negative control below proving a fresh garden reads
// exactly 0. Off-canvas geometry belongs to check-viewports.mjs, which owns a viewport narrow
// enough to actually produce it and a scale-free floor derived from the buffer's own area.
check('the background was rebuilt from the replay list',
  after.forestDepth === saved.retired && after.forestCoverage > 0,
  `depth ${after.forestDepth} (retired ${saved.retired}, saved replay ${savedReplay}), coverage ${after.forestCoverage}`);
check('no notice was shown — the save loaded cleanly',
  !(await hintText()).includes('rejected'), await hintText());

// NEGATIVE CONTROL. Without this, every check above would also pass if the game simply
// regenerated an identical garden from a fixed seed and localStorage did nothing at all.
//
// Cleared through CDP from a blank page, NOT with `localStorage.clear()` in the running game.
// The game flushes a pending save on `pagehide` — it has to, or a phone user who swipes the
// app away loses whatever they did since the last debounce — and that flush fires during the
// reload and writes the garden straight back. The control was passing storage a value it had
// just been told to forget, then reporting that storage worked.
await page.goto('about:blank');
await clearStorage();
await page.goto(URL, { waitUntil: 'networkidle' });
box = await ready();
const freshCodes = await codes();
check('CONTROL: clearing storage gives a DIFFERENT garden',
  JSON.stringify(freshCodes.plots) !== JSON.stringify(savedCodes.plots),
  'a fresh garden must not coincide with the restored one');
check('CONTROL: a fresh garden has an empty background',
  (await state()).forestDepth === 0);

// --- #new starts a fresh garden, and only when confirmed ---------------------------------
//
// There was no way to start over at all, and the obvious one — clear localStorage from the
// console and reload — did NOT work: the pagehide save flush fired during the reload and wrote
// the garden back over the clear. So this checks the thing a player will actually do, and its
// refusal path, because a fragment travels and a mis-shared link must not silently delete
// somebody's breeding history.
{
  await page.goto(URL, { waitUntil: 'networkidle' });
  await ready();
  await page.waitForTimeout(200);
  const had = (await codes()).plots.join('|');

  // ONE persistent handler with a flag, not `page.once`. With `once`, the second dialog is
  // auto-dismissed by Playwright before the new handler can claim it, and the run dies on
  // "Cannot accept dialog which is already handled".
  let acceptReset = false;
  page.on('dialog', (d) => (acceptReset ? d.accept() : d.dismiss()));

  // DECLINE first. A reset that happens anyway is worse than no reset at all.
  await page.goto(`${URL}#new`, { waitUntil: 'networkidle' });
  await ready();
  await page.waitForTimeout(250);
  check('CONTROL: declining #new leaves the garden untouched',
    (await codes()).plots.join('|') === had, 'the garden must survive a refused reset');

  // ...and accepting really does start over.
  acceptReset = true;
  await page.goto(`${URL}#new`, { waitUntil: 'networkidle' });
  await ready();
  await page.waitForTimeout(250);
  const fresh = (await codes()).plots.join('|');
  check('#new starts a fresh garden', fresh !== had, 'a fresh garden must differ from the old one');
  check('#new leaves no fragment behind to re-fire on refresh',
    !(await page.evaluate(() => location.hash)).includes('new'),
    await page.evaluate(() => location.hash) || '(none)');

  // And the reset STICKS across a reload — the flush must not resurrect what was cleared.
  await page.reload({ waitUntil: 'networkidle' });
  await ready();
  await page.waitForTimeout(250);
  check('the fresh garden survives a reload',
    (await codes()).plots.join('|') !== had, 'the old garden must not come back');
}

// --- A corrupt save must be REJECTED OUT LOUD, not silently reset ------------------------
await page.evaluate(() =>
  localStorage.setItem('heirloom.garden.v1', JSON.stringify({ v: 99, plots: [], ages: [], tray: [], replay: [] })),
);
await page.reload({ waitUntil: 'networkidle' });
await ready();
await page.waitForTimeout(150);
let text = await hintText();
check('a save from another version is rejected by name',
  text.includes('rejected') && text.includes('version'), text);

// --- Share links -------------------------------------------------------------------------
await page.goto('about:blank');
await clearStorage();
const shareCode = savedCodes.tray[0] ?? savedCodes.plots.find(Boolean);
await page.goto(`${URL}#g=${shareCode}`, { waitUntil: 'networkidle' });
await ready();
await page.waitForTimeout(150);
const sharedCodes = await codes();
check('a shared link puts that exact genome in the tray',
  sharedCodes.tray.includes(shareCode), `${JSON.stringify(sharedCodes.tray)}`);

// Two distinct corruption paths, because different checks reject them and one case leaves the
// other unexercised. All-zero bytes trip the VERSION check before the checksum is ever
// reached — the first version of this test asserted 'checksum' here and failed on correct code.
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL}#g=AAAAAAAAAAA`, { waitUntil: 'networkidle' });
await ready();
await page.waitForTimeout(150);
text = await hintText();
check('a share link with an unknown version is rejected by name',
  text.includes('not a genome') && text.includes('version'), text);

// Right version, wrong checksum: flip one character of a real code.
const flipped =
  shareCode.slice(0, 4) + (shareCode[4] === 'X' ? 'Y' : 'X') + shareCode.slice(5);
// Measured as a DELTA, not an absolute. A fragment change does not reload the page, so the
// tray still holds the seed the valid link added a moment ago; asserting `tray === 0` here
// failed against correct behaviour.
const trayBefore = (await state()).tray;
await page.goto(`${URL}#g=${flipped}`, { waitUntil: 'networkidle' });
await ready();
await page.waitForTimeout(150);
text = await hintText();
check('a share link with a corrupted body is caught by the checksum',
  text.includes('not a genome') && text.includes('checksum'), text);

check('CONTROL: a rejected link adds NO seed',
  (await state()).tray === trayBefore,
  `tray ${trayBefore} -> ${(await state()).tray}`);

check('no page errors', errors.length === 0, errors.join('; '));

await browser.close();
console.log(failures === 0 ? '\nall persistence checks passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
