// The Trees and Heat page: the 2018 tree canopy, the City's street trees and Landsat
// summer surface temperature by neighbourhood, from trees.json (pipeline/trees_insights.py),
// with the outlines and 2021 Census figures from insights.json. No map tiles.
import "./style.css";
import { $, COLORS, MEASURES as CENSUS, escapeHTML, isMoney, ordinal, sign } from "./catalogue.js";
import { chart, fmtR, initPick, initTip, pearson, rColor, seg, spearman } from "./charts.js";
import { BI, INCOME as INCOMES, biKey, breaks, cls, fitLine, incomeFifths, rangeLabels, rankOrder, scatter } from "./nbtools.js";

const [D, census] = await Promise.all([
  fetch(`/trees.json?v=${__TREES_VERSION__}`).then((r) => r.json()),
  fetch(`/insights.json?v=${__INSIGHTS_VERSION__}`).then((r) => r.json()),
]);
const nbhd = census.nbhd, N = nbhd.length, INK = "#1a1a19", NB = D.nbhd;
const GREENS = ["#e3f1dc", "#bfdfae", "#8fc67c", "#5ea852", "#357f34", "#1b5221"];
// cool to hot, for surface temperature (classes, not centred on zero)
const HEAT = ["#184f95", "#3987e5", "#9ec5f4", "#f2a39b", "#d9403f", "#8f1c1c"];
const censusMeasures = Object.keys(CENSUS).filter((m) => census.measures[m]?.values["2021"]);
const OTHER = Object.fromEntries(D.other.map((o) => [o.key, o]));
const INCOME = INCOMES.filter((m) => census.measures[m]);
const sum = (vs) => vs.reduce((a, v) => a + (v ?? 0), 0);
const fmtN = (v) => (v == null ? "—" : Math.round(v).toLocaleString("en-CA"));
const fmtMoney = (v) => (v == null ? "—" : `$${Math.round(v).toLocaleString("en-CA")}`);
const fmtC = (v) => (v == null ? "—" : `${sign(+v.toFixed(1))}${Math.abs(v).toFixed(1)}°C`);

// ---- the measures ------------------------------------------------------------------------
// up: what "more" means in words; ramp: its map colours. pool(idx) is the figure for a set
// of neighbourhoods (the income fifths, the city).
const W = (vals, wts) => (idx) => sum(idx.map((i) => vals[i] * wts[i])) / sum(idx.map((i) => wts[i]));
const M = {
  canopy: { label: "Tree canopy, share of area (2018)", short: "Tree canopy", fmt: (v) => `${v.toFixed(1)}%`, axis: (v) => `${Math.round(v)}%`, ramp: GREENS, more: "More canopy", less: "Less canopy",
    pool: (idx) => (sum(idx.map((i) => NB.canopy_ha[i])) / sum(idx.map((i) => NB.area_ha[i]))) * 100, poolNote: "canopy area over land area" },
  trees_ha: { label: "Street trees per hectare", short: "Street trees per ha", fmt: (v) => v.toFixed(1), axis: (v) => v.toFixed(0), ramp: GREENS, more: "More street trees", less: "Fewer street trees",
    pool: (idx) => sum(idx.map((i) => NB.trees[i])) / sum(idx.map((i) => NB.area_ha[i])), poolNote: "trees over area" },
  large: { label: "Large street trees (trunk 50 cm or more), share", short: "Large trees", fmt: (v) => `${v.toFixed(1)}%`, axis: (v) => `${Math.round(v)}%`, ramp: GREENS, more: "More large trees", less: "Fewer large trees",
    pool: W(NB.large, NB.trees), poolNote: "weighted by street trees" },
  dbh: { label: "Median trunk diameter of street trees (cm)", short: "Median trunk", fmt: (v) => `${Math.round(v)} cm`, axis: (v) => `${Math.round(v)}`, ramp: GREENS, more: "Bigger trees", less: "Smaller trees",
    pool: W(NB.dbh, NB.trees), poolNote: "neighbourhood medians weighted by street trees" },
  heat: { label: "Summer surface temperature against the city's (Landsat, 2022–2025)", short: "Surface heat", fmt: fmtC, axis: fmtC, ramp: HEAT, more: "Hotter", hot: true,
    pool: W(NB.heat, D.pop), poolNote: "the average resident's: weighted by 2021 population" },
  lst: { label: "Summer surface temperature, midday (Landsat, 2022–2025)", short: "Surface temperature", fmt: (v) => `${v.toFixed(1)}°C`, axis: (v) => `${Math.round(v)}°`, ramp: HEAT, more: "Hotter", hot: true,
    pool: W(NB.lst, D.pop), poolNote: "the average resident's: weighted by 2021 population" },
};
const vals = (m = state.m) => NB[m];
const income = (m = state.inc) => census.measures[m].values["2021"];
const incomeUp = (m = state.inc) => m !== "lim_at";
const fmtInc = (v, m = state.inc) => (v == null ? "—" : isMoney(m) ? fmtMoney(v) : `${v.toFixed(1)}%`);
const lc = (s) => s[0].toLowerCase() + s.slice(1);

