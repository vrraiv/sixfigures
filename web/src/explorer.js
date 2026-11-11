// The Data Explorer: any neighbourhood measure from any source on the site, from
// web/public/explorer/ (pipeline/explorer_data.py). The catalogue lists the measures and
// carries the neighbourhood outlines; a source's data loads when one of its measures is
// first used. This file is the one-measure view: map, spread, ranking, trend, changes,
// stability and the measures it goes with. Views for two and three measures build on it.
import "./style.css";
import { $, COLORS, DIVERGING, escapeHTML, ordinal, sign } from "./catalogue.js";
import { fmtR, initPick, initTip, quantile, rColor, spearman } from "./charts.js";
import { breaks, cls, rangeLabels, rankOrder } from "./nbtools.js";

const V = __EXPLORER_VERSION__;
const C = await fetch(`/explorer/catalogue.json?v=${V}`).then((r) => r.json());
const nbhd = C.nbhd, N = nbhd.length, ORANGE = "#c2410c";
const DEF = Object.fromEntries(C.measures.map((m) => [m.id, m]));
const SRC = Object.fromEntries(C.sources.map((s) => [s.key, s]));
const cache = {};
const load = (src) => (cache[src] ??= fetch(`/explorer/${src}.json?v=${V}`).then((r) => r.json()));
const columns = async (id) => (await load(DEF[id].source))[id.split(".")[1]];

