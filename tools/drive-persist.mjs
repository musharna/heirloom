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
const codes = () => page.evaluate(() => window.__codes());
const hintText = () => page.locator('#hint').textContent();

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
let box = await ready();

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
await page.waitForTimeout(250);

const after = await state();
const afterCodes = await codes();

check('the same plants came back',
  JSON.stringify(afterCodes.plots) === JSON.stringify(savedCodes.plots),
  `${JSON.stringify(afterCodes.plots)}`);
check('the same seeds came back',
  JSON.stringify(afterCodes.tray) === JSON.stringify(savedCodes.tray));
// The floor is LOW on purpose, and the low floor is what makes it honest.
//
// It was 1000, which assumed every plant is a big one. Coverage depends entirely on WHICH
// genome happened to retire: measured across seven runs it ranged 114 to 15,672, with several
// legitimate runs landing at 1,703 and 2,733 — just over a threshold that was already inside
// the population it was meant to accept. The 114 run was a correct rebuild of a genuinely tiny
// plant (an albino seedling is a few dozen pixels of stem). This is the same defect that was
// found and fixed in check-viewports.mjs and left standing here in the sibling file.
//
// A low floor still discriminates, because both failure modes this guards against — nothing
// composited, or composited off-canvas — read as ZERO, and the negative control below proves a
// fresh garden reads zero. Geometry is check-viewports.mjs's job, not this one's.
check('the background was rebuilt from the replay list',
  after.forestDepth === saved.retired && after.forestCoverage > 40,
  `depth ${after.forestDepth} (retired ${saved.retired}, saved replay ${savedReplay}), coverage ${after.forestCoverage}`);
check('no notice was shown — the save loaded cleanly',
  !(await hintText()).includes('rejected'), await hintText());

// NEGATIVE CONTROL. Without this, every check above would also pass if the game simply
// regenerated an identical garden from a fixed seed and localStorage did nothing at all.
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
box = await ready();
const freshCodes = await codes();
check('CONTROL: clearing storage gives a DIFFERENT garden',
  JSON.stringify(freshCodes.plots) !== JSON.stringify(savedCodes.plots),
  'a fresh garden must not coincide with the restored one');
check('CONTROL: a fresh garden has an empty background',
  (await state()).forestDepth === 0);

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
await page.evaluate(() => localStorage.clear());
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