// ---- state, kept in the address ----------------------------------------------------------
const hash = new URLSearchParams(location.hash.slice(1));
const nbIndex = (id) => {
  const k = nbhd.findIndex((n) => String(n.id) === id);
  return k < 0 ? null : k;
};
const state = {
  m: M[hash.get("m")] ? hash.get("m") : "canopy",
  ov: ["measure", "both", "income"].includes(hash.get("ov")) ? hash.get("ov") : "both",
  inc: INCOME.includes(hash.get("inc")) ? hash.get("inc") : "med_hh_tot",
  sx: hash.get("sx"),
  nb: nbIndex(hash.get("nb")),
};
const writeHash = () => {
  const h = new URLSearchParams({ m: state.m, ov: state.ov, inc: state.inc, hv: [...hvState].join(",") });
  if (state.sx) h.set("sx", state.sx);
  if (state.nb != null) h.set("nb", nbhd[state.nb].id);
  history.replaceState(null, "", `#${h}`);
};
initTip();

// ---- controls ----------------------------------------------------------------------------
const select = $("measure");
select.innerHTML = [["Trees", ["canopy", "trees_ha", "large", "dbh"]], ["Heat", ["heat", "lst"]]]
  .map(([g, ms]) => `<optgroup label="${g}">${ms.map((m) => `<option value="${m}">${escapeHTML(M[m].label)}</option>`).join("")}</optgroup>`).join("");
select.addEventListener("change", () => set({ m: select.value }));
$("income").innerHTML = INCOME.map((m) => `<option value="${m}">${escapeHTML(CENSUS[m].long)}, 2021</option>`).join("");
$("income").addEventListener("change", (e) => set({ inc: e.target.value }));
function controls() {
  select.value = state.m;
  seg($("overlay"), [["measure", M[state.m].short], ["both", `${M[state.m].short} and income`], ["income", "Income"]], state.ov, (ov) => set({ ov }));
  $("income").value = state.inc;
  $("income").hidden = state.ov === "measure";
}
function set(changes) {
  Object.assign(state, changes);
  render();
}

// ---- 1. the city at a glance -----------------------------------------------------------------
function card(name, value, note) {
  return `<div class="card static" aria-label="${escapeHTML(`${name}: ${value}`)}"><span class="card-name">${name}</span><span class="card-value">${value}</span><span class="card-delta">${note}</span></div>`;
}
function renderCards() {
  const C = D.city, heat = NB.heat, hi = rankOrder(heat);
  const hot = hi[0], cool = hi.at(-1);
  $("cards").innerHTML = [
    card("Tree canopy", `${C.canopy}%`, `of the city's area in 2018: ${fmtN(C.canopy_ha / 100)} km² of ${fmtN(C.area_ha / 100)}`),
    card("Street trees", fmtN(C.trees), `City-owned trees on road allowances: ${C.trees_ha.toFixed(1)} a hectare`),
    card("Large street trees", `${C.large}%`, "have a trunk 50 cm or more across"),
    card("Shade and heat", fmtC(D.da_fit.slope_per_10), "surface temperature for every 10 more points of canopy, across the city's DAs"),
    card("Hottest neighbourhood", fmtC(heat[hot]), `${escapeHTML(nbhd[hot].name)}, against the city's summer surface temperature`),
    card("Coolest neighbourhood", fmtC(heat[cool]), `${escapeHTML(nbhd[cool].name)}; ${(heat[hot] - heat[cool]).toFixed(1)}°C cooler than the hottest`),
    card("Leafiest neighbourhood", `${M.canopy.fmt(NB.canopy[rankOrder(NB.canopy)[0]])}`, `${escapeHTML(nbhd[rankOrder(NB.canopy)[0]].name)}; the barest, ${escapeHTML(nbhd[rankOrder(NB.canopy).at(-1)].name)}, ${M.canopy.fmt(NB.canopy[rankOrder(NB.canopy).at(-1)])}`),
    card("Commonest street tree", "Norway maple", `the most common species in ${NB.species.filter((s) => s === "Maple, Norway").length} of ${N} neighbourhoods`),
  ].join("");
  $("glance-lede").innerHTML = `Tree canopy is the City's 2018 Tree Canopy Study, seen from above (crowns over roofs, roads and lawns count). Street trees are the City's own, on road allowances: no park, ravine or backyard trees. Surface temperature is what Landsat measured at about noon on ${D.passes.length} clear summer days, 2022 to 2025: the ground and roofs, not the air, which runs cooler and evener.`;
}

