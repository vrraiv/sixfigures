// The Sale Prices Insights page: home sales and median sale prices by quarter from
// TRREB's community reports, from prices.json (pipeline/price_insights.py), with the
// census figures from insights.json. TRREB's communities are the City's neighbourhoods
// of before 2022; a neighbourhood split in 2022 shows its community's figures.
import "./style.css";
import { $, COLORS, DIVERGING, MEASURES as CENSUS, escapeHTML, isMoney, ordinal, sign, loadJSON, loadFailed, own } from "./catalogue.js";
import { chart, fmtR, initPick, initTip, key, quantile, rColor, seg, spark, spearman } from "./charts.js";
import { buildToc } from "./nbtools.js";

const [P, census] = await Promise.all([
  loadJSON(`/prices.json?v=${__PRICES_VERSION__}`),
  loadJSON(`/insights.json?v=${__INSIGHTS_VERSION__}`),
]).catch(loadFailed);
const nbhd = P.nbhd, C = P.communities, Q = P.quarters;
const LIGHT = COLORS[1], MID = COLORS[3], DARK = COLORS[5], ORANGE = "#c2410c", GREY = "#6b6b66";
const MIN_SALES = 10; // fewer in a year and a community has no median for it
const censusMeasures = Object.keys(CENSUS).filter((m) => census.measures[m]?.values["2021"]);
const sum = (vs) => vs.reduce((a, v) => a + (v ?? 0), 0);
const fmtN = (v) => (v == null ? "—" : Math.round(v).toLocaleString("en-CA"));
const fmtMoney = (v) => (v == null ? "—" : `$${Math.round(v).toLocaleString("en-CA")}`);
const fmtK = (v) => (Math.abs(v) >= 1e6 ? `$${+(v / 1e6).toFixed(2)}M` : `$${Math.round(v / 1000)}k`);
const fmtSPct = (v) => (v == null ? "—" : `${sign(+v.toFixed(1))}${Math.abs(v).toFixed(1)}%`);
const qYear = (k) => +Q[k].slice(0, 4), qNum = (k) => +Q[k].slice(-1);
const LAST = Q.length - 1;

// ---- a community's figures over a set of quarters -----------------------------------------
// Sales add; the median is the quarters' medians, weighted by their sales (on a log scale).
function fig(c, ks) {
  let s = 0, w = 0, lm = 0;
  for (const k of ks) {
    const n = C[c].sales[k] ?? 0, m = C[c].med[k];
    s += n;
    if (m != null) { w += n; lm += n * Math.log(m); }
  }
  return { sales: s, med: s >= MIN_SALES && w ? Math.exp(lm / w) : null };
}
// The quarters of a year, or of the year `back` years before it covering the same quarters.
const quartersOf = (y, back = 0) => {
  const qs = Q.map((_, k) => k).filter((k) => qYear(k) === y).map(qNum);
  return Q.map((_, k) => k).filter((k) => qYear(k) === y - back && qs.includes(qNum(k)));
};
const YEARS = [...new Set(Q.map((q) => +q.slice(0, 4)))].filter((y) => quartersOf(y).length === 4 || y === qYear(LAST));
const partial = (y) => quartersOf(y).length < 4;
const yLabel = (y) => (partial(y) ? `${y} to date` : `${y}`);
const quarterSpan = (y) => {
  const ks = quartersOf(y);
  return ks.length === 4 ? "" : `Q${qNum(ks[0])}–Q${qNum(ks.at(-1))}`;
};
// The City's typical median in a set of quarters: the communities' medians, weighted by their sales.
function cityTypical(ks) {
  let w = 0, lm = 0;
  C.forEach((_, c) => {
    const f = fig(c, ks);
    if (f.med != null) { w += f.sales; lm += f.sales * Math.log(f.med); }
  });
  return Math.exp(lm / w);
}

