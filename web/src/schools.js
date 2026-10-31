// The School Insights page: Grade 3 and 6 test results (EQAO) for the City's
// English public and Catholic elementary schools and its 158 neighbourhoods, from
// schools.json (pipeline/school_insights.py), with the 2021 Census figures from
// insights.json. Charts are inline SVG and HTML, as on the Census Insights page.
import "./style.css";
import { $, COLORS, DIVERGING, MEASURES as CENSUS, escapeHTML, fmtCount, isMoney, ordinal, sign } from "./catalogue.js";
import { fmtR, initTip, pearson, quantile, rColor, seg } from "./charts.js";

const [D, census] = await Promise.all([
  fetch(`/schools.json?v=${__SCHOOLS_VERSION__}`).then((r) => r.json()),
  fetch(`/insights.json?v=${__INSIGHTS_VERSION__}`).then((r) => r.json()),
]);
const YEARS = D.years.map(String); // test years: 2018, 2019, 2022-2025
const PRELIM = new Set(D.preliminary.map(String));
const TESTS = D.tests;
const MEASURES = ["score", ...TESTS];
const NAMES = {
  score: "Elementary score", g3_read: "Grade 3 reading", g3_write: "Grade 3 writing", g3_math: "Grade 3 math",
  g6_read: "Grade 6 reading", g6_write: "Grade 6 writing", g6_math: "Grade 6 math",
};
const LONG = {
  score: "Elementary score: the mean of the six Grade 3 and 6 results",
  ...Object.fromEntries(TESTS.map((t) => [t, `${NAMES[t]}: students at the provincial standard`])),
};
const DEMO = {
  low_income: "Live in low-income households", no_degree: "Parents without a degree, diploma or certificate",
  not_english: "First language not English", new_canada: "New to Canada from a non-English-speaking country",
  special_ed: "Receiving special education", gifted: "Identified as gifted",
};
const METHODS = { nearest: "Nearest schools", inside: "Schools inside" };
const TYPES = ["Public", "Catholic"];
const TYPE_COLOR = { Public: "#2a78d6", Catholic: "#c2410c" };
const RISE = DIVERGING[5], FALL = DIVERGING[1], INK = "#1a1a19";
// Pairs of test years, averaged for the changes: 2018-19, 2022-23, 2024-25.
const PERIODS = [0, 2, 4].map((k) => YEARS.slice(k, k + 2));
const PAIRS = [[0, 2], [0, 1], [1, 2]];
const nbhd = D.nbhd, S = D.schools, NS = S.number.length;
const censusMeasures = Object.keys(CENSUS).filter((m) => census.measures[m]?.values["2021"]);

// ---- state, kept in the address -----------------------------------------------
const hash = new URLSearchParams(location.hash.slice(1));
const pick = (v, list, dflt) => (list.includes(v) ? v : dflt);
const state = {
  m: pick(hash.get("m"), MEASURES, "score"),
  y: pick(hash.get("y"), YEARS, YEARS.at(-1)),
  method: pick(hash.get("meth"), Object.keys(METHODS), "nearest"),
  spread: pick(hash.get("sp"), ["schools", "nbhd"], "schools"),
  changeUnit: pick(hash.get("cu"), ["nbhd", "schools"], "nbhd"),
  pair: pick(hash.get("cp"), PAIRS.map((p) => p.join("")), "02"),
  sx: hash.get("sx") ?? "s:low_income",
  showSchools: hash.get("ss") === "1",
  sort: { k: "name", dir: 1 },
  filter: "",
};
const writeHash = () => {
  const h = new URLSearchParams({ m: state.m, y: state.y, meth: state.method, sp: state.spread, cu: state.changeUnit, cp: state.pair, sx: state.sx });
  if (state.showSchools) h.set("ss", "1");
  history.replaceState(null, "", `#${h}`);
};

// ---- figures ---------------------------------------------------------------------
const yLabel = (y) => `${y}${PRELIM.has(y) ? "*" : ""}`;
const fmt = (v) => (v == null ? "—" : `${v.toFixed(1)}%`);
const fmtShort = (v) => `${Math.round(v)}%`;
const fmtD = (d) => (d == null ? "—" : `${sign(+d.toFixed(1))}${Math.abs(d).toFixed(1)} pp`);
const mean = (vs) => vs.reduce((a, v) => a + v, 0) / vs.length;
const sd = (vs) => {
  const m = mean(vs);
  return Math.sqrt(vs.reduce((a, v) => a + (v - m) ** 2, 0) / (vs.length - 1));
};
const sorted = (vs) => vs.filter((v) => v != null).sort((a, b) => a - b);

// A school's result; its score is the mean of the six, where it has all six.
const svCache = {};
function sv(m, y) {
  const k = `${m}|${y}`;
  if (svCache[k]) return svCache[k];
  const t = S.years[y];
  return (svCache[k] = m === "score"
    ? t.g3_read.map((_, i) => (TESTS.every((c) => t[c][i] != null) ? mean(TESTS.map((c) => t[c][i])) : null))
    : t[m]);
}
const enrol = (y) => S.years[y].enrolment;
const nv = (m, y, method = state.method) => nbhd.map((_, i) => D.by_nbhd[method][m][y][i]);
const city = (m, y) => D.city[m][y];
// Enrolment-weighted mean over one board type's schools, as the City's figure is
// over all of them (each result over the schools reporting it; the score their mean).
function typeMean(m, y, type) {
  if (m === "score") return mean(TESTS.map((t) => typeMean(t, y, type)));
  const v = sv(m, y), e = enrol(y);
  let s = 0, w = 0;
  for (let i = 0; i < NS; i++) if (S.type[i] === type && v[i] != null && e[i]) { s += v[i] * e[i]; w += e[i]; }
  return w ? s / w : null;
}

initTip();

// ---- controls ----------------------------------------------------------------------
const select = $("measure");
select.innerHTML = MEASURES.map((m) => `<option value="${m}">${escapeHTML(LONG[m])}</option>`).join("");
select.value = state.m;
select.addEventListener("change", () => set({ m: select.value }));
function controls() {
  seg($("year"), YEARS.map((y) => [y, yLabel(y)]), state.y, (y) => set({ y }));
  seg($("method"), Object.entries(METHODS), state.method, (method) => set({ method }));
}
function set(changes) {
  Object.assign(state, changes);
  select.value = state.m;
  render();
}

