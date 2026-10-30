// Shared by the pages (main.js, y2011.js): the tile protocol, the measure
// catalogue, colours, formatting, the legend patterns and the histogram.
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

// Vector tiles are static files unpacked from the .pmtiles archives at build time
// (scripts/extract-tiles.mjs), so the browser fetches only the tiles in view. They
// are stored gzipped; this protocol inflates them unless the server or browser
// already has. A missing tile (404, or the dev server's index.html) is empty.
maplibregl.setWorkerUrl(workerUrl);
maplibregl.addProtocol("gztile", async ({ url }, abort) => {
  const resp = await fetch(url.replace("gztile://", `${location.origin}/`), { signal: abort.signal });
  if (resp.status === 404 || (resp.headers.get("content-type") ?? "").startsWith("text/html")) return { data: new ArrayBuffer(0) };
  if (!resp.ok) throw new Error(`Tile request failed: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  const b = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  if (b[0] !== 0x1f || b[1] !== 0x8b) return { data: buf };
  return { data: await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer() };
});
export const tileSource = (t) => ({ type: "vector", tiles: [`gztile://${t.tiles}`], minzoom: t.minzoom, maxzoom: t.maxzoom, bounds: t.bounds });
export const TILES = __TILES__;

export const STYLE = "https://tiles.openfreemap.org/styles/positron";
export const BOUNDS = [[-79.6393, 43.5792], [-79.1153, 43.8555]];

// One-hue blue ramp, light -> dark (validated: monotone lightness, single hue).
export const COLORS = ["#cde2fb", "#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#0d366b"];
// Diverging ramp for change: red (fell) <- neutral grey -> blue (rose); each arm
// validated as one hue with monotone lightness, light steps distinct from grey.
export const DIVERGING = ["#8f1c1c", "#d9403f", "#f2a39b", "#f0efec", "#9ec5f4", "#3987e5", "#184f95"];

// Grouped as in the measure menu (index.html); the details tables show the
// current measure's group. unit: "money" (a change can be restated in 2020
// dollars) or "rate" (percent; a change is in percentage points). stat names the
// city-wide figure. dated: "census" for figures StatCan dates by census year
// rather than income year. cerb: 2020 values are moved by pandemic benefits.
// monthly: dollars per month, shown whole rather than in thousands.
export const MEASURES = {
  med_hh_tot: { group: "income", unit: "money", stat: "median", short: "Household, total", long: "Median total household income" },
  med_hh_at: { group: "income", unit: "money", stat: "median", short: "Household, after tax", long: "Median after-tax household income" },
  med_ind_tot: { group: "income", unit: "money", stat: "median", short: "Individual, total", long: "Median total income of recipients (15+)" },
  med_ind_at: { group: "income", unit: "money", stat: "median", short: "Individual, after tax", long: "Median after-tax income of recipients (15+)" },
  avg_hh_tot: { group: "income", unit: "money", stat: "average", short: "Household, average", long: "Average total household income" },
  lim_at: { group: "low", unit: "rate", stat: "rate", cerb: true, short: "Low-income rate", long: "People in low income (LIM-AT)" },
  transfers: { group: "low", unit: "rate", stat: "share", cerb: true, short: "Income from transfers", long: "Share of income from government transfers" },
  renter: { group: "housing", unit: "rate", stat: "share", dated: "census", short: "Renter households", long: "Renter households" },
  shelter30: { group: "housing", unit: "rate", stat: "share", dated: "census", short: "Shelter costs 30%+", long: "Households spending 30%+ of income on shelter" },
  owner30: { group: "housing", unit: "rate", stat: "share", dated: "census", short: "Owners, costs 30%+", long: "Owner households spending 30%+ of income on shelter" },
  tenant30: { group: "housing", unit: "rate", stat: "share", dated: "census", short: "Tenants, costs 30%+", long: "Tenant households spending 30%+ of income on shelter" },
  subsidized: { group: "housing", unit: "rate", stat: "share", dated: "census", short: "Subsidized tenants", long: "Tenant households in subsidized housing" },
  value: { group: "costs", unit: "money", stat: "median", dated: "census", short: "Dwelling value", long: "Median value of owned dwellings" },
  own_cost: { group: "costs", unit: "money", stat: "median", dated: "census", monthly: true, short: "Owner costs, monthly", long: "Median monthly shelter costs of owners" },
  rent: { group: "costs", unit: "money", stat: "median", dated: "census", monthly: true, short: "Rent, monthly", long: "Median monthly shelter costs of renters" },
  detached: { group: "dwellings", unit: "rate", stat: "share", dated: "census", short: "Single-detached", long: "Single-detached houses" },
  apt5: { group: "dwellings", unit: "rate", stat: "share", dated: "census", short: "Apartments, 5+ storeys", long: "Apartments in buildings of 5+ storeys" },
  condo: { group: "dwellings", unit: "rate", stat: "share", dated: "census", short: "Condominiums", long: "Condominium dwellings" },
  built_new: { group: "dwellings", unit: "rate", stat: "share", dated: "census", short: "Built in past 5 years", long: "Dwellings built in the five years before the census" },
  built_old: { group: "dwellings", unit: "rate", stat: "share", dated: "census", short: "Built 1960 or before", long: "Dwellings built in 1960 or before" },
  crowded: { group: "dwellings", unit: "rate", stat: "share", dated: "census", short: "Not suitable (crowded)", long: "Households in housing not suitable for their size" },
  degree: { group: "people", unit: "rate", stat: "share", dated: "census", short: "Bachelor's+, aged 25–64", long: "Adults 25–64 with a bachelor's degree or higher" },
  moved1: { group: "people", unit: "rate", stat: "share", dated: "census", short: "Moved in past year", long: "People who moved in the past year" },
  moved5: { group: "people", unit: "rate", stat: "share", dated: "census", short: "Moved in past 5 years", long: "People who moved in the past five years" },
  imm_recent: { group: "people", unit: "rate", stat: "share", dated: "census", short: "Recent immigrants", long: "Immigrants who arrived in the five years before the census" },
  age0_14: { group: "people", unit: "rate", stat: "share", dated: "census", short: "Aged 0–14", long: "Children aged 0 to 14" },
  age65: { group: "people", unit: "rate", stat: "share", dated: "census", short: "Aged 65+", long: "People aged 65 and over" },
};
// col: the details table's value column; noun: what the group's figures are.
export const GROUPS = {
  income: { col: "Income", noun: "incomes" }, low: { col: "Share", noun: "shares" }, housing: { col: "Share", noun: "shares" },
  costs: { col: "Median", noun: "medians" }, dwellings: { col: "Share", noun: "shares" }, people: { col: "Share", noun: "shares" },
};
export const YEARS = {
  2016: { source: "da16", income: "2015", census: "2016 Census", pop: "pop16" },
  2021: { source: "da", income: "2020", census: "2021 Census", pop: "pop21" },
};
export const VIEWS = ["2016", "2021", "change"];
// The year measure m's figures refer to, for census "2016" or "2021".
export const refYear = (m, y) => (MEASURES[m].dated === "census" ? y : YEARS[y].income);
export const lc = (s) => s[0].toLowerCase() + s.slice(1); // keeps "LIM-AT"

export const narrow = window.matchMedia("(max-width: 640px)");
export const $ = (id) => document.getElementById(id);
export const fmtMoney = (v) => (v == null ? "—" : `$${v.toLocaleString("en-CA")}`);
export const fmtCount = (v) => (v == null ? "—" : v.toLocaleString("en-CA"));
export const fmtK = (v) => `$${(v / 1000).toLocaleString("en-CA", { maximumFractionDigits: 1 })}k`;
export const sign = (v) => (v > 0 ? "+" : v < 0 ? "−" : "±");
export const fmtSignedMoney = (v) => (v == null ? "—" : `${sign(v)}$${Math.abs(v).toLocaleString("en-CA")}`);
export const fmtSignedK = (v) => `${sign(v)}${fmtK(Math.abs(v))}`;
export const fmtPts = (v) => (v == null ? "—" : `${sign(v)}${Math.abs(v)} pts`);
// Rates: one decimal in tables, trimmed in legends and axes. "pp" (percentage
// points) is kept distinct from "pts" (percentile points).
export const fmtPct = (v) => (v == null ? "—" : `${v.toFixed(1)}%`);
export const fmtPctShort = (v) => `${+v.toFixed(1)}%`;
export const fmtPP = (v) => (v == null ? "—" : `${sign(v)}${Math.abs(v).toFixed(1)} pp`);
export const fmtPPShort = (v) => `${sign(v)}${+Math.abs(v).toFixed(1)} pp`;
export const isMoney = (m) => MEASURES[m].unit === "money";
export const fmtVal = (m, v) => (isMoney(m) ? fmtMoney(v) : fmtPct(v));
// Monthly costs are in whole dollars; other money in thousands.
export const fmtMoneyShort = (m) => (MEASURES[m].monthly ? fmtMoney : fmtK);
export const fmtAxis = (m) => (isMoney(m) ? fmtMoneyShort(m) : fmtPctShort);
export const fmtDiff = (m, v) => (isMoney(m) ? fmtSignedMoney(v) : fmtPP(v));
export const fmtDiffShort = (m) => (isMoney(m) ? (MEASURES[m].monthly ? fmtSignedMoney : fmtSignedK) : fmtPPShort);
export const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
export const escapeHTML = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function pattern(kind) {
  const size = 16, c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.fillStyle = kind === "dots" ? "#f7f7f5" : "#e4e4e0";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = ctx.strokeStyle = "#9a9a95";
  if (kind === "dots") {
    for (const [x, y] of [[4, 4], [12, 12]]) {
      ctx.beginPath();
      ctx.arc(x, y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // 45° lines, drawn across tile edges so the pattern tiles seamlessly
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const o of [-size, 0, size]) {
      ctx.moveTo(o, size);
      ctx.lineTo(o + size, 0);
    }
    ctx.stroke();
  }
  return ctx.getImageData(0, 0, size, size);
}

export function distHTML(d) {
  const { lo, width, counts } = d.hist;
  const n = counts.length, max = Math.max(...counts);
  const bin = Math.min(Math.max(Math.floor((d.value - lo) / width), 0), n - 1);
  const W = 300, H = 44, bw = W / n;
  const bars = counts.map((c, i) => {
    const h = c ? Math.max((c / max) * H, 1) : 0;
    return `<rect x="${(i * bw + 0.5).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${h.toFixed(1)}"${i === bin ? ' class="here"' : ""}/>`;
  }).join("");
  const rx = ((d.ref - lo) / (width * n)) * W;
  const ref = rx >= 0 && rx <= W ? `<line x1="${rx.toFixed(1)}" x2="${rx.toFixed(1)}" y1="0" y2="${H}" class="ref"/>` : "";
  const hi = lo + width * n;
  const label = `Histogram. This DA is in the ${d.fmt(lo + bin * width)} to ${d.fmt(lo + (bin + 1) * width)} bin, with ${fmtCount(counts[bin])} DAs.`;
  return `<figure class="dist">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${escapeHTML(label)}">${bars}${ref}</svg>
      <div class="dist-axis"><span>${lo === 0 && d.zero ? d.zero : `${d.fmt(lo)} or less`}</span><span>${hi >= (d.max ?? Infinity) ? d.fmt(hi) : `${d.fmt(hi)} or more`}</span></div>
      <figcaption>${escapeHTML(d.caption)}</figcaption>
    </figure>`;
}
