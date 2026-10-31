// The Housing Insights page: building permits, development applications, rental
// demolitions, apartment buildings, the affordable rental pipeline, CMHC starts and
// rents, and StatCan's city- and metro-wide series, from housing.json
// (pipeline/housing_insights.py), with the 2021 Census figures from insights.json.
// Charts are inline SVG and HTML, as on the other Insights pages.
import "./style.css";
import { $, COLORS, DIVERGING, MEASURES as CENSUS, escapeHTML, fmtCount, isMoney, ordinal, sign } from "./catalogue.js";
import { fmtR, initTip, pearson, quantile, rColor, seg, spearman } from "./charts.js";

const [D, census] = await Promise.all([
  fetch(`/housing.json?v=${__HOUSING_VERSION__}`).then((r) => r.json()),
  fetch(`/insights.json?v=${__INSIGHTS_VERSION__}`).then((r) => r.json()),
]);
const nbhd = D.nbhd, N = nbhd.length, INK = "#1a1a19";
const RISE = DIVERGING[5], FALL = DIVERGING[1], LIGHT = COLORS[1], MID = COLORS[3], DARK = COLORS[5];
const ORANGE = "#c2410c";
const censusMeasures = Object.keys(CENSUS).filter((m) => census.measures[m]?.values["2021"]);
const sum = (vs) => vs.reduce((a, v) => a + (v ?? 0), 0);
const fmtN = (v) => (v == null ? "—" : Math.round(v).toLocaleString("en-CA"));
const fmtMoney = (v) => (v == null ? "—" : `$${Math.round(v).toLocaleString("en-CA")}`);
const fmtPct1 = (v) => (v == null ? "—" : `${v.toFixed(1)}%`);
const fmtChangePct = (a, b) => (a == null || b == null || !a ? "—" : `${sign(+((b / a - 1) * 100).toFixed(1))}${Math.abs((b / a - 1) * 100).toFixed(1)}%`);
const LAST = 2025; // the last complete year in every source
const partial = (y) => +y > LAST;
const yLabel = (y) => (partial(y) ? `${y} to date` : `${y}`);

// ---- neighbourhood measures --------------------------------------------------------
// Flows are summed over a period; levels are averaged; the rest are one figure.
// Counts can be shown per 1,000 households at the census nearest the period's start.
const WINDOWS = [[2001, 2005], [2006, 2010], [2011, 2015], [2016, 2020], [2021, 2025]];
const hhCensus = (a) => (a < 2014 ? "2011" : a < 2019 ? "2016" : "2021");
const yearly = (block, key) => (y) => block[key][String(y)];
const M = {
  created: { label: "Units created on building permits", kind: "flow", years: D.permits.years, get: yearly(D.permits, "created") },
  net: { label: "Net units on building permits (created less lost)", kind: "flow", years: D.permits.years, get: yearly(D.permits, "net") },
  lost: { label: "Units lost on building permits", kind: "flow", years: D.permits.years, get: yearly(D.permits, "lost") },
  dev: { label: "Units proposed in development applications (once a project)", kind: "flow", years: D.development.years, get: yearly(D.development, "units") },
  demo: { label: "Rental units approved for demolition", kind: "flow", years: D.demolitions.years, get: yearly(D.demolitions, "lost") },
  rent: { label: "Average rent, purpose-built rental (CMHC zone)", kind: "level", unit: "money", zone: true, years: D.cmhc.nbhd_years, get: yearly(D.cmhc, "avg_rent") },
  vacancy: { label: "Vacancy rate, purpose-built rental (CMHC zone)", kind: "level", unit: "pct", zone: true, years: D.cmhc.nbhd_years, get: yearly(D.cmhc, "vacancy") },
  hh_change: { label: "Change in households between censuses", kind: "census" },
  apt: { label: "Units in registered apartment buildings", kind: "stock", count: true, values: D.apartments.units },
  social: { label: "Social housing and TCHC share of apartment units", kind: "stock", unit: "pct",
    values: D.apartments.units.map((u, i) => (u ? ((D.apartments.social[i] + D.apartments.tchc[i]) / u) * 100 : null)) },
  built: { label: "Median year built, apartment units", kind: "stock", unit: "year", values: D.apartments.median_built },
  affordable: { label: "Affordable rental homes in the pipeline, not yet occupied", kind: "stock", count: true,
    values: nbhd.map((_, i) => sum(D.affordable.stages.filter((s) => s !== "Occupied").map((s) => D.affordable.nbhd[s][i]))) },
};
const counts = (m) => M[m].kind === "flow" || M[m].kind === "census" || M[m].count;
// The periods a measure has: the windows with any of its complete years, named by the years they hold.
function periods(m) {
  if (M[m].kind === "census") return [["2011-2016", "2011–16"], ["2016-2021", "2016–21"]];
  if (!M[m].years) return [];
  return WINDOWS.map(([a, b]) => {
    const ys = M[m].years.filter((y) => y >= a && y <= b);
    return ys.length ? [`${ys[0]}-${ys.at(-1)}`, ys.length === 1 ? `${ys[0]}` : `${ys[0]}–${String(ys.at(-1)).slice(2)}`] : null;
  }).filter(Boolean);
}