// ---- 1. the city at a glance -----------------------------------------------------------
// x positions by calendar year, so the two years without tests leave a gap
const Y0 = +YEARS[0], Y1 = +YEARS.at(-1);
const runs = (ys) => ys.reduce((acc, y) => {
  const last = acc.at(-1);
  if (last && +y - +last.at(-1) === 1) last.push(y); else acc.push([y]);
  return acc;
}, []);
function sparkline(m) {
  const W = 120, H = 34, px = 6, py = 6;
  const vs = YEARS.map((y) => city(m, y));
  const lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const x = (y) => px + ((+y - Y0) / (Y1 - Y0)) * (W - 2 * px);
  const yy = (v) => H - py - ((v - lo) / span) * (H - 2 * py);
  const lines = runs(YEARS).map((r) => `<polyline points="${r.map((y) => `${x(y).toFixed(1)},${yy(city(m, y)).toFixed(1)}`).join(" ")}" fill="none" stroke="${COLORS[2]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`).join("");
  const dots = YEARS.map((y, i) => {
    const last = i === YEARS.length - 1, col = last ? COLORS[4] : COLORS[2];
    const fill = PRELIM.has(y) ? "#fcfcfb" : col;
    const t = `${y}${PRELIM.has(y) ? " (preliminary)" : ""}: <b>${fmt(city(m, y))}</b>`;
    return `<circle cx="${x(y)}" cy="${yy(city(m, y))}" r="${last ? 4 : 3}" fill="${fill}" stroke="${PRELIM.has(y) ? col : "#fcfcfb"}" stroke-width="${PRELIM.has(y) ? 1.5 : 2}"/>`
      + `<circle cx="${x(y)}" cy="${yy(city(m, y))}" r="9" fill="transparent" data-tip="${escapeHTML(t)}"/>`;
  }).join("");
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${lines}${dots}</svg>`;
}
function renderCards() {
  const last = YEARS.at(-1), first = YEARS[0];
  $("cards").innerHTML = MEASURES.map((m) => {
    const now = city(m, last);
    const aria = `${NAMES[m]}: ${YEARS.map((y) => `${y} ${fmt(city(m, y))}`).join(", ")}`;
    return `<button type="button" class="card" data-m="${m}" aria-pressed="${m === state.m}" aria-label="${escapeHTML(aria)}">
      <span class="card-name">${NAMES[m]}</span>
      <span class="card-value">${fmt(now)}</span>
      ${sparkline(m)}
      <span class="card-years"><span>${first}</span><span>${last}</span></span>
      <span class="card-delta">${fmtD(now - city(m, first))} since ${first}</span>
    </button>`;
  }).join("");
  const n = sv("score", last).filter((v) => v != null).length;
  $("glance-lede").innerHTML = `The share of students at the provincial standard (level 3 or 4) in each Grade 3 and 6 test, over the City's English public and Catholic elementary schools, weighted by enrolment. `
    + `${n} schools have all six results in ${last}. No tests were written in 2020 or 2021; * marks ${[...PRELIM].join(", ")}, the Ministry's preliminary results. Tap a card to see its schools and neighbourhoods below.`;
}
$("cards").addEventListener("click", (e) => {
  const c = e.target.closest(".card");
  if (!c) return;
  set({ m: c.dataset.m });
  $("measure-bar").scrollIntoView({ behavior: "smooth", block: "start" });
});

// ---- 2. year by year ---------------------------------------------------------------------
// Lines in a 0-100 SVG box stretched to the chart; dots and labels are HTML so
// they keep their size.
function renderTrend() {
  const m = state.m;
  const stats = YEARS.map((y) => {
    const s = sorted(sv(m, y));
    return { y, n: s.length, p10: quantile(s, 0.1), p50: quantile(s, 0.5), p90: quantile(s, 0.9), city: city(m, y),
      Public: typeMean(m, y, "Public"), Catholic: typeMean(m, y, "Catholic"),
      enrol: enrol(y).reduce((a, e, i) => a + (sv(m, y)[i] != null && e ? e : 0), 0) };
  });
  const lo = Math.floor(Math.min(...stats.map((s) => s.p10)) / 5) * 5, hi = Math.ceil(Math.max(...stats.map((s) => s.p90)) / 5) * 5;
  const x = (y) => ((+y - Y0) / (Y1 - Y0)) * 100, yy = (v) => 100 - ((v - lo) / (hi - lo)) * 100;
  const st = Object.fromEntries(stats.map((s) => [s.y, s]));
  const series = [["city", INK, "City"], ["Public", TYPE_COLOR.Public, "Public"], ["Catholic", TYPE_COLOR.Catholic, "Catholic"]];
  const band = runs(YEARS).map((r) => `<polygon points="${[...r.map((y) => `${x(y)},${yy(st[y].p90)}`), ...[...r].reverse().map((y) => `${x(y)},${yy(st[y].p10)}`)].join(" ")}" fill="#e6eef8"/>`).join("");
  const lines = series.map(([k, col]) => runs(YEARS).map((r) => `<polyline points="${r.map((y) => `${x(y)},${yy(st[y][k])}`).join(" ")}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke"/>`).join("")).join("");
  // the years without tests
  const gaps = runs(YEARS).slice(1).map((r, k) => {
    const a = runs(YEARS)[k].at(-1), b = r[0];
    return `<span class="tr-gap" style="left:${x(a)}%;width:${x(b) - x(a)}%"><span>No tests</span></span>`;
  }).join("");
  const dots = stats.flatMap((s) => series.map(([k, col, name]) => {
    const t = `${name}, ${s.y}${PRELIM.has(s.y) ? " (preliminary)" : ""}: <b>${fmt(s[k])}</b>`;
    const style = PRELIM.has(s.y) ? `border-color:${col};background:#fcfcfb` : `border-color:#fcfcfb;background:${col}`;
    return `<span class="tr-dot" style="left:${x(s.y)}%;top:${yy(s[k])}%;${style}" data-tip="${escapeHTML(t)}"></span>`;
  })).join("");
  const bandTips = stats.map((s) => `<span class="tr-band" style="left:${x(s.y)}%;top:${yy(s.p90)}%;height:${yy(s.p10) - yy(s.p90)}%" data-tip="${escapeHTML(`${s.y}, ${s.n} schools: 10th percentile ${fmt(s.p10)} · median ${fmt(s.p50)} · 90th ${fmt(s.p90)}`)}"></span>`).join("");
  const step = hi - lo > 30 ? 10 : 5, ticks = Array.from({ length: Math.floor((hi - lo) / step) + 1 }, (_, k) => lo + k * step);
  const yt = ticks.map((v) => `<span class="sc-ytick" style="bottom:${100 - yy(v)}%">${v}%</span>`).join("");
  const grid = ticks.slice(1).map((v) => `<span class="sc-gy" style="bottom:${100 - yy(v)}%"></span>`).join("");
  const xt = YEARS.map((y) => `<span style="left:${x(y)}%">${yLabel(y)}</span>`).join("");
  $("trend").innerHTML = `<div class="tr-box">${grid}${gaps}<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${band}${lines}</svg>${bandTips}${dots}${yt}</div>
    <div class="tr-xticks">${xt}</div>`;
  $("trend").setAttribute("aria-label", `${NAMES[m]} by test year: ${stats.map((s) => `${s.y} ${fmt(s.city)}`).join(", ")}`);
  $("trend-key").innerHTML = series.map(([, col, name]) => `<li><span class="key-dot" style="background:${col}"></span>${name}</li>`).join("")
    + `<li><span class="key-sq" style="background:#e6eef8"></span>Middle 80% of schools (10th to 90th percentile)</li><li><span class="key-dot hollow"></span>Preliminary</li>`;
  $("trend-lede").innerHTML = `${escapeHTML(LONG[m])}, by test year: the City and the two school boards' schools (each weighted by enrolment), and the spread of the schools.`;
  const head = `<tr><th>Test year</th><th>Schools</th><th>Enrolment</th><th>Public</th><th>Catholic</th><th>City</th><th>10th pct.</th><th>Median</th><th>90th pct.</th></tr>`;
  const rows = stats.map((s) => `<tr${s.y === state.y ? ' class="sel"' : ""}><th>${yLabel(s.y)}</th><td>${s.n}</td><td>${fmtCount(s.enrol)}</td><td>${fmt(s.Public)}</td><td>${fmt(s.Catholic)}</td><td><b>${fmt(s.city)}</b></td><td>${fmt(s.p10)}</td><td>${fmt(s.p50)}</td><td>${fmt(s.p90)}</td></tr>`).join("");
  $("trend-table").innerHTML = `<caption>Schools with ${m === "score" ? "all six results" : "the result"}; their enrolment; percentiles across schools.</caption><thead>${head}</thead><tbody>${rows}</tbody>`;
}

