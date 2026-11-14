// The street map (scripts/basemap-style.mjs, pipeline/basemap.py): it is the site's own, with every
// layer, label font and glyph range it asks for kept in the repository, and nothing fetched from a
// map service.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { GLYPH_RANGES, SOURCE, basemapLayers, fontStacks } from "./basemap-style.mjs";
import { BASEMAP_SOURCE, pruned } from "../web/src/quality.js";

test("the layers draw from the one source, with no icons (there is no sprite)", () => {
  const layers = basemapLayers();
  assert.ok(layers.length > 30);
  assert.equal(layers[0].type, "background");
  for (const l of layers.slice(1)) assert.equal(l.source, SOURCE, l.id);
  assert.ok(layers.every((l) => !l.layout?.["icon-image"]));
  // main.js and y2011.js slip the census colours in under the first label, so there must be one
  assert.ok(layers.some((l) => l.type === "symbol"));
});

test("low and medium map detail thin these layers: fills and minor lines go, water, major roads and labels stay", () => {
  assert.equal(BASEMAP_SOURCE, SOURCE);
  const layers = basemapLayers(), gone = layers.filter(pruned).map((l) => l.id), kept = layers.filter((l) => !pruned(l)).map((l) => l.id);
  assert.ok(gone.length >= 20, `only ${gone.length} layers pruned`);
  for (const id of ["landcover", "landuse_park", "buildings", "roads_minor", "roads_minor_casing", "roads_tunnels_major", "roads_major_casing_late"]) assert.ok(gone.includes(id), id);
  for (const id of ["background", "earth", "water", "roads_major", "roads_highway", "roads_bridges_highway", "roads_labels_major", "places_subplace"]) assert.ok(kept.includes(id), id);
  assert.ok(layers.filter((l) => l.type === "symbol").every((l) => !pruned(l)));
});

test("every font stack the layers use has every glyph range on disk", () => {
  const stacks = fontStacks();
  assert.ok(stacks.length >= 2, stacks.join());
  for (const f of stacks) for (const r of GLYPH_RANGES) assert.ok(existsSync(join("web/public/fonts", f, `${r}.pbf`)), `${f} ${r}`);
});

test("the basemap archive is committed, and only the committed fonts are there", () => {
  assert.ok(statSync("web/public/basemap.pmtiles").size > 1e6);
  assert.deepEqual(readdirSync("web/public/fonts").filter((f) => f !== "NOTICE.txt").sort(), fontStacks().sort());
});

test("no page or script asks a map service for anything", () => {
  const files = ["vite.config.js", ...["web/src", "web", "web/census", "web/2011", "web/about"].flatMap((d) => readdirSync(d).filter((f) => /\.(js|html)$/.test(f)).map((f) => join(d, f)))];
  for (const f of files) assert.ok(!/openfreemap|openmaptiles\.org\/|tiles\.mapbox|maptiler|stadiamaps/i.test(readFileSync(f, "utf8")), f);
});
