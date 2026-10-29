import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import { compose, grabMap, toBlob } from "./snapshot.js";
import "./style.css";

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
const tileSource = (t) => ({ type: "vector", tiles: [`gztile://${t.tiles}`], minzoom: t.minzoom, maxzoom: t.maxzoom, bounds: t.bounds });
const TILES = __TILES__;
// Boundary overlays (`make overlays`); null when the file wasn't built.
const OVERLAY_TILES = TILES.ov;

const STYLE = "https://tiles.openfreemap.org/styles/positron";
const BOUNDS = [[-79.6393, 43.5792], [-79.1153, 43.8555]];

// One-hue blue ramp, light -> dark (validated: monotone lightness, single hue).
const COLORS = ["#cde2fb", "#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#0d366b"];
// Diverging ramp for change: red (fell) <- neutral grey -> blue (rose); each arm
// validated as one hue with monotone lightness, light steps distinct from grey.
const DIVERGING = ["#8f1c1c", "#d9403f", "#f2a39b", "#f0efec", "#9ec5f4", "#3987e5", "#184f95"];

// Grouped as in the measure menu (index.html); the details tables show the
// current measure's group. unit: "money" (a change can be restated in 2020
// dollars) or "rate" (percent; a change is in percentage points). stat names the
// city-wide figure. dated: "census" for figures StatCan dates by census year
// rather than income year. cerb: 2020 values are moved by pandemic benefits.
// monthly: dollars per month, shown whole rather than in thousands.
const MEASURES = {
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
const GROUPS = {
  income: { col: "Income", noun: "incomes" }, low: { col: "Share", noun: "shares" }, housing: { col: "Share", noun: "shares" },
  costs: { col: "Median", noun: "medians" }, dwellings: { col: "Share", noun: "shares" }, people: { col: "Share", noun: "shares" },
};
const YEARS = {
  2016: { source: "da16", income: "2015", census: "2016 Census", pop: "pop16" },
  2021: { source: "da", income: "2020", census: "2021 Census", pop: "pop21" },
};
const VIEWS = ["2016", "2021", "change"];
// The year measure m's figures refer to, for census "2016" or "2021".
const refYear = (m, y) => (MEASURES[m].dated === "census" ? y : YEARS[y].income);
const lc = (s) => s[0].toLowerCase() + s.slice(1); // keeps "LIM-AT"

const narrow = window.matchMedia("(max-width: 640px)");
const $ = (id) => document.getElementById(id);
const fmtMoney = (v) => (v == null ? "—" : `$${v.toLocaleString("en-CA")}`);
const fmtCount = (v) => (v == null ? "—" : v.toLocaleString("en-CA"));
const fmtK = (v) => `$${(v / 1000).toLocaleString("en-CA", { maximumFractionDigits: 1 })}k`;
const sign = (v) => (v > 0 ? "+" : v < 0 ? "−" : "±");
const fmtSignedMoney = (v) => (v == null ? "—" : `${sign(v)}$${Math.abs(v).toLocaleString("en-CA")}`);
const fmtSignedK = (v) => `${sign(v)}${fmtK(Math.abs(v))}`;
const fmtPts = (v) => (v == null ? "—" : `${sign(v)}${Math.abs(v)} pts`);
// Rates: one decimal in tables, trimmed in legends and axes. "pp" (percentage
// points) is kept distinct from "pts" (percentile points).
const fmtPct = (v) => (v == null ? "—" : `${v.toFixed(1)}%`);
const fmtPctShort = (v) => `${+v.toFixed(1)}%`;
const fmtPP = (v) => (v == null ? "—" : `${sign(v)}${Math.abs(v).toFixed(1)} pp`);
const fmtPPShort = (v) => `${sign(v)}${+Math.abs(v).toFixed(1)} pp`;
const isMoney = (m) => MEASURES[m].unit === "money";
const fmtVal = (m, v) => (isMoney(m) ? fmtMoney(v) : fmtPct(v));
// Monthly costs are in whole dollars; other money in thousands.
const fmtMoneyShort = (m) => (MEASURES[m].monthly ? fmtMoney : fmtK);
const fmtAxis = (m) => (isMoney(m) ? fmtMoneyShort(m) : fmtPctShort);
const fmtDiff = (m, v) => (isMoney(m) ? fmtSignedMoney(v) : fmtPP(v));
const fmtDiffShort = (m) => (isMoney(m) ? (MEASURES[m].monthly ? fmtSignedMoney : fmtSignedK) : fmtPPShort);
const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
const escapeHTML = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---- state ------------------------------------------------------------------

const select = $("measure");
const changeBy = $("changeby");
// The URL hash keeps the view shareable: #m=<measure>&y=<view>&c=<change basis>
// &da=<DAUID of the open DA>&vs=<DAUID pinned for comparison>&o=<boundary overlay>
// &at=<zoom>/<lat>/<lng>.
const hashParams = new URLSearchParams(location.hash.slice(1));
if (hashParams.get("m") in MEASURES) select.value = hashParams.get("m");
let view = VIEWS.includes(hashParams.get("y")) ? hashParams.get("y") : "2021";
// The change-basis menu depends on the measure's unit. wantBasis is the last
// basis asked for, so "real" comes back after a visit to a rate measure.
// Money is restated in the later year's dollars: 2020 for incomes, 2021 for
// figures dated by census.
const BASES = {
  money: (m) => [["real", `Change in ${refYear(m, "2021")} dollars (inflation-adjusted)`], ["dollars", "Change in nominal dollars"], ["points", "Change in percentile rank"]],
  rate: () => [["pp", "Change in pp (percentage points)"], ["points", "Change in percentile rank"]],
};
let wantBasis = ["real", "dollars", "pp", "points"].includes(hashParams.get("c")) ? hashParams.get("c") : "real";
function syncChangeBy() {
  const m = select.value;
  const opts = BASES[MEASURES[m].unit](m);
  const v = opts.some(([k]) => k === wantBasis) ? wantBasis : opts[0][0];
  const key = `${MEASURES[m].unit}:${refYear(m, "2021")}`;
  if (changeBy.dataset.unit !== key) {
    changeBy.innerHTML = opts.map(([k, t]) => `<option value="${k}">${t}</option>`).join("");
    changeBy.dataset.unit = key;
  }
  changeBy.value = v;
}
syncChangeBy();
changeBy.addEventListener("change", () => (wantBasis = changeBy.value));
const dauidParam = (k) => (/^\d{8}$/.test(hashParams.get(k) ?? "") ? hashParams.get(k) : null);
const linkedDA = dauidParam("da");
const linkedPin = dauidParam("vs");
const linkedAt = (hashParams.get("at") ?? "").split("/").map(Number);
const camera = linkedAt.length === 3 && linkedAt.every(Number.isFinite)
  ? { zoom: linkedAt[0], center: [linkedAt[2], linkedAt[1]] }
  : { bounds: BOUNDS, fitBoundsOptions: { padding: 24 } };
document.querySelector(`input[name=year][value="${view}"]`).checked = true;
if (narrow.matches) $("legend").open = false;

const breaks = await fetch(`/breaks.json?v=${__BREAKS_VERSION__}`).then((r) => r.json());
// 2015 dollars -> 2020 dollars for incomes, 2016 -> 2021 for census-dated figures
// (annual-average CPI, table 18-10-0005-01; see breaks.json).
const cpiOf = (m) => (MEASURES[m].dated === "census" ? breaks.cpi.factor_census : breaks.cpi.factor);
// breaks.json from before cpi.py had no geography (it was Canada); never let a
// stale cached copy stop the page from loading.
const cpiName = `${(breaks.cpi.geography ?? "Canada").split(",")[0]} CPI`;
const inflationPct = (m) => {
  const [a, b] = [refYear(m, "2016"), refYear(m, "2021")];
  return (breaks.cpi[b] / breaks.cpi[a] * 100 - 100).toFixed(1);
};
const dollarsOf = (m) => `${refYear(m, "2021")} dollars`;
// "2015 incomes restated in 2020 dollars", "2016 medians restated in 2021 dollars"
const restated = (m) => `${refYear(m, "2016")} ${GROUPS[MEASURES[m].group].noun} restated in ${dollarsOf(m)}`;
const cerbNote = (m) => (MEASURES[m].group === "income" ? " 2020 incomes include pandemic benefits (CERB)." : "");

const sourceOf = (v) => (v === "2016" ? "da16" : "da");
const yearOf = (v) => (v === "2016" ? "2016" : "2021");

const map = new maplibregl.Map({
  container: "map",
  style: STYLE,
  ...camera,
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

// ---- colour expressions -----------------------------------------------------

function step(value, stops, colors) {
  const expr = ["step", value, colors[0]];
  stops.forEach((s, i) => expr.push(s, colors[i + 1]));
  return expr;
}

// Pooled 2016+2021 quantile breaks: a colour means the same value in both years.
const levelColor = (m) => step(["get", m], breaks.measures[m].breaks.slice(1, -1), COLORS);

// Dollar figures in the change view are in real dollars unless "nominal" is
// chosen (also while a rate measure is shown, for its group's money rows).
const realDollars = () => changeBy.value !== "dollars";
const byPoints = () => changeBy.value === "points";

function changeValue(m) {
  if (byPoints()) return ["-", ["get", `pct_${m}`], ["get", `p16_${m}`]];
  if (isMoney(m) && realDollars()) return ["-", ["get", m], ["*", ["get", `v16_${m}`], cpiOf(m)]];
  return ["-", ["get", m], ["get", `v16_${m}`]];
}
const changeStops = (m) => breaks.measures[m].change[byPoints() ? "points" : "value"];

// Change in a DA's value for measure k (null if not comparable): dollars, real
// unless nominal is chosen, or percentage points for a rate.
function valueChange(p, k) {
  if (p.rel !== 1 || p[k] == null || p[`v16_${k}`] == null) return null;
  if (!isMoney(k)) return Math.round((p[k] - p[`v16_${k}`]) * 10) / 10;
  return Math.round(p[k] - p[`v16_${k}`] * (realDollars() ? cpiOf(k) : 1));
}
const changeColor = (m) => step(changeValue(m), changeStops(m), DIVERGING);

// Change is only defined for boundary-identical DAs published in both years.
const comparable = (m) => ["all", ["==", ["get", "rel"], 1], ["has", m], ["has", `v16_${m}`]];
const notPublished = (m) => ["all", ["==", ["get", "rel"], 1], ["!", comparable(m)]];

function pattern(kind) {
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

// ---- legend -----------------------------------------------------------------

// Legend model, shared by the on-page legend and the snapshot image.
function legendModel() {
  const m = select.value;
  const meta = breaks.measures[m];
  const d = MEASURES[m], money = isMoney(m);
  if (view === "change") {
    const pts = byPoints();
    const s = changeStops(m);
    const f = pts ? fmtPts : fmtDiffShort(m);
    const items = DIVERGING.map((color, i) => ({
      color,
      label: i === 0 ? `Less than ${f(s[0])}` : i === DIVERGING.length - 1 ? `${f(s.at(-1))} or more`
        : s[i - 1] < 0 && s[i] > 0 ? `Within ${pts ? `±${s[i]} pts` : money ? `±${fmtMoneyShort(m)(s[i])}` : `±${s[i]} pp`}` : `${f(s[i - 1])} to ${f(s[i])}`,
    }));
    const c = meta.change;
    items.push({ pattern: "dots", label: `Boundary changed since 2016 (${c.boundary_changed} DAs)` });
    items.push({ pattern: "hatch", label: `Not published in 2016 or 2021 (${c.not_published} DAs)` });
    const y16 = meta.y2016.city, y21 = meta.y2021.city;
    const real = money && realDollars();
    const years = `${refYear(m, "2016")} → ${refYear(m, "2021")}`;
    const city = d.stat === "median" || d.stat === "average" ? `City ${d.stat}` : "City as a whole";
    const cerb = d.cerb ? " 2020 incomes include one-off pandemic benefits (CERB), so much of this change reflects 2020 alone." : "";
    return {
      title: pts ? `Change in percentile rank, ${lc(d.long)}, ${years}`
        : `Change in ${lc(d.long)}, ${years}${real ? `, in ${dollarsOf(m)}` : money ? "" : ", in percentage points"}`,
      items,
      footer: pts ? `Median DA change: ${fmtPts(c.median_points)}`
        : !money ? `${city}: ${fmtPct(y16)} → ${fmtPct(y21)} (${fmtPP(Math.round((y21 - y16) * 10) / 10)})`
          : real ? `${city}: ${fmtMoney(Math.round(y16 * cpiOf(m)))} → ${fmtMoney(y21)} in ${dollarsOf(m)} (${fmtSignedMoney(Math.round(y21 - y16 * cpiOf(m)))})`
            : `${city}: ${fmtMoney(y16)} → ${fmtMoney(y21)} (${fmtSignedMoney(y21 - y16)})`,
      note: (pts ? "Percentile = rank among Toronto DAs within each census."
        : !money ? "pp = percentage points: 12% → 15% is +3 pp. Red: the share fell; blue: it rose."
          : real ? `${restated(m)}: prices rose ${inflationPct(m)}% (${cpiName}, annual averages).`
            : `Nominal dollars, not adjusted for inflation (prices rose ${inflationPct(m)}%, ${years}).`) + cerb,
    };
  }
  const y = YEARS[view];
  const stats = meta[`y${view}`];
  const b = meta.breaks;
  const fa = fmtAxis(m);
  // zero_class: a sixth or more of DAs are exactly 0, so the first class is 0 alone.
  const items = COLORS.map((color, i) => ({
    color,
    label: i === 0 ? (meta.zero_class ? fa(0) : `Under ${fa(b[1])}`) : i === COLORS.length - 1 ? `${fa(b[i])} and over` : `${fa(b[i])} – ${fa(b[i + 1])}`,
  }));
  items.push({ pattern: "hatch", label: `Suppressed (${stats.suppressed} DAs)` });
  return {
    title: d.dated === "census" ? `${d.long}, ${y.census}` : `${d.long}, ${y.income} (${y.census})`,
    items,
    footer: money ? `City of Toronto ${d.stat}: ${fmtMoney(stats.city)}` : `City of Toronto as a whole: ${fmtPct(stats.city)}`,
    note: meta.zero_class
      ? `DAs at 0% form the first class; the rest of 2016 and 2021 DAs combined are split into fifths, so a colour means the same share in both years.`
      : `Classes split 2016 and 2021 DAs combined into sixths, so a colour means the same ${money ? "dollars" : "share"} in both years.`,
  };
}

function renderLegend() {
  const lg = legendModel();
  $("legend-title").textContent = lg.title;
  const swatch = (it) => `<span class="swatch${it.pattern ? ` ${it.pattern}` : ""}"${it.color ? ` style="background:${it.color}"` : ""}></span>`;
  // Colour classes are buttons: hover or focus previews a class, click keeps it.
  let cls = 0;
  $("legend-items").innerHTML = lg.items
    .map((it) => (it.color
      ? `<li><button type="button" class="lg-cls" data-cls="${cls++}" aria-pressed="false">${swatch(it)}${it.label}</button></li>`
      : `<li>${swatch(it)}${it.label}</li>`))
    .join("");
  $("legend-city").textContent = lg.footer;
  $("legend-note").textContent = lg.note;
}

// ---- legend as a filter -------------------------------------------------------

let focusCls = null; // class kept by a click
let previewCls = null; // class under the pointer or keyboard focus
let focusKey = null; // classes differ between level and change views and bases

// Legend class index (0 = lowest) of each DA in the current view.
function classExpr() {
  const m = select.value;
  return view === "change"
    ? step(changeValue(m), changeStops(m), DIVERGING.map((_, i) => i))
    : step(["get", m], breaks.measures[m].breaks.slice(1, -1), COLORS.map((_, i) => i));
}

function applyFocus() {
  const k = previewCls ?? focusCls;
  const src = sourceOf(view);
  map.setPaintProperty(`${src}-fill`, "fill-opacity", k == null ? 0.85 : ["case", ["==", classExpr(), k], 0.9, 0.12]);
  for (const l of [`${src}-sup`, ...(src === "da" ? ["da-nocmp"] : [])]) map.setPaintProperty(l, "fill-opacity", k == null ? 0.9 : 0.3);
  for (const b of document.querySelectorAll(".lg-cls")) {
    const i = +b.dataset.cls;
    b.setAttribute("aria-pressed", String(i === focusCls));
    b.classList.toggle("dim", k != null && i !== k);
  }
  $("legend-filter").hidden = focusCls == null;
}

const legendItems = $("legend-items");
const clsOf = (e) => e.target.closest(".lg-cls")?.dataset.cls;
for (const ev of ["mouseover", "focusin"]) {
  legendItems.addEventListener(ev, (e) => {
    const c = clsOf(e);
    if (c == null || ev === "focusin" && !e.target.matches(":focus-visible")) return;
    previewCls = +c;
    applyFocus();
  });
}
for (const ev of ["mouseout", "focusout"]) {
  legendItems.addEventListener(ev, (e) => {
    const btn = e.target.closest(".lg-cls");
    // Moving between a button's swatch and its text isn't leaving it.
    if (!btn || e.relatedTarget && btn.contains(e.relatedTarget)) return;
    previewCls = null;
    applyFocus();
  });
}
legendItems.addEventListener("click", (e) => {
  const c = clsOf(e);
  if (c == null) return;
  focusCls = focusCls === +c ? null : +c;
  previewCls = null;
  applyFocus();
});
$("legend-all").addEventListener("click", () => {
  focusCls = previewCls = null;
  applyFocus();
});

// ---- layers -----------------------------------------------------------------

const HIT = { da: ["da-fill", "da-sup", "da-nocmp"], da16: ["da16-fill", "da16-sup"] };
const hitLayers = () => HIT[sourceOf(view)].filter((l) => map.getLayer(l));
let firstSymbol;

function addSourceLayers(id) {
  map.addSource(id, {
    ...tileSource(TILES[id]),
    promoteId: "dauid",
    attribution: '<a href="https://www.statcan.gc.ca/">Statistics Canada</a>',
  });
  const base = { source: id, "source-layer": "da", layout: { visibility: "none" } };
  // Fills and DA outlines go beneath the boundary overlays; highlights above them.
  const under = map.getLayer(OVERLAY_FIRST) ? OVERLAY_FIRST : firstSymbol;
  map.addLayer({ ...base, id: `${id}-fill`, type: "fill", paint: { "fill-opacity": 0.85 } }, under);
  map.addLayer({ ...base, id: `${id}-sup`, type: "fill", paint: { "fill-pattern": "hatch", "fill-opacity": 0.9 } }, under);
  if (id === "da") {
    map.addLayer({ ...base, id: "da-nocmp", type: "fill", filter: ["!=", ["get", "rel"], 1], paint: { "fill-pattern": "dots", "fill-opacity": 0.9 } }, under);
  }
  map.addLayer({
    ...base, id: `${id}-line`, type: "line",
    paint: { "line-color": "#ffffff", "line-opacity": 0.7, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.2, 14, 1] },
  }, under);
  map.addLayer({
    ...base, id: `${id}-hover`, type: "line",
    paint: { "line-color": "#1a1a19", "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2, 0] },
  }, firstSymbol);
  map.addLayer({
    ...base, id: `${id}-pinned`, type: "line",
    paint: { "line-color": "#7a3db8", "line-width": ["case", ["boolean", ["feature-state", "pinned"], false], 3, 0] },
  }, firstSymbol);
  map.addLayer({
    ...base, id: `${id}-selected`, type: "line",
    paint: { "line-color": "#eb6834", "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 3, 0] },
  }, firstSymbol);
  for (const layer of HIT[id]) {
    map.on("mousemove", layer, onHover);
    map.on("mouseleave", layer, onLeave);
    map.on("click", layer, onClick);
  }
}

// ---- boundary overlays ----------------------------------------------------------
// Outlines and labels of City neighbourhoods, wards and FSAs over the DAs, one at
// a time. The control lists only the layers overlays.pmtiles holds (FSAs need a
// StatCan file the pipeline can't always download).

const OVERLAYS = {
  nbhd: { name: "Neighbourhoods", labelMinzoom: 11.5 },
  ward: { name: "Wards", labelMinzoom: 9.5 },
  fsa: { name: "Postal areas (FSA)", labelMinzoom: 10.5 },
};
const OVERLAY_FIRST = `ov-${Object.keys(OVERLAYS)[0]}`;
let overlay = hashParams.get("o") in OVERLAYS ? hashParams.get("o") : "none";

// Added for every kind right after the 2021 DA layers, so the 2016 layers (added
// later) can be slotted beneath them; a kind missing from the tiles draws nothing.
function addOverlayLayers() {
  if (!OVERLAY_TILES) return;
  map.addSource("ov", tileSource(OVERLAY_TILES));
  const font = map.getStyle().layers.find((l) => l.type === "symbol" && l.layout?.["text-font"])?.layout["text-font"]
    ?? ["Noto Sans Regular"];
  for (const [k, o] of Object.entries(OVERLAYS)) {
    map.addLayer({
      id: `ov-${k}`, type: "line", source: "ov", "source-layer": k, layout: { visibility: "none", "line-join": "round" },
      paint: { "line-color": "#1a1a19", "line-opacity": 0.8, "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.8, 14, 2.2] },
    }, "da-hover");
    map.addLayer({
      id: `ov-${k}-label`, type: "symbol", source: "ov", "source-layer": `${k}_label`, minzoom: o.labelMinzoom,
      layout: {
        visibility: "none", "text-field": ["get", "label"], "text-font": font, "text-max-width": 8,
        "text-size": ["interpolate", ["linear"], ["zoom"], 10, 11, 14, 14], "symbol-sort-key": ["-", 0, ["get", "area_km2"]],
      },
      paint: { "text-color": "#1a1a19", "text-halo-color": "rgba(255, 255, 255, 0.9)", "text-halo-width": 1.5 },
    });
  }
  const kinds = Object.keys(OVERLAYS).filter((k) => OVERLAY_TILES.layers.includes(k));
  if (!kinds.length) return;
  if (!kinds.includes(overlay)) overlay = "none";
  const radio = (v, label) => `<label><input type="radio" name="overlay" value="${v}"${v === overlay ? " checked" : ""} /> ${label}</label>`;
  $("overlay-opts").innerHTML = [radio("none", "None"), ...kinds.map((k) => radio(k, OVERLAYS[k].name))].join("");
  $("overlays").hidden = false;
  applyOverlay();
}

function applyOverlay() {
  for (const k of Object.keys(OVERLAYS)) {
    for (const l of [`ov-${k}`, `ov-${k}-label`]) map.setLayoutProperty(l, "visibility", k === overlay ? "visible" : "none");
  }
  writeHash();
}

$("overlay-opts").addEventListener("change", (e) => {
  overlay = e.target.value;
  applyOverlay();
});

// The 2016 tiles (~1.8 MB) load only when someone first switches to 2016.
function ensureSource(id) {
  if (!map.getSource(id)) addSourceLayers(id);
}

function applyView() {
  syncChangeBy();
  const m = select.value;
  const src = sourceOf(view);
  ensureSource(src);
  for (const id of ["da", "da16"]) {
    if (!map.getSource(id)) continue;
    const vis = id === src ? "visible" : "none";
    for (const l of ["fill", "sup", "line", "hover", "pinned", "selected", ...(id === "da" ? ["nocmp"] : [])]) {
      map.setLayoutProperty(`${id}-${l}`, "visibility", l === "nocmp" && view !== "change" ? "none" : vis);
    }
  }
  if (view === "change") {
    map.setPaintProperty("da-fill", "fill-color", changeColor(m));
    map.setFilter("da-fill", comparable(m));
    map.setFilter("da-sup", notPublished(m));
  } else {
    map.setPaintProperty(`${src}-fill`, "fill-color", levelColor(m));
    // A suppressed value is absent from the tiles.
    map.setFilter(`${src}-fill`, ["has", m]);
    map.setFilter(`${src}-sup`, ["!", ["has", m]]);
  }
  changeBy.hidden = view !== "change";
  renderLegend();
  // A kept class survives a change of measure or census, not a change of classes
  // (level <-> change view, value <-> percentile points).
  const key = view === "change" ? `change-${byPoints() ? "points" : "value"}` : "level";
  if (key !== focusKey) focusCls = previewCls = null;
  focusKey = key;
  applyFocus();
  tooltip.hidden = true;
  writeHash();
}

let mapMoved = false; // keep the default whole-city framing out of links until the map moves
function writeHash() {
  const h = new URLSearchParams({ m: select.value, y: view });
  if (view === "change") h.set("c", changeBy.value);
  if (current) h.set("da", current.props.dauid);
  if (pinned) h.set("vs", pinned.props.dauid);
  if (overlay !== "none") h.set("o", overlay);
  if (mapMoved || camera.center) {
    const { lng, lat } = map.getCenter();
    h.set("at", `${map.getZoom().toFixed(2)}/${lat.toFixed(5)}/${lng.toFixed(5)}`);
  }
  history.replaceState(null, "", `#${h.toString().replaceAll("%2F", "/")}`);
}

async function setView(next) {
  const fromSrc = sourceOf(view);
  view = next;
  applyView();
  const toSrc = sourceOf(view);
  if (fromSrc === toSrc) {
    if (current) showDetails(current.props, current.lngLat, current.note);
    return;
  }
  // Different boundary set: outlines and search messages refer to the old one.
  const carry = current;
  clearSelection();
  closeDetails();
  carryPin(toSrc);
  setStatus("");
  if (!carry) return;
  // Carry the selected DA across only when its boundary is the same in both years.
  const { props, lngLat, note } = carry;
  if (props.rel !== 1) {
    setStatus(`DA ${props.dauid}'s boundary changed between 2016 and 2021, so it has no direct counterpart. Click a DA to see its figures.`);
    return;
  }
  await idle();
  if (view !== next) return; // toggled again while waiting
  const [f] = map.querySourceFeatures(toSrc, { sourceLayer: "da", filter: ["==", ["get", "dauid"], props.dauid] });
  if (!f) return;
  select_(toSrc, [props.dauid]);
  showDetails(f.properties, lngLat, note);
}

// ---- hover + details --------------------------------------------------------

const tooltip = document.createElement("div");
tooltip.className = "tooltip";
tooltip.hidden = true;
document.body.append(tooltip);

let hover = null; // { source, id }
let current = null; // { props, lngLat, note, source } of the shown DA
// Not closeOnClick: its map click handler runs after the layer's and would
// close the popup that a click on another DA has just filled.
const popup = new maplibregl.Popup({ maxWidth: "380px", focusAfterOpen: false, closeOnClick: false });
popup.on("close", () => {
  if (narrow.matches) return;
  current = null;
  writeHash();
});

function setHover(source, id) {
  if (hover?.source === source && hover?.id === id) return;
  if (hover) map.setFeatureState({ source: hover.source, sourceLayer: "da", id: hover.id }, { hover: false });
  hover = id == null ? null : { source, id };
  if (hover) map.setFeatureState({ source, sourceLayer: "da", id }, { hover: true });
}

function tooltipText(p) {
  const m = select.value;
  let v;
  if (view === "change") {
    if (p.rel !== 1) v = "Boundary changed";
    else if (p[m] == null || p[`v16_${m}`] == null) v = "Not published";
    else v = `${fmtDiff(m, valueChange(p, m))}${isMoney(m) && realDollars() ? ` (${refYear(m, "2021")} $)` : ""} · ${fmtPts(p[`pct_${m}`] - p[`p16_${m}`])}`;
  } else {
    v = p[m] == null ? "Suppressed" : fmtVal(m, p[m]);
  }
  return `${v} · DA ${p.dauid}, in ${p.nbhd}`;
}

function onHover(e) {
  const f = e.features[0];
  setHover(f.source, f.id);
  map.getCanvas().style.cursor = "pointer";
  tooltip.textContent = tooltipText(f.properties);
  tooltip.style.transform = `translate(${e.originalEvent.clientX + 14}px, ${e.originalEvent.clientY + 14}px)`;
  tooltip.hidden = narrow.matches;
}

function onLeave() {
  setHover(null, null);
  map.getCanvas().style.cursor = "";
  tooltip.hidden = true;
}

function onClick(e) {
  const f = e.features[0];
  tooltip.hidden = true;
  clearSelection();
  // Keep the clicked DA outlined, so its borders show in snapshots too.
  select_(f.source, [f.id]);
  showDetails(f.properties, e.lngLat);
}

// DAs have no names; show the City of Toronto neighbourhood that covers most of it.
function placeLine(p) {
  return p.nbhd2 ? `Mostly ${p.nbhd}, partly ${p.nbhd2}` : `${p.nbhd} (City neighbourhood ${p.nbhd_id})`;
}

/**
 * The figures for one DA in the current view, as plain data: used for the
 * popup / bottom sheet and the snapshot side panel.
 */
function detailsModel(p, note) {
  const m = select.value;
  const meta = breaks.measures[m];
  const d = MEASURES[m], money = isMoney(m);
  const group = Object.entries(MEASURES).filter(([, x]) => x.group === d.group);
  const fine = ["Percentile = share of Toronto DAs with an equal or lower value, within each census.",
    "DAs have no official names; the neighbourhood shown is the City of Toronto neighbourhood covering most of the DA."];
  const lines = [];
  let columns, rows;
  if (view === "change") {
    columns = [refYear(m, "2016"), refYear(m, "2021"), money && realDollars() ? "Real chg" : "Change", "Pctl pts"];
    rows = group.map(([k, x]) => {
      const dc = valueChange(p, k);
      return {
        label: x.short, selected: k === m,
        cells: [fmtVal(k, p[`v16_${k}`]), fmtVal(k, p[k]),
          fmtDiff(k, dc), dc == null ? "—" : fmtPts(p[`pct_${k}`] - p[`p16_${k}`])],
      };
    });
    if (p.rel !== 1) {
      lines.push({ note: true, text: "This DA's boundary changed between 2016 and 2021, so no change is reported. Switch to 2016 to see the 2016 areas here." });
    } else if (p[m] != null && p[`v16_${m}`] != null) {
      lines.push({ text: `Percentile rank for ${lc(d.short)}: ${ordinal(p[`p16_${m}`])} in 2016 → ${ordinal(p[`pct_${m}`])} in 2021.` });
    } else {
      lines.push({ note: true, text: "This measure was not published for this DA in 2016 or 2021 (small population or data-quality rules), so no change is reported." });
    }
    lines.push({
      note: true,
      text: !money
        ? `Change in percentage points (pp): 12% → 15% is +3 pp.${d.cerb ? " 2020 incomes include one-off pandemic benefits (CERB), which raised transfer income and lowered low-income rates that year." : ""}`
        : realDollars()
          ? `"Real chg" is the change after inflation: ${refYear(m, "2016")} ${GROUPS[d.group].noun} × ${cpiOf(m)} (prices rose ${inflationPct(m)}%, ${cpiName}).${cerbNote(m)}`
          : `Nominal dollars, not adjusted for inflation (prices rose ${inflationPct(m)}%, ${refYear(m, "2016")} → ${refYear(m, "2021")}).${cerbNote(m)}`,
    });
    lines.push({ text: `Population 2021: ${fmtCount(p.pop21)} · Households: ${fmtCount(p.hh)}` });
  } else {
    const y = YEARS[view];
    columns = [GROUPS[d.group].col, "Percentile"];
    rows = group.map(([k, x]) => ({
      label: x.short, selected: k === m,
      cells: [fmtVal(k, p[k]), p[`pct_${k}`] == null ? "—" : ordinal(p[`pct_${k}`])],
    }));
    const v = p[m];
    const cm = meta[`y${view}`].city;
    const cityWord = money ? `city ${d.stat}` : `city-wide ${d.stat}`;
    if (v != null) lines.push({ text: `${v >= cm ? "Above" : "Below"} the ${refYear(m, view)} ${cityWord} of ${fmtVal(m, cm)} for this measure.` });
    if (p[m] == null) lines.push({ note: true, text: "This measure is suppressed for this DA by Statistics Canada (small population or data-quality rules). It is shown hatched, not as zero." });
    if (view === "2021" && p.rel === 1 && v != null && p[`v16_${m}`] != null) {
      const v16 = p[`v16_${m}`];
      const pctl = `${fmtPts(p[`pct_${m}`] - p[`p16_${m}`])} in percentile rank`;
      lines.push({
        text: money
          ? `Since 2016: ${fmtSignedMoney(v - v16)} (from ${fmtMoney(v16)}), ${fmtSignedMoney(Math.round(v - v16 * cpiOf(m)))} after inflation, ${pctl}.`
          : `Since 2016: ${fmtPP(Math.round((v - v16) * 10) / 10)} (from ${fmtPct(v16)}), ${pctl}.${d.cerb ? " 2020 includes one-off pandemic benefits (CERB)." : ""}`,
      });
    }
    if (p.rel !== 1) lines.push({ note: true, text: `This DA's boundary changed between 2016 and 2021, so ${view === "2016" ? "2021" : "2016"} figures can't be compared directly.` });
    lines.push({ text: `Population ${view}: ${fmtCount(p[y.pop])} · Households: ${fmtCount(p.hh)}` });
  }
  return {
    note,
    compare: compareModel(p),
    pinnedHere: pinned?.props.dauid === p.dauid,
    dist: distModel(p),
    heading: `DA ${p.dauid}${view === "2016" ? " (2016 boundary)" : ""}`,
    sub: placeLine(p),
    columns,
    rows,
    lines,
    fine,
  };
}

/**
 * Where the DA sits among all Toronto DAs for the current measure and view:
 * a histogram from breaks.json, with a reference line at the city median (or
 * at zero for change).
 */
function distModel(p) {
  const m = select.value;
  const meta = breaks.measures[m];
  const d = MEASURES[m], money = isMoney(m);
  if (view === "change") {
    const pts = byPoints();
    const value = pts ? (valueChange(p, m) == null ? null : p[`pct_${m}`] - p[`p16_${m}`]) : valueChange(p, m);
    if (value == null) return null;
    const unit = pts ? " (percentile points)" : !money ? " (percentage points)" : realDollars() ? ` (${dollarsOf(m)})` : "";
    return {
      hist: meta.hist.change[changeBy.value],
      value,
      ref: 0,
      fmt: pts ? fmtPts : fmtDiffShort(m),
      caption: `Change across the ${fmtCount(meta.change.comparable)} comparable Toronto DAs${unit}. This DA in orange; the line marks no change.`,
    };
  }
  if (p[m] == null) return null;
  const stats = meta[`y${view}`];
  const city = money ? `city ${d.stat}` : "city as a whole";
  return {
    hist: meta.hist[view],
    value: p[m],
    ref: stats.city,
    fmt: fmtAxis(m),
    zero: money ? "$0" : "0%",
    max: money ? Infinity : 100,
    caption: `${d.long} across ${fmtCount(stats.n)} Toronto DAs, ${refYear(m, view)}. This DA in orange; the line marks the ${city} (${fmtVal(m, stats.city)}).`,
  };
}

function distHTML(d) {
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

// ---- compare with a pinned DA -------------------------------------------------

let pinned = null; // { props, source }

function compareModel(p) {
  if (!pinned || pinned.props.dauid === p.dauid) return null;
  const q = pinned.props;
  const m = select.value, money = isMoney(m);
  const change = view === "change", pts = change && byPoints();
  const val = (x, k) => {
    if (!change) return x[k];
    const dc = valueChange(x, k);
    return pts && dc != null ? x[`pct_${k}`] - x[`p16_${k}`] : dc;
  };
  const fmt = (k, v) => (!change ? fmtVal(k, v) : pts ? fmtPts(v) : fmtDiff(k, v));
  // differences of rates in percentage points; round away float noise
  const diff = (k, v) => (pts ? fmtPts(v) : fmtDiff(k, isMoney(k) ? v : Math.round(v * 10) / 10));
  const group = Object.entries(MEASURES).filter(([, x]) => x.group === MEASURES[m].group);
  const years = `${refYear(m, "2016")} → ${refYear(m, "2021")}`;
  return {
    title: `Compared with pinned DA ${q.dauid}, ${q.nbhd}`,
    columns: ["Pinned", "This DA", "Difference"],
    rows: group.map(([k, d]) => {
      const a = val(q, k), b = val(p, k);
      return { label: d.short, selected: k === m, cells: [fmt(k, a), fmt(k, b), a == null || b == null ? "—" : diff(k, b - a)] };
    }),
    note: !change ? `${GROUPS[MEASURES[m].group].noun.replace(/^./, (c) => c.toUpperCase())}, ${refYear(m, view)}.`
      : `Change ${years}, ${pts ? "in percentile points" : !money ? "in percentage points" : realDollars() ? `in ${dollarsOf(m)}` : "in nominal dollars"}.`,
  };
}

function setPin(next) {
  if (pinned) map.setFeatureState({ source: pinned.source, sourceLayer: "da", id: pinned.props.dauid }, { pinned: false });
  pinned = next;
  if (pinned) map.setFeatureState({ source: pinned.source, sourceLayer: "da", id: pinned.props.dauid }, { pinned: true });
  const chip = $("pinchip");
  chip.hidden = !pinned;
  chip.innerHTML = pinned
    ? `<span>Comparing with <strong>DA ${escapeHTML(pinned.props.dauid)}</strong>, ${escapeHTML(pinned.props.nbhd)}. ${narrow.matches ? "Tap" : "Click"} another DA.</span> <button type="button" class="unpin">Unpin</button>`
    : "";
  if (current) showDetails(current.props, current.lngLat, current.note);
  else writeHash();
}

// The pinned DA follows a switch between 2016 and 2021 boundaries only when its
// boundary is the same in both.
async function carryPin(toSrc) {
  if (!pinned || pinned.source === toSrc) return;
  const { props } = pinned;
  setPin(null);
  if (props.rel !== 1) {
    showToast(`Unpinned DA ${props.dauid}: its boundary changed between 2016 and 2021.`, 5000);
    return;
  }
  await idle();
  const [f] = map.querySourceFeatures(toSrc, { sourceLayer: "da", filter: ["==", ["get", "dauid"], props.dauid] });
  if (sourceOf(view) !== toSrc) return; // toggled back while waiting
  if (f) setPin({ props: f.properties, source: toSrc });
  else showToast(`Unpinned DA ${props.dauid}: it isn't loaded at this zoom. Zoom in and pin it again.`, 5000);
}

document.addEventListener("click", (e) => {
  if (e.target.closest(".unpin")) return setPin(null);
  if (!e.target.closest(".pinbtn") || !current) return;
  setPin(pinned?.props.dauid === current.props.dauid ? null : { props: current.props, source: sourceOf(view) });
  // On phones the sheet covers most of the map; get it out of the way so the
  // second DA can be tapped. The pin chip says what to do next.
  if (pinned && narrow.matches) closeDetails();
});

function compareHTML(c) {
  const head = `<tr><th></th>${c.columns.map((x) => `<th>${x}</th>`).join("")}</tr>`;
  const body = c.rows.map((r) => `<tr class="${r.selected ? "sel" : ""}"><th scope="row">${r.label}</th>${r.cells.map((x) => `<td>${x}</td>`).join("")}</tr>`).join("");
  return `<section class="compare" aria-label="Comparison with the pinned DA">
      <h3>${escapeHTML(c.title)}</h3>
      <table class="dt wide"><thead>${head}</thead><tbody>${body}</tbody></table>
      <p class="fine">${escapeHTML(c.note)} Difference = this DA minus the pinned one.</p>
    </section>`;
}

function detailsHTML(d) {
  const head = `<tr><th></th>${d.columns.map((c) => `<th>${c}</th>`).join("")}</tr>`;
  const body = d.rows.map((r) => `<tr class="${r.selected ? "sel" : ""}"><th scope="row">${r.label}</th>${r.cells.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
  return `${d.note ? `<p class="found">${escapeHTML(d.note)}</p>` : ""}
    <h2>${escapeHTML(d.heading)}</h2>
    <p class="place">${escapeHTML(d.sub)}</p>
    <table class="dt${d.columns.length > 2 ? " wide" : ""}"><thead>${head}</thead><tbody>${body}</tbody></table>
    ${d.compare ? compareHTML(d.compare) : ""}
    ${d.dist ? distHTML(d.dist) : ""}
    ${d.lines.map((l) => `<p class="${l.note ? "note" : "cmp"}">${escapeHTML(l.text)}</p>`).join("")}
    <p class="fine">${d.fine.map(escapeHTML).join(" ")}</p>
    <div class="detail-actions">
      <button type="button" class="copylink">Copy link to this DA</button>
      <button type="button" class="pinbtn">${d.pinnedHere ? "Unpin" : d.compare ? "Pin this DA instead" : "Pin to compare"}</button>
    </div>`;
}

function showDetails(props, lngLat, note) {
  const html = detailsHTML(detailsModel(props, note));
  if (narrow.matches) {
    popup.remove();
    $("sheet-body").innerHTML = html;
    $("sheet").hidden = false;
  } else {
    $("sheet").hidden = true;
    popup.setLngLat(lngLat).setHTML(html);
    // addTo() on an open popup closes it first, and the close handler would
    // clear `current`; so only add it when it isn't already showing.
    if (!popup.isOpen()) popup.addTo(map);
  }
  current = { props, lngLat, note };
  writeHash();
}

function closeDetails() {
  popup.remove();
  $("sheet").hidden = true;
  current = null;
  writeHash();
}

// Popup and bottom sheet both carry a "Copy link" button; the hash already
// names the view, the open DA and the map position.
document.addEventListener("click", async (e) => {
  if (!e.target.closest(".copylink")) return;
  try {
    await navigator.clipboard.writeText(location.href);
    showToast("Link copied. It opens this view with this DA selected.", 3000);
  } catch {
    showToast("Couldn't copy; copy the address bar instead.", 4000);
  }
});

// A shared link's DA: outline it and open its details once its tile has loaded.
async function openLinkedDA(dauid) {
  const source = sourceOf(view);
  await idle();
  const parts = map.querySourceFeatures(source, { sourceLayer: "da", filter: ["==", ["get", "dauid"], dauid] });
  if (parts.length) {
    // A DA can be split across tiles; centre the popup on all of its pieces.
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    const walk = (c) => {
      if (typeof c[0] !== "number") return c.forEach(walk);
      b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]);
    };
    for (const f of parts) walk(f.geometry.coordinates);
    select_(source, [dauid]);
    showDetails(parts[0].properties, { lng: (b[0] + b[2]) / 2, lat: (b[1] + b[3]) / 2 });
    return;
  }
  // Not in view (or dropped at this zoom): find it like a DA-number search.
  try {
    await loadIndex();
  } catch {
    return;
  }
  const res = index.resolve(dauid);
  if (res.status === "match") goTo(res.results[0], "da");
  else setStatus(`The linked DA ${dauid} isn't a City of Toronto dissemination area.`, "error");
}

// A shared link's pinned DA (vs=): pin it once its tile has loaded.
async function pinLinkedDA(dauid) {
  const source = sourceOf(view);
  await idle();
  const [f] = map.querySourceFeatures(source, { sourceLayer: "da", filter: ["==", ["get", "dauid"], dauid] });
  if (f) setPin({ props: f.properties, source });
  else showToast(`The link's pinned DA ${dauid} isn't loaded in this part of the map or at this zoom, so nothing is pinned.`, 5000);
}

$("sheet-close").addEventListener("click", closeDetails);

// ---- keyboard and screen readers -----------------------------------------------
// MapLibre already pans with the arrow keys and zooms with + and −. While the map
// has keyboard focus a crosshair marks its centre (CSS); the DA under it is
// announced after each move, Enter or Space opens it and Escape closes it.

const canvas = map.getCanvas();
canvas.setAttribute("aria-label",
  "Map of median income by dissemination area. Arrow keys pan, plus and minus zoom, Enter opens the area at the centre, Escape closes it.");
const live = $("map-live");

function centreDA() {
  if (!map.getSource("da")) return null;
  const [f] = map.queryRenderedFeatures([canvas.clientWidth / 2, canvas.clientHeight / 2], { layers: hitLayers() });
  return f ?? null;
}

const announce = (text) => (live.textContent = text);
const centreText = () => {
  const f = centreDA();
  return f ? tooltipText(f.properties) : "No dissemination area at the map centre.";
};

map.on("moveend", () => {
  if (document.activeElement === canvas) announce(centreText());
});
canvas.addEventListener("focus", () => {
  if (canvas.matches(":focus-visible")) announce(centreText());
});
// Chrome keeps :focus-visible on a canvas clicked while focused; the crosshair
// is for keyboard use, so pointer use hides it until the next key.
const wrap = document.querySelector(".map-wrap");
canvas.addEventListener("pointerdown", () => wrap.classList.add("pointing"));
canvas.addEventListener("keydown", (e) => {
  wrap.classList.remove("pointing");
  if (e.key === "Escape" && current) {
    closeDetails();
    announce("Closed the area's details.");
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    const f = centreDA();
    if (!f) return announce("No dissemination area at the map centre.");
    clearSelection();
    select_(f.source, [f.id]);
    showDetails(f.properties, map.getCenter());
    announce(`Opened ${tooltipText(f.properties)}.`);
  }
});

// ---- load -------------------------------------------------------------------

map.on("load", () => {
  map.addImage("hatch", pattern("hatch"), { pixelRatio: 2 });
  map.addImage("dots", pattern("dots"), { pixelRatio: 2 });
  // Draw data beneath the basemap's labels.
  firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
  addSourceLayers("da");
  addOverlayLayers();
  applyView();
  select.addEventListener("change", () => {
    applyView();
    if (current) showDetails(current.props, current.lngLat, current.note);
  });
  changeBy.addEventListener("change", () => {
    applyView();
    if (current) showDetails(current.props, current.lngLat, current.note);
  });
  for (const r of document.querySelectorAll("input[name=year]")) {
    r.addEventListener("change", () => r.checked && setView(r.value));
  }
  // A click off every DA closes the popup (the bottom sheet has its own ×).
  map.on("click", (e) => {
    if (!map.queryRenderedFeatures(e.point, { layers: hitLayers() }).length) popup.remove();
  });
  map.on("moveend", () => {
    mapMoved = true;
    writeHash();
  });
  if (linkedPin) pinLinkedDA(linkedPin);
  if (linkedDA) openLinkedDA(linkedDA);
});

// ---- search -----------------------------------------------------------------
// The address index (~4.7 MB, ~1.1 MB compressed) loads on first use only.

const form = $("search");
const input = $("q");
const suggestBox = $("suggest");
const statusBox = $("search-status");
const HELP = `Type a street address (100 Queen St W), an intersection (Yonge & Bloor) or a DA number.
  Only official City of Toronto addresses are listed.`;
let index = null;
let indexPromise = null;
let selected = []; // [{ source, id }] outlined in orange
let marker = null;
let typing; // typeahead debounce timer

function loadIndex() {
  indexPromise ??= (async () => {
    setStatus("Loading the City of Toronto address list…");
    const [{ SearchIndex }, doc] = await Promise.all([
      import("./search.js"),
      fetch(`/search.json?v=${__SEARCH_VERSION__}`).then((r) => {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      }),
    ]);
    index = new SearchIndex(doc);
    setStatus(!input.value && document.activeElement === input ? HELP : "");
    return index;
  })().catch((err) => {
    indexPromise = null;
    setStatus("Couldn't load the address list. Check your connection and try again.", "error");
    throw err;
  });
  return indexPromise;
}

function setStatus(msg, kind = "info", extra = "") {
  statusBox.hidden = !msg;
  statusBox.className = `search-status ${kind}`;
  statusBox.innerHTML = msg ? `<p>${escapeHTML(msg)}</p>${extra}` : "";
}

function clearSelection() {
  for (const { source, id } of selected) map.setFeatureState({ source, sourceLayer: "da", id }, { selected: false });
  selected = [];
  marker?.remove();
  marker = null;
}

// Outline DAs (by DAUID) on one source.
function select_(source, ids) {
  for (const id of ids) {
    map.setFeatureState({ source, sourceLayer: "da", id }, { selected: true });
    selected.push({ source, id });
  }
}

const idle = () => new Promise((resolve) => (map.loaded() && !map.isMoving() ? resolve() : map.once("idle", resolve)));

async function goTo(hit, kind) {
  if (!map.getSource("da")) await new Promise((resolve) => map.once("load", resolve));
  clearSelection();
  closeDetails();
  // In the 2016 view, translate 2021 DAs to 2016 DAs through the official
  // correspondence; a redrawn boundary is never resolved to a single DA.
  let das = hit.das.map((i) => index.da(i));
  let redrawn = false;
  if (hit.da16) {
    if (view !== "2016") {
      setStatus(`DA ${hit.da16.dauid} existed only in the 2016 Census (its boundary was redrawn). Switch to 2016 to see it.`);
      return;
    }
    das = [hit.da16];
  } else if (view === "2016") ({ das, redrawn } = index.in2016(hit.das));
  const source = sourceOf(view);
  select_(source, das.map((d) => d.dauid));
  if (hit.point) {
    const el = document.createElement("div");
    el.className = "pin";
    marker = new maplibregl.Marker({ element: el }).setLngLat(hit.point).addTo(map);
  }
  const b = das.reduce((a, d) => [Math.min(a[0], d.bbox[0]), Math.min(a[1], d.bbox[1]), Math.max(a[2], d.bbox[2]), Math.max(a[3], d.bbox[3])],
    [Infinity, Infinity, -Infinity, -Infinity]);
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: narrow.matches ? 40 : 80, maxZoom: 15, duration: 900 });
  await idle();

  const label = hit.detail ? `${hit.label}, ${hit.detail}` : hit.label;
  if (das.length > 1) {
    const where = redrawn ? "covered this location in 2016 (boundaries were redrawn by 2021)"
      : kind === "intersection" ? "meet at this intersection" : "share this address";
    setStatus(`${label}: ${das.length} dissemination areas ${where} (outlined in orange). Click or tap one to see its figures.`);
    return;
  }
  const [f] = map.querySourceFeatures(source, { sourceLayer: "da", filter: ["==", ["get", "dauid"], das[0].dauid] });
  if (!f) {
    setStatus(`Found ${label} in DA ${das[0].dauid}, but its map data didn't load. Try zooming in.`, "error");
    return;
  }
  setStatus("");
  const [lng, lat] = hit.point ?? das[0].point;
  showDetails(f.properties, { lng, lat }, kind === "da" ? null : `Search result: ${label}`);
}

function renderChoices(res) {
  const what = res.kind === "intersection" ? "intersections match" : "places have that address";
  const items = res.results.map((h, i) =>
    `<li><button type="button" data-i="${i}">${escapeHTML(h.label)}${h.detail ? ` <span>${escapeHTML(h.detail)}</span>` : ""}</button></li>`);
  const more = res.more ? `<p class="hint">${res.more} more not shown; add a street type or direction to narrow it down.</p>` : "";
  setStatus(`${res.results.length} ${what}. Pick one:`, "info", `<ul class="choices">${items.join("")}</ul>${more}`);
  statusBox.querySelectorAll("button[data-i]").forEach((btn) =>
    btn.addEventListener("click", () => goTo(res.results[+btn.dataset.i], res.kind)));
}

async function runSearch(text) {
  clearTimeout(typing); // a pending typeahead must not reopen over the results
  hideSuggest();
  try {
    await loadIndex();
  } catch {
    return;
  }
  const res = index.resolve(text);
  if (res.status === "error") {
    setStatus(res.message, "error", res.hint ? `<p class="hint">${escapeHTML(res.hint)}</p>` : "");
  } else if (res.status === "choose") {
    renderChoices(res);
  } else {
    goTo(res.results[0], res.kind);
  }
}

let active = -1;
function hideSuggest() {
  suggestBox.hidden = true;
  suggestBox.innerHTML = "";
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
  active = -1;
}

function showSuggest() {
  if (!index) return;
  const list = index.suggest(input.value);
  if (!list.length) return hideSuggest();
  suggestBox.innerHTML = list.map((s, i) =>
    `<li role="option" id="sg-${i}" data-text="${escapeHTML(s.text)}">${escapeHTML(s.label)} <span>${escapeHTML(s.detail ?? "")}</span></li>`).join("");
  suggestBox.hidden = false;
  input.setAttribute("aria-expanded", "true");
  active = -1;
}

function pick(li) {
  input.value = li.dataset.text;
  runSearch(input.value);
}

input.addEventListener("focus", () => {
  loadIndex().catch(() => {});
  if (!input.value && index) setStatus(HELP);
});
input.addEventListener("input", () => {
  clearTimeout(typing);
  typing = setTimeout(showSuggest, 120);
  if (!input.value) setStatus(index ? HELP : "");
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    hideSuggest();
    setStatus("");
    return;
  }
  const items = [...suggestBox.children];
  if (!items.length || !["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) return;
  if (e.key === "Enter") {
    if (active >= 0) {
      e.preventDefault();
      pick(items[active]);
    }
    return;
  }
  e.preventDefault();
  active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items.forEach((li, i) => li.classList.toggle("active", i === active));
  input.setAttribute("aria-activedescendant", items[active].id);
});
suggestBox.addEventListener("mousedown", (e) => {
  const li = e.target.closest("li");
  if (li) {
    e.preventDefault();
    pick(li);
  }
});
input.addEventListener("blur", () => setTimeout(() => {
  hideSuggest();
  // The help sits over the measure menu; it's only useful while typing.
  if (!input.value && statusBox.textContent.startsWith("Type a street")) setStatus("");
}, 150));
// MapLibre cancels touches on the map, so a tap there never blurs the search box
// (and its panel stays over the controls); do it here, and dismiss the panel.
canvas.addEventListener("pointerdown", () => {
  if (document.activeElement === input) input.blur();
  if (!statusBox.hidden) setStatus("");
});
form.addEventListener("submit", (e) => {
  e.preventDefault();
  runSearch(input.value);
});


// ---- snapshot ---------------------------------------------------------------
// Camera button -> drag a rectangle over the map (or take the whole view) ->
// preview with options -> copy to clipboard or download a PNG.

const CREDITS = [
  "Statistics Canada, Census Profile, 2021 Census (98-316-X2021001) and 2016 Census (98-316-X2016001); income years 2020 and 2015; 2021 DA correspondence file (92-156-X). Contains information licensed under the Open Government Licence – Canada.",
  "Neighbourhoods, wards, address points and intersections: City of Toronto Open Data, Open Government Licence – Toronto. Basemap © OpenFreeMap © OpenMapTiles, data © OpenStreetMap contributors.",
];

function snapshotDetails() {
  return current ? detailsModel(current.props, current.note) : null;
}

function snapshotLabel() {
  if (!current) return null;
  const p = current.props;
  const what = view === "change" ? `${MEASURES[select.value].short}, change` : `${MEASURES[select.value].short}, ${refYear(select.value, view)}`;
  return {
    lngLat: current.lngLat,
    title: `DA ${p.dauid}`,
    lines: [p.nbhd2 ? `Mostly ${p.nbhd}` : p.nbhd, `${what}: ${tooltipText(p).split(" · ")[0]}`],
  };
}

const toast = document.createElement("div");
toast.className = "toast";
toast.setAttribute("role", "status");
toast.hidden = true;
document.body.append(toast);
let toastTimer;
function showToast(text, ms = 5000) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), ms);
}

// -- snip overlay

const mapWrap = document.querySelector(".map-wrap");
const snipLayer = document.createElement("div");
snipLayer.className = "snip";
snipLayer.hidden = true;
snipLayer.innerHTML = `
  <div class="snip-bar" role="toolbar" aria-label="Snapshot">
    <span>Drag to select an area</span>
    <button type="button" data-act="full">Whole view</button>
    <button type="button" data-act="cancel">Cancel</button>
  </div>
  <div class="snip-box" hidden><span class="snip-size"></span></div>`;
mapWrap.append(snipLayer);
const snipBox = snipLayer.querySelector(".snip-box");
const snipSize = snipLayer.querySelector(".snip-size");
const MIN_SNIP = 80;

function startSnip() {
  snipLayer.hidden = false;
  snipBox.hidden = true;
  mapWrap.classList.add("snipping");
  tooltip.hidden = true;
  hideSuggest();
  setStatus(""); // search messages sit over the snip toolbar
  snipLayer.querySelector("[data-act=full]").focus();
}

function endSnip() {
  snipLayer.hidden = true;
  mapWrap.classList.remove("snipping");
}

let drag = null;
snipLayer.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".snip-bar")) return;
  const b = snipLayer.getBoundingClientRect();
  drag = { x0: e.clientX - b.left, y0: e.clientY - b.top, b };
  snipLayer.setPointerCapture(e.pointerId);
  e.preventDefault();
});
snipLayer.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const x1 = Math.min(Math.max(e.clientX - drag.b.left, 0), drag.b.width);
  const y1 = Math.min(Math.max(e.clientY - drag.b.top, 0), drag.b.height);
  drag.r = { x: Math.min(drag.x0, x1), y: Math.min(drag.y0, y1), w: Math.abs(x1 - drag.x0), h: Math.abs(y1 - drag.y0) };
  Object.assign(snipBox.style, { left: `${drag.r.x}px`, top: `${drag.r.y}px`, width: `${drag.r.w}px`, height: `${drag.r.h}px` });
  snipBox.hidden = false;
  snipSize.textContent = `${Math.round(drag.r.w)} × ${Math.round(drag.r.h)}`;
});
snipLayer.addEventListener("pointerup", () => {
  const r = drag?.r;
  drag = null;
  if (!r) return;
  if (r.w < MIN_SNIP || r.h < MIN_SNIP) {
    snipBox.hidden = true;
    showToast(`Drag a larger area (at least ${MIN_SNIP} × ${MIN_SNIP} px).`, 3000);
    return;
  }
  endSnip();
  openPreview(r);
});
snipLayer.querySelector(".snip-bar").addEventListener("click", (e) => {
  const act = e.target.closest("button")?.dataset.act;
  if (act === "cancel") endSnip();
  if (act === "full") {
    endSnip();
    const c = map.getCanvas();
    openPreview({ x: 0, y: 0, w: c.clientWidth, h: c.clientHeight });
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !snipLayer.hidden) endSnip();
});