// ---- 3. the map ------------------------------------------------------------------------------
// Six classes for each measure, the same in every year and for both methods: the
// sixths of the neighbourhoods' nearest-school figures over all the test years.
const breaksCache = {};
function breaks(m) {
  if (breaksCache[m]) return breaksCache[m];
  const all = sorted(YEARS.flatMap((y) => D.by_nbhd.nearest[m][y]));
  return (breaksCache[m] = [1, 2, 3, 4, 5].map((k) => Math.round(quantile(all, k / 6))));
}
const cls = (m, v) => breaks(m).filter((b) => v >= b).length;
const nbRank = (vs) => {
  const order = vs.map((v, i) => [v, i]).filter(([v]) => v != null).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  return { order, rank: new Map(order.map((i, k) => [i, k + 1])) };
};
function renderMap() {
  const m = state.m, y = state.y, vs = nv(m, y), b = breaks(m), r = nbRank(vs);
  const shapes = nbhd.map((n, i) => {
    const v = vs[i];
    const extra = state.method === "inside" ? `<br>${D.by_nbhd.inside.schools[y][i] ?? 0} schools inside` : "";
    const t = `${escapeHTML(n.name)}<br>${v == null ? "No school inside with a result" : `<b>${fmt(v)}</b> · ${ordinal(r.rank.get(i))} of ${r.order.length}`}${extra}`;
    return `<path d="${n.path}" class="${v == null ? "nb-none" : ""}" fill="${v == null ? "url(#nb-hatch)" : COLORS[cls(m, v)]}" data-tip="${t}"/>`;
  }).join("");
  let dots = "";
  if (state.showSchools) {
    const sv_ = sv(m, y);
    dots = S.xy.map(([sx, sy], i) => sv_[i] == null ? "" : `<circle cx="${sx}" cy="${sy}" r="5" fill="${COLORS[cls(m, sv_[i])]}" class="nb-school" data-tip="${escapeHTML(`${S.name[i]} (${S.type[i]})<br><b>${fmt(sv_[i])}</b> · enrolment ${fmtCount(enrol(y)[i])}`)}"/>`).join("");
  }
  $("nb-map").innerHTML = `<svg viewBox="0 0 ${D.map.width} ${D.map.height}" role="img" aria-label="${escapeHTML(`Map of the 158 neighbourhoods by ${NAMES[m].toLowerCase()}, ${y}`)}">
    <defs><pattern id="nb-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#f0f0ec"/><line x1="0" y1="0" x2="0" y2="8" stroke="#c9c9c3" stroke-width="3"/></pattern></defs>
    <g class="nb-shapes">${shapes}</g><g>${dots}</g></svg>`;
  const edges = [null, ...b, null];
  $("map-key").innerHTML = COLORS.map((c, k) => `<li><span class="key-sq" style="background:${c}"></span>${edges[k] == null ? `under ${edges[k + 1]}%` : edges[k + 1] == null ? `${edges[k]}% or more` : `${edges[k]}–${edges[k + 1]}%`}</li>`).join("")
    + (state.method === "inside" ? `<li><span class="key-sq hatch"></span>No school inside with a result</li>` : "");
  $("map-lede").innerHTML = `${escapeHTML(LONG[m])}, ${y}${PRELIM.has(y) ? " (preliminary)" : ""}, by neighbourhood: ${state.method === "nearest"
    ? "for each dissemination area, its nearest public and nearest Catholic school with the result, weighted by the boards' shares of enrolment; the areas averaged by their children aged 0–14"
    : "the schools located in the neighbourhood, weighted by enrolment"}. The classes are the same in every year.${state.showSchools ? " Dots are the schools, on the same classes." : ""}`;
}
$("map-schools").checked = state.showSchools;
$("map-schools").addEventListener("change", (e) => {
  state.showSchools = e.target.checked;
  renderMap();
  writeHash();
});