// ---- formatting by unit --------------------------------------------------------------------
const num = (v, d) => v.toLocaleString("en-CA", { minimumFractionDigits: d, maximumFractionDigits: d });
const F = {
  money: (v) => `$${num(Math.round(v), 0)}`,
  pct: (v) => `${v.toFixed(1)}%`,
  rate: (v) => (v === 0 ? "0" : Math.abs(v) >= 100 ? num(Math.round(v), 0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)),
  score: (v) => v.toFixed(1),
  degC: (v) => `${sign(+v.toFixed(1))}${Math.abs(v).toFixed(1)}°C`,
  temp: (v) => `${v.toFixed(1)}°C`,
  index: (v) => v.toFixed(2),
};
const fmt = (d, v) => (v == null ? "—" : F[d.unit](v));
const fmtAxis = (d, v) => (d.unit === "money" && Math.abs(v) >= 10000 ? `$${Math.round(v / 1000)}k` : d.unit === "pct" ? `${+v.toFixed(1)}%` : fmt(d, v));
// a change in the measure's own terms: dollars, percentage points, degrees, or plain
const fmtDiff = (d, v) => {
  if (v == null) return "—";
  const a = Math.abs(v), s = sign(+v.toFixed(2));
  return d.unit === "money" ? `${s}$${num(Math.round(a), 0)}` : d.unit === "pct" ? `${s}${a.toFixed(1)} pp`
    : d.unit === "degC" || d.unit === "temp" ? `${s}${a.toFixed(1)}°C` : `${s}${F[d.unit === "index" ? "index" : "rate"](a)}`;
};
const lc = (s) => (/^[A-Z][a-z]/.test(s) && !/^(Grade|Norway|John|Olivia|Ana|Airbnb|CMHC)/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const known = (vs) => vs.filter((v) => v != null);
const sorted = (vs) => known(vs).sort((a, b) => a - b);

// ---- state, kept in the address ---------------------------------------------------------------
const hash = new URLSearchParams(location.hash.slice(1));
const nbIndex = (id) => {
  const k = nbhd.findIndex((n) => String(n.id) === id);
  return k < 0 ? null : k;
};
const state = { m: DEF[hash.get("m")] ? hash.get("m") : "census.med_hh_tot", p: null, nb: nbIndex(hash.get("nb")), from: null, to: null };
let cur = null; // {d, cols}: the measure on show
const period = (k = state.p) => cur.d.periods[k];
const writeHash = () => {
  const h = new URLSearchParams({ m: state.m, p: period() });
  if (cur.d.periods.length > 1) { h.set("f", period(state.from)); h.set("t", period(state.to)); }
  if (state.nb != null) h.set("nb", nbhd[state.nb].id);
  history.replaceState(null, "", `#${h}`);
};
initTip();

// ---- controls -------------------------------------------------------------------------------------
const select = $("measure");
select.innerHTML = C.sources.map((s) => {
  const ms = C.measures.filter((m) => m.source === s.key);
  return `<optgroup label="${escapeHTML(s.label)}">${ms.map((m) => `<option value="${m.id}">${escapeHTML(m.label)}</option>`).join("")}</optgroup>`;
}).join("");
select.addEventListener("change", () => setMeasure(select.value));
const slider = $("period");
slider.addEventListener("input", () => setPeriod(+slider.value));
$("p-prev").addEventListener("click", () => setPeriod(Math.max(0, state.p - 1)));
$("p-next").addEventListener("click", () => setPeriod(Math.min(cur.d.periods.length - 1, state.p + 1)));
$("chg-from").addEventListener("change", (e) => { state.from = +e.target.value; renderChange(); writeHash(); });
$("chg-to").addEventListener("change", (e) => { state.to = +e.target.value; renderChange(); writeHash(); });
function setPeriod(k) {
  state.p = k;
  draw();
}
let token = 0;
async function setMeasure(id, keep = {}) {
  const mine = ++token, d = DEF[id], cols = await columns(id);
  if (mine !== token) return; // a later choice won
  state.m = id;
  cur = { d, cols };
  const at = (label, fallback) => {
    const k = d.periods.indexOf(label);
    return k < 0 ? fallback : k;
  };
  state.p = at(keep.p, d.periods.length - 1);
  state.from = at(keep.f, 0);
  state.to = at(keep.t, d.periods.length - 1);
  const many = d.periods.length > 1;
  $("period-wrap").hidden = !many;
  slider.max = d.periods.length - 1;
  for (const id2 of ["trend-sec", "change-sec", "stab-sec"]) $(id2).hidden = !many;
  const opts = d.periods.map((p, k) => `<option value="${k}">${escapeHTML(p)}</option>`).join("");
  $("chg-from").innerHTML = opts;
  $("chg-to").innerHTML = opts;
  draw();
  renderRelated();
}
const when = (k = state.p) => `${period(k)}${cur.d.kind === "census" ? " Census" : ""}`;
function controls() {
  const d = cur.d;
  select.value = state.m;
  slider.value = state.p;
  $("p-prev").disabled = state.p === 0;
  $("p-next").disabled = state.p === d.periods.length - 1;
  $("period-label").textContent = `${when()}${d.periods.length > 1 ? ` · ${state.p + 1} of ${d.periods.length}` : ""}`;
  $("about").innerHTML = `<b>${escapeHTML(SRC[d.source].label)}</b>: ${escapeHTML(SRC[d.source].note)}.${d.note ? ` ${escapeHTML(d.note)}` : ""}${d.periods.length === 1 ? ` A single figure (${escapeHTML(period())}), so there is no trend to show.` : ""}`;
}

// ---- 1. the map ---------------------------------------------------------------------------------------
// One set of classes for every period (sixths of all periods' values pooled), so a colour
// means the same as the slider moves.
const markPick = initPick($("nb-map"), $("map-pick"), () => state.nb, (i) => {
  state.nb = i;
  renderHist();
  renderTrend();
  writeHash();
});
function renderMap() {
  const { d, cols } = cur, vs = cols[state.p], b = breaks(cols.flat());
  const pal = COLORS.slice(COLORS.length - b.edges.length - 1), order = rankOrder(vs);
  const rank = new Map(order.map((i, k) => [i, k + 1]));
  const shapes = nbhd.map((n, i) => `<path d="${n.path}" fill="${vs[i] == null ? "url(#nb-hatch)" : pal[cls(b.edges, vs[i])]}" data-i="${i}"
    data-tip="${escapeHTML(`${n.name}<br>${vs[i] == null ? "No figure" : `<b>${fmt(d, vs[i])}</b> · ${ordinal(rank.get(i))} of ${order.length}`}<br>${when()}`)}"/>`).join("");
  $("nb-map").innerHTML = `<svg viewBox="0 0 ${C.map.width} ${C.map.height}" role="img" aria-label="${escapeHTML(`Map of the neighbourhoods by ${d.label}, ${when()}`)}">
    <defs><pattern id="nb-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#f0f0ec"/><line x1="0" y1="0" x2="0" y2="8" stroke="#c9c9c3" stroke-width="3"/></pattern></defs>
    <g>${shapes}</g></svg>`;
  $("map-key").innerHTML = rangeLabels(b.edges, b.zero, (v) => fmtAxis(d, v)).map((l, k) => `<li><span class="key-sq" style="background:${pal[k]}"></span>${escapeHTML(l)}</li>`).join("")
    + (vs.some((v) => v == null) ? `<li><span class="key-sq hatch"></span>No figure</li>` : "");
  $("map-lede").innerHTML = `${escapeHTML(d.label)}, ${escapeHTML(when())}. Classes are sixths of the neighbourhoods${d.periods.length > 1 ? `, over all ${d.periods.length} periods together, so a colour means the same in each` : ""}. Pick a neighbourhood to follow it down the page.`;
  markPick();
}

// ---- 2. how it's spread -------------------------------------------------------------------------------
const BINS = 24;
function renderHist() {
  const { d, cols } = cur, vs = cols[state.p], s = sorted(vs);
  const lo = quantile(s, 0.01), hi = quantile(s, 0.99), w = (hi - lo) / BINS || 1;
  const bin = (v) => Math.min(BINS - 1, Math.max(0, Math.floor((v - lo) / w)));
  const counts = new Array(BINS).fill(0);
  for (const v of s) counts[bin(v)]++;
  const max = Math.max(...counts), bw = 100 / BINS;
  const bars = counts.map((c, k) => (c ? `<rect x="${(k * bw + 0.15).toFixed(2)}" y="${(100 - (c / max) * 100).toFixed(2)}" width="${(bw - 0.3).toFixed(2)}" height="${((c / max) * 100).toFixed(2)}" fill="${COLORS[3]}"/>` : "")).join("");
  const tips = counts.map((c, k) => `<span class="hi-bin" style="left:${k * bw}%;width:${bw}%" data-tip="${escapeHTML(`${k === 0 && s[0] < lo ? "up to " : `${fmtAxis(d, lo + k * w)} to `}${fmtAxis(d, lo + (k + 1) * w)}${k === BINS - 1 && s.at(-1) > hi ? " or more" : ""}: <b>${c}</b> neighbourhood${c === 1 ? "" : "s"}`)}"></span>`).join("");
  const at = (v) => Math.min(100, Math.max(0, ((v - lo) / (hi - lo || 1)) * 100));
  const med = quantile(s, 0.5), q1 = quantile(s, 0.25), q3 = quantile(s, 0.75), pk = state.nb == null ? null : vs[state.nb];
  $("hist").innerHTML = `<div class="hi-box"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${bars}</svg>${tips}
      <span class="hi-city" style="left:${at(med)}%" data-tip="Median neighbourhood: ${escapeHTML(fmt(d, med))}"></span>
      ${pk == null ? "" : `<span class="hi-city hi-pick" style="left:${at(pk)}%" data-tip="${escapeHTML(`${nbhd[state.nb].name}: ${fmt(d, pk)}`)}"></span>`}<span class="hi-max">${max}</span></div>
    <div class="sc-xticks hi-ticks">${[0, 0.25, 0.5, 0.75, 1].map((f) => `<span style="left:${f * 100}%">${f === 0 && s[0] < lo ? "≤" : f === 1 && s.at(-1) > hi ? "≥" : ""}${fmtAxis(d, lo + f * (hi - lo))}</span>`).join("")}</div>`;
  const loI = vs.indexOf(s[0]), hiI = vs.indexOf(s.at(-1));
  $("dist-lede").innerHTML = `${escapeHTML(when())}: the median neighbourhood is at <b>${fmt(d, med)}</b> (the dark line), and the middle half lie between ${fmt(d, q1)} and ${fmt(d, q3)}. They run from ${fmt(d, s[0])} (${escapeHTML(nbhd[loI].name)}) to ${fmt(d, s.at(-1))} (${escapeHTML(nbhd[hiI].name)})${s.length < N ? `; ${N - s.length} have no figure` : ""}.${pk == null ? "" : ` ${escapeHTML(nbhd[state.nb].name)}, in orange, is at <b>${fmt(d, pk)}</b>.`}`;
}

// ---- 3. highest and lowest ---------------------------------------------------------------------------
function renderRanks() {
  const { d, cols } = cur, vs = cols[state.p], order = rankOrder(vs);
  const lo = Math.min(0, ...known(vs)), hi = Math.max(...known(vs));
  const row = (i, k) => `<li><span class="rk">${k}</span><button type="button" class="nm" data-nb="${i}" title="Find ${escapeHTML(nbhd[i].name)} on the map">${escapeHTML(nbhd[i].name)}</button>
      <span class="barcell" data-tip="${escapeHTML(`${nbhd[i].name}<br><b>${fmt(d, vs[i])}</b>`)}"><span class="bar-fill" style="width:${(((vs[i] - lo) / (hi - lo || 1)) * 100).toFixed(1)}%"></span></span>
      <span class="vl">${fmt(d, vs[i])}</span><span class="move"></span></li>`;
  $("rank-top").innerHTML = order.slice(0, 10).map((i, k) => row(i, k + 1)).join("");
  $("rank-bottom").innerHTML = order.slice(-10).reverse().map((i, k) => row(i, order.length - k)).join("");
  $("rank-lede").innerHTML = `${escapeHTML(d.label)}, ${escapeHTML(when())}: ${order.length} neighbourhoods. Pick a name to find it on the map.`;
}

// ---- 4. over time: the median neighbourhood and the spread around it ---------------------------------
function renderTrend() {
  const { d, cols } = cur;
  if (d.periods.length < 2) return;
  const q = (f) => cols.map((c) => quantile(sorted(c), f));
  const p10 = q(0.1), p25 = q(0.25), p50 = q(0.5), p75 = q(0.75), p90 = q(0.9);
  const pk = state.nb == null ? null : cols.map((c) => c[state.nb]);
  const all = [...p10, ...p90, ...(pk ? known(pk) : [])];
  let lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo) * 0.06 || 1;
  lo -= pad; hi += pad;
  const t0 = d.t[0], t1 = d.t.at(-1), x = (k) => ((d.t[k] - t0) / (t1 - t0)) * 100, y = (v) => 100 - ((v - lo) / (hi - lo)) * 100;
  const pts = (vs) => vs.map((v, k) => `${x(k).toFixed(2)},${y(v).toFixed(2)}`);
  const band = (a, b, fill) => `<polygon points="${[...pts(b), ...pts(a).reverse()].join(" ")}" fill="${fill}"/>`;
  let svg = band(p10, p90, COLORS[0]) + band(p25, p75, COLORS[1])
    + `<polyline points="${pts(p50).join(" ")}" fill="none" stroke="${COLORS[5]}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
  if (pk) {
    const runs = [[]];
    pk.forEach((v, k) => (v == null ? runs.push([]) : runs.at(-1).push(`${x(k).toFixed(2)},${y(v).toFixed(2)}`)));
    svg += runs.filter((r) => r.length).map((r) => `<polyline points="${r.join(" ")}" fill="none" stroke="${ORANGE}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>`).join("");
  }
  svg += `<line x1="${x(state.p)}" x2="${x(state.p)}" y1="0" y2="100" stroke="#1a1a19" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>`;
  // each period's hit area runs between the midpoints to its neighbours
  const n = d.periods.length, edge = (k) => (k <= 0 ? 0 : k >= n ? 100 : (x(k - 1) + x(k)) / 2);
  const hits = d.periods.map((p, k) => `<button type="button" class="tr-hit" data-p="${k}" style="left:${edge(k)}%;width:${edge(k + 1) - edge(k)}%"
    data-tip="${escapeHTML(`${when(k)}<br>Median neighbourhood: <b>${fmt(d, p50[k])}</b><br>Middle half: ${fmt(d, p25[k])} to ${fmt(d, p75[k])}<br>Middle 80%: ${fmt(d, p10[k])} to ${fmt(d, p90[k])}${pk ? `<br>${nbhd[state.nb].name}: <b>${fmt(d, pk[k])}</b>` : ""}`)}" aria-label="${escapeHTML(when(k))}"></button>`).join("");
  const yt = [0, 0.25, 0.5, 0.75, 1].map((f) => `<span class="sc-ytick" style="bottom:${f * 100}%">${fmtAxis(d, lo + f * (hi - lo))}</span><span class="sc-gy" style="bottom:${f * 100}%"></span>`).join("");
  const every = Math.ceil(n / 8);
  const xt = d.periods.map((p, k) => ((k % every === 0 && n - 1 - k >= every * 0.6) || k === n - 1 ? `<span style="left:${x(k)}%">${escapeHTML(d.kind === "scrape" ? p.slice(0, 7) : p.split(" ")[0])}</span>` : "")).join("");
  $("trend").innerHTML = `<div class="tr-box ex-trend">${yt}<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${svg}</svg>${hits}</div><div class="ch-xticks">${xt}</div>
    <ul class="year-key"><li><span class="ex-key-line" style="background:${COLORS[5]}"></span>Median neighbourhood</li><li><span class="key-sq" style="background:${COLORS[1]}"></span>Middle half</li>
      <li><span class="key-sq" style="background:${COLORS[0]}"></span>Middle 80%</li>${pk ? `<li><span class="ex-key-line" style="background:${ORANGE}"></span>${escapeHTML(nbhd[state.nb].name)}</li>` : ""}</ul>`;
  const a = p50[0], b = p50.at(-1), spread0 = p75[0] - p25[0], spread1 = p75.at(-1) - p25.at(-1);
  $("trend-lede").innerHTML = `From ${escapeHTML(when(0))} to ${escapeHTML(when(n - 1))} the median neighbourhood went from ${fmt(d, a)} to <b>${fmt(d, b)}</b> (${fmtDiff(d, b - a)}), and the gap between the 25th and 75th percentile neighbourhoods ${Math.abs(spread1 - spread0) < Math.abs(spread0) * 0.05 ? "held about steady" : spread1 > spread0 ? "widened" : "narrowed"} (${fmt(d, spread0).replace(/^[+−±]/, "")} to ${fmt(d, spread1).replace(/^[+−±]/, "")}). Pick a point to move the map to it${pk ? "" : "; pick a neighbourhood to add its line"}.`;
}
$("trend").addEventListener("click", (e) => {
  const b = e.target.closest("[data-p]");
  if (b) setPeriod(+b.dataset.p);
});

