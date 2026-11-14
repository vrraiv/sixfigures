// The Trees and Heat page: the 2018 tree canopy, the City's street trees and Landsat
// summer surface temperature by neighbourhood, from trees.json (pipeline/trees_insights.py),
// with the outlines and 2021 Census figures from insights.json. No map tiles.
import "./style.css";
import { $, COLORS, MEASURES as CENSUS, escapeHTML, isMoney, ordinal, sign, loadJSON, loadFailed, own } from "./catalogue.js";
import { cellStyle, chart, fmtR, initPick, initTip, pearson, rColor, seg, spearman } from "./charts.js";
import { addressFinder } from "./addressfinder.js";
import { BI, INCOME as INCOMES, biKey, breaks, breaksAboutZero, buildToc, cls, fillFinder, fitLine, incomeFifths, rangeLabels, rankOrder, scatter } from "./nbtools.js";

const [D, census] = await Promise.all([
  loadJSON(`/trees.json?v=${__TREES_VERSION__}`),
  loadJSON(`/insights.json?v=${__INSIGHTS_VERSION__}`),
]).catch(loadFailed);
const nbhd = census.nbhd, N = nbhd.length, INK = "#1a1a19", NB = D.nbhd;
const GREENS = ["#e3f1dc", "#bfdfae", "#8fc67c", "#5ea852", "#357f34", "#1b5221"];
// cool to hot, for surface temperature (classes, not centred on zero)
const HEAT = ["#184f95", "#3987e5", "#9ec5f4", "#f2a39b", "#d9403f", "#8f1c1c"];
// lost to gained, for canopy change
const GAIN = ["#8f1c1c", "#d9403f", "#f2a39b", "#bfdfae", "#5ea852", "#1b5221"];
const ORANGES = ["#fdebd3", "#fbcf9e", "#f6a85c", "#e57f2a", "#c25e12", "#8a3f0a"];
const censusMeasures = Object.keys(CENSUS).filter((m) => census.measures[m]?.values["2021"]);
const OTHER = Object.fromEntries(D.other.map((o) => [o.key, o]));
const INCOME = INCOMES.filter((m) => census.measures[m]);
const sum = (vs) => vs.reduce((a, v) => a + (v ?? 0), 0);
const fmtN = (v) => (v == null ? "—" : Math.round(v).toLocaleString("en-CA"));
const fmtMoney = (v) => (v == null ? "—" : `$${Math.round(v).toLocaleString("en-CA")}`);
const fmtC = (v) => (v == null ? "—" : `${sign(+v.toFixed(1))}${Math.abs(v).toFixed(1)}°C`);

