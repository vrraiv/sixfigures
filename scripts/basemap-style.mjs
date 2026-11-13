// The street map's layers, for the census maps (main.js, y2011.js), written into them at build
// time (vite.config.js defines __BASEMAP_LAYERS__): Protomaps' "light" look from
// @protomaps/basemaps, on the basemap archive pipeline/basemap.py cuts for Toronto.
//
// What is left out, and why:
//  - the icon layers (points of interest, one-way arrows, route shields): the style has no
//    sprite sheet, and a data map under the census colours has no use for them;
//  - nothing else: the layers keep Protomaps' order, with the labels last, which is where
//    main.js slips the census colours in (under the first label).
//
// Labels are in English (`lang`). Their glyphs are the files in web/public/fonts.
import { layers, namedFlavor } from "@protomaps/basemaps";

export const SOURCE = "protomaps";
export const LANG = "en";

// Protomaps' light flavour with its cyan water turned to a grey-blue: under the census maps' blues
// the lake should recede, as it did on the map this replaced.
export const FLAVOR = { ...namedFlavor("light"), water: "#d3dce2" };

export function basemapLayers() {
  return layers(SOURCE, FLAVOR, { lang: LANG }).filter((l) => !l.layout?.["icon-image"]);
}

// Every font stack the layers name, as the names glyph files are filed under:
// a stack is a name, or an expression choosing between names.
export function fontStacks(list = basemapLayers()) {
  const names = new Set();
  const walk = (v) => (Array.isArray(v) ? v.forEach(walk) : typeof v === "string" && /^Noto Sans /.test(v) && names.add(v));
  for (const l of list) walk(l.layout?.["text-font"]);
  return [...names].sort();
}

// The glyph ranges kept in web/public/fonts: Latin, Latin Extended-A and general punctuation
// (en and em dashes, curly quotes), which the place names in Toronto use.
export const GLYPH_RANGES = ["0-255", "256-511", "8192-8447"];