// ---- 4. highest and lowest neighbourhoods ----------------------------------------------------------
function rankRow(m, y, i, r, prev, vs) {
  const v = vs[i], k = r.rank.get(i), c = city(m, y);
  let move = "";
  if (prev) {
    const was = prev.r.rank.get(i), d = was == null ? null : was - k;
    move = d == null ? `<span class="move">new</span>`
      : d === 0 ? `<span class="move" aria-label="same rank as in ${prev.y}">–</span>`
      : `<span class="move" aria-label="${d > 0 ? "up" : "down"} ${Math.abs(d)} from ${prev.y}" data-tip="${escapeHTML(`${ordinal(was)} of ${prev.r.order.length} in ${prev.y}`)}">${d > 0 ? "▲" : "▼"}${Math.abs(d)}</span>`;
  }
  const t = `${escapeHTML(nbhd[i].name)}<br><b>${fmt(v)}</b> · ${ordinal(k)} of ${r.order.length}<br>City: ${fmt(c)}`;
  return `<li>
    <span class="rk">${k}</span>
    <span class="nm">${escapeHTML(nbhd[i].name)}</span>
    <span class="barcell" data-tip="${t}"><span class="bar-fill" style="width:${v.toFixed(1)}%"></span><span class="city-mark" style="left:${c.toFixed(1)}%"></span></span>
    <span class="vl">${fmtShort(v)}</span>
    ${move}
  </li>`;
}
function renderRanks() {
  const m = state.m, y = state.y, vs = nv(m, y), r = nbRank(vs);
  const k = YEARS.indexOf(y);
  const prev = k > 0 ? { y: YEARS[k - 1], r: nbRank(nv(m, YEARS[k - 1])) } : null;
  $("rank-top").innerHTML = r.order.slice(0, 10).map((i) => rankRow(m, y, i, r, prev, vs)).join("");
  $("rank-bottom").innerHTML = r.order.slice(-10).reverse().map((i) => rankRow(m, y, i, r, prev, vs)).join("");
  const missing = nbhd.length - r.order.length;
  $("rank-lede").innerHTML = `${escapeHTML(LONG[m])}, ${y}${PRELIM.has(y) ? " (preliminary)" : ""}, ${METHODS[state.method].toLowerCase()}, ${r.order.length} neighbourhoods${missing ? ` (${missing} without a figure)` : ""}. `
    + `Bars run from 0 to 100%; the tick marks the City (${fmt(city(m, y))}).${prev ? ` Arrows: places gained or lost since ${prev.y}.` : ""}`;
}

// ---- 5. how the results spread out ---------------------------------------------------------------
function renderSpread() {
  const m = state.m, unit = state.spread;
  seg($("spread-unit"), [["schools", "Schools"], ["nbhd", "Neighbourhoods"]], unit, (k) => {
    state.spread = k;
    renderSpread();
    writeHash();
  });
  const names = unit === "schools" ? S.name : nbhd.map((n) => n.name);
  const vals = (y) => (unit === "schools" ? sv(m, y) : nv(m, y));
  const rows = YEARS.map((y) => {
    const pts = vals(y).map((v, i) => (v == null ? null : { i, v })).filter(Boolean);
    const s = pts.map((p) => p.v).sort((a, b) => a - b);
    return { y, pts, n: s.length, p10: quantile(s, 0.1), p50: quantile(s, 0.5), p90: quantile(s, 0.9) };
  });
  const lo = Math.floor(Math.min(...rows.map((r) => r.pts.length ? Math.min(...r.pts.map((p) => p.v)) : 100)) / 10) * 10, hi = 100;
  const x = (v) => ((v - lo) / (hi - lo)) * 100;
  const jitter = (i) => ((i * 2654435761) % 1000) / 1000;
  const col = COLORS[3];
  $("spread").innerHTML = rows.map((r) => {
    const dots = r.pts.map((p) => `<span class="sp-dot" style="left:${x(p.v).toFixed(2)}%;top:${(4 + jitter(p.i) * 22).toFixed(1)}px;background:${col}" data-tip="${escapeHTML(`${names[p.i]}<br>${r.y}: <b>${fmt(p.v)}</b>`)}"></span>`).join("");
    const t = `${r.y}, ${r.n} ${unit === "schools" ? "schools" : "neighbourhoods"}<br>10th percentile ${fmt(r.p10)} · median <b>${fmt(r.p50)}</b> · 90th ${fmt(r.p90)}`;
    return `<div class="sp-row${r.y === state.y ? " sel" : ""}">
      <span class="sp-year">${yLabel(r.y)}</span>
      <div class="sp-plot">${dots}
        <span class="sp-range" style="left:${x(r.p10).toFixed(2)}%;width:${(x(r.p90) - x(r.p10)).toFixed(2)}%;background:${col}" data-tip="${t}"></span>
        <span class="sp-median" style="left:${x(r.p50).toFixed(2)}%" data-tip="${t}"></span>
      </div>
      <span class="sp-stat">${fmtShort(r.p50)}</span>
    </div>`;
  }).join("") + `<div class="sp-axis"><span class="sp-year"></span><div class="sp-ticks">${Array.from({ length: (hi - lo) / 10 + 1 }, (_, k) => lo + k * 10).map((v) => `<span style="left:${x(v)}%">${v}%</span>`).join("")}</div><span class="sp-stat">median</span></div>`;
  $("spread-lede").innerHTML = `${escapeHTML(LONG[m])}${unit === "nbhd" ? `, ${METHODS[state.method].toLowerCase()}` : ""}. Each dot is ${unit === "schools" ? "a school" : "a neighbourhood"}; the bar spans the middle 80% (10th to 90th percentile) and the dark tick marks the median. `
    + `Below, the ${state.y} figures in 5-point bins.`;
  renderHist(rows.find((r) => r.y === state.y), unit, names);
}
// Bins of 5 points; for schools, stacked by board.
function renderHist(row, unit, names) {
  const m = state.m, y = state.y, lo = Math.floor(Math.min(...row.pts.map((p) => p.v)) / 5) * 5, n = Math.ceil((100 - lo) / 5);
  const groups = unit === "schools" ? TYPES : ["all"];
  const counts = groups.map(() => new Array(n).fill(0));
  for (const p of row.pts) {
    const b = Math.min(Math.floor((p.v - lo) / 5), n - 1);
    counts[unit === "schools" ? TYPES.indexOf(S.type[p.i]) : 0][b]++;
  }
  const tot = counts[0].map((_, b) => groups.reduce((a, _g, k) => a + counts[k][b], 0)), max = Math.max(...tot);
  const W = 100, bw = W / n;
  const bars = tot.map((_, b) => {
    let y0 = 100;
    const segs = groups.map((g, k) => {
      const h = (counts[k][b] / max) * 100;
      y0 -= h;
      return h ? `<rect x="${(b * bw + 0.15).toFixed(2)}" y="${y0.toFixed(2)}" width="${(bw - 0.3).toFixed(2)}" height="${h.toFixed(2)}" fill="${g === "all" ? COLORS[3] : TYPE_COLOR[g]}"/>` : "";
    }).join("");
    return segs;
  }).join("");
  const tips = tot.map((t, b) => `<span class="hi-bin" style="left:${b * bw}%;width:${bw}%" data-tip="${escapeHTML(`${lo + b * 5}–${lo + b * 5 + 5}%: <b>${t}</b>${unit === "schools" ? ` (${TYPES.map((g, k) => `${counts[k][b]} ${g}`).join(", ")})` : ""}`)}"></span>`).join("");
  const c = city(m, y), cx = ((c - lo) / (100 - lo)) * 100;
  $("hist").innerHTML = `<div class="hi-box"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${bars}</svg>${tips}
      <span class="hi-city" style="left:${cx}%" data-tip="City: ${fmt(c)}"></span><span class="hi-max">${max}</span></div>
    <div class="sc-xticks hi-ticks">${Array.from({ length: n + 1 }, (_, b) => b).filter((b) => b % 2 === 0 || b === n).map((b) => `<span style="left:${(b / n) * 100}%">${lo + b * 5}%</span>`).join("")}</div>`;
  $("hist").setAttribute("aria-label", `Histogram of ${row.n} ${unit === "schools" ? "schools" : "neighbourhoods"}, ${y}`);
  $("hist-key").innerHTML = (unit === "schools" ? TYPES.map((g) => `<li><span class="key-sq" style="background:${TYPE_COLOR[g]}"></span>${g}</li>`).join("") : "")
    + `<li><span class="key-line"></span>City, ${fmt(c)}</li><li>${row.n} ${unit === "schools" ? "schools" : "neighbourhoods"} in ${yLabel(y)}; the tallest bin holds ${max}</li>`;
}