// ---- state, kept in the address -----------------------------------------------
const hash = new URLSearchParams(location.hash.slice(1));
const state = {
  m: M[hash.get("m")] ? hash.get("m") : "created",
  p: hash.get("p"),
  rate: hash.get("r") !== "0",
  lag: ["0", "1", "2", "3"].includes(hash.get("lag")) ? hash.get("lag") : "1",
  span: ["2011-2016", "2016-2021"].includes(hash.get("cs")) ? hash.get("cs") : "2016-2021",
  zoneKey: hash.get("zk") === "vacancy" ? "vacancy" : "avg_rent",
  sx: hash.get("sx"),
};
const fixPeriod = () => {
  const ps = periods(state.m).map(([k]) => k);
  if (!ps.includes(state.p)) state.p = ps.at(-1) ?? null;
};
fixPeriod();
const writeHash = () => {
  const h = new URLSearchParams({ m: state.m, r: state.rate ? "1" : "0", lag: state.lag, cs: state.span, zk: state.zoneKey });
  if (state.p) h.set("p", state.p);
  if (state.sx) h.set("sx", state.sx);
  history.replaceState(null, "", `#${h}`);
};

// A measure's neighbourhood values for the current period, as counts or rates.
function values(m = state.m, p = state.p, rate = state.rate) {
  const def = M[m];
  let vs, base = null;
  if (def.kind === "census") {
    const [a, b] = p.split("-");
    vs = D.households[b].map((v, i) => (v == null || D.households[a][i] == null ? null : v - D.households[a][i]));
    base = a;
  } else if (def.kind === "flow" || def.kind === "level") {
    const [a, b] = p.split("-").map(Number);
    const ys = def.years.filter((y) => y >= a && y <= b);
    const cols = ys.map((y) => def.get(y));
    vs = nbhd.map((_, i) => {
      const xs = cols.map((c) => c[i]).filter((v) => v != null);
      return xs.length < cols.length ? null : def.kind === "flow" ? sum(xs) : sum(xs) / xs.length;
    });
    base = hhCensus(a);
  } else {
    vs = def.values;
    base = "2021";
  }
  if (rate && counts(m)) vs = vs.map((v, i) => (v == null || !D.households[base][i] ? null : (v / D.households[base][i]) * 1000));
  return { vs, base };
}
const isRate = () => state.rate && counts(state.m);
function fmtV(v, m = state.m, rate = isRate()) {
  if (v == null) return "—";
  if (rate) return v.toFixed(1);
  const u = M[m].unit;
  return u === "money" ? fmtMoney(v) : u === "pct" ? fmtPct1(v) : u === "year" ? String(Math.round(v)) : fmtN(v);
}
const unitLabel = (base) => (isRate() ? ` per 1,000 households (${base} Census)` : "");
const periodLabel = () => periods(state.m).find(([k]) => k === state.p)?.[1] ?? "";
const describe = (base) => `${escapeHTML(M[state.m].label)}${state.p ? `, ${periodLabel()}` : ""}${unitLabel(base)}`;

initTip();

// ---- controls ----------------------------------------------------------------------
const select = $("measure");
const GROUPS = [
  ["Building permits", ["created", "net", "lost"]], ["Pipeline and demolitions", ["dev", "demo", "affordable"]],
  ["Rental market (CMHC)", ["rent", "vacancy"]], ["Stock and households", ["apt", "social", "built", "hh_change"]],
];
select.innerHTML = GROUPS.map(([g, ms]) => `<optgroup label="${g}">${ms.map((m) => `<option value="${m}">${escapeHTML(M[m].label)}</option>`).join("")}</optgroup>`).join("");
select.addEventListener("change", () => set({ m: select.value }));
$("rate").addEventListener("change", (e) => set({ rate: e.target.checked }));
function controls() {
  select.value = state.m;
  const ps = periods(state.m);
  $("period").hidden = !ps.length;
  seg($("period"), ps, state.p, (p) => set({ p }));
  $("rate-wrap").hidden = !counts(state.m);
  $("rate").checked = state.rate;
}
function set(changes) {
  Object.assign(state, changes);
  if ("m" in changes) {
    fixPeriod();
    state.sx = null;
  }
  render();
}