// ---- 5. biggest changes between two periods -----------------------------------------------------------
function renderChange() {
  const { d, cols } = cur;
  if (d.periods.length < 2) return;
  $("chg-from").value = state.from;
  $("chg-to").value = state.to;
  const a = cols[state.from], b = cols[state.to];
  const diff = a.map((v, i) => (v == null || b[i] == null ? null : b[i] - v));
  const order = rankOrder(diff), max = Math.max(...known(diff).map(Math.abs), 1e-9);
  const row = (i, k) => `<li><span class="rk">${k}</span><button type="button" class="nm" data-nb="${i}" title="Find ${escapeHTML(nbhd[i].name)} on the map">${escapeHTML(nbhd[i].name)}</button>
      <span class="barcell" data-tip="${escapeHTML(`${nbhd[i].name}<br>${when(state.from)}: ${fmt(d, a[i])}<br>${when(state.to)}: ${fmt(d, b[i])}<br><b>${fmtDiff(d, diff[i])}</b>`)}"><span class="bar-fill" style="width:${((Math.abs(diff[i]) / max) * 100).toFixed(1)}%;background:${diff[i] < 0 ? DIVERGING[1] : DIVERGING[5]}"></span></span>
      <span class="vl ex-diff">${fmtDiff(d, diff[i])}</span><span class="move"></span></li>`;
  const ups = order.filter((i) => diff[i] > 0).slice(0, 10), downs = order.filter((i) => diff[i] < 0).reverse().slice(0, 10);
  $("chg-up").innerHTML = ups.map((i, k) => row(i, k + 1)).join("") || `<li class="ex-none">None rose.</li>`;
  $("chg-down").innerHTML = downs.map((i, k) => row(i, k + 1)).join("") || `<li class="ex-none">None fell.</li>`;
  const s = sorted(diff), up = s.filter((v) => v > 0).length, down = s.filter((v) => v < 0).length;
  $("chg-lede").innerHTML = state.from === state.to ? "Choose two different periods."
    : `From ${escapeHTML(when(state.from))} to ${escapeHTML(when(state.to))}, ${up} neighbourhoods rose and ${down} fell; the median change was <b>${fmtDiff(d, quantile(s, 0.5))}</b>${s.length < N ? ` (${N - s.length} without a figure in both)` : ""}.${d.unit === "money" && d.source === "census" ? " Dollars are already restated for inflation." : ""}`;
}

