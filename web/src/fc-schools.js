// The School Forecasts page: each neighbourhood's forecast Grade 3 and Grade 6 score with
// its range, and the backtests (docs/forecast-spec.md), from forecasts.json.
import { seg } from "./charts.js";
import { $, drawMap, escapeHTML, fmtPct, fmtPts, fmtShare, initTip, load, marksNote, nbFromHash, own, pickBar, rangeList, rungName, scatter, scatterKey, signed } from "./forecasts.js";
import { buildToc } from "./nbtools.js";

const D = await load();
const GRADES = { g3: "Grade 3", g6: "Grade 6" };
const RUNGS = ["persistence", "own_mean", "ridge", "knn", "boost"];
const FOLDS = [
  ["2022-2023", "2022 to 2023", "selection"],
  ["2023-2024", "2023 to 2024", "selection"],
  ["2024-2025", "2024 to 2025", "holdout"],
  ["2025-2026", "2025 to 2026", "the frozen forecast"],
  ["2019-2022", "2019 to 2022", "across the closures"],
];
const schoolYear = (y) => `${y - 1}–${String(y).slice(2)}`;
const dashYear = (s) => s.replace("-", "–");

const hash = new URLSearchParams(location.hash.slice(1));
const state = { g: own(GRADES, hash.get("g")) ? hash.get("g") : "g3", sort: hash.get("s") === "name" ? "name" : "pred", filter: "", nb: nbFromHash(D, hash.get("nb")) };
const writeHash = () => {
  const h = new URLSearchParams({ g: state.g, s: state.sort });
  if (state.nb != null) h.set("nb", D.nbhd[state.nb].id);
  history.replaceState(null, "", `#${h}`);
};
const G = () => D.schools[state.g];

initTip();
const byNb = () => new Map(G().live.nbhd.map((r) => [r.i, r]));
const markPick = pickBar(D, () => state.nb, (i) => { state.nb = i; writeHash(); }, () => "");

// ---- the forecast: map and list ----------------------------------------------------------------------
function renderForecast() {
  const g = G(), L = g.live, m = byNb(), name = GRADES[state.g], r = g.range;
  const vals = D.nbhd.map((_, i) => m.get(i)?.pred ?? null);
  const tip = (i) => {
    const x = m.get(i), n = D.nbhd[i].name;
    return x ? `${n}<br>${name}, ${L.target}: <b>${fmtPct(x.pred)}</b> (${fmtPct(x.low)} to ${fmtPct(x.high)})<br>${L.origin}: ${fmtPct(x.score0)} · ${x.n} school${x.n > 1 ? "s" : ""}`
      : `${n}<br>No school with a ${name} score in ${L.origin}`;
  };
  drawMap($("nb-map"), $("map-key"), D, vals, (v) => `${Math.round(v)}%`, tip, `Map of the neighbourhoods by forecast ${name} score, ${L.target}`);
  $("map-lede").innerHTML = `Each neighbourhood's forecast ${name} score for ${L.target} (the ${schoolYear(L.target)} school year): the share of fully participating students at the provincial standard, as the mean of reading, writing and math, `
    + `averaged over its schools with their ${dashYear(L.enrolment)} enrolment. Ridge regression, fitted on every one-year change up to ${L.origin}, forecasts each school; the City's ${L.origin} level carries over. `
    + `${L.nbhd.length} neighbourhoods have a school with a ${name} score in ${L.origin}; the rest are hatched. Made on 3 November 2026. Classes hold about equal numbers of neighbourhoods.`
    + (L.implied_change == null ? "" : ` Taken together the forecasts sit ${Math.abs(L.implied_change).toFixed(1)} points ${L.implied_change >= 0 ? "above" : "below"} the same schools' ${L.origin} scores: the model forecasts where each school stands, not the City's level, and that small ${L.implied_change >= 0 ? "rise" : "fall"} comes from its arithmetic, not from a view that results will ${L.implied_change >= 0 ? "improve" : "decline"}. Read a neighbourhood's forecast against the others' rather than against its own last score.`);
  markPick();
  renderList();
  $("list-lede").innerHTML = `The bar is the 80% range: the forecast ± ${fmtPts(r.more, 1)} points, or ± ${fmtPts(r.one, 1)} where the neighbourhood has one school `
    + `(the 80th percentile of the neighbourhood errors in the 2022 to 2023 and 2023 to 2024 backtests). The tick is the ${L.origin} figure for the same schools. Pick a name to find it on the map.`;
  $("list-key").innerHTML = `<li><span class="fc-key-range"></span>80% range</li><li><span class="key-dot" style="background:var(--ink)"></span>Forecast</li><li><span class="key-line"></span>${L.origin}</li>`;
}
function renderList() {
  const L = G().live, name = GRADES[state.g];
  rangeList($("list"), D, L.nbhd.map((x) => ({ ...x, from: x.score0, note: `${x.n} school${x.n > 1 ? "s" : ""}` })),
    { fmt: (v) => fmtPct(v), sort: state.sort, filter: state.filter, fromLabel: String(L.origin), predLabel: `${name}, ${L.target}` });
}
$("list-filter").addEventListener("input", (e) => { state.filter = e.target.value; renderList(); });

