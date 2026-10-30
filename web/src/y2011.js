// The 2011 Census page: one census on its own DA boundaries, coloured on the
// main map's classes (breaks_2011.json copies them from breaks.json), with the
// main map's hover, legend, details, detail levels and diagnostics, but no
// change view, search, pinning, boundary overlays or snapshots. The tiles carry
// DA numbers only; the figures come from data/figures/2011/ (figures.js) and
// colour the map through feature state, as on the main map.
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import { wheelZoom } from "./wheel.js";
import { Figures, classIndex } from "./figures.js";
import { cfg, initDetail, detailControls } from "./quality.js";
import { $, BOUNDS, COLORS, GROUPS, MEASURES, STYLE, TILES, distHTML, escapeHTML, fmtAxis, fmtCount, fmtMoney, fmtPct, fmtVal, isMoney, narrow, ordinal, pattern, tileSource } from "./common.js";

const YEAR = "2011", SRC = "da11";
const breaks = await fetch(`/breaks_2011.json?v=${__BREAKS_2011_VERSION__}`).then((r) => r.json());
// The measures this census has, in the catalogue's order and sections.
const measures = Object.keys(MEASURES).filter((m) => m in breaks.measures);
const figures = new Figures(YEAR);

// ---- state ------------------------------------------------------------------

const select = $("measure");
for (const g of Object.keys(GROUPS)) {
  const opts = measures.filter((m) => MEASURES[m].group === g);
  if (!opts.length) continue;
  const og = document.createElement("optgroup");
  og.label = { dwellings: "Dwellings", people: "People" }[g] ?? g;
  og.innerHTML = opts.map((m) => `<option value="${m}">${escapeHTML(MEASURES[m].long)}</option>`).join("");
  select.append(og);
}
// #m=<measure>&da=<DAUID of the open DA>&at=<zoom>/<lat>/<lng>&q=<detail>, as on the main map.
const hashParams = new URLSearchParams(location.hash.slice(1));
initDetail(hashParams);
if (measures.includes(hashParams.get("m"))) select.value = hashParams.get("m");
const linkedDA = /^\d{8}$/.test(hashParams.get("da") ?? "") ? hashParams.get("da") : null;
const linkedAt = (hashParams.get("at") ?? "").split("/").map(Number);
const camera = linkedAt.length === 3 && linkedAt.every(Number.isFinite)
  ? { zoom: linkedAt[0], center: [linkedAt[2], linkedAt[1]] }
  : { bounds: BOUNDS, fitBoundsOptions: { padding: 24 } };
if (narrow.matches) $("legend").open = false;
const groupOf = (m) => measures.filter((k) => MEASURES[k].group === MEASURES[m].group);
const propsOf = (dauid) => figures.props(dauid, groupOf(select.value));

const map = new maplibregl.Map({
  container: "map",
  style: STYLE,
  ...camera,
  attributionControl: { compact: true },
  dragRotate: false,
  pitchWithRotate: false,
  touchPitch: false,
  ...(cfg().ratio ? { pixelRatio: cfg().ratio } : {}),
});
map.touchZoomRotate.disableRotation();
map.keyboard.disableRotation();
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
wheelZoom(map);
if (hashParams.has("diag")) {
  globalThis.__map = map;
  import("./diag.js").then((d) => d.diagnostics(map));
}
const idle = () => new Promise((resolve) => (map.loaded() && !map.isMoving() ? resolve() : map.once("idle", resolve)));

// ---- colouring (feature state, as main.js) ------------------------------------

const SUPPRESSED = -1;
const CLS = ["coalesce", ["feature-state", "cls"], -3];
const fillColor = ["match", CLS, ...COLORS.flatMap((c, i) => [i, c]), "rgba(0,0,0,0)"];
const classOf = (p, m) => (p[m] == null ? SUPPRESSED : classIndex(p[m], breaks.measures[m].breaks.slice(1, -1)));