// ---- small chart kit: bars and lines over years ----------------------------------------
// Marks live in a 0-100 SVG box stretched to the chart; labels and hover targets are
// HTML so they keep their size. series: [{name, color, values, neg?}]; bars stack.
function yTicks(lo, hi, fmt) {
  const raw = (hi - lo) / 4, mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw);
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(v);
  return { ticks, fmt };
}
function chart({ labels, bars = [], lines = [], fmt, tipLabel = (l) => l, height = 170, zero = true, partialFrom = null }) {
  const n = labels.length;
  const stackTop = labels.map((_, k) => sum(bars.filter((s) => !s.neg).map((s) => s.values[k])));
  const stackBot = labels.map((_, k) => -sum(bars.filter((s) => s.neg).map((s) => s.values[k])));
  const lineVals = lines.flatMap((s) => s.values.filter((v) => v != null));
  const barVals = bars.length ? [...stackTop, ...stackBot] : [];
  let hi = Math.max(...barVals, ...lineVals), lo = Math.min(...barVals, ...lineVals);
  if (zero) { hi = Math.max(hi, 0); lo = Math.min(lo, 0); }
  else { const pad = (hi - lo) * 0.08; hi += pad; lo -= pad; }
  const { ticks } = yTicks(lo, hi);
  lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks.at(-1));
  const y = (v) => 100 - ((v - lo) / (hi - lo || 1)) * 100, bw = 100 / n, x = (k) => (k + 0.5) * bw;
  let svg = "";
  labels.forEach((l, k) => {
    let up = 0, down = 0;
    for (const s of bars) {
      const v = s.values[k] ?? 0;
      if (!v) continue;
      const [a, b] = s.neg ? [-down, -(down += v)] : [up, (up += v)];
      svg += `<rect x="${(k * bw + bw * 0.12).toFixed(2)}" width="${(bw * 0.76).toFixed(2)}" y="${y(Math.max(a, b)).toFixed(2)}" height="${Math.abs(y(a) - y(b)).toFixed(2)}" fill="${s.color}"${partialFrom != null && k >= partialFrom ? ' opacity="0.45"' : ""}/>`;
    }
  });
  for (const s of lines) {
    const pts = s.values.map((v, k) => (v == null ? null : `${x(k).toFixed(2)},${y(v).toFixed(2)}`));
    const runs = [[]];
    pts.forEach((p) => (p ? runs.at(-1).push(p) : runs.push([])));
    svg += runs.filter((r) => r.length).map((r) => `<polyline points="${r.join(" ")}" fill="none" stroke="${s.color}" stroke-width="2" vector-effect="non-scaling-stroke"${s.dash ? ' stroke-dasharray="4 3"' : ""}/>`).join("");
  }
  const tips = labels.map((l, k) => {
    const rows = [...bars, ...lines].filter((s) => s.values[k] != null).map((s) => `${s.name}: <b>${fmt(s.values[k])}</b>`).join("<br>");
    return `<span class="ch-hit" style="left:${k * bw}%;width:${bw}%" data-tip="${escapeHTML(`${tipLabel(l)}<br>${rows}`)}"></span>`;
  }).join("");
  const yt = ticks.map((v) => `<span class="sc-ytick" style="bottom:${100 - y(v)}%">${fmt(v)}</span><span class="sc-gy" style="bottom:${100 - y(v)}%"></span>`).join("");
  const every = Math.ceil(n / (String(labels[0]).length > 4 ? 5 : 8)); // month labels are wider
  // every `every`th label, and the last, unless it would crowd the one before
  const xt = labels.map((l, k) => ((k % every === 0 && n - 1 - k >= every * 0.6) || k === n - 1 ? `<span style="left:${x(k)}%">${l}</span>` : "")).join("");
  const zeroLine = lo < 0 ? `<span class="ch-zero" style="bottom:${100 - y(0)}%"></span>` : "";
  return `<div class="ch-box" style="height:${height}px">${yt}${zeroLine}<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${svg}</svg>${tips}</div><div class="ch-xticks">${xt}</div>`;
}
const key = (items) => `<ul class="year-key">${items.map(([name, color, kind]) => `<li><span class="${kind === "line" ? "key-line" : "key-sq"}" style="background:${color}"></span>${name}</li>`).join("")}</ul>`;
const fmtK = (v) => (Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(1)}k` : fmtN(v));

// ---- 1. the city at a glance -----------------------------------------------------------
function spark(vals, labels) {
  const W = 120, H = 34, px = 6, py = 6, vs = vals.filter((v) => v != null);
  const lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const x = (k) => px + (k * (W - 2 * px)) / (vals.length - 1), y = (v) => H - py - ((v - lo) / span) * (H - 2 * py);
  const pts = vals.map((v, k) => (v == null ? "" : `${x(k).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(" ");
  const k = vals.length - 1;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${COLORS[2]}" stroke-width="2" stroke-linejoin="round"/>`
    + `<circle cx="${x(k)}" cy="${y(vals[k])}" r="4" fill="${COLORS[4]}" stroke="#fcfcfb" stroke-width="2"/></svg>`;
}
function card(name, years, vals, fmt, note) {
  const k = years.indexOf(LAST), v = vals[k], prev = vals[k - 1];
  const ys = years.slice(0, k + 1), vs = vals.slice(0, k + 1);
  return `<div class="card static" aria-label="${escapeHTML(`${name}, ${LAST}: ${fmt(v)}`)}">
    <span class="card-name">${name}</span><span class="card-value">${fmt(v)}</span>${spark(vs, ys)}
    <span class="card-years"><span>${ys[0]}</span><span>${LAST}</span></span>
    <span class="card-delta">${note ?? `${fmtChangePct(prev, v)} from ${LAST - 1}`}</span></div>`;
}
function renderCards() {
  const P = D.permits.city, C = D.cmhc, R = C.rms_city, S = C.starts;
  const devYears = D.development.years, devCity = devYears.map((y) => sum(D.development.units[y]));
  const ppChange = (a, b) => `${sign(+(b - a).toFixed(1))}${Math.abs(b - a).toFixed(1)} pp from ${LAST - 1}`;
  const vk = R.year.indexOf(LAST);
  $("cards").innerHTML = [
    card("Units created on permits", P.year, P.created, fmtN),
    card("Net units on permits", P.year, P.net, fmtN),
    card("Housing starts (CMHC)", S.year, S.starts, fmtN),
    card("Completions (CMHC)", S.year, S.completions, fmtN),
    card("Under construction, December", S.year, S.uc_december, fmtN),
    card("Units in new applications", devYears, devCity, fmtN),
    card("Average rent, purpose-built", R.year, R.avg_rent, fmtMoney),
    card("Vacancy rate, purpose-built", R.year, R.vacancy, fmtPct1, ppChange(R.vacancy[vk - 1], R.vacancy[vk])),
    card("Rental units approved for demolition", D.demolitions.city.year, D.demolitions.city.lost_total, fmtN),
  ].join("");
  $("glance-lede").innerHTML = `The City of Toronto in ${LAST}, the last complete year in every source. Permits and applications are the City's (permits by year issued, applications by year submitted); starts, completions, rents and vacancy are CMHC's (rents from the Rental Market Survey of purpose-built rental, each October).`;
}

