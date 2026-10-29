// Fail the build if the first load gets too heavy, or if web/dist breaks a
// Cloudflare Workers static-assets limit.
//
// The map tiles are static files under tiles/ (scripts/extract-tiles.mjs), so the
// browser fetches only those in view. The budget is the whole 2021 tile set at
// its heaviest zoom level: no view can need more than that, and the opening
// whole-city view (zoom 10 or so) needs about a whole level. Each measure adds to
// every tile. The 2016 tiles, search.json and the CSVs load only on demand.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const MB = 1024 * 1024;
const ZOOM_LIMIT = 2 * MB;
const FILE_LIMIT = 25 * MB; // Workers static assets: largest single file
const COUNT_LIMIT = 20000; // Workers Free: files per deployed version

// Files wrangler leaves out of the deploy (web/public/.assetsignore).
const ignored = readFileSync("web/dist/.assetsignore", "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
  .map((g) => new RegExp(`^${g.replaceAll(".", "\\.").replaceAll("*", "[^/]*")}$`));
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [{ path: relative("web/dist", join(dir, e.name)).replaceAll("\\", "/"), size: statSync(join(dir, e.name)).size }]);
const files = walk("web/dist").filter((f) => f.path !== ".assetsignore" && !ignored.some((re) => re.test(f.path)));
const mb = (n) => (n / MB).toFixed(2);
const size = (re) => files.filter((f) => re.test(f.path)).reduce((a, f) => a + f.size, 0);

const zooms = {};
for (const f of files) {
  const m = f.path.match(/^tiles\/da-[0-9a-f]+\/(\d+)\//);
  if (m) zooms[m[1]] = (zooms[m[1]] ?? 0) + f.size;
}
const [heavy, heavyBytes] = Object.entries(zooms).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
const z10 = zooms[10] ?? 0;
// Loaded before the map draws: the page, its CSS and JS (but not the lazy search
// chunk), the MapLibre worker, breaks.json and the zoom-10 tiles.
const first = size(/^(index\.html|breaks\.json|assets\/(index|maplibre)-.*)$/) + z10;
const total = files.reduce((a, f) => a + f.size, 0);
console.log(`2021 tiles: heaviest zoom (z${heavy}) ${mb(heavyBytes)} MB of ${mb(ZOOM_LIMIT)} MB budget; first load ~${mb(first)} MB; deploying ${mb(total)} MB in ${files.length} files`);

const errors = [];
if (!heavyBytes) errors.push("web/dist/tiles/da-* is missing.");
if (heavyBytes > ZOOM_LIMIT) errors.push(`The 2021 tiles at zoom ${heavy} exceed the ${mb(ZOOM_LIMIT)} MB budget.`);
for (const f of files.filter((f) => f.size > FILE_LIMIT)) errors.push(`${f.path} (${mb(f.size)} MB) exceeds Cloudflare's 25 MB per-file limit.`);
if (files.length > COUNT_LIMIT) errors.push(`${files.length} files exceed the Workers Free limit of ${COUNT_LIMIT}.`);
if (errors.length) {
  for (const e of errors) console.error(e);
  process.exit(1);
}
