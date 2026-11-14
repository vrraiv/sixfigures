// The Dwelling Value Forecasts page: each neighbourhood's median value of owned dwellings
// in the 2026 Census, forecast as a ratio to the City's median times a nowcast of the
// City's, with its range, and the backtests (docs/forecast-spec.md), from forecasts.json.
import { quantile, seg } from "./charts.js";
import { $, drawMap, escapeHTML, fmtK, fmtMoney, fmtPts, fmtShare, initTip, load, marksNote, nbFromHash, own, pickBar, rangeList, rungName, scatter, scatterKey, signed } from "./forecasts.js";
import { buildToc } from "./nbtools.js";

const D = await load();
const V = D.value, live = V.live, C = V.city;
const SHOW = { own_mean: "Own mean (chosen)", own_mean_market: "Own mean plus market", persistence: "Persistence" };
const byNb = new Map(live.map((r) => [r.i, r]));
const median = (vs) => quantile([...vs].sort((a, b) => a - b), 0.5);
const pctChange = (a, b) => (b / a - 1) * 100;

const hash = new URLSearchParams(location.hash.slice(1));
const state = { r: own(SHOW, hash.get("r")) ? hash.get("r") : "own_mean", sort: hash.get("s") === "name" ? "name" : "pred", filter: "", nb: nbFromHash(D, hash.get("nb")) };
const writeHash = () => {
  const h = new URLSearchParams({ r: state.r, s: state.sort });
  if (state.nb != null) h.set("nb", D.nbhd[state.nb].id);
  history.replaceState(null, "", `#${h}`);
};

initTip();
const markPick = pickBar(D, () => state.nb, (i) => { state.nb = i; writeHash(); }, () => "");

// ---- the forecast at a glance ----------------------------------------------------------------------------
function renderGlance() {
  const card = (name, v, note) => `<div class="card static"><span class="card-name">${name}</span><span class="card-value">${v}</span><span class="card-delta">${note}</span></div>`;
  const med21 = median(live.map((r) => r.value_2021)), medF = median(live.map((r) => r.own_mean));
  const width = median(live.map((r) => r.high / r.low - 1)) * 100;
  $("cards").innerHTML = [
    card("City median, 2021 Census", fmtMoney(C.census["2021"]), "as published"),
    card("City median, 2026 nowcast", fmtMoney(C.nowcast), `${signed(pctChange(C.census["2021"], C.nowcast))}% from 2021`),
    card("Median neighbourhood, 2021", fmtMoney(med21), "of the 158"),
    card("Median neighbourhood, forecast", fmtMoney(medF), "the chosen forecast, 2026"),
    card("Median range width", `${Math.round(width)}%`, "high over low"),
  ].join("");
  $("glance-lede").innerHTML = `The City's 2026 median is its 2021 Census median (${fmtMoney(C.census["2021"])}) moved by TRREB's May median sale price, `
    + `${fmtMoney(C.trreb_may["2021"].median)} in May 2021 to ${fmtMoney(C.trreb_may["2026"].median)} in May 2026. `
    + `Each neighbourhood's forecast is that times its forecast ratio to the City's median, rounded to the nearest $1,000.`;
  // the three forecasts, in plain words, before the control that switches between them
  const shift = median(live.filter((r) => r.market).map((r) => Math.abs(r.own_mean_market / r.own_mean - 1))) * 100;
  $("rung-defs").innerHTML = `<p>Every forecast starts from a neighbourhood's <b>standing</b>: its median dwelling value as a ratio to the City's median. Three forecasts of that standing in 2026 are shown below, and each neighbourhood's range covers all three.</p>
    <dl><dt>Persistence</dt><dd>The standing it had in the 2021 Census, unchanged.</dd>
    <dt>Own mean (chosen)</dt><dd>Its average standing over the 2011, 2016 and 2021 censuses. A neighbourhood that stood unusually high or low in 2021 is expected to move back toward its usual place. Tested on past censuses, this had the smallest error of the forecasts that use nothing from after the last census, so it is the one chosen.</dd>
    <dt>Own mean plus market</dt><dd>Own mean, adjusted for what homes have sold for since 2021. Where a neighbourhood's sale prices (TRREB's medians) have risen faster than the City's, its forecast is raised; where they have lagged, it is lowered. How far is set by how closely census values followed sale prices between 2011 and 2021.
      It uses sales from after the 2021 Census, so it is a nowcast, not a forecast, and is shown for comparison. For the typical neighbourhood it moves the own-mean figure by about ${shift.toFixed(1)}%.</dd></dl>`;
}