// ---- 2. year by year ----------------------------------------------------------------------
function panel(title, body, caption) {
  return `<figure class="panel"><h3 class="sub-h">${title}</h3>${body}<figcaption>${caption}</figcaption></figure>`;
}
function renderYears() {
  const P = D.permits.city, pPart = P.year.findIndex(partial);
  const C = D.cmhc, R = C.rms_city, mo = C.monthly;
  // 12-month sums of the monthly starts and completions
  const roll = (vs) => vs.map((_, k) => (k < 11 || vs.slice(k - 11, k + 1).some((v) => v == null) ? null : sum(vs.slice(k - 11, k + 1))));
  const dev = D.development, dYears = dev.years.map(String);
  const dm = D.demolitions.city, ap = D.apartments.decades, af = D.affordable;
  const html = [
    panel("Units on building permits, by year issued", chart({
      labels: P.year.map(String), fmt: fmtK, partialFrom: pPart < 0 ? null : pPart, tipLabel: yLabel,
      bars: [{ name: "Ground-related created", color: DARK, values: P.created_ground }, { name: "Other created", color: LIGHT, values: P.created_other },
        { name: "Lost", color: FALL, values: P.lost, neg: true }],
    }) + key([["Created: ground-related (houses, semis, rows)", DARK], ["Created: other (mostly apartments)", LIGHT], ["Lost", FALL]]),
    `The City's permits placed in a neighbourhood (89–100% of units a year). ${P.year.at(-1)}: to ${D.retrieved.permits}, shown lighter.`),
    panel("CMHC starts and completions, 12 months to each month", chart({
      labels: mo.month, fmt: fmtK, zero: false,
      lines: [{ name: "Starts", color: MID, values: roll(mo.starts) }, { name: "Completions", color: ORANGE, values: roll(mo.completions) }],
    }) + key([["Starts", MID, "line"], ["Completions", ORANGE, "line"]]),
    `Monthly from ${mo.month[0]} to ${mo.month.at(-1)}; each point sums the 12 months to it.`),
    panel("Units under construction (CMHC)", chart({
      labels: mo.month, fmt: fmtK, zero: false, lines: [{ name: "Under construction", color: DARK, values: mo.uc }],
    }), `At the end of each month, ${mo.month[0]} to ${mo.month.at(-1)}.`),
    panel("Units in development applications, by year submitted", chart({
      labels: dYears, fmt: fmtK, tipLabel: yLabel, partialFrom: dev.years.findIndex(partial),
      bars: [{ name: "Units, once a project", color: LIGHT, values: dYears.map((y) => sum(dev.units[y])) }],
      lines: ["OZ", "SA", "CD"].map((t, k) => ({ name: dev.types[t], color: [DARK, ORANGE, "#6b6b66"][k], values: dYears.map((y) => dev.city[t][y]) })),
    }) + key([["Once a project", LIGHT], ["Rezoning", DARK, "line"], ["Site plan", ORANGE, "line"], ["Condominium", "#6b6b66", "line"]]),
    `Bars count each project's units once, in its first application's year; lines count each type's applications without resubmissions (a project appears in several). ${dev.years.at(-1)} is to date.`),
    panel("Purpose-built rent (CMHC Rental Market Survey)", chart({
      labels: R.year.map(String), fmt: (v) => `$${fmtK(v)}`, zero: false,
      lines: [{ name: "Average rent", color: DARK, values: R.avg_rent }, { name: "Median rent", color: MID, values: R.median_rent, dash: true }],
    }) + key([["Average", DARK, "line"], ["Median", MID, "line"]]), "Each October, all bedroom types, as published (not adjusted for inflation)."),
    panel("Vacancy rate and same-sample rent change (CMHC)", chart({
      labels: R.year.map(String), fmt: (v) => `${+v.toFixed(1)}%`,
      lines: [{ name: "Vacancy rate", color: DARK, values: R.vacancy }, { name: "Same-sample rent change", color: ORANGE, values: R.rent_change }],
    }) + key([["Vacancy rate", DARK, "line"], ["Rent change in units surveyed both years", ORANGE, "line"]]),
    "The rent change is CMHC's, over the units in the survey in both years, not the change in the average."),
    panel("Rental units approved for demolition", chart({
      labels: dm.year.map(String), fmt: fmtK, tipLabel: yLabel,
      bars: [{ name: "Lost: affordable", color: DARK, values: dm.lost_affordable }, { name: "Lost: mid-range", color: MID, values: dm.lost_mid_range },
        { name: "Lost: high-end", color: LIGHT, values: dm.lost_high_end }],
      lines: [{ name: "Replacement units", color: ORANGE, values: dm.replaced_total }],
    }) + key([["Affordable", DARK], ["Mid-range", MID], ["High-end", LIGHT], ["Replacements", ORANGE, "line"]]),
    "By year of Council approval, by the rent level of the units lost."),
    panel("Registered apartment buildings, units by decade built", chart({
      labels: ap.decade.map((d) => (d === 1900 ? "≤1900s" : `${d}s`)), fmt: fmtK,
      bars: [{ name: "Private", color: LIGHT, values: ap.units_private }, { name: "Social housing", color: MID, values: ap.units_social },
        { name: "TCHC", color: DARK, values: ap.units_tchc }],
    }) + key([["Private", LIGHT], ["Social housing", MID], ["TCHC", DARK]]),
    "Buildings of 3+ storeys and 10+ units in the City's registry (from 2017); buildings gone before then aren't in it."),
    panel("Affordable rental pipeline, by stage", `<ol class="af-list">${af.stages.map((s, k) => {
      const v = af.city.affordable[k], max = Math.max(...af.city.affordable);
      return `<li data-tip="${escapeHTML(`${s}<br>${fmtN(af.city.projects[k])} projects · <b>${fmtN(v)}</b> affordable homes · ${fmtN(af.city.rgi[k])} rent-geared-to-income`)}"><span class="cl-name">${escapeHTML(s)}</span><span class="af-bar"><span style="width:${(v / max) * 100}%"></span></span><span class="cl-val">${fmtN(v)}</span></li>`;
    }).join("")}</ol>`, "Affordable homes by the project's status today (a snapshot: the file has no dates)."),
  ].join("");
  $("panels").innerHTML = html;
}