// -- preview dialog

const dlg = document.createElement("dialog");
dlg.className = "snap-dialog";
dlg.innerHTML = `
  <form method="dialog" class="snap-form">
    <div class="snap-head"><h2>Snapshot</h2><button value="close" aria-label="Close" class="snap-x">×</button></div>
    <div class="snap-preview"><img alt="Snapshot preview" /></div>
    <fieldset class="snap-opts">
      <legend class="visually-hidden">Include</legend>
      <label><input type="checkbox" name="title" checked /> Title</label>
      <label><input type="checkbox" name="legend" checked /> Legend</label>
      <label><input type="checkbox" name="details" checked /> DA figures</label>
      <label><input type="checkbox" name="label" checked /> Label selected DA</label>
      <label>Resolution <select name="scale"><option value="1">Screen</option><option value="2" selected>2× sharper</option></select></label>
    </fieldset>
    <p class="snap-info" aria-live="polite"></p>
    <div class="snap-actions">
      <button type="button" data-act="copy" class="primary">Copy image</button>
      <button type="button" data-act="download">Download PNG</button>
      <button type="button" data-act="again">New snip</button>
    </div>
  </form>`;
document.body.append(dlg);
const dlgImg = dlg.querySelector("img");
const dlgInfo = dlg.querySelector(".snap-info");
const opt = (n) => dlg.querySelector(`[name=${n}]`);
let snap = null; // { region, grabs: {scale: grab}, canvas, blob, url }