// ---- how the forecasts did ------------------------------------------------------------------------------
function renderScores() {
  const g = G(), sc = (f, k) => g.scores.find((x) => x.fold === f && x.rung === k);
  const head = `<thead><tr><th>Rung</th>${FOLDS.map(([, l, u]) => `<th>${l}<br><span class="none">${u}</span></th>`).join("")}</tr></thead>`;
  const row = (k, cell) => `<tr${k === D.chosen.schools ? ' class="sel"' : ""}><th>${rungName(D, k)}${k === D.chosen.schools ? " (chosen)" : ""}</th>${FOLDS.map(([f]) => cell(sc(f, k), k)).join("")}</tr>`;
  $("scores-schools").innerHTML = head + `<tbody>${RUNGS.map((k) => row(k, (x) => (x ? `<td>${fmtPts(x.mae)}${k === "persistence" ? "" : ` <span class="none">(${signed(x.skill * 100, 0)}%)</span>`}</td>` : `<td class="none">—</td>`))).join("")}</tbody>`;
  $("scores-nbhd").innerHTML = head + `<tbody>${RUNGS.map((k) => row(k, (x) => (x ? `<td>${fmtPts(x.nbhd_mae)}</td>` : `<td class="none">—</td>`))).join("")}</tbody>`;
  const first = sc("2018-2019", "persistence");
  $("scores-lede").innerHTML = `Mean absolute error in percentage points, weighted by enrolment, for each rung's forecast one test year ahead (three for 2019 to 2022, across the COVID-19 closures). `
    + `In brackets, skill: the reduction in error against persistence. The rule chose the rung on the two selection folds; the holdout was run once, after the choice, and doesn't change it. `
    + `2025 to 2026 is the live forecast made from 2025 and committed before any 2025–26 result was read, scored on EQAO's results. Neighbourhood figures average the schools' forecasts and results with their enrolment.`;
  $("scores-note").innerHTML = `${marksNote} 2018 to 2019 has persistence only (nothing earlier to fit on): ${fmtPts(first?.mae)} for schools, ${fmtPts(first?.nbhd_mae)} for neighbourhoods. `
    + `2025 to 2026 has the three rungs the live forecast kept: persistence, own mean and ridge.`;
}

// ---- the holdout -----------------------------------------------------------------------------------------
function renderHoldout() {
  const g = G(), r = g.range, name = GRADES[state.g];
  scatter($("hold-scatter"), D, g.holdout, { fmt: (v) => `${Math.round(v)}%`, xLabel: `Ridge's forecast for 2025, ${name}`, yLabel: `Actual, 2025` });
  scatterKey($("hold-key"));
  $("hold-lede").innerHTML = `Each neighbourhood's ${name} forecast for 2025, made from 2024 with ridge fitted on the changes before it, against the result. `
    + `<b>${fmtShare(r.inside)}</b> of ${r.n} neighbourhoods fell inside the range set from the selection folds.`;
  const s2 = g.second;
  $("ranges").innerHTML = `<thead><tr><th>Neighbourhoods</th><th>Range (± points)</th><th>Selection-fold rows</th><th>Holdout: inside</th><th>2025 to 2026: inside</th></tr></thead><tbody>
    <tr><th>One school</th><td>${fmtPts(r.one, 1)}</td><td>${r.rows_one}</td><td>${fmtShare(r.inside_one)}</td><td>${fmtShare(s2.inside_one)}</td></tr>
    <tr><th>Two or more</th><td>${fmtPts(r.more, 1)}</td><td>${r.rows_more}</td><td>${fmtShare(r.inside_more)}</td><td>${fmtShare(s2.inside_more)}</td></tr>
    <tr><th>All</th><td></td><td>${r.rows_one + r.rows_more}</td><td>${fmtShare(r.inside)} <span class="none">of ${r.n}</span></td><td>${fmtShare(s2.inside)} <span class="none">of ${s2.n}</span></td></tr></tbody>`;
}