// ---- neighbourhood measures, by community ---------------------------------------------------
const hhBase = (y) => (y < 2014 ? "2011" : y < 2019 ? "2016" : "2021");
const commHH = (base) => C.map((_, c) => sum(nbhd.filter((n) => n.c === c).map((n) => P.households[base][nbhd.indexOf(n)])));
const M = {
  price: { label: "Median sale price", unit: "money", from: YEARS[0],
    get: (y) => C.map((_, c) => fig(c, quartersOf(y)).med) },
  standing: { label: "Median sale price relative to the City's", unit: "spct", from: YEARS[0],
    get: (y) => {
      const t = cityTypical(quartersOf(y));
      return C.map((_, c) => { const m = fig(c, quartersOf(y)).med; return m == null ? null : (m / t - 1) * 100; });
    } },
  ch1: { label: "Change in median sale price from the year before", unit: "spct", from: YEARS[0] + 1,
    get: (y) => C.map((_, c) => change(c, y, 1)) },
  ch5: { label: "Change in median sale price over five years", unit: "spct", from: YEARS[0] + 5,
    get: (y) => C.map((_, c) => change(c, y, 5)) },
  sales: { label: "Homes sold", unit: "count", count: true, from: YEARS[0],
    get: (y) => C.map((_, c) => fig(c, quartersOf(y)).sales) },
};
function change(c, y, back) {
  const a = fig(c, quartersOf(y, back)).med, b = fig(c, quartersOf(y)).med;
  return a == null || b == null ? null : (b / a - 1) * 100;
}
const years = (m) => YEARS.filter((y) => y >= M[m].from);

// ---- state, kept in the address -------------------------------------------------------------
const hash = new URLSearchParams(location.hash.slice(1));
const nbIndex = (id) => {
  const k = nbhd.findIndex((n) => String(n.id) === id);
  return k < 0 ? null : k;
};
const state = {
  m: own(M, hash.get("m")) ? hash.get("m") : "price",
  y: +hash.get("y") || null,
  rate: hash.get("r") === "1",
  span: ["2011-2016", "2016-2021"].includes(hash.get("cs")) ? hash.get("cs") : "2016-2021",
  sx: hash.get("sx"),
  nb: nbIndex(hash.get("nb")),
};
const fixYear = () => {
  if (!years(state.m).includes(state.y)) state.y = years(state.m).filter((y) => !partial(y)).at(-1);
};
fixYear();
const writeHash = () => {
  const h = new URLSearchParams({ m: state.m, y: state.y, r: state.rate ? "1" : "0", cs: state.span });
  if (state.sx) h.set("sx", state.sx);
  if (state.nb != null) h.set("nb", nbhd[state.nb].id);
  history.replaceState(null, "", `#${h}`);
};

// The current measure's values by community, and spread over the 158 neighbourhoods.
function values() {
  let vs = M[state.m].get(state.y);
  const base = hhBase(state.y);
  if (state.rate && M[state.m].count) {
    const hh = commHH(base);
    vs = vs.map((v, c) => (v == null || !hh[c] ? null : (v / hh[c]) * 1000));
  }
  return { vs, nb: nbhd.map((n) => vs[n.c]), base };
}
const isRate = () => state.rate && M[state.m].count;
function fmtV(v) {
  if (v == null) return "—";
  if (isRate()) return v.toFixed(1);
  const u = M[state.m].unit;
  // pooled medians aren't TRREB's own figures: to the nearest $1,000
  return u === "money" ? fmtMoney(Math.round(v / 1000) * 1000) : u === "spct" ? fmtSPct(v) : fmtN(v);
}
const describe = (base) => `${escapeHTML(M[state.m].label)}, ${yLabel(state.y)}${partial(state.y) ? ` (${quarterSpan(state.y)})` : ""}`
  + `${M[state.m].unit === "spct" && state.m !== "standing" && partial(state.y) ? ", against the same quarters" : ""}${isRate() ? ` per 1,000 households (${base} Census)` : ""}`;
const commOf = (i) => (C[nbhd[i].c].name === nbhd[i].name ? "" : `<br>TRREB community: ${escapeHTML(C[nbhd[i].c].name)}`);

initTip();

// ---- controls ----------------------------------------------------------------------------------
const select = $("measure");
select.innerHTML = Object.entries(M).map(([k, d]) => `<option value="${k}">${escapeHTML(d.label)}</option>`).join("");
select.addEventListener("change", () => set({ m: select.value }));
$("rate").addEventListener("change", (e) => set({ rate: e.target.checked }));
function controls() {
  select.value = state.m;
  seg($("period"), years(state.m).map((y) => [String(y), partial(y) ? `${y}*` : String(y)]), String(state.y), (y) => set({ y: +y }));
  $("rate-wrap").hidden = !M[state.m].count;
  $("rate").checked = state.rate;
}
function set(changes) {
  Object.assign(state, changes);
  if ("m" in changes) { fixYear(); state.sx = null; }
  render();
}