let paintToken = 0;
async function paintView() {
  const m = select.value, token = ++paintToken;
  try {
    await figures.load(m);
  } catch {
    if (token === paintToken) showToast("Couldn't load this measure's figures. Check your connection and try again.");
    return;
  }
  if (token !== paintToken) return;
  for (const dauid of figures.dauids) {
    map.setFeatureState({ source: SRC, sourceLayer: "da", id: dauid }, { cls: classOf(figures.props(dauid, [m]), m) });
  }
}

// ---- legend -----------------------------------------------------------------

function renderLegend() {
  const m = select.value;
  const meta = breaks.measures[m], d = MEASURES[m], money = isMoney(m);
  const b = meta.breaks, fa = fmtAxis(m), stats = meta[`y${YEAR}`];
  // zero_class: a sixth or more of 2016 and 2021 DAs are exactly 0, so the first class is 0 alone.
  const items = COLORS.map((color, i) => ({
    color,
    label: i === 0 ? (meta.zero_class ? fa(0) : `Under ${fa(b[1])}`) : i === COLORS.length - 1 ? `${fa(b[i])} and over` : `${fa(b[i])} – ${fa(b[i + 1])}`,
  }));
  items.push({ pattern: "hatch", label: `Suppressed (${stats.suppressed} DAs)` });
  $("legend-title").textContent = `${d.long}, ${YEAR} Census`;
  $("legend-items").innerHTML = items
    .map((it) => `<li><span class="swatch${it.pattern ? ` ${it.pattern}` : ""}"${it.color ? ` style="background:${it.color}"` : ""}></span>${it.label}</li>`)
    .join("");
  $("legend-city").textContent = money ? `City of Toronto ${d.stat}: ${fmtMoney(stats.city)}` : `City of Toronto as a whole: ${fmtPct(stats.city)}`;
  $("legend-note").textContent = `Classes are the 2016 and 2021 map's (${meta.zero_class ? "0% alone, then the rest of its" : "its"} DAs split into ${meta.zero_class ? "fifths" : "sixths"}), so a colour means the same ${money ? "dollars" : "share"} on both pages.`;
}

// ---- layers -----------------------------------------------------------------

const HIT = [`${SRC}-fill`];
let firstSymbol;

function addSourceLayers() {
  map.addSource(SRC, { ...tileSource(TILES[SRC]), promoteId: "dauid", attribution: '<a href="https://www.statcan.gc.ca/">Statistics Canada</a>' });
  const base = { source: SRC, "source-layer": "da" };
  // The fills share a layout and have no filter, so MapLibre builds their
  // geometry once per tile; feature state decides which shows where.
  const fill = { ...base, type: "fill", paint: { "fill-antialias": false } };
  map.addLayer({ ...fill, id: `${SRC}-fill`, paint: { ...fill.paint, "fill-color": fillColor, "fill-opacity": 0.85 } }, firstSymbol);
  map.addLayer({ ...fill, id: `${SRC}-sup`, paint: { ...fill.paint, "fill-pattern": "hatch", "fill-opacity": ["case", ["==", CLS, SUPPRESSED], 0.9, 0] } }, firstSymbol);
  map.addLayer({
    ...base, id: `${SRC}-line`, type: "line",
    paint: { "line-color": "#ffffff", "line-opacity": 0.7, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.2, 14, 1] },
  }, firstSymbol);
  // One layer outlines the hovered and selected DAs (full detail only; see syncMark).
  const flag = (k) => ["boolean", ["feature-state", k], false];
  map.addLayer({
    ...base, id: `${SRC}-mark`, type: "line",
    paint: {
      "line-color": ["case", flag("selected"), "#eb6834", "#1a1a19"],
      "line-width": ["case", flag("selected"), 3, flag("hover"), 2, 0],
    },
  }, firstSymbol);
  for (const layer of HIT) {
    map.on("mousemove", layer, onHover);
    map.on("mouseleave", layer, onLeave);
    map.on("click", layer, onClick);
  }
}