// ---- 6. how stable the results are ----------------------------------------------------------------
// Correlation between test years, shaded on the sequential ramp from 0.5 up.
const R_STEPS = [0.5, 0.6, 0.7, 0.8, 0.9];
const rCell = (v, tip) => {
  if (!v) return `<td class="none">—</td>`;
  const k = R_STEPS.filter((e) => v.r >= e).length;
  return `<td style="background:${COLORS[k]};color:${k >= 3 ? "#fff" : INK}" data-tip="${escapeHTML(`${tip}: <b>${fmtR(v.r)}</b> across ${v.n}`)}">${fmtR(v.r)}</td>`;
};
function rMatrix(get, what) {
  const head = `<tr><th></th>${YEARS.slice(0, -1).map((y) => `<th>${yLabel(y)}</th>`).join("")}</tr>`;
  const rows = YEARS.slice(1).map((b, j) => `<tr><th>${yLabel(b)}</th>${YEARS.slice(0, -1).map((a, i) => (i <= j ? rCell(pearson(get(a), get(b)), `${what}, ${a} and ${b}`) : `<td class="blank"></td>`)).join("")}</tr>`).join("");
  return `<thead>${head}</thead><tbody>${rows}</tbody>`;
}
function renderStability() {
  const m = state.m;
  $("stab-schools").innerHTML = rMatrix((y) => sv(m, y), "Schools");
  $("stab-nbhd").innerHTML = rMatrix((y) => nv(m, y), `Neighbourhoods (${METHODS[state.method].toLowerCase()})`);
  $("stab-lede").innerHTML = `How closely each test year's ${NAMES[m].toLowerCase()} follows another's: the correlation (Pearson r) across the schools, and across the neighbourhoods (${METHODS[state.method].toLowerCase()}), with figures in both years. 1 means the same order and spacing.`;
  // consecutive test years
  const pairs = YEARS.slice(1).map((b, k) => [YEARS[k], b]);
  const rows = pairs.map(([a, b]) => {
    const va = sv(m, a), vb = sv(m, b), e = enrol(b);
    const idx = va.map((_, i) => i).filter((i) => va[i] != null && vb[i] != null && e[i] != null);
    const d = idx.map((i) => vb[i] - va[i]);
    const es = sorted(idx.map((i) => e[i])), c1 = quantile(es, 1 / 3), c2 = quantile(es, 2 / 3);
    const third = (f) => sd(idx.filter((i) => f(e[i])).map((i) => vb[i] - va[i]));
    const na = nv(m, a), nb = nv(m, b), nd = nbhd.map((_, i) => (na[i] != null && nb[i] != null ? nb[i] - na[i] : null)).filter((v) => v != null);
    return `<tr><th>${yLabel(a)} → ${yLabel(b)}</th><td>${idx.length}</td><td>${fmtR(pearson(va, vb).r)}</td><td>${fmtD(mean(d))}</td><td><b>${sd(d).toFixed(1)}</b></td>`
      + `<td data-tip="${escapeHTML(`Enrolment under ${Math.round(c1)}`)}">${third((v) => v < c1).toFixed(1)}</td><td data-tip="${escapeHTML(`Enrolment ${Math.round(c1)} to ${Math.round(c2)}`)}">${third((v) => v >= c1 && v < c2).toFixed(1)}</td><td data-tip="${escapeHTML(`Enrolment ${Math.round(c2)} or more`)}">${third((v) => v >= c2).toFixed(1)}</td>`
      + `<td>${sd(nd).toFixed(1)}</td></tr>`;
  }).join("");
  $("moves").innerHTML = `<thead><tr><th rowspan="2">Test years</th><th colspan="7">Schools</th><th>Neighbourhoods</th></tr>
    <tr><th>Schools</th><th>r</th><th>Mean change</th><th>SD of change</th><th>SD, smallest third</th><th>SD, middle third</th><th>SD, largest third</th><th>SD of change</th></tr></thead><tbody>${rows}</tbody>`;
  $("moves-lede").innerHTML = `The change in each school's ${NAMES[m].toLowerCase()} between consecutive test years, and its standard deviation (SD, in percentage points): for all schools with figures in both years, by thirds of their enrolment in the later year, and for the neighbourhoods (${METHODS[state.method].toLowerCase()}). Across schools, the ${state.y} figures have an SD of ${sd(sorted(sv(m, state.y))).toFixed(1)}.`;
  // the two neighbourhood methods
  const mrows = YEARS.map((y) => {
    const a = nv(m, y, "nearest"), b = nv(m, y, "inside");
    const idx = a.map((_, i) => i).filter((i) => a[i] != null && b[i] != null);
    const sch = D.by_nbhd.inside.schools[y];
    return `<tr${y === state.y ? ' class="sel"' : ""}><th>${yLabel(y)}</th><td>${idx.length}</td><td>${sch.filter((n) => n >= 2).length}</td><td>${fmtR(pearson(a, b).r)}</td><td>${mean(idx.map((i) => Math.abs(a[i] - b[i]))).toFixed(1)}</td></tr>`;
  }).join("");
  $("methods").innerHTML = `<thead><tr><th>Test year</th><th>Neighbourhoods with schools inside</th><th>With two or more</th><th>r</th><th>Mean difference (pp)</th></tr></thead><tbody>${mrows}</tbody>`;
  $("methods-lede").innerHTML = `The neighbourhoods' ${NAMES[m].toLowerCase()} two ways: from the nearest schools (every neighbourhood) and from the schools inside (where any has the result). r and the mean absolute difference are over the neighbourhoods with both.`;
}