// ---- 2. shade and heat -------------------------------------------------------------------------
function renderShade() {
  const fit = fitLine(NB.canopy, NB.heat);
  const s = scatter({ xs: NB.canopy, ys: NB.heat, zeroY: false, fit, pick: state.nb, fx: (v) => `${Math.round(v)}%`, fy: fmtC,
    xLabel: "Tree canopy, share of area (2018)", yLabel: "Summer surface temperature against the city's",
    tip: (i) => `${nbhd[i].name}<br>Canopy: <b>${M.canopy.fmt(NB.canopy[i])}</b><br>Surface heat: <b>${fmtC(NB.heat[i])}</b>` });
  $("shade-scatter").innerHTML = s.html;
  const r = pearson(NB.canopy, NB.heat);
  $("shade-lede").innerHTML = `Each neighbourhood's canopy against its summer surface temperature, compared with the city's on the same days. The line is the fit across the neighbourhoods: <b>${fmtC(fit.slope * 10)}</b> for every 10 more points of canopy (Pearson r ${fmtR(r?.r)}). Across the city's ${fmtN(D.da_fit.n)} DAs the fit is <b>${fmtC(D.da_fit.slope_per_10)}</b> (r ${fmtR(D.da_fit.r)}), so it holds street by street too. Water, parks and ravines are cool; rail yards, malls, industrial roofs and parking lots are hot.`;
  const p = D.passes;
  $("panels").innerHTML = `<figure class="panel"><h3 class="sub-h">The days measured</h3>${chart({
    labels: p.map((x) => new Date(`${x.date}T12:00`).toLocaleDateString("en-CA", { month: "short", year: "numeric" })), fmt: (v) => `${Math.round(v)}°`, zero: false,
    tipLabel: (l, k) => `${p[k]?.date ?? l}, about noon`,
    lines: [{ name: "City mean surface temperature", color: HEAT[4], values: p.map((x) => x.city_c) }],
  })}<figcaption>The city's mean surface temperature over its clear land on each Landsat pass (${p.length} June to August days, 2022–2025, at least 90% clear). Neighbourhood figures are each pass's difference from this mean, then the median over passes, so a hot or cool day doesn't count for or against anyone.</figcaption></figure>`;
}

// ---- 3. the map ----------------------------------------------------------------------------------
const markPick = initPick($("nb-map"), $("map-pick"), () => state.nb, (i) => {
  state.nb = i;
  renderInside();
  renderHV();
  writeHash();
});
function renderMap() {
  const def = M[state.m], vs = vals(), inc = income(), order = rankOrder(vs);
  const rank = new Map(order.map((i, k) => [i, k + 1]));
  const m6 = breaks(vs), inc6 = breaks(inc), m3 = breaks(vs, 3), inc3 = breaks(inc, 3);
  const ramp = def.ramp.slice(def.ramp.length - m6.edges.length - 1), blues = COLORS.slice(COLORS.length - inc6.edges.length - 1);
  const biCell = (i) => {
    let ic = cls(inc3.edges, inc[i]);
    if (!incomeUp()) ic = 2 - ic;
    // columns run toward the concern: less of the trees, more of the heat
    const mc = cls(m3.edges, vs[i]);
    return BI[ic][def.hot ? mc : 2 - mc];
  };
  const fill = (i) => (state.ov === "income" ? (inc[i] == null ? "url(#nb-hatch)" : blues[cls(inc6.edges, inc[i])])
    : state.ov === "both" ? (inc[i] == null ? "url(#nb-hatch)" : biCell(i)) : ramp[cls(m6.edges, vs[i])]);
  const shapes = nbhd.map((n, i) => {
    const t = `${escapeHTML(n.name)}<br>${escapeHTML(def.short)}: <b>${def.fmt(vs[i])}</b> · ${ordinal(rank.get(i))} of ${N}<br>Canopy ${M.canopy.fmt(NB.canopy[i])} · heat ${fmtC(NB.heat[i])}<br>${escapeHTML(CENSUS[state.inc].short)}: <b>${fmtInc(inc[i])}</b><br>Commonest street tree: ${escapeHTML(NB.species[i] || "—")}`;
    return `<path d="${n.path}" fill="${fill(i)}" data-i="${i}" data-tip="${t}"/>`;
  }).join("");
  $("nb-map").innerHTML = `<svg viewBox="0 0 ${census.map.width} ${census.map.height}" role="img" aria-label="${escapeHTML(`Map of the neighbourhoods by ${lc(def.label)}${state.ov === "measure" ? "" : " and income"}`)}">
    <defs><pattern id="nb-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#f0f0ec"/><line x1="0" y1="0" x2="0" y2="8" stroke="#c9c9c3" stroke-width="3"/></pattern></defs>
    <g>${shapes}</g></svg>`;
  const incName = CENSUS[state.inc].long;
  const fi = (v) => (isMoney(state.inc) ? `$${Math.round(v / 1000)}k` : `${v.toFixed(1)}%`);
  if (state.ov === "both") {
    $("map-key").innerHTML = "";
    const ii = rangeLabels(inc3.edges, inc3.zero, fi);
    $("bi-key").hidden = false;
    const mr = rangeLabels(m3.edges, m3.zero, def.fmt);
    $("bi-key").innerHTML = biKey({ xName: def.label, xRanges: def.hot ? mr : [...mr].reverse(), xArrow: `${def.hot ? def.more : def.less} →`,
      yName: `${incName}, 2021`, yRanges: incomeUp() ? ii : [...ii].reverse(), yArrow: incomeUp() ? "Higher income ↑" : "Less low income ↑" });
    $("map-lede").innerHTML = `${escapeHTML(def.label)}, against ${escapeHTML(lc(incName)).replace("lim-at", "LIM-AT")} in 2021: each in thirds of the neighbourhoods. Reds are ${def.hot ? "hotter ground" : escapeHTML(lc(def.less))} with lower income; teals higher income with ${def.hot ? "cooler ground" : escapeHTML(lc(def.more))}; the darkest corner, ${def.hot ? "hot ground with higher income" : `${escapeHTML(lc(def.less))} with higher income`}. Hover for figures.`;
  } else {
    $("bi-key").hidden = true;
    const [b, colours, f] = state.ov === "income" ? [inc6, blues, fi] : [m6, ramp, def.fmt];
    $("map-key").innerHTML = rangeLabels(b.edges, b.zero, f).map((l, k) => `<li><span class="key-sq" style="background:${colours[k]}"></span>${escapeHTML(l)}</li>`).join("")
      + (state.ov === "income" && inc.some((v) => v == null) ? `<li><span class="key-sq hatch"></span>No figure</li>` : "");
    $("map-lede").innerHTML = state.ov === "income" ? `${escapeHTML(incName)}, 2021 Census, in sixths of the neighbourhoods. Hover for the tree and heat figures too.`
      : `${escapeHTML(def.label)}, in sixths of the neighbourhoods.${def.hot ? " Neighbourhoods 1 and 2 (the north-west corner) rest on 4 or 5 passes rather than up to 11." : ""}`;
  }
  markPick();
}