// ---- 1. the city at a glance --------------------------------------------------------------------
function card(name, vals, fmt) {
  const v = vals[LAST], prev = vals[LAST - 4];
  const from = Q.length - 21; // five years of quarters
  return `<div class="card static" aria-label="${escapeHTML(`${name}, ${Q[LAST]}: ${fmt(v)}`)}">
    <span class="card-name">${name}</span><span class="card-value">${fmt(v)}</span>${spark(vals.slice(from))}
    <span class="card-years"><span>${Q[from]}</span><span>${Q[LAST]}</span></span>
    <span class="card-delta">${fmtSPct((v / prev - 1) * 100)} from ${Q[LAST - 4]}</span></div>`;
}
function renderCards() {
  const A = P.city;
  const typical = Q.map((_, k) => cityTypical([k]));
  $("cards").innerHTML = [
    card("Homes sold", A.all.sales, fmtN),
    card("Average sale price", A.all.avg, fmtMoney),
    card("Typical community median", typical, fmtMoney),
    card("Average sale price, West", A.West.avg, fmtMoney),
    card("Average sale price, Central", A.Central.avg, fmtMoney),
    card("Average sale price, East", A.East.avg, fmtMoney),
  ].join("");
  $("glance-lede").innerHTML = `The City of Toronto in ${Q[LAST]}, the latest quarter in TRREB's community reports, against the same quarter a year before; the lines show the last five years. All home types; the average is the communities' dollar volume over their sales, and the typical community median weights each community's median by its sales.`;
}

// ---- 2. quarter by quarter ------------------------------------------------------------------------
function panel(title, body, caption) {
  return `<figure class="panel"><h3 class="sub-h">${title}</h3>${body}<figcaption>${caption}</figcaption></figure>`;
}
function renderQuarters() {
  const A = P.city;
  const meds = Q.map((_, k) => C.map((c) => c.med[k]).filter((v) => v != null).sort((a, b) => a - b));
  const pct = (p) => meds.map((s) => quantile(s, p));
  $("panels").innerHTML = [
    panel("Homes sold", chart({ labels: Q, fmt: (v) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : fmtN(v)),
      bars: [{ name: "Sales", color: LIGHT, values: A.all.sales }] }), `All home types, by quarter, ${Q[0]} to ${Q[LAST]}.`),
    panel("Average sale price", chart({ labels: Q, fmt: fmtK, zero: false,
      lines: [{ name: "City", color: DARK, values: A.all.avg }, { name: "West", color: MID, values: A.West.avg, dash: true },
        { name: "Central", color: ORANGE, values: A.Central.avg, dash: true }, { name: "East", color: GREY, values: A.East.avg, dash: true }] })
      + key([["City", DARK, "line"], ["West", MID, "line"], ["Central", ORANGE, "line"], ["East", GREY, "line"]]),
    "TRREB's three Toronto regions: dollar volume over sales, as published (not adjusted for inflation)."),
    panel("Median sale price across the communities", chart({ labels: Q, fmt: fmtK, zero: false,
      lines: [{ name: "90th percentile", color: MID, values: pct(0.9), dash: true }, { name: "Median community", color: DARK, values: pct(0.5) },
        { name: "10th percentile", color: MID, values: pct(0.1), dash: true }] })
      + key([["Median community", DARK, "line"], ["10th and 90th percentiles", MID, "line"]]),
    "Each quarter's community medians, as TRREB publishes them (none where a community had two sales or fewer)."),
  ].join("");
}