// ---- 6. how stable the order is --------------------------------------------------------------------------
function renderStability() {
  const { d, cols } = cur;
  if (d.periods.length < 2) return;
  const rs = d.periods.map((_, k) => (k === state.p ? null : spearman(cols[k], cols[state.p])?.r ?? null));
  $("stab-list").innerHTML = d.periods.map((p, k) => (k === state.p ? "" : `<li><button type="button" data-p="${k}">
      <span class="cl-name">${escapeHTML(when(k))}</span>
      <span class="cl-bar"><span class="cl-zero"></span><span class="cl-fill" style="${rs[k] >= 0 ? "left:50%" : `left:${50 - Math.abs(rs[k]) * 50}%`};width:${Math.abs(rs[k] ?? 0) * 50}%;background:${rColor(rs[k] ?? 0)}"></span></span>
      <span class="cl-val">${fmtR(rs[k])}</span></button></li>`)).join("");
  const far = rs.findIndex((r) => r != null), r0 = rs[far === state.p ? d.periods.length - 1 : far];
  $("stab-lede").innerHTML = `How closely each period's ranking of the neighbourhoods matches ${escapeHTML(when())}'s (Spearman rank correlation: 1 is the same order). Against ${escapeHTML(when(far))} it is <b>${fmtR(r0)}</b>: ${r0 > 0.9 ? "the order has barely changed" : r0 > 0.7 ? "mostly the same places at the top and bottom" : r0 > 0.4 ? "a good deal of reshuffling" : "little of the order carries over, which for small counts is partly noise"}. Pick a period to move to it.`;
}
$("stab-list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-p]");
  if (b) setPeriod(+b.dataset.p);
});