async function render() {
  const scale = +opt("scale").value;
  dlgInfo.textContent = "Rendering…";
  snap.grabs[scale] ??= await grabMap(map, scale);
  const hasDA = !!current;
  for (const n of ["details", "label"]) opt(n).disabled = !hasDA;
  const { canvas, labelHidden } = compose({
    grab: snap.grabs[scale],
    region: snap.region,
    project: (ll) => map.project(ll),
    include: { title: opt("title").checked, legend: opt("legend").checked, details: hasDA && opt("details").checked, label: hasDA && opt("label").checked },
    title: "Toronto income and housing by dissemination area",
    subtitle: legendModel().title,
    url: location.host,
    credits: CREDITS,
    legend: legendModel(),
    details: snapshotDetails(),
    label: snapshotLabel(),
    pin: marker ? marker.getLngLat().toArray() : null,
  });
  snap.canvas = canvas;
  snap.blob = toBlob(canvas);
  if (snap.url) URL.revokeObjectURL(snap.url);
  snap.url = URL.createObjectURL(await snap.blob);
  dlgImg.src = snap.url;
  const notes = [`${canvas.width} × ${canvas.height} px`];
  if (!hasDA) notes.push("Click a DA (or search) before snipping to outline, label and describe it.");
  if (labelHidden) notes.push("The selected DA's label point is outside this area; snip around it to label it.");
  dlgInfo.textContent = notes.join(" · ");
}