// ---- map and list -------------------------------------------------------------------------------------------
function renderForecast() {
  const k = state.r, vals = D.nbhd.map((_, i) => byNb.get(i)?.[k] ?? null);
  const tip = (i) => {
    const x = byNb.get(i), n = D.nbhd[i].name;
    return `${n}<br>${SHOW[k].replace(" (chosen)", "")}, 2026: <b>${fmtMoney(x[k])}</b><br>Range: ${fmtMoney(x.low)} to ${fmtMoney(x.high)}<br>2021 Census: ${fmtMoney(x.value_2021)}${x.market ? "" : "<br>No market figure"}`;
  };
  drawMap($("nb-map"), $("map-key"), D, vals, fmtK, tip, `Map of the neighbourhoods by forecast median dwelling value, 2026`);
  const lede = {
    own_mean: "Own mean, the forecast the decision rule chose: the mean of the neighbourhood's ratios to the City's median in 2011, 2016 and 2021.",
    own_mean_market: "Own mean plus market: own mean, raised where a neighbourhood's sale prices have risen faster than the City's since 2021 and lowered where they have lagged. In full: own mean plus a slope times the change in the neighbourhood's standing in TRREB's median sale prices, Q1–Q3 2021 to Q1–Q2 2026 (the 2026 window has Q1 and Q2 only), the slope fitted on 2011 to 2016 and 2016 to 2021 pooled. It is a nowcast: it uses sales from after the 2021 Census.",
    persistence: "Persistence: the neighbourhood's 2021 ratio to the City's median.",
  }[k];
  $("map-lede").innerHTML = `${lede} Each forecast's changes from 2021 are centred to average zero over households. Classes hold about equal numbers of neighbourhoods.`;
  markPick();
  renderList();
  $("list-lede").innerHTML = `The bar is the range: from the lowest of the three forecasts (persistence, own mean, own mean plus market) less ${V.city.spread} on the log scale, to the highest plus ${V.city.spread}. `
    + `The dot is the forecast chosen above; the tick is the 2021 Census median. The bars are on a log scale. Pick a name to find it on the map.`;
  $("list-key").innerHTML = `<li><span class="fc-key-range"></span>Range</li><li><span class="key-dot" style="background:var(--ink)"></span>Forecast</li><li><span class="key-line"></span>2021 Census</li>`;
}
function renderList() {
  rangeList($("list"), D, live.map((x) => ({ i: x.i, pred: x[state.r], low: x.low, high: x.high, from: x.value_2021, note: x.market ? "" : "No market figure" })),
    { fmt: fmtMoney, sort: state.sort, filter: state.filter, fromLabel: "2021 Census", predLabel: `${SHOW[state.r].replace(" (chosen)", "")}, 2026`, log: true });
}
$("list-filter").addEventListener("input", (e) => { state.filter = e.target.value; renderList(); });

// ---- how the forecasts did ------------------------------------------------------------------------------------
function renderScores() {
  const kinds = [["forecast", "Forecasts: only what was known at the origin"], ["nowcast", "Nowcasts: sale prices during the period"], ["oracle", "Conditional: outcomes during the period, never chosen"]];
  const cell = (v) => (v == null ? `<td class="none">—</td>` : `<td>${fmtPts(v)}</td>`);
  const body = kinds.map(([kind, label]) => {
    const rows = V.scores.filter((x) => D.rungs[x.rung].kind === kind);
    return `<tr><th colspan="6" class="fc-group">${label}</th></tr>` + rows.map((x) => `<tr${x.rung === D.chosen.value ? ' class="sel"' : ""}><th>${rungName(D, x.rung)}${x.rung === D.chosen.value ? " (chosen)" : ""}</th>`
      + `${cell(x.forward)}<td class="none">${x.rung === "persistence" ? "" : `${signed(x.skill * 100, 0)}%`}</td>${cell(x.reverse)}${cell(x.forward_raw)}${cell(x.reverse_raw)}</tr>`).join("");
  }).join("");
  $("scores").innerHTML = `<thead><tr><th>Rung</th><th>Forward<br><span class="none">2016 to 2021</span></th><th>Skill</th><th>Reverse<br><span class="none">2011 to 2016</span></th><th>Forward, raw</th><th>Reverse, raw</th></tr></thead><tbody>${body}</tbody>`;
  $("scores-lede").innerHTML = "Mean absolute error of each neighbourhood's log ratio to the City's median (×100, about a percentage), weighted by households, five years ahead. "
    + "Forward: fitted on 2011 to 2016 and tested on 2016 to 2021. Reverse: fitted on 2016 to 2021 and tested on 2011 to 2016 (own mean and trend need an earlier value, so they are forward only). "
    + "Each rung's predicted changes are centred to average zero over households; raw, before centring. Skill is the reduction in forward error against persistence.";
  $("scores-note").innerHTML = `${marksNote} Centring was adopted on 1 November 2026, after looking.`;
}

