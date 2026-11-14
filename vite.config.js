import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vite";
import { extractTiles } from "./scripts/extract-tiles.mjs";
import { basemapLayers } from "./scripts/basemap-style.mjs";
import { brandSvg, heroKey, heroSvg } from "./scripts/city-map.mjs";
import { pagePath, pageTarget, siteFooter, siteGuide, siteHeader, siteTitle, socialTags } from "./scripts/site-nav.mjs";

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
  da11: await extractTiles("web/public/toronto_da_2011.pmtiles", "da11"),
  // The street map (`make basemap`, pipeline/basemap.py): committed, like the others.
  base: await extractTiles("web/public/basemap.pmtiles", "base"),
  // Optional (`make overlays`): without the file the boundary control stays hidden.
  ov: await extractTiles("web/public/overlays.pmtiles", "ov"),
};

// The map beside the site's name: the neighbourhoods by 2021 household income (scripts/city-map.mjs),
// written beside the other public files and versioned like them.
writeFileSync("web/public/brand-map.svg", brandSvg());
const BRAND = `/brand-map.svg?v=${version("web/public/brand-map.svg")}`;

export default defineConfig({
  root: "web",
  define: {
    __TILES__: JSON.stringify(TILES),
    __BASEMAP_LAYERS__: JSON.stringify(basemapLayers()),
    __BREAKS_VERSION__: JSON.stringify(version("web/public/breaks.json")),
    __BREAKS_2011_VERSION__: JSON.stringify(version("web/public/breaks_2011.json")),
    __INSIGHTS_VERSION__: JSON.stringify(version("web/public/insights.json")),
    __SCHOOLS_VERSION__: JSON.stringify(version("web/public/schools.json")),
    __HOUSING_VERSION__: JSON.stringify(version("web/public/housing.json")),
    __PRICES_VERSION__: JSON.stringify(version("web/public/prices.json")),
    __SAFETY_VERSION__: JSON.stringify(version("web/public/safety.json")),
    __TREES_VERSION__: JSON.stringify(version("web/public/trees.json")),
    __EXPLORER_VERSION__: JSON.stringify(versionAll("web/public/explorer")),
    __NEIGHBOURHOODS_VERSION__: JSON.stringify(version("web/public/neighbourhoods.json")),
    __TREES_DA_VERSION__: JSON.stringify(version("web/public/trees_da.json")),
    __FORECASTS_VERSION__: JSON.stringify(version("web/public/forecasts.json")),
    __SEARCH_VERSION__: JSON.stringify(version("web/public/search.json")),
    __FIGURES_VERSION__: JSON.stringify(FIGURES_VERSION),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Fifteen pages (each also listed in scripts/site-nav.mjs): / (the landing page) and /about/, /census/ (2016 and 2021), /2011/,
    // the Insights pages /insights/ (census), /insights/schools/, /insights/housing/, /insights/prices/, /insights/safety/, /insights/trees/,
    // /insights/explorer/ and /insights/neighbourhoods/, and the Forecasts pages /forecasts/ (method), /forecasts/schools/ and /forecasts/value/.
    rollupOptions: { input: { home: "web/index.html", about: "web/about/index.html", main: "web/census/index.html", 2011: "web/2011/index.html", insights: "web/insights/index.html", schools: "web/insights/schools/index.html", housing: "web/insights/housing/index.html", prices: "web/insights/prices/index.html", safety: "web/insights/safety/index.html", trees: "web/insights/trees/index.html", explorer: "web/insights/explorer/index.html", neighbourhoods: "web/insights/neighbourhoods/index.html", forecasts: "web/forecasts/index.html", fcschools: "web/forecasts/schools/index.html", fcvalue: "web/forecasts/value/index.html" } },
  },
  // As web/public/_headers does in production, for the #diag profiler.
  preview: { headers: { "Document-Policy": "js-profiling" } },
  // census/index.html preloads the opening view's DA tiles and figures; it needs the tile
  // source and the figures version for that.
  plugins: [{
    // The site header and name, and the footer's disclaimer and links, on every page (scripts/site-nav.mjs);
    // on the landing page, the guide to the header's links and the city map too (scripts/city-map.mjs).
    name: "site-header",
    transformIndexHtml: (html, ctx) => socialTags(siteFooter(siteTitle(pageTarget(html))), pagePath(ctx.path)).replace("<!-- site-header -->", siteHeader(pagePath(ctx.path), BRAND))
      .replace("<!-- site-guide -->", () => siteGuide()).replace("<!-- city-map -->", () => heroSvg()).replace("<!-- city-map-key -->", () => heroKey()),
  }, {
    name: "da-tiles-in-html",
    transformIndexHtml: (html) => html.replace("__DA_TILES__", JSON.stringify(TILES.da)).replace("__DA11_TILES__", JSON.stringify(TILES.da11)).replace("__FIGURES_VERSION__", JSON.stringify(FIGURES_VERSION))
      .replace("__BREAKS_VERSION__", JSON.stringify(version("web/public/breaks.json"))),
  }],
});
