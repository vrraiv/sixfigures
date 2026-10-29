import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vite";
import { extractTiles } from "./scripts/extract-tiles.mjs";

// Content hashes of the data files, appended as ?v= so they can be cached as
// immutable (see web/public/_headers) yet still bust when the data is rebuilt.
const version = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 12);
// One version for every figures file (pipeline/figures.py writes them together).
const versionAll = (dir) => {
  const h = createHash("sha256");
  for (const f of readdirSync(dir, { recursive: true }).sort()) if (f.endsWith(".json")) h.update(readFileSync(join(dir, f)));
  return h.digest("hex").slice(0, 12);
};
const FIGURES_VERSION = versionAll("web/public/data/figures");

// The tile archives are unpacked into web/public/tiles (scripts/extract-tiles.mjs);
// main.js gets each one's URL template, zoom range, bounds and layer names.
const TILES = {
  da: await extractTiles("web/public/toronto_da.pmtiles", "da"),
  da16: await extractTiles("web/public/toronto_da_2016.pmtiles", "da16"),
  // Optional (`make overlays`): without the file the boundary control stays hidden.
  ov: await extractTiles("web/public/overlays.pmtiles", "ov"),
};

export default defineConfig({
  root: "web",
  define: {
    __TILES__: JSON.stringify(TILES),
    __BREAKS_VERSION__: JSON.stringify(version("web/public/breaks.json")),
    __SEARCH_VERSION__: JSON.stringify(version("web/public/search.json")),
    __FIGURES_VERSION__: JSON.stringify(FIGURES_VERSION),
  },
  build: { outDir: "dist", emptyOutDir: true },
  // index.html preloads the opening view's DA tiles and figures; it needs the tile
  // source and the figures version for that.
  plugins: [{
    name: "da-tiles-in-html",
    transformIndexHtml: (html) => html.replace("__DA_TILES__", JSON.stringify(TILES.da)).replace("__FIGURES_VERSION__", JSON.stringify(FIGURES_VERSION)),
  }],
});