// ---- 3. the map --------------------------------------------------------------------------------
// Sixths of the neighbourhoods; where more than a sixth have none (demolitions, the
// affordable pipeline), zero is a class of its own and the rest are split in fifths.
function breaks(vs) {
  const s = vs.filter((v) => v != null).sort((a, b) => a - b);
  const uniq = (qs) => qs.filter((q, k) => k === 0 || q > qs[k - 1]);
  if (s[0] >= 0 && s.filter((v) => v === 0).length > s.length / 6) {
    const pos = s.filter((v) => v > 0);
    return { edges: [Number.MIN_VALUE, ...uniq([1, 2, 3, 4].map((k) => quantile(pos, k / 5)))], zero: true };
  }
  return { edges: uniq([1, 2, 3, 4, 5].map((k) => quantile(s, k / 6))), zero: false };
}
function renderMap() {
  const { vs, base } = values(), { edges: b, zero } = breaks(vs), order = rankOrder(vs);
  const rank = new Map(order.map((i, k) => [i, k + 1]));
  const pal = b.length + 1 === COLORS.length ? COLORS : COLORS.slice(COLORS.length - b.length - 1);
  const cls = (v) => b.filter((e) => v >= e).length;
  const zone = M[state.m].zone;
  const shapes = nbhd.map((n, i) => {
    const v = vs[i];
    const z = zone ? `<br>CMHC zone: ${escapeHTML(zoneName(D.cmhc.nbhd_zone[i]))}` : "";
    const t = `${escapeHTML(n.name)}<br>${v == null ? "No figure" : `<b>${fmtV(v)}</b> · ${ordinal(rank.get(i))} of ${order.length}`}${z}`;
    return `<path d="${n.path}" fill="${v == null ? "url(#nb-hatch)" : pal[cls(v)]}" data-tip="${t}"/>`;
  }).join("");
  $("nb-map").innerHTML = `<svg viewBox="0 0 ${D.map.width} ${D.map.height}" role="img" aria-label="${escapeHTML(`Map of the neighbourhoods by ${M[state.m].label.toLowerCase()}`)}">
    <defs><pattern id="nb-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#f0f0ec"/><line x1="0" y1="0" x2="0" y2="8" stroke="#c9c9c3" stroke-width="3"/></pattern></defs>
    <g>${shapes}</g></svg>`;
  const edges = [null, ...b, null];
  const label = (k) => (zero && k === 0 ? "None" : zero && k === 1 ? (edges[2] == null ? "Any" : `under ${fmtV(edges[2])}`)
    : edges[k] == null ? `under ${fmtV(edges[k + 1])}` : edges[k + 1] == null ? `${fmtV(edges[k])} or more` : `${fmtV(edges[k])} to ${fmtV(edges[k + 1])}`);
  $("map-key").innerHTML = pal.map((c, k) => `<li><span class="key-sq" style="background:${c}"></span>${label(k)}</li>`).join("")
    + (vs.some((v) => v == null) ? `<li><span class="key-sq hatch"></span>No figure</li>` : "");
  $("map-lede").innerHTML = `${describe(base)}, by neighbourhood, in classes of about equal numbers of neighbourhoods${zero ? ", with those that have none in a class of their own" : ""}.${zone ? " CMHC publishes rents by zone: each neighbourhood shows its zones' figures, weighted by its renter households in each." : ""}`;
}
const zoneName = (code) => D.cmhc.zones.find((z) => z.code === code)?.name ?? "—";
const rankOrder = (vs) => vs.map((v, i) => [v, i]).filter(([v]) => v != null).sort((a, b) => b[0] - a[0]).map(([, i]) => i);

