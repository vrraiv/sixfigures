import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

// Content hashes of the data files, appended as ?v= so they can be cached as
// immutable (see web/public/_headers) yet still bust when the data is rebuilt.
const version = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 12);

export default defineConfig({
  root: "web",
  define: {
    __TILES_VERSION__: JSON.stringify(version("web/public/toronto_da.pmtiles")),
    __TILES16_VERSION__: JSON.stringify(version("web/public/toronto_da_2016.pmtiles")),
    __SEARCH_VERSION__: JSON.stringify(version("web/public/search.json")),
  },
  build: { outDir: "dist", emptyOutDir: true },
});
