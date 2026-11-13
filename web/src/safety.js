// The Safety Insights page: police-reported crime, shootings, homicides and road
// injuries by year and by neighbourhood, from safety.json (pipeline/safety_insights.py),
// with the neighbourhood outlines and 2021 Census figures from insights.json. No map
// tiles: the map is the neighbourhoods' SVG outlines, as on the other Insights pages.
import "./style.css";
import { $, COLORS, MEASURES as CENSUS, escapeHTML, isMoney, ordinal, sign } from "./catalogue.js";
import { cellStyle, chart, fmtR, initPick, initTip, key, rColor, seg, spark, spearman } from "./charts.js";
import { addressFinder } from "./addressfinder.js";
import { BI, INCOME as INCOMES, biKey, breaks, buildToc, cls, fillFinder, incomeFifths, rangeLabels, rankOrder, scatter as nbScatter } from "./nbtools.js";

const [D, census] = await Promise.all([
  fetch(`/safety.json?v=${__SAFETY_VERSION__}`).then((r) => r.json()),
  fetch(`/insights.json?v=${__INSIGHTS_VERSION__}`).then((r) => r.json()),
]);
const nbhd = census.nbhd, N = nbhd.length, LAST = D.last, INK = "#1a1a19";
// Crime is drawn in a red ramp so it never reads as income (blue).
const REDS = ["#fbe3df", "#f5b8ae", "#ea8a7d", "#d75e52", "#b03a32", "#74201c"];
const ORANGE = "#c2410c", GREY = "#9a9a93";
const CAT = Object.fromEntries(D.categories.map((c) => [c.key, c]));
const censusMeasures = Object.keys(CENSUS).filter((m) => census.measures[m]?.values["2021"]);
const OTHER = Object.fromEntries(D.other.map((o) => [o.key, o]));
const INCOME = INCOMES.filter((m) => census.measures[m]);
const sum = (vs) => vs.reduce((a, v) => a + (v ?? 0), 0);
const fmtN = (v) => (v == null ? "—" : Math.round(v).toLocaleString("en-CA"));
const fmtRate = (v) => (v == null ? "—" : v === 0 ? "0" : v >= 100 ? fmtN(v) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
const fmtMoney = (v) => (v == null ? "—" : `$${Math.round(v).toLocaleString("en-CA")}`);
const fmtChange = (a, b) => (a == null || b == null || !a ? "—" : `${sign(+((b / a - 1) * 100).toFixed(0))}${Math.abs((b / a - 1) * 100).toFixed(0)}%`);
// a category's name inside a sentence
const lcName = (c) => CAT[c].label[0].toLowerCase() + CAT[c].label.slice(1);
const years = (c) => Object.keys(D.counts[c]).map(Number);

// ---- periods and values ---------------------------------------------------------------
const WINDOWS = [[2006, 2010], [2011, 2015], [2016, 2020], [2021, 2025]];
function periods(c) {
  const ys = years(c);
  const ws = WINDOWS.filter(([a, b]) => ys.includes(a) && ys.includes(b)).map(([a, b]) => [`${a}-${b}`, `${a}–${String(b).slice(2)}`]);
  return [...ws, [String(LAST), String(LAST)]];
}
const span = (p) => {
  const [a, b = a] = p.split("-").map(Number);
  return [a, b];
};
// Each neighbourhood's count over the period, or its yearly rate per 100,000 residents of 2021.
function values(c = state.m, p = state.p, rate = state.rate) {
  const [a, b] = span(p), n = b - a + 1;
  const vs = nbhd.map((_, i) => {
    let s = 0;
    for (let y = a; y <= b; y++) s += D.counts[c][y][i];
    return s;
  });
  return rate ? vs.map((v, i) => (v / n / D.pop[i]) * 1e5) : vs;
}
// The pooled rate of a set of neighbourhoods: their counts over their population.
function pooled(c, p, idx) {
  const [a, b] = span(p), n = b - a + 1;
  let s = 0;
  for (let y = a; y <= b; y++) for (const i of idx) s += D.counts[c][y][i];
  return (s / n / sum(idx.map((i) => D.pop[i]))) * 1e5;
}
const income = (m = state.inc) => census.measures[m].values["2021"];
// Higher is better off, except for the low-income rate.
const incomeUp = (m = state.inc) => m !== "lim_at";
const fmtInc = (v, m = state.inc) => (v == null ? "—" : isMoney(m) ? fmtMoney(v) : `${v.toFixed(1)}%`);

// ---- state, kept in the address -------------------------------------------------------
const hash = new URLSearchParams(location.hash.slice(1));
const nbIndex = (id) => {
  const k = nbhd.findIndex((n) => String(n.id) === id);
  return k < 0 ? null : k;
};
const state = {
  m: CAT[hash.get("m")] ? hash.get("m") : "assault",
  p: hash.get("p"),
  rate: hash.get("r") !== "0",
  ov: ["crime", "both", "income"].includes(hash.get("ov")) ? hash.get("ov") : "both",
  inc: INCOME.includes(hash.get("inc")) ? hash.get("inc") : "med_hh_tot",
  sx: hash.get("sx"),
  nb: nbIndex(hash.get("nb")),
};
const fixPeriod = () => {
  const ps = periods(state.m).map(([k]) => k);
  if (!ps.includes(state.p)) state.p = ps.at(-2) ?? ps.at(-1);
};
fixPeriod();
const writeHash = () => {
  const h = new URLSearchParams({ m: state.m, p: state.p, r: state.rate ? "1" : "0", ov: state.ov, inc: state.inc });
  if (state.sx) h.set("sx", state.sx);
  if (state.nb != null) h.set("nb", nbhd[state.nb].id);
  history.replaceState(null, "", `#${h}`);
};
const periodLabel = (p = state.p) => periods(state.m).find(([k]) => k === p)?.[1] ?? p;
const unitText = () => (state.rate ? `per 100,000 residents a year` : `${CAT[state.m].unit}${span(state.p)[0] !== span(state.p)[1] ? ", total over the period" : ""}`);
const describe = () => `${escapeHTML(CAT[state.m].label)}, ${periodLabel()}, ${unitText()}`;
const fmtV = (v) => (state.rate ? fmtRate(v) : fmtN(v));

initTip();

// ---- controls ---------------------------------------------------------------------------
const select = $("measure");
const groups = [...new Set(D.categories.map((c) => c.group))];
select.innerHTML = groups.map((g) => `<optgroup label="${g}">${D.categories.filter((c) => c.group === g).map((c) => `<option value="${c.key}">${escapeHTML(c.label)}</option>`).join("")}</optgroup>`).join("");
select.addEventListener("change", () => set({ m: select.value }));
$("rate").addEventListener("change", (e) => set({ rate: e.target.checked }));
$("income").innerHTML = INCOME.map((m) => `<option value="${m}">${escapeHTML(CENSUS[m].long)}, 2021</option>`).join("");
$("income").addEventListener("change", (e) => set({ inc: e.target.value }));
function controls() {
  select.value = state.m;
  seg($("period"), periods(state.m), state.p, (p) => set({ p }));
  $("rate").checked = state.rate;
  seg($("overlay"), [["crime", "Crime"], ["both", "Crime and income"], ["income", "Income"]], state.ov, (ov) => set({ ov }));
  $("income").value = state.inc;
  $("income").hidden = state.ov === "crime";
}
function set(changes) {
  Object.assign(state, changes);
  if ("m" in changes) {
    fixPeriod();
  }
  render();
}

// ---- 1. the city at a glance -------------------------------------------------------------
const cityYears = (c) => years(c).map((y) => sum(D.counts[c][y]));
function card(c) {
  const ys = years(c), vs = cityYears(c), v = vs.at(-1), prev = vs.at(-2);
  const ksi = c.startsWith("ksi");
  return `<div class="card static" aria-label="${escapeHTML(`${CAT[c].label}, ${LAST}: ${fmtN(v)}`)}">
    <span class="card-name">${escapeHTML(CAT[c].short)}</span><span class="card-value">${fmtN(v)}</span>${spark(vs, ys)}
    <span class="card-years"><span>${ys[0]}</span><span>${LAST}</span></span>
    <span class="card-delta">${fmtChange(prev, v)} from ${LAST - 1}${ksi ? "; latest year still filling in" : ""}</span></div>`;
}
function renderCards() {
  $("cards").innerHTML = ["assault", "break_and_enter", "auto_theft", "robbery", "theft_over", "shootings", "homicides", "ksi_persons"].map(card).join("");
  $("glance-lede").innerHTML = `The City of Toronto in ${LAST}, the last complete year. Crimes are counted by the year they were reported, one per offence or victim, as the police's own neighbourhood figures count them; shootings, homicides and collisions by the year they happened. The police's neighbourhood crime file holds five categories: assault, break and enter, auto theft, robbery and theft over $5,000. Sexual assault is not in it, nor is anything outside those five, such as theft under $5,000, fraud, mischief or drug offences.`;
}

// ---- 2. year by year -------------------------------------------------------------------------
function panel(title, body, caption) {
  return `<figure class="panel"><h3 class="sub-h">${title}</h3>${body}<figcaption>${caption}</figcaption></figure>`;
}
function renderYears() {
  const crimes = ["assault", "break_and_enter", "auto_theft", "robbery", "theft_over"];
  const cy = years("assault").map(String), cols = [COLORS[5], COLORS[3], ORANGE, COLORS[1], GREY];
  const gy = years("shootings").map(String), at = (c) => gy.map((y) => (D.counts[c][y] ? sum(D.counts[c][y]) : null));
  const ky = years("ksi_persons").map(String), k = (c) => ky.map((y) => sum(D.counts[c][y]));
  const ped = k("ksi_persons_pedestrian"), cyc = k("ksi_persons_cyclist"), all = k("ksi_persons");
  const fk = (v) => (Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(1)}k` : fmtN(v));
  $("panels").innerHTML = [
    panel("Crimes reported", chart({
      labels: cy, fmt: fk,
      bars: crimes.map((c, j) => ({ name: CAT[c].short, color: cols[j], values: cy.map((y) => sum(D.counts[c][y])) })),
    }) + key(crimes.map((c, j) => [CAT[c].short, cols[j]])), "By year reported, in the 158 neighbourhoods."),
    panel("Shootings and homicides", chart({
      labels: gy, fmt: fk,
      lines: [{ name: CAT.shootings_all.short, color: GREY, values: at("shootings_all"), dash: true },
        { name: CAT.shootings.short, color: ORANGE, values: at("shootings") }, { name: CAT.homicides.short, color: COLORS[5], values: at("homicides") }],
    }) + key([[CAT.shootings_all.short, GREY, "line"], [CAT.shootings.short, ORANGE, "line"], ["Homicide victims", COLORS[5], "line"]]),
    `By year of occurrence. ${escapeHTML(CAT.shootings_all.note)}`),
    panel("People killed or seriously injured on the roads", chart({
      labels: ky, fmt: fk,
      bars: [{ name: "Pedestrians", color: COLORS[5], values: ped }, { name: "Cyclists", color: ORANGE, values: cyc },
        { name: "Drivers, passengers, motorcyclists and others", color: COLORS[1], values: all.map((v, j) => v - ped[j] - cyc[j]) }],
      lines: [{ name: "Killed", color: INK, values: k("ksi_killed") }],
    }) + key([["Pedestrians", COLORS[5]], ["Cyclists", ORANGE], ["Others", COLORS[1]], ["Of whom killed", INK, "line"]]),
    `By year of the collision. ${escapeHTML(CAT.ksi_persons.note)}`),
  ].join("");
}

// ---- 3. the map: crime, income, or both ---------------------------------------------------------
// a pick redraws the page, so the scatters mark it too
const markPick = initPick($("nb-map"), $("map-pick"), () => state.nb, (i) => {
  state.nb = i;
  render();
});
fillFinder($("find-nb"), nbhd.map((n) => n.name));
$("find-nb").addEventListener("change", (e) => {
  state.nb = e.target.value === "" ? null : +e.target.value;
  render();
});
addressFinder($("addr-find"), {
  nbhd,
  onPick: (i) => { const s = $("find-nb"); s.value = i; s.dispatchEvent(new Event("change")); },
});
function renderMap() {
  const vs = values(), inc = income(), order = rankOrder(vs);
  const rank = new Map(order.map((i, k) => [i, k + 1]));
  const crime6 = breaks(vs), inc6 = breaks(inc);
  const crime3 = breaks(vs, 3), inc3 = breaks(inc, 3);
  const reds = REDS.slice(REDS.length - crime6.edges.length - 1), blues = COLORS.slice(COLORS.length - inc6.edges.length - 1);
  const biCell = (i) => {
    let ic = cls(inc3.edges, inc[i]);
    if (!incomeUp()) ic = 2 - ic; // the low-income rate runs the other way
    return BI[ic][cls(crime3.edges, vs[i])];
  };
  const fill = (i) => {
    if (state.ov === "income") return inc[i] == null ? "url(#nb-hatch)" : blues[cls(inc6.edges, inc[i])];
    if (state.ov === "both") return inc[i] == null ? "url(#nb-hatch)" : biCell(i);
    return reds[cls(crime6.edges, vs[i])];
  };
  const shapes = nbhd.map((n, i) => {
    const t = `${escapeHTML(n.name)}<br>${escapeHTML(CAT[state.m].short)}: <b>${fmtV(vs[i])}</b> · ${ordinal(rank.get(i))} of ${N}<br>${escapeHTML(CENSUS[state.inc].short)}: <b>${fmtInc(inc[i])}</b>`;
    return `<path d="${n.path}" fill="${fill(i)}" data-i="${i}" data-tip="${t}"/>`;
  }).join("");
  $("nb-map").innerHTML = `<svg viewBox="0 0 ${census.map.width} ${census.map.height}" role="img" aria-label="${escapeHTML(`Map of the neighbourhoods by ${CAT[state.m].label.toLowerCase()}${state.ov === "crime" ? "" : " and income"}`)}">
    <defs><pattern id="nb-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#f0f0ec"/><line x1="0" y1="0" x2="0" y2="8" stroke="#c9c9c3" stroke-width="3"/></pattern></defs>
    <g>${shapes}</g></svg>`;
  const incName = CENSUS[state.inc].long.toLowerCase().replace("lim-at", "LIM-AT");
  const fi = (v) => (isMoney(state.inc) ? `$${Math.round(v / 1000)}k` : `${v.toFixed(1)}%`);
  if (state.ov === "both") {
    $("map-key").innerHTML = "";
    const ci = rangeLabels(crime3.edges, crime3.zero, fmtV), ii = rangeLabels(inc3.edges, inc3.zero, fi);
    $("bi-key").hidden = false;
    $("bi-key").innerHTML = biKey({ xName: `${CAT[state.m].short}, ${periodLabel()}, ${unitText()}`, xRanges: ci, xArrow: "More crime →",
      yName: `${CENSUS[state.inc].long}, 2021`, yRanges: incomeUp() ? ii : [...ii].reverse(), yArrow: incomeUp() ? "Higher income ↑" : "Less low income ↑" });
    $("map-lede").innerHTML = `${describe()}, against ${escapeHTML(incName)} in 2021: each in thirds of the neighbourhoods. Red is more crime with lower income, teal higher income with less crime, and the darkest corner both high. Hover or tap for figures.`;
  } else {
    $("bi-key").hidden = true;
    const [b, colours, f] = state.ov === "income" ? [inc6, blues, fi] : [crime6, reds, fmtV];
    $("map-key").innerHTML = rangeLabels(b.edges, b.zero, f).map((l, k) => `<li><span class="key-sq" style="background:${colours[k]}"></span>${escapeHTML(l)}</li>`).join("")
      + (state.ov === "income" && inc.some((v) => v == null) ? `<li><span class="key-sq hatch"></span>No figure</li>` : "");
    $("map-lede").innerHTML = state.ov === "income"
      ? `${escapeHTML(CENSUS[state.inc].long)}, 2021 Census, in sixths of the neighbourhoods. Hover or tap for the crime figure too.`
      : `${describe()}, in classes of about equal numbers of neighbourhoods${crime6.zero ? ", with those that had none in a class of their own" : ""}. Rates are per resident, so places many people visit but few live in (downtown, the entertainment district, around Yorkdale) rank high.`;
  }
  markPick();
}

// ---- 4. by neighbourhood income ---------------------------------------------------------------------
// The neighbourhoods in fifths by the chosen income measure (about 32 each), and each category's
// pooled rate in each fifth over its latest five years.
function renderIncome() {
  const inc = income(), { idx, fifths } = incomeFifths(inc, incomeUp());
  const range = (g) => {
    const v = g.map((i) => inc[i]).sort((a, b) => a - b);
    return `${fmtInc(v[0])}–${fmtInc(v.at(-1))}`;
  };
  const latest = (c) => periods(c).at(-2)[0];
  const rows = D.categories.map((c) => {
    const p = latest(c.key), rs = fifths.map((g) => pooled(c.key, p, g)), city = pooled(c.key, p, idx);
    const lo = Math.min(...rs), hi = Math.max(...rs), ratio = rs[4] ? rs[0] / rs[4] : null;
    const cells = rs.map((r, q) => {
      const t = hi > lo ? (r - lo) / (hi - lo) : 0, c5 = Math.min(5, Math.floor(t * 6));
      return `<td style="${cellStyle(REDS[c5])}" data-tip="${escapeHTML(`${c.short}, ${periodLabel(p)}<br>${["Lowest", "Second", "Middle", "Fourth", "Highest"][q]} income fifth: <b>${fmtRate(r)}</b> per 100,000 a year`)}">${fmtRate(r)}</td>`;
    }).join("");
    return `<tr${c.key === state.m ? ' class="sel"' : ""}><th>${escapeHTML(c.short)}</th><td class="txt small hide-sm">${periodLabel(p)}</td>${cells}<td>${fmtRate(city)}</td><td><b>${ratio == null ? "—" : `${ratio.toFixed(1)}×`}</b></td></tr>`;
  }).join("");
  const head = ["Lowest", "Second", "Middle", "Fourth", "Highest"].map((n, q) => `<th>${n}<br><span class="small">${range(fifths[q])}</span></th>`).join("");
  $("inc-table").innerHTML = `<thead><tr><th>Category</th><th class="txt hide-sm">Years</th>${head}<th>City</th><th>Lowest ÷ highest</th></tr></thead><tbody>${rows}</tbody>`;
  const r = $("inc-table").querySelector("tr.sel td:last-child")?.textContent;
  $("inc-lede").innerHTML = `The neighbourhoods in fifths by ${escapeHTML(CENSUS[state.inc].long.toLowerCase().replace("lim-at", "LIM-AT"))} (2021 Census${incomeUp() ? "" : "; the lowest-income fifth has the highest rate"}), about 31 each, and every category's rate in each fifth: its count over its residents, per 100,000 a year over the latest five years. For ${escapeHTML(lcName(state.m))}, the lowest-income fifth's rate is <b>${r}</b> the highest-income fifth's.`;
  $("inc-note").textContent = "Shading runs along each row, from the fifth with the lowest rate to the highest. Rates are per resident: a fifth that holds downtown counts visitors' and workers' incidents against a small population.";
}

// ---- 5. highest and lowest ------------------------------------------------------------------------
function renderRanks() {
  const vs = values(), order = rankOrder(vs), inc = income(), max = Math.max(...vs);
  const row = (i, k) => `<li><span class="rk">${k}</span><button type="button" class="nm" data-nb="${i}" title="Find ${escapeHTML(nbhd[i].name)} on the map">${escapeHTML(nbhd[i].name)}</button>
      <span class="barcell" data-tip="${escapeHTML(`${nbhd[i].name}<br><b>${fmtV(vs[i])}</b><br>${CENSUS[state.inc].short}: ${fmtInc(inc[i])}`)}"><span class="bar-fill" style="width:${max ? ((vs[i] / max) * 100).toFixed(1) : 0}%;background:${REDS[4]}"></span></span>
      <span class="vl">${fmtV(vs[i])}</span><span class="move"></span></li>`;
  $("rank-top").innerHTML = order.slice(0, 10).map((i, k) => row(i, k + 1)).join("");
  $("rank-bottom").innerHTML = order.slice(-10).reverse().map((i, k) => row(i, N - k)).join("");
  const zeros = vs.filter((v) => v === 0).length;
  $("rank-lede").innerHTML = `${describe()}.${zeros ? ` ${zeros} neighbourhoods had none.` : ""} Pick a name to find it on the map.`;
}

// ---- 6. then and now ---------------------------------------------------------------------------------
function renderChange() {
  const ws = periods(state.m).slice(0, -1);
  if (ws.length < 2) {
    $("chg-scatter").innerHTML = "";
    $("chg-lede").textContent = "This category has only one complete five-year period.";
    return;
  }
  const [p0, p1] = [ws.at(-2)[0], ws.at(-1)[0]];
  const a = values(state.m, p0, true), b = values(state.m, p1, true);
  const all = nbhd.map((_, i) => i), c0 = pooled(state.m, p0, all), c1 = pooled(state.m, p1, all);
  const up = all.filter((i) => b[i] > a[i]).length, down = all.filter((i) => b[i] < a[i]).length;
  const s = nbScatter({ pick: state.nb, xs: a, ys: b, diag: true, fx: fmtRate, fy: fmtRate,
    xLabel: `${escapeHTML(CAT[state.m].short)} per 100,000 a year, ${periodLabel(p0)}`, yLabel: `${periodLabel(p1)}`,
    tip: (i) => `${nbhd[i].name}<br>${periodLabel(p0)}: <b>${fmtRate(a[i])}</b><br>${periodLabel(p1)}: <b>${fmtRate(b[i])}</b>` });
  $("chg-scatter").innerHTML = s.html;
  const rho = spearman(a, b);
  $("chg-lede").innerHTML = `Each neighbourhood's ${escapeHTML(lcName(state.m))} per 100,000 residents a year in ${periodLabel(p0)} and ${periodLabel(p1)}: above the dashed line, it rose (${up} neighbourhoods); below, it fell (${down}). The city's rate went from ${fmtRate(c0)} to ${fmtRate(c1)} (${fmtChange(c0, c1)}). The two periods' order agrees at Spearman <b>${fmtR(rho?.r)}</b>: ${rho?.r > 0.8 ? "where it is high mostly stays high" : rho?.r > 0.5 ? "a fairly stable pattern" : "a pattern that shifts a good deal, partly from small numbers"}.`;
}

// ---- 7. what goes with what ------------------------------------------------------------------------
const corrX = (k) => {
  const [t, m] = k.split(":");
  return t === "c" ? { label: CENSUS[m].long, short: CENSUS[m].short, values: census.measures[m].values["2021"], unit: isMoney(m) ? "money" : "pct", year: "2021 Census" }
    : { label: OTHER[m].label, short: OTHER[m].short, values: OTHER[m].values, unit: OTHER[m].unit };
};
const fmtU = (u, v, short) => (v == null ? "—" : u === "money" ? (short ? `$${Math.round(v / 1000)}k` : fmtMoney(v)) : u === "pct" ? `${v.toFixed(short ? 0 : 1)}%`
  : u === "degC" ? `${sign(+v.toFixed(1))}${Math.abs(v).toFixed(1)}°C` : u === "score" ? v.toFixed(short ? 0 : 1) : v.toFixed(short ? 0 : 1));
function corrItem(k, v) {
  const r = v.r, w = Math.abs(r) * 50, x = corrX(k);
  return `<li><button type="button" data-x="${k}" class="${state.sx === k ? "pick" : ""}">
      <span class="cl-name">${escapeHTML(x.label)}</span>
      <span class="cl-bar"><span class="cl-zero"></span><span class="cl-fill" style="${r >= 0 ? "left:50%" : `left:${50 - w}%`};width:${w}%;background:${rColor(r)}"></span></span>
      <span class="cl-val">${fmtR(r)}</span></button></li>`;
}
function renderCorr() {
  const vs = values(state.m, state.p, true);
  const rc = censusMeasures.map((m) => ({ k: `c:${m}`, v: spearman(vs, census.measures[m].values["2021"]) })).filter((r) => r.v).sort((a, b) => b.v.r - a.v.r);
  const ro = D.other.map((o) => ({ k: `o:${o.key}`, v: spearman(vs, o.values) })).filter((r) => r.v).sort((a, b) => b.v.r - a.v.r);
  const keys = [...rc, ...ro].map((r) => r.k);
  if (!keys.includes(state.sx)) state.sx = `c:${state.inc}`;
  $("census-list").innerHTML = rc.map(({ k, v }) => corrItem(k, v)).join("");
  $("other-list").innerHTML = ro.map(({ k, v }) => corrItem(k, v)).join("");
  $("corr-lede").innerHTML = `How closely ${escapeHTML(lcName(state.m))} per 100,000 residents (${periodLabel()}) follows each measure across the neighbourhoods: Spearman rank correlation, 1 the same order, −1 the reverse. Correlation across neighbourhoods says nothing about individual people, and much of it runs through what the measures share (density, renting, downtown). Choose a measure to see its neighbourhoods.`;
  const x = corrX(state.sx);
  const s = nbScatter({ pick: state.nb, xs: x.values, ys: vs, zeroX: false, fx: (v) => fmtU(x.unit, v, true), fy: fmtRate,
    xLabel: `${escapeHTML(x.label)}${x.year ? `, ${x.year}` : ""}`, yLabel: `${escapeHTML(CAT[state.m].short)} per 100,000 a year, ${periodLabel()}`,
    tip: (i) => `${nbhd[i].name}<br>${x.short}: <b>${fmtU(x.unit, x.values[i])}</b><br>${CAT[state.m].short}: <b>${fmtRate(vs[i])}</b>` });
  $("scatter").innerHTML = s.html;
  const r = spearman(vs, x.values);
  $("scatter-caption").innerHTML = `Spearman <b>${fmtR(r?.r)}</b> across ${s.n} neighbourhoods. Each dot is a neighbourhood; the axes end at the 98th percentile.`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-x]");
  if (!b) return;
  state.sx = b.dataset.x;
  renderCorr();
  writeHash();
  $("scatter-fig").scrollIntoView({ behavior: "smooth", block: "nearest" });
});