// ---- 4. highest and lowest, and how concentrated ----------------------------------------------------
function renderRanks() {
  const { vs, base } = values(), order = rankOrder(vs);
  if (M[state.m].zone) {
    $("rank-body").hidden = true;
    $("conc").innerHTML = "";
    $("rank-lede").innerHTML = `CMHC's rents and vacancy are figures for its 17 zones, which many neighbourhoods share: see the zones in the table below.`;
    return;
  }
  $("rank-body").hidden = false;
  const max = Math.max(...order.map((i) => Math.abs(vs[i])));
  const row = (i) => {
    const v = vs[i], w = (Math.abs(v) / max) * 100;
    return `<li><span class="rk">${order.indexOf(i) + 1}</span><span class="nm">${escapeHTML(nbhd[i].name)}</span>
      <span class="barcell" data-tip="${escapeHTML(`${nbhd[i].name}<br><b>${fmtV(v)}</b>`)}"><span class="bar-fill" style="width:${w.toFixed(1)}%${v < 0 ? `;background:${FALL}` : ""}"></span></span>
      <span class="vl">${fmtV(v)}</span><span class="move"></span></li>`;
  };
  $("rank-top").innerHTML = order.slice(0, 10).map(row).join("");
  $("rank-bottom").innerHTML = order.slice(-10).reverse().map(row).join("");
  $("rank-lede").innerHTML = `${describe(base)}: ${order.length} neighbourhoods${order.length < N ? ` (${N - order.length} without a figure)` : ""}.`;
  // concentration: the share of the City's total in the neighbourhoods with the most
  const raw = values(state.m, state.p, false).vs;
  const conc = $("conc");
  if (!counts(state.m) || M[state.m].kind === "census" || state.m === "net") {
    conc.innerHTML = "";
    return;
  }
  const s = raw.filter((v) => v != null && v > 0).sort((a, b) => b - a), tot = sum(s);
  if (!tot) { conc.innerHTML = ""; return; }
  let c = 0;
  const cum = s.map((v) => (c += v) / tot);
  const at = (k) => (k <= 0 ? 0 : cum[Math.min(k, cum.length) - 1]);
  const pts = [[0, 0], ...cum.map((v, k) => [(k + 1) / N, v])];
  conc.innerHTML = `<h3 class="sub-h">How concentrated</h3>
    <p class="ins-lede">The share of the City's ${fmtN(tot)} ${escapeHTML(M[state.m].label.toLowerCase())} (${periodLabel() || "today"}) in the neighbourhoods with the most, counted in units (not per household): the top 5 hold <b>${Math.round(at(5) * 100)}%</b>, the top 10 <b>${Math.round(at(10) * 100)}%</b>, the top 16 (a tenth) <b>${Math.round(at(16) * 100)}%</b>; ${N - s.length} neighbourhoods have none.</p>
    <div class="ch-box conc-box"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="100" x2="100" y2="0" stroke="#c9c9c3" vector-effect="non-scaling-stroke" stroke-dasharray="4 3"/>
      <polyline points="${pts.map(([x, y]) => `${(x * 100).toFixed(2)},${(100 - y * 100).toFixed(2)}`).join(" ")}" fill="none" stroke="${DARK}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
      ${[0.25, 0.5, 0.75, 1].map((f) => `<span class="sc-ytick" style="bottom:${f * 100}%">${f * 100}%</span>`).join("")}</div>
    <div class="ch-xticks">${[0, 40, 80, 120, 158].map((k) => `<span style="left:${(k / N) * 100}%">${k}</span>`).join("")}</div>
    <p class="tbl-note">Across: neighbourhoods, from the one with the most. Up: their cumulative share of the City's total. The dashed line is an even spread.</p>`;
}