function applyView() {
  paintView();
  renderLegend();
  tooltip.hidden = true;
  writeHash();
}

// Below full detail the hovered DA pales (a state term in the fill's opacity)
// and a filtered second copy of the tiles outlines only the selected DA; the
// mark layer, a pass over every DA's edges each frame, stays hidden.
function applyFocus() {
  const full = cfg().outline;
  map.setPaintProperty(`${SRC}-fill`, "fill-opacity", full ? 0.85 : ["case", ["boolean", ["feature-state", "hover"], false], 0.45, 0.85]);
}

function syncMark() {
  const full = cfg().outline;
  if (map.getLayer(`${SRC}-mark`)) map.setLayoutProperty(`${SRC}-mark`, "visibility", full ? "visible" : "none");
  if (map.getLayer(`${SRC}-hl`)) map.setLayoutProperty(`${SRC}-hl`, "visibility", full ? "none" : "visible");
  if (full) return;
  if (selected == null && !map.getLayer(`${SRC}-hl`)) return;
  if (!map.getSource(`${SRC}-hl`)) {
    map.addSource(`${SRC}-hl`, tileSource(TILES[SRC]));
    map.addLayer({
      id: `${SRC}-hl`, type: "line", source: `${SRC}-hl`, "source-layer": "da",
      filter: ["in", ["get", "dauid"], ["literal", []]],
      paint: { "line-color": "#eb6834", "line-width": 3 },
    }, firstSymbol);
  }
  map.setFilter(`${SRC}-hl`, ["in", ["get", "dauid"], ["literal", selected == null ? [] : [selected]]]);
}

const detailUI = detailControls(map, {
  apply: (c) => {
    if (map.getLayer(`${SRC}-line`)) map.setLayerZoomRange(`${SRC}-line`, c.lineMinzoom, 24);
    syncMark();
    if (map.getLayer(`${SRC}-fill`)) applyFocus();
  },
});

let mapMoved = false; // keep the default whole-city framing out of links until the map moves
function writeHash() {
  syncMark();
  const h = new URLSearchParams({ m: select.value });
  if (current) h.set("da", current.dauid);
  if (hashParams.has("diag")) h.set("diag", "");
  if (mapMoved || camera.center) {
    const { lng, lat } = map.getCenter();
    h.set("at", `${map.getZoom().toFixed(2)}/${lat.toFixed(5)}/${lng.toFixed(5)}`);
  }
  history.replaceState(null, "", `#${h.toString().replaceAll("%2F", "/")}`);
}

// ---- hover + details --------------------------------------------------------

const tooltip = document.createElement("div");
tooltip.className = "tooltip";
tooltip.hidden = true;
document.body.append(tooltip);

let hover = null; // feature id
let current = null; // { dauid, lngLat } of the shown DA
let selected = null; // feature id outlined in orange
const popup = new maplibregl.Popup({ maxWidth: "380px", focusAfterOpen: false, closeOnClick: false });
popup.on("close", () => {
  if (narrow.matches) return;
  current = null;
  writeHash();
});

const state = (id, s) => map.setFeatureState({ source: SRC, sourceLayer: "da", id }, s);
function setHover(id) {
  if (hover === id) return;
  if (hover != null) state(hover, { hover: false });
  hover = id;
  if (hover != null) state(hover, { hover: true });
}
function setSelected(id) {
  if (selected != null) state(selected, { selected: false });
  selected = id;
  if (selected != null) state(selected, { selected: true });
}

function tooltipText(p) {
  const m = select.value;
  return `${p[m] == null ? "Suppressed" : fmtVal(m, p[m])} · DA ${p.dauid}, in ${p.nbhd}`;
}
// The tooltip line for a tile feature; just its number until its figures are here.
function featureText(f) {
  const p = propsOf(f.id);
  return p && figures.has(select.value) ? tooltipText(p) : `DA ${f.id}`;
}