// ---- 2016 to 2021 ---------------------------------------------------------------------------------------------
function renderBacktest() {
  const B = V.backtest;
  const rows = B.nbhd.filter((x) => x.actual != null).map((x) => ({ i: x.i, pred: x.own_mean, actual: x.actual, low: x.low, high: x.high }));
  scatter($("back-scatter"), D, rows, { fmt: fmtK, xLabel: "Own mean's forecast for 2021, made at 2016 (log scale)", yLabel: "2021 Census median (log scale)", log: true });
  scatterKey($("back-key"));
  $("back-lede").innerHTML = `The range rule applied at 2016 (own mean plus market with its slope fitted on 2011 to 2016 only), with the City's 2021 median from TRREB's May median, `
    + `${fmtMoney(C.trreb_may["2016"].median)} in 2016 to ${fmtMoney(C.trreb_may["2021"].median)} in 2021: ${fmtMoney(B.city)} against the Census's ${fmtMoney(C.census["2021"])}. `
    + `<b>${fmtShare(B.inside)}</b> of the 158 neighbourhoods (${fmtShare(B.inside_hh)} of households) fell inside the range; ${B.above} above it and ${B.below} below.`;
}

// ---- the City's median ------------------------------------------------------------------------------------------
function renderCity() {
  const T = C.trreb_may, years = ["2011", "2016", "2021", "2026"];
  $("city").innerHTML = `<thead><tr><th>May</th><th>TRREB median sale price</th><th>TRREB average sale price</th><th>Census median value</th></tr></thead><tbody>`
    + years.map((y) => `<tr><th>${y}</th><td>${fmtMoney(T[y].median)}</td><td>${fmtMoney(T[y].average)}</td><td>${C.census[y] ? fmtMoney(C.census[y]) : y === "2026" ? `<span class="none">${fmtMoney(C.nowcast)} (nowcast)</span>` : "—"}</td></tr>`).join("") + "</tbody>";
  const err = (a, b, c0, c1) => (a == null ? null : 100 * (Math.log(b / a) - Math.log(c1 / c0)));
  const row = (label, k) => `<tr><th>${label}</th>${[["2011", "2016"], ["2016", "2021"]].map(([a, b]) => {
    const e = err(T[a][k], T[b][k], C.census[a], C.census[b]);
    return e == null ? `<td class="none">no City median in 2011</td>` : `<td>${signed(pctChange(T[a][k], T[b][k]))}% against ${signed(pctChange(C.census[a], C.census[b]))}% <span class="none">(${signed(e)})</span></td>`;
  }).join("")}</tr>`;
  $("city-scores").innerHTML = `<thead><tr><th>Rule</th><th>2011 to 2016</th><th>2016 to 2021</th></tr></thead><tbody>${row("Median (used)", "median")}${row("Average", "average")}</tbody>`;
  $("city-lede").innerHTML = "TRREB's City of Toronto figures for May, all home types, from its Market Watch reports (2011 pooled over the 36 Toronto districts, which give no City median). "
    + "The rule moves the Census City median by TRREB's change, with nothing fitted; below, each rule's change against the Census's, and in brackets the log error ×100.";
}

$("method-note").innerHTML = "The census median value of owned dwellings is the owners' own estimate. Neighbourhood figures are those on the Census Insights page, built from dissemination areas; ratios are to the City's published median. "
  + "The method, the rungs and the decision rule are on the <a href=\"/forecasts/\">Method</a> page.";

function render() {
  seg($("rung"), Object.entries(SHOW), state.r, (r) => { state.r = r; render(); });
  seg($("list-sort"), [["pred", "By forecast"], ["name", "By name"]], state.sort, (s) => { state.sort = s; render(); });
  renderForecast();
  writeHash();
}
renderGlance();
renderScores();
renderBacktest();
renderCity();
render();
buildToc();
