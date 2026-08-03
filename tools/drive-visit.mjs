/**
 * Real-execution check for garden sharing.
 *
 * TWO CONTEXTS, not two pages. A sender who breeds a garden, and a visitor who already has a
 * DIFFERENT garden of their own — separate contexts because that is what gives them separate
 * localStorage. "The visitor's save is untouched" is the assertion this whole architecture
 * exists to earn, and a single-context test cannot make it: there would be one save, shared,
 * and nothing for the visit to leave alone.
 *
 * The visitor's storage — every key, not only the save — is read with `context.storageState()`,
 * NOT by loading a page and calling `localStorage.getItem`. Two reasons, both of which would
 * produce a false reading:
 *
 *   - The garden flushes a pending save on `pagehide` and writes the CURRENT tick, so the bytes
 *     keep moving while the garden page is alive. A baseline sampled from the live game is
 *     stale a frame later, and "byte-identical" then fails for a reason that has nothing to do
 *     with the visit.
 *   - Reading the baseline from the VISIT page would sample it AFTER the visit's module had
 *     already run. If a visit ever did write the save, that write would land in the baseline
 *     and the check would compare a corrupted value against itself and pass.
 *
 * Taking both readings from outside any page, with the garden torn down, leaves exactly one
 * thing that can move those bytes in between: the visit.
 */
import { chromium } from "playwright";

const BASE = process.env.GARDEN_URL ?? "http://localhost:5173/garden/";
const VISIT = BASE.replace(/garden\/$/, "visit/");
const SAVE_KEY = "heirloom.garden.v1";
const browser = await chromium.launch();

let failures = 0;
function check(label, ok, detail = "") {
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!ok) failures++;
}

const errors = [];
const watch = (page) => page.on("pageerror", (e) => errors.push(e.message));

/**
 * The visitor's ENTIRE localStorage, read from the browser profile with no page executing.
 *
 * Every key, not just `heirloom.garden.v1`. Watching one key answers a narrower question than
 * the one the architecture makes: a visit that wrote `heirloom.garden.v2`, or a flag, or a
 * draft of somebody else's garden under a new name, would have passed a single-key check
 * untouched. What is being claimed is that a visit writes NOTHING.
 *
 * Sorted, so the comparison is of content rather than of whatever order the profile hands them
 * back in.
 */
async function storageOf(context) {
  const state = await context.storageState();
  const entries = [];
  for (const origin of state.origins ?? [])
    for (const entry of origin.localStorage ?? [])
      entries.push([`${origin.origin} ${entry.name}`, entry.value]);
  return entries.sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
}
const gardenSaveIn = (entries) =>
  entries.find(([key]) => key.endsWith(` ${SAVE_KEY}`))?.[1] ?? null;

/** What moved, by key — "it changed" without naming the key is most of a wasted failure. */
function storageDelta(before, after) {
  const was = new Map(before);
  const now = new Map(after);
  const notes = [];
  for (const [key, value] of now)
    if (!was.has(key)) notes.push(`ADDED ${key} (${value.length} bytes)`);
    else if (was.get(key) !== value)
      notes.push(
        `CHANGED ${key} (${was.get(key).length} -> ${value.length} bytes)`,
      );
  for (const key of was.keys()) if (!now.has(key)) notes.push(`REMOVED ${key}`);
  return notes.join("; ");
}

/**
 * Open a visit, always through about:blank.
 *
 * A `goto` that changes only the FRAGMENT is a same-document navigation: the page does not
 * reload and the module does not re-run. Going straight from a good link to a broken one left
 * the good garden on screen with `__visitError()` still null, and the three checks on the
 * broken link failed against a page that had never been asked to open it. That is the shape of
 * a false PASS too — a driver that read `__visitPlots()` after a hash-only hop would have been
 * reading the previous garden and calling it the new one.
 */