// ---- the measures ------------------------------------------------------------------------
// more/less: the words for each end; bad: whether more is the concern (the red end on the
// bivariate map); ramp: its map colours; gap: how the income table states highest vs lowest
// fifth; da: false where there's no DA figure. pool(idx) is the figure for a set of
// neighbourhoods (the income fifths, the city).
const W = (vals, wts) => (idx) => sum(idx.map((i) => vals[i] * wts[i])) / sum(idx.map((i) => wts[i]));
const M = {
  canopy: { label: "Tree canopy, share of area (2018)", short: "Tree canopy", fmt: (v) => `${v.toFixed(1)}%`, axis: (v) => `${Math.round(v)}%`, ramp: GREENS, more: "More canopy", less: "Less canopy", gap: "pts",
    pool: (idx) => (sum(idx.map((i) => NB.canopy_ha[i])) / sum(idx.map((i) => NB.area_ha[i]))) * 100, poolNote: "canopy area over land area" },
  trees_ha: { label: "Street trees per hectare", short: "Street trees per ha", fmt: (v) => v.toFixed(1), axis: (v) => v.toFixed(0), ramp: GREENS, more: "More street trees", less: "Fewer street trees", gap: "x",
    pool: (idx) => sum(idx.map((i) => NB.trees[i])) / sum(idx.map((i) => NB.area_ha[i])), poolNote: "trees over area" },
  large: { label: "Large street trees (trunk 50 cm or more), share", short: "Large trees", fmt: (v) => `${v.toFixed(1)}%`, axis: (v) => `${Math.round(v)}%`, ramp: GREENS, more: "More large trees", less: "Fewer large trees", gap: "pts",
    pool: W(NB.large, NB.trees), poolNote: "weighted by street trees" },
  dbh: { label: "Median trunk diameter of street trees (cm)", short: "Median trunk", fmt: (v) => `${Math.round(v)} cm`, axis: (v) => `${Math.round(v)}`, ramp: GREENS, more: "Bigger trees", less: "Smaller trees", gap: "x",
    pool: W(NB.dbh, NB.trees), poolNote: "neighbourhood medians weighted by street trees" },
  heat: { label: "Summer surface temperature against the city's (Landsat, 2022–2025)", short: "Surface heat", fmt: fmtC, axis: fmtC, ramp: HEAT, more: "Hotter ground", less: "Cooler ground", bad: true, hot: true, gap: "C",
    pool: W(NB.heat, D.pop), poolNote: "the average resident's: weighted by 2021 population" },
  lst: { label: "Summer surface temperature, midday (Landsat, 2022–2025)", short: "Surface temperature", fmt: (v) => `${v.toFixed(1)}°C`, axis: (v) => `${Math.round(v)}°`, ramp: HEAT, more: "Hotter ground", less: "Cooler ground", bad: true, hot: true, gap: "C",
    pool: W(NB.lst, D.pop), poolNote: "the average resident's: weighted by 2021 population" },
  shannon: { label: "Street-tree species diversity (Shannon index)", short: "Species diversity", fmt: (v) => v.toFixed(2), axis: (v) => v.toFixed(1), ramp: GREENS,
    more: "More diverse", less: "Less diverse", gap: "d", da: false, pool: W(NB.shannon, NB.trees), poolNote: "weighted by street trees" },
  maple: { label: "Norway maple, share of street trees", short: "Norway maple", fmt: (v) => `${v.toFixed(1)}%`, axis: (v) => `${Math.round(v)}%`, ramp: ORANGES,
    more: "More Norway maple", less: "Less Norway maple", bad: true, gap: "pts", da: false, pool: W(NB.maple, NB.trees), poolNote: "weighted by street trees" },
  genus: { label: "Commonest genus, share of street trees", short: "Commonest genus", fmt: (v) => `${v.toFixed(1)}%`, axis: (v) => `${Math.round(v)}%`, ramp: ORANGES,
    more: "More of one genus", less: "Less of one genus", bad: true, gap: "pts", da: false, pool: W(NB.genus, NB.trees), poolNote: "weighted by street trees" },
  gap_pts: { label: "Canopy short of 40% of the area (points)", short: "Points short of 40%", fmt: (v) => `${v.toFixed(1)} pts`, axis: (v) => `${Math.round(v)}`, ramp: ORANGES,
    more: "Further from 40%", less: "Closer to 40%", bad: true, gap: "pts", da: false,
    pool: (idx) => Math.max(0, D.goal.target - M.canopy.pool(idx)), poolNote: "40% less the fifth's pooled canopy" },
  gap_ha: { label: "Canopy short of 40% of the area (hectares)", short: "Hectares short of 40%", fmt: (v) => `${fmtN(v)} ha`, axis: (v) => fmtN(v), ramp: ORANGES,
    more: "Further from 40%", less: "Closer to 40%", bad: true, gap: "x", da: false,
    pool: (idx) => sum(idx.map((i) => NB.gap_ha[i])), poolNote: "the fifth's neighbourhoods' gaps added up" },
  chg: { label: "Canopy change against the city's, 2008 to 2018 (points)", short: "Canopy change", fmt: (v) => `${sign(+v.toFixed(1))}${Math.abs(v).toFixed(1)} pts`,
    axis: (v) => `${sign(+v.toFixed(0))}${Math.abs(v).toFixed(0)}`, ramp: GAIN, about0: true, more: "Gained canopy against the city", less: "Lost canopy against the city", gap: "pts", da: false,
    pool: W(NB.chg, NB.area_ha), poolNote: "weighted by area; tree class in both years" },
};
const vals = (m = state.m) => NB[m];
// The neighbourhoods whose heat figure rests on fewer Landsat passes than most (the satellite's
// path clips the north-west corner), from the pass counts in the data rather than from memory.
function fewPasses() {
  const most = Math.max(...NB.scenes);
  const few = nbhd.map((n, i) => ({ name: n.name, n: NB.scenes[i] })).filter((x) => x.n < most);
  if (!few.length) return "";
  const names = few.map((x) => `${escapeHTML(x.name)} (${x.n})`);
  const listed = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  return ` Fewer passes cover ${listed} than the ${most} behind every other neighbourhood's figure.`;
}
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
  m: own(M, hash.get("m")) ? hash.get("m") : "canopy",
  ov: ["measure", "both", "income"].includes(hash.get("ov")) ? hash.get("ov") : "both",
  inc: INCOME.includes(hash.get("inc")) ? hash.get("inc") : "med_hh_tot",
  sx: hash.get("sx"),
  nb: nbIndex(hash.get("nb")),
};
const writeHash = () => {
  const h = new URLSearchParams({ m: state.m, ov: state.ov, inc: state.inc, hv: [...hvState].join(","), gs: goalSort, cb: ccBasis, day: DAYS[day].date });
  if (state.sx) h.set("sx", state.sx);
  if (state.nb != null) h.set("nb", nbhd[state.nb].id);
  history.replaceState(null, "", `#${h}`);
};
initTip();

