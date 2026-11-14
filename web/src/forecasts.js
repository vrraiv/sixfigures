// Shared by the Forecasts pages (fc-schools.js, fc-value.js, fc-method.js): forecasts.json
// (pipeline/forecast_pages.py), the map coloured by a forecast, the list of neighbourhoods
// with their ranges, the forecast-against-actual scatter, and the rung tables.
import "./style.css";
import { $, COLORS, escapeHTML, loadJSON, loadFailed, own } from "./catalogue.js";
import { initPick, initTip, quantile } from "./charts.js";

export const load = () => loadJSON(`/forecasts.json?v=${__FORECASTS_VERSION__}`).catch(loadFailed);
export { $, escapeHTML, initPick, initTip, own };

export const INSIDE = "#2a78d6", OUTSIDE = "#c2410c";
export const fmtPct = (v, d = 1) => (v == null ? "—" : `${v.toFixed(d)}%`);
export const fmtPts = (v, d = 2) => (v == null ? "—" : v.toFixed(d));
export const fmtShare = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
export const fmtMoney = (v) => (v == null ? "—" : `$${Math.round(v).toLocaleString("en-CA")}`);
export const fmtK = (v) => (Math.abs(v) >= 1e6 ? `$${+(v / 1e6).toFixed(2)}M` : `$${Math.round(v / 1000)}k`);
export const signed = (v, d = 1) => (v == null ? "—" : `${v < 0 ? "−" : v > 0 ? "+" : ""}${Math.abs(v).toFixed(d)}`);

// ---- the map: neighbourhoods in six classes of about equal numbers ----------------------------
// vals: a value per neighbourhood index (null: no figure); tip(i): the tooltip's HTML.
export function drawMap(fig, keyEl, D, vals, fmt, tip, label) {
  const s = vals.filter((v) => v != null).sort((a, b) => a - b);
  const b = [1, 2, 3, 4, 5].map((k) => quantile(s, k / 6)).filter((q, k, qs) => k === 0 || q > qs[k - 1]);
  const pal = b.length + 1 === COLORS.length ? COLORS : COLORS.slice(COLORS.length - b.length - 1);
  const cls = (v) => b.filter((e) => v >= e).length;
  const shapes = D.nbhd.map((n, i) => {
    const v = vals[i];
    return `<path d="${n.path}" fill="${v == null ? "url(#nb-hatch)" : pal[cls(v)]}" data-i="${i}" data-tip="${escapeHTML(tip(i))}"/>`;
  }).join("");
  fig.innerHTML = `<svg viewBox="0 0 ${D.map.width} ${D.map.height}" role="img" aria-label="${escapeHTML(label)}">
    <defs><pattern id="nb-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#f0f0ec"/><line x1="0" y1="0" x2="0" y2="8" stroke="#c9c9c3" stroke-width="3"/></pattern></defs>
    <g>${shapes}</g></svg>`;
  const edges = [null, ...b, null];
  const name = (k) => (edges[k] == null ? `under ${fmt(edges[k + 1])}` : edges[k + 1] == null ? `${fmt(edges[k])} or more` : `${fmt(edges[k])} to ${fmt(edges[k + 1])}`);
  keyEl.innerHTML = pal.map((c, k) => `<li><span class="key-sq" style="background:${c}"></span>${name(k)}</li>`).join("")
    + (vals.some((v) => v == null) ? `<li><span class="key-sq hatch"></span>No forecast</li>` : "");
}

// ---- every neighbourhood with its range ---------------------------------------------------------
// rows: [{i, pred, low, high, from, note?}]; `from` is the figure at the origin, marked as a tick.
// log: place values on a log scale (dollars, where a few neighbourhoods run far above the rest).
export function rangeList(el, D, rows, { fmt, sort = "pred", filter = "", fromLabel, predLabel, log = false }) {
  const q = filter.trim().toLowerCase();
  const shown = rows.filter((r) => !q || D.nbhd[r.i].name.toLowerCase().includes(q));
  shown.sort(sort === "name" ? (a, b) => D.nbhd[a.i].name.localeCompare(D.nbhd[b.i].name) : (a, b) => b.pred - a.pred);
  const f = log ? Math.log : (v) => v;
  const lo = f(Math.min(...rows.map((r) => Math.min(r.low, r.from ?? r.low)))), hi = f(Math.max(...rows.map((r) => Math.max(r.high, r.from ?? r.high))));
  const x = (v) => ((f(v) - lo) / (hi - lo || 1)) * 100;
  el.innerHTML = shown.map((r) => {
    const n = D.nbhd[r.i].name;
    const t = `${n}<br>${predLabel}: <b>${fmt(r.pred)}</b><br>Range: ${fmt(r.low)} to ${fmt(r.high)}${r.from != null ? `<br>${fromLabel}: ${fmt(r.from)}` : ""}${r.note ? `<br>${r.note}` : ""}`;
    return `<li><button type="button" class="nm" data-nb="${r.i}" title="Find ${escapeHTML(n)} on the map">${escapeHTML(n)}</button>
      <span class="fc-track" data-tip="${escapeHTML(t)}"><span class="fc-range" style="left:${x(r.low).toFixed(2)}%;width:${(x(r.high) - x(r.low)).toFixed(2)}%"></span>${r.from != null ? `<span class="fc-from" style="left:${x(r.from).toFixed(2)}%"></span>` : ""}<span class="fc-dot" style="left:${x(r.pred).toFixed(2)}%"></span></span>
      <span class="vl">${fmt(r.pred)}</span></li>`;
  }).join("") || `<li class="none">No neighbourhood matches.</li>`;
}