// ---- 7. biggest changes -------------------------------------------------------------------------------
function periodMean(vals, p) {
  const a = vals(p[0]), b = vals(p[1]);
  return a.map((v, i) => (v != null && b[i] != null ? (v + b[i]) / 2 : null));
}
const pLabel = (p) => `${p[0]}–${p[1].slice(2)}${p.some((y) => PRELIM.has(y)) ? "*" : ""}`;
function renderChanges() {
  const m = state.m, unit = state.changeUnit, [ia, ib] = state.pair.split("").map(Number), pa = PERIODS[ia], pb = PERIODS[ib];
  seg($("change-unit"), [["nbhd", "Neighbourhoods"], ["schools", "Schools"]], unit, (k) => {
    state.changeUnit = k;
    renderChanges();
    writeHash();
  });
  seg($("change-pair"), PAIRS.map(([a, b]) => [`${a}${b}`, `${pLabel(PERIODS[a])} to ${pLabel(PERIODS[b])}`]), state.pair, (k) => {
    state.pair = k;
    renderChanges();
    writeHash();
  });
  const vals = (y) => (unit === "schools" ? sv(m, y) : nv(m, y));
  const before = periodMean(vals, pa), after = periodMean(vals, pb);
  const name = (i) => (unit === "schools" ? S.name[i] : nbhd[i].name);
  const detail = (i) => (unit === "schools" ? `<br>${S.type[i]} · ${escapeHTML(nbhd[S.nbhd[i]].name)} · enrolment ${fmtCount(enrol(pb[1])[i] ?? enrol(pb[0])[i])}` : "");
  const rows = before.map((v, i) => (v == null || after[i] == null ? null : { i, before: v, after: after[i], d: after[i] - v })).filter(Boolean).sort((a, b) => b.d - a.d);
  const cityD = mean(pb.map((y) => city(m, y))) - mean(pa.map((y) => city(m, y)));
  const up = rows.slice(0, 10).filter((r) => r.d > 0), down = rows.slice(-10).reverse().filter((r) => r.d < 0);
  const shown = [...up, ...down];
  const lo = Math.min(...shown.map((r) => Math.min(r.before, r.after))), hi = Math.max(...shown.map((r) => Math.max(r.before, r.after)));
  const x = (v) => ((v - (lo - (hi - lo) * 0.04)) / ((hi - lo) * 1.08 || 1)) * 100;
  const row = (r, rise) => {
    const x0 = x(r.before), x1 = x(r.after), col = rise ? RISE : FALL;
    const t = `${escapeHTML(name(r.i))}${detail(r.i)}<br>${pLabel(pa)}: ${fmt(r.before)}<br>${pLabel(pb)}: <b>${fmt(r.after)}</b><br>Change: ${fmtD(r.d)}`;
    return `<li><span class="nm">${escapeHTML(name(r.i))}</span>
      <span class="dumbbell" data-tip="${t}">
        <span class="db-line" style="left:${Math.min(x0, x1).toFixed(1)}%;width:${Math.abs(x1 - x0).toFixed(1)}%;background:${col}"></span>
        <span class="db-dot db-from" style="left:${x0.toFixed(1)}%"></span>
        <span class="db-dot" style="left:${x1.toFixed(1)}%;background:${col}"></span>
      </span><span class="vl">${fmtD(r.d)}</span></li>`;
  };
  $("change-up").innerHTML = up.map((r) => row(r, true)).join("") || `<li class="none">None rose.</li>`;
  $("change-down").innerHTML = down.map((r) => row(r, false)).join("") || `<li class="none">None fell.</li>`;
  $("change-lede").innerHTML = `${escapeHTML(LONG[m])}: the mean of ${pa.join(" and ")} to the mean of ${pb.join(" and ")}, for the ${unit === "schools" ? "schools with figures in all four years" : `neighbourhoods (${METHODS[state.method].toLowerCase()})`}. `
    + `Each row runs from the earlier figure (open dot) to the later one. The City changed by ${fmtD(cityD)}.`;
  // all of them, sorted
  const W = 800, H = 140, pad = 4, all = [...rows].reverse();
  const dlo = Math.min(0, ...all.map((r) => r.d)), dhi = Math.max(0, ...all.map((r) => r.d));
  const yy = (v) => pad + ((dhi - v) / (dhi - dlo || 1)) * (H - 2 * pad), bw = (W - 2 * pad) / all.length;
  const bars = all.map((r, k) => {
    const y0 = yy(0), y1 = yy(r.d);
    return `<rect x="${(pad + k * bw).toFixed(2)}" y="${Math.min(y0, y1).toFixed(1)}" width="${Math.max(0.6, bw - (bw > 3 ? 1 : 0)).toFixed(2)}" height="${Math.max(1, Math.abs(y1 - y0)).toFixed(1)}" fill="${r.d >= 0 ? RISE : FALL}"/>`
      + `<rect x="${(pad + k * bw).toFixed(2)}" y="0" width="${bw.toFixed(2)}" height="${H}" fill="transparent" data-tip="${escapeHTML(`${name(r.i)}<br>${fmtD(r.d)}`)}"/>`;
  }).join("");
  $("strip").innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${escapeHTML(`Change in each of ${rows.length}, sorted from the biggest fall to the biggest rise`)}">
    <line x1="0" x2="${W}" y1="${yy(0)}" y2="${yy(0)}" stroke="#c9c9c3" vector-effect="non-scaling-stroke"/>${bars}
    <line x1="0" x2="${W}" y1="${yy(cityD)}" y2="${yy(cityD)}" stroke="${INK}" vector-effect="non-scaling-stroke"/></svg>`;
  $("strip-caption").innerHTML = `All ${rows.length} ${unit === "schools" ? "schools" : "neighbourhoods"}, from the biggest fall to the biggest rise: ${rows.filter((r) => r.d > 0).length} rose, ${rows.filter((r) => r.d < 0).length} fell. The dark line marks the City's change.`;
}

