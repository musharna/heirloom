import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(({ command, isPreview }) => ({
  root: ".",
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