// ---- forecast against actual, coloured by whether the actual fell inside the range --------------------
export function scatter(el, D, rows, { fmt, xLabel, yLabel, log = false }) {
  const tf = log ? Math.log : (v) => v, inv = log ? Math.exp : (v) => v;
  const all = rows.flatMap((r) => [tf(r.pred), tf(r.actual)]).sort((a, b) => a - b);
  const a = quantile(all, 0.005), b = quantile(all, 0.995), pad = (b - a) * 0.04;
  const lo = a - pad, hi = b + pad;
  const p = (v) => Math.min(100, Math.max(0, ((tf(v) - lo) / (hi - lo)) * 100));
  const q = [0, 0.25, 0.5, 0.75, 1];
  const dots = rows.map((r) => {
    const inside = r.actual >= r.low && r.actual <= r.high;
    const t = `${D.nbhd[r.i].name}<br>Forecast: <b>${fmt(r.pred)}</b> (${fmt(r.low)} to ${fmt(r.high)})<br>Actual: <b>${fmt(r.actual)}</b> · ${inside ? "inside" : "outside"} the range`;
    return `<span class="sc-dot" style="left:${p(r.pred).toFixed(2)}%;bottom:${p(r.actual).toFixed(2)}%;background:${inside ? INSIDE : OUTSIDE}" data-tip="${escapeHTML(t)}"></span>`;
  }).join("");
  el.innerHTML = `<div class="sc-y">${yLabel}</div>
    <div class="sc-box">${q.slice(1, -1).map((f) => `<span class="sc-gx" style="left:${f * 100}%"></span><span class="sc-gy" style="bottom:${f * 100}%"></span>`).join("")}
      <svg class="sc-diag" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="100" x2="100" y2="0" stroke="#9a9a93" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/></svg>
      ${q.map((f) => `<span class="sc-ytick" style="bottom:${f * 100}%">${fmt(inv(lo + f * (hi - lo)))}</span>`).join("")}${dots}</div>
    <div class="sc-xticks">${q.map((f) => `<span style="left:${f * 100}%">${fmt(inv(lo + f * (hi - lo)))}</span>`).join("")}</div>
    <div class="sc-x">${xLabel}</div>`;
}
export const scatterKey = (el) => {
  el.innerHTML = `<li><span class="key-dot" style="background:${INSIDE}"></span>Inside the range</li><li><span class="key-dot" style="background:${OUTSIDE}"></span>Outside</li><li><span class="key-line" style="background:#9a9a93"></span>Forecast equals actual</li>`;
};

// A rung's name with its marks: † added after the first results; ‡ chosen after looking.
export function rungName(D, k) {
  const m = D.rungs[k];
  const mark = m.looked ? ` <span class="fc-mark" title="Chosen after looking, ${m.added}">‡</span>` : m.added ? ` <span class="fc-mark" title="Added ${m.added}, after the first results">†</span>` : "";
  return `${escapeHTML(m.label)}${mark}`;
}
export const marksNote = "† Added after the first results were seen, and fixed before it was computed. ‡ Chosen after looking at both periods' results.";

// The pick bar's extra text for a neighbourhood, built by the page.
export function pickBar(D, getPick, setPick, extra) {
  return initPick($("nb-map"), $("map-pick"), getPick, setPick, extra);
}
export const nbFromHash = (D, id) => {
  const k = D.nbhd.findIndex((n) => String(n.id) === id);
  return k < 0 ? null : k;
};