function onHover(e) {
  const f = e.features[0];
  setHover(f.id);
  map.getCanvas().style.cursor = "pointer";
  tooltip.textContent = featureText(f);
  tooltip.style.transform = `translate(${e.originalEvent.clientX + 14}px, ${e.originalEvent.clientY + 14}px)`;
  tooltip.hidden = narrow.matches;
}

function onLeave() {
  setHover(null);
  map.getCanvas().style.cursor = "";
  tooltip.hidden = true;
}

function onClick(e) {
  const f = e.features[0];
  tooltip.hidden = true;
  setSelected(f.id);
  showDetails(f.id, e.lngLat);
}

function detailsHTML(p) {
  const m = select.value;
  const meta = breaks.measures[m], d = MEASURES[m], money = isMoney(m);
  const rows = groupOf(m).map((k) => `<tr class="${k === m ? "sel" : ""}"><th scope="row">${MEASURES[k].short}</th><td>${fmtVal(k, p[k])}</td><td>${p[`pct_${k}`] == null ? "—" : ordinal(p[`pct_${k}`])}</td></tr>`).join("");
  const stats = meta[`y${YEAR}`], v = p[m];
  const lines = [];
  if (v != null) lines.push({ text: `${v >= stats.city ? "Above" : "Below"} the ${YEAR} ${money ? `city ${d.stat}` : `city-wide ${d.stat}`} of ${fmtVal(m, stats.city)} for this measure.` });
  else lines.push({ note: true, text: "This measure is suppressed for this DA by Statistics Canada (small population or data-quality rules). It is shown hatched, not as zero." });
  if (p.rel !== 1) lines.push({ note: true, text: "This DA's boundary was redrawn for the 2016 Census, so its 2016 and 2021 figures can't be compared directly." });
  lines.push({ text: `Population ${YEAR}: ${fmtCount(p.pop11)} · Households: ${fmtCount(p.hh)}` });
  const dist = v == null ? "" : distHTML({
    hist: meta.hist[YEAR], value: v, ref: stats.city, fmt: fmtAxis(m), zero: money ? "$0" : "0%", max: money ? Infinity : 100,
    caption: `${d.long} across ${fmtCount(stats.n)} Toronto DAs, ${YEAR}. This DA in orange; the line marks the ${money ? `city ${d.stat}` : "city as a whole"} (${fmtVal(m, stats.city)}).`,
  });
  return `<h2>DA ${escapeHTML(p.dauid)} (2011 boundary)</h2>
    <p class="place">${escapeHTML(p.nbhd2 ? `Mostly ${p.nbhd}, partly ${p.nbhd2}` : `${p.nbhd} (City neighbourhood ${p.nbhd_id})`)}</p>
    <table class="dt"><thead><tr><th></th><th>${GROUPS[d.group].col}</th><th>Percentile</th></tr></thead><tbody>${rows}</tbody></table>
    ${dist}
    ${lines.map((l) => `<p class="${l.note ? "note" : "cmp"}">${escapeHTML(l.text)}</p>`).join("")}
    <p class="fine">Percentile = share of Toronto DAs with an equal or lower value in the 2011 Census. DAs have no official names; the neighbourhood shown is the City of Toronto neighbourhood covering most of the DA.</p>
    <div class="detail-actions"><button type="button" class="copylink">Copy link to this DA</button></div>`;
}

// The details need the measure's group's figures; a click on another DA (or
// the same one in a new measure) supersedes a pending one.
let detailsToken = 0;
async function showDetails(dauid, lngLat) {
  const token = ++detailsToken;
  try {
    await figures.load(...groupOf(select.value));
  } catch {
    if (token === detailsToken) showToast("Couldn't load this DA's figures. Check your connection and try again.");
    return;
  }
  if (token !== detailsToken) return;
  const p = propsOf(dauid);
  if (!p) return;
  const html = detailsHTML(p);
  if (narrow.matches) {
    popup.remove();
    $("sheet-body").innerHTML = html;
    $("sheet").hidden = false;
  } else {
    $("sheet").hidden = true;
    popup.setLngLat(lngLat).setHTML(html);
    if (!popup.isOpen()) popup.addTo(map);
  }
  current = { dauid, lngLat };
  writeHash();
}