// ---- 2025 to 2026: the frozen forecast, scored ---------------------------------------------------------------
function renderSecond() {
  const g = G(), s2 = g.second, name = GRADES[state.g];
  scatter($("second-scatter"), D, s2.nbhd, { fmt: (v) => `${Math.round(v)}%`, xLabel: `Ridge's forecast for 2026, ${name}`, yLabel: `Actual, 2026` });
  scatterKey($("second-key"));
  $("second-lede").innerHTML = `Each neighbourhood's ${name} forecast for 2026, made from 2025 and committed on 3 November 2026 before any 2025–26 result was read, against EQAO's 2025–26 results. `
    + `${s2.schools} of the forecast's ${s2.frozen} schools have a 2026 score; neighbourhood figures are over those schools. `
    + `<b>${fmtShare(s2.inside)}</b> of ${s2.n} neighbourhoods fell inside the range.`;
}

// ---- 2019 to 2022 ----------------------------------------------------------------------------------------
function renderCovid() {
  const C = G().covid, gap = C.find((x) => x.row === "gap"), name = GRADES[state.g];
  const rows = C.filter((x) => x.row !== "gap").map((x) => `<tr><th>${escapeHTML(x.row[0].toUpperCase() + x.row.slice(1))}</th><td>${Math.round(x.share_lo)}–${Math.round(x.share_hi)}%</td><td>${x.n}</td><td>${signed(x.vs_forecast)}</td><td>${signed(x.change)}</td></tr>`).join("");
  $("covid").innerHTML = `<thead><tr><th>Low-income share, 2019</th><th>Range</th><th>Schools</th><th>Against the forecast (pp)</th><th>Change against the mean change (pp)</th></tr></thead>
    <tbody>${rows}<tr class="sel"><th>Highest third less lowest</th><td></td><td>${gap.n}</td><td>${signed(gap.vs_forecast)} <span class="none">(se ${gap.vs_forecast_se.toFixed(1)})</span></td><td>${signed(gap.change)} <span class="none">(se ${gap.change_se.toFixed(1)})</span></td></tr></tbody>`;
  $("covid-lede").innerHTML = `${name}: the City's score was ${fmtPct(gap.city_2019)} in 2019 and ${fmtPct(gap.city_2022)} in 2022. Schools are split into thirds by their 2019 low-income share. `
    + `Against the forecast: each third's 2022 result less ridge's forecast from 2019 (fitted on 2018 to 2019, on the City's 2022 level), net of the mean over all schools. `
    + `Change: each third's change from 2019 to 2022 less the mean change. Both weighted by enrolment; bootstrap standard errors in brackets.`;
}

$("method-note").innerHTML = `Scores are the share of fully participating students at or above the provincial standard (levels 3 and 4), the mean of reading, writing and math; years are test years (2025 is the 2024–25 school year; 2024 is the Ministry's preliminary file). `
  + `2026 scores are from EQAO's school file, which reproduces every Ministry 2024–25 Toronto score; for 2026, enrolment and the student shares are the Ministry's 2024–25 figures. `
  + `English public and Catholic elementary schools, placed in the neighbourhood that contains them. The method, the rungs and the decision rule are on the <a href="/forecasts/">Method</a> page.`;

function render() {
  seg($("grade"), Object.entries(GRADES), state.g, (g) => { state.g = g; render(); });
  seg($("list-sort"), [["pred", "By forecast"], ["name", "By name"]], state.sort, (s) => { state.sort = s; render(); });
  renderForecast();
  renderScores();
  renderHoldout();
  renderSecond();
  renderCovid();
  writeHash();
}
render();
buildToc();