// ---- 4. by neighbourhood income -------------------------------------------------------------------
function renderIncome() {
  const inc = income(), { idx, fifths } = incomeFifths(inc, incomeUp());
  const range = (g) => {
    const v = g.map((i) => inc[i]).sort((a, b) => a - b);
    return `${fmtInc(v[0])}–${fmtInc(v.at(-1))}`;
  };
  const rows = Object.entries(M).map(([k, def]) => {
    const rs = fifths.map((g) => def.pool(g)), city = def.pool(idx);
    const lo = Math.min(...rs), hi = Math.max(...rs), ramp = def.ramp;
    const cells = rs.map((r, q) => {
      const c5 = Math.min(5, Math.floor((hi > lo ? (r - lo) / (hi - lo) : 0) * 6));
      return `<td style="background:${ramp[c5]};color:${c5 >= 3 || (def.hot && c5 === 0) ? "#fff" : INK}" data-tip="${escapeHTML(`${def.short}<br>${["Lowest", "Second", "Middle", "Fourth", "Highest"][q]} income fifth: <b>${def.fmt(r)}</b><br>${def.poolNote}`)}">${def.fmt(r)}</td>`;
    }).join("");
    const gap = rs[4] - rs[0];
    return `<tr${k === state.m ? ' class="sel"' : ""}><th>${escapeHTML(def.short)}</th>${cells}<td>${def.fmt(city)}</td><td><b>${def.hot || k === "canopy" || k === "large" ? `${sign(+gap.toFixed(1))}${Math.abs(gap).toFixed(1)}${def.hot ? "°C" : " pts"}` : `${(rs[4] / rs[0]).toFixed(2)}×`}</b></td></tr>`;
  }).join("");
  const head = ["Lowest", "Second", "Middle", "Fourth", "Highest"].map((n, q) => `<th>${n}<br><span class="small">${range(fifths[q])}</span></th>`).join("");
  $("inc-table").innerHTML = `<thead><tr><th>Measure</th>${head}<th>City</th><th>Highest vs lowest</th></tr></thead><tbody>${rows}</tbody>`;
  const can = fifths.map((g) => M.canopy.pool(g)), heat = fifths.map((g) => M.heat.pool(g));
  $("inc-lede").innerHTML = `The neighbourhoods in fifths by ${escapeHTML(lc(CENSUS[state.inc].long)).replace("lim-at", "LIM-AT")} (2021 Census${incomeUp() ? "" : "; the lowest-income fifth has the most people in low income"}), about 31 each, and each measure for the fifth as a whole. The best-off fifth has <b>${(can[4] - can[0]).toFixed(1)}</b> more points of canopy than the least well off, and its average resident's summer ground is <b>${Math.abs(heat[4] - heat[0]).toFixed(1)}°C ${heat[4] < heat[0] ? "cooler" : "warmer"}</b>.`;
  $("inc-note").textContent = "Shading runs along each row, from the fifth with the least to the most. Canopy and street trees per hectare pool the fifth's area; heat is the average resident's (each neighbourhood weighted by its 2021 population), so a large, empty industrial area doesn't count for more than where people live.";
}

