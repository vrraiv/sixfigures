import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import { PMTiles, Protocol } from "pmtiles";
import { compose, grabMap, toBlob } from "./snapshot.js";
import "./style.css";

// pmtiles.js reads the archive with HTTP Range requests. Cloudflare's cache in
// front of the Worker answers those with the whole file (200), which the stock
// FetchSource rejects. This source uses ranges when the server honours them and
// otherwise keeps the one full response (~2 MB) and slices it.
class RangeOrFullSource {
  constructor(url) {
    this.url = url;
    this.full = null;
  }
  getKey() {
    return this.url;
  }
  async getBytes(offset, length) {
    if (!this.full) {
      const resp = await fetch(this.url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
      if (resp.status === 206) return { data: await resp.arrayBuffer() };
      if (!resp.ok) throw new Error(`Tiles request failed: ${resp.status}`);
      this.full = resp.arrayBuffer();
    }
    const buf = await this.full;
    return { data: buf.slice(offset, offset + length) };
  }
}

maplibregl.setWorkerUrl(workerUrl);
const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);
const tilesUrl = (file, v) => `${location.origin}/${file}?v=${v}`;
const TILES = {
  da: tilesUrl("toronto_da.pmtiles", __TILES_VERSION__),
  da16: tilesUrl("toronto_da_2016.pmtiles", __TILES16_VERSION__),
};
for (const url of Object.values(TILES)) protocol.add(new PMTiles(new RangeOrFullSource(url)));

const STYLE = "https://tiles.openfreemap.org/styles/positron";
const BOUNDS = [[-79.6393, 43.5792], [-79.1153, 43.8555]];

// One-hue blue ramp, light -> dark (validated: monotone lightness, single hue).
const COLORS = ["#cde2fb", "#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#0d366b"];
// Diverging ramp for change: red (fell) <- neutral grey -> blue (rose); each arm
// validated as one hue with monotone lightness, light steps distinct from grey.
const DIVERGING = ["#8f1c1c", "#d9403f", "#f2a39b", "#f0efec", "#9ec5f4", "#3987e5", "#184f95"];

const MEASURES = {
  med_hh_tot: { short: "Household, total", long: "Median total household income" },
  med_hh_at: { short: "Household, after tax", long: "Median after-tax household income" },
  med_ind_tot: { short: "Individual, total", long: "Median total income of recipients (15+)" },
  med_ind_at: { short: "Individual, after tax", long: "Median after-tax income of recipients (15+)" },
};
const YEARS = {
  2016: { source: "da16", income: "2015", census: "2016 Census", pop: "pop16" },
  2021: { source: "da", income: "2020", census: "2021 Census", pop: "pop21" },
};
const VIEWS = ["2016", "2021", "change"];

const narrow = window.matchMedia("(max-width: 640px)");
const $ = (id) => document.getElementById(id);
const fmtMoney = (v) => (v == null ? "—" : `$${v.toLocaleString("en-CA")}`);
const fmtCount = (v) => (v == null ? "—" : v.toLocaleString("en-CA"));
const fmtK = (v) => `$${(v / 1000).toLocaleString("en-CA", { maximumFractionDigits: 1 })}k`;
const sign = (v) => (v > 0 ? "+" : v < 0 ? "−" : "±");
const fmtSignedMoney = (v) => (v == null ? "—" : `${sign(v)}$${Math.abs(v).toLocaleString("en-CA")}`);
const fmtSignedK = (v) => `${sign(v)}${fmtK(Math.abs(v))}`;
const fmtPts = (v) => (v == null ? "—" : `${sign(v)}${Math.abs(v)} pts`);
const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
const escapeHTML = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---- state ------------------------------------------------------------------