async function openPreview(region) {
  snap = { region, grabs: {} };
  dlgImg.removeAttribute("src");
  dlg.showModal();
  try {
    await render();
  } catch {
    dlgInfo.textContent = "Couldn't create the image in this browser.";
  }
}

dlg.querySelector(".snap-opts").addEventListener("change", () => render().catch(() => {}));
dlg.addEventListener("close", () => {
  if (snap?.url) URL.revokeObjectURL(snap.url);
  snap = null;
});
dlg.querySelector(".snap-actions").addEventListener("click", async (e) => {
  const act = e.target.closest("button")?.dataset.act;
  if (!act || !snap?.blob) return;
  const name = `toronto-income-${view}-${current ? `DA${current.props.dauid}-` : ""}${select.value}.png`;
  if (act === "again") {
    dlg.close();
    startSnip();
  } else if (act === "download") {
    const a = document.createElement("a");
    a.href = snap.url;
    a.download = name;
    a.click();
  } else if (act === "copy") {
    try {
      // Pass the pending blob so the write starts within the click (user activation).
      await navigator.clipboard.write([new ClipboardItem({ "image/png": snap.blob })]);
      dlgInfo.textContent = "Copied to the clipboard. Paste it anywhere.";
    } catch {
      dlgInfo.textContent = "This browser didn't allow copying images; use Download PNG instead.";
    }
  }
});

class SnapshotControl {
  onAdd() {
    this.el = document.createElement("div");
    this.el.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const b = document.createElement("button");
    b.type = "button";
    b.className = "snapshot-btn";
    b.title = "Snapshot: drag to select an area";
    b.setAttribute("aria-label", "Take a snapshot of an area of the map");
    b.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`;
    b.addEventListener("click", startSnip);
    this.el.append(b);
    return this.el;
  }
  onRemove() {
    this.el.remove();
  }
}
map.addControl(new SnapshotControl(), "top-right");