// ---- 5. highest and lowest -------------------------------------------------------------------------
function renderRanks() {
  const def = M[state.m], vs = vals(), order = rankOrder(vs), inc = income();
  const lo = Math.min(0, ...vs), hi = Math.max(...vs);
  const row = (i, k) => {
    const w = ((vs[i] - lo) / (hi - lo || 1)) * 100;
    return `<li><span class="rk">${k}</span><button type="button" class="nm" data-nb="${i}" title="Find ${escapeHTML(nbhd[i].name)} on the map">${escapeHTML(nbhd[i].name)}</button>
      <span class="barcell" data-tip="${escapeHTML(`${nbhd[i].name}<br><b>${def.fmt(vs[i])}</b><br>${CENSUS[state.inc].short}: ${fmtInc(inc[i])}`)}"><span class="bar-fill" style="width:${w.toFixed(1)}%;background:${def.ramp[4]}"></span></span>
      <span class="vl">${def.fmt(vs[i])}</span><span class="move"></span></li>`;
  };
  $("rank-top").innerHTML = order.slice(0, 10).map((i, k) => row(i, k + 1)).join("");
  $("rank-bottom").innerHTML = order.slice(-10).reverse().map((i, k) => row(i, N - k)).join("");
  $("rank-lede").innerHTML = `${escapeHTML(def.label)}. Pick a name to find it on the map.`;
}

// ---- 6. what goes with what --------------------------------------------------------------------------
const corrX = (k) => {
  const [t, m] = k.split(":");
  return t === "c" ? { label: CENSUS[m].long, short: CENSUS[m].short, values: census.measures[m].values["2021"], unit: isMoney(m) ? "money" : "pct", year: "2021 Census" }
    : { label: OTHER[m].label, short: OTHER[m].short, values: OTHER[m].values, unit: OTHER[m].unit };
};
const fmtU = (u, v, short) => (v == null ? "—" : u === "money" ? (short ? `$${Math.round(v / 1000)}k` : fmtMoney(v)) : u === "pct" ? `${v.toFixed(short ? 0 : 1)}%` : v.toFixed(short ? 0 : 1));
function corrItem(k, v) {
  const r = v.r, w = Math.abs(r) * 50, x = corrX(k);
  return `<li><button type="button" data-x="${k}" class="${state.sx === k ? "pick" : ""}">
      <span class="cl-name">${escapeHTML(x.label)}</span>
      <span class="cl-bar"><span class="cl-zero"></span><span class="cl-fill" style="${r >= 0 ? "left:50%" : `left:${50 - w}%`};width:${w}%;background:${rColor(r)}"></span></span>
      <span class="cl-val">${fmtR(r)}</span></button></li>`;
}
function renderCorr() {
  const def = M[state.m], vs = vals();
  const rc = censusMeasures.map((m) => ({ k: `c:${m}`, v: spearman(vs, census.measures[m].values["2021"]) })).filter((r) => r.v).sort((a, b) => b.v.r - a.v.r);
  const ro = D.other.map((o) => ({ k: `o:${o.key}`, v: spearman(vs, o.values) })).filter((r) => r.v).sort((a, b) => b.v.r - a.v.r);
  if (![...rc, ...ro].some((r) => r.k === state.sx)) state.sx = `c:${state.inc}`;
  $("census-list").innerHTML = rc.map(({ k, v }) => corrItem(k, v)).join("");
  $("other-list").innerHTML = ro.map(({ k, v }) => corrItem(k, v)).join("");
  $("corr-lede").innerHTML = `How closely ${escapeHTML(lc(def.label))} follows each measure across the neighbourhoods: Spearman rank correlation, 1 the same order, −1 the reverse. Much of it runs through what the measures share: older, lower-density, owner-occupied neighbourhoods have bigger trees and more canopy. Choose a measure to see its neighbourhoods.`;
  const x = corrX(state.sx);
  const s = scatter({ xs: x.values, ys: vs, pick: state.nb, zeroX: false, zeroY: !def.hot, fx: (v) => fmtU(x.unit, v, true), fy: def.axis,
    xLabel: `${escapeHTML(x.label)}${x.year ? `, ${x.year}` : ""}`, yLabel: escapeHTML(def.label),
    tip: (i) => `${nbhd[i].name}<br>${x.short}: <b>${fmtU(x.unit, x.values[i])}</b><br>${def.short}: <b>${def.fmt(vs[i])}</b>` });
  $("scatter").innerHTML = s.html;
  $("scatter-caption").innerHTML = `Spearman <b>${fmtR(spearman(vs, x.values)?.r)}</b> across ${s.n} neighbourhoods. Each dot is a neighbourhood; the axes end at the 98th percentile.`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-x]");
  if (!b) return;
  state.sx = b.dataset.x;
  renderCorr();
  writeHash();
  $("scatter-fig").scrollIntoView({ behavior: "smooth", block: "nearest" });
});

