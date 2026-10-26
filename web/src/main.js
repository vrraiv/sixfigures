import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import { PMTiles, Protocol } from "pmtiles";
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
const tilesUrl = `${location.origin}/toronto_da.pmtiles?v=${__TILES_VERSION__}`;
protocol.add(new PMTiles(new RangeOrFullSource(tilesUrl)));

const STYLE = "https://tiles.openfreemap.org/styles/positron";
const TILES = `pmtiles://${tilesUrl}`;
const BOUNDS = [[-79.6393, 43.5792], [-79.1153, 43.8555]];

// One-hue blue ramp, light -> dark (validated: monotone lightness, single hue).
const COLORS = ["#cde2fb", "#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#0d366b"];

const MEASURES = {
  med_hh_tot: { short: "Household, total", long: "Median total household income" },
  med_hh_at: { short: "Household, after tax", long: "Median after-tax household income" },
  med_ind_tot: { short: "Individual, total", long: "Median total income of recipients (15+)" },
  med_ind_at: { short: "Individual, after tax", long: "Median after-tax income of recipients (15+)" },
};

const narrow = window.matchMedia("(max-width: 640px)");
const $ = (id) => document.getElementById(id);
const fmtMoney = (v) => (v == null ? "—" : `$${v.toLocaleString("en-CA")}`);
const fmtCount = (v) => (v == null ? "—" : v.toLocaleString("en-CA"));
const fmtK = (v) => `$${(v / 1000).toLocaleString("en-CA", { maximumFractionDigits: 1 })}k`;
const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

const select = $("measure");
const hashMeasure = new URLSearchParams(location.hash.slice(1)).get("m");
if (hashMeasure in MEASURES) select.value = hashMeasure;
if (narrow.matches) $("legend").open = false;

const breaks = await fetch(`/breaks.json?v=${__TILES_VERSION__}`).then((r) => r.json());