// ---- 7. what it goes with: every other measure, at its period nearest this one ----------------------------
const nearest = (d, t) => d.t.reduce((a, x, k) => (Math.abs(x - t) < Math.abs(d.t[a] - t) ? k : a), 0);
let relToken = 0;
async function renderRelated() {
  const mine = ++relToken;
  $("rel-other").innerHTML = $("rel-same").innerHTML = "";
  $("rel-lede").textContent = "Loading the other sources…";
  const all = await Promise.all(C.sources.map((s) => load(s.key).then((data) => [s.key, data])));
  if (mine !== relToken) return;
  const data = Object.fromEntries(all), { d, cols } = cur, vs = cols[state.p], t = d.t[state.p];
  const rs = C.measures.filter((m) => m.id !== d.id).map((m) => {
    const k = nearest(m, t), r = spearman(vs, data[m.source][m.id.split(".")[1]][k]);
    return r && { m, k, r: r.r, n: r.n };
  }).filter(Boolean).sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  const item = ({ m, k, r, n }) => `<li><button type="button" data-m="${m.id}" title="Explore ${escapeHTML(m.label)}">
      <span class="cl-name">${escapeHTML(m.label)}<span class="ex-src">${escapeHTML(SRC[m.source].label)} · ${escapeHTML(m.periods[k])}${n < N ? ` · ${n} neighbourhoods` : ""}</span></span>
      <span class="cl-bar"><span class="cl-zero"></span><span class="cl-fill" style="${r >= 0 ? "left:50%" : `left:${50 - Math.abs(r) * 50}%`};width:${Math.abs(r) * 50}%;background:${rColor(r)}"></span></span>
      <span class="cl-val">${fmtR(r)}</span></button></li>`;
  const other = rs.filter((x) => x.m.source !== d.source).slice(0, 10), same = rs.filter((x) => x.m.source === d.source).slice(0, 6);
  $("rel-other").innerHTML = other.map(item).join("");
  $("rel-same").innerHTML = same.map(item).join("") || `<li class="ex-none">This source has no other measure.</li>`;
  $("rel-same-h").textContent = `From the same source (${SRC[d.source].label})`;
  $("rel-lede").innerHTML = `The measures whose ranking of the neighbourhoods is closest to ${escapeHTML(lc(d.label))}'s in ${escapeHTML(when())}, or most nearly its reverse, out of the other ${C.measures.length - 1}: Spearman rank correlation, each measure at its period nearest ${escapeHTML(period())}. Measures from the same source often count nearly the same thing, so they are listed apart. A correlation across neighbourhoods says nothing about individual people, and none of this shows cause. Pick one to explore it.`;
}
$("rel-cols").addEventListener("click", (e) => {
  const b = e.target.closest("[data-m]");
  if (!b) return;
  setMeasure(b.dataset.m, { p: null });
  $("measure-bar").scrollIntoView({ behavior: "smooth", block: "start" });
});

$("method-note").textContent = `Built ${C.built}. ${C.measures.length} measures from ${C.sources.length} sources, each summed or averaged to the City's 158 neighbourhoods as its own page describes. `
  + "Map classes are sixths of the neighbourhoods over all of a measure's periods. Correlations are Spearman's rank correlation, over the neighbourhoods with a figure in both.";

let lastPeriod = null;
function draw() {
  controls();
  renderMap();
  renderHist();
  renderRanks();
  renderTrend();
  renderChange();
  renderStability();
  writeHash();
  // the related list depends on the period: refresh it when the period changes (not on first draw of a measure)
  const key = `${state.m}|${state.p}`;
  if (lastPeriod && lastPeriod.split("|")[0] === state.m && lastPeriod !== key) renderRelated();
  lastPeriod = key;
}
await setMeasure(state.m, { p: hash.get("p"), f: hash.get("f"), t: hash.get("t") });