// ---- 5. permits and the census ------------------------------------------------------------------------
function renderCensusCheck() {
  seg($("cc-span"), [["2011-2016", "2011–16"], ["2016-2021", "2016–21"]], state.span, (k) => set({ span: k }));
  seg($("cc-lag"), ["0", "1", "2", "3"].map((l) => [l, l === "0" ? "No lag" : `${l} yr lag`]), state.lag, (k) => set({ lag: k }));
  const [a, b] = state.span.split("-").map(Number), lag = +state.lag;
  const pair = (y0, y1, l) => {
    const yrs = D.permits.years.filter((y) => y >= y0 + l && y <= y1 - 1 + l);
    const permits = nbhd.map((_, i) => sum(yrs.map((y) => D.permits.net[y][i])));
    const change = D.households[y1].map((v, i) => v - D.households[y0][i]);
    return { yrs, permits, change, r: pearson(permits, change), rho: spearman(permits, change) };
  };
  // every interval and lag, as permits.py checks them
  const rows = [[2011, 2016], [2016, 2021]].flatMap(([y0, y1]) => [0, 1, 2, 3].map((l) => {
    const p = pair(y0, y1, l);
    return `<tr${y0 === a && l === lag ? ' class="sel"' : ""}><th>${y0}–${y1}</th><td>${l}</td><td>${p.yrs[0]}–${p.yrs.at(-1)}</td><td>${fmtN(sum(p.permits))}</td><td>${fmtN(sum(p.change))}</td><td>${fmtR(p.r.r)}</td><td>${fmtR(p.rho.r)}</td></tr>`;
  })).join("");
  $("cc-table").innerHTML = `<thead><tr><th>Censuses</th><th>Lag (years)</th><th>Permits issued</th><th>Net units on permits</th><th>Change in households</th><th>Pearson r</th><th>Spearman</th></tr></thead><tbody>${rows}</tbody>`;
  const p = pair(a, b, lag);
  const xs = p.permits, ys = p.change;
  const ext = (vs) => [Math.min(0, ...vs), Math.max(...vs)];
  const [xa, xb] = ext(xs), [ya, yb] = ext(ys);
  const px = (v) => ((v - xa) / (xb - xa)) * 100, py = (v) => ((v - ya) / (yb - ya)) * 100;
  const dots = nbhd.map((n, i) => `<span class="sc-dot" style="left:${px(xs[i]).toFixed(2)}%;bottom:${py(ys[i]).toFixed(2)}%" data-tip="${escapeHTML(`${n.name}<br>Net units on permits ${p.yrs[0]}–${p.yrs.at(-1)}: <b>${fmtN(xs[i])}</b><br>Households ${a}–${b}: <b>${sign(ys[i])}${fmtN(Math.abs(ys[i]))}</b>`)}"></span>`).join("");
  const q = [0, 0.25, 0.5, 0.75, 1];
  const diag = Math.min(xb, yb);
  $("cc-scatter").innerHTML = `<div class="sc-y">Change in households, ${a}–${b} Census</div>
    <div class="sc-box">${q.slice(1, -1).map((f) => `<span class="sc-gx" style="left:${f * 100}%"></span><span class="sc-gy" style="bottom:${f * 100}%"></span>`).join("")}
      <svg class="sc-diag" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1="${px(Math.max(xa, ya))}" y1="${100 - py(Math.max(xa, ya))}" x2="${px(diag)}" y2="${100 - py(diag)}" stroke="#9a9a93" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/></svg>
      ${q.map((f) => `<span class="sc-ytick" style="bottom:${f * 100}%">${fmtK(ya + f * (yb - ya))}</span>`).join("")}${dots}</div>
    <div class="sc-xticks">${q.map((f) => `<span style="left:${f * 100}%">${fmtK(xa + f * (xb - xa))}</span>`).join("")}</div>
    <div class="sc-x">Net units on building permits issued ${p.yrs[0]}–${p.yrs.at(-1)}</div>`;
  $("cc-lede").innerHTML = `Each neighbourhood's net units on permits issued over a census interval (moved later by the lag: censuses are in May, and buildings take time) against its change in households. `
    + `${a}–${b}, ${lag ? `${lag}-year lag` : "no lag"}: ${fmtN(sum(xs))} net units against ${fmtN(sum(ys))} more households; Pearson r <b>${fmtR(p.r.r)}</b>, Spearman <b>${fmtR(p.rho.r)}</b>. The dashed line is one household per unit.`;
}

// ---- 6. rents and vacancy by CMHC zone -------------------------------------------------------------------
function renderZones() {
  const k = state.zoneKey, Z = D.cmhc.zones;
  seg($("zone-key"), [["avg_rent", "Average rent"], ["vacancy", "Vacancy rate"]], k, (zk) => set({ zoneKey: zk }));
  const years = [...new Set(Z.flatMap((z) => z.year))].sort((a, b) => a - b);
  const all = Z.flatMap((z) => z[k].filter((v) => v != null)).sort((a, b) => a - b);
  const cuts = [1, 2, 3, 4, 5].map((q) => quantile(all, q / 6));
  const f = k === "avg_rent" ? (v) => `$${Math.round(v).toLocaleString("en-CA")}` : (v) => `${v.toFixed(1)}`;
  const city = D.cmhc.rms_city;
  const cell = (v, tip) => {
    if (v == null) return `<td class="none" data-tip="${escapeHTML(`${tip}: suppressed`)}">—</td>`;
    const c = cuts.filter((e) => v >= e).length;
    return `<td style="background:${COLORS[c]};color:${c >= 3 ? "#fff" : INK}" data-tip="${escapeHTML(`${tip}: <b>${k === "avg_rent" ? fmtMoney(v) : fmtPct1(v)}</b>`)}">${f(v)}</td>`;
  };
  const rows = Z.map((z) => `<tr><th>${escapeHTML(z.name)}</th>${years.map((y) => cell(z[k][z.year.indexOf(y)] ?? null, `${z.name}, ${y}`)).join("")}</tr>`).join("");
  const cityRow = `<tr class="sel"><th>City of Toronto</th>${years.map((y) => {
    const v = city[k][city.year.indexOf(y)];
    return `<td><b>${v == null ? "—" : f(v)}</b></td>`;
  }).join("")}</tr>`;
  $("zones").innerHTML = `<thead><tr><th>CMHC zone</th>${years.map((y) => `<th>${y}</th>`).join("")}</tr></thead><tbody>${rows}${cityRow}</tbody>`;
  $("zones-lede").innerHTML = `${k === "avg_rent" ? "Average rent (dollars a month)" : "Vacancy rate (percent)"} in purpose-built rental, by CMHC's zones in the City, each October. Shading: sixths of all the cells; a dash is a figure CMHC suppressed.`;
}