$("method-note").textContent = `Built ${D.built} from files retrieved ${D.retrieved}. Canopy and street trees are placed in 2021 DAs and summed to neighbourhoods; `
  + "surface temperature is Landsat 8/9 Collection 2 Level-2 thermal data, recomputed with emissivity from vegetation where USGS's surface temperature band is empty (about 28% of the city), "
  + "which reads about 0.6°C cooler than USGS's where both exist. Map classes are sixths (thirds when crossed with income) of the neighbourhoods. Correlations are Spearman's.";

// ---- 4. inside the neighbourhood: its DAs ----------------------------------------------------------
// trees_da.json is fetched when the section nears the screen. DAs are coloured on classes of all
// the city's DAs, so a colour means the same in every neighbourhood.
let DA = null, daBreaks = {};
const widest = rankOrder(D.spread);
const inNb = () => state.nb ?? widest[0];
$("in-nb").innerHTML = [...nbhd.keys()].sort((a, b) => nbhd[a].name.localeCompare(nbhd[b].name))
  .map((i) => `<option value="${i}">${escapeHTML(nbhd[i].name)}</option>`).join("");
$("in-nb").addEventListener("change", (e) => {
  state.nb = +e.target.value;
  render();
});
new IntersectionObserver(async (entries, obs) => {
  if (!entries.some((e) => e.isIntersecting)) return;
  obs.disconnect();
  DA = await fetch(`/trees_da.json?v=${__TREES_DA_VERSION__}`).then((r) => r.json());
  for (const m of Object.keys(M)) daBreaks[m] = breaks(DA.nbhd.flatMap((n) => n[m]));
  renderInside();
}, { rootMargin: "600px 0px" }).observe($("inside"));
const quant = (vs, q) => {
  const s = vs.filter((v) => v != null).sort((a, b) => a - b);
  const pos = (s.length - 1) * q, lo = Math.floor(pos);
  return s[lo] + (s[Math.ceil(pos)] - s[lo]) * (pos - lo);
};
function renderInside() {
  const i = inNb(), def = M[state.m];
  $("in-nb").value = i;
  renderSpread();
  if (!DA) return;
  const n = DA.nbhd[i], vs = n[state.m], b = daBreaks[state.m];
  const ramp = def.ramp.slice(def.ramp.length - b.edges.length - 1);
  const heat = n.heat, okH = heat.map((v, k) => (v == null ? null : k)).filter((k) => k != null);
  const hot = okH.reduce((a, k) => (heat[k] > heat[a] ? k : a), okH[0]), cool = okH.reduce((a, k) => (heat[k] < heat[a] ? k : a), okH[0]);
  const shapes = n.path.map((d, k) => {
    const t = `DA ${n.dauid[k]}<br>${escapeHTML(def.short)}: <b>${vs[k] == null ? "—" : def.fmt(vs[k])}</b><br>Canopy ${n.canopy[k] == null ? "—" : M.canopy.fmt(n.canopy[k])} · heat ${fmtC(heat[k])}<br>${fmtN(n.pop[k])} residents`;
    return `<path d="${d}" fill="${vs[k] == null ? "url(#da-hatch)" : ramp[cls(b.edges, vs[k])]}"${k === hot ? ' class="hot"' : k === cool ? ' class="cool"' : ""} data-tip="${escapeHTML(t)}"/>`;
  });
  // the hottest and coolest DAs drawn last, so their outlines show
  const order = [...n.path.keys()].filter((k) => k !== hot && k !== cool).concat([cool, hot]);
  $("da-map").innerHTML = `<svg viewBox="-2 -2 ${n.w + 4} ${n.h + 4}" role="img" aria-label="${escapeHTML(`${nbhd[i].name}'s DAs by ${lc(def.label)}`)}">
    <defs><pattern id="da-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f0f0ec"/><line x1="0" y1="0" x2="0" y2="6" stroke="#c9c9c3" stroke-width="2"/></pattern></defs>
    ${order.map((k) => shapes[k]).join("")}</svg>`;
  $("in-key").innerHTML = rangeLabels(b.edges, b.zero, def.fmt).map((l, k) => `<li><span class="key-sq" style="background:${ramp[k]}"></span>${escapeHTML(l)}</li>`).join("")
    + `<li><span class="key-sq" style="background:#fff;box-shadow:inset 0 0 0 2px ${INK}"></span>Hottest and coolest DA</li>`;
  const r = pearson(n.canopy, heat, 8);
  const p10 = quant(heat, 0.1), p90 = quant(heat, 0.9), city = D.spread;
  const rank = rankOrder(city).indexOf(i) + 1;
  $("in-stats").innerHTML = `<dt>DAs</dt><dd>${n.dauid.length} · ${fmtN(sum(n.pop))} residents</dd>
    <dt>Neighbourhood</dt><dd>canopy ${M.canopy.fmt(NB.canopy[i])} · heat ${fmtC(NB.heat[i])}</dd>
    <dt>Hottest DA</dt><dd>${fmtC(heat[hot])} · canopy ${M.canopy.fmt(n.canopy[hot])} · ${fmtN(n.pop[hot])} residents</dd>
    <dt>Coolest DA</dt><dd>${fmtC(heat[cool])} · canopy ${M.canopy.fmt(n.canopy[cool])} · ${fmtN(n.pop[cool])} residents</dd>
    <dt>Heat gap</dt><dd><b>${(p90 - p10).toFixed(1)}°C</b> between its 10th and 90th percentile DAs ${rank ? `(${ordinal(rank)} widest of ${widest.length})` : "(too few DAs to rank)"}</dd>
    <dt>Canopy and heat</dt><dd>${r ? `Pearson r <b>${fmtR(r.r)}</b> across its DAs` : "too few DAs to say"}</dd>`;
  $("in-lede").innerHTML = `${escapeHTML(nbhd[i].name)}'s ${n.dauid.length} dissemination areas by ${escapeHTML(lc(def.label))}, on the same classes as all the city's DAs (so a colour means the same in every neighbourhood). Heat is against the city's on the same days, as above; a DA is a few blocks, but the thermal pixels are 100 m, so a small DA's figure includes its surroundings. Pick a neighbourhood on the map or from the list.`;
}
function renderSpread() {
  const order = widest.slice(0, 10), max = D.spread[order[0]];
  $("spread-list").innerHTML = order.map((i, k) => `<li><span class="rk">${k + 1}</span><button type="button" class="nm" data-in="${i}">${escapeHTML(nbhd[i].name)}</button>
    <span class="barcell"><span class="bar-fill" style="width:${((D.spread[i] / max) * 100).toFixed(1)}%;background:${HEAT[4]}"></span></span><span class="vl">${D.spread[i].toFixed(1)}°C</span><span class="move"></span></li>`).join("");
  $("spread-note").textContent = `The difference between each neighbourhood's 10th and 90th percentile DA in summer surface heat, for the ${widest.length} with 12 DAs or more. The typical neighbourhood's is ${quant(D.spread, 0.5).toFixed(1)}°C. Pick one to see it.`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-in]");
  if (!b) return;
  state.nb = +b.dataset.in;
  render();
  $("inside").scrollIntoView({ behavior: "smooth", block: "start" });
});

// ---- 5. hot and vulnerable ---------------------------------------------------------------------------
// A neighbourhood's vulnerability is the mean of its percentile ranks on the chosen census measures;
// "hot and vulnerable" is the top third of the neighbourhoods on both that and surface heat.
const FACTORS = [
  ["age65", "People 65 and over", true], ["lim_at", "People in low income", true], ["apt5", "Homes in apartments of 5+ storeys", true],
  ["renter", "Renter households", false], ["crowded", "Crowded housing", false], ["age0_14", "Children 0 to 14", false],
];
const pctRank = (vs) => {
  const s = vs.filter((v) => v != null).sort((a, b) => a - b);
  return vs.map((v) => (v == null ? null : (s.filter((x) => x < v).length + s.filter((x) => x === v).length / 2) / s.length * 100));
};
const hvState = new Set((hash.get("hv") ?? FACTORS.filter((f) => f[2]).map((f) => f[0]).join(",")).split(",").filter((k) => FACTORS.some((f) => f[0] === k)));
if (!hvState.size) hvState.add("age65");
$("hv-factors").insertAdjacentHTML("beforeend", FACTORS.map(([k, l]) => `<label><input type="checkbox" value="${k}"${hvState.has(k) ? " checked" : ""}/> ${escapeHTML(l)}</label>`).join(""));
$("hv-factors").addEventListener("change", (e) => {
  if (e.target.checked) hvState.add(e.target.value);
  else if (hvState.size > 1) hvState.delete(e.target.value);
  else e.target.checked = true; // at least one
  renderHV();
  writeHash();
});
function renderHV() {
  const ks = [...hvState], ranks = ks.map((k) => pctRank(census.measures[k].values["2021"]));
  const vuln = nbhd.map((_, i) => sum(ranks.map((r) => r[i])) / ks.length), heatR = pctRank(NB.heat);
  const v3 = breaks(vuln, 3), h3 = breaks(NB.heat, 3);
  const both = nbhd.map((_, i) => cls(v3.edges, vuln[i]) === 2 && cls(h3.edges, NB.heat[i]) === 2);
  const idx = [...nbhd.keys()].filter((i) => both[i]).sort((a, b) => (vuln[b] + heatR[b]) - (vuln[a] + heatR[a]));
  const names = ks.map((k) => lc(FACTORS.find((f) => f[0] === k)[1]));
  const fmtList = (xs) => (xs.length < 2 ? xs[0] : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
  // the map: heat (columns) against vulnerability (rows, the most vulnerable at the bottom, where the reds are)
  const shapes = nbhd.map((n, i) => {
    const t = `${escapeHTML(n.name)}<br>Surface heat: <b>${fmtC(NB.heat[i])}</b><br>Vulnerability: <b>${Math.round(vuln[i])}</b> of 100<br>${ks.map((k) => `${escapeHTML(CENSUS[k].short)}: ${census.measures[k].values["2021"][i].toFixed(1)}%`).join("<br>")}`;
    return `<path d="${n.path}" fill="${BI[2 - cls(v3.edges, vuln[i])][cls(h3.edges, NB.heat[i])]}"${both[i] ? ' class="hv-out"' : ""} data-tip="${t}"/>`;
  });
  const order = [...nbhd.keys()].filter((i) => !both[i]).concat(idx);
  $("hv-map").innerHTML = `<svg viewBox="0 0 ${census.map.width} ${census.map.height}" role="img" aria-label="Map of the neighbourhoods by surface heat and vulnerability">${order.map((i) => shapes[i]).join("")}</svg>`;
  const vr = rangeLabels(v3.edges, false, (v) => String(Math.round(v)));
  $("hv-key").innerHTML = biKey({ xName: "Summer surface heat against the city's", xRanges: rangeLabels(h3.edges, false, fmtC), xArrow: "Hotter →",
    yName: "Vulnerability score, 0 to 100", yRanges: [...vr].reverse(), yArrow: "Less vulnerable ↑" })
    + `<p class="tbl-note">Outlined: the top third on both.</p>`;
  const s = scatter({ xs: vuln, ys: NB.heat, zeroX: true, zeroY: false, fx: (v) => String(Math.round(v)), fy: fmtC, pick: state.nb,
    guides: { x: v3.edges[1], y: h3.edges[1] }, mark: (i) => (both[i] ? " hv" : ""),
    xLabel: `Vulnerability score: the mean percentile rank on ${escapeHTML(fmtList(names))}`, yLabel: "Summer surface heat against the city's",
    tip: (i) => `${nbhd[i].name}<br>Vulnerability: <b>${Math.round(vuln[i])}</b><br>Surface heat: <b>${fmtC(NB.heat[i])}</b>` });
  $("hv-scatter").innerHTML = s.html;
  const pop = sum(idx.map((i) => D.pop[i])), seniors = sum(idx.map((i) => (D.pop[i] * census.measures.age65.values["2021"][i]) / 100));
  const r = spearman(vuln, NB.heat)?.r;
  $("hv-lede").innerHTML = `Heat harms some people more than others: older people, people with less money to cool their homes, and people in high-rise apartments, which hold heat and often lack air conditioning (the census doesn't ask about it). Each neighbourhood's vulnerability score is the mean of its percentile ranks on ${escapeHTML(fmtList(names))}; <b>${idx.length}</b> neighbourhoods are in the top third on both that and summer surface heat, home to <b>${fmtN(pop)}</b> people${hvState.has("age65") ? `, about ${fmtN(Math.round(seniors / 100) * 100)} of them 65 or over` : ""}. Across all ${N}, vulnerability and heat go together at Spearman <b>${fmtR(r)}</b>${Math.abs(r) < 0.2 ? ": hardly at all, so the hot and vulnerable are a particular set of places, not the rule" : r > 0 ? ": the more vulnerable places tend to be hotter" : ": the more vulnerable places tend to be cooler"}. On the map, red is hot and vulnerable; dark, hot and less vulnerable; teal, cooler and less vulnerable; light grey, vulnerable but cooler. Tick the measures to count.`;
  $("hv-list-h").textContent = `The ${idx.length} hot and vulnerable neighbourhoods`;
  $("hv-table").innerHTML = `<thead><tr><th>Neighbourhood</th><th>Heat</th><th>Score</th>${ks.map((k) => `<th>${escapeHTML(CENSUS[k].short)}</th>`).join("")}<th>Canopy</th><th>Residents</th></tr></thead><tbody>${idx.map((i) => `<tr><th><button type="button" class="nm" data-nb="${i}">${escapeHTML(nbhd[i].name)}</button></th><td>${fmtC(NB.heat[i])}</td><td>${Math.round(vuln[i])}</td>${ks.map((k) => `<td>${census.measures[k].values["2021"][i].toFixed(1)}%</td>`).join("")}<td>${M.canopy.fmt(NB.canopy[i])}</td><td>${fmtN(D.pop[i])}</td></tr>`).join("")}</tbody>`;
  $("hv-note").textContent = "Sorted by heat and vulnerability rank together. Neighbourhood figures describe places, not people: not everyone in a hot, vulnerable neighbourhood is at risk, nor everyone at risk in one. Surface heat is the ground and roofs at midday, not the air indoors at night, which is what does most harm in a heat wave.";
}

function render() {
  controls();
  renderMap();
  renderIncome();
  renderRanks();
  renderCorr();
  renderShade();
  renderInside();
  renderHV();
  writeHash();
}
renderCards();
render();