// ---- controls ----------------------------------------------------------------------------
const select = $("measure");
select.innerHTML = [["Trees", ["canopy", "trees_ha", "large", "dbh"]], ["Toward 40% canopy", ["gap_pts", "gap_ha", "chg"]], ["What's planted", ["shannon", "maple", "genus"]], ["Heat", ["heat", "lst"]]]
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
  render();
});
// The page's other maps pick a neighbourhood too, and every map marks the one picked.
const OTHER_MAPS = ["hv-map", "day-map", "cc-map"];
document.addEventListener("click", (e) => {
  const p = e.target.closest(".nb-map path[data-i]");
  if (!p || $("nb-map").contains(p)) return;
  state.nb = state.nb === +p.dataset.i ? null : +p.dataset.i;
  render();
});
function markOtherMaps() {
  for (const id of OTHER_MAPS) {
    const fig = $(id), p = state.nb == null ? null : fig.querySelector(`path[data-i="${state.nb}"]`);
    fig.classList.toggle("has-pick", !!p);
    if (p) {
      p.classList.add("pick");
      p.parentNode.append(p);
    }
  }
}
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
  const def = M[state.m], vs = vals(), inc = income(), order = rankOrder(vs);
  const rank = new Map(order.map((i, k) => [i, k + 1]));
  // a change's classes meet at zero (red below, green from zero up), not at the median neighbourhood
  const m6 = def.about0 ? breaksAboutZero(vs) : breaks(vs), inc6 = breaks(inc), m3 = breaks(vs, 3), inc3 = breaks(inc, 3);
  const ramp = def.ramp.slice(def.ramp.length - m6.edges.length - 1), blues = COLORS.slice(COLORS.length - inc6.edges.length - 1);
  const biCell = (i) => {
    let ic = cls(inc3.edges, inc[i]);
    if (!incomeUp()) ic = 2 - ic;
    // columns run toward the concern: less of the trees, more of the heat
    const mc = cls(m3.edges, vs[i]);
    return BI[ic][def.bad ? mc : 2 - mc];
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
    $("bi-key").innerHTML = biKey({ xName: def.label, xRanges: def.bad ? mr : [...mr].reverse(), xArrow: `${def.bad ? def.more : def.less} →`,
      yName: `${incName}, 2021`, yRanges: incomeUp() ? ii : [...ii].reverse(), yArrow: incomeUp() ? "Higher income ↑" : "Less low income ↑" });
    $("map-lede").innerHTML = `${escapeHTML(def.label)}, against ${escapeHTML(lc(incName)).replace("lim-at", "LIM-AT")} in 2021: each in thirds of the neighbourhoods. Reds are ${escapeHTML(lc(def.bad ? def.more : def.less))} with lower income; teals higher income with ${escapeHTML(lc(def.bad ? def.less : def.more))}; the darkest corner, ${escapeHTML(lc(def.bad ? def.more : def.less))} with higher income. Hover or tap for figures.`;
  } else {
    $("bi-key").hidden = true;
    const [b, colours, f] = state.ov === "income" ? [inc6, blues, fi] : [m6, ramp, def.fmt];
    $("map-key").innerHTML = rangeLabels(b.edges, b.zero, f).map((l, k) => `<li><span class="key-sq" style="background:${colours[k]}"></span>${escapeHTML(l)}</li>`).join("")
      + (state.ov === "income" && inc.some((v) => v == null) ? `<li><span class="key-sq hatch"></span>No figure</li>` : "");
    $("map-lede").innerHTML = state.ov === "income" ? `${escapeHTML(incName)}, 2021 Census, in sixths of the neighbourhoods. Hover or tap for the tree and heat figures too.`
      : def.about0 && m6.edges.includes(0) ? `${escapeHTML(def.label)}: the neighbourhoods that fell behind the city in thirds (reds), and those that kept pace or gained in thirds (greens).`
      : `${escapeHTML(def.label)}, in sixths of the neighbourhoods.${def.hot ? fewPasses() : ""}`;
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
      return `<td style="${cellStyle(ramp[c5])}" data-tip="${escapeHTML(`${def.short}<br>${["Lowest", "Second", "Middle", "Fourth", "Highest"][q]} income fifth: <b>${def.fmt(r)}</b><br>${def.poolNote}`)}">${def.fmt(r)}</td>`;
    }).join("");
    const gap = rs[4] - rs[0];
    return `<tr${k === state.m ? ' class="sel"' : ""}><th>${escapeHTML(def.short)}</th>${cells}<td>${def.fmt(city)}</td><td><b>${def.gap === "x" ? `${(rs[4] / rs[0]).toFixed(2)}×` : def.gap === "d" ? `${sign(+gap.toFixed(2))}${Math.abs(gap).toFixed(2)}` : `${sign(+gap.toFixed(1))}${Math.abs(gap).toFixed(1)}${def.gap === "C" ? "°C" : " pts"}`}</b></td></tr>`;
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
  DA = await loadJSON(`/trees_da.json?v=${__TREES_DA_VERSION__}`);
  for (const m of Object.keys(M)) if (M[m].da !== false) daBreaks[m] = breaks(DA.nbhd.flatMap((n) => n[m]));
  renderInside();
}, { rootMargin: "600px 0px" }).observe($("inside"));
const quant = (vs, q) => {
  const s = vs.filter((v) => v != null).sort((a, b) => a - b);
  const pos = (s.length - 1) * q, lo = Math.floor(pos);
  return s[lo] + (s[Math.ceil(pos)] - s[lo]) * (pos - lo);
};
function renderInside() {
  const i = inNb(), dm = M[state.m].da === false ? "canopy" : state.m, def = M[dm];
  $("in-nb").value = i;
  renderSpread();
  if (!DA) return;
  const n = DA.nbhd[i], vs = n[dm], b = daBreaks[dm];
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
  $("in-lede").innerHTML = `${escapeHTML(nbhd[i].name)}'s ${n.dauid.length} dissemination areas by ${escapeHTML(lc(def.label))}, on the same classes as all the city's DAs (so a colour means the same in every neighbourhood)${dm !== state.m ? `; ${escapeHTML(lc(M[state.m].short))} is only figured by neighbourhood, so this shows canopy` : ""}. Heat is against the city's on the same days, as above; a DA is a few blocks, but the thermal pixels are 100 m, so a small DA's figure includes its surroundings. Pick a neighbourhood on the map or from the list.`;
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
    return `<path d="${n.path}" fill="${BI[2 - cls(v3.edges, vuln[i])][cls(h3.edges, NB.heat[i])]}"${both[i] ? ' class="hv-out"' : ""} data-i="${i}" data-tip="${t}"/>`;
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

// ---- 6. what's planted: species and the 10-20-30 rule -------------------------------------------------
// The rule of thumb (Santamour 1990): no species over 10% of a street-tree population, no genus
// over 20%, no family over 30%, so that one pest or disease can't take most of the trees.
const RULE = [["species", 10], ["genus", 20], ["family", 30]];
function ruleBars(vals) {
  return RULE.map(([k, lim], j) => {
    const [name, v] = vals[j], over = v > lim, w = Math.min(100, (v / 40) * 100);
    return `<li><span class="cl-name">${k[0].toUpperCase() + k.slice(1)}: ${escapeHTML(name)}</span>
      <span class="rule-bar"><span class="rule-fill" style="width:${w}%;background:${over ? ORANGES[4] : GREENS[3]}"></span><span class="rule-lim" style="left:${(lim / 40) * 100}%" title="Limit ${lim}%"></span></span>
      <span class="cl-val">${v.toFixed(1)}%</span></li>`;
  }).join("");
}
function speciesList(rows, total) {
  const max = rows[0]?.[1] ?? 1;
  return rows.map(([name, t], k) => `<li><span class="rk">${k + 1}</span><span class="nm">${escapeHTML(name)}</span>
    <span class="barcell"><span class="bar-fill" style="width:${((t / max) * 100).toFixed(1)}%;background:${/maple/i.test(name) ? ORANGES[3] : GREENS[3]}"></span></span>
    <span class="vl">${((t / total) * 100).toFixed(1)}%</span><span class="move"></span></li>`).join("");
}
function renderPlanted() {
  const S = D.species_city, top = S.top;
  const cityRows = top.slice(0, 12).map((x) => [`${x.common} (${x.species})`, x.trees]);
  $("pl-city").innerHTML = speciesList(cityRows, D.city.trees);
  $("pl-city-rule").innerHTML = ruleBars([[top[0].common, top[0].share], [S.top_genus[0], S.top_genus[1]], [S.top_family[0], S.top_family[1]]]);
  const i = state.nb, meets = NB.meets.filter(Boolean).length;
  const over = (k, lim) => NB[k].filter((v) => v > lim).length;
  $("pl-lede").innerHTML = `The City's ${fmtN(D.city.trees)} street trees are ${S.n} species from ${S.genera} genera and ${S.families} families. A rule of thumb for a resilient street-tree population is no more than 10% of one species, 20% of one genus and 30% of one family, so one pest can't take most of them: since 2007 emerald ash borer has killed most of Toronto's ash, now <b>${S.ash}%</b> of street trees. City-wide, Norway maple, a European species considered invasive in Ontario's woodlands and ravines, is <b>${top[0].share.toFixed(1)}%</b> of street trees and maples together <b>${S.top_genus[1]}%</b>. Only <b>${meets}</b> of ${N} neighbourhoods meet all three limits: ${over("species_top", 10)} have one species over 10%, ${over("genus", 20)} one genus over 20%, ${over("family", 30)} one family over 30%.`;
  if (i == null) {
    $("pl-nb-h").textContent = "Pick a neighbourhood";
    $("pl-nb").innerHTML = "";
    $("pl-nb-rule").innerHTML = "";
    $("pl-nb-note").textContent = "Pick one on the map, in a list, or under Inside the neighbourhood, to see its commonest street trees.";
    return;
  }
  const rows = D.species.nbhd[i].map(([k, t]) => [D.species.names[k], t]);
  $("pl-nb-h").textContent = nbhd[i].name;
  $("pl-nb").innerHTML = speciesList(rows, NB.trees[i]);
  $("pl-nb-rule").innerHTML = ruleBars([[rows[0]?.[0] ?? "—", NB.species_top[i]], [NB.genus_name[i], NB.genus[i]], [NB.family_name[i], NB.family[i]]]);
  $("pl-nb-note").textContent = `${fmtN(NB.trees[i])} street trees of ${NB.species_n[i]} species; diversity (Shannon) ${NB.shannon[i].toFixed(2)}, ${ordinal(rankOrder(NB.shannon).indexOf(i) + 1)} of ${N}. ${NB.meets[i] ? "Meets all three limits." : "Over at least one limit."}`;
}

// ---- 7. toward 40% canopy -------------------------------------------------------------------------------
// The City's target is city-wide; each neighbourhood's gap to 40% of its own area shows where the
// room (and the need) is. The cooling figure applies the slope across the city's DAs to the gap: an
// association, not a forecast.
let goalSort = hash.get("gs") === "pts" ? "pts" : "ha";
function renderGoal() {
  const G = D.goal, C = D.city, slope = -D.da_fit.slope_per_10 / 10;
  seg($("goal-sort"), [["ha", "Hectares short"], ["pts", "Points short"]], goalSort, (k) => { goalSort = k; renderGoal(); writeHash(); });
  const x = (v) => `${(v / 50) * 100}%`, [b0, b1] = G.published_2018.split("-").map(Number);
  $("goal-track").innerHTML = `<span class="goal-fill" style="width:${x(C.canopy)};background:${GREENS[3]}"></span>
    <span class="goal-band" style="left:${x(b0)};width:${x(b1 - b0)}" title="The City's published 2018 estimate"></span>
    <span class="goal-mark" style="left:${x(G.target)}"></span>
    <span class="goal-lab up" style="left:${x(C.canopy)}">${C.canopy}% here</span><span class="goal-lab up" style="left:${x(G.target)}">${G.target}% by ${G.year}</span>
    <span class="goal-lab down" style="left:${x((b0 + b1) / 2)}">City's estimate ${G.published_2018.replace("-", "–")}%</span>
    <span class="goal-lab down" style="left:0;transform:none">0%</span><span class="goal-lab down" style="left:100%;transform:translateX(-100%)">50%</span>`;
  const hot = breaks(NB.heat, 3).edges[1], inHot = sum(NB.gap_ha.filter((_, i) => NB.heat[i] >= hot));
  $("goal-lede").innerHTML = `Toronto's target is <b>${G.target}% tree canopy by ${G.year}</b>, city-wide: set in the 2013 Strategic Forest Management Plan and reaffirmed by Council in 2021 (<a href="${G.source}">report</a>). The City puts 2018 canopy at ${G.published_2018.replace("-", "–")}%; the land-cover polygons this page uses give ${C.canopy}%, so the gaps here are on that measure: about <b>${fmtN(G.city_gap_ha)} hectares</b> (${Math.round(G.city_gap_ha / 100)} km²) more canopy city-wide. ${G.above} neighbourhoods are already at 40% or more. Of the ${fmtN(G.nbhd_gap_ha)} hectares the other neighbourhoods are short, <b>${Math.round((inHot / G.nbhd_gap_ha) * 100)}%</b> are in the hottest third of neighbourhoods. For where to plant, the City's own <a href="https://www.toronto.ca/services-payments/water-environment/trees/tree-equity/">Tree Equity Score Analyzer</a> (with American Forests and LEAF) scores each census tract's canopy need from canopy, surface temperature, income, health, age and other measures; this page adds street-tree species, recent summer heat and the heat inside each neighbourhood.`;
  const key = goalSort === "pts" ? "gap_pts" : "gap_ha", order = rankOrder(NB[key]).slice(0, 15), max = NB[key][order[0]];
  $("goal-list").innerHTML = order.map((i, k) => `<li><span class="rk">${k + 1}</span><button type="button" class="nm" data-nb="${i}">${escapeHTML(nbhd[i].name)}</button>
    <span class="barcell" data-tip="${escapeHTML(`${nbhd[i].name}<br>Canopy ${M.canopy.fmt(NB.canopy[i])} of ${fmtN(NB.area_ha[i])} ha<br>Short of 40%: <b>${NB.gap_pts[i].toFixed(1)} pts</b>, <b>${fmtN(NB.gap_ha[i])} ha</b><br>Surface heat ${fmtC(NB.heat[i])}`)}"><span class="bar-fill" style="width:${((NB[key][i] / max) * 100).toFixed(1)}%;background:${ORANGES[3]}"></span></span>
    <span class="vl">${key === "gap_ha" ? `${fmtN(NB.gap_ha[i])} ha` : `${NB.gap_pts[i].toFixed(1)} pts`}</span>
    <span class="gl-extra">now ${M.canopy.fmt(NB.canopy[i])} · ~${(NB.gap_pts[i] * slope).toFixed(1)}°C cooler?</span></li>`).join("");
  $("goal-note").innerHTML = `The 15 neighbourhoods furthest from 40% canopy, by ${goalSort === "pts" ? "points (the share of their area)" : "hectares (big neighbourhoods weigh more)"}. <span class="hide-sm">"Cooler?" applies the city-wide slope across DAs (${fmtC(D.da_fit.slope_per_10)} for every 10 points of canopy) to the gap: an association between places, not a forecast. </span>Canopy can't go everywhere: highways, rail yards, the airport and the lake don't take trees. Map either gap with the menu above.`;
}

// ---- 8. day by day: each Landsat pass --------------------------------------------------------------------
// One colour scale for every day (sixths of all the days' neighbourhood figures pooled), so a colour
// means the same on a hot day and a mild one. "Hot nearly every time": the days a neighbourhood was
// in that day's hottest sixth.
const DAYS = D.days, dayBreaks = breaks(DAYS.flatMap((d) => d.anom));
const dayR = DAYS.map((d) => spearman(d.anom, NB.heat)?.r ?? 0);
const fmtDay = (d) => new Date(`${d}T12:00`).toLocaleDateString("en-CA", { weekday: "short", month: "long", day: "numeric", year: "numeric" });
let day = Math.max(0, DAYS.findIndex((d) => d.date === hash.get("day")));
if (!hash.get("day")) day = D.passes.reduce((a, p, k) => (p.city_c > D.passes[a].city_c ? k : a), 0); // open on the hottest
$("day").innerHTML = DAYS.map((d, k) => `<option value="${k}">${fmtDay(d.date)} · city ${D.passes[k].city_c.toFixed(1)}°C</option>`).join("");
$("day").addEventListener("change", (e) => { day = +e.target.value; renderDay(); writeHash(); });
$("day-prev").addEventListener("click", () => { day = Math.max(0, day - 1); renderDay(); writeHash(); });
$("day-next").addEventListener("click", () => { day = Math.min(DAYS.length - 1, day + 1); renderDay(); writeHash(); });
function renderDay() {
  const d = DAYS[day], P = D.passes[day], vs = d.anom, b = dayBreaks;
  $("day").value = day;
  $("day-prev").disabled = day === 0;
  $("day-next").disabled = day === DAYS.length - 1;
  const order = rankOrder(vs), rank = new Map(order.map((i, k) => [i, k + 1]));
  const shapes = nbhd.map((n, i) => `<path d="${n.path}" fill="${vs[i] == null ? "url(#day-hatch)" : HEAT[cls(b.edges, vs[i])]}" data-i="${i}"
    data-tip="${escapeHTML(`${n.name}<br>${fmtDay(d.date)}<br><b>${fmtC(vs[i])}</b> against the city (${d.lst[i] == null ? "—" : `${d.lst[i].toFixed(1)}°C`})${rank.get(i) ? ` · ${ordinal(rank.get(i))} hottest` : ""}<br>All days (median): ${fmtC(NB.heat[i])}`)}"/>`).join("");
  $("day-map").innerHTML = `<svg viewBox="0 0 ${census.map.width} ${census.map.height}" role="img" aria-label="${escapeHTML(`Map of surface heat by neighbourhood on ${fmtDay(d.date)}`)}">
    <defs><pattern id="day-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#f0f0ec"/><line x1="0" y1="0" x2="0" y2="8" stroke="#c9c9c3" stroke-width="3"/></pattern></defs>${shapes}</svg>`;
  $("day-key").innerHTML = rangeLabels(b.edges, false, fmtC).map((l, k) => `<li><span class="key-sq" style="background:${HEAT[k]}"></span>${escapeHTML(l)}</li>`).join("")
    + (vs.some((v) => v == null) ? `<li><span class="key-sq hatch"></span>Cloud or the scene's edge</li>` : "");
  const r = spearman(vs, NB.heat)?.r, top = order.slice(0, 3), low = order.slice(-3).reverse();
  const nm = (i) => `<button type="button" class="nm" data-nb="${i}">${escapeHTML(nbhd[i].name)}</button> ${fmtC(vs[i])}`;
  $("day-stats").innerHTML = `<dt>City, clear land</dt><dd><b>${P.city_c.toFixed(1)}°C</b> at about noon (${P.platform.replace("landsat-", "Landsat ")}; ${Math.round(P.clear * 100)}% clear)</dd>
    <dt>Hottest</dt><dd>${top.map(nm).join("<br>")}</dd>
    <dt>Coolest</dt><dd>${low.map(nm).join("<br>")}</dd>
    <dt>Against all days</dt><dd>Spearman <b>${fmtR(r)}</b> with the median map</dd>`;
  const hottest = D.passes.reduce((a, p, k) => (p.city_c > D.passes[a].city_c ? k : a), 0), mildest = D.passes.reduce((a, p, k) => (p.city_c < D.passes[a].city_c ? k : a), 0);
  $("day-lede").innerHTML = `Each of the ${DAYS.length} clear summer days Landsat passed over, on one colour scale (each neighbourhood against the city's mean that day). The days ran from ${D.passes[mildest].city_c.toFixed(1)}°C (${fmtDay(D.passes[mildest].date)}) to ${D.passes[hottest].city_c.toFixed(1)}°C (${fmtDay(D.passes[hottest].date)}) across the city's clear land, but the pattern barely moves: each day ranks the neighbourhoods much as the median of all days does (Spearman ${fmtR(Math.min(...dayR))} to ${fmtR(Math.max(...dayR))}), so the same places run hot whatever the day. Step through with the arrows.`;
}
function renderAlways() {
  const n6 = DAYS.map((d) => breaks(d.anom).edges.at(-1));
  const hits = nbhd.map((_, i) => DAYS.filter((d, k) => d.anom[i] != null && d.anom[i] >= n6[k]).length);
  const seen = nbhd.map((_, i) => DAYS.filter((d) => d.anom[i] != null).length);
  const order = [...nbhd.keys()].sort((a, b) => hits[b] / seen[b] - hits[a] / seen[a] || NB.heat[b] - NB.heat[a]).slice(0, 10);
  const every = nbhd.filter((_, i) => hits[i] === seen[i] && seen[i] > 0).length;
  $("always-list").innerHTML = order.map((i, k) => `<li><span class="rk">${k + 1}</span><button type="button" class="nm" data-nb="${i}">${escapeHTML(nbhd[i].name)}</button>
    <span class="barcell"><span class="bar-fill" style="width:${((hits[i] / seen[i]) * 100).toFixed(1)}%;background:${HEAT[5]}"></span></span><span class="vl">${hits[i]} of ${seen[i]}</span><span class="move"></span></li>`).join("");
  $("always-note").textContent = `The days each neighbourhood was in that day's hottest sixth of neighbourhoods, out of the days it had a figure. ${every} were in it every time.`;
}

// ---- 9. canopy change, 2008 to 2018 --------------------------------------------------------------------
// From the City's two land-cover maps. The 2008 map has one tree class; the 2018 map splits tree from
// shrub by height, so 2018 can be read as its tree class or as tree plus shrub. The level of change
// differs with the reading, so the map shows each neighbourhood's change less the city's.
let ccBasis = hash.get("cb") === "ts" ? "ts" : "tree";
const CC_EDGES = [-6, -3, -1, 1, 3, 6];
function renderCanopyChange() {
  const X = D.change, ts = ccBasis === "ts", key = ts ? "treeshrub" : "tree";
  seg($("cc-basis"), [["tree", "2018: trees only"], ["ts", "2018: trees and shrubs"]], ccBasis, (k) => { ccBasis = k; renderCanopyChange(); writeHash(); });
  const now = ts ? X.treeshrub_2018 : X.tree_2018, rel = ts ? NB.chg_ts : NB.chg, cityChg = X.city_change[key];
  const pts = (v, d = 1) => `${sign(+v.toFixed(d))}${Math.abs(v).toFixed(d)}`;
  const row = (name, a, b, note, sel) => `<tr${sel ? ' class="sel"' : ""}><th>${name}</th><td>${a.toFixed(1)}%</td><td>${b.toFixed(1)}%</td><td class="${b > a ? "cc-up" : "cc-down"}">${pts(b - a)} pts</td></tr>`.replace("</th>", `<span class="cc-how">${note}</span></th>`);
  $("cc-city").innerHTML = `<thead><tr><th>City-wide canopy</th><th>2008</th><th>2018</th><th>Change</th></tr></thead><tbody>
    ${row("The City's headline", X.sampled["2008"], X.sampled["2018"], "trees and shrubs at 10,000 sample points on aerial photos; the only one with a margin of error", false)}
    ${row("The maps, 2018 as trees only", X.city.tree_2008, X.city.tree_2018, "the comparison in the study's own table by neighbourhood", !ts)}
    ${row("The maps, 2018 as trees and shrubs", X.city.tree_2008, X.city.treeshrub_2018, "what the study quotes for 2018's map (31%)", ts)}</tbody>`;
  $("cc-lede").innerHTML = `Did canopy grow? It depends on how it is counted. The City's <a href="${X.study}">2018 Tree Canopy Study</a> reports a rise, from point sampling. Its two land-cover maps, the only source that reaches neighbourhoods, disagree with each other: the 2008 map has a single tree class, while the 2018 map used laser height data to separate trees from shrubs, and the City counts both as canopy. Read 2018 as trees only and the city lost canopy; add the shrubs and it gained. A like-for-like figure probably lies between the two, so the size of the change can't be read from the maps.`;
  $("cc-map-lede").innerHTML = `What the maps do show is <b>which neighbourhoods did better or worse than the city</b>: each neighbourhood's change in canopy share, less the city's change (${pts(cityChg)} points on this reading). The two readings rank the neighbourhoods much the same way (their changes correlate ${fmtR(X.r)}). Of the ${X.counts.n} neighbourhoods as they were in 2008, <b>${X.counts.rose_on_both}</b> gained canopy on both readings and <b>${X.counts.fell_on_both}</b> lost on both; the other ${X.counts.n - X.counts.rose_on_both - X.counts.fell_on_both} depend on whether shrubs are counted.`;
  const pal = [...GAIN.slice(0, 3), "#f0efec", ...GAIN.slice(3)];
  const mates = (i) => nbhd.map((n, j) => (j !== i && X.group[j] === X.group[i] ? n.name : null)).filter(Boolean);
  $("cc-map").innerHTML = `<svg viewBox="0 0 ${census.map.width} ${census.map.height}" role="img" aria-label="Map of the neighbourhoods by canopy change against the city's, 2008 to 2018">${nbhd.map((n, i) => `<path d="${n.path}" fill="${pal[cls(CC_EDGES, rel[i])]}" data-i="${i}"
    data-tip="${escapeHTML(`${n.name}<br>Against the city: <b>${pts(rel[i])} pts</b><br>2008: ${X.tree_2008[i].toFixed(1)}% · 2018: ${now[i].toFixed(1)}% (${pts(now[i] - X.tree_2008[i])} pts)${X.shared[i] ? `<br>One neighbourhood in 2008 with ${mates(i).join(", ")}: they share these figures` : ""}`)}"/>`).join("")}</svg>`;
  const lab = ["6 or more points behind", "3 to 6 behind", "1 to 3 behind", "within 1 point of the city", "1 to 3 ahead", "3 to 6 ahead", "6 or more ahead"];
  $("cc-key").innerHTML = pal.map((c, k) => `<li><span class="key-sq" style="background:${c}"></span>${lab[k]}</li>`).join("");
  // one row per 2008 neighbourhood: the first of each group stands for it
  const firsts = [...nbhd.keys()].filter((i) => X.group.indexOf(X.group[i]) === i);
  const order = firsts.sort((a, b) => rel[b] - rel[a]), max = Math.max(...order.map((i) => Math.abs(rel[i])));
  const name = (i) => (X.shared[i] ? `${nbhd[i].name} (+${mates(i).length})` : nbhd[i].name);
  const item = (i, k) => `<li><span class="rk">${k}</span><button type="button" class="nm" data-nb="${i}" title="${escapeHTML(X.shared[i] ? `With ${mates(i).join(", ")}` : nbhd[i].name)}">${escapeHTML(name(i))}</button>
      <span class="barcell" data-tip="${escapeHTML(`${nbhd[i].name}<br>2008: ${X.tree_2008[i].toFixed(1)}% · 2018: ${now[i].toFixed(1)}%<br>Change ${pts(now[i] - X.tree_2008[i])} pts; against the city <b>${pts(rel[i])} pts</b>`)}"><span class="bar-fill" style="width:${((Math.abs(rel[i]) / max) * 100).toFixed(1)}%;background:${rel[i] < 0 ? GAIN[1] : GAIN[4]}"></span></span>
      <span class="vl">${pts(rel[i])} pts</span><span class="move"></span></li>`;
  $("cc-up").innerHTML = order.slice(0, 8).map((i, k) => item(i, k + 1)).join("");
  $("cc-down").innerHTML = order.slice(-8).reverse().map((i, k) => item(i, k + 1)).join("");
  const t = X.table35;
  $("cc-note").textContent = `Canopy is a share of each neighbourhood's mapped area. 2008 is the City's own total of tree cover by neighbourhood (Wellbeing Toronto), on the 140 neighbourhoods of the time: the ${X.shared.filter(Boolean).length} neighbourhoods since carved out of 16 of them share their old neighbourhood's figures, marked (+n). `
    + (t ? `The trees-only reading reproduces the study's Appendix C table for all ${t.n} neighbourhoods (the changes correlate ${t.r_change.toFixed(3)}, differing by ${t.mean_abs_diff_change} points on average). ` : "")
    + `The file the City publishes as the "2008 Tree Canopy Study" land cover turns out to be the 2018 map again, so 2008 can't be redrawn below the neighbourhood. "Canopy change" can also be mapped against income with the menu above.`;
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
  renderPlanted();
  renderGoal();
  renderCanopyChange();
  renderDay();
  markOtherMaps();
  $("find-nb").value = state.nb ?? "";
  writeHash();
}
renderCards();
renderAlways();
render();
buildToc($("toc"));