// ---- 3. the map ---------------------------------------------------------------------------------------
const markPick = initPick($("nb-map"), $("map-pick"), () => state.nb, (i) => {
  state.nb = i;
  writeHash();
}, undefined, nbhd.map((n) => n.name));
const rankOrder = (vs) => vs.map((v, i) => [v, i]).filter(([v]) => v != null).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
function renderMap() {
  const { vs, nb, base } = values(), order = rankOrder(vs);
  const rank = new Map(order.map((c, k) => [c, k + 1]));
  const s = vs.filter((v) => v != null).sort((a, b) => a - b);
  const b = [1, 2, 3, 4, 5].map((k) => quantile(s, k / 6)).filter((q, k, qs) => k === 0 || q > qs[k - 1]);
  const pal = b.length + 1 === COLORS.length ? COLORS : COLORS.slice(COLORS.length - b.length - 1);
  const cls = (v) => b.filter((e) => v >= e).length;
  const shapes = nbhd.map((n, i) => {
    const v = nb[i];
    const t = `${escapeHTML(n.name)}<br>${v == null ? "No figure" : `<b>${fmtV(v)}</b> · ${ordinal(rank.get(n.c))} of ${order.length} communities`}${commOf(i)}`;
    return `<path d="${n.path}" fill="${v == null ? "url(#nb-hatch)" : pal[cls(v)]}" data-i="${i}" data-tip="${t}"/>`;
  }).join("");
  $("nb-map").innerHTML = `<svg viewBox="0 0 ${P.map.width} ${P.map.height}" role="img" aria-label="${escapeHTML(`Map of the neighbourhoods by ${M[state.m].label.toLowerCase()}`)}">
    <defs><pattern id="nb-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#f0f0ec"/><line x1="0" y1="0" x2="0" y2="8" stroke="#c9c9c3" stroke-width="3"/></pattern></defs>
    <g>${shapes}</g></svg>`;
  const edges = [null, ...b, null];
  const label = (k) => (edges[k] == null ? `under ${fmtV(edges[k + 1])}` : edges[k + 1] == null ? `${fmtV(edges[k])} or more` : `${fmtV(edges[k])} to ${fmtV(edges[k + 1])}`);
  $("map-key").innerHTML = pal.map((c, k) => `<li><span class="key-sq" style="background:${c}"></span>${label(k)}</li>`).join("")
    + (nb.some((v) => v == null) ? `<li><span class="key-sq hatch"></span>No figure</li>` : "");
  $("map-lede").innerHTML = `${describe(base)}, by neighbourhood, in classes of about equal numbers of communities. A neighbourhood split in 2022 shows the figure of the community it was part of. A community with fewer than ${MIN_SALES} sales in the year has no median.`;
  markPick();
}

// ---- 4. highest and lowest -------------------------------------------------------------------------------
function renderRanks() {
  const { vs, base } = values(), order = rankOrder(vs);
  const max = Math.max(...order.map((c) => Math.abs(vs[c])));
  const first = (c) => nbhd.findIndex((n) => n.c === c);
  const row = (c) => {
    const v = vs[c], w = (Math.abs(v) / max) * 100;
    return `<li><span class="rk">${order.indexOf(c) + 1}</span><button type="button" class="nm" data-nb="${first(c)}" title="Find ${escapeHTML(C[c].name)} on the map">${escapeHTML(C[c].name)}</button>
      <span class="barcell" data-tip="${escapeHTML(`${C[c].name}<br><b>${fmtV(v)}</b>`)}"><span class="bar-fill" style="width:${w.toFixed(1)}%${v < 0 ? `;background:${DIVERGING[1]}` : ""}"></span></span>
      <span class="vl">${fmtV(v)}</span><span class="move"></span></li>`;
  };
  $("rank-top").innerHTML = order.slice(0, 10).map(row).join("");
  $("rank-bottom").innerHTML = order.slice(-10).reverse().map(row).join("");
  $("rank-lede").innerHTML = `${describe(base)}: ${order.length} of TRREB's ${C.length} communities${order.length < C.length ? ` (${C.length - order.length} without a figure)` : ""}. Pick a name to find it on the map.`;
}