async function openVisit(page, hash) {
  await page.goto("about:blank");
  await page.goto(`${VISIT}${hash}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__visitReady === true, {
    timeout: 15000,
  });
}

/**
 * How much foliage there is, and how high it reaches.
 *
 * Green-dominant pixels: the sky is `#0d1013` (blue-dominant) and the soil is brown
 * (red-dominant), so `g > r && g > b` isolates the plants without a tuned threshold.
 *
 * This is the metric that separates GROWTH from MOTION, which counting changed pixels does not.
 * Sway translates and rotates foliage, leaving its area alone; growth adds foliage. Measured
 * over three seconds on this machine, across several runs: a frozen visit moved its foliage area
 * by 0.01-0.11% and its canopy top by 0px, while the same garden running live moved them by
 * 108-218% and 62-150px. The live figures vary widely between runs because the garden seeds its
 * founders from the wall clock, which is exactly why the ASSERTION is relative — frozen drift
 * under a tenth of the live growth measured in the SAME run — rather than a number from this
 * comment. Three orders of magnitude is not a threshold that needs tuning; these numbers are a
 * record of what was observed, not an input to anything.
 */
const canopy = (page) =>
  page.evaluate(() => {
    const c = document.getElementById("c");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let area = 0;
    let top = c.height;
    for (let i = 0, px = 0; i < d.length; i += 4, px++)
      if (d[i + 1] > d[i] && d[i + 1] > d[i + 2]) {
        area++;
        const y = Math.floor(px / c.width);
        if (y < top) top = y;
      }
    return { area, top };
  });

/**
 * Snapshot the canvas, and later diff against it — in-page, so only a fraction crosses the
 * wire. `getContext("2d")` returns the context the page is already drawing with.
 *
 * Snapshots wait two animation frames first. `getImageData` reads whatever was last PAINTED,
 * so a snapshot taken immediately after `__seek` reads the frame before the seek — which would
 * make a garden that grew look like one that had not.
 */
const settle = (page) =>
  page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done)),
      ),
  );
async function takeSnapshot(page) {
  await settle(page);
  await page.evaluate(() => {
    const c = document.getElementById("c");
    window.__snapshot = c
      .getContext("2d")
      .getImageData(0, 0, c.width, c.height).data;
  });
}
const changedSince = (page) =>
  page.evaluate(() => {
    const c = document.getElementById("c");
    const now = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    const then = window.__snapshot;
    let n = 0;
    for (let i = 0; i < now.length; i += 4)
      if (
        now[i] !== then[i] ||
        now[i + 1] !== then[i + 1] ||
        now[i + 2] !== then[i + 2]
      )
        n++;
    return n / (now.length / 4);
  });

// ── THE SENDER ───────────────────────────────────────────────────────────────────────────────
// 1280 wide gives the maximum world and NINE plots. The visitor below gets six, so the visited
// bed's plot count is itself evidence of whose garden is on screen.
const sender = await browser.newContext({
  viewport: { width: 1280, height: 720 },
});
const a = await sender.newPage();
watch(a);
await a.goto(BASE, { waitUntil: "networkidle" });
await a.evaluate(() => localStorage.clear());
await a.reload({ waitUntil: "networkidle" });
await a.waitForFunction(() => window.__ready === true, { timeout: 15000 });
// Run the clock forward so the founders are grown plants rather than shoots — a postcard of
// nine seedlings carries almost no picture. waitForFunction, not a sleep: the seek lands on the
// next frame, and a fixed sleep tuned on this machine is a CI liability.
const grownAt = (await a.evaluate(() => window.__now())) + 100000;
await a.evaluate((t) => window.__seek(t), grownAt);
await a.waitForFunction((t) => window.__now() >= t, grownAt, {
  timeout: 15000,
});

const senderPlots = await a.evaluate(() => window.__codes().plots);
const senderPlotCount = await a.evaluate(() => window.__plotCount());
check(
  "CONTROL: the sender has a bed to share",
  senderPlots.some(Boolean),
  `${senderPlots.filter(Boolean).length} of ${senderPlotCount} plots planted`,
);
const code = await a.evaluate(() => window.__gardenCode());
check(
  "the sender can produce a garden code",
  typeof code === "string" && code.length > 40,
  `${code?.length} chars`,
);

// ── THE VISITOR ──────────────────────────────────────────────────────────────────────────────
// 800 wide gives a six-plot world. Genuinely a different garden, not the same one re-rolled.
const visitor = await browser.newContext({
  viewport: { width: 800, height: 620 },
});
const b = await visitor.newPage();
watch(b);
await b.goto(BASE, { waitUntil: "networkidle" });
await b.evaluate(() => localStorage.clear());
await b.reload({ waitUntil: "networkidle" });
await b.waitForFunction(() => window.__ready === true, { timeout: 15000 });
const visitorAt = (await b.evaluate(() => window.__now())) + 40000;
await b.evaluate((t) => window.__seek(t), visitorAt);
await b.waitForFunction((t) => window.__now() >= t, visitorAt, {
  timeout: 15000,
});

// A garden that has never been touched has never scheduled a save — saves are written on
// CHANGE, not on a timer. A resize is a change the game acts on (`relayout` re-shapes the world
// and calls `scheduleSave`), and unlike a pointer gesture it needs no canvas-to-page coordinate
// mapping to land where it was aimed. 820 keeps the six-plot count and moves every plot, which
// is what `layoutChanged` compares.
await b.setViewportSize({ width: 820, height: 620 });
await b.waitForFunction(() => localStorage.getItem("heirloom.garden.v1"), {
  timeout: 15000,
});
const ownPlots = await b.evaluate(() => window.__codes().plots);
const ownPlotCount = await b.evaluate(() => window.__plotCount());

