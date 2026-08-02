/**
 * Run every behavioural driver, discovered from the filesystem.
 *
 * ENUMERATED lists of drivers have already failed once in this project: CI's list was written
 * before drive-drawer.mjs existed and the drawer shipped with its driver ungated
 * (.github/workflows/drivers.yml:74-82). CI was fixed with a glob; this script was not, so the
 * two lists sat side by side with nothing comparing them. Deriving both from the same source —
 * the directory — is what makes them unable to disagree.
 *
 * The `check-*` tools are deliberately NOT run here: they are judged one at a time and some are
 * performance measurements that are meaningless on a shared runner.
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const drivers = readdirSync(here)
  .filter(
    (f) =>
      f.startsWith("drive-") && f.endsWith(".mjs") && f !== "drive-all.mjs",
  )
  .sort();

// A glob that matches nothing is an empty gate reporting success. Same floor CI uses.
if (drivers.length < 7) {
  console.error(
    `only ${drivers.length} drivers found in ${here} — expected at least 7`,
  );
  process.exit(1);
}

console.log(`running ${drivers.length} drivers: ${drivers.join(" ")}`);
for (const d of drivers) {
  const r = spawnSync(process.execPath, [join(here, d)], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`FAILED: ${d}`);
    process.exit(r.status ?? 1);
  }
}
console.log("all drivers passed");