// ---- 5. what goes with what ------------------------------------------------------------------------------
function renderCorr() {
  const { nb: vs, base } = values();
  const rs = censusMeasures.map((c) => ({ c, v: spearman(vs, census.measures[c].values["2021"]) })).filter((r) => r.v).sort((a, b) => b.v.r - a.v.r);
  if (!state.sx || !censusMeasures.includes(state.sx)) state.sx = [...rs].sort((a, b) => Math.abs(b.v.r) - Math.abs(a.v.r))[0]?.c;
  $("census-list").innerHTML = rs.map(({ c, v: { r } }) => {
    const w = Math.abs(r) * 50;
    return `<li><button type="button" data-x="${c}" class="${state.sx === c ? "pick" : ""}">
      <span class="cl-name">${escapeHTML(CENSUS[c].long)}</span>
      <span class="cl-bar"><span class="cl-zero"></span><span class="cl-fill" style="${r >= 0 ? "left:50%" : `left:${50 - w}%`};width:${w}%;background:${rColor(r)}"></span></span>
      <span class="cl-val">${fmtR(r)}</span></button></li>`;
  }).join("");
  $("corr-lede").innerHTML = `How closely ${describe(base).toLowerCase()} follows each 2021 Census measure across the neighbourhoods (Spearman rank correlation, as on the Census Insights page: 1, the same order; −1, the reverse). Choose one to see its neighbourhoods.`;
  const c = state.sx, xs = census.measures[c].values["2021"];
  const idx = nbhd.map((_, i) => i).filter((i) => xs[i] != null && vs[i] != null);
  const sx = idx.map((i) => xs[i]).sort((a, b) => a - b), sy = idx.map((i) => vs[i]).sort((a, b) => a - b);
  const xa = sx[0], xb = quantile(sx, 0.99), ya = Math.min(0, sy[0]), yb = quantile(sy, 0.98);
  const px = (v) => Math.min(100, Math.max(0, ((v - xa) / (xb - xa || 1)) * 100)), py = (v) => Math.min(100, Math.max(0, ((v - ya) / (yb - ya || 1)) * 100));
  const fx = (v) => (isMoney(c) ? `$${Math.round(v / 1000)}k` : `${Math.round(v)}%`);
  const fxl = (v) => (isMoney(c) ? fmtMoney(v) : `${v.toFixed(1)}%`);
  const q = [0, 0.25, 0.5, 0.75, 1];
  $("scatter").innerHTML = `<div class="sc-y">${describe(base)}</div>
    <div class="sc-box">${q.slice(1, -1).map((f) => `<span class="sc-gx" style="left:${f * 100}%"></span><span class="sc-gy" style="bottom:${f * 100}%"></span>`).join("")}
      ${q.map((f) => `<span class="sc-ytick" style="bottom:${f * 100}%">${fmtV(ya + f * (yb - ya))}${f === 1 && yb < sy.at(-1) ? "+" : ""}</span>`).join("")}
      ${idx.map((i) => `<span class="sc-dot" style="left:${px(xs[i]).toFixed(2)}%;bottom:${py(vs[i]).toFixed(2)}%" data-tip="${escapeHTML(`${nbhd[i].name}<br>${CENSUS[c].short}: <b>${fxl(xs[i])}</b><br>${M[state.m].label}: <b>${fmtV(vs[i])}</b>`)}"></span>`).join("")}</div>
    <div class="sc-xticks">${q.map((f) => `<span style="left:${f * 100}%">${fx(xa + f * (xb - xa))}${f === 1 && xb < sx.at(-1) ? "+" : ""}</span>`).join("")}</div>
    <div class="sc-x">${escapeHTML(CENSUS[c].long)}, 2021 Census</div>`;
  const r = spearman(vs, xs);
  $("scatter-caption").innerHTML = `Spearman <b>${fmtR(r?.r)}</b> across ${idx.length} neighbourhoods. Each dot is a neighbourhood; the axes end at the 99th and 98th percentiles.`;
}
$("census-list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-x]");
  if (!b) return;
  state.sx = b.dataset.x;
  renderCorr();
  writeHash();
  $("scatter-fig").scrollIntoView({ behavior: "smooth", block: "nearest" });
});