// Tear the garden down BEFORE reading the baseline, so the pagehide flush is already in it.
await b.goto("about:blank");
const storageBefore = await storageOf(visitor);
const ownSave = gardenSaveIn(storageBefore);
check(
  "CONTROL: the visitor has a garden of their own",
  Boolean(ownSave),
  `${ownSave?.length ?? 0} saved bytes, across ${storageBefore.length} localStorage key(s)`,
);
// If the two gardens happened to be identical, "unchanged" would be unfalsifiable.
check(
  "CONTROL: and it is a DIFFERENT garden from the sender's",
  JSON.stringify(ownPlots) !== JSON.stringify(senderPlots),
  `${ownPlotCount} plots vs the sender's ${senderPlotCount}`,
);

// ── THE VISIT ────────────────────────────────────────────────────────────────────────────────
await openVisit(b, `#garden=${code}`);
const visitError = await b.evaluate(() => window.__visitError());
check(
  "the visit opened without an error",
  visitError === null,
  String(visitError),
);

// PROVENANCE, not arrival. "nine plants appeared" would pass just as well on a bed of nine
// random plants, which is the bug a codec is most likely to actually have.
const shown = await b.evaluate(() => window.__visitPlots());
check(
  "the visited bed is the SENDER's garden, plant for plant",
  JSON.stringify(shown) === JSON.stringify(senderPlots),
  `${JSON.stringify(shown)} vs ${JSON.stringify(senderPlots)}`,
);
check(
  "and it is NOT the visitor's own garden",
  JSON.stringify(shown) !== JSON.stringify(ownPlots),
  `${shown.length} plots shown, the visitor owns ${ownPlotCount}`,
);
// The sender's world is scaled to fit, not reflowed to the visitor's bed. A reflow could still
// pass the equality above if it happened to preserve the order.
check(
  "the sender's PLOT COUNT came too — the bed was not reflowed to the visitor's",
  shown.length === senderPlotCount && shown.length !== ownPlotCount,
  `${shown.length} shown, sender ${senderPlotCount}, visitor ${ownPlotCount}`,
);
// A blind visitor gets the same bed as a list — and it has to be the SAME bed, plot by plot.
// Counting entries and checking they are non-empty passes on nine identical wrong strings.
//
// Occupancy and position only. `plotLabel` gates trait names on isGrown so an unfinished plant
// discloses nothing (§4), and asserting traits here would be pressure to open that gate.
const spoken = await b.evaluate(() =>
  [...document.querySelectorAll("#mirror li")].map((li) => li.textContent),
);
const isEmptyLabel = (text) => /,\s*empty$/.test(text ?? "");
const spokenEmpty = spoken.filter(isEmptyLabel).length;
const shownOccupied = shown.filter(Boolean).length;
check(
  "the mirror describes the same bed — the same plots occupied, in the same places",
  spoken.length === shown.length &&
    spoken.every((text, i) => text?.startsWith(`plot ${i + 1},`)) &&
    shown.every((genome, i) => (genome === null) === isEmptyLabel(spoken[i])) &&
    spoken.length - spokenEmpty === shownOccupied,
  `${spoken.length} entries, ${shownOccupied} occupied / ${spokenEmpty} empty — e.g. ${JSON.stringify(spoken[0])}`,
);

// ── FAILURE IS NAMED ─────────────────────────────────────────────────────────────────────────
await openVisit(b, "#garden=notarealgarden");
const err = await b.evaluate(() => window.__visitError());
check(
  "CONTROL: a garbage link names what was wrong",
  typeof err === "string" && err.length > 0,
  String(err),
);
// waitForFunction, never a one-shot read of the live region: a live region gets blanked and
// refilled to force a re-announcement, and a single sample can land in the gap and report a
// silence that was never there.
const announced = await b
  .waitForFunction(
    () => (document.getElementById("say")?.textContent ?? "").length > 0,
    { timeout: 5000 },
  )
  .then(() => true)
  .catch(() => false);
check("CONTROL: and it is announced, not only drawn", announced);
check(
  "CONTROL: a failed visit draws no garden — an empty bed is not a photograph of one",
  await b.evaluate(() => document.getElementById("wrap").hidden),
);

await openVisit(b, "");
const noLink = await b.evaluate(() => window.__visitError());
check(
  "CONTROL: a link with no garden in it says so",
  typeof noLink === "string" && noLink.length > 0,
  String(noLink),
);

