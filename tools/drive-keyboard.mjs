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

// The announcements below are only ever HEARD because of `aria-live`. Every assertion in this
// file reads `#say`'s textContent, which changes identically with or without the attribute — so
// stripping it left the whole milestone feature silent to a screen reader while this driver
// passed. Found by mutation; asserted here so it cannot happen again.
check(
  'the announcement region is a polite live region',
  (await page.getAttribute('#say', 'aria-live')) === 'polite' &&
    (await page.getAttribute('#say', 'aria-atomic')) === 'true',
  `aria-live=${await page.getAttribute('#say', 'aria-live')} aria-atomic=${await page.getAttribute('#say', 'aria-atomic')}`,
);

// Likewise the instructions: nothing else in the game says the keys exist, and gutting the block
// changed no assertion. A keyboard player who cannot discover the keys has no way in.
const intro = await page.evaluate(() => {
  const el = [...document.querySelectorAll('.sr')].find((n) => n.querySelector('h1'));
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
});
const taught = ['Tab', 'Enter', 'C ', 'R ', 'Escape'].filter((k) => intro.includes(k));
check(
  'the hidden instructions name every key',
  taught.length === 5,
  `named ${taught.length}/5 in ${intro.length} chars`,
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

// ── VERBS ────────────────────────────────────────────────────────────────────────────────────
// Let the bed finish growing first: a verb on a seedling is a different question, and mixing it
// in here would make a failure ambiguous between "the key did nothing" and "the plant was not
// ready".
await page.evaluate(() => window.__seek(100000));
await page.waitForTimeout(120);

const focusButton = (i) =>
  page.evaluate((n) => {
    document.querySelectorAll('#mirror button')[n].focus();
  }, i);
const held = () => page.evaluate(() => window.__held());

// NEGATIVE CONTROL: Enter on an empty plot, holding nothing, must do nothing at all.
const s0 = await state();
await focusButton(s0.empty);
await page.keyboard.press('Enter');
check(
  'CONTROL: Enter on an empty plot holding nothing makes no seed',
  (await state()).tray === s0.tray,
  `tray ${s0.tray} -> ${(await state()).tray}`,
);
check('CONTROL: and picks nothing up', (await held()) === null);

// NEGATIVE CONTROL: Escape must abandon a pickup without making anything.
const occupied = s0.occupied;
await focusButton(occupied[0]);
await page.keyboard.press('Enter');
check('Enter on a plant picks it up', (await held()) !== null);
await page.keyboard.press('Escape');
check('CONTROL: Escape drops what was held', (await held()) === null);
check('CONTROL: a cancelled pickup makes no seed', (await state()).tray === s0.tray);

// CROSS — two different plants.
await focusButton(occupied[0]);
await page.keyboard.press('Enter');
await focusButton(occupied[1]);
await page.keyboard.press('Enter');
check(
  'Enter, Enter across two plants crosses them',
  (await state()).tray === s0.tray + 1,
  `tray ${(await state()).tray}`,
);

// SELF — the same plant twice.
const beforeSelf = (await state()).tray;
await focusButton(occupied[0]);
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
check('Enter twice on one plant selfs it', (await state()).tray === beforeSelf + 1);

// CLONE.
const beforeClone = (await state()).tray;
await focusButton(occupied[0]);
await page.keyboard.press('c');
check('C clones the focused plant', (await state()).tray === beforeClone + 1);

// PLANT — a held seed onto an empty plot. Seed buttons follow the nine plots.
const beforePlant = await state();
await focusButton(9);
await page.keyboard.press('Enter');
check('a seed can be picked up', (await held()) !== null);
await focusButton(beforePlant.empty);
await page.keyboard.press('Enter');
check(
  'a held seed plants into an empty plot',
  (await state()).planted === beforePlant.planted + 1,
  `planted ${beforePlant.planted} -> ${(await state()).planted}`,
);

// READ.
await focusButton(occupied[0]);
await page.keyboard.press('r');
check('R opens the card', (await page.getAttribute('#card', 'hidden')) === null);
await page.keyboard.press('Escape');
check('Escape closes the card', (await page.getAttribute('#card', 'hidden')) !== null);

// ── MILESTONES ───────────────────────────────────────────────────────────────────────────────
const said = () => page.evaluate(() => document.getElementById('say').textContent.trim());
const clearSaid = () =>
  page.evaluate(() => {
    document.getElementById('say').textContent = '';
  });

// CONTROL: the region must read empty before any "it announced" claim is trusted. Without this
// a region that never clears would make every announcement assertion pass on stale text.
await clearSaid();
check('CONTROL: the live region starts empty', (await said()) === '');

// A plant finishing is announced.
//
// Tested by planting a NEW seed and running the clock forward, not by winding the clock back
// over the plants already in the bed. Completion is recorded per Planting in a WeakSet, so a
// plant that has already finished stays finished — correctly, since real time only moves one
// way. Seeking backwards made this assertion unreachable and looked like a missing feature.
const freshPlot = (await state()).empty;
if (freshPlot >= 0) {
  await focusButton(9);
  await page.keyboard.press('Enter');
  await focusButton(freshPlot);
  await page.keyboard.press('Enter');
}
// COUNTED, not sampled.
//
// `announce()` blanks the region and re-fills it on the next frame, so reading `textContent`
// samples a value that is empty half the time. Under a missing "already said this" guard the
// region is being cleared sixty times a second, and a sampled read then catches the BLANK —
// which reads as silence. Verified by mutation: deleting the guard made the sampled assertion
// FAIL and a sampled "not repeated" control PASS, the exact wrong way round.
//
// Counting every non-empty transition is the measurement the claim actually needs.
await page.evaluate(() => {
  window.__saidLog = [];
  const el = document.getElementById('say');
  new MutationObserver(() => {
    const t = el.textContent.trim();
    if (t) window.__saidLog.push(t);
  }).observe(el, { childList: true, characterData: true, subtree: true });
});
await page.evaluate(() => window.__seek(window.__now() + 100000));
await page.waitForTimeout(400);
const log = await page.evaluate(() => window.__saidLog);
const finishes = log.filter((t) => /^plot \d+ finished: /.test(t));
check('a plant finishing is announced', finishes.length > 0, finishes[0] ?? '(nothing said)');
// CONTROL: and announced ONCE. The frame loop re-checks every plot sixty times a second; a
// missing guard repeats the same sentence forever, which is the narration people switch off.
// Uniqueness, not a count of one: more than one plant can finish in the same stretch, and each
// message names its own plot. A missing guard repeats the SAME sentence, so duplicates are the
// discriminator and a raw total is not.
check(
  'CONTROL: each plant is announced once, not every frame',
  finishes.length === new Set(finishes).size,
  `${finishes.length} announcements, ${new Set(finishes).size} distinct`,
);

// A full tray DISCARDS the oldest seed rather than refusing. Fill it past the cap and expect to
// be told, because a player handed nothing cannot otherwise tell that from the verb failing.
await clearSaid();
const occ2 = (await state()).occupied;
for (let i = 0; i < 14; i++) {
  await focusButton(occ2[0]);
  await page.keyboard.press('c');
}
check('the tray is capped at twelve', (await state()).tray === 12, `tray ${(await state()).tray}`);
const overflow = await said();
check('overflowing the tray says a seed was lost', overflow.includes('oldest'), overflow);

check('no page errors', errors.length === 0, errors.join(' · '));
await browser.close();
console.log(failures ? `${failures} FAILED` : 'all keyboard checks passed');
process.exit(failures ? 1 : 0);