// ---- 7. what goes with what ----------------------------------------------------------------------------------
function renderCorr() {
  const m = state.m, { vs, base } = values();
  if (M[m].zone) {
    $("corr-body").hidden = true;
    $("corr-lede").innerHTML = `CMHC's figures are for 17 zones, not 158 neighbourhoods, so they aren't correlated here.`;
    return;
  }
  $("corr-body").hidden = false;
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
  // the scatter
  const c = state.sx, xs = census.measures[c].values["2021"];
  const idx = nbhd.map((_, i) => i).filter((i) => xs[i] != null && vs[i] != null);
  const sx = idx.map((i) => xs[i]).sort((a, b) => a - b), sy = idx.map((i) => vs[i]).sort((a, b) => a - b);
  const xa = sx[0], xb = quantile(sx, 0.99), ya = Math.min(0, sy[0]), yb = quantile(sy, 0.98);
  const px = (v) => Math.min(100, Math.max(0, ((v - xa) / (xb - xa || 1)) * 100)), py = (v) => Math.min(100, Math.max(0, ((v - ya) / (yb - ya || 1)) * 100));
  const fx = (v) => (isMoney(c) ? `$${Math.round(v / 1000)}k` : `${Math.round(v)}%`);
  const fxl = (v) => (isMoney(c) ? fmtMoney(v) : fmtPct1(v));
  const q = [0, 0.25, 0.5, 0.75, 1];
  $("scatter").innerHTML = `<div class="sc-y">${escapeHTML(M[m].label)}${state.p ? `, ${periodLabel()}` : ""}${unitLabel(base)}</div>
    <div class="sc-box">${q.slice(1, -1).map((f) => `<span class="sc-gx" style="left:${f * 100}%"></span><span class="sc-gy" style="bottom:${f * 100}%"></span>`).join("")}
      ${q.map((f) => `<span class="sc-ytick" style="bottom:${f * 100}%">${fmtV(ya + f * (yb - ya))}${f === 1 && yb < sy.at(-1) ? "+" : ""}</span>`).join("")}
      ${idx.map((i) => `<span class="sc-dot" style="left:${px(xs[i]).toFixed(2)}%;bottom:${py(vs[i]).toFixed(2)}%" data-tip="${escapeHTML(`${nbhd[i].name}<br>${CENSUS[c].short}: <b>${fxl(xs[i])}</b><br>${M[m].label}: <b>${fmtV(vs[i])}</b>`)}"></span>`).join("")}</div>
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

// ---- 8. the wider economy: StatCan series ----------------------------------------------------------------------
function renderContext() {
  const fmtVal = (row, v) => (v == null ? "—" : row.unit === "percent" ? `${v.toFixed(1)}%` : row.unit.includes("dollars") ? fmtMoney(v)
    : row.unit === "thousands" ? `${v.toLocaleString("en-CA", { maximumFractionDigits: 1 })}k` : row.unit.startsWith("index") ? v.toFixed(1) : fmtN(v));
  const rows = D.context.map((row) => {
    const vals = row.values, n = vals.length, [lp, lv] = vals.at(-1);
    const monthly = row.freq.startsWith("monthly"), back = (k) => vals[n - 1 - k]?.[1];
    const y1 = back(monthly ? 12 : 1), y5 = back(monthly ? 60 : 5);
    const ch = (a) => (a == null ? "—" : row.unit === "percent" ? `${sign(+(lv - a).toFixed(1))}${Math.abs(lv - a).toFixed(1)} pp` : fmtChangePct(a, lv));
    const tail = vals.slice(-(monthly ? 120 : 25)).map(([, v]) => v);
    return `<tr><th>${escapeHTML(row.name)}</th><td class="txt">${escapeHTML(row.geo)}</td><td>${lp}</td><td><b>${fmtVal(row, lv)}</b></td><td>${ch(y1)}</td><td>${ch(y5)}</td>
      <td class="spark-cell" data-tip="${escapeHTML(`${row.name}: ${vals.at(-tail.length)[0]} to ${lp}`)}">${spark(tail)}</td><td class="txt small">${escapeHTML(row.unit)}; ${escapeHTML(row.freq)}; ${row.table}</td></tr>`;
  }).join("");
  $("context").innerHTML = `<thead><tr><th>Series</th><th class="txt">Area</th><th>Latest</th><th>Value</th><th>1 year</th><th>5 years</th><th>Trend</th><th class="txt">Unit, frequency, table</th></tr></thead><tbody>${rows}</tbody>`;
}

$("method-note").textContent = "Neighbourhood figures: permits and applications sum the years in the period; rents and vacancy average them; "
  + "per-household rates divide by private households at the census nearest the period's start (2011 for periods before 2014, 2016 to 2018, then 2021). "
  + "Map classes are sixths of the neighbourhoods. Correlations with the census are Spearman's; the permits check also gives Pearson's, as pipeline/permits.py does.";

function render() {
  controls();
  renderMap();
  renderRanks();
  renderCorr();
  renderCensusCheck();
  renderZones();
  writeHash();
}
renderCards();
renderYears();
renderContext();
render();