const select = $("measure");
const changeBy = $("changeby");
// The URL hash keeps the view shareable: #m=<measure>&y=<view>&c=<change basis>
// &da=<DAUID of the open DA>&vs=<DAUID pinned for comparison>&at=<zoom>/<lat>/<lng>.
const hashParams = new URLSearchParams(location.hash.slice(1));
if (hashParams.get("m") in MEASURES) select.value = hashParams.get("m");
let view = VIEWS.includes(hashParams.get("y")) ? hashParams.get("y") : "2021";
if (["real", "dollars", "points"].includes(hashParams.get("c"))) changeBy.value = hashParams.get("c");
const dauidParam = (k) => (/^\d{8}$/.test(hashParams.get(k) ?? "") ? hashParams.get(k) : null);
const linkedDA = dauidParam("da");
const linkedPin = dauidParam("vs");
const linkedAt = (hashParams.get("at") ?? "").split("/").map(Number);
const camera = linkedAt.length === 3 && linkedAt.every(Number.isFinite)
  ? { zoom: linkedAt[0], center: [linkedAt[2], linkedAt[1]] }
  : { bounds: BOUNDS, fitBoundsOptions: { padding: 24 } };
document.querySelector(`input[name=year][value="${view}"]`).checked = true;
if (narrow.matches) $("legend").open = false;

const breaks = await fetch(`/breaks.json?v=${__TILES_VERSION__}`).then((r) => r.json());
// 2015 dollars -> 2020 dollars (annual-average CPI, table 18-10-0005-01; see breaks.json).
const CPI = breaks.cpi.factor;
const cpiName = `${breaks.cpi.geography.split(",")[0]} CPI`;
const inflationPct = Math.round((CPI - 1) * 1000) / 10;

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

// Pooled 2016+2021 quantile breaks: a colour means the same dollars in both years.
const levelColor = (m) => step(["get", m], breaks.measures[m].breaks.slice(1, -1), COLORS);

// Dollar figures in the change view are in 2020 dollars unless "nominal" is chosen.
const realDollars = () => changeBy.value !== "dollars";
const dollarBasis = () => (realDollars() ? "real" : "dollars");

function changeValue(m) {
  if (changeBy.value === "points") return ["-", ["get", `pct_${m}`], ["get", `p16_${m}`]];
  if (changeBy.value === "real") return ["-", ["get", m], ["*", ["get", `v16_${m}`], CPI]];
  return ["-", ["get", m], ["get", `v16_${m}`]];
}
const changeStops = (m) => breaks.measures[m].change[changeBy.value === "points" ? "points" : "dollars"];