// ---- 8. what goes with what ------------------------------------------------------------------------------
const demo = (k, y) => (k === "enrolment" ? enrol(y) : S.years[y][k]);
function renderCorr() {
  const m = state.m;
  const keys = [...Object.keys(DEMO), "enrolment"];
  const label = (k) => (k === "enrolment" ? "Enrolment" : DEMO[k]);
  $("corr-schools").innerHTML = `<thead><tr><th>School figure</th>${YEARS.map((y) => `<th${y === state.y ? ' class="sel"' : ""}>${yLabel(y)}</th>`).join("")}</tr></thead><tbody>`
    + keys.map((k) => `<tr><th>${label(k)}</th>${YEARS.map((y) => {
      const v = pearson(sv(m, y), demo(k, y));
      if (!v) return `<td class="none">—</td>`;
      const dark = Math.abs(v.r) >= 0.6;
      return `<td class="pickable${`s:${k}` === state.sx && y === state.y ? " pick" : ""}" data-x="s:${k}" data-y="${y}" style="background:${rColor(v.r)};color:${dark ? "#fff" : INK}" data-tip="${escapeHTML(`${NAMES[m]} and ${label(k).toLowerCase()}, ${y}: <b>${fmtR(v.r)}</b> across ${v.n} schools`)}">${fmtR(v.r)}</td>`;
    }).join("")}</tr>`).join("") + "</tbody>";
  $("corr-lede").innerHTML = `The correlation (Pearson r) across schools between each school's ${NAMES[m].toLowerCase()} and the Ministry's figures on its students, in each test year's file. Choose a cell to see its schools below.`;
  $("corr-note").innerHTML = `The low-income and parents-without-a-degree shares are Statistics Canada census figures for the areas where students live, not counts of students; their distribution changes between the 2022 and 2023 files. The other shares are reported by the schools.`;
  // neighbourhoods against the 2021 Census
  const y = state.y, v = nv(m, y);
  const rs = censusMeasures.map((c) => ({ c, v: pearson(v, census.measures[c].values["2021"]) })).filter((r) => r.v).sort((a, b) => b.v.r - a.v.r);
  $("census-list").innerHTML = rs.map(({ c, v: { r } }) => {
    const w = Math.abs(r) * 50;
    return `<li><button type="button" data-x="c:${c}" class="${state.sx === `c:${c}` ? "pick" : ""}">
      <span class="cl-name">${escapeHTML(CENSUS[c].long)}</span>
      <span class="cl-bar"><span class="cl-zero"></span><span class="cl-fill" style="${r >= 0 ? "left:50%" : `left:${50 - w}%`};width:${w}%;background:${rColor(r)}"></span></span>
      <span class="cl-val">${fmtR(r)}</span></button></li>`;
  }).join("");
  $("census-lede").innerHTML = `The correlation across the 158 neighbourhoods between their ${y} ${NAMES[m].toLowerCase()} (${METHODS[state.method].toLowerCase()}) and each 2021 Census measure on the Census Insights page. Choose one to see its neighbourhoods.`;
  renderScatter();
}
// The explorer's menu: the schools' figures, then the census measures.
{
  const sel = $("sc-x");
  const og = (label, opts) => `<optgroup label="${escapeHTML(label)}">${opts.map(([v, t]) => `<option value="${v}">${escapeHTML(t)}</option>`).join("")}</optgroup>`;
  sel.innerHTML = og("Schools: their students", Object.entries(DEMO).map(([k, t]) => [`s:${k}`, t]))
    + og("Schools: other figures", [["s:enrolment", "Enrolment"], ...MEASURES.map((t) => [`s:${t}`, NAMES[t]])])
    + og("Neighbourhoods: 2021 Census", censusMeasures.map((c) => [`c:${c}`, CENSUS[c].long]));
  if (![...sel.options].some((o) => o.value === state.sx)) state.sx = "s:low_income";
  sel.addEventListener("change", () => {
    state.sx = sel.value;
    renderCorr();
    writeHash();
  });
}
const pickX = (e) => {
  const b = e.target.closest("[data-x]");
  if (!b) return;
  state.sx = b.dataset.x;
  if (b.dataset.y) state.y = b.dataset.y;
  render();
  $("scatter-fig").scrollIntoView({ behavior: "smooth", block: "nearest" });
};
$("corr-schools").addEventListener("click", pickX);
$("census-list").addEventListener("click", pickX);

