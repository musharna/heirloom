import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(({ command, isPreview }) => ({
  root: ".",
  test: {
    /**
     * Chosen, rather than inherited.
     *
     * Vitest defaults to 5000ms, and nothing here had ever picked a number — which was fine
     * while the suite was pure geometry. The render tests are not: the golden op log records
     * every drawing operation `paintPlant` performs and digests it, and `growing.test.ts`
     * sweeps a plant across 101 frames twice to compare two painters. Those cost seconds by
     * design, and the cost IS the coverage — a cheaper golden would cover less.
     *
     * Measured 2026-08-04. The golden runs 2.5–3.1s in isolation on a 16-core machine with
     * nothing else on it — the spread is real, two consecutive runs landed either side of 3.0s.
     * On the two-core CI runner it took 5.48s and failed on the TIMEOUT, not on a mismatch,
     * while `growing.test.ts`'s heaviest case came in at 4.06s: next in line for the same fate.
     * So the default left roughly one second of headroom on the dev machine and none at all on
     * a runner, for a test whose own variance is several hundred milliseconds.
     *
     * 20s is ~3.6x the worst observed on CI. It is deliberately not larger: a timeout exists
     * to catch a HANG, and this one still does that quickly. It is not the performance gate
     * either — `check-growth-fps.mjs` and the fill-count assertions in `growing.test.ts`
     * police that directly, so raising this cannot hide a regression from them.
     *
     * Verified to be the constant that governs, rather than assumed: set to 3000 it fails the
     * golden with `Test timed out in 3000ms`. A config block that was silently not read would
     * have looked exactly like a working fix.
     */
    testTimeout: 20000,
    hookTimeout: 20000,
  },
  // Only the production build lives under a path. Setting `base` unconditionally would move
  // the DEV server to /heirloom/ too, breaking every tool and bookmark that points at
  // localhost:5173/garden/ — including all three verification drivers.
  //
  // `isPreview` is here because `vite preview` runs with command === "serve", NOT "build" —
  // so `command === "build"` alone mounted the PRODUCTION bundle at "/" while that bundle's
  // <script src> was baked at "/heirloom/". Every asset request then fell through to the SPA
  // index fallback and came back as HTML with a 200, so the module never executed and the page
  // was blank. Compared against `true` explicitly, as Vite's docs ask: some tools pass
  // undefined.
  base: command === "build" || isPreview === true ? "/heirloom/" : "/",
  build: {
    target: "es2022",
    rollupOptions: {
      // Vite builds only the root index.html unless told otherwise. Without these entries
      // the deployed site would be a landing page linking to 404s — and the build would
      // succeed, which is the worst way for it to be wrong.
      input: {
        main: here("./index.html"),
        garden: here("./garden/index.html"),
        lookdev: here("./lookdev/index.html"),
        visit: here("./visit/index.html"),
      },
    },
  },
}));