// ---- 8. the categories against each other -----------------------------------------------------------
function renderMatrix() {
  const cats = D.categories.map((c) => c.key);
  const v = Object.fromEntries(cats.map((c) => [c, values(c, periods(c).at(-2)[0], true)]));
  const head = cats.map((c) => `<th class="rot"><span>${escapeHTML(CAT[c].short)}</span></th>`).join("");
  const rows = cats.map((a) => `<tr${a === state.m ? ' class="sel"' : ""}><th>${escapeHTML(CAT[a].short)}</th>${cats.map((b) => {
    if (a === b) return `<td class="none">·</td>`;
    const r = spearman(v[a], v[b])?.r;
    return `<td style="${cellStyle(rColor(r))}" data-tip="${escapeHTML(`${CAT[a].short} and ${CAT[b].short}: Spearman <b>${fmtR(r)}</b>`)}">${fmtR(r)}</td>`;
  }).join("")}</tr>`).join("");
  $("matrix").innerHTML = `<thead><tr><th><span class="visually-hidden">Category</span></th>${head}</tr></thead><tbody>${rows}</tbody>`;
  // the closest pair of different kinds, and the category that goes least with the rest
  const kinds = (c) => (c.startsWith("ksi") ? "road" : c.startsWith("shoot") || c === "homicides" ? "gun" : "crime");
  const pairs = cats.flatMap((a, j) => cats.slice(j + 1).map((b) => [a, b, spearman(v[a], v[b])?.r ?? 0]));
  // pairs where one counts the other's events (shootings within shootings and discharges,
  // pedestrians within all road injuries) are left out
  const nested = (a, b) => kinds(a) === kinds(b) && kinds(a) !== "crime" && !(a === "homicides" || b === "homicides");
  const best = pairs.filter(([a, b]) => !nested(a, b)).sort((x, y) => y[2] - x[2])[0];
  const mean = (c) => sum(pairs.filter(([a, b]) => a === c || b === c).map((p) => p[2])) / (cats.length - 1);
  const loner = [...cats].sort((a, b) => mean(a) - mean(b))[0];
  $("mx-lede").innerHTML = `How each pair of categories' rates per 100,000 (latest five years) line up across the neighbourhoods (Spearman). The closest pair is ${escapeHTML(lcName(best[0]))} and ${escapeHTML(lcName(best[1]))} (<b>${fmtR(best[2])}</b>); ${escapeHTML(lcName(loner))} go least with the rest (average <b>${fmtR(mean(loner))}</b>), following a geography of their own.`;
}

$("method-note").textContent = `Built ${D.built} from files retrieved ${D.retrieved}. Counts are the police's own neighbourhood assignment (records without one are left out); `
  + "rates divide by the 2021 Census population of each neighbourhood for every period. Map classes are sixths (thirds when crossed with income) of the neighbourhoods. "
  + "Correlations are Spearman's, on rates per 100,000.";

function render() {
  controls();
  renderMap();
  renderIncome();
  renderRanks();
  renderChange();
  renderCorr();
  renderMatrix();
  $("find-nb").value = state.nb ?? "";
  writeHash();
}
renderCards();
renderYears();
render();
buildToc($("toc"));