// ── THE CONTROL THAT MATTERS ─────────────────────────────────────────────────────────────────
// Everything a visit can do has now been done in this context: a good link, a corrupt one, an
// empty one. Read storage the same way the baseline was read — from outside any page.
await b.goto("about:blank");
const storageAfter = await storageOf(visitor);
const delta = storageDelta(storageBefore, storageAfter);
check(
  "CONTROL: the visitor's localStorage is byte-identical after the visit — EVERY key",
  delta === "",
  delta === ""
    ? `all ${storageBefore.length} localStorage key(s) unchanged, ${ownSave.length} saved bytes`
    : `THE VISIT WROTE TO THE VISITOR'S STORAGE — ${delta}`,
);

// And the garden still opens as itself. Byte-identity is the mechanism; this is the consequence
// a player would notice. Last, because loading the garden writes the save again.
await b.goto(BASE, { waitUntil: "networkidle" });
await b.waitForFunction(() => window.__ready === true, { timeout: 15000 });
await b.waitForFunction(() => window.__restorePending() === 0, {
  timeout: 15000,
});
check(
  "the visitor's own garden came back exactly as they left it",
  JSON.stringify(await b.evaluate(() => window.__codes().plots)) ===
    JSON.stringify(ownPlots),
);

// ── GROWTH IS PINNED ─────────────────────────────────────────────────────────────────────────
//
// Measured in PIXELS, because no hook can see this. `__visitPlots()` returns serialized genomes
// and a genome does not change with age, so the obvious check — compare it now and three
// seconds later — is true whatever the growth clock does. It is a rubber stamp, and it was the
// one this driver was originally specified with.
//
// The picture has two clocks: growth is pinned at FROZEN, motion is not. So the frame CHANGES
// here — leaves sway — and counting changed pixels therefore cannot answer the question. A
// first attempt did exactly that against a live garden of DIFFERENT plants and came out
// backwards: nine grown plants swaying moved 14.7% of the pixels while six live seedlings
// growing moved 11.2%. It was measuring canopy size. Holding the garden constant and switching
// to foliage AREA measures growth and ignores sway, which is what the claim is about.
//
// A plant finishes growing in 40-100 ticks (`src/growth/sim.ts:132`) and the clock runs a tick
// a frame, so a garden rewound to age 20 is mid-growth and three seconds later is finished.
// Both readings start from the same rewound state, in the same browser, over the same seconds.
const YOUNG = 8;
await a.evaluate((t) => window.__seek(t), YOUNG);
const youngCode = await a.evaluate(() => window.__gardenCode());

const probe = await browser.newContext({
  viewport: { width: 1280, height: 720 },
});
const p = await probe.newPage();
watch(p);
await openVisit(p, `#garden=${youngCode}`);
await takeSnapshot(p);
const frozenBefore = await canopy(p);

// Rewind the sender to the age the postcard captured, and start its window last so the two run
// over the same wall clock.
await a.evaluate((t) => window.__seek(t), YOUNG);
await settle(a);
const livingBefore = await canopy(a);
await a.waitForTimeout(3000);
// The LIVING reading first: whichever is read second gets a few extra milliseconds of growth,
// and giving those to the frozen page is the conservative direction.
const livingAfter = await canopy(a);
const frozenAfter = await canopy(p);
const frozenDrift = await changedSince(p);

const grewBy = (before, after) => (after.area - before.area) / before.area;
const living = grewBy(livingBefore, livingAfter);
const frozen = grewBy(frozenBefore, frozenAfter);

check(
  "CONTROL: the frozen visit drew a garden at all — an empty canvas cannot fail this",
  frozenBefore.area > 1000,
  `${frozenBefore.area} foliage pixels`,
);
check(
  "CONTROL: the same garden running live really does grow over these 3s",
  living > 0.2,
  `foliage +${(living * 100).toFixed(1)}%, canopy top rose ${livingBefore.top - livingAfter.top}px`,
);
check(
  "CONTROL: and the frozen visit is still PAINTING — motion is not frozen too",
  frozenDrift > 0,
  `${(frozenDrift * 100).toFixed(2)}% of pixels moved while its foliage did not`,
);
check(
  "growth does not advance during a visit",
  Math.abs(frozen) < living / 10,
  `frozen ${(frozen * 100).toFixed(2)}% / top ${frozenBefore.top - frozenAfter.top}px vs living ${(living * 100).toFixed(1)}% / top ${livingBefore.top - livingAfter.top}px`,
);

check("no page errors", errors.length === 0, errors.join(" · "));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall visit checks passed");
process.exit(failures ? 1 : 0);