// ---- 6. sale prices and the census --------------------------------------------------------------------------
// Each community's standing (its median over the City's typical median) around the census,
// Q1 to Q3 of the census year (Q4 for 2011, the first in the reports), against the change
// in the neighbourhood's census median dwelling value relative to the City's.
function standing(y) {
  const ks = y === 2011 ? Q.map((_, k) => k).filter((k) => qYear(k) === 2011) : Q.map((_, k) => k).filter((k) => qYear(k) === y && qNum(k) <= 3);
  const t = cityTypical(ks);
  return { ks, s: C.map((_, c) => { const f = fig(c, ks); return f.med == null ? null : Math.log(f.med / t); }) };
}
function renderCensusCheck() {
  seg($("cc-span"), [["2011-2016", "2011–16"], ["2016-2021", "2016–21"]], state.span, (k) => set({ span: k }));
  const [a, b] = state.span.split("-");
  const s0 = standing(+a), s1 = standing(+b), V = census.measures.value;
  const ratio = (y) => V.values[y].map((v) => (v == null ? null : Math.log(v / V.city[y])));
  const r0 = ratio(a), r1 = ratio(b);
  const xs = nbhd.map((n) => (s0.s[n.c] == null || s1.s[n.c] == null ? null : (Math.exp(s1.s[n.c] - s0.s[n.c]) - 1) * 100));
  const ys = nbhd.map((_, i) => (r0[i] == null || r1[i] == null ? null : (Math.exp(r1[i] - r0[i]) - 1) * 100));
  const idx = nbhd.map((_, i) => i).filter((i) => xs[i] != null && ys[i] != null);
  const ext = (vs) => { const s = idx.map((i) => vs[i]).sort((p, q) => p - q); return [quantile(s, 0.01), quantile(s, 0.99)]; };
  const [xa, xb] = ext(xs), [ya, yb] = ext(ys);
  const clip = (v) => Math.min(100, Math.max(0, v));
  const px = (v) => clip(((v - xa) / (xb - xa)) * 100), py = (v) => clip(((v - ya) / (yb - ya)) * 100);
  const q = [0, 0.25, 0.5, 0.75, 1];
  const dots = idx.map((i) => `<span class="sc-dot" style="left:${px(xs[i]).toFixed(2)}%;bottom:${py(ys[i]).toFixed(2)}%" data-tip="${escapeHTML(`${nbhd[i].name}<br>Sale price against the City's, ${a}–${b}: <b>${fmtSPct(xs[i])}</b><br>Census value against the City's: <b>${fmtSPct(ys[i])}</b>${commOf(i)}`)}"></span>`).join("");
  $("cc-scatter").innerHTML = `<div class="sc-y">Census median dwelling value against the City's, change ${a}–${b}</div>
    <div class="sc-box">${q.slice(1, -1).map((f) => `<span class="sc-gx" style="left:${f * 100}%"></span><span class="sc-gy" style="bottom:${f * 100}%"></span>`).join("")}
      ${q.map((f) => `<span class="sc-ytick" style="bottom:${f * 100}%">${fmtSPct(ya + f * (yb - ya))}</span>`).join("")}${dots}</div>
    <div class="sc-xticks">${q.map((f) => `<span style="left:${f * 100}%">${fmtSPct(xa + f * (xb - xa))}</span>`).join("")}</div>
    <div class="sc-x">TRREB median sale price against the City's typical median, change ${Q[s0.ks[0]]}${s0.ks.length > 1 ? `–Q${qNum(s0.ks.at(-1))}` : ""} to ${Q[s1.ks[0]]}–Q${qNum(s1.ks.at(-1))}</div>`;
  const r = spearman(xs, ys);
  $("cc-lede").innerHTML = `Each neighbourhood's change in TRREB's median sale price relative to the City's, around the census (Q1 to Q3 of the census year; Q4 for 2011, the first quarter in the reports), against its change in the census median value of owned dwellings relative to the City's. ${a}–${b}: Spearman <b>${fmtR(r?.r)}</b> across ${idx.length} neighbourhoods. The axes end at the 1st and 99th percentiles.`;
}

$("method-note").textContent = `Community figures for a year pool its quarters: sales add, and the median is the quarterly medians weighted by their sales (on a log scale); `
  + `a community with fewer than ${MIN_SALES} sales in the year has none. Changes compare the same quarters. The City's typical median weights each community's median by its sales. `
  + "Per-household rates divide by the private households at the census nearest the year (2011 to 2013, 2016 to 2018, then 2021). Map classes are sixths of the communities.";

function render() {
  controls();
  renderMap();
  renderRanks();
  renderCorr();
  renderCensusCheck();
  writeHash();
}
renderCards();
renderQuarters();
render();
buildToc();
