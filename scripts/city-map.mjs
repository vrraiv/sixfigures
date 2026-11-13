// The city as a small map: the 158 neighbourhoods coloured by 2021 median household income,
// on the map's own blues, drawn from web/public/insights.json (pipeline/insights.py). Three uses:
//
//   brandSvg()  the mark beside the site's name in every page's header, a file of its own
//               (vite.config.js writes web/public/brand-map.svg) so pages share one cached copy
//   iconSvg()   the browser-tab icon (scripts/make-icons.mjs writes the committed files)
//   heroSvg()   the landing page's map, inline, each neighbourhood a link to the census map there
//
// Six classes with the same number of neighbourhoods in each, lightest for the lowest incomes.
import { readFileSync } from "node:fs";

// web/src/catalogue.js COLORS: one hue, light to dark
const COLORS = ["#cde2fb", "#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#0d366b"];
const NONE = "#d9d9d4"; // no figure
export const MEASURE = "med_hh_tot", YEAR = "2021";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const money = (v) => `$${Math.round(v).toLocaleString("en-CA")}`;

export function cityMap(file = "web/public/insights.json") {
  const d = JSON.parse(readFileSync(file, "utf8"));
  const values = d.measures[MEASURE].values[YEAR];
  const sorted = values.filter((v) => v != null).sort((a, b) => a - b);
  // the lowest value of each class above the first
  const cuts = COLORS.slice(1).map((_, k) => sorted[Math.round(((k + 1) * sorted.length) / COLORS.length)]);
  const cls = (v) => (v == null ? -1 : cuts.filter((c) => v >= c).length);
  return {
    width: d.map.width, height: d.map.height, cuts, low: sorted[0], high: sorted.at(-1), city: d.measures[MEASURE].city[YEAR],
    nbhd: d.nbhd.map((n, i) => ({ name: n.name, at: n.at, path: n.path, value: values[i], cls: cls(values[i]) })),
  };
}

const fill = (n) => (n.cls < 0 ? NONE : COLORS[n.cls]);
// one path per colour: the mark is drawn far too small to tell neighbours of a class apart
const byClass = (m) => [NONE, ...COLORS].map((c) => [c, m.nbhd.filter((n) => fill(n) === c).map((n) => n.path).join("")]).filter(([, p]) => p);

export function brandSvg(m = cityMap()) {
  // a hairline of its own colour closes the gaps antialiasing leaves between neighbours
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.width} ${m.height}"><g stroke-width="3" stroke-linejoin="round">${byClass(m).map(([c, p]) => `<path fill="${c}" stroke="${c}" d="${p}"/>`).join("")}</g></svg>\n`;
}

// The browser-tab and home-screen icon: the same map on a white rounded square, so it reads on
// light and dark tab bars alike. scripts/make-icons.mjs writes the files.
export function iconSvg(m = cityMap(), { bg = "#ffffff", colors = COLORS, pad = 1.5, rx = 7 } = {}) {
  const k = (32 - 2 * pad) / m.width, y = (32 - m.height * k) / 2;
  const groups = [NONE, ...COLORS].map((c, i) => [i ? colors[i - 1] : NONE, m.nbhd.filter((n) => fill(n) === c).map((n) => n.path).join("")]).filter(([, p]) => p);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <!-- Toronto's neighbourhoods by 2021 median household income (scripts/city-map.mjs). -->
  <rect width="32" height="32" rx="${rx}" fill="${bg}"/>
  <g transform="translate(${pad} ${+y.toFixed(2)}) scale(${+k.toFixed(5)})" stroke-width="3" stroke-linejoin="round">${groups.map(([c, p]) => `<path fill="${c}" stroke="${c}" d="${p}"/>`).join("")}</g>
</svg>
`;
}

// Where a neighbourhood's link lands: the census map, on this measure, with neighbourhood outlines.
export const mapHref = (n) => `/census/#m=${MEASURE}&amp;y=${YEAR}&amp;at=13/${n.at[0]}/${n.at[1]}&amp;o=nbhd`;

export function heroSvg(m = cityMap()) {
  const shapes = m.nbhd.map((n) => `<a href="${mapHref(n)}" tabindex="-1"><path fill="${fill(n)}" d="${n.path}"><title>${esc(n.name)}: ${n.value == null ? "no figure" : money(n.value)}</title></path></a>`).join("");
  return `<svg class="home-map" viewBox="-4 -4 ${m.width + 8} ${m.height + 8}" role="img" aria-label="Toronto's 158 neighbourhoods, shaded by median household income in the 2021 Census">${shapes}</svg>`;
}

// The hero map's key: six swatches and the range each covers.
export function heroKey(m = cityMap()) {
  const k = (v) => `$${Math.round(v / 1000)}k`;
  const edges = [m.low, ...m.cuts, m.high];
  return `<ol class="home-key" aria-label="Median household income, 2021 Census">${COLORS.map((c, i) => `<li><span style="background:${c}"></span>${i === 0 ? `under ${k(edges[1])}` : i === COLORS.length - 1 ? `${k(edges[i])} and over` : `${k(edges[i])}–${k(edges[i + 1])}`}</li>`).join("")}</ol>`;
}
