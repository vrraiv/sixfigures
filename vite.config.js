import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

// Content hash of the tiles, appended as ?v= so the .pmtiles URL can be cached
// as immutable (see web/public/_headers) yet still bust when the data is rebuilt.
const tilesVersion = createHash("sha256")
  .update(readFileSync("web/public/toronto_da.pmtiles"))
  .digest("hex")
  .slice(0, 12);

export default defineConfig({
  root: "web",
  define: { __TILES_VERSION__: JSON.stringify(tilesVersion) },
  build: { outDir: "dist", emptyOutDir: true },
});
