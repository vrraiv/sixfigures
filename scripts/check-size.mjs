// Fail the build if the first load gets too heavy, or if web/dist breaks a
// Cloudflare Workers static-assets limit.
//
// Cloudflare serves toronto_da.pmtiles whole (its cache answers Range requests
// with the full file), so every first visit downloads all of it before the map
// draws. That file is the real budget; each measure adds about 0.4 MB to it.
// The 2016 tiles, search.json and the CSVs load only on demand.
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const MB = 1024 * 1024;
const TILES_LIMIT = 5 * MB;
const FILE_LIMIT = 25 * MB; // Workers static assets: largest single file
const COUNT_LIMIT = 20000; // Workers Free: files per deployed version

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [{ path: relative("web/dist", join(dir, e.name)).replaceAll("\\", "/"), size: statSync(join(dir, e.name)).size }]);
const files = walk("web/dist");
const mb = (n) => (n / MB).toFixed(2);
const size = (re) => files.filter((f) => re.test(f.path)).reduce((a, f) => a + f.size, 0);

const tiles = size(/^toronto_da\.pmtiles$/);
// Loaded before the map draws: the page, its CSS and JS (but not the lazy search
// chunk), the MapLibre worker, breaks.json and the 2021 tiles.
const first = size(/^(index\.html|breaks\.json|toronto_da\.pmtiles|assets\/(index|maplibre)-.*)$/);
const total = files.reduce((a, f) => a + f.size, 0);
console.log(`toronto_da.pmtiles: ${mb(tiles)} MB of ${mb(TILES_LIMIT)} MB budget; first load ~${mb(first)} MB; web/dist ${mb(total)} MB in ${files.length} files`);

const errors = [];
if (!tiles) errors.push("web/dist/toronto_da.pmtiles is missing.");
if (tiles > TILES_LIMIT) errors.push(`toronto_da.pmtiles exceeds the ${mb(TILES_LIMIT)} MB budget; every visitor downloads it whole.`);
for (const f of files.filter((f) => f.size > FILE_LIMIT)) errors.push(`${f.path} (${mb(f.size)} MB) exceeds Cloudflare's 25 MB per-file limit.`);
if (files.length > COUNT_LIMIT) errors.push(`${files.length} files exceed the Workers Free limit of ${COUNT_LIMIT}.`);
if (errors.length) {
  for (const e of errors) console.error(e);
  process.exit(1);
}