function closeDetails() {
  popup.remove();
  $("sheet").hidden = true;
  setSelected(null);
  current = null;
  writeHash();
}
$("sheet-close").addEventListener("click", closeDetails);

const toast = document.createElement("div");
toast.className = "toast";
toast.setAttribute("role", "status");
toast.hidden = true;
document.body.append(toast);
let toastTimer;
function showToast(text, ms = 4000) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), ms);
}
document.addEventListener("click", async (e) => {
  if (!e.target.closest(".copylink")) return;
  try {
    await navigator.clipboard.writeText(location.href);
    showToast("Link copied. It opens this view with this DA selected.", 3000);
  } catch {
    showToast("Couldn't copy; copy the address bar instead.");
  }
});

// A shared link's DA: outline it and open its details once its tile has loaded.
async function openLinkedDA(dauid) {
  await idle();
  const parts = map.querySourceFeatures(SRC, { sourceLayer: "da", filter: ["==", ["get", "dauid"], dauid] });
  if (!parts.length) return showToast(`The linked DA ${dauid} isn't loaded in this part of the map or at this zoom.`);
  // A DA can be split across tiles; centre the popup on all of its pieces.
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c) => {
    if (typeof c[0] !== "number") return c.forEach(walk);
    b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]);
  };
  for (const f of parts) walk(f.geometry.coordinates);
  setSelected(dauid);
  showDetails(dauid, { lng: (b[0] + b[2]) / 2, lat: (b[1] + b[3]) / 2 });
}

// ---- keyboard and screen readers -----------------------------------------------

const canvas = map.getCanvas();
canvas.setAttribute("aria-label", "Map of the 2011 Census by dissemination area. Arrow keys pan, plus and minus zoom, Enter opens the area at the centre, Escape closes it.");
const live = $("map-live");
const centreDA = () => map.queryRenderedFeatures([canvas.clientWidth / 2, canvas.clientHeight / 2], { layers: HIT.filter((l) => map.getLayer(l)) })[0] ?? null;
const centreText = () => {
  const f = centreDA();
  return f ? featureText(f) : "No dissemination area at the map centre.";
};
map.on("moveend", () => {
  if (document.activeElement === canvas) live.textContent = centreText();
});
canvas.addEventListener("focus", () => {
  if (canvas.matches(":focus-visible")) live.textContent = centreText();
});
const wrap = document.querySelector(".map-wrap");
canvas.addEventListener("pointerdown", () => wrap.classList.add("pointing"));
canvas.addEventListener("keydown", (e) => {
  wrap.classList.remove("pointing");
  if (e.key === "Escape" && current) {
    closeDetails();
    live.textContent = "Closed the area's details.";
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    const f = centreDA();
    if (!f) return (live.textContent = "No dissemination area at the map centre.");
    setSelected(f.id);
    showDetails(f.id, map.getCenter());
    live.textContent = `Opened ${featureText(f)}.`;
  }
});

// ---- load -------------------------------------------------------------------

// The data layers go in as soon as the style is parsed, before the basemap's own
// tiles, sprite and glyphs arrive, so the DA tiles download and parse alongside them.
map.once("style.load", () => {
  map.addImage("hatch", pattern("hatch"), { pixelRatio: 2 });
  firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
  addSourceLayers();
  applyView();
  detailUI.apply();
});

map.on("load", () => {
  select.addEventListener("change", () => {
    applyView();
    if (current) showDetails(current.dauid, current.lngLat);
  });
  // A click off every DA closes the popup (the bottom sheet has its own ×).
  map.on("click", (e) => {
    if (!map.queryRenderedFeatures(e.point, { layers: HIT }).length) popup.remove();
  });
  map.on("moveend", () => {
    mapMoved = true;
    writeHash();
  });
  if (linkedDA) openLinkedDA(linkedDA);
});
