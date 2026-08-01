/**
 * Real-execution check for the drawer.
 *
 * The unit suite proves `fitPlant` centres a box and that an archive seed carries no parents.
 * It cannot prove a player can GET a plant back: that needs a retirement to reach the replay
 * log, the log to reach the panel, a thumbnail to actually paint, and a restore to land a seed
 * in the tray without contaminating the notebook. Every one of those sits between the player
 * and the flower, and a fixture exercises none of them.
 *
 * The last assertion here — that restoring adds no notebook evidence — CANNOT be seen failing
 * against unfixed code, because the notebook already files only plantings that have parents and
 * an archive seed has none. It holds by construction. So it is a regression guard, and its
 * worth was established by MUTATION instead: deleting the `!p.parents` clause from the filing
 * loop in garden/garden.ts makes this driver fail on that line and nothing else.
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

const drawer = () => page.evaluate(() => window.__drawer());
const state = () => page.evaluate(() => window.__state());
/**
 * The notebook's cross count, or the error that stopped us reading it.
 *
 * Defensive because filing a parentless cross does not merely inflate a count: `carriedBy`
 * reads `cross.parents[0]` and THROWS on one. So the mutation that proves the parents guard is
 * load-bearing kills the page instead of moving a number, and an unguarded read turns an
 * attributable FAIL into a bare stack trace.
 */
async function crossCount() {
  try {
    return { n: (await page.evaluate(() => window.__notebook())).crosses, error: '' };
  } catch (e) {
    return { n: null, error: String(e?.message ?? e).split('\n')[0] };
  }
}

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

/** Put a seed in the tray via the share-link path, which needs no pointer geometry. */
async function seedTray(code) {
  await page.evaluate((c) => {
    location.hash = `#g=${c}`;
  }, code);
  await page.waitForTimeout(60);
}

const litPixels = () =>
  page.evaluate(() => {
    const out = [];
    for (const c of document.querySelectorAll('#drawer canvas')) {
      const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] > 8) n++;
      out.push(n);
    }
    return out;
  });

// ── CONTROLS FIRST ───────────────────────────────────────────────────────────────────────────
// An empty garden must read as empty BEFORE any "it has entries" assertion is trusted. If a
// fresh drawer already reported entries, everything below would pass on a broken panel.
await page.click('#drawer-tab');
const fresh = await drawer();
check('CONTROL: a fresh garden has an empty drawer', fresh.open && fresh.entries === 0,
  `open=${fresh.open} entries=${fresh.entries}`);
check('CONTROL: and says so in words', (await page.textContent('#drawer .empty')).includes('nothing retired'));
check('CONTROL: an unopened drawer has no canvases to mistake for thumbnails',
  (await litPixels()).length === 0);
await page.click('#drawer-tab');

// ── RETIRE SOME PLANTS ───────────────────────────────────────────────────────────────────────
// Plant ONE genome over several DIFFERENT plots, so the plants that retire are the distinct
// founders that were standing there. Retiring copies of one genome would make every thumbnail
// identical, and a bug painting the same plant for every entry would be invisible.
const occupied = (await state()).occupied;
const donor = await page.evaluate(() => window.__codes().plots.find(Boolean));
const targets = occupied.filter((i) => i !== occupied[0]).slice(0, 3);
check('there are distinct plots to retire from', targets.length >= 2, `targets=${JSON.stringify(targets)}`);

const retiredBefore = (await state()).retired;
for (const plot of targets) {
  await seedTray(donor);
  await page.evaluate((p) => window.__plantInto(p), plot);
  await page.evaluate(() => window.__seek(400));
}
const retiredAfter = (await state()).retired;
check('planting over a plant retires it', retiredAfter > retiredBefore,
  `${retiredBefore} -> ${retiredAfter}`);

// ── THE DRAWER LISTS THEM ────────────────────────────────────────────────────────────────────
await page.click('#drawer-tab');
await page.waitForTimeout(400);
const open = await drawer();
check('the drawer lists what was retired', open.open && open.entries === retiredAfter,
  `entries=${open.entries} retired=${retiredAfter}`);

const lit = await litPixels();
check('every thumbnail actually paints pixels', lit.length > 0 && lit.every((n) => n > 50),
  JSON.stringify(lit));

// A caption alone would satisfy the count above, and identical thumbnails would satisfy the
// pixel check. This is the one that catches "every entry drew the same plant".
check('different genomes draw different thumbnails', new Set(lit).size > 1,
  `distinct pixel counts: ${new Set(lit).size} of ${lit.length}`);

// ── RESTORING ────────────────────────────────────────────────────────────────────────────────
const before = await crossCount();
check('CONTROL: the notebook is readable before restoring', before.error === '',
  before.error || `crosses=${before.n}`);
const trayBefore = (await state()).tray;
check('restoring reports success', await page.evaluate(() => window.__restoreFirst()));
check('the tray grew by one', (await state()).tray === trayBefore + 1,
  `${trayBefore} -> ${(await state()).tray}`);

// The entry must SURVIVE being taken, or the drawer recreates the loss it exists to remove.
await page.click('#drawer-tab');
await page.waitForTimeout(300);
check('the entry is still in the drawer after restoring',
  (await drawer()).entries === open.entries,
  `${open.entries} -> ${(await drawer()).entries}`);

// The click path, not just the hook — the hook skips the DOM listener entirely.
const trayBeforeClick = (await state()).tray;
await page.click('#drawer figure');
await page.waitForTimeout(120);
check('clicking a thumbnail restores it too', (await state()).tray === trayBeforeClick + 1,
  `${trayBeforeClick} -> ${(await state()).tray}`);

// ── THE ONE THAT MATTERS ─────────────────────────────────────────────────────────────────────
// A restored plant is an observation already made. Counting it again would manufacture proof
// that its parent carries a recessive, corrupting the deductions the game is built on.
const empty = (await state()).empty;
if (empty >= 0) {
  await page.evaluate((p) => window.__plantInto(p), empty);
} else {
  await page.evaluate((p) => window.__plantInto(p), occupied[0]);
}
await page.evaluate(() => window.__seek(400));

const after = await crossCount();
check('a restored plant adds no notebook evidence',
  after.error === '' && after.n === before.n,
  after.error ? `notebook unreadable — ${after.error}` : `${before.n} -> ${after.n}`);

check('no page errors', errors.length === 0, errors.join('; '));

await browser.close();
console.log(failures ? `\n${failures} drawer check(s) failed` : '\nall drawer checks passed');
process.exit(failures ? 1 : 0);
