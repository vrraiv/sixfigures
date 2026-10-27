import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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
    __BREAKS_VERSION__: JSON.stringify(version("web/public/breaks.json")),
    __SEARCH_VERSION__: JSON.stringify(version("web/public/search.json")),
    // Optional (`make overlays`): without the file the boundary control stays hidden.
    __OVERLAYS_VERSION__: JSON.stringify(existsSync("web/public/overlays.pmtiles") ? version("web/public/overlays.pmtiles") : null),
  },
  build: { outDir: "dist", emptyOutDir: true },
});
