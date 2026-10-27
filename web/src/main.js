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
const hashParams = new URLSearchParams(location.hash.slice(1));
if (hashParams.get("m") in MEASURES) select.value = hashParams.get("m");
let view = VIEWS.includes(hashParams.get("y")) ? hashParams.get("y") : "2021";
if (["dollars", "points"].includes(hashParams.get("c"))) changeBy.value = hashParams.get("c");
document.querySelector(`input[name=year][value="${view}"]`).checked = true;
if (narrow.matches) $("legend").open = false;

const breaks = await fetch(`/breaks.json?v=${__TILES_VERSION__}`).then((r) => r.json());

const sourceOf = (v) => (v === "2016" ? "da16" : "da");
const yearOf = (v) => (v === "2016" ? "2016" : "2021");

const map = new maplibregl.Map({
  container: "map",
  style: STYLE,
  bounds: BOUNDS,
  fitBoundsOptions: { padding: 24 },
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

function changeValue(m) {
  return changeBy.value === "points"
    ? ["-", ["get", `pct_${m}`], ["get", `p16_${m}`]]
    : ["-", ["get", m], ["get", `v16_${m}`]];
}
const changeStops = (m) => breaks.measures[m].change[changeBy.value === "points" ? "points" : "dollars"];
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
    return {
      title: pts ? `Change in percentile rank, ${MEASURES[m].long.toLowerCase()}, 2015 → 2020`
        : `Change in ${MEASURES[m].long.toLowerCase()}, 2015 → 2020`,
      items,
      footer: pts ? `Median DA change: ${fmtPts(c.median_points)}`
        : `City median: ${fmtMoney(y16)} → ${fmtMoney(y21)} (${fmtSignedMoney(y21 - y16)})`,
      note: pts ? "Percentile = rank among Toronto DAs within each census." : "Nominal dollars, not adjusted for inflation.",
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
  $("legend-items").innerHTML = lg.items
    .map((it) => `<li><span class="swatch${it.pattern ? ` ${it.pattern}` : ""}"${it.color ? ` style="background:${it.color}"` : ""}></span>${it.label}</li>`)
    .join("");
  $("legend-city").textContent = lg.footer;
  $("legend-note").textContent = lg.note;
}

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
    for (const l of ["fill", "sup", "line", "hover", "selected", ...(id === "da" ? ["nocmp"] : [])]) {
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
  tooltip.hidden = true;
  const c = view === "change" ? `&c=${changeBy.value}` : "";
  history.replaceState(null, "", `#m=${m}&y=${view}${c}`);
}

async function setView(next) {
  const fromSrc = sourceOf(view);
  view = next;
  applyView();
  const toSrc = sourceOf(view);
  if (!current) return;
  if (fromSrc === toSrc) return showDetails(current.props, current.lngLat, current.note);
  // Carry the selected DA across only when its boundary is the same in both years.
  const { props, lngLat, note } = current;
  clearSelection();
  closeDetails();
  if (props.rel !== 1) {
    setStatus(`DA ${props.dauid}'s boundary changed between 2016 and 2021, so it has no direct counterpart. Click a DA to see its figures.`);
    return;
  }
  await idle();
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
popup.on("close", () => { if (!narrow.matches) current = null; });

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
    else v = changeBy.value === "points" ? fmtPts(p[`pct_${m}`] - p[`p16_${m}`]) : fmtSignedMoney(p[m] - p[`v16_${m}`]);
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
    columns = ["2015", "2020", "Change", "Pctl pts"];
    rows = Object.entries(MEASURES).map(([k, d]) => {
      const ok = p.rel === 1 && p[k] != null && p[`v16_${k}`] != null;
      return {
        label: d.short, selected: k === m,
        cells: [fmtMoney(p[`v16_${k}`]), fmtMoney(p[k]),
          ok ? fmtSignedMoney(p[k] - p[`v16_${k}`]) : "—", ok ? fmtPts(p[`pct_${k}`] - p[`p16_${k}`]) : "—"],
      };
    });
    if (p.rel !== 1) {
      lines.push({ note: true, text: "This DA's boundary changed between 2016 and 2021, so no change is reported. Switch to 2016 to see the 2016 areas here." });
    } else if (p[m] != null && p[`v16_${m}`] != null) {
      lines.push({ text: `Percentile rank for ${MEASURES[m].short.toLowerCase()}: ${ordinal(p[`p16_${m}`])} in 2016 → ${ordinal(p[`pct_${m}`])} in 2021.` });
    } else {
      lines.push({ note: true, text: "Income for this DA was not published in 2016 or 2021 (small population or data-quality rules), so no change is reported." });
    }
    lines.push({ text: "Nominal dollars, not adjusted for inflation. 2020 incomes include pandemic benefits (CERB)." , note: true });
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
      lines.push({ text: `Since 2016: ${fmtSignedMoney(v - p[`v16_${m}`])} (from ${fmtMoney(p[`v16_${m}`])}), ${fmtPts(p[`pct_${m}`] - p[`p16_${m}`])} in percentile rank.` });
    }
    if (p.rel !== 1) lines.push({ note: true, text: `This DA's boundary changed between 2016 and 2021, so ${view === "2016" ? "2021" : "2016"} figures can't be compared directly.` });
    lines.push({ text: `Population ${view}: ${fmtCount(p[y.pop])} · Households: ${fmtCount(p.hh)}` });
  }
  return {
    note,
    heading: `DA ${p.dauid}${view === "2016" ? " (2016 boundary)" : ""}`,
    sub: placeLine(p),
    columns,
    rows,
    lines,
    fine,
  };
}

function detailsHTML(d) {
  const head = `<tr><th></th>${d.columns.map((c) => `<th>${c}</th>`).join("")}</tr>`;
  const body = d.rows.map((r) => `<tr class="${r.selected ? "sel" : ""}"><th scope="row">${r.label}</th>${r.cells.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
  return `${d.note ? `<p class="found">${escapeHTML(d.note)}</p>` : ""}
    <h2>${escapeHTML(d.heading)}</h2>
    <p class="place">${escapeHTML(d.sub)}</p>
    <table class="dt${d.columns.length > 2 ? " wide" : ""}"><thead>${head}</thead><tbody>${body}</tbody></table>
    ${d.lines.map((l) => `<p class="${l.note ? "note" : "cmp"}">${escapeHTML(l.text)}</p>`).join("")}
    <p class="fine">${d.fine.map(escapeHTML).join(" ")}</p>`;
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
}

function closeDetails() {
  popup.remove();
  $("sheet").hidden = true;
  current = null;
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
  if (view === "2016") ({ das, redrawn } = index.in2016(hit.das));
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
