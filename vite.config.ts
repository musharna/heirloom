import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(({ command }) => ({
  root: ".",
  // Only the production build lives under a path. Setting `base` unconditionally would move
  // the DEV server to /heirloom/ too, breaking every tool and bookmark that points at
  // localhost:5173/garden/ — including all three verification drivers.
  base: command === "build" ? "/heirloom/" : "/",
  build: {
    target: "es2022",
    rollupOptions: {
      // Vite builds only the root index.html unless told otherwise. Without these two
      // entries the deployed site would be a landing page linking to two 404s — and the
      // build would succeed, which is the worst way for it to be wrong.
      input: {
        main: here("./index.html"),
        garden: here("./garden/index.html"),
        lookdev: here("./lookdev/index.html"),
      },
    },
  },
}));