// Change in a DA's median for measure k, in the dollars chosen (null if not comparable).
function dollarChange(p, k) {
  if (p.rel !== 1 || p[k] == null || p[`v16_${k}`] == null) return null;
  return Math.round(p[k] - p[`v16_${k}`] * (realDollars() ? CPI : 1));
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
  if (view === "change") {
    const pts = changeBy.value === "points";
    const s = changeStops(m);
    const f = pts ? (v) => fmtPts(v) : (v) => fmtSignedK(v);
    const items = DIVERGING.map((color, i) => ({
      color,
      label: i === 0 ? `Less than ${f(s[0])}` : i === DIVERGING.length - 1 ? `${f(s.at(-1))} or more`
        : s[i - 1] < 0 && s[i] > 0 ? `Within ${pts ? `±${s[i]} pts` : `±${fmtK(s[i])}`}` : `${f(s[i - 1])} to ${f(s[i])}`,
    }));
    const c = meta.change;
    items.push({ pattern: "dots", label: `Boundary changed since 2016 (${c.boundary_changed} DAs)` });
    items.push({ pattern: "hatch", label: `Not published in 2016 or 2021 (${c.not_published} DAs)` });
    const y16 = meta.y2016.city_median, y21 = meta.y2021.city_median;
    const real = changeBy.value === "real";
    return {
      title: pts ? `Change in percentile rank, ${MEASURES[m].long.toLowerCase()}, 2015 → 2020`
        : `Change in ${MEASURES[m].long.toLowerCase()}, 2015 → 2020${real ? ", in 2020 dollars" : ""}`,
      items,
      footer: pts ? `Median DA change: ${fmtPts(c.median_points)}`
        : real ? `City median: ${fmtMoney(Math.round(y16 * CPI))} → ${fmtMoney(y21)} in 2020 dollars (${fmtSignedMoney(Math.round(y21 - y16 * CPI))})`
          : `City median: ${fmtMoney(y16)} → ${fmtMoney(y21)} (${fmtSignedMoney(y21 - y16)})`,
      note: pts ? "Percentile = rank among Toronto DAs within each census."
        : real ? `2015 incomes restated in 2020 dollars: prices rose ${inflationPct}% (${cpiName}, annual averages).`
          : `Nominal dollars, not adjusted for inflation (prices rose ${inflationPct}%, 2015 → 2020).`,
    };
  }
  const y = YEARS[view];
  const stats = meta[`y${view}`];
  const b = meta.breaks;
  const items = COLORS.map((color, i) => ({
    color,
    label: i === 0 ? `Under ${fmtK(b[1])}` : i === COLORS.length - 1 ? `${fmtK(b[i])} and over` : `${fmtK(b[i])} – ${fmtK(b[i + 1])}`,
  }));
  items.push({ pattern: "hatch", label: `Suppressed (${stats.suppressed} DAs)` });
  return {
    title: `${MEASURES[m].long}, ${y.income} (${y.census})`,
    items,
    footer: `City of Toronto median: ${fmtMoney(stats.city_median)}`,
    note: "Classes split 2016 and 2021 DAs combined into sixths, so a colour means the same dollars in both years.",
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
    if (clsOf(e) == null) return;
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
let firstSymbol;

function addSourceLayers(id) {
  map.addSource(id, {
    type: "vector",
    url: `pmtiles://${TILES[id]}`,
    promoteId: "dauid",
    attribution: '<a href="https://www.statcan.gc.ca/">Statistics Canada</a>',
  });
  const base = { source: id, "source-layer": "da", layout: { visibility: "none" } };
  map.addLayer({ ...base, id: `${id}-fill`, type: "fill", paint: { "fill-opacity": 0.85 } }, firstSymbol);
  map.addLayer({ ...base, id: `${id}-sup`, type: "fill", paint: { "fill-pattern": "hatch", "fill-opacity": 0.9 } }, firstSymbol);
  if (id === "da") {
    map.addLayer({ ...base, id: "da-nocmp", type: "fill", filter: ["!=", ["get", "rel"], 1], paint: { "fill-pattern": "dots", "fill-opacity": 0.9 } }, firstSymbol);
  }
  map.addLayer({
    ...base, id: `${id}-line`, type: "line",
    paint: { "line-color": "#ffffff", "line-opacity": 0.7, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.2, 14, 1] },
  }, firstSymbol);
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

// The 2016 tiles (~1.8 MB) load only when someone first switches to 2016.
function ensureSource(id) {
  if (!map.getSource(id)) addSourceLayers(id);
}

function applyView() {
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
    map.setFilter(`${src}-fill`, ["!", ["get", `sup_${m}`]]);
    map.setFilter(`${src}-sup`, ["get", `sup_${m}`]);
  }
  changeBy.hidden = view !== "change";
  renderLegend();
  // A kept class survives a change of measure, not of view or change basis.
  const key = view === "change" ? `change-${changeBy.value === "points" ? "points" : "dollars"}` : "level";
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
  carryPin(toSrc);
  const carry = current;
  clearSelection();
  closeDetails();
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
const popup = new maplibregl.Popup({ maxWidth: "380px", focusAfterOpen: false });
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
    else v = `${fmtSignedMoney(dollarChange(p, m))}${realDollars() ? " (2020 $)" : ""} · ${fmtPts(p[`pct_${m}`] - p[`p16_${m}`])}`;
  } else {
    v = p[m] == null ? "Suppressed" : fmtMoney(p[m]);
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
  const fine = ["Percentile = share of Toronto DAs with an equal or lower median, within each census.",
    "DAs have no official names; the neighbourhood shown is the City of Toronto neighbourhood covering most of the DA."];
  const lines = [];
  let columns, rows;
  if (view === "change") {
    columns = ["2015", "2020", realDollars() ? "Real chg" : "Change", "Pctl pts"];
    rows = Object.entries(MEASURES).map(([k, d]) => {
      const dc = dollarChange(p, k);
      return {
        label: d.short, selected: k === m,
        cells: [fmtMoney(p[`v16_${k}`]), fmtMoney(p[k]),
          fmtSignedMoney(dc), dc == null ? "—" : fmtPts(p[`pct_${k}`] - p[`p16_${k}`])],
      };
    });
    if (p.rel !== 1) {
      lines.push({ note: true, text: "This DA's boundary changed between 2016 and 2021, so no change is reported. Switch to 2016 to see the 2016 areas here." });
    } else if (p[m] != null && p[`v16_${m}`] != null) {
      lines.push({ text: `Percentile rank for ${MEASURES[m].short.toLowerCase()}: ${ordinal(p[`p16_${m}`])} in 2016 → ${ordinal(p[`pct_${m}`])} in 2021.` });
    } else {
      lines.push({ note: true, text: "Income for this DA was not published in 2016 or 2021 (small population or data-quality rules), so no change is reported." });
    }
    lines.push({
      note: true,
      text: realDollars()
        ? `"Real chg" is the change after inflation: 2015 incomes × ${CPI} (prices rose ${inflationPct}%, ${cpiName}). 2020 incomes include pandemic benefits (CERB).`
        : `Nominal dollars, not adjusted for inflation (prices rose ${inflationPct}%, 2015 → 2020). 2020 incomes include pandemic benefits (CERB).`,
    });
    lines.push({ text: `Population 2021: ${fmtCount(p.pop21)} · Households: ${fmtCount(p.hh)}` });
  } else {
    const y = YEARS[view];
    columns = ["Median", "Percentile"];
    rows = Object.entries(MEASURES).map(([k, d]) => ({
      label: d.short, selected: k === m,
      cells: [fmtMoney(p[k]), p[`pct_${k}`] == null ? "—" : ordinal(p[`pct_${k}`])],
    }));
    const v = p[m];
    const cm = meta[`y${view}`].city_median;
    if (v != null) lines.push({ text: `${v >= cm ? "Above" : "Below"} the ${y.income} city median of ${fmtMoney(cm)} for this measure.` });
    if (p[`sup_${m}`]) lines.push({ note: true, text: "Income figures for this DA are suppressed by Statistics Canada (small population or data-quality rules). It is shown hatched, not as zero." });
    if (view === "2021" && p.rel === 1 && v != null && p[`v16_${m}`] != null) {
      const v16 = p[`v16_${m}`];
      lines.push({ text: `Since 2016: ${fmtSignedMoney(v - v16)} (from ${fmtMoney(v16)}), ${fmtSignedMoney(Math.round(v - v16 * CPI))} after inflation, ${fmtPts(p[`pct_${m}`] - p[`p16_${m}`])} in percentile rank.` });
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
  if (view === "change") {
    const pts = changeBy.value === "points";
    const value = pts ? (dollarChange(p, m) == null ? null : p[`pct_${m}`] - p[`p16_${m}`]) : dollarChange(p, m);
    if (value == null) return null;
    return {
      hist: meta.hist.change[pts ? "points" : dollarBasis()],
      value,
      ref: 0,
      fmt: pts ? fmtPts : fmtSignedK,
      caption: `Change across the ${fmtCount(meta.change.comparable)} comparable Toronto DAs${pts ? " (percentile points)" : realDollars() ? " (2020 dollars)" : ""}. This DA in orange; the line marks no change.`,
    };
  }
  if (p[m] == null) return null;
  const y = YEARS[view];
  const stats = meta[`y${view}`];
  return {
    hist: meta.hist[view],
    value: p[m],
    ref: stats.city_median,
    fmt: fmtK,
    caption: `${MEASURES[m].short} median across ${fmtCount(stats.n)} Toronto DAs, ${y.income}. This DA in orange; the line marks the city median (${fmtMoney(stats.city_median)}).`,
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
      <div class="dist-axis"><span>${lo === 0 ? "$0" : `${d.fmt(lo)} or less`}</span><span>${d.fmt(hi)} or more</span></div>
      <figcaption>${escapeHTML(d.caption)}</figcaption>
    </figure>`;
}

// ---- compare with a pinned DA -------------------------------------------------

let pinned = null; // { props, source }

function compareModel(p) {
  if (!pinned || pinned.props.dauid === p.dauid) return null;
  const q = pinned.props;
  const change = view === "change", pts = change && changeBy.value === "points";
  const val = (x, k) => {
    if (!change) return x[k];
    const dc = dollarChange(x, k);
    return pts && dc != null ? x[`pct_${k}`] - x[`p16_${k}`] : dc;
  };
  const fmt = !change ? fmtMoney : pts ? fmtPts : fmtSignedMoney;
  const diff = pts ? fmtPts : fmtSignedMoney;
  return {
    title: `Compared with pinned DA ${q.dauid}, ${q.nbhd}`,
    columns: ["Pinned", "This DA", "Difference"],
    rows: Object.entries(MEASURES).map(([k, d]) => {
      const a = val(q, k), b = val(p, k);
      return { label: d.short, selected: k === select.value, cells: [fmt(a), fmt(b), a == null || b == null ? "—" : diff(b - a)] };
    }),
    note: !change ? `Medians, ${YEARS[view].income}.`
      : `Change 2015 → 2020, ${pts ? "in percentile points" : realDollars() ? "in 2020 dollars" : "in nominal dollars"}.`,
  };
}

function setPin(next) {
  if (pinned) map.setFeatureState({ source: pinned.source, sourceLayer: "da", id: pinned.props.dauid }, { pinned: false });
  pinned = next;
  if (pinned) map.setFeatureState({ source: pinned.source, sourceLayer: "da", id: pinned.props.dauid }, { pinned: true });
  const chip = $("pinchip");
  chip.hidden = !pinned;
  chip.innerHTML = pinned
    ? `<span>Comparing with <strong>DA ${escapeHTML(pinned.props.dauid)}</strong>, ${escapeHTML(pinned.props.nbhd)}. Click another DA.</span> <button type="button" class="unpin">Unpin</button>`
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
  if (f && sourceOf(view) === toSrc) setPin({ props: f.properties, source: toSrc });
}

document.addEventListener("click", (e) => {
  if (e.target.closest(".unpin")) return setPin(null);
  if (!e.target.closest(".pinbtn") || !current) return;
  setPin(pinned?.props.dauid === current.props.dauid ? null : { props: current.props, source: sourceOf(view) });
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

$("sheet-close").addEventListener("click", closeDetails);

// ---- load -------------------------------------------------------------------

map.on("load", () => {
  map.addImage("hatch", pattern("hatch"), { pixelRatio: 2 });
  map.addImage("dots", pattern("dots"), { pixelRatio: 2 });
  // Draw data beneath the basemap's labels.
  firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
  addSourceLayers("da");
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
  map.on("moveend", () => {
    mapMoved = true;
    writeHash();
  });
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
    setStatus(input.value ? "" : HELP);
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
input.addEventListener("blur", () => setTimeout(hideSuggest, 150));
form.addEventListener("submit", (e) => {
  e.preventDefault();
  runSearch(input.value);
});


// ---- snapshot ---------------------------------------------------------------
// Camera button -> drag a rectangle over the map (or take the whole view) ->
// preview with options -> copy to clipboard or download a PNG.

const CREDITS = [
  "Statistics Canada, Census Profile, 2021 Census (98-316-X2021001) and 2016 Census (98-316-X2016001); income years 2020 and 2015; 2021 DA correspondence file (92-156-X). Contains information licensed under the Open Government Licence – Canada.",
  "Neighbourhoods, address points and intersections: City of Toronto Open Data, Open Government Licence – Toronto. Basemap © OpenFreeMap © OpenMapTiles, data © OpenStreetMap contributors.",
];

function snapshotDetails() {
  return current ? detailsModel(current.props, current.note) : null;
}

function snapshotLabel() {
  if (!current) return null;
  const p = current.props;
  const what = view === "change" ? `${MEASURES[select.value].short}, change` : `${MEASURES[select.value].short}, ${YEARS[view].income}`;
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
    title: "Toronto median income by dissemination area",
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