const map = new maplibregl.Map({
  container: "map",
  style: STYLE,
  bounds: BOUNDS,
  fitBoundsOptions: { padding: 24 },
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
function fillColor(m) {
  const b = breaks.measures[m].breaks; // [min, q1 … q5, max]
  const expr = ["step", ["get", m], COLORS[0]];
  for (let i = 1; i < COLORS.length; i++) expr.push(b[i], COLORS[i]);
  return expr;
}

function hatchImage() {
  const size = 16, c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#e4e4e0";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "#9a9a95";
  ctx.lineWidth = 2;
  ctx.beginPath();
  // 45° lines, drawn across tile edges so the pattern tiles seamlessly
  for (const o of [-size, 0, size]) {
    ctx.moveTo(o, size);
    ctx.lineTo(o + size, 0);
  }
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

function renderLegend(m) {
  const meta = breaks.measures[m];
  const b = meta.breaks;
  $("legend-title").textContent = `${MEASURES[m].long}, 2020`;
  const items = COLORS.map((c, i) => {
    const label = i === COLORS.length - 1 ? `${fmtK(b[i])} and over` : `${fmtK(b[i])} – ${fmtK(b[i + 1])}`;
    return `<li><span class="swatch" style="background:${c}"></span>${label}</li>`;
  });
  items.push(`<li><span class="swatch hatch"></span>Suppressed (${meta.suppressed} DAs)</li>`);
  $("legend-items").innerHTML = items.join("");
  $("legend-city").innerHTML = `City of Toronto median: <strong>${fmtMoney(meta.city_median)}</strong>`;
}

function setMeasure(m) {
  map.setPaintProperty("da-fill", "fill-color", fillColor(m));
  map.setFilter("da-fill", ["!", ["get", `sup_${m}`]]);
  map.setFilter("da-sup", ["get", `sup_${m}`]);
  renderLegend(m);
  tooltip.hidden = true;
  history.replaceState(null, "", `#m=${m}`);
  if (current) showDetails(current.props, current.lngLat, current.note);
}

// ---- hover + details --------------------------------------------------------

const tooltip = document.createElement("div");
tooltip.className = "tooltip";
tooltip.hidden = true;
document.body.append(tooltip);

let hoverId = null;
let current = null; // { props, lngLat, note } of the clicked DA
const popup = new maplibregl.Popup({ maxWidth: "320px", focusAfterOpen: false });
popup.on("close", () => { if (!narrow.matches) current = null; });

function setHover(id) {
  if (hoverId === id) return;
  if (hoverId != null) map.setFeatureState({ source: "da", sourceLayer: "da", id: hoverId }, { hover: false });
  hoverId = id;
  if (id != null) map.setFeatureState({ source: "da", sourceLayer: "da", id }, { hover: true });
}

const escapeHTML = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// DAs have no names; show the City of Toronto neighbourhood that covers most of it.
function placeLine(p) {
  return p.nbhd2 ? `Mostly ${p.nbhd}, partly ${p.nbhd2}` : `${p.nbhd} (City neighbourhood ${p.nbhd_id})`;
}

function detailsHTML(p, note) {
  const m = select.value;
  const rows = Object.entries(MEASURES).map(([k, d]) => {
    const pct = p[`pct_${k}`];
    return `<tr class="${k === m ? "sel" : ""}"><th scope="row">${d.short}</th>
      <td>${fmtMoney(p[k])}</td><td>${pct == null ? "—" : ordinal(pct)}</td></tr>`;
  });
  const meta = breaks.measures[m];
  const v = p[m];
  const vs = v == null ? "" : `<p class="cmp">${v >= meta.city_median ? "Above" : "Below"} the city median of ${fmtMoney(meta.city_median)} for this measure.</p>`;
  const sup = p[`sup_${m}`]
    ? `<p class="note">Income figures for this DA are suppressed by Statistics Canada
       (small population or data-quality rules). It is shown hatched, not as zero.</p>`
    : "";
  return `${note ? `<p class="found">${escapeHTML(note)}</p>` : ""}
    <h2>DA ${p.dauid}</h2>
    <p class="place">${escapeHTML(placeLine(p))}</p>
    <table class="dt"><thead><tr><th></th><th>Median</th><th>Percentile</th></tr></thead>
    <tbody>${rows.join("")}</tbody></table>
    ${vs}${sup}
    <p class="ctx">Population 2021: <strong>${fmtCount(p.pop21)}</strong> · Households: <strong>${fmtCount(p.hh)}</strong></p>
    <p class="fine">Percentile = share of Toronto DAs with an equal or lower median.
      DAs have no official names; the neighbourhood shown is the City of Toronto neighbourhood covering most of the DA.</p>`;
}

function showDetails(props, lngLat, note) {
  current = { props, lngLat, note };
  if (narrow.matches) {
    popup.remove();
    $("sheet-body").innerHTML = detailsHTML(props, note);
    $("sheet").hidden = false;
  } else {
    $("sheet").hidden = true;
    popup.setLngLat(lngLat).setHTML(detailsHTML(props, note)).addTo(map);
  }
}

$("sheet-close").addEventListener("click", () => {
  $("sheet").hidden = true;
  current = null;
});

// ---- layers -----------------------------------------------------------------

map.on("load", () => {
  map.addImage("hatch", hatchImage(), { pixelRatio: 2 });
  map.addSource("da", {
    type: "vector",
    url: TILES,
    promoteId: "dauid",
    attribution: '<a href="https://www.statcan.gc.ca/">Statistics Canada</a>',
  });

  // Draw data beneath the basemap's labels.
  const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
  const m = select.value;
  map.addLayer({
    id: "da-fill", type: "fill", source: "da", "source-layer": "da",
    filter: ["!", ["get", `sup_${m}`]],
    paint: { "fill-color": fillColor(m), "fill-opacity": 0.85 },
  }, firstSymbol);
  map.addLayer({
    id: "da-sup", type: "fill", source: "da", "source-layer": "da",
    filter: ["get", `sup_${m}`],
    paint: { "fill-pattern": "hatch", "fill-opacity": 0.9 },
  }, firstSymbol);
  map.addLayer({
    id: "da-line", type: "line", source: "da", "source-layer": "da",
    paint: {
      "line-color": "#ffffff",
      "line-opacity": 0.7,
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.2, 14, 1],
    },
  }, firstSymbol);
  map.addLayer({
    id: "da-hover", type: "line", source: "da", "source-layer": "da",
    paint: {
      "line-color": "#1a1a19",
      "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2, 0],
    },
  }, firstSymbol);
  map.addLayer({
    id: "da-selected", type: "line", source: "da", "source-layer": "da",
    paint: {
      "line-color": "#eb6834",
      "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 3, 0],
    },
  }, firstSymbol);

  renderLegend(m);
  select.addEventListener("change", () => setMeasure(select.value));

  const hit = ["da-fill", "da-sup"];
  map.on("mousemove", hit, (e) => {
    const f = e.features[0];
    setHover(f.id);
    map.getCanvas().style.cursor = "pointer";
    const v = f.properties[select.value];
    tooltip.textContent = `${v == null ? "Suppressed" : fmtMoney(v)} · DA ${f.properties.dauid}, in ${f.properties.nbhd}`;
    tooltip.style.transform = `translate(${e.originalEvent.clientX + 14}px, ${e.originalEvent.clientY + 14}px)`;
    tooltip.hidden = narrow.matches;
  });
  map.on("mouseleave", hit, () => {
    setHover(null);
    map.getCanvas().style.cursor = "";
    tooltip.hidden = true;
  });
  map.on("click", hit, (e) => {
    const f = e.features[0];
    setHover(f.id);
    tooltip.hidden = true;
    clearSelection();
    showDetails(f.properties, e.lngLat);
  });
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
let selected = [];
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
  for (const id of selected) map.setFeatureState({ source: "da", sourceLayer: "da", id }, { selected: false });
  selected = [];
  marker?.remove();
  marker = null;
}

const idle = () => new Promise((resolve) => (map.loaded() && !map.isMoving() ? resolve() : map.once("idle", resolve)));

async function goTo(hit, kind) {
  if (!map.getSource("da")) await new Promise((resolve) => map.once("load", resolve));
  clearSelection();
  popup.remove();
  $("sheet").hidden = true;
  current = null;
  const das = hit.das.map((i) => index.da(i));
  selected = das.map((d) => d.dauid);
  for (const id of selected) map.setFeatureState({ source: "da", sourceLayer: "da", id }, { selected: true });
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
    const where = kind === "intersection" ? "meet at this intersection" : "share this address";
    setStatus(`${label}: ${das.length} dissemination areas ${where} (outlined in orange). Click or tap one to see its figures.`);
    return;
  }
  const [f] = map.querySourceFeatures("da", { sourceLayer: "da", filter: ["==", ["get", "dauid"], das[0].dauid] });
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

