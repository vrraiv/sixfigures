import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import "./style.css";

maplibregl.setWorkerUrl(workerUrl);
const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

const STYLE = "https://tiles.openfreemap.org/styles/positron";
const TILES = `pmtiles://${location.origin}/toronto_da.pmtiles?v=${__TILES_VERSION__}`;
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
  if (current) showDetails(current.props, current.lngLat);
}

// ---- hover + details --------------------------------------------------------

const tooltip = document.createElement("div");
tooltip.className = "tooltip";
tooltip.hidden = true;
document.body.append(tooltip);

let hoverId = null;
let current = null; // { props, lngLat } of the clicked DA
const popup = new maplibregl.Popup({ maxWidth: "320px", focusAfterOpen: false });
popup.on("close", () => { if (!narrow.matches) current = null; });

function setHover(id) {
  if (hoverId === id) return;
  if (hoverId != null) map.setFeatureState({ source: "da", sourceLayer: "da", id: hoverId }, { hover: false });
  hoverId = id;
  if (id != null) map.setFeatureState({ source: "da", sourceLayer: "da", id }, { hover: true });
}

function detailsHTML(p) {
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
  return `<h2>DA ${p.dauid}</h2>
    <table class="dt"><thead><tr><th></th><th>Median</th><th>Percentile</th></tr></thead>
    <tbody>${rows.join("")}</tbody></table>
    ${vs}${sup}
    <p class="ctx">Population 2021: <strong>${fmtCount(p.pop21)}</strong> · Households: <strong>${fmtCount(p.hh)}</strong></p>
    <p class="fine">Percentile = share of Toronto DAs with an equal or lower median.</p>`;
}

function showDetails(props, lngLat) {
  current = { props, lngLat };
  if (narrow.matches) {
    popup.remove();
    $("sheet-body").innerHTML = detailsHTML(props);
    $("sheet").hidden = false;
  } else {
    $("sheet").hidden = true;
    popup.setLngLat(lngLat).setHTML(detailsHTML(props)).addTo(map);
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

  renderLegend(m);
  select.addEventListener("change", () => setMeasure(select.value));

  const hit = ["da-fill", "da-sup"];
  map.on("mousemove", hit, (e) => {
    const f = e.features[0];
    setHover(f.id);
    map.getCanvas().style.cursor = "pointer";
    const v = f.properties[select.value];
    tooltip.textContent = `${v == null ? "Suppressed" : fmtMoney(v)} · DA ${f.properties.dauid}`;
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
    showDetails(f.properties, e.lngLat);
  });
});