function renderScatter() {
  const m = state.m, y = state.y, [kind, k] = state.sx.split(":");
  $("sc-x").value = state.sx;
  const schools = kind === "s";
  const xs = schools ? (k === "enrolment" ? enrol(y) : MEASURES.includes(k) ? sv(k, y) : S.years[y][k]) : census.measures[k].values["2021"];
  const ys = schools ? sv(m, y) : nv(m, y);
  const n = schools ? NS : nbhd.length;
  const idx = Array.from({ length: n }, (_, i) => i).filter((i) => xs[i] != null && ys[i] != null);
  const fx = schools ? (k === "enrolment" ? fmtCount : fmt) : (v) => (isMoney(k) ? `$${Math.round(v).toLocaleString("en-CA")}` : `${v.toFixed(1)}%`);
  const fxShort = schools ? (k === "enrolment" ? fmtCount : fmtShort) : (v) => (isMoney(k) ? `$${Math.round(v / 1000)}k` : `${Math.round(v)}%`);
  const xlabel = schools ? (k === "enrolment" ? "Enrolment" : DEMO[k] ?? NAMES[k]) : `${CENSUS[k].long}, 2021 Census`;
  const sx = sorted(idx.map((i) => xs[i])), xa = sx[0], xb = quantile(sx, 0.99);
  const sy = sorted(idx.map((i) => ys[i])), ya = Math.floor(sy[0] / 10) * 10, yb = 100;
  const px = (v) => Math.min(100, Math.max(0, ((v - xa) / (xb - xa || 1)) * 100)), py = (v) => ((v - ya) / (yb - ya)) * 100;
  const dots = idx.map((i) => {
    const nm = schools ? `${S.name[i]} (${S.type[i]})` : nbhd[i].name;
    const t = `${escapeHTML(nm)}<br>${escapeHTML(xlabel)}: <b>${fx(xs[i])}</b><br>${NAMES[m]}: <b>${fmt(ys[i])}</b>`;
    return `<span class="sc-dot" style="left:${px(xs[i]).toFixed(2)}%;bottom:${py(ys[i]).toFixed(2)}%${schools ? `;background:${TYPE_COLOR[S.type[i]]}` : ""}" data-tip="${t}"></span>`;
  }).join("");
  const q = [0, 0.25, 0.5, 0.75, 1];
  const grid = q.slice(1, -1).map((f) => `<span class="sc-gx" style="left:${f * 100}%"></span><span class="sc-gy" style="bottom:${f * 100}%"></span>`).join("");
  const yt = q.map((f) => `<span class="sc-ytick" style="bottom:${f * 100}%">${fmtShort(ya + f * (yb - ya))}</span>`).join("");
  const xt = q.map((f) => `<span style="left:${f * 100}%">${fxShort(xa + f * (xb - xa))}${f === 1 && xb < sx.at(-1) ? "+" : ""}</span>`).join("");
  $("scatter").innerHTML = `<div class="sc-y">${escapeHTML(NAMES[m])}, ${y}${schools ? "" : `, ${METHODS[state.method].toLowerCase()}`}</div>
    <div class="sc-box">${grid}${yt}${dots}</div>
    <div class="sc-xticks">${xt}</div>
    <div class="sc-x">${escapeHTML(xlabel)}${schools ? `, ${y}` : ""}</div>`;
  const v = pearson(xs, ys, 3);
  $("scatter-caption").innerHTML = `${yLabel(y)}: correlation <b>${fmtR(v?.r)}</b> across ${idx.length} ${schools ? "schools" : "neighbourhoods"}. Each dot is ${schools ? "a school" : "a neighbourhood"}.`;
  $("scatter-key").innerHTML = schools ? TYPES.map((g) => `<li><span class="key-dot" style="background:${TYPE_COLOR[g]}"></span>${g}</li>`).join("") : "";
}

// ---- 9. every school ---------------------------------------------------------------------------------------
const COLS = [
  ["name", "School"], ["type", "Board"], ["nbhd", "Neighbourhood"], ["enrol", "Enrolment"],
  ...YEARS.map((y) => [y, yLabel(y)]), ["change", "Change"],
];
function renderList() {
  const m = state.m, [pa, pb] = [PERIODS[0], PERIODS[2]];
  const before = periodMean((y) => sv(m, y), pa), after = periodMean((y) => sv(m, y), pb);
  const f = state.filter.trim().toLowerCase();
  let rows = Array.from({ length: NS }, (_, i) => i).filter((i) => YEARS.some((y) => sv(m, y)[i] != null))
    .map((i) => ({ i, name: S.name[i], type: S.type[i], nbhd: nbhd[S.nbhd[i]].name, enrol: enrol(state.y)[i],
      ...Object.fromEntries(YEARS.map((y) => [y, sv(m, y)[i]])), change: before[i] != null && after[i] != null ? after[i] - before[i] : null }));
  const total = rows.length;
  if (f) rows = rows.filter((r) => r.name.toLowerCase().includes(f) || r.nbhd.toLowerCase().includes(f));
  const { k, dir } = state.sort;
  rows.sort((a, b) => (a[k] == null) - (b[k] == null) || (typeof a[k] === "string" ? a[k].localeCompare(b[k]) : a[k] - b[k]) * dir);
  const head = `<tr>${COLS.map(([c, t]) => `<th class="${[c === state.y ? "sel" : "", ["name", "type", "nbhd"].includes(c) ? "txt" : ""].join(" ").trim()}"><button type="button" data-k="${c}" aria-sort="${c === k ? (dir > 0 ? "ascending" : "descending") : "none"}">${t}${c === k ? (dir > 0 ? " ▲" : " ▼") : ""}</button></th>`).join("")}</tr>`;
  const body = rows.map((r) => `<tr><th>${escapeHTML(r.name)}</th><td>${r.type}</td><td class="txt">${escapeHTML(r.nbhd)}</td><td>${fmtCount(r.enrol)}</td>`
    + YEARS.map((y) => `<td class="${y === state.y ? "sel" : ""}">${r[y] == null ? "—" : r[y].toFixed(1)}</td>`).join("")
    + `<td>${r.change == null ? "—" : fmtD(r.change)}</td></tr>`).join("");
  $("list").innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
  $("list-lede").innerHTML = `${escapeHTML(LONG[m])} (percent), every school with a figure in some test year: ${f ? `${rows.length} of ${total} match` : `${total} schools`}. Enrolment is ${state.y}'s; the change is from the mean of ${pa.join(" and ")} to the mean of ${pb.join(" and ")}. Sort by any column.`;
}
$("list").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-k]");
  if (!b) return;
  const k = b.dataset.k;
  state.sort = { k, dir: state.sort.k === k ? -state.sort.dir : ["name", "type", "nbhd"].includes(k) ? 1 : -1 };
  renderList();
});
$("list-filter").addEventListener("input", (e) => {
  state.filter = e.target.value;
  renderList();
});

$("method-note").textContent = "The City's figures and the boards' are each result's mean over the schools reporting it, weighted by enrolment; the score is the mean of the six. "
  + "A school's score needs all six results. Neighbourhood figures come from pipeline/schools.py: from the nearest schools (each dissemination area's nearest public and Catholic school with each result, weighted by the boards' shares of enrolment, the areas weighted by children aged 0–14) or from the schools inside. "
  + "Correlations are Pearson's r. Changes compare the means of two test years.";

function render() {
  controls();
  renderCards();
  renderTrend();
  renderMap();
  renderRanks();
  renderSpread();
  renderStability();
  renderChanges();
  renderCorr();
  renderList();
  writeHash();
}
render();
